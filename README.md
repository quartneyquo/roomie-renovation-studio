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
- Text instruction and interchangeable uploaded image reference; transparent example chair supplied for offline demos.
- Pointer and keyboard placement, size, rotation, reset, remove, before/after, snapshot download and system share (download fallback).
- Conservative image-space placement checks. The example sofa mask applies only to the example scene. Real rooms never inherit its geometry.
- Private anonymous Convex sessions, bounded gallery, full configuration persistence, file ownership checks, image deletion, and 24-hour transient-data cleanup.
- Provider actions for TypeSafe Jev, fal H3 Max Turbo, Firecrawl research/contacts, scoped Lucy signaling tokens, and a reviewed AgentMail handoff.
- Revision-bound jobs, per-session hourly limits, cancellation, idempotent saves/email claims, scheduled queue polling, timeouts, and stale-result rejection.
- Research citations and source-backed recipient selection when Firecrawl is connected. No invented contact emails.
- Exact screenshot/message/recipient preview and explicit send approval. Email is not sent in preview mode. Ambiguous delivery is not automatically retried.
- WebMCP tools for reading and editing the same visible placement. No tool sends an email or exposes camera images.

## Connect the services

Provider secrets belong **only in Convex environment variables**, never in `.env` values prefixed `NEXT_PUBLIC_` and never in browser code. Use the Convex dashboard for the `roomie` project to add:

| Variable | Purpose |
| --- | --- |
| `TYPESAFE_API_KEY` | Jev typed decisions via `/v1/systemone` |
| `JEV_MODEL` | Optional pinned model; defaults to `jev-latest` |
| `FAL_KEY` | Lucy 2.5 and `minimax/h3-max-turbo/image-to-video` |
| `FIRECRAWL_API_KEY` | Research and public contact discovery |
| `AGENTMAIL_API_KEY` | Explicitly approved email handoffs |
| `AGENTMAIL_INBOX_ID` | Sending inbox |
| `MODAL_SPATIAL_URL` | Modal API URL |
| `MODAL_SPATIAL_TOKEN` | Shared Modal bearer secret |

Reload the studio after adding credentials. A “Connected” indicator means the corresponding variables exist; it is not a successful live-provider smoke test. All live provider calls still need credential-backed verification. In particular, Lucy's WebRTC signaling adapter is provisional until tested against an authorized session.

Convex anonymous auth uses `JWT_PRIVATE_KEY`, `JWKS`, and `SITE_URL`, already configured on the current development deployment. A separate production deployment requires its own keys and deployment. The current preview intentionally uses the hackathon development backend.

See [Modal setup](modal/README.md) for the prepared CUDA service.

## Current boundaries

- **No provider credentials were available during implementation.** No real Lucy output, Jev decision, H3 video, Firecrawl search, or AgentMail email was claimed or sent. Mock behavior is labeled in the UI.
- Text-only arbitrary object generation requires Lucy and a live camera. Without that service, the preview uses the example chair or the user's reference image; it does not pretend the chair was generated from an arbitrary prompt.
- Placement transforms are normalized 2D image coordinates and in-plane rotation, not 3D world poses. The fallback guidance is an image-space demonstration, not a complete Function2Scene constraint engine.
- Modal deployment and GPU inference are pending account credentials. Point-cloud input is supported by the adapter. Walkthrough-to-point-cloud reconstruction, camera alignment, depth/occlusion tracking, and calibrated 3D collision/clearance checks are not implemented. Scan results cannot be applied to arbitrary webcam views without alignment.
- Anonymous cloud saves belong to the guest session in that browser. Clearing browser data loses access; there is no cross-device account recovery in this prototype. Download important views.
- Unsaved cloud files and jobs are cleaned up after about 24 hours, on a 30-minute cleanup schedule. Saved room files persist until deletion. Provider-side retention follows provider policies.
- Email ambiguity is kept as `uncertain`; check the sending inbox before initiating another handoff.

## Validation

Nine automated tests cover private data access, foreign asset rejection, full-transform persistence, idempotent saves, deletion/retention, email claim ownership, duplicate email approvals, stale-job cancellation, and conservative real-room evaluation. Browser QA covers placement, adjustment, applying suggestions, before/after, actual cloud save and reopen, and the reviewed email preview. WebMCP valid and invalid inputs were exercised against the live preview.

No training or fine-tuning is needed or performed.
