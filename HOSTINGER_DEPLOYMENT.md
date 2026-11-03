# ALPASFARM on Hostinger VPS

This deployment serves the Vite frontend, the existing `/api/*` handlers, and the private goat/sheep FastAPI detector from one Hostinger VPS. Docker Compose runs four private services: Caddy handles HTTPS, Nginx serves the app and forwards API requests, Node runs the existing API handlers, and FastAPI loads the private YOLO weights. Supabase remains the app's auth/database provider.

Use a Hostinger VPS with Docker support. Shared hosting does not provide the Docker daemon and persistent Python inference process needed by this setup. Hostinger's Docker VPS template includes Docker and Docker Compose; see [Hostinger's Docker VPS guide](https://www.hostinger.com/support/8306612-how-to-use-the-docker-vps-template-at-hostinger/).

## Before starting

- Point a domain or subdomain you control to the VPS IPv4 address with a DNS `A` record.
- Allow inbound TCP ports 80 and 443 in Hostinger's firewall. Caddy obtains and renews the HTTPS certificate automatically after DNS resolves to this VPS.
- In Supabase Auth URL configuration, set the new HTTPS domain as the Site URL and add it to the allowed redirect URLs so sign-in and OAuth return to Hostinger.
- Keep detector weights private. The new goat/sheep `best.pt` belongs in `ml-server/models/active/` and is intentionally excluded from Git and Docker build context.
- Create a fresh random secret for `ML_API_SECRET`; use the same value for the Node API and the ML service through Compose.

## Configure and launch

1. Copy `deploy/hostinger/env.example` to `.env.hostinger` on the VPS. Set `ALPAS_DOMAIN`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`. Set `ML_API_SECRET` to a new long random value. For the Tapo gate flow, also set the server-only `SUPABASE_SERVICE_ROLE_KEY`, the admin `CAMERA_OWNER_USER_ID`, and a long random `CAMERA_GATEWAY_TOKEN` matching the on-farm gateway `.env`.
2. Make this prepared working tree available on the VPS. The current changes are local and uncommitted, so Hostinger's Git integration cannot get them from the public `main` branch yet; publish the reviewed source or upload the current project files first. Do not upload `.env.local`, `.env.hostinger`, any secrets, or `.venv`. After the new model is trained and reviewed, upload its `best.pt` privately to `ml-server/models/active/best.pt`; do not commit it or place it in the frontend's `public` directory.
3. From the repository root, build and start the services:

   ```sh
   docker compose --env-file .env.hostinger -f compose.hostinger.yml up -d --build
   ```

4. Check that all containers are running and that the detector reports the loaded goat/sheep model:

   ```sh
   docker compose --env-file .env.hostinger -f compose.hostinger.yml ps
   docker compose --env-file .env.hostinger -f compose.hostinger.yml logs --tail=100 api ml-server caddy
   curl -i "https://your-domain.example/api/gate/detect" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
   ```

   The last check must be made with an active signed-in user's access token; without one, HTTP 401 is the expected result. The authenticated health response should then show `model_loaded: true` and classes `goat` and `sheep`.

## Runtime and secrets

The frontend receives only the Supabase URL and public anon key at build time. The Node API and ML services stay on a private Compose network; ports 3000 and 8000 are not published to the internet. The `/api/gate/detect` handler verifies the caller's Supabase session before forwarding a frame with the server-only shared secret. The FastAPI endpoint also enforces the secret and validates the private model's exact goat/sheep classes.

The environment template includes optional keys used by existing routes: Gemini (preferred) and Groq for phone-camera visual analysis, Groq for AI chat, Semaphore or Twilio for SMS, and Resend or SendGrid for email. Set the server-side `GEMINI_API_KEY` to use Gemini for the Health Camera; it defaults to `gemini-3.6-flash`, configurable with `GEMINI_VISION_MODEL`. If Gemini is not configured or a Gemini request fails, the Health Camera tries the configured `GROQ_API_KEY` and `GROQ_VISION_MODEL` (default `qwen/qwen3.8-27b`). Provider rate limits can still temporarily prevent analysis; the API returns a retry message without exposing provider credentials. Keep all provider secrets server-side and never put them in a `VITE_*` variable. `SUPABASE_SERVICE_ROLE_KEY` is required by the Tapo gate settings, database-backed counting sessions, event saves, and camera heartbeat; keep it server-only and never put it in a `VITE_*` variable. Until `ml-server/models/active/best.pt` is present, the app reports the goat/sheep gate detector as unavailable and livestock inference returns an unavailable response.

Apply the pending Supabase migrations before enabling new records and camera features, including `20261021000001_camera_screening_and_secure_public_qr.sql`, `20261021000002_gate_entry_species_metrics.sql`, `20261101060000_persistent_camera_gate_monitoring.sql`, `20261101070000_camera_counting_sessions.sql`, and `20261101080000_camera_species_only_counting.sql`. The latest migration preserves old identity-based camera records in private legacy tables and moves active CCTV counting to species-only entry totals with database timestamps. It removes individual-animal matching from the active counting flow and records completion, incomplete-count, and camera-offline notifications. Public QR cards must be reprinted after the token migration because existing printed links contain the old database-ID format. The on-farm gateway must remain on the same LAN as the Tapo camera and post its feed to the HTTPS API; a VPS cannot initiate RTSP access into a private farm Wi-Fi network.

To update the app after a code change, pull the desired commit on the VPS and rerun the Compose build command. For a model update, upload the reviewed candidate to `ml-server/models/active/best.pt` and set `YOLO_MODEL_VERSION` in `.env.hostinger`. `YOLO_SPECIES_MODEL_DIR` chooses the private host folder and `YOLO_SPECIES_MODEL_PATH` chooses the checkpoint path inside the ML container. Recreate the detector so it uses the new weights and configuration:

```sh
docker compose --env-file .env.hostinger -f compose.hostinger.yml up -d --force-recreate ml-server
```

Confirm the model version and SHA through the detector health endpoint, then test the actual camera with labeled animal and empty-gate footage. A successful model load does not establish field-camera accuracy; do not rely on scans for movements until those farm-camera checks pass.
