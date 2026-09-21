# SpatialLM on Modal

Prepared service; not deployed or GPU-tested. Modal credentials are not present on this laptop.

1. In a Python 3.11 virtual environment, install `modal` and `fastapi`, then run `modal setup` to connect your account.
2. Create the Modal secret `roomie-spatial` with `SPATIAL_API_TOKEN` (a random secret) and `ALLOWED_INPUT_HOSTS=fleet-cheetah-120.convex.cloud`. Use the actual hostname returned by Convex storage if it differs. Do not use a wildcard.
3. `modal deploy modal/spatial_service.py`. The initial CUDA image/model build takes time. This has not been validated against a live GPU yet.
4. Set Convex `MODAL_SPATIAL_URL` to the returned API endpoint, and `MODAL_SPATIAL_TOKEN` to the same secret.
5. Upload a PLY point cloud (under 3 MB) from Studio connections. Convex records the job, starts inference and polls completion. Modal scales to zero; one GPU container limits concurrency.

Input must already be reconstructed. A fixed laptop webcam is not a substitute for a walkthrough. SLAM3R/MASt3R-SLAM reconstruction and camera-to-point-cloud alignment are not implemented in this day-one build. Returned geometry is stored as the job result but is not silently applied to an unrelated room image. Until camera alignment and metric calibration are available, recommendations are visual only.

The upstream model supplies no calibrated object confidence here; `confidence: null` is deliberate. Each job uses temporary input/output files deleted on exit. The baked image contains model weights, never room captures. No room data is used for training.

Validate the current SpatialLM license before a commercial release. The upstream package reports Llama3.2; individual model checkpoints may carry their own terms.
