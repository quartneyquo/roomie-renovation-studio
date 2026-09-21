"""Roomie SpatialLM service. Deploy: modal deploy modal/spatial_service.py.

Requires Modal secret roomie-spatial containing SPATIAL_API_TOKEN and
ALLOWED_INPUT_HOSTS (comma-separated exact Convex storage hostnames).
No private room input is stored in a Modal Volume.
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
    .env({"PYTHONPATH": "/opt/SpatialLM", "TORCH_CUDA_ARCH_LIST": "8.9"})
)
api_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi", "pydantic")
secret = modal.Secret.from_name("roomie-spatial")

@app.function(image=image, gpu="L4", timeout=600, max_containers=1, scaledown_window=60, secrets=[secret])
def infer(point_cloud_url: str, categories: list[str], request_id: str):
    import httpx
    import numpy as np
    from spatiallm.layout import Layout
    parsed = urlparse(point_cloud_url)
    allowed = {host.strip() for host in os.environ["ALLOWED_INPUT_HOSTS"].split(",")}
    if parsed.scheme != "https" or parsed.hostname not in allowed or parsed.username or parsed.port:
        raise ValueError("Only this app's Convex storage URLs are accepted")
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="roomie-") as folder:
        source, output = Path(folder)/"room.ply", Path(folder)/"layout.txt"
        with httpx.stream("GET", point_cloud_url, timeout=30, follow_redirects=False) as response:
            response.raise_for_status()
            size = 0
            with source.open("wb") as target:
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > 3_000_000:
                        raise ValueError("Point cloud exceeds 3 MB")
                    target.write(chunk)
        if not source.read_bytes().startswith(b"ply"):
            raise ValueError("Input must be a PLY point cloud")
        args = ["python", "/opt/SpatialLM/inference.py", "--point_cloud", str(source), "--output", str(output), "--model_path", "/opt/model"]
        # Full layout includes architecture; a category-specific pass is optional.
        subprocess.run(args, cwd="/opt/SpatialLM", check=True, timeout=480, capture_output=True)
        raw = output.read_text()
        layout = Layout(raw)
        def serializable(value):
            if isinstance(value, np.ndarray): return value.tolist()
            if isinstance(value, np.generic): return value.item()
            if isinstance(value, dict): return {k:serializable(v) for k,v in value.items()}
            if isinstance(value, (list,tuple)): return [serializable(v) for v in value]
            return value
        geometry = {name:[serializable(vars(entity)) for entity in getattr(layout,name)] for name in ["walls","doors","windows","bboxes"]}
        return {"mode":"live", "schemaVersion":1, "requestId":request_id, "model":MODEL, "geometry":geometry, "confidence":None, "cameraAligned":False, "metricScaleVerified":False, "elapsedSeconds":round(time.monotonic()-started,2)}

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
        try:
            value = modal.FunctionCall.from_id(call_id).get(timeout=0)
            return {"status":"completed", "result":value}
        except TimeoutError:
            return {"status":"running"}
    url, request_id = payload.get("point_cloud_url"), payload.get("request_id")
    if not isinstance(url,str) or not isinstance(request_id,str) or len(request_id)>100:
        raise HTTPException(400,"Point cloud URL and request ID required")
    parsed=urlparse(url)
    if parsed.scheme!="https" or parsed.hostname not in os.environ["ALLOWED_INPUT_HOSTS"].split(","):
        raise HTTPException(400,"Input host is not allowed")
    call=infer.spawn(url, [], request_id)
    return {"status":"running", "call_id":call.object_id}

# FastAPI resolves this annotation when the web function is constructed.
from fastapi import Request
