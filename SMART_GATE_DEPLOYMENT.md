# Smart Gate deployment notes

## Project mapping

AlpasFarm is a React 18, TypeScript, and Vite single-page app using Supabase Auth and PostgreSQL. The existing `animals` records keep their permanent `id` and internal `tag_id`; the additive eartag migration adds a farm-scoped numeric `eartag_number`. Camera identification resolves that number to the existing active animal row. Existing QR cards and historic QR camera records are retained for compatibility.

The Smart Gate is available at `/livestock-monitoring` to the existing farm roles. Its additive Supabase migrations extend the existing schema without replacing animal records or the authentication flow.

## Gate flow and identity boundary

- The camera can detect several goats and sheep in one frame. The ML service tries digits-only OCR in the upper head/tag area of each animal box; the same complete number must appear across three frames for that track before the farm-scoped resolver can identify an animal. Ambiguous or unknown numbers stay unassigned. QR remains a legacy compatibility path.
- The camera sends a resized JPEG frame about once per second to the same-origin `/api/gate/detect` route. That route checks the Supabase access token, then forwards the image to FastAPI using the server-only `ML_API_SECRET`. Neither the key nor the weights enter the browser bundle.
- FastAPI loads the configured private YOLO weights only if their metadata contains exactly `goat` and `sheep`. There is no ONNX, MobileNet, random-weight, or simulated fallback in the gate flow.
- YOLO reports species and bounding boxes. Short-lived tracker IDs follow animals within the camera view. The configured crossing direction determines entry or exit; the crossing aid is not drawn over the farmer-facing camera view.
- Anonymous camera crossings and fresh live tracks are stored separately from animal identity. Temporary track IDs are never animal foreign keys. Live track rows are refreshed periodically, are shown only while their heartbeat is recent, and are cleared when monitoring ends or the camera stops.
- Eartag-number verification is bound to one temporary track, monitoring session, active farm, and detected species. Spatial association prevents a reading from being copied to a neighboring animal. The database resolves exact numbers within the authenticated farm and will not create an animal for an unknown number.
- A saved eartag movement requires the matching track, matching species, a multi-frame verified number, and an observed crossing. Multiple animal tracks may be present; identified events stay bound to their own permanent animal row in PostgreSQL. Existing QR-only events remain readable.
- Eartag movement writes use authenticated RPCs with farm/session/species checks and duplicate protection. Entry and exit totals update only after persistence succeeds. A later verified entry resolves an earlier unaccounted alert for that same animal.
- Sessions snapshot the active herd and use a selected reconciliation window. The database summary computes confirmed identities, current inside animals, and unaccounted IDs from the full event history; the page's recent-event list is only a display list.
- Finishing reconciliation creates “Needs verification” alerts for active expected animals not currently verified inside. Sold, deceased, transferred, and archived animals are excluded. This is not a permanent lost-animal status. Caretakers can acknowledge or resolve alerts, and a later verified entry resolves active unaccounted alerts automatically.
- Dashboard, reports, animal profiles, and the AI Farm Assistant read the same farm-scoped saved sessions, crossings, verified movements, and alerts. The dashboard's live count uses recent database heartbeats; it does not infer an animal identity from a temporary track.
- Sound is muted by default. A user can unmute it or test it after interacting with the page. One short tone plays for a new active alert; visual alerts remain available while muted.

## Previous model artifact (retired)

The previous weight file was found in the adjacent main checkout on this machine:

`C:\Users\asiva\Downloads\capstone-master\capstone-master\ml-server\models\best.pt`

Its checkpoint metadata identifies `yolo11n.yaml`, the classes `goat` and `sheep`, and the `AlpasFarm_GoatSheep_V1` training run. A copy was previously stored at `ml-server/models/best.pt`; it is no longer selected by the app. The new runtime path is `ml-server/models/active/best.pt` and remains unavailable until the replacement is installed. The service fails closed if that file is absent or reports different classes.

Historical local inference was verified through the FastAPI detection endpoint using the previous weights and checked-in goat/sheep side-view images. These sample-image results do not describe the new model or prove field-camera accuracy.

## Tapo C320WS feed status

The RTSP gateway code and AWS service definition are present, but the production service is intentionally disabled. The farm-to-EC2 private route is not configured and the gateway checkpoint is not installed at `/var/lib/alpasfarm-camera-gateway/models/best.pt`. Do not enter RTSP credentials in the browser or expose camera port 554 publicly. The AWS path cannot be treated as live until the secure route, model file, and actual Tapo stream are verified.

## Supabase migrations

The initial Smart Gate schema and first hardening migration were applied in the Supabase SQL Editor on 2026-10-03 and verified against the existing AlpasFarm project:

1. `supabase/migrations/20261002153000_create_smart_gate_monitoring.sql`
2. `supabase/migrations/20261003000001_harden_smart_gate_summary.sql`

They create the gate devices, sessions, events, one-use QR verifications, and alerts; enable owner-scoped RLS; and expose authenticated RPCs for writes, reconciliation, and session summaries. The five initial gate tables and authenticated session RPCs were verified after application. The latest migration was subsequently applied by the project owner and its new tables, RPCs, and animal history column were verified in the production Supabase project on 2026-10-03:

3. `supabase/migrations/20261003000002_camera_gate_tracking_history.sql`

It adds gate line configuration, camera crossing history, short-lived live-track rows, movement observations, animal last-seen timestamps, farm-owner read policies, and secured write RPCs. The migration is now present in production; older frontend deployments still will not use the new camera-gate flow.

4. `supabase/migrations/20261005000001_simultaneous_gate_qr_identification.sql`

This new migration binds one-use QR proofs and saved movement events to a camera track, records the last gate at which an animal was identified, and logs successful QR identification in the Camera activity history. Apply it to Supabase before deploying the matching frontend/API changes. Its production application and the Tapo live-camera workflow have not been verified yet.

The numbered-eartag migrations (`20261013000001_animals_eartag_number.sql` and `20261013000002_primary_eartag_ocr.sql`) are an additional schema change for this checkout. Their production application has not been verified; apply and verify them before deploying the matching frontend/API code.

## Environment variables

| Where | Variable | Purpose |
|---|---|---|
| Vercel frontend | `VITE_SUPABASE_URL` | Existing Supabase project URL |
| Vercel frontend | `VITE_SUPABASE_ANON_KEY` | Existing public Supabase anon key |
| Vercel server only | `ML_BACKEND_URL` | Base URL of the private FastAPI host |
| Vercel server only | `ML_API_SECRET` | Shared server-to-server secret; must equal `SPECIES_API_KEY` on FastAPI |
| Vercel server only | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Supabase values used to verify access tokens; `VITE_*` values are accepted as fallbacks |
| Vercel server only | `SUPABASE_SERVICE_ROLE_KEY` | Optional existing server credential; keep it server-only and never use a `VITE_` prefix |
| Vercel server only | `GROQ_API_KEY` | Required by the existing `/api/ai/chat` route; the current production deployment logs show it is missing |
| Vercel server only | `ALLOWED_FRONTEND_ORIGINS` | Comma-separated exact browser origins |
| Vercel server only | `ML_MAX_IMAGE_BYTES` | Optional upload cap; defaults to 10 MiB |
| Python host | `SPECIES_API_KEY` | The same private value configured as `ML_API_SECRET` on Vercel |
| Python host | `YOLO_SPECIES_MODEL_PATH` | Private mounted path to the new `models/active/best.pt` |
| Python host | `YOLO_MODEL_VERSION` | Version label returned with detections and diagnostics |
| Python host | `ALLOWED_ORIGINS` | Comma-separated exact frontend origins; no wildcard |
| Python host | `MAX_IMAGE_BYTES`, `MAX_IMAGE_PIXELS` | Optional upload and image-dimension limits |
| Python host | `YOLO_CONFIDENCE_THRESHOLD` | Optional confidence threshold; defaults to 0.60 |

Never put `ML_API_SECRET`, `SPECIES_API_KEY`, or `SUPABASE_SERVICE_ROLE_KEY` in a `VITE_*` variable. The browser calls only the authenticated Vercel proxy.

## Local run

For the FastAPI service, use Python 3.10 or later and install `ml-server/requirements.txt`. Configure a unique local `SPECIES_API_KEY`, set `YOLO_SPECIES_MODEL_PATH` to `models/active/best.pt`, and run the service from `ml-server` after the new model is ready:

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

For the Vite development server, put local-only values in the ignored `.env.local`: the existing Supabase URL and anon key, `ML_BACKEND_URL=http://127.0.0.1:8000`, the matching `ML_API_SECRET`, and `ALLOWED_FRONTEND_ORIGINS=http://localhost:5173`. The development API handler reads the private values server-side. Restart Vite after changing them.

## Deploy

1. For the full Hostinger VPS deployment (frontend, existing API routes, and private ML backend), follow [HOSTINGER_DEPLOYMENT.md](HOSTINGER_DEPLOYMENT.md). Keep the new `best.pt` private and supply the same `ML_API_SECRET` through the Hostinger Compose environment.
2. Apply `20261005000001_simultaneous_gate_qr_identification.sql` in Supabase before using the new simultaneous identity flow. The previous three Smart Gate schema migrations are documented above.
3. Set the Vercel frontend variables and the private detector-host variables below. The model backend must be deployed to an HTTPS host that contains the private weights; the repository ignores the model file, so a Git deployment alone does not include it.
4. Sign in with a farm account, start a short session, verify a registered QR, confirm a test movement, and finish reconciliation after the selected window.

The `alpasfarm` Vercel project is connected to the `Aberte-m4rlon/ALPASFARM` GitHub repository and deploys `main`. The last recorded production deployment is from commit `0c59176` and does not include this workspace's changes. The production AI route was reported without `GROQ_API_KEY`; recheck it in Vercel before deployment. Production Smart Gate use still requires an HTTPS-hosted model backend with the private weights and matching server-only API secrets.

## Current external access status

The ignored `.env.local` is for development only and points the server-side detector proxy at a loopback service. Production must use an HTTPS `ML_BACKEND_URL`; the Smart Gate API rejects loopback detector URLs in production. The new frontend commit has not been pushed or deployed, and no Vercel environment settings were changed. Keep `ML_API_SECRET`, `SPECIES_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `GROQ_API_KEY` server-only; never copy them into a `VITE_*` setting. The production Supabase migration is verified, but the production ML endpoint is not configured.

## Verification

The existing gate-domain suite now has 18 identity, tracking, crossing, movement-observation, debounce, return/re-scan, and simultaneous QR-association tests. In this update, the frontend production build and all 18 gate-domain tests pass, and Python syntax compilation passes. The ML unit tests could not start because OpenCV (`cv2`) is not installed in the available Python runtime. The QR decoder and multi-animal association have not been exercised against Tapo footage; the new migration has not been applied to production. A successful build does not verify a real gate feed.
