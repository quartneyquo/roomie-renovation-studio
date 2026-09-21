# SpatialLM on Modal

Deployed to the `quartneyquo` Modal workspace as `roomie-spatial` at
`https://quartneyquo--roomie-spatial-api.modal.run`. The current Convex
development deployment is connected to this endpoint. A private GPU probe
verified an NVIDIA L4 with CUDA available under PyTorch 2.4.1 + CUDA 12.4 and
the baked SLAM3R runtime under PyTorch 2.5. A real-room walkthrough still needs
an end-to-end browser smoke test.

1. In a Python 3.11 virtual environment, install `modal` and `fastapi`, then run `modal setup` to connect your account.
2. Create the Modal secret `roomie-spatial` with `SPATIAL_API_TOKEN` (a random secret) and `ALLOWED_INPUT_HOSTS=fleet-cheetah-120.convex.cloud`. Use the actual hostname returned by Convex storage if it differs. Do not use a wildcard.
3. `modal deploy modal/spatial_service.py`. The initial CUDA image/model build takes time; subsequent deploys reuse the image layers.
4. Set Convex `MODAL_SPATIAL_URL` to the returned API endpoint, and `MODAL_SPATIAL_TOKEN` to the same secret.
5. Use **Scan this room** to upload a 30–60 second WebM/MP4 walkthrough (under 60 MB), or upload a PLY point cloud (under 3 MB) from Studio connections. Convex records the job, starts inference, and polls the reconstruction and analysis phases. Modal scales to zero; one GPU container limits concurrency.

For a private CUDA check, run `modal run modal/spatial_service.py::gpu_health`.

For video input, the service samples frames, runs SLAM3R to create a temporary `.ply`, then runs SpatialLM. The files live only in the GPU container's temporary directory. The Convex source video is deleted after a successful snapshot; failed source videos expire within 24 hours or when the user deletes the scan. Returned geometry is stored as the job result and in the owner-scoped `roomScans` record. Until camera alignment and metric calibration are available, recommendations are visual only.

The upstream model supplies no calibrated object confidence here; `confidence: null` is deliberate. Each job uses temporary input/output files deleted on exit. The baked image contains model weights, never room captures. No room data is used for training.

Validate the current SpatialLM and SLAM3R licenses before a commercial release. SLAM3R is CC BY-NC-SA 4.0, and individual model checkpoints may carry their own terms.
