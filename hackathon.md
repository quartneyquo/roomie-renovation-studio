# Hackathon log

- **Project:** Roomie
- **Event:** Convex All Gas Hackathon
- **What it does:** A voice-first room-planning studio that previews multi-furniture layouts in a live room view and gives visual-fit guidance informed by room scans.
- **Live app:** https://roomie-renovation-studio.courtneythko.chatgpt.site/
- **Repo:** https://github.com/quartneyquo/roomie-renovation-studio
- **Frontend:** Codex Sites
- **Convex deployment:** https://fleet-cheetah-120.convex.cloud
- **Components:** none
- **Convex features:** schema, tables, indexes, queries, mutations, actions, scheduled functions, crons, file storage, realtime queries, HTTP router
- **Auth:** Convex Auth
- **AI models:** lucy-2.5, jev-latest, google/gemini-3.8-flash, minimax/h3-max-turbo/image-to-video, SpatialLM
- **Started:** 2026-09-21T07:52:12Z
- **Last updated:** 2026-09-22T06:17:49Z

## Log

### 2026-09-21 - 753a2e4
Built the first Roomie studio with camera and image room inputs, draggable furniture placement, visual-fit feedback, private anonymous saves, uploaded assets, provider jobs, and reviewed email handoffs. Convex features: schema, indexes, queries, mutations, actions, file storage, realtime queries, scheduled functions, and crons (`convex/schema.ts`, `convex/rooms.ts`, `convex/jobs.ts`, `convex/providers.ts`, `components/studio.tsx`).

### 2026-09-21 - 1cab451
Added owner-scoped, revisioned scene state so SpatialLM room snapshots, Jev decisions, and Lucy placement prompts use the same current room evidence. Saved rooms retain their spatial snapshot and restore it with the layout (`convex/scenes.ts`, `convex/rooms.ts`, `lib/scene.ts`).

### 2026-09-21 - e1ac527
Deployed the Modal L4 reconstruction service and added a guided mobile room scan. Walkthrough video uploads to Convex storage, runs through SLAM3R and SpatialLM, and saves a compact room snapshot with retry, replacement, deletion, and cleanup states (`modal/spatial_service.py`, `convex/scans.ts`, `convex/providers.ts`, `components/studio.tsx`).

### 2026-09-22 - 84ec923
Improved Lucy realtime recovery and provider error reporting, then required observed Lucy output before Jev can approve a live placement. Jev returns green, amber, or red visual estimates with a concise reason and confidence (`lib/lucy.ts`, `convex/providers.ts`, `components/studio.tsx`).

### 2026-09-22 - 13862b1
Added multi-furniture planning for up to eight pieces. The canvas shows the complete layout while Lucy and Jev focus on the selected item, and Convex persists every item's prompt, reference, position, scale, and rotation with compatibility for earlier single-item saves (`convex/schema.ts`, `convex/rooms.ts`, `lib/scene.ts`, `components/studio.tsx`).

### 2026-09-22 - 60c2673
Removed automatic placeholder furniture and normalized malformed scan geometry so a scan cannot invent an implausible wall count. Text-only requests now wait for Lucy instead of displaying a fallback chair (`convex/providers.ts`, `lib/scene.ts`, `components/studio.tsx`).

### 2026-09-22 - 2654eef
Replaced furniture text entry with an eight-second microphone flow. Audio is encoded as PCM WAV, transcribed through the configured Gemini Flash model, and immediately added as the active item while the rest of the Lucy layout remains present (`convex/providers.ts`, `components/studio.tsx`).

### 2026-09-22 - 870beef
Shortened the guided room walkthrough from 30–60 seconds to 10–15 seconds and reduced reconstruction sampling to match. The frontend, provider timeout messaging, Modal worker, automated tests, typecheck, and production build were updated and verified (`components/studio.tsx`, `convex/providers.ts`, `modal/spatial_service.py`).
