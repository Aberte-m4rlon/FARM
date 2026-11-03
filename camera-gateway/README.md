# ALPASFARM camera gateway

The designated on-farm Windows laptop can run the gateway when it stays awake
and remains on the same LAN as the Tapo camera. It connects directly to the
camera and does not act as a subnet router. A cloud-hosted gateway still needs
an approved private route to the camera.

The CCTV preview opens automatically on the counting page. The gateway runs
goat/sheep detection and temporary object tracking only. It detects a crossing
after a tracked animal is observed on both stable sides of the saved line. Each
confirmed entry event updates the goat or sheep session counter; no camera
event is matched to a registered animal. PostgreSQL records the event and its
server-generated timestamp. Tracker IDs are temporary and are never treated as
animal IDs.

Camera preview and count paths are independent:

```text
Tapo C320WS -- RTSP --> Existing Python Gateway --> local full-frame detection/tracking --> count API --> PostgreSQL
                                  └--> latest-frame preview uploader --> ALPASFARM live view
```

The camera must keep its private LAN address. Do not port-forward RTSP/554 or
put camera credentials, an RTSP URL, or the gateway token in browser code. The
gateway uses RTSP-over-TCP and sends the preview, detections, and pending
crossing events directly to the authenticated ALPASFARM API over HTTPS.

Preview and counting use separate workers. The gateway continues full-frame
goat/sheep inference, tracking, and crossing-event delivery even if preview
uploads are delayed or refused. Preview is limited to the latest decoded frame
at `CAMERA_PREVIEW_UPLOAD_FPS` (default `2`, maximum `5`); it does not queue old
frames. The existing token-authenticated frame endpoint accepts no more than
one frame per 125 ms and provides `Retry-After` on HTTP 429. The gateway's
default 2 FPS (maximum 5 FPS) stays below that boundary. On HTTP 429, the
preview worker honors `Retry-After` and backs off exponentially up to the
configured fallback cap. It logs upload/skipped-frame metrics once per minute.
A preview error never restarts RTSP or pauses counting.

Only one gateway process may own the camera at a time. If the primary `/stream1`
fails, the worker moves to `/stream2`, reconnects with a growing delay, and
retries the primary stream after `RTSP_PRIMARY_RETRY_SECONDS` (default `300`).
It does not rapidly alternate between streams when both are unavailable.

## EC2 gateway prerequisites (cloud-hosted option)

For an on-farm laptop on the same LAN as the Tapo camera, a VPN route is not
needed. The remaining checks in this section apply when the gateway runs on
EC2 instead.

- EC2 host: `ap-southeast-1`, existing ALPASFARM instance.
- Current user-reported Tapo network snapshot: camera `10.20.6.237`, mask
  `255.255.224.0` (`10.20.0.0/19`), gateway `10.20.10.1`, DNS
  `121.54.70.150`. This may be a DHCP lease; no reservation has been verified.
  Do not change the camera's network settings or rely on this address as
  permanent until the router lease is checked.
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
  `10.20.6.237/32`, subject to route approval and tailnet access controls.
- Model checkpoint: `/var/lib/alpasfarm-camera-gateway/models/best.pt` exists
  on the EC2 host. Its successful load and detection on real Tapo frames have
  not been verified yet; verify both before enabling the service.
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
- Current gateway deployment remains disabled until both the secure route and
  actual model weights are verified.

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
creates an isolated Python virtual environment, installs the CPU-only PyTorch
wheels and gateway requirements, installs a systemd unit, and creates a
root-owned, non-world-readable environment file from the template. It
deliberately does **not** enable or start the service.

Before configuring the environment file, verify the checkpoint is a regular
file at the configured `CAMERA_MODEL_PATH`. The production detector checkpoint
is already available inside its running container. Copy it to the gateway
directory through Docker/SSH; do not commit it to Git or place it in the public
web directory.

Set `/etc/alpasfarm/camera-gateway.env` with `sudoedit`. Use a camera-only RTSP
account and the existing private API gateway token. Quote values when needed
according to python-dotenv syntax. Keep the file owned by `root:ubuntu` with
mode `0640`; never paste its values into logs, tickets, or browser settings.
Set `CAMERA_IP` to the camera's fixed private LAN address only after the VPN
route is ready. Do not copy the development PC's `.env` to production.

Initial settings should use one inference frame per second and no
more than five preview uploads per second. `CAMERA_PREVIEW_UPLOAD_FPS` defaults
to `2`; `CAMERA_FRAME_UPLOAD_TIMEOUT`, `CAMERA_FRAME_MAX_RETRIES`,
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
laptop. The outbox is not a count source; PostgreSQL is authoritative. Apply
`20261101060000_persistent_camera_gate_monitoring.sql`,
`20261101070000_camera_counting_sessions.sql`,
`20261101080000_camera_species_only_counting.sql`,
`20261102090000_overnight_camera_return_counting.sql`, and
`20261102130000_persistent_camera_gateway_heartbeat.sql` before deploying the updated API.
The configured camera owner account is the only account that can edit the line
or manage sessions; gateway access remains protected by the private token.

## On-farm Windows laptop setup

Copy these items to the on-farm laptop, keeping the folder layout together:

```text
ALPASFARM-gateway/
├── camera-gateway/                 # Entire folder, including .env.example and installer scripts
└── ml-server/
    ├── app/
    │   └── species_detector.py     # Gateway's YOLO inference module
    └── models/
        └── active/
            └── best.pt             # Private goat/sheep checkpoint
```

The gateway imports `ml-server/app/species_detector.py` and expects the model at
`ml-server/models/active/best.pt`. Keep `state/camera-crossings-outbox.json`
when moving an already-running gateway so unacknowledged crossings can retry.
Do not transfer `.venv`, `__pycache__`, the old machine's `.env`, or the unused
`camera-gateway/yolo11n.pt`. Create a local `.env` from `.env.example` on the new
laptop and enter the private camera/API settings there. Install CPU PyTorch
first, then the gateway requirements:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision
pip install -r requirements.txt
Copy-Item .env.example .env
notepad .env
python gateway.py
```

The counting line is configured in ALPASFARM Settings and stored in the
database. The gateway fetches the saved line dynamically; its entry direction
is fixed to top-to-bottom (`Pababa = Pumasok`). Do not add a separate counting
line or direction to the gateway `.env`. Keep
`state/camera-crossings-outbox.json` when restarting or moving the gateway so
events that have not yet reached the database can be retried.

The default model path is `../ml-server/models/active/best.pt`. The gateway
reconnects after temporary camera or Internet interruptions. Keep the laptop
on the same LAN as the camera and prevent Windows from sleeping.
Run `python gateway.py --diagnostics` before starting the gateway to check the
ALPASFARM API connection, private RTSP reachability, and a decoded camera frame.
YOLO receives the full decoded frame. The configured counting line is applied
only to tracked goat/sheep centers after inference, so animals on either side
can be detected and shown in the preview before crossing it. To temporarily
enable internal diagnostics, set `CAMERA_GATEWAY_DEBUG=1`; gateway logs then
include full-frame goat/sheep totals, temporary track IDs, side of the line, and
new crossing count. Set it back to `0` after checking.

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
