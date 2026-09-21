"""Roomie room-reconstruction service. Deploy: modal deploy modal/spatial_service.py.

Requires Modal secret roomie-spatial containing SPATIAL_API_TOKEN and
ALLOWED_INPUT_HOSTS (comma-separated exact Convex storage hostnames).
Room video and generated point clouds only exist in the GPU container's temporary
directory. No private room input is stored in a Modal Volume.
"""
import os
import hmac
import time
import tempfile
import subprocess
from pathlib import Path
from urllib.parse import urlparse
import modal

app = modal.App("roomie-spatial")
MODEL = "manycore-research/SpatialLM1.1-Qwen-0.5B"
image = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-devel-ubuntu22.04", add_python="3.11")
    .apt_install("git", "build-essential", "libgl1", "libglib2.0-0")
    .pip_install("torch==2.4.1", "torchvision==0.19.1", "torchaudio==2.4.1", index_url="https://download.pytorch.org/whl/cu124")
    .env({"TORCH_CUDA_ARCH_LIST": "8.9", "MAX_JOBS": "4"})
    .pip_install("packaging", "ninja", "setuptools", "wheel", "poetry-core")
    .run_commands("git clone --depth 1 https://github.com/manycore-research/SpatialLM.git /opt/SpatialLM")
    .run_commands("cd /opt/SpatialLM && pip install --no-build-isolation -e .")
    .run_commands("pip install flash-attn==2.7.4.post1 --no-build-isolation")
    .run_commands("pip install torch-scatter -f https://data.pyg.org/whl/torch-2.4.0+cu124.html")
    .pip_install("timm", "spconv-cu120", "fastapi", "httpx", "huggingface_hub")
    .run_commands(f"python -c \"from huggingface_hub import snapshot_download; snapshot_download('{MODEL}', local_dir='/opt/model')\"")
    .apt_install("ffmpeg")
    .run_commands("git clone --depth 1 https://github.com/PKU-VCL-3DV/SLAM3R.git /opt/SLAM3R")
    .run_commands("python -m venv /opt/slam3r-env")
    .run_commands("/opt/slam3r-env/bin/pip install --upgrade pip wheel setuptools")
    .run_commands("/opt/slam3r-env/bin/pip install torch==2.5.0 torchvision==0.20.0 --index-url https://download.pytorch.org/whl/cu124")
    .run_commands("/opt/slam3r-env/bin/pip install roma matplotlib tqdm opencv-python-headless scipy einops trimesh 'huggingface-hub[torch]>=0.22' pillow")
    .run_commands("/opt/slam3r-env/bin/pip install xformers==0.0.28.post2")
    .run_commands("cd /opt/SLAM3R/slam3r/pos_embed/curope && sed -i 's/\"-arch=native\"/\"-gencode\", \"arch=compute_89,code=sm_89\"/' setup.py && CC=/usr/bin/gcc CXX=/usr/bin/g++ /opt/slam3r-env/bin/python setup.py build_ext --inplace")
    .run_commands("PYTHONPATH=/opt/SLAM3R /opt/slam3r-env/bin/python -c \"from slam3r.models import Image2PointsModel, Local2WorldModel; Image2PointsModel.from_pretrained('siyan824/slam3r_i2p'); Local2WorldModel.from_pretrained('siyan824/slam3r_l2w')\"")
    .env({"PYTHONPATH": "/opt/SpatialLM", "TORCH_CUDA_ARCH_LIST": "8.9", "MPLBACKEND": "Agg"})
)
api_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi", "pydantic")
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


def _spatial_snapshot(point_cloud: Path, output: Path, request_id: str, started: float):
    import numpy as np
    from spatiallm import Layout
    args = ["python", "/opt/SpatialLM/inference.py", "--point_cloud", str(point_cloud), "--output", str(output), "--model_path", "/opt/model"]
    subprocess.run(args, cwd="/opt/SpatialLM", check=True, timeout=480, capture_output=True)
    layout = Layout(output.read_text())
    def serializable(value):
        if isinstance(value, np.ndarray): return value.tolist()
        if isinstance(value, np.generic): return value.item()
        if isinstance(value, dict): return {key:serializable(item) for key,item in value.items()}
        if isinstance(value, (list,tuple)): return [serializable(item) for item in value]
        return value
    geometry = {name:[serializable(vars(entity)) for entity in getattr(layout,name)] for name in ["walls","doors","windows","bboxes"]}
    return {"mode":"live", "schemaVersion":1, "requestId":request_id, "model":MODEL, "reconstructionModel":"SLAM3R", "geometry":geometry, "confidence":None, "cameraAligned":False, "metricScaleVerified":False, "visualEstimate":True, "elapsedSeconds":round(time.monotonic()-started,2)}


@app.function(image=image, gpu="L4", timeout=120)
def gpu_health():
    """Private Modal-only probe used to verify the deployed CUDA runtime."""
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


@app.function(image=image, gpu="L4", timeout=600, max_containers=1, scaledown_window=60, secrets=[secret])
def infer(point_cloud_url: str, categories: list[str], request_id: str):
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="roomie-") as folder:
        source, output = Path(folder)/"room.ply", Path(folder)/"layout.txt"
        _download(point_cloud_url, source, 3_000_000)
        if not source.read_bytes().startswith(b"ply"):
            raise ValueError("Input must be a PLY point cloud")
        return _spatial_snapshot(source, output, request_id, started)


@app.function(image=image, gpu="L4", timeout=1200, max_containers=1, scaledown_window=60, secrets=[secret])
def reconstruct_and_infer(video_url: str, categories: list[str], request_id: str):
    """Reconstruct a room from a short walkthrough and extract compact layout."""
    started = time.monotonic()
    phases[request_id] = "reconstructing"
    try:
        with tempfile.TemporaryDirectory(prefix="roomie-scan-") as folder:
            root = Path(folder)
            video, frames, results = root / "scan", root / "frames", root / "results"
            frames.mkdir()
            _download(video_url, video, 60_000_000)
            # A steady 0.75 fps keeps a 30-60 second walkthrough within the L4's
            # memory envelope while retaining enough parallax for reconstruction.
            subprocess.run(
                ["ffmpeg", "-v", "error", "-i", str(video), "-vf", "fps=0.75,scale='min(720,iw)':-2", "-frames:v", "45", str(frames / "frame_%04d.jpg")],
                check=True,
                timeout=120,
                capture_output=True,
            )
            frame_count = len(list(frames.glob("*.jpg")))
            if frame_count < 12:
                raise ValueError("Walkthrough needs at least 30 seconds of steady room coverage")
            command = [
                "/opt/slam3r-env/bin/python", "/opt/SLAM3R/recon.py",
                "--test_name", "roomie", "--img_dir", str(frames),
                "--save_dir", str(results), "--gpu_id", "0",
                "--keyframe_stride", "3", "--win_r", "5",
                "--num_scene_frame", "8", "--initial_winsize", "5",
                "--conf_thres_l2w", "12", "--conf_thres_i2p", "1.5",
                "--num_points_save", "200000", "--buffer_size", "50",
                "--max_num_register", "8", "--retrieve_freq", "1",
            ]
            slam_env = os.environ.copy()
            slam_env["PYTHONPATH"] = "/opt/SLAM3R"
            subprocess.run(command, cwd="/opt/SLAM3R", env=slam_env, check=True, timeout=780, capture_output=True)
            clouds = list(results.rglob("*_recon.ply"))
            if not clouds:
                raise RuntimeError("SLAM3R completed without a point cloud")
            point_cloud = max(clouds, key=lambda path: path.stat().st_size)
            if point_cloud.stat().st_size < 1024:
                raise RuntimeError("SLAM3R returned an empty point cloud")
            phases[request_id] = "analyzing"
            return _spatial_snapshot(point_cloud, root / "layout.txt", request_id, started)
    finally:
        # Leave the terminal phase briefly available to the polling API. The
        # FunctionCall result remains the source of truth for completion.
        if phases.get(request_id) == "reconstructing":
            phases[request_id] = "failed"

@app.function(image=api_image, secrets=[secret], timeout=30)
@modal.fastapi_endpoint(method="POST")
def api(payload: dict, request: "Request"):
    from fastapi import HTTPException
    expected = os.environ.get("SPATIAL_API_TOKEN", "")
    if not expected or not hmac.compare_digest(request.headers.get("authorization", ""), f"Bearer {expected}"):
        raise HTTPException(401, "Unauthorized")
    if payload.get("operation") == "status":
        call_id = payload.get("call_id")
        if not isinstance(call_id,str) or len(call_id)>200: raise HTTPException(400,"Invalid call ID")
        request_id = payload.get("request_id")
        phase = phases.get(request_id) if isinstance(request_id, str) else None
        try:
            value = modal.FunctionCall.from_id(call_id).get(timeout=0)
            return {"status":"completed", "phase":"ready", "result":value}
        except TimeoutError:
            return {"status":"running", "phase":phase or "reconstructing"}
        except Exception:
            return {"status":"failed", "phase":"failed", "error":"Room reconstruction failed. Try a slower, brighter walkthrough."}
    point_cloud_url, video_url, request_id = payload.get("point_cloud_url"), payload.get("video_url"), payload.get("request_id")
    if not isinstance(request_id,str) or len(request_id)>100 or (bool(point_cloud_url) == bool(video_url)):
        raise HTTPException(400,"One room input URL and a request ID are required")
    url = video_url or point_cloud_url
    if not isinstance(url, str) or not _allowed_url(url):
        raise HTTPException(400,"Input host is not allowed")
    if video_url:
        phases[request_id] = "reconstructing"
        call=reconstruct_and_infer.spawn(url, payload.get("categories") or [], request_id)
    else:
        phases[request_id] = "analyzing"
        call=infer.spawn(url, payload.get("categories") or [], request_id)
    return {"status":"running", "call_id":call.object_id}

# FastAPI resolves this annotation when the web function is constructed.
from fastapi import Request
