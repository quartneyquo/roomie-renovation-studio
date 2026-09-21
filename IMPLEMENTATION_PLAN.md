# Room Renovation App — Implementation Plan

## Status

This document records the agreed plan. The first Chrome studio implementation is now in the workspace; see README.md for the exact implemented scope, verification, and remaining live-integration work.

The studio now supports camera/photo input, editable reference placement, conservative visual checks, suggestions in preview mode, private Convex saving/reopening, screenshots, sharing, and reviewed email handoff. Live provider adapters and a Modal deployment definition are prepared. Credentials, live model smoke tests, CUDA deployment, scan reconstruction and camera-aligned 3D constraints remain outstanding.

## Product goal

Build a polished Chrome-first web room-renovation app where a person can:

1. Open the app in Google Chrome and immediately enter the live camera experience.
2. Describe or upload a reference for an item.
3. See that item visualized in the live room.
4. Move, rotate, scale, regenerate, or remove the item.
5. Receive a research-informed placement verdict and adjustment.
6. See a short generated visual suggestion showing the proposed improvement.
7. Save and reopen the complete configuration.
8. Compare before and after states.
9. Download or share a screenshot.
10. Explicitly approve an email handoff to a supplier or design expert.

The app uses the supplied friendly wrench branding and a warm cream, blush, and burgundy visual system.

## Model and service responsibilities

Each model has one clear responsibility.

### Lucy 2.5

- Purpose: live visual editing/compositing of the requested item into the camera feed.
- Expected fal endpoint: `decart/lucy-2-5/realtime`.
- Inputs: live video, text prompt, and optional reference image.
- Output: continuously edited live video.
- Lucy output is a visualization. It is not the authoritative saved placement geometry.

### Editable placement overlay

- Purpose: provide the authoritative item position, scale, rotation, and bounds.
- Implemented with a canvas/WebGL overlay on top of the camera experience.
- Supports touch and pointer drag, pinch/slider scale, rotation, regeneration, and removal.
- Its transformation values are the source of truth for evaluation and saving.

### SpatialLM 1.1

- Purpose: turn an initial room scan into structured indoor geometry and semantics.
- Preferred checkpoint: `SpatialLM1.1-Qwen-0.5B`, with the 1B model available if quality requires it.
- Inputs: a point cloud reconstructed from monocular video, RGB-D, or LiDAR.
- Outputs: walls, doors, windows, architectural layout, recognized furniture, and oriented 3D bounding boxes.
- Preferred monocular reconstruction path: MASt3R-SLAM or SLAM3R.
- It runs during initial room understanding and after a major rescan, not on every live frame.
- Known limitation: zero-shot accuracy varies significantly across furniture categories. Low-confidence objects must be confirmed by the user or handled by the fallback path.
- Local execution requires the model's supported NVIDIA CUDA environment. The current development computer is an Apple M4 MacBook Air with 16 GB memory and no CUDA GPU, so local SpatialLM inference is not part of the one-day path.
- Run SpatialLM on a remote GPU endpoint orchestrated by a Convex action. Use a precomputed spatial snapshot if that endpoint is not ready on build day.

### Function2Scene-inspired constraint engine

- Purpose: evaluate structured room geometry against functional interior-layout constraints.
- This is a constraint taxonomy and evaluation approach, not assumed to be a production-ready hosted API.
- Constraint families:
  - Spatial: fit, boundaries, attachment, alignment, adjacency, scale, and balance.
  - Ergonomic: circulation, interaction clearance, reachability, body fit, and accessibility.
  - Activity: activity zones, multi-use compatibility, sightlines, privacy, and workflow.
  - Environmental: natural light, glare, ventilation, heat, drafts, and acoustics.
- Deterministic geometry checks should be used whenever a conclusion can be calculated directly.

### Jev

- Purpose: make the bounded placement decision after perception and constraint calculation.
- Provider: TypeSafe System One API.
- Official endpoint: `POST https://api.typesafe.ai/v1/systemone`.
- Authentication: `Authorization: Bearer <TYPESAFE_API_KEY>` from a Convex action.
- Model during development: `jev-latest`. Record the returned versioned model ID and pin that version after thresholds are calibrated.
- Official JavaScript SDK: `@typesafe-ai/sdk`; direct server-side HTTP remains an acceptable adapter implementation.
- Jev is not responsible for seeing or reconstructing the room.
- Inputs: versioned structured state, temporal change, deterministic constraint results, confidence values, and selected research evidence.
- Jev is a typed decision model rather than a text generator. It returns Choice, Score, and Noul answers with probabilities. Application code converts those typed answers into the concise explanation and machine-readable adjustment shown to the user.
- Jev calls are event-driven. It is not called for unchanged frames.

### MiniMax H3 Max Turbo through fal.ai

- Purpose: generate a short visual “try this placement” suggestion alongside the current video feed.
- Preferred endpoint: `minimax/h3-max-turbo/image-to-video`.
- Inputs: current room frame, item reference, current transform, Jev problem, and Jev recommended adjustment.
- Output: a short illustrative suggestion clip.
- H3 output does not replace the editable overlay or become the saved geometry automatically.
- A user applies the suggested change to the editable placement before reevaluation.

### Firecrawl

- Purpose: collect relevant expert guidance before classification.
- Research dimensions include room type, materials, sunlight, ergonomics, clearances, accessibility, manufacturer instructions, and applicable California or local requirements.
- Sources must include authority level, jurisdiction, effective or retrieval date, manufacturer/model applicability, and cache expiration.
- Only the most relevant evidence is sent to Jev and displayed in the collapsible Expert guidance panel.
- Firecrawl also discovers relevant suppliers and design experts, returning source-backed contact candidates rather than silently selecting a recipient.

### AgentMail

- Purpose: send a user-approved package to a selected supplier or design expert.
- The user must preview the recipient, subject, message, screenshot, room context, requested item, evaluation, and included attachments before sending.
- No email is sent implicitly.
- AgentMail sends to a Firecrawl-discovered candidate only after the user selects and approves that contact.

### Convex

- Purpose: the complete application backend and system of record.
- Responsibilities: database, file storage, server functions, provider adapters, real-time subscriptions, saved projects, research cache, job orchestration, retries, cancellation, idempotency, and handoff audit records.
- Provider keys never enter browser code.
- Privileged provider session creation happens in Convex actions. Low-latency WebRTC media may connect from the browser using a short-lived scoped session credential created by Convex.
- GPU models that cannot execute inside Convex run as external inference services invoked by Convex actions.
- Saved projects, room state, captures, generated assets, evaluations, research, discovered contacts, and handoff records persist in Convex.
- Provider credentials will be added to Convex environment variables later. Until then, every provider adapter must support mock mode.

## End-to-end architecture

```text
Initial room scan
  -> monocular SLAM, RGB-D, or LiDAR reconstruction
  -> point cloud
  -> SpatialLM
  -> structured room model
  -> user confirmation for uncertain objects and dimensions

Chrome opens directly into the live camera experience
  -> Lucy 2.5 live visualization
  -> room understanding starts progressively in the background
  -> editable overlay and known transform
  -> pose/depth/segmentation updates
  -> structured spatial state
  -> Function2Scene-style constraint checks
  -> relevant cached Firecrawl guidance
  -> Jev decision
      -> good: green placement outline
      -> bad: red placement outline + adjustment
      -> uncertain: larger vision/video fallback or user confirmation
  -> H3 Max Turbo suggestion clip when an adjustment is useful
  -> user applies or rejects suggestion
  -> reevaluate latest state
```

## Perception and temporal-state plan

The original temporal proposal remains useful, but the one-day implementation does not train a GRU.

### Initial room state

1. Start the laptop camera immediately for the live visualization experience.
2. A fixed laptop webcam does not provide enough camera movement for dependable monocular room reconstruction. Build the initial spatial state from an uploaded walkthrough video or the precomputed living-room snapshot.
3. Reconstruct a point cloud from the uploaded walkthrough with an available SLAM path.
4. Run SpatialLM to produce room architecture and object boxes.
5. Estimate or capture camera poses in the same coordinate system.
6. Ask the user to confirm uncertain room boundaries and objects. Metric calibration is optional because the first release is explicitly visual planning.

### Live state

The app already knows all changes made to the virtual item. Use those exact transforms instead of inferring them from pixels.

Track physical-scene changes with lightweight depth, segmentation, tracking, and pose updates. Rebuild the room model only when confidence drops or the physical scene changes materially.

### Deferred learned temporal model

A later version may use:

```text
new frame
  -> MobileCLIP2-S2 or SigLIP embedding
  -> rolling embedding cache
  -> embedding delta, GRU, or tiny temporal transformer
  -> structured physical-scene event
```

Train this only after real interactions have produced a room-specific labeled dataset. Generic action-recognition labels are not a substitute for renovation events.

## Structured state contract

Every state uses a schema version and immutable revision identifier.

```json
{
  "schemaVersion": 1,
  "projectId": "project-id",
  "roomId": "room-id",
  "captureId": "capture-id",
  "stateRevision": 42,
  "capturedAt": 0,
  "room": {
    "type": "kitchen",
    "dimensionsCm": [360, 245, 410],
    "floorPlaneConfidence": 0.93,
    "metricScaleConfidence": 0.84
  },
  "placedItem": {
    "type": "refrigerator",
    "position": [1.2, 0, 2.7],
    "rotationDegrees": 90,
    "scale": [0.9, 0.9, 0.9],
    "boundsCm": [91, 178, 74],
    "changedSincePrevious": true
  },
  "relationships": {
    "distanceFromWallCm": 6,
    "walkwayClearanceCm": 92,
    "doorSwingClearanceCm": 38,
    "blocksWindow": false,
    "blocksVent": false,
    "nearHeatSource": true
  },
  "temporalEvent": "item_moved_toward_wall",
  "confidence": 0.88,
  "constraintResults": [],
  "researchSourceIds": []
}
```

## Jev contract

TypeSafe accepts one structured `state` and a map of independent typed questions. Ask the placement questions together in one call.

Example request shape:

```json
{
  "model": "jev-latest",
  "state": {
    "schemaVersion": 1,
    "stateRevision": 42,
    "room": {},
    "placedItem": {},
    "relationships": {},
    "constraintResults": [],
    "researchEvidence": [],
    "adjustmentCandidates": {
      "keep": "Keep the item where it is",
      "move_forward_4cm": "Move the item forward by the calculated 4 cm",
      "rotate_clockwise_15deg": "Rotate the item clockwise by 15 degrees",
      "ask_user": "Request user confirmation because the spatial state is uncertain"
    }
  },
  "questions": {
    "verdict": {
      "type": "choice",
      "instructions": "Given the measured relationships, deterministic constraints, and research evidence in the state, what is the placement verdict?",
      "criteria": {
        "good": "The placement is acceptable for this visual-planning use case",
        "bad": "A supported placement problem should be corrected",
        "uncertain": "The available state is insufficient or contradictory"
      }
    },
    "primary_problem": {
      "type": "choice",
      "instructions": "Which candidate problem is the primary reason for the verdict?",
      "criteria": {
        "none": "No material placement problem",
        "circulation": "The item interferes with a walkway or activity zone",
        "boundary": "The item collides with or crosses a room boundary",
        "opening": "The item obstructs a door, window, or articulated element",
        "environment": "The item causes a light, glare, heat, draft, or ventilation issue",
        "scale_or_relationship": "The item scale or relationship to surrounding furniture is unsuitable",
        "insufficient_evidence": "The state does not support a reliable conclusion"
      }
    },
    "severity": {
      "type": "score",
      "instructions": "How strongly should the identified problem affect this visual-planning recommendation?",
      "criteria": [
        "No meaningful problem",
        "Minor aesthetic concern",
        "Functional concern worth adjusting",
        "Strong constraint conflict requiring attention"
      ]
    },
    "adjustment": {
      "type": "choice",
      "instructions": "Which option from state.adjustmentCandidates is the best next action?",
      "criteria": {
        "keep": "Use the keep candidate",
        "move_forward_4cm": "Use the calculated forward-movement candidate",
        "rotate_clockwise_15deg": "Use the calculated rotation candidate",
        "ask_user": "Request user confirmation"
      }
    },
    "requires_escalation": {
      "type": "noul",
      "instructions": "Does the state contain insufficient or conflicting evidence that requires fallback analysis or user confirmation?"
    }
  }
}
```

The response returns the selected Choice values, probability distributions, Choice/Score confidence, the numeric Score result, the Noul probability, usage, and the versioned model ID. Convex maps the selected problem and adjustment IDs back to measured evidence, citations, and display copy. Jev does not invent measurements or free-form explanations.

Rules:

- `good`, `bad`, and `uncertain` are distinct outcomes.
- A red outline is shown only for a confident `bad` result.
- An uncertain result triggers fallback analysis or user confirmation.
- Every problem references measured state or research evidence.
- Safety and manufacturer constraints outrank aesthetic preferences.
- Results are accepted only when their `stateRevision` still matches the latest room state.
- Noul returns a probability without a separate confidence field; threshold the Noul value directly.
- Choice and Score return complete probability distributions and a confidence value.
- Use one atomic judgment per question and combine the results in application code.

## State synchronization and cancellation

All frames, transforms, model jobs, and results carry the same state revision or source-frame identity.

- Moving, scaling, rotating, regenerating, or removing the item increments the revision.
- A late Jev, Lucy, research, or H3 result for an older revision is discarded.
- Provider jobs support cancellation when possible and logical cancellation otherwise.
- Retried writes and external side effects use idempotency keys.
- Only the latest valid evaluation may change the status outline.

## Decision hierarchy

When advice conflicts, use this order:

1. Hard safety requirements and applicable installation rules.
2. Manufacturer-specific clearances and operating envelopes.
3. Measured collision, boundary, and accessibility constraints.
4. Jev’s research-informed placement judgment.
5. General ergonomic and interior-design guidance.
6. Aesthetic preference and user choice.

The interface must identify which constraints are advisory and which should require explicit override.

## Convex data model

Required tables:

- `users`
- `renovationProjects`
- `rooms`
- `roomCaptures`
- `referenceImages`
- `placedItems`
- `placementEvaluations`
- `researchSources`
- `suggestionMessages`
- `savedConfigurations`
- `expertContacts`
- `handoffEmails`
- `providerJobs`

Additional tables needed by the spatial architecture:

- `perceptionSessions`: scan status, model versions, confidence, and coordinate system.
- `spatialSnapshots`: versioned room geometry and semantic state.
- `constraintResults`: deterministic and researched rule evaluations.
- `generatedSuggestions`: H3 clips and their source state revision.

Store Convex storage IDs rather than expiring file URLs. A saved configuration preserves the original capture, screenshot, room metadata, prompt, reference image, item transform, generated asset, model versions, evaluation, constraint results, citations, and creation time.

## Provider adapter configuration

Provider names, endpoint IDs, timeouts, retries, costs, and feature flags are environment-configurable. At minimum:

- `MOCK_PROVIDERS_ENABLED`
- `LUCY_MODEL_ID`
- `LUCY_TIMEOUT_MS`
- `JEV_MODEL_ID`
- `JEV_TIMEOUT_MS`
- `H3_MODEL_ID`
- `H3_TIMEOUT_MS`
- `FIRECRAWL_TIMEOUT_MS`
- `AGENTMAIL_TIMEOUT_MS`
- confidence thresholds
- evaluation throttle interval
- per-project cost ceiling

External provider calls run through Convex actions. Actions persist job state through internal mutations and never expose provider credentials to clients.

## User experience states

The camera workspace must clearly distinguish:

- Camera permission required
- Scanning room
- Confirming detected structure
- Ready to place
- Generating item
- Editing placement
- Evaluating
- Approved
- Rejected with recommended adjustment
- Uncertain and escalating
- Generating visual suggestion
- Saving
- Sending
- Recoverable failure
- Offline or provider unavailable

The initial release targets Google Chrome on the web and uses a side panel for controls and guidance. It does not include a native mobile application or Apple RoomPlan integration. Camera switching, upload fallback, reduced-motion behavior, keyboard control, and accessible control labels are required.

## Privacy and retention

- Show a privacy notice before camera access.
- No room image is used for training unless the user explicitly opts in.
- Training consent is separate from operational processing consent.
- Define retention independently for raw frames, embeddings, point clouds, generated media, saved configurations, and email attachments.
- Deleting room imagery must delete or detach derived artifacts according to the disclosed policy.
- The user previews exactly what leaves the app in an expert handoff.
- Raw-frame upload should be minimized; on-device processing is preferred where practical.

## One-day implementation scope

The one-day goal is a coherent visual-planning happy path. It is not a validated measurement-grade design or installation system.

The demo room is a living room. The placed item is intentionally interchangeable: the user may describe any item in text or provide a reference image. A sofa may be used as the seeded example, but the product flow and data model must not be hardcoded to sofas.

### Build in the first day

- Chrome-first branded camera workspace.
- Camera permission and upload fallback.
- Shared command-input flow for text descriptions and reference images.
- Editable overlay with drag, scale, and rotate.
- One guided room-scan path or a precomputed/demo spatial snapshot.
- Remote SpatialLM integration only if the GPU endpoint can be made reliable early.
- Deterministic collision and clearance checks from structured geometry.
- Jev adapter with versioned input/output.
- Lucy live session adapter.
- H3 Max Turbo suggestion adapter.
- Firecrawl research cache with a small number of authoritative citations.
- Save, reopen, before/after, screenshot, and explicit email-preview flow.
- Complete mock-provider mode for every unavailable credential or model.
- Stale-result protection, timeouts, retries, and useful error states.
- Laptop Google Chrome happy-path verification.

### Do not train on the first day

- Do not train a GRU or temporal transformer.
- Do not train a new image encoder.
- Do not claim validated centimeter-level accuracy without calibration.
- Do not block the full demo on SpatialLM GPU setup; use a versioned precomputed spatial snapshot as the fallback.

### Suggested time budget

1. Hours 1–2: camera, upload, overlay, transformation state, and branding.
2. Hours 3–4: room state, spatial snapshot, deterministic constraints, and revision system.
3. Hours 5–6: Jev contract, event-driven evaluation, and status feedback.
4. Hours 7–8: Lucy and H3 Max Turbo adapters with mock fallbacks.
5. Hours 9–10: research sources, save/gallery, before/after, and handoff preview.
6. Hours 11–12: Chrome QA, provider failures, privacy controls, deployment, and demo rehearsal.

## Success criteria for the one-day prototype

A user can:

1. Open the app in Google Chrome and immediately allow camera access or upload a room image.
2. Request an item and see it in the room.
3. Move, scale, and rotate it.
4. Receive a structured placement verdict tied to the latest state.
5. See the relevant problem, evidence, and recommended adjustment.
6. Request and view an H3 Max Turbo visual suggestion.
7. Apply an adjustment and receive a new evaluation.
8. Save and reopen the configuration.
9. Compare before and after states and download a screenshot.
10. Preview and explicitly approve an expert handoff.

The demo must remain operable in mock-provider mode.

## Later work

- Collect opted-in, room-specific interaction sequences.
- Benchmark single-frame, embedding-delta, GRU, and tiny-transformer temporal models.
- Fine-tune spatial perception for weak furniture categories.
- Add speech dictation through the shared command-input interface.
- Consider native Apple RoomPlan capture only as an optional future product direction.
- Validate measurement accuracy and ergonomic rules with qualified experts.
- Establish device-tier performance targets for latency, thermal load, battery use, and bandwidth.

## Remaining decisions

No product-scope decisions remain. Implementation still requires the provider credentials and Modal account token when live integrations begin.

## Resolved decisions

- The first implementation targets Google Chrome on the web.
- The first release is positioned as visual planning. Clearances are estimates and are not presented as installation-grade measurements.
- The demonstration uses a living room, while items remain interchangeable through text or image input. A sofa is only the default example.
- The camera experience begins immediately; room understanding develops progressively without a separate pre-scan page.
- The live demo runs on a laptop in Google Chrome. The webcam provides the live visualization; uploaded walkthrough or precomputed spatial data provides the room reconstruction.
- Jev is accessed through TypeSafe's `POST /v1/systemone` API from Convex using `jev-latest` during development.
- SpatialLM will not run locally on the current Apple M4 development computer; use a remote CUDA GPU endpoint or the precomputed fallback.
- Provider credentials will be supplied later and stored in Convex environment variables.
- Firecrawl discovers source-backed supplier and expert contact candidates.
- AgentMail sends only to the candidate the user selects and explicitly approves.
- Application records and saved configurations persist in Convex.
- Native mobile and Apple RoomPlan work are outside the initial scope.
- Because this is visual planning, every placement recommendation is advisory. Users may save after acknowledging a warning; the interface must not imply professional installation approval.
- Unsaved captures and derived transient data expire after 24 hours. Saved projects remain until the user deletes them, subject to provider-specific retention disclosed in the privacy notice.

## Free GPU compute options for SpatialLM

SpatialLM cannot run in its supported CUDA configuration on the current Apple M4 development computer. The remote service is used only to process an initial room scan or rescan; it is not called for every camera frame.

Preferred options, in order:

1. **Modal Starter — selected.** Host the SpatialLM 1.1 Qwen 0.5B inference service in a custom CUDA image, expose one authenticated web endpoint, and scale to zero between calls. Convex submits the initial room scan, records the provider job, and saves the returned spatial snapshot. Modal currently includes $30 per month of Starter compute.
2. **Lightning AI Studio** — preferred for initial setup and debugging if Modal packaging is difficult. Verified accounts currently receive free GPU hours, including T4, L4, and larger options. A Studio can host a demo/API, but free instances require periodic restarts.
3. **Hugging Face ZeroGPU** — useful for a public proof of concept. Free accounts in good standing can host ZeroGPU Gradio Spaces, but the free daily GPU quota is limited and custom SpatialLM dependencies may not be compatible with ZeroGPU's supported environment.
4. **Google Colab Free** — useful for testing SpatialLM and generating the precomputed spatial snapshot. GPU availability and session duration are not guaranteed, so it should not be the live judging endpoint.
5. **Google Cloud trial credit** — a fallback if the account qualifies and GPU access is enabled. New accounts may receive trial credit, but GPUs can be restricted until billing is upgraded, so this is not the first choice for a no-cost setup.

If none of the endpoint options is reliable by the integration checkpoint, generate one living-room spatial snapshot in Colab or Lightning and use it through the same versioned adapter. The UI and Jev flow remain identical, so moving to live SpatialLM later does not change the product architecture.

### Modal service boundary

- Modal receives a short-lived input URL or uploaded point-cloud artifact plus requested detection categories.
- The endpoint returns structured JSON for room architecture, oriented object boxes, confidence, model version, and timing.
- Convex authenticates to Modal with a server-side secret; the browser never calls Modal directly.
- Modal does not become a second database. Job status, room state, and saved results remain in Convex.
- Inputs are deleted from transient Modal storage after processing unless a debug-retention flag is explicitly enabled.
- One request ID is used across Convex and Modal for idempotency and tracing.
- Example-room visual checks are available only for the bundled example scene. Never apply its geometry to a user camera feed or uploaded room. Missing spatial evidence must produce an uncertain result.

## References

- Lucy 2.5: <https://fal.ai/lucy-2.5>
- MiniMax H3 Max Turbo image-to-video: <https://fal.ai/models/minimax/h3-max-turbo/image-to-video>
- SpatialLM: <https://github.com/manycore-research/SpatialLM>
- Function2Scene: <https://function2scene.github.io/>
- Apple RoomPlan: <https://developer.apple.com/augmented-reality/roomplan/>
- MoViNet streaming reference for later temporal experiments: <https://www.tensorflow.org/hub/tutorials/movinet>
- Modal pricing and free monthly compute: <https://modal.com/pricing>
- Lightning AI Studio: <https://lightning.ai/docs/overview/ai-studio/>
- Hugging Face ZeroGPU: <https://huggingface.co/docs/hub/spaces-zerogpu>
- Google Colab resource policy: <https://research.google.com/colaboratory/faq.html>
- TypeSafe API quick start: <https://docs.typesafe.ai/introduction/quickstart>
- TypeSafe primitives: <https://docs.typesafe.ai/primitives>
- TypeSafe confidence guidance: <https://docs.typesafe.ai/confidence>
- Official TypeSafe JavaScript SDK: <https://github.com/typesafe-ai/typesafe-sdk-js>
