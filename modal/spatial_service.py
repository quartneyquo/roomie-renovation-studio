"""Roomie room-reconstruction service. Deploy with:

    modal deploy modal/spatial_service.py

Requires the Modal secret ``roomie-spatial`` containing SPATIAL_API_TOKEN and
ALLOWED_INPUT_HOSTS (comma-separated exact Convex storage hostnames). Uploaded
video and generated point clouds only exist in temporary container storage.
"""

import hmac
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

import modal

app = modal.App("roomie-spatial")
MODEL = "manycore-research/SpatialLM1.1-Qwen-0.5B"
MAX_GEOMETRY_ITEMS = {"walls": 12, "doors": 8, "windows": 12, "bboxes": 40}
MAX_GENERATION_TOKENS = 1536
LIVING_ROOM_CATEGORIES = (
    "sofa",
    "chair",
    "dining_chair",
    "coffee_table",
    "dining_table",
    "side_table",
    "desk",
    "tv_cabinet",
    "bookcase",
    "floor-standing_lamp",
    "plants",
)

image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.1-devel-ubuntu22.04", add_python="3.11"
    )
    .apt_install("git", "build-essential", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.4.1",
        "torchvision==0.19.1",
        "torchaudio==2.4.1",
        index_url="https://download.pytorch.org/whl/cu124",
    )
    .env({"TORCH_CUDA_ARCH_LIST": "8.9", "MAX_JOBS": "4"})
    .pip_install("packaging", "ninja", "setuptools", "wheel", "poetry-core")
    .run_commands(
        "git clone --depth 1 https://github.com/manycore-research/SpatialLM.git /opt/SpatialLM"
    )
    .run_commands("cd /opt/SpatialLM && pip install --no-build-isolation -e .")
    .run_commands("pip install flash-attn==2.7.4.post1 --no-build-isolation")
    .run_commands(
        "pip install torch-scatter -f https://data.pyg.org/whl/torch-2.4.0+cu124.html"
    )
    .pip_install("timm", "spconv-cu120", "fastapi", "httpx", "huggingface_hub")
    .run_commands(
        f"python -c \"from huggingface_hub import snapshot_download; snapshot_download('{MODEL}', local_dir='/opt/model')\""
    )
    .run_commands(
        "huggingface-cli download manycore-research/SpatialLM-Testset pcd/scene0000_00.ply --repo-type dataset --local-dir /opt/spatiallm-smoke"
    )
    .apt_install("ffmpeg")
    .run_commands(
        "git clone --depth 1 https://github.com/PKU-VCL-3DV/SLAM3R.git /opt/SLAM3R"
    )
    .run_commands("python -m venv /opt/slam3r-env")
    .run_commands("/opt/slam3r-env/bin/pip install --upgrade pip wheel setuptools")
    .run_commands(
        "/opt/slam3r-env/bin/pip install torch==2.5.0 torchvision==0.20.0 --index-url https://download.pytorch.org/whl/cu124"
    )
    .run_commands(
        "/opt/slam3r-env/bin/pip install roma matplotlib tqdm opencv-python-headless scipy einops trimesh 'huggingface-hub[torch]>=0.22' pillow"
    )
    .run_commands("/opt/slam3r-env/bin/pip install xformers==0.0.28.post2")
    .run_commands(
        "cd /opt/SLAM3R/slam3r/pos_embed/curope && sed -i 's/\"-arch=native\"/\"-gencode\", \"arch=compute_89,code=sm_89\"/' setup.py && CC=/usr/bin/gcc CXX=/usr/bin/g++ /opt/slam3r-env/bin/python setup.py build_ext --inplace"
    )
    .run_commands(
        "PYTHONPATH=/opt/SLAM3R /opt/slam3r-env/bin/python -c \"from slam3r.models import Image2PointsModel, Local2WorldModel; Image2PointsModel.from_pretrained('siyan824/slam3r_i2p'); Local2WorldModel.from_pretrained('siyan824/slam3r_l2w')\""
    )
    .env(
        {
            "PYTHONPATH": "/opt/SpatialLM",
            "TORCH_CUDA_ARCH_LIST": "8.9",
            "MPLBACKEND": "Agg",
        }
    )
)
api_image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "fastapi", "pydantic", "httpx"
)
secret = modal.Secret.from_name("roomie-spatial")
phases = modal.Dict.from_name("roomie-scan-phases", create_if_missing=True)


def _allowed_url(url: str) -> bool:
    parsed = urlparse(url)
    allowed = {host.strip() for host in os.environ["ALLOWED_INPUT_HOSTS"].split(",")}
    return bool(
        parsed.scheme == "https"
        and parsed.hostname in allowed
        and not parsed.username
        and parsed.port is None
    )


def _download(url: str, target: Path, limit: int) -> int:
    import httpx

    if not _allowed_url(url):
        raise ValueError("Only this app's Convex storage URLs are accepted")
    size = 0
    with httpx.stream("GET", url, timeout=60, follow_redirects=False) as response:
        response.raise_for_status()
        with target.open("wb") as output:
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > limit:
                    raise ValueError("Room input is too large")
                output.write(chunk)
    return size


def _ply_vertex_count(point_cloud: Path) -> int:
    """Read a PLY vertex count without loading the full point cloud."""
    with point_cloud.open("rb") as source:
        if source.readline().strip() != b"ply":
            raise ValueError("Input must be a PLY point cloud")
        for _ in range(200):
            line = source.readline()
            if not line:
                break
            if line.startswith(b"element vertex "):
                return int(line.split()[-1])
            if line.strip() == b"end_header":
                break
    raise ValueError("Point cloud has no PLY vertex count")


def _coarse_geometry(point_cloud: Path):
    """Return conservative room bounds when learned layout parsing fails."""
    import numpy as np
    from spatiallm.pcd import get_points_and_colors, load_o3d_pcd

    cloud = load_o3d_pcd(str(point_cloud))
    points, _ = get_points_and_colors(cloud)
    points = points[np.isfinite(points).all(axis=1)]
    if len(points) < 500:
        raise RuntimeError("The reconstructed point cloud is too sparse to analyze")
    low, high = np.quantile(points, [0.03, 0.97], axis=0)
    if np.any(high - low <= 1e-4):
        raise RuntimeError("The reconstructed point cloud has invalid room bounds")
    x0, y0, z0 = (round(float(value), 4) for value in low)
    x1, y1, z1 = (round(float(value), 4) for value in high)
    height = round(z1 - z0, 4)
    return {
        "walls": [
            {"ax": x0, "ay": y0, "bx": x1, "by": y0, "height": height},
            {"ax": x1, "ay": y0, "bx": x1, "by": y1, "height": height},
            {"ax": x1, "ay": y1, "bx": x0, "by": y1, "height": height},
            {"ax": x0, "ay": y1, "bx": x0, "by": y0, "height": height},
        ],
        "doors": [],
        "windows": [],
        "bboxes": [],
    }


def _serializable(value):
    import numpy as np

    if isinstance(value, np.ndarray):
        return _serializable(value.tolist())
    if isinstance(value, np.generic):
        return _serializable(value.item())
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: _serializable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_serializable(item) for item in value]
    return value


def _categories(requested: list[str]) -> list[str]:
    aliases = {
        "table": ("coffee_table", "dining_table", "side_table"),
        "lamp": ("floor-standing_lamp",),
        "bookshelf": ("bookcase",),
    }
    supported = set(LIVING_ROOM_CATEGORIES)
    result = list(LIVING_ROOM_CATEGORIES)
    for category in requested:
        for normalized in aliases.get(category, (category,)):
            if normalized in supported and normalized not in result:
                result.append(normalized)
    return result


def _extract_frames(video: Path, frames: Path) -> int:
    """Sample one uniform 640 px frame per second, bounded at 30 frames."""
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(video),
            "-vf",
            "fps=1,scale='min(640,iw)':-2",
            "-frames:v",
            "30",
            str(frames / "frame_%04d.jpg"),
        ],
        check=True,
        timeout=120,
        capture_output=True,
    )
    return len(list(frames.glob("*.jpg")))


@app.cls(
    image=image,
    gpu="L4",
    timeout=600,
    max_containers=1,
    min_containers=1,
    scaledown_window=1200,
)
class SpatialAnalyzer:
    """Persist the tokenizer and model for every scan handled by this worker."""

    @modal.enter()
    def load_model(self):
        import torch
        from spatiallm import Layout
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.torch = torch
        self.Layout = Layout
        self.tokenizer = AutoTokenizer.from_pretrained("/opt/model")
        self.model = AutoModelForCausalLM.from_pretrained(
            "/opt/model", torch_dtype=torch.bfloat16
        )
        self.model.to("cuda")
        self.model.set_point_backbone_dtype(torch.float32)
        self.model.eval()
        self.num_bins = self.model.config.point_config["num_bins"]
        self.grid_size = Layout.get_grid_size(self.num_bins)
        self.code_template = Path("/opt/SpatialLM/code_template.txt").read_text()

    def _generate_layout(self, input_pcd, categories: list[str]):
        task = "Detect walls, doors, windows, boxes."
        task = task.replace("boxes", ", ".join(categories))
        prompt = (
            f"<|point_start|><|point_pad|><|point_end|>{task} "
            f"The reference code is as followed: {self.code_template}"
        )
        conversation = [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": prompt},
        ]
        input_ids = self.tokenizer.apply_chat_template(
            conversation, add_generation_prompt=True, return_tensors="pt"
        ).to(self.model.device)
        with self.torch.inference_mode():
            output_ids = self.model.generate(
                input_ids=input_ids,
                point_clouds=input_pcd,
                max_new_tokens=MAX_GENERATION_TOKENS,
                do_sample=False,
                num_beams=1,
                use_cache=True,
            )
        text = self.tokenizer.decode(
            output_ids[0, input_ids.shape[1] :], skip_special_tokens=True
        )
        layout = self.Layout(text)
        layout.undiscretize_and_unnormalize(num_bins=self.num_bins)
        return layout

    def _analyze_file(
        self,
        point_cloud: Path,
        requested_categories: list[str],
        request_id: str,
        pipeline_started_at: float,
        frame_count: int,
        reconstruction_seconds: float,
        allow_fallback: bool,
    ):
        import numpy as np
        from inference import preprocess_point_cloud
        from spatiallm.pcd import cleanup_pcd, get_points_and_colors, load_o3d_pcd

        vertex_count = _ply_vertex_count(point_cloud)
        if vertex_count < 500:
            raise RuntimeError(
                f"The reconstructed point cloud is too sparse ({vertex_count} points)"
            )
        analysis_started = time.monotonic()
        warning = None
        try:
            cloud = cleanup_pcd(
                load_o3d_pcd(str(point_cloud)), voxel_size=self.grid_size
            )
            points, colors = get_points_and_colors(cloud)
            min_extent = np.min(points, axis=0)
            input_pcd = preprocess_point_cloud(
                points, colors, self.grid_size, self.num_bins
            )
            layout = self._generate_layout(input_pcd, _categories(requested_categories))
            layout.translate(min_extent)
            geometry = {
                name: [
                    _serializable(vars(entity))
                    for entity in getattr(layout, name)[:MAX_GEOMETRY_ITEMS[name]]
                ]
                for name in MAX_GEOMETRY_ITEMS
            }
        except Exception as error:
            if not allow_fallback:
                raise
            warning = str(error)[:300]
            print(f"Using coarse geometry fallback for {request_id}: {warning}", flush=True)
            geometry = _coarse_geometry(point_cloud)

        spatial_seconds = round(time.monotonic() - analysis_started, 2)
        total_seconds = round(time.time() - pipeline_started_at, 2)
        snapshot = {
            "mode": "live",
            "schemaVersion": 1,
            "requestId": request_id,
            "model": MODEL,
            "reconstructionModel": "SLAM3R",
            "geometry": geometry,
            "confidence": None,
            "cameraAligned": False,
            "metricScaleVerified": False,
            "visualEstimate": True,
            "pointCount": vertex_count,
            "spatialLmStatus": "fallback" if warning else "completed",
            "elapsedSeconds": total_seconds,
            "performance": {
                "frameCount": frame_count,
                "pointCount": vertex_count,
                "reconstructionSeconds": round(reconstruction_seconds, 2),
                "spatialLmSeconds": spatial_seconds,
                "totalSeconds": total_seconds,
            },
        }
        if warning:
            snapshot["warning"] = (
                "SpatialLM could not parse this scan; coarse reconstructed room "
                "bounds are shown."
            )
        if len(json.dumps(snapshot)) > 100_000:
            snapshot["geometry"] = {
                name: items[:20] for name, items in geometry.items()
            }
        return snapshot

    @modal.method()
    def analyze(
        self,
        point_cloud_bytes: bytes,
        categories: list[str],
        request_id: str,
        pipeline_started_at: float,
        frame_count: int = 0,
        reconstruction_seconds: float = 0,
    ):
        with tempfile.TemporaryDirectory(prefix="roomie-spatial-") as folder:
            point_cloud = Path(folder) / "room.ply"
            point_cloud.write_bytes(point_cloud_bytes)
            return self._analyze_file(
                point_cloud,
                categories,
                request_id,
                pipeline_started_at,
                frame_count,
                reconstruction_seconds,
                True,
            )

    @modal.method()
    def smoke(self):
        started = time.time()
        snapshot = self._analyze_file(
            Path("/opt/spatiallm-smoke/pcd/scene0000_00.ply"),
            list(LIVING_ROOM_CATEGORIES),
            "spatial-smoke",
            started,
            0,
            0,
            False,
        )
        return {
            "model": snapshot["model"],
            "spatialLmStatus": snapshot["spatialLmStatus"],
            "pointCount": snapshot["pointCount"],
            "geometryCounts": {
                name: len(items) for name, items in snapshot["geometry"].items()
            },
            "elapsedSeconds": snapshot["elapsedSeconds"],
        }


spatial_analyzer = SpatialAnalyzer()


@app.function(image=image, gpu="L4", timeout=120)
def gpu_health():
    """Private probe for the deployed CUDA and SLAM3R runtimes."""
    import torch

    slam_env = os.environ.copy()
    slam_env["PYTHONPATH"] = "/opt/SLAM3R"
    slam = subprocess.run(
        [
            "/opt/slam3r-env/bin/python",
            "-c",
            "import torch; from slam3r.models import Image2PointsModel; print(torch.cuda.is_available())",
        ],
        env=slam_env,
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
    return {
        "cudaAvailable": torch.cuda.is_available(),
        "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "torch": str(torch.__version__),
        "slam3rReady": slam.stdout.strip().endswith("True"),
    }


@app.function(image=api_image, timeout=600)
def spatial_smoke():
    """Run the warm SpatialLM class against its official test point cloud."""
    return spatial_analyzer.smoke.remote()


@app.function(image=image, timeout=180)
def frame_sampling_smoke():
    """Exercise the production frame sampler with a synthetic 31-second clip."""
    with tempfile.TemporaryDirectory(prefix="roomie-frame-smoke-") as folder:
        root = Path(folder)
        video, frames = root / "source.mp4", root / "frames"
        frames.mkdir()
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=1280x720:rate=10",
                "-t",
                "31",
                "-c:v",
                "mpeg4",
                str(video),
            ],
            check=True,
            timeout=120,
            capture_output=True,
        )
        frame_count = _extract_frames(video, frames)
        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height",
                "-of",
                "csv=p=0",
                str(frames / "frame_0001.jpg"),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        width, height = (int(value) for value in probe.stdout.strip().split(","))
        return {"frameCount": frame_count, "width": width, "height": height}


@app.function(
    image=image,
    gpu="L4",
    timeout=900,
    max_containers=1,
    min_containers=1,
    scaledown_window=1200,
    secrets=[secret],
)
def reconstruct(video_url: str, request_id: str):
    """Convert a walkthrough to a bounded point cloud in a dedicated worker."""
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="roomie-reconstruct-") as folder:
        root = Path(folder)
        video, frames, results = root / "scan", root / "frames", root / "results"
        frames.mkdir()
        _download(video_url, video, 60_000_000)
        frame_count = _extract_frames(video, frames)
        if frame_count < 24:
            raise ValueError(
                "Walkthrough needs the full 30 seconds of steady room coverage"
            )
        command = [
            "/opt/slam3r-env/bin/python",
            "/opt/SLAM3R/recon.py",
            "--test_name",
            "roomie",
            "--img_dir",
            str(frames),
            "--save_dir",
            str(results),
            "--gpu_id",
            "0",
            "--keyframe_stride",
            "3",
            "--win_r",
            "3",
            "--num_scene_frame",
            "6",
            "--initial_winsize",
            "5",
            "--conf_thres_l2w",
            "12",
            "--conf_thres_i2p",
            "1.5",
            "--num_points_save",
            "120000",
            "--buffer_size",
            "30",
            "--max_num_register",
            "6",
            "--retrieve_freq",
            "1",
        ]
        slam_env = os.environ.copy()
        slam_env["PYTHONPATH"] = "/opt/SLAM3R"
        subprocess.run(
            command,
            cwd="/opt/SLAM3R",
            env=slam_env,
            check=True,
            timeout=780,
            capture_output=True,
        )
        clouds = list(results.rglob("*_recon.ply"))
        if not clouds:
            raise RuntimeError("SLAM3R completed without a point cloud")
        point_cloud = max(clouds, key=lambda path: path.stat().st_size)
        if point_cloud.stat().st_size < 1024:
            raise RuntimeError("SLAM3R returned an empty point cloud")
        return {
            "pointCloud": point_cloud.read_bytes(),
            "frameCount": min(frame_count, 30),
            "reconstructionSeconds": round(time.monotonic() - started, 2),
        }


@app.function(image=api_image, timeout=1200)
def reconstruct_and_infer(video_url: str, categories: list[str], request_id: str):
    """Run reconstruction and SpatialLM as separate GPU stages."""
    pipeline_started_at = time.time()
    phases[request_id] = "reconstructing"
    try:
        result = reconstruct.remote(video_url, request_id)
        phases[request_id] = "analyzing"
        return spatial_analyzer.analyze.remote(
            result["pointCloud"],
            categories,
            request_id,
            pipeline_started_at,
            result["frameCount"],
            result["reconstructionSeconds"],
        )
    except Exception:
        phases[request_id] = "failed"
        raise


@app.function(image=api_image, timeout=700, secrets=[secret])
def infer(point_cloud_url: str, categories: list[str], request_id: str):
    """Analyze an existing point cloud through the same warm class."""
    pipeline_started_at = time.time()
    with tempfile.TemporaryDirectory(prefix="roomie-upload-") as folder:
        point_cloud = Path(folder) / "room.ply"
        _download(point_cloud_url, point_cloud, 3_000_000)
        return spatial_analyzer.analyze.remote(
            point_cloud.read_bytes(),
            categories,
            request_id,
            pipeline_started_at,
        )


@app.function(image=api_image, secrets=[secret], timeout=30)
@modal.fastapi_endpoint(method="POST")
def api(payload: dict, request: "Request"):
    from fastapi import HTTPException

    expected = os.environ.get("SPATIAL_API_TOKEN", "")
    if not expected or not hmac.compare_digest(
        request.headers.get("authorization", ""), f"Bearer {expected}"
    ):
        raise HTTPException(401, "Unauthorized")
    if payload.get("operation") == "status":
        call_id = payload.get("call_id")
        if not isinstance(call_id, str) or len(call_id) > 200:
            raise HTTPException(400, "Invalid call ID")
        request_id = payload.get("request_id")
        phase = phases.get(request_id) if isinstance(request_id, str) else None
        try:
            value = modal.FunctionCall.from_id(call_id).get(timeout=0)
            return {"status": "completed", "phase": "ready", "result": value}
        except TimeoutError:
            return {"status": "running", "phase": phase or "reconstructing"}
        except Exception as error:
            print(f"Room scan {request_id or call_id} failed: {error}", flush=True)
            return {
                "status": "failed",
                "phase": "failed",
                "error": "Room reconstruction failed. The GPU service recorded the exact cause; retry this scan or record a brighter walkthrough.",
            }

    point_cloud_url = payload.get("point_cloud_url")
    video_url = payload.get("video_url")
    request_id = payload.get("request_id")
    if (
        not isinstance(request_id, str)
        or len(request_id) > 100
        or (bool(point_cloud_url) == bool(video_url))
    ):
        raise HTTPException(400, "One room input URL and a request ID are required")
    url = video_url or point_cloud_url
    if not isinstance(url, str) or not _allowed_url(url):
        raise HTTPException(400, "Input host is not allowed")
    if video_url:
        phases[request_id] = "reconstructing"
        call = reconstruct_and_infer.spawn(
            url, payload.get("categories") or [], request_id
        )
    else:
        phases[request_id] = "analyzing"
        call = infer.spawn(url, payload.get("categories") or [], request_id)
    return {"status": "running", "call_id": call.object_id}


# FastAPI resolves this annotation when the web function is constructed.
from fastapi import Request


@app.local_entrypoint()
def check(probe: str = "health"):
    if probe == "health":
        result = gpu_health.remote()
    elif probe == "spatial":
        result = spatial_smoke.remote()
    elif probe == "frames":
        result = frame_sampling_smoke.remote()
    else:
        raise ValueError("Probe must be 'health', 'spatial', or 'frames'")
    print(json.dumps(result, indent=2))
