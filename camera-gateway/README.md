# ALPASFARM camera gateway

The designated on-farm Windows laptop can run the gateway when it stays awake
and remains on the same LAN as the Tapo camera. It connects directly to the
camera and does not act as a subnet router. A cloud-hosted gateway still needs
an approved private route to the camera.

The CCTV preview opens automatically on the counting page. When Roboflow is
configured, it detects goat/sheep boxes asynchronously and OpenCV maintains
tracks between detector updates and confirms observed gate-line crossings.
Without any ML configuration the gateway retains the pure OpenCV mode. If a
Roboflow setting is present but the key, SDK, or service is unavailable, the
counter fails closed and does not create new animal boxes from motion alone.
PostgreSQL records confirmed events with server-generated timestamps. Tracker
IDs are temporary and are never treated as animal IDs.

Camera preview and count paths are independent:

```text
Tapo C320WS -- RTSP --> Existing Python Gateway --> Roboflow detections + OpenCV tracking/crossing validation --> count API --> PostgreSQL
                                  └--> latest-frame preview uploader --> ALPASFARM live view
```

The camera must keep its private LAN address. Do not port-forward RTSP/554 or
put camera credentials, an RTSP URL, or the gateway token in browser code. The
gateway uses RTSP-over-TCP and sends the preview, detections, and pending
crossing events directly to the authenticated ALPASFARM API over HTTPS.
Reserve the camera's current IP in the router and set `CAMERA_IP` in
`camera-gateway/.env` to that address. A different MAC in the PC's ARP table
can be caused by router proxy ARP, so it is a warning to verify the router's
DHCP/ARP mapping, not proof by itself that the configured IP is wrong. If
diagnostics report the camera as unreachable, verify the DHCP lease/MAC, that
RTSP and the camera account are enabled in the Tapo app, and that the PC and
camera are on the same non-isolated LAN/VLAN. A Wi-Fi or Ethernet connection
alone does not guarantee that RTSP port 554 is reachable.
Camera discovery follows the operating system's route to `CAMERA_IP`, so a
wired Ethernet route to the camera is selected even when the internet default
route uses another adapter. The gateway logs the local interface address used
for the camera route.

Preview and counting use separate workers. OpenCV continues to analyze camera
frames and validate crossings if preview uploads are delayed or refused.
Preview is limited to the latest decoded frame
at `CAMERA_PREVIEW_UPLOAD_FPS` (default `15`, maximum `15`); it does not queue
old frames. The uploader targets one frame every 67 ms; the token-authenticated
endpoint rate-limits bursts under 50 ms and sends a millisecond retry hint on
HTTP 429. The preview worker uses
that precise hint and keeps retrying the latest frame. It logs upload/skipped-
frame metrics once per minute. Database camera heartbeats are coalesced to one
write every 15 seconds instead of one write per preview frame.
A preview error never restarts RTSP or pauses counting.
Inference uses a one-frame bounded queue and replaces a pending frame with the
newest decoded image when processing falls behind. Each queued frame carries its
enqueue time so the local gateway log can report queue and capture-to-result
delay instead of hiding stale-frame latency.

Roboflow inference runs in a dedicated worker using the official `inference-sdk`
client and header-based key authentication. The default model is
`animal-detect-8sepq/2`; configure `ROBOFLOW_API_KEY` only in the gateway's
local `.env`, never in frontend code or this example file. The worker submits
at most one latest frame per configured interval (default one second), uses a
bounded request timeout, and reports call count, measured latency, returned
class labels, failures, and dropped frames in the local gateway log. Hosted
inference usage depends on the account/model plan; the gateway reports calls
without guessing a per-call price. Confidence starts at `0.50` and should be
validated against recordings from this camera before tuning. The fixed upper-
right Tapo beam exclusion remains active.

The gateway defaults to six analysis frames per second and allows up to fifteen,
matching the camera input rate, at a maximum 960-pixel frame edge. The OpenCV
counter combines MOG2 foreground extraction with multi-frame thresholded
differencing so small X/Y motion can build evidence across multiple frames. A
common-mode luminance delta is removed before frame differencing;
MOG2 shadow pixels and chromaticity-preserving luminance changes are excluded
from the subtle-motion mask. Abrupt/global exposure changes temporarily
rebaseline the background without turning those frames into motion candidates.
The tracker uses lower per-frame displacement and accumulated movement thresholds,
and adapts box smoothing to measured two-dimensional velocity: slower movement is
smoothed more, while fast movement and sharp turns favor the newest observed box.
Track association predicts a short, bounded centroid displacement and expands its
distance gate with measured speed; box-size mismatch contributes a penalty to
reduce accidental reassociation. Confirmed tracks keep their ID and current box
through stationary observations, and slow or stopped observations continue to
refresh their side of the gate line. During a missing detection, the displayed box
uses at most 0.5 seconds of bounded motion prediction, then holds the last reliable
position for the occlusion grace period. The track can be reacquired until its
longer timeout; a predicted box is never used as crossing evidence. Crossing events
still require observed positions on both stable sides of the line. Failed count/event uploads
back off while confirmed crossings remain in the durable local outbox. Motion thresholds
and track timing are configurable with the `CAMERA_MOTION_*`,
`CAMERA_FRAME_DIFF_THRESHOLD`, `CAMERA_FRAME_DIFF_HISTORY`,
`CAMERA_FRAME_DIFF_MIN_HITS`, `CAMERA_MIN_CONTOUR_AREA`, `CAMERA_MAX_TRACKING_DISTANCE`,
`CAMERA_BOX_SMOOTHING`, `CAMERA_BOX_MAX_SMOOTHING`,
`CAMERA_TRACK_SLOW_SPEED_PX_S`, `CAMERA_TRACK_FAST_SPEED_PX_S`,
`CAMERA_TRACK_MAX_DISTANCE_MULTIPLIER`, `CAMERA_TRACK_TIMEOUT_SECONDS`,
`CAMERA_OCCLUSION_GRACE_SECONDS`, `CAMERA_CANDIDATE_TIMEOUT_SECONDS`, and
`CAMERA_STATIONARY_GRACE_SECONDS`, `CAMERA_TRACK_TEMPLATE_INTERVAL_SECONDS`,
`CAMERA_TRACK_TEMPLATE_MIN_SCORE`, and `CAMERA_TRACK_TEMPLATE_MIN_TEXTURE` settings
in `.env`. Defaults are starting
values; validate and tune them against recordings from the installed camera view.
The gateway reports decoded camera FPS, analysis FPS, inference-queue delay, and
capture-to-result delay in its local log. Developer-only track diagnostics include
X/Y velocity, smoothing factor, and observed-to-box lag in pixels. These are
measurements, not guarantees of target-hardware performance.

For local developer diagnostics, set `CAMERA_GATEWAY_DEBUG=1`. The gateway
writes the source frame, raw and filtered motion masks, rejected motion regions,
active OpenCV tracks, and JSON diagnostics under `state/motion-debug/` on a
one-second cadence. These files stay local and are not uploaded to farmer accounts.
Set `CAMERA_GATEWAY_DEBUG=0` to disable debug output.

Only one gateway process may own the camera at a time. If a distinct
`CAMERA_FALLBACK_STREAM_PATH` is configured and the primary stream fails, the
worker tries the fallback and retries the primary after
`RTSP_PRIMARY_RETRY_SECONDS` (default `300`). With no distinct fallback, it
retries only the configured primary stream with a growing delay; it does not
log or reconnect to the same path as an alternate.

For local development, start Vite and wait until `http://127.0.0.1:5173/`
responds before starting the gateway. The Windows `start.bat` launcher enforces
this order so the initial gateway heartbeat does not race Vite startup.

For a localhost-only replay, configure the gateway process with the local Vite
API URL, `CAMERA_HYBRID_TEST_ONLY=1`, and an optional `CAMERA_TEST_VIDEO_PATH`
pointing to a saved CCTV clip. The replay can be bounded with
`CAMERA_TEST_VIDEO_START_SECONDS` and `CAMERA_TEST_VIDEO_DURATION_SECONDS`.
The gateway refuses non-loopback API targets in this mode. Preview and current
counts remain in the local app's memory; crossings, settings acknowledgements,
database heartbeats, and recording uploads are disabled. A separate local
crossing outbox and recording-state directory are used automatically. The
production `.env` and live RTSP camera remain untouched.

## EC2 gateway prerequisites (cloud-hosted option)

For an on-farm laptop on the same LAN as the Tapo camera, a VPN route is not
needed. The remaining checks in this section apply when the gateway runs on
EC2 instead.

- EC2 host: `ap-southeast-1`, existing ALPASFARM instance.
- Current Tapo app snapshot: wired camera `10.20.5.137`, MAC
  `60-15-6F-20-4A-F0`, model C320WS. The configured `CAMERA_IP` and
  `CAMERA_MAC` match that snapshot. However, the Windows gateway PC
  (`10.20.20.177/19`) resolves `10.20.5.137` to MAC `DC-2C-6E-3B-E3-BD`,
  including after its local neighbor entry is removed, and cannot connect to
  TCP port 554. This discrepancy must be resolved in the router's DHCP/client
  list and wired LAN path; check for a duplicate IP or proxy ARP and reserve
  the camera's actual address before changing gateway configuration. A prior
  network snapshot listed `10.20.6.237`; treat it as superseded and do not use
  it without re-verifying the router lease.
- Farm router reported by the user: Huawei EchoLife HG8145V5. The ISP firmware
  variant and its VPN menu/capabilities have not been verified. An HTTP
  connection to `10.20.10.1:80` failed from the current workstation; this does
  not establish whether the router supports a VPN.
  Huawei's product support classifies this model under optical access/ONT, but
  the available public model information does not verify a VPN feature in this
  ISP's firmware. Do not assume Tailscale, WireGuard, or site-to-site IPsec is
  available based only on the model name. First verify the actual firmware and
  VPN menu locally. The user reports that no always-on on-site Linux device is
  currently available. If the firmware has no supported site-to-site VPN, a
  dedicated, always-on on-site Linux edge device/router is required; do not use
  the user's laptop in production. A Tailscale subnet router can advertise only
  the camera's verified fixed private IP as a `/32`, subject to route approval
  and tailnet access controls.
- Farm-to-EC2 connectivity: not yet configured. Use a private VPN/subnet route
  from a VPN-capable farm router or an always-on, dedicated on-site router/edge
  device. Do not use the Windows development PC as that router. Advertise only
  the camera's fixed private IP (`/32`) when supported; never advertise/open
  public RTSP access.
- The EC2 route table currently has no route to `10.20.0.0/19`; Tailscale,
  WireGuard, and IPsec services are inactive, and the gateway service is
  disabled. The host has no process listening on TCP `554`. These checks were
  read-only; no camera, router, firewall, or AWS security-group settings were
  changed. Security-group rules still need verification in the AWS control
  plane before deployment.
- Current gateway deployment remains disabled until the secure route is
  verified. The gateway no longer requires or loads detector model weights.

The currently inspected EC2 role does not allow full AWS resource/security
group enumeration. No VPC, security-group, route-table, or VPN changes should
be made based solely on instance metadata. Review and authorize any AWS
network changes in the AWS Console.

## EC2 installation

The following uses the existing EC2 checkout and does not change the frontend
or API deployment:

```bash
cd /home/ubuntu/alpasfarm
bash deploy/aws/install-camera-gateway.sh
```

The installer installs the required Ubuntu Python/OpenCV runtime libraries,
creates an isolated Python virtual environment, installs the gateway
requirements, installs a systemd unit, and creates a
root-owned, non-world-readable environment file from the template. It
deliberately does **not** enable or start the service.

Set `/etc/alpasfarm/camera-gateway.env` with `sudoedit`. Use a camera-only RTSP
account and the existing private API gateway token. Quote values when needed
according to python-dotenv syntax. Keep the file owned by `root:ubuntu` with
mode `0640`; never paste its values into logs, tickets, or browser settings.
Set `CAMERA_IP` to the camera's fixed private LAN address only after the VPN
route is ready. Do not copy the development PC's `.env` to production.

Initial settings should use one inference frame per second and no more than fifteen
preview uploads per second. `CAMERA_PREVIEW_UPLOAD_FPS` defaults to `15`;
`CAMERA_FRAME_UPLOAD_TIMEOUT`, `CAMERA_FRAME_MAX_RETRIES`,
`CAMERA_FRAME_BACKOFF_INITIAL`, and `CAMERA_FRAME_BACKOFF_MAX` control the
optional preview uploader. `RTSP_RECONNECT_DELAY`,
`RTSP_RECONNECT_MAX_DELAY`, `RTSP_PRIMARY_RETRY_SECONDS`, and
`RTSP_READ_FAILURE_THRESHOLD` control stream recovery. Review EC2 CPU credits
and API resource use before increasing either rate.

After network access, model availability, and RTSP credentials have been
verified, test the gateway in this order:

1. Confirm the gateway can reach the camera's private IP on the farm LAN or
   approved VPN route.
2. Read and decode an actual frame from the Tapo RTSP stream.
3. Confirm the counter produces a total visible-animal count and bounded,
   temporary goat/sheep tracking data. Confirm crossing events use the saved
   normalized line, require a stable track on both sides, and contain only the
   species, direction and temporary tracking ID.
4. Confirm the API acknowledges a crossing only after PostgreSQL accepts it;
   stop the API briefly and confirm the gateway keeps and retries its outbox.
5. Confirm the signed-in CCTV page opens the real feed, shows the editable line,
   overall overnight session progress, session event history, and counting history.

Do not use mock frames or fabricated counts. The saved line is stored in
`camera_gate_settings`; its revision is shown as applied only after the gateway
reports that revision with a successfully accepted frame. Counting-session
crossings are stored in `counting_session_events` with database timestamps;
entry totals are counted by species from confirmed crossing events. Pending
crossings include their session ID in
`camera-gateway/state/camera-crossings-outbox.json` and remain queued until the
API confirms them. Preserve that outbox file when moving the gateway to another
laptop. If the database declines to record an event because its session ended
or the saved line changed, the gateway saves the full crossing and reason in
`camera-gateway/state/camera-crossings-outbox-unrecorded.json` before clearing
the retry queue. Those archived events are not database counts; start a current
counting session to record new crossings. The outbox is not a count source;
PostgreSQL is authoritative. Apply
`20261101060000_persistent_camera_gate_monitoring.sql`,
`20261101070000_camera_counting_sessions.sql`,
`20261101080000_camera_species_only_counting.sql`,
`20261102090000_overnight_camera_return_counting.sql`, and
`20261102130000_persistent_camera_gateway_heartbeat.sql`,
`20261103100000_camera_counting_net_occupancy.sql`, and
`20261108100000_validate_and_record_camera_crossing_geometry.sql` before deploying the updated API.
The configured camera owner account is the only account that can edit the line
or manage sessions; gateway access remains protected by the private token.

## On-farm Windows laptop setup

The gateway requires only Python, OpenCV, NumPy, Requests, and python-dotenv.
No detector weights, PyTorch, or model server are used by CCTV motion
processing. Create a local `.env` from `.env.example` and enter the private
camera/API settings:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
notepad .env
python gateway.py
```

Keep `state/camera-crossings-outbox.json` when moving an already-running
gateway so unacknowledged crossings can retry. Do not transfer `.venv`,
`__pycache__`, or the old machine's `.env`.

The counting line is configured in ALPASFARM Settings and stored in the
database. The gateway fetches the saved line dynamically; its entry direction
is fixed to top-to-bottom (`Pababa = Pumasok`). Do not add a separate counting
line or direction to the gateway `.env`. Keep
`state/camera-crossings-outbox.json` when restarting or moving the gateway so
events that have not yet reached the database can be retried.

The gateway reconnects after temporary camera or Internet interruptions. Keep
the laptop on the same LAN as the camera and prevent Windows from sleeping.
Run `python gateway.py --diagnostics` before starting the gateway to check the
ALPASFARM API connection, private RTSP reachability, and a decoded camera frame.
OpenCV processes the full frame; the counting line is applied only after
tracking. Motion regions are not reliable goat/sheep recognition. For local
developer diagnostics, set `CAMERA_GATEWAY_DEBUG=1` to write the raw and
filtered masks, rejected contours, active track boxes, and movement metrics
under `state/motion-debug/`. Set it back to `0` after checking.

After the manual diagnostic succeeds, install the background task from an
Administrator PowerShell window:

```powershell
Set-Location C:\path\to\camera-gateway
.\install-windows-background-task.ps1
```

The task runs as Windows SYSTEM at startup, continues while the screen is
locked or ALPASFARM is closed, retries RTSP/API connections, and restarts the
gateway after a crash. It reads the local `camera-gateway\.env` without copying
credentials into the task definition. Logs rotate under
`C:\ProgramData\ALPASFARM\logs`. Use
`uninstall-windows-background-task.ps1` from Administrator PowerShell to
remove the task. Prevent the laptop from sleeping and keep it on the camera's
LAN; the task cannot monitor a powered-off or sleeping gateway.

The camera preview is held in API process memory and resumes after the next
gateway frame following an API restart. Neither the preview nor logs expose
camera credentials or the RTSP URL.
