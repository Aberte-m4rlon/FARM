# ALPASFARM - Livestock Farm Management System

See [SMART_GATE_DEPLOYMENT.md](SMART_GATE_DEPLOYMENT.md) for the QR-first Smart Livestock Gate and [HOSTINGER_DEPLOYMENT.md](HOSTINGER_DEPLOYMENT.md) for the existing frontend/API/ML deployment.

## Camera and QR features

- **AI Health Screening** uses the phone/tablet/computer camera on `/health-screening`. The farmer selects an animal, explicitly opens the camera, captures eight views during a guided sweep, reviews them, and sends them to the authenticated `/api/health/screen` endpoint. The server tries Gemini first and Groq if the first provider is unavailable; the result can be saved to that animal's `camera_health_screenings` history. ALPASFARM does not save the captured images to its database. Results are limited to visible observations, cannot rule out illness, and are not veterinary diagnoses.
- **CCTV Counting** stays on `/livestock-monitoring`. The Tapo gateway provides the live preview and real line-crossing events over HTTPS. It counts goat and sheep entry events separately without identifying individual animals; session totals and event timestamps are stored in PostgreSQL. Keep the camera's RTSP feed on the farm's local network.
- **Public animal QR profiles** use a random `public_qr_token`, return only approved fields, and count successful births from `breeding_birth_events`. Apply both `20261021000001_camera_screening_and_secure_public_qr.sql` and `20261021000002_gate_entry_species_metrics.sql` before using secure QR, screening history, daily gate totals, or birth counts. Regenerate existing printed QR cards because their old UUID-based URLs no longer identify an animal.

For Hostinger, set `GEMINI_API_KEY` in the server-side API environment to use Gemini for camera vision; it defaults to `gemini-3.6-flash` and can be changed with `GEMINI_VISION_MODEL`. The endpoint tries `GROQ_API_KEY` and `GROQ_VISION_MODEL` when Gemini is not configured or a Gemini request fails. Keep provider keys server-side and out of all `VITE_` variables. Apply Supabase migrations before using screening history, QR profile toggles, or public birth counts.
