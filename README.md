# Roomie

A Chrome-first room-planning studio using the supplied burgundy wrench branding. Built with React, TypeScript, vinext, shadcn UI, and a Convex backend.

## Run

```sh
npm install
npm run dev
```

The local preview uses the URL printed by Vite (currently `http://localhost:5173`). `.env.local` contains the development Convex deployment; it is ignored by Git. The public development endpoint is also the client fallback. Set `NEXT_PUBLIC_CONVEX_URL` at build time to use a different deployment. This URL is public configuration, never a provider secret.

```sh
npx convex dev
npm run test
npm run typecheck
npm run build
```

## Implemented

- Branded desktop studio; camera request on opening, photo fallback, example living room, camera selection and privacy controls.
- Voice-first furniture descriptions with interchangeable uploaded references and labeled placeholders when Lucy cannot start.
- Lucy receives short visual placement prompts instead of raw coordinates, waits for the generated stream to settle before Jev captures it, and labels the realtime result as a quick preview. H3 remains the polished suggestion output.
- Pointer and keyboard placement, size, rotation, reset, remove, before/after, snapshot download and system share (download fallback).
- Conservative image-space placement checks. The example sofa mask applies only to the example scene. Real rooms never inherit its geometry.
- Private anonymous Convex sessions, bounded gallery, full configuration persistence, file ownership checks, image deletion, and 24-hour transient-data cleanup.
- Provider actions for TypeSafe Jev, fal H3 Max Turbo, Firecrawl research/contacts, direct Decart Lucy client tokens, and a reviewed AgentMail handoff.
- Revision-bound jobs, per-session hourly limits, cancellation, idempotent saves/email claims, scheduled queue polling, timeouts, and stale-result rejection.
- Research citations and source-backed recipient selection when Firecrawl is connected. No invented contact emails.
- Exact screenshot/message/recipient preview and explicit send approval. Email is not sent in preview mode. Ambiguous delivery is not automatically retried.
- WebMCP tools for reading and editing the same visible placement. No tool sends an email or exposes camera images.
- Mobile-first **Scan this room** flow with camera permission, a fixed 30-second walkthrough with automatic stop, direct Convex upload, live upload/reconstruction/analysis status, and retry, replacement, and deletion controls.
- Warm Modal L4 workers sample 30 uniformly spaced 640 px frames, reconstruct a 120,000-point `.ply` with balanced SLAM3R settings, run a persistently loaded SpatialLM model, delete successful source video, and save a compact owner-scoped room snapshot with timing metadata in Convex.
- Jev traffic-light visual-fit guidance (`green`, `amber`, or `red`) with confidence and concise explanations. Every scan-derived result is labeled as a visual estimate.

## Connect the services

Provider secrets belong **only in Convex environment variables**, never in `.env` values prefixed `NEXT_PUBLIC_` and never in browser code. Use the Convex dashboard for the `roomie` project to add:

| Variable              | Purpose                                         |
| --------------------- | ----------------------------------------------- |
| `TYPESAFE_API_KEY`    | Jev typed decisions via `/v1/systemone`         |
| `JEV_MODEL`           | Optional pinned model; defaults to `jev-latest` |
| `DECART_API_KEY`      | Direct Decart Lucy 2.5 realtime video editing   |
| `FAL_KEY`             | `minimax/h3-max-turbo/image-to-video`           |
| `FIRECRAWL_API_KEY`   | Research and public contact discovery           |
| `AGENTMAIL_API_KEY`   | Explicitly approved email handoffs              |
| `AGENTMAIL_INBOX_ID`  | Sending inbox                                   |
| `MODAL_SPATIAL_URL`   | Modal API URL                                   |
| `MODAL_SPATIAL_TOKEN` | Shared Modal bearer secret                      |

Reload the studio after adding credentials. A “Connected” indicator means the corresponding variables exist; it is not a successful live-provider smoke test. Modal is verified at the infrastructure level: its authenticated API, NVIDIA L4 CUDA runtime, SpatialLM runtime, and SLAM3R import all passed smoke checks. A full real-room walkthrough inference is still pending. Roomie first starts Lucy through Decart’s official SDK with a short-lived client token minted by Convex. If that session fails, the live view falls back to labeled placeholders and offers **Retry real Lucy**.

Convex anonymous auth uses `JWT_PRIVATE_KEY`, `JWKS`, and `SITE_URL`, already configured on the current development deployment. A separate production deployment requires its own keys and deployment. The current preview intentionally uses the hackathon development backend.

See [Modal setup](modal/README.md) for the prepared CUDA service.

## Current boundaries

### Room understanding → Jev → Lucy

The studio persists an owner-scoped, versioned scene in Convex. It combines a SpatialLM snapshot with the user's intended Lucy object description and screen-space placement. **Scan this room** records exactly 30 seconds and stops automatically, uploads the walkthrough to private Convex storage, samples at most 30 uniformly distributed frames, reconstructs a `.ply` with SLAM3R on Modal, and runs SpatialLM. The successful video and temporary `.ply` are deleted while the compact snapshot remains linked to the room. Failed source videos expire within 24 hours and can be retried, replaced, or deleted. Advanced users can still attach a completed PLY or import a SpatialLM JSON snapshot in Settings.

Convex loads the scene server-side when evaluating with Jev. Jev receives the structured room, provenance, requested item, visual constraints, and supplied candidate adjustments, then returns green, amber, or red visual-fit guidance with confidence. Application code supplies the short explanation and explicit visual-estimate caveat. Apply suggested placement updates the same state used to construct Lucy prompts. Results are revision-bound on both client and server. Local guidance uses the same snapshot when Jev credentials are unavailable. Saved rooms embed the snapshot so it survives transient job cleanup; opening a different camera/photo clears it, and reopening a saved room restores its own snapshot.

Imported and current Modal snapshots do not establish camera alignment or metric scale. These flags remain false; Lucy output observation remains false. Room geometry informs Jev but does not verify generated pixels, dimensions, clearance, collision, or physical fit. Camera registration and sampling Lucy output for perception remain follow-up phases.

- The scene-state iteration was smoke-tested against live Jev (`jev-1.13.0`) with an explicitly synthetic imported room fixture. A live browser smoke test also opened a Decart Lucy session for an exact white-bookshelf request and passed its output to Jev. Firecrawl research and real point-cloud inference have not been verified in this iteration. AgentMail remains unconfigured. No email was sent.
- In a live camera view, Roomie attempts real Lucy first. If it cannot open the realtime session, every requested description or uploaded reference remains available as a draggable placeholder. It never substitutes a stock chair, and **Retry real Lucy** can replace the fallback after credits are available.
- Placement transforms are normalized 2D image coordinates and in-plane rotation, not 3D world poses. The fallback guidance is an image-space demonstration, not a complete Function2Scene constraint engine.
- Modal deployment is active and its private GPU probe verified an NVIDIA L4, CUDA, PyTorch, and the baked SLAM3R runtime. Walkthrough-to-point-cloud reconstruction is implemented. A full real-room walkthrough still needs live browser QA. Camera alignment, depth/occlusion tracking, and calibrated 3D collision/clearance checks are not implemented.
- Anonymous cloud saves belong to the guest session in that browser. Clearing browser data loses access; there is no cross-device account recovery in this prototype. Download important views.
- Unsaved cloud files and jobs are cleaned up after about 24 hours, on a 30-minute cleanup schedule. Saved room files persist until deletion. Provider-side retention follows provider policies.
- Email ambiguity is kept as `uncertain`; check the sending inbox before initiating another handoff.

## Validation

Automated tests cover private data access, foreign asset rejection, full-transform persistence, idempotent saves, deletion/retention, email claim ownership, duplicate email approvals, stale-job cancellation, scene revision ordering, snapshot ownership/view binding, optional scan performance metadata, persistence after cleanup, and room evidence reaching the Jev adapter. TypeScript, the production build, Convex deployment, and Modal CUDA/SLAM3R health checks pass. The automated Jev-to-Lucy test mocks the provider response. A full 30-second real-room browser scan remains the final manual validation; this does not claim physical fit or validate Lucy's generated placement.

No training or fine-tuning is needed or performed.
