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
5. Use **Scan this room** to upload a fixed 30-second WebM/MP4 walkthrough (under 60 MB), or upload a PLY point cloud (under 3 MB) from Studio connections. Convex records the job, starts inference, and polls the reconstruction and analysis phases. One warm L4 reconstruction worker and one warm L4 SpatialLM worker keep demo latency low; return both `min_containers` values to zero after the demo to stop idle GPU charges.

For a private CUDA check, run `modal run modal/spatial_service.py --probe health`.
For an end-to-end model check using SpatialLM's official test point cloud, run
`modal run modal/spatial_service.py --probe spatial`. Run
`modal run modal/spatial_service.py --probe frames` to exercise the production
sampler against a synthetic 31-second video.

For video input, the service samples up to 30 uniformly spaced frames at 1 fps and 640 px width, runs balanced SLAM3R reconstruction in one warm worker, releases that GPU stage, and sends the temporary point cloud to a separate warm SpatialLM class whose tokenizer and model load once at container startup. The files live only in temporary container storage. The Convex source video is deleted after a successful snapshot; failed source videos expire within 24 hours or when the user deletes the scan. Returned geometry and optional frame, point, and stage timing metadata are stored as the job result and in the owner-scoped `roomScans` record. Until camera alignment and metric calibration are available, recommendations are visual only.

SpatialLM uses category-conditioned detection for supported living-room
furniture while retaining walls, doors, and windows. Generation is
deterministic and capped at 1,536 new tokens. The service validates the PLY
vertex count, records the actual SpatialLM error in Modal logs, and bounds
generated geometry to plausible demo limits. If SpatialLM rejects an otherwise
valid reconstruction, Roomie returns four conservative room-bound walls from
the point cloud so Jev can continue with a clearly labeled visual estimate
instead of leaving the scan failed.

The upstream model supplies no calibrated object confidence here; `confidence: null` is deliberate. Each job uses temporary input/output files deleted on exit. The baked image contains model weights, never room captures. No room data is used for training.

Validate the current SpatialLM and SLAM3R licenses before a commercial release. SLAM3R is CC BY-NC-SA 4.0, and individual model checkpoints may carry their own terms.
