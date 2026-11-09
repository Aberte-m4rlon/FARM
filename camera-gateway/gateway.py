from __future__ import annotations

import argparse
import ipaddress
import json
import logging
import os
import queue
import signal
import threading
import time
from collections import deque
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import cv2
import requests
from camera_service import CameraService
from camera_recorder import SessionRecordingWorker
from dotenv import load_dotenv
from preview_uploader import LatestFrameBuffer, PreviewUploadConfig, PreviewUploader
from runtime_lock import GatewayProcessLock


ROOT = Path(__file__).resolve().parent
load_dotenv(os.getenv("CAMERA_GATEWAY_ENV_FILE", str(ROOT / ".env")))
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

def configure_logging() -> None:
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    log_path = os.getenv("CAMERA_GATEWAY_LOG_FILE", "").strip()
    if not log_path:
        log_path = str(ROOT / "state" / "camera-gateway.log")
    if log_path:
        try:
            path = Path(log_path).expanduser()
            path.parent.mkdir(parents=True, exist_ok=True)
            handlers.append(RotatingFileHandler(
                path, maxBytes=50 * 1024 * 1024, backupCount=3, encoding="utf-8",
                delay=True,
            ))
        except OSError as error:
            print(f"Could not open the persistent gateway log ({error}); using console logging.")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=handlers,
    )


configure_logging()
log = logging.getLogger("alpasfarm-camera-gateway")
stopping = False
GATEWAY_HEARTBEAT_INTERVAL_SECONDS = 15
stop_event = threading.Event()


def setting_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        return max(minimum, min(maximum, int(os.getenv(name, str(default)))))
    except (TypeError, ValueError):
        return default


def setting_float(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
        if value != value or value in (float("inf"), float("-inf")):
            return default
        return max(minimum, min(maximum, value))
    except (TypeError, ValueError):
        return default


def camera_stream_paths() -> list[str]:
    primary = os.getenv("CAMERA_STREAM_PATH", "/stream1").strip() or "/stream1"
    fallback = os.getenv("CAMERA_FALLBACK_STREAM_PATH", "").strip()
    return [primary, fallback] if fallback and fallback != primary else [primary]


def camera_test_only_enabled() -> bool:
    return os.getenv("CAMERA_HYBRID_TEST_ONLY", "0").strip().lower() in {"1", "true", "yes", "on"}


def is_loopback_http_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme != "http" or not parsed.hostname:
        return False
    try:
        return parsed.hostname.lower() == "localhost" or ipaddress.ip_address(parsed.hostname).is_loopback
    except ValueError:
        return False


def camera_test_payload(count_result: dict[str, Any]) -> dict[str, Any]:
    """Keep live preview counts, while withholding durable crossings/settings acknowledgements."""
    payload = dict(count_result)
    payload["crossings"] = []
    payload.pop("config_revision", None)
    return payload


def stop_signal(_signum: int, _frame: object) -> None:
    global stopping
    stopping = True
    stop_event.set()


def detected_codec(capture: cv2.VideoCapture) -> str:
    value = capture.get(cv2.CAP_PROP_FOURCC)
    if not value or value < 0:
        return "unknown"
    code = int(value)
    name = "".join(chr((code >> (8 * offset)) & 0xff) for offset in range(4)).strip("\x00 ")
    return name if name.isascii() and name.isalnum() else "unknown"


def detected_fps(capture: cv2.VideoCapture) -> str:
    value = capture.get(cv2.CAP_PROP_FPS)
    return f"{value:.1f}" if 0 < value <= 240 else "unknown"


def run_diagnostics() -> int:
    camera_service = CameraService()
    api_url = os.getenv("ALPASFARM_API_URL", "").strip().rstrip("/")
    token = os.getenv("CAMERA_GATEWAY_TOKEN", "").strip()
    print("ALPASFARM Camera Gateway Diagnostics")

    api_ok = False
    is_valid_url = api_url.startswith("https://") or is_loopback_http_url(api_url)
    if is_valid_url and len(token) >= 32:
        try:
            response = requests.get(
                f"{api_url}/api/camera/gateway/settings",
                headers={"X-Camera-Gateway-Token": token},
                timeout=(3, 5),
            )
            api_ok = response.ok
        except requests.RequestException:
            api_ok = False
    print(f"ALPASFARM API: {'Connected' if api_ok else 'Unavailable or not configured'}")

    camera_tcp_ok = camera_service.is_online(3)
    print(f"Tapo camera network: {'Reachable' if camera_tcp_ok else 'Unreachable'}")
    stream_ok = False
    if camera_tcp_ok:
        try:
            for stream_path in camera_stream_paths():
                capture = camera_service.connect(stream_path)
                try:
                    if capture.isOpened():
                        deadline = time.monotonic() + 10
                        while time.monotonic() < deadline and not stream_ok:
                            received, frame = camera_service.get_stream()
                            stream_ok = bool(received and frame is not None)
                            if not stream_ok:
                                time.sleep(0.1)
                finally:
                    camera_service.disconnect()
                if stream_ok:
                    break
        except ValueError as error:
            log.warning("Camera stream credentials are not configured: %s", error)
    print(f"Tapo video stream: {'Decoded' if stream_ok else 'Unavailable'}")
    if not camera_tcp_ok:
        print("Gateway cannot reach Tapo.")
        print("If Tapo is on Wi-Fi A while the Gateway is on isolated Wi-Fi B: Gateway cannot reach Tapo because the camera is on a different isolated network.")
        print("If both devices are meant to share a LAN, check camera power, its reserved IP, and RTSP settings.")
        print("Use the same LAN or an approved secure VPN/private route; do not expose RTSP to the public Internet.")

    return 0 if api_ok and camera_tcp_ok and stream_ok else 1


def publish_latest_result(
    results: queue.Queue[tuple[dict[str, Any], float, float, float] | None],
    result: tuple[dict[str, Any], float, float, float] | None,
) -> None:
    """Replace a waiting API payload instead of building a stale result queue."""
    while True:
        try:
            results.put_nowait(result)
            return
        except queue.Full:
            try:
                results.get_nowait()
            except queue.Empty:
                continue


def run_camera_settings_sync(
    settings_url: str,
    token: str,
    detector: Any,
    detector_lock: threading.Lock,
    worker_stop: threading.Event,
    recording_worker: SessionRecordingWorker | None = None,
    test_only: bool = False,
) -> None:
    settings_warning_logged = False
    headers = {"X-Camera-Gateway-Token": token}
    if test_only:
        headers["X-Camera-Gateway-Test-Only"] = "1"
    with requests.Session() as session:
        while not stopping and not worker_stop.is_set():
            try:
                response = session.get(
                    settings_url,
                    headers=headers,
                    timeout=(3, 5),
                )
                response.raise_for_status()
                settings = response.json()
                with detector_lock:
                    detector.set_gate_settings(
                        settings.get("gate_line_y"),
                        settings.get("entry_flow"),
                        settings.get("revision", 0),
                        settings.get("active_session_id"),
                    )
                if recording_worker is not None:
                    active_session_id = settings.get("active_session_id")
                    recording_worker.set_active_session(
                        active_session_id if isinstance(active_session_id, str) else None,
                    )
                settings_warning_logged = False
            except (requests.RequestException, ValueError, TypeError, AttributeError) as error:
                if not settings_warning_logged:
                    log.warning(
                        "Could not sync the editable camera gate line; keeping the last saved position (%s).",
                        error,
                    )
                    settings_warning_logged = True
            worker_stop.wait(1.0)


def run_camera_result_uploader(
    results: queue.Queue[tuple[dict[str, Any], float, float, float] | None],
    detections_url: str,
    token: str,
    detector: Any,
    detector_lock: threading.Lock,
    worker_stop: threading.Event,
    test_only: bool = False,
) -> None:
    headers = {"X-Camera-Gateway-Token": token, "Content-Type": "application/json"}
    if test_only:
        headers["X-Camera-Gateway-Test-Only"] = "1"
    upload_retry_delay = 0.0
    last_upload_warning_at = 0.0
    last_upload_error_status: int | None = None
    last_success_log_at = time.monotonic()
    with requests.Session() as session:
        while not stopping and not worker_stop.is_set():
            try:
                latest = results.get(timeout=0.5)
            except queue.Empty:
                continue
            if latest is None:
                return

            while not stopping and not worker_stop.is_set():
                if upload_retry_delay and worker_stop.wait(upload_retry_delay):
                    return
                # Retry only the newest count after backoff. Crossings use a
                # separate durable uploader so count traffic cannot delay them.
                while True:
                    try:
                        replacement = results.get_nowait()
                    except queue.Empty:
                        break
                    if replacement is None:
                        return
                    latest = replacement

                count_result, queue_delay_ms, inference_ms, analysis_fps = latest
                upload_payload = camera_test_payload(count_result) if test_only else dict(count_result)
                upload_payload.pop("crossings", None)
                try:
                    response = session.post(
                        detections_url,
                        json=upload_payload,
                        headers=headers,
                        timeout=(5, 15),
                    )
                except requests.RequestException as error:
                    upload_retry_delay = min(15.0, max(0.5, upload_retry_delay * 2))
                    now = time.monotonic()
                    if last_upload_error_status is not None or now - last_upload_warning_at >= 30:
                        log.warning(
                            "Could not upload the camera count to ALPASFARM; retrying in %.1fs (%s).",
                            upload_retry_delay,
                            error,
                        )
                        last_upload_warning_at = now
                        last_upload_error_status = None
                    continue

                if response.status_code != 200:
                    upload_retry_delay = min(15.0, max(0.5, upload_retry_delay * 2))
                    now = time.monotonic()
                    if response.status_code != last_upload_error_status or now - last_upload_warning_at >= 30:
                        detail = " ".join(response.text.split())[:400]
                        log.warning(
                            "ALPASFARM did not confirm the camera count/events (HTTP %s); retrying in %.1fs. %s",
                            response.status_code,
                            upload_retry_delay,
                            detail,
                        )
                        last_upload_warning_at = now
                        last_upload_error_status = response.status_code
                    continue

                upload_retry_delay = 0.0
                last_upload_error_status = None
                now = time.monotonic()
                if now - last_success_log_at >= 15:
                    log.info(
                        "Camera count accepted%s: %s objects visible; confirmed crossings are delivered independently "
                        "(%.1f OpenCV analysis FPS, %.0f ms queue delay, %.0f ms capture-to-result).",
                        " in localhost test mode" if test_only else "",
                        int(count_result.get("animal_count", 0)),
                        analysis_fps,
                        queue_delay_ms,
                        queue_delay_ms + inference_ms,
                    )
                    last_success_log_at = now
                break


def run_camera_crossing_uploader(
    crossings_url: str,
    token: str,
    detector: Any,
    detector_lock: threading.Lock,
    worker_stop: threading.Event,
    crossing_available: threading.Event,
    crossing_detected_at: dict[str, float] | None = None,
) -> None:
    """Deliver confirmed crossings from the durable outbox, independent of frame uploads."""
    headers = {"X-Camera-Gateway-Token": token, "Content-Type": "application/json"}
    retry_delay = 0.0
    last_warning_at = 0.0
    last_error_status: int | None = None
    with requests.Session() as session:
        while not stopping and not worker_stop.is_set():
            if not crossing_available.wait(0.25):
                continue
            with detector_lock:
                pending = detector.outbox.pending(100)
                if not pending:
                    crossing_available.clear()
                    continue

            event_keys = [item.get("event_key") for item in pending]
            started_at = time.monotonic()
            try:
                response = session.post(
                    crossings_url,
                    json={"crossings": pending},
                    headers=headers,
                    timeout=(1, 5),
                )
                if response.status_code != 200:
                    raise requests.HTTPError(
                        f"HTTP {response.status_code}: {' '.join(response.text.split())[:300]}",
                        response=response,
                    )
                acknowledgement = response.json()
                acknowledged = acknowledgement.get("acknowledged_crossing_keys")
                unrecorded = acknowledgement.get("unrecorded_crossings", [])
                if (not isinstance(acknowledged, list)
                    or any(not isinstance(key, str) for key in acknowledged)
                    or len(acknowledged) != len(set(acknowledged))
                    or set(acknowledged) != set(event_keys)
                    or not isinstance(unrecorded, list)):
                    raise ValueError("The crossing acknowledgement did not match the submitted batch.")
                safe_outcomes: list[dict[str, str]] = []
                for outcome in unrecorded:
                    if (not isinstance(outcome, dict)
                        or not isinstance(outcome.get("event_key"), str)
                        or not isinstance(outcome.get("reason"), str)
                        or outcome["event_key"] not in event_keys):
                        raise ValueError("A crossing outcome is missing its submitted event key or reason.")
                    safe_outcomes.append({"event_key": outcome["event_key"], "reason": outcome["reason"]})
                with detector_lock:
                    if safe_outcomes:
                        archived_count = detector.archive_unrecorded_crossings(safe_outcomes)
                        if archived_count:
                            reasons = ", ".join(sorted({item["reason"] for item in safe_outcomes}))
                            log.warning(
                                "ALPASFARM did not apply %s crossing event(s) (%s); a recovery copy was saved beside the outbox.",
                                archived_count,
                                reasons,
                            )
                    detector.acknowledge_crossings(acknowledged)
                    detection_latencies_ms = [
                        (time.monotonic() - crossing_detected_at[key]) * 1000.0
                        for key in acknowledged
                        if crossing_detected_at is not None and key in crossing_detected_at
                    ]
                    if crossing_detected_at is not None:
                        for key in acknowledged:
                            crossing_detected_at.pop(key, None)
                    more_pending = bool(detector.outbox.pending(1))
                    if not more_pending:
                        crossing_available.clear()
                elapsed_ms = (time.monotonic() - started_at) * 1000.0
                log.info(
                    "Confirmed crossing delivery: %s event(s), gateway request/DB acknowledgement %.0f ms%s.",
                    len(acknowledged),
                    elapsed_ms,
                    f", local detection-to-DB confirmation up to {max(detection_latencies_ms):.0f} ms"
                    if detection_latencies_ms else "",
                )
                retry_delay = 0.0
                last_error_status = None
            except (requests.RequestException, ValueError, AttributeError, TypeError, RuntimeError, OverflowError) as error:
                retry_delay = min(5.0, max(0.25, retry_delay * 2))
                now = time.monotonic()
                status = getattr(getattr(error, "response", None), "status_code", None)
                if status != last_error_status or now - last_warning_at >= 30:
                    log.warning(
                        "Confirmed camera crossing remains safely queued; retrying in %.2fs (%s).",
                        retry_delay,
                        error,
                    )
                    last_warning_at = now
                    last_error_status = status
                worker_stop.wait(retry_delay)


def run_inference_worker(
    frames: queue.Queue[object],
    detections_url: str,
    settings_url: str,
    token: str,
    test_only: bool = False,
    recording_worker: SessionRecordingWorker | None = None,
    crossings_url: str | None = None,
    species_worker_factory: Any | None = None,
) -> None:
    detector = None
    species_worker = None
    while not stopping and detector is None:
        try:
            from inference import LocalCameraCounter
            from species_detection import SpeciesDetectionWorker

            species_worker = (
                species_worker_factory()
                if species_worker_factory is not None
                else SpeciesDetectionWorker.from_env(logger=log)
            )
            hybrid_mode = species_worker is not None or SpeciesDetectionWorker.configuration_requested()
            detector = LocalCameraCounter(hybrid_mode=hybrid_mode)
            if species_worker is not None:
                species_worker.start()
                log.info("Roboflow/OpenCV hybrid animal tracking is enabled; ML runs asynchronously on the latest frame.")
            elif hybrid_mode:
                log.error("Animal detector configuration is incomplete; hybrid counting is fail-closed until it is fixed.")
            else:
                log.info("Pure OpenCV motion tracking is enabled; no ML detector is configured.")
        except FileNotFoundError as error:
            log.warning("OpenCV motion counter could not open a required local file (%s); retrying in 5s...", error)
            stop_event.wait(5.0)
        except Exception:
            log.exception(
                "Local camera counter could not be initialized. "
                "Retrying initialization in 5s..."
            )
            stop_event.wait(5.0)

    if detector is None:
        return

    detector_lock = threading.Lock()
    worker_stop = threading.Event()
    crossing_available = threading.Event()
    crossing_detected_at: dict[str, float] = {}
    latest_results: queue.Queue[tuple[dict[str, Any], float, float, float] | None] = queue.Queue(maxsize=1)
    settings_worker = threading.Thread(
        target=run_camera_settings_sync,
        args=(settings_url, token, detector, detector_lock, worker_stop, recording_worker, test_only),
        name="alpasfarm-camera-settings",
        daemon=True,
    )
    uploader_worker = threading.Thread(
        target=run_camera_result_uploader,
        args=(latest_results, detections_url, token, detector, detector_lock, worker_stop, test_only),
        name="alpasfarm-camera-count-uploader",
        daemon=True,
    )
    crossing_uploader_worker = None
    if not test_only and crossings_url:
        crossing_available.set()
        crossing_uploader_worker = threading.Thread(
            target=run_camera_crossing_uploader,
            args=(crossings_url, token, detector, detector_lock, worker_stop, crossing_available, crossing_detected_at),
            name="alpasfarm-camera-crossing-uploader",
            daemon=True,
        )
    settings_worker.start()
    uploader_worker.start()
    if crossing_uploader_worker is not None:
        crossing_uploader_worker.start()

    processed_timestamps: deque[float] = deque()
    last_analysis_log_at = time.monotonic()
    last_detector_log_at = time.monotonic()
    last_species_sequence = 0
    processed_since_log = 0
    try:
        while not stopping:
            try:
                queued_frame = frames.get(timeout=1)
            except queue.Empty:
                continue
            if queued_frame is None:
                return
            queue_delay_ms = 0.0
            if (
                isinstance(queued_frame, tuple)
                and len(queued_frame) == 2
                and isinstance(queued_frame[1], (int, float))
            ):
                frame = queued_frame[0]
                frame_captured_at = float(queued_frame[1])
                queue_delay_ms = max(0.0, (time.monotonic() - frame_captured_at) * 1000.0)
            else:
                frame = queued_frame
                frame_captured_at = time.monotonic()
            try:
                detector_kwargs: dict[str, Any] = {}
                if species_worker is not None:
                    species_worker.submit(frame, frame_captured_at)
                    snapshot = species_worker.latest_after(last_species_sequence)
                    if snapshot is not None:
                        last_species_sequence = snapshot.sequence
                        snapshot_age = time.monotonic() - snapshot.captured_at
                        if 0.0 <= snapshot_age <= 2.5:
                            detector_kwargs = {
                                "species_detections": [dict(item) for item in snapshot.detections],
                                "detector_timestamp": snapshot.captured_at,
                            }
                        else:
                            log.debug("Discarded stale Roboflow result sequence %s (frame age %.0f ms).", snapshot.sequence, snapshot_age * 1000.0)
                with detector_lock:
                    count_result = detector.process(frame, **detector_kwargs)
                    if not test_only:
                        for crossing in count_result.get("crossings", []) or []:
                            event_key = crossing.get("event_key") if isinstance(crossing, dict) else None
                            if isinstance(event_key, str):
                                crossing_detected_at.setdefault(event_key, time.monotonic())
                if not test_only and count_result.get("crossings"):
                    crossing_available.set()
                now = time.monotonic()
                processed_timestamps.append(now)
                while processed_timestamps and now - processed_timestamps[0] > 5.0:
                    processed_timestamps.popleft()
                analysis_fps = (
                    (len(processed_timestamps) - 1)
                    / max(processed_timestamps[-1] - processed_timestamps[0], 1e-3)
                    if len(processed_timestamps) > 1 else 0.0
                )
                processed_since_log += 1
                publish_latest_result(
                    latest_results,
                    (count_result, queue_delay_ms, float(count_result.get("inference_ms", 0.0)), analysis_fps),
                )
                if now - last_analysis_log_at >= 15:
                    elapsed = max(now - last_analysis_log_at, 1e-3)
                    log.info(
                        "OpenCV tracking processed at %.1f FPS; latest count has %s visible object(s)%s.",
                        processed_since_log / elapsed,
                        int(count_result.get("animal_count", 0)),
                        "",
                    )
                    last_analysis_log_at = now
                    processed_since_log = 0
                if species_worker is not None and now - last_detector_log_at >= 60:
                    status = species_worker.diagnostics()
                    log.info(
                        "Animal detector health: backend=%s ready=%s calls=%s failed=%s p95=%.0fms interval=%.2fs labels=%s dropped=%s.",
                        status.get("backend", "unknown"),
                        status.get("ready", False),
                        status.get("api_calls", status.get("inferences", 0)),
                        status.get("failed", 0),
                        float(status.get("p95_latency_ms") or 0.0),
                        float(status.get("effective_interval_seconds") or 0.0),
                        ",".join(status.get("observed_classes") or []) or "none",
                        status.get("dropped_frames", 0),
                    )
                    last_detector_log_at = now
            except Exception:
                log.exception("Local camera count inference failed.")
    finally:
        worker_stop.set()
        publish_latest_result(latest_results, None)
        if species_worker is not None:
            detector_status = species_worker.diagnostics()
            configured_timeout = float(detector_status.get("request_timeout_seconds") or 8.0)
            species_worker.stop(timeout=max(3.0, configured_timeout + 1.0))
            detector_status = species_worker.diagnostics()
            log.info(
                "Animal detector run summary: backend=%s calls=%s successful=%s failed=%s labels=%s latency_p95_ms=%s error=%s.",
                detector_status.get("backend", "unknown"),
                detector_status.get("api_calls", 0),
                detector_status.get("inferences", 0),
                detector_status.get("failed", 0),
                ",".join(detector_status.get("observed_classes") or []) or "none",
                detector_status.get("p95_latency_ms"),
                detector_status.get("last_error"),
            )
        settings_worker.join(timeout=9)
        uploader_worker.join(timeout=16)
        if crossing_uploader_worker is not None:
            crossing_uploader_worker.join(timeout=8)


def run_gateway_heartbeat(heartbeat_url: str, token: str) -> None:
    headers = {"X-Camera-Gateway-Token": token}
    connected = False
    last_warning_at = time.monotonic()
    with requests.Session() as session:
        while not stopping:
            try:
                response = session.post(heartbeat_url, json={}, headers=headers, timeout=(3, 5))
                if 200 <= response.status_code < 300:
                    if not connected:
                        log.info("Persistent camera gateway heartbeat reached ALPASFARM.")
                    connected = True
                else:
                    now = time.monotonic()
                    if connected or now - last_warning_at >= 60:
                        log.warning("ALPASFARM did not confirm the gateway heartbeat (HTTP %s).", response.status_code)
                        last_warning_at = now
                    connected = False
            except requests.RequestException as error:
                now = time.monotonic()
                if connected or now - last_warning_at >= 60:
                    log.warning("Could not reach ALPASFARM for the gateway heartbeat; retrying (%s).", error)
                    last_warning_at = now
                connected = False

            stop_event.wait(GATEWAY_HEARTBEAT_INTERVAL_SECONDS)


def post_recording_status(api_url: str, token: str, session_id: str, status: str, details: dict[str, Any]) -> bool:
    for attempt in range(2):
        try:
            response = requests.post(
                f"{api_url}/api/camera/recordings",
                json={"action": "status", "session_id": session_id, "status": status, **details},
                headers={"X-Camera-Gateway-Token": token},
                timeout=(3, 8),
            )
            response.raise_for_status()
            return True
        except requests.RequestException as error:
            if attempt == 1:
                log.warning("Could not confirm CCTV recording state %s for session %s (%s).", status, session_id, error)
                return False
            stop_event.wait(1.0)
    return False


def update_recording_gap(api_url: str, token: str, session_id: str, action: str, gap_id: str | None) -> str | None:
    try:
        body: dict[str, Any] = {"action": action, "session_id": session_id}
        if action == "open-gap":
            body["reason"] = "camera_disconnected"
        elif gap_id:
            body["gap_id"] = gap_id
        response = requests.post(
            f"{api_url}/api/camera/recordings",
            json=body,
            headers={"X-Camera-Gateway-Token": token},
            timeout=(3, 8),
        )
        response.raise_for_status()
        payload = response.json()
        return payload.get("gap_id") if action == "open-gap" and isinstance(payload, dict) else None
    except (requests.RequestException, ValueError) as error:
        log.warning("Could not record CCTV interruption for session %s (%s).", session_id, error)
        return None


def run_camera_recording_uploader(base_dir: Path, api_url: str, token: str, worker_stop: threading.Event) -> None:
    recordings_dir = (base_dir / "recordings").resolve()
    headers = {"X-Camera-Gateway-Token": token}
    last_warning_at = 0.0
    with requests.Session() as session:
        while not stopping and not worker_stop.is_set():
            pending_sessions: set[str] = set()
            for marker in recordings_dir.glob("**/segment-*.json"):
                if worker_stop.is_set():
                    break
                try:
                    metadata = json.loads(marker.read_text(encoding="utf-8"))
                    session_id = str(metadata["session_id"])
                    video_path = Path(metadata["path"]).resolve()
                    if os.path.commonpath((str(video_path), str(recordings_dir))) != str(recordings_dir) or not video_path.is_file():
                        raise ValueError("Recording segment path is outside the recording directory or missing.")
                    pending_sessions.add(session_id)
                    if video_path.stat().st_size != int(metadata["file_size_bytes"]):
                        raise ValueError("Finalized recording segment size changed before upload.")

                    upload_metadata = {key: metadata[key] for key in (
                        "session_id", "sequence", "started_at", "ended_at", "duration_seconds",
                        "file_size_bytes", "frame_width", "frame_height",
                    )}
                    prepared = session.post(
                        f"{api_url}/api/camera/recordings",
                        json={"action": "prepare-upload", **upload_metadata},
                        headers=headers,
                        timeout=(5, 15),
                    )
                    prepared.raise_for_status()
                    upload = prepared.json()
                    signed_url = upload.get("signed_url") if isinstance(upload, dict) else None
                    storage_path = upload.get("storage_path") if isinstance(upload, dict) else None
                    if not isinstance(signed_url, str) or not isinstance(storage_path, str):
                        raise ValueError("Recording upload authorization was incomplete.")
                    with video_path.open("rb") as video_file:
                        uploaded = session.put(
                            signed_url,
                            data=video_file,
                            headers={"Content-Type": "video/mp4"},
                            timeout=(5, 300),
                        )
                    uploaded.raise_for_status()
                    completed = session.post(
                        f"{api_url}/api/camera/recordings",
                        json={"action": "complete-upload", **upload_metadata, "storage_path": storage_path},
                        headers=headers,
                        timeout=(5, 30),
                    )
                    completed.raise_for_status()
                    video_path.unlink()
                    marker.unlink()
                    pending_sessions.discard(session_id)
                    log.info("CCTV segment uploaded and verified session=%s sequence=%s bytes=%s.", session_id, metadata["sequence"], metadata["file_size_bytes"])
                except (OSError, KeyError, TypeError, ValueError, requests.RequestException) as error:
                    now = time.monotonic()
                    if now - last_warning_at >= 30:
                        log.warning("CCTV segment upload is pending and will retry (%s).", error)
                        last_warning_at = now

            for marker in recordings_dir.glob("**/session-finalized.json"):
                try:
                    finalized = json.loads(marker.read_text(encoding="utf-8"))
                    session_id = str(finalized["session_id"])
                    if session_id in pending_sessions:
                        continue
                    status = "SAVED" if finalized.get("has_segments") else "FAILED"
                    response = session.post(
                        f"{api_url}/api/camera/recordings",
                        json={
                            "action": "status",
                            "session_id": session_id,
                            "status": status,
                            "ended_at": finalized["ended_at"],
                            **({"error_status": "No video frames were successfully recorded."} if status == "FAILED" else {}),
                        },
                        headers=headers,
                        timeout=(5, 15),
                    )
                    response.raise_for_status()
                    marker.unlink()
                    log.info("CCTV recording %s for counting session %s.", status.lower(), session_id)
                except (OSError, KeyError, TypeError, ValueError, requests.RequestException) as error:
                    now = time.monotonic()
                    if now - last_warning_at >= 30:
                        log.warning("Could not finalize saved CCTV recording; retrying (%s).", error)
                        last_warning_at = now
            worker_stop.wait(5.0)


def run() -> int:
    global stopping
    parser = argparse.ArgumentParser(description="ALPASFARM Tapo camera gateway")
    parser.add_argument("--diagnostics", action="store_true", help="Check ALPASFARM API access, Tapo reachability, and RTSP decoding")
    args = parser.parse_args()

    gateway_lock = GatewayProcessLock(ROOT / "state" / "gateway-worker.lock")
    if not gateway_lock.acquire():
        log.error("A gateway camera worker is already running; refusing to open another RTSP pipeline.")
        return 3

    stopping = False
    stop_event.clear()
    log.info("Gateway camera worker started (pid=%s).", os.getpid())
    try:
        return run_gateway(args)
    finally:
        stopping = True
        stop_event.set()
        gateway_lock.release()


def run_gateway(args: argparse.Namespace) -> int:
    global stopping
    if args.diagnostics:
        return run_diagnostics()

    api_url = os.getenv("ALPASFARM_API_URL", "").strip().rstrip("/")
    token = os.getenv("CAMERA_GATEWAY_TOKEN", "").strip()
    test_only = camera_test_only_enabled()
    is_valid_url = api_url.startswith("https://") or api_url.startswith("http://localhost") or api_url.startswith("http://127.0.0.1")
    if not is_valid_url or len(token) < 32:
        log.error("Set an HTTPS ALPASFARM_API_URL (or http://localhost for dev) and a matching private gateway token in .env.")
        return 2
    if test_only:
        if not is_loopback_http_url(api_url):
            log.error("Local OpenCV test mode requires an http://localhost or loopback ALPASFARM_API_URL; refusing to contact any remote service.")
            return 2
        log.warning("LOCAL OPENCV TEST MODE: API target is %s; remote crossings, settings, recordings, and heartbeats are disabled.", api_url)

    test_video_path = os.getenv("CAMERA_TEST_VIDEO_PATH", "").strip()
    if test_video_path and not test_only:
        log.error("CAMERA_TEST_VIDEO_PATH is accepted only with CAMERA_HYBRID_TEST_ONLY=1.")
        return 2
    if test_video_path and not Path(test_video_path).expanduser().is_file():
        log.error("The configured local CCTV test video does not exist.")
        return 2
    if test_only:
        test_state_dir = ROOT / "state" / "local-test"
        test_state_dir.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("CAMERA_CROSSING_OUTBOX_PATH", str(test_state_dir / "camera-crossings-outbox.json"))

    upload_url = f"{api_url}/api/camera/gateway/frame"
    detections_url = f"{api_url}/api/camera/gateway/detections"
    crossings_url = f"{api_url}/api/camera/gateway/crossings"
    settings_url = f"{api_url}/api/camera/gateway/settings"
    heartbeat_url = f"{api_url}/api/camera/gateway/heartbeat"
    preview_config = PreviewUploadConfig.from_env()
    reconnect_delay_initial = setting_float("RTSP_RECONNECT_DELAY", 2.0, 0.5, 60.0)
    reconnect_delay_max = setting_float("RTSP_RECONNECT_MAX_DELAY", 30.0, reconnect_delay_initial, 300.0)
    primary_retry_seconds = setting_int("RTSP_PRIMARY_RETRY_SECONDS", 300, 30, 3_600)
    read_failure_threshold = setting_int("RTSP_READ_FAILURE_THRESHOLD", 8, 2, 60)
    max_width = setting_int("CAMERA_GATEWAY_MAX_WIDTH", 960, 320, 1280)
    inference_fps = setting_int("CAMERA_INFERENCE_FPS", 6, 1, 15)
    inference_interval = 1 / inference_fps
    stream_paths = camera_stream_paths()
    camera_service = CameraService()
    recording_worker = SessionRecordingWorker(
        ROOT / "state" / "local-test" if test_only else ROOT / "state",
        (lambda _session_id, _status, _details: True) if test_only else lambda session_id, status, details: post_recording_status(api_url, token, session_id, status, details),
        (lambda _session_id, _action, _gap_id: None) if test_only else lambda session_id, action, gap_id: update_recording_gap(api_url, token, session_id, action, gap_id),
        stop_event,
        logger=log,
    )
    recording_worker.start()
    recording_stop = threading.Event()
    recording_uploader = None
    if not test_only:
        recording_uploader = threading.Thread(
            target=run_camera_recording_uploader,
            args=(ROOT / "state", api_url, token, recording_stop),
            name="alpasfarm-camera-recording-uploader",
            daemon=True,
        )
        recording_uploader.start()
    if not test_video_path:
        for stream_path in stream_paths:
            camera_service.stream_url(stream_path)
    inference_frames: queue.Queue[object] = queue.Queue(maxsize=1)
    preview_frames = LatestFrameBuffer()
    inference_worker = threading.Thread(
        target=run_inference_worker,
        args=(inference_frames, detections_url, settings_url, token, test_only),
        kwargs={"recording_worker": recording_worker, "crossings_url": crossings_url},
        name="alpasfarm-local-inference",
        daemon=True,
    )
    inference_worker.start()
    preview_uploader = PreviewUploader(
        preview_frames,
        upload_url,
        token,
        stop_event,
        preview_config,
        test_only=test_only,
        logger=log,
    )
    preview_worker = threading.Thread(
        target=preview_uploader.run,
        name="alpasfarm-preview-uploader",
        daemon=True,
    )
    preview_worker.start()
    heartbeat_worker = None
    if not test_only:
        heartbeat_worker = threading.Thread(
            target=run_gateway_heartbeat,
            args=(heartbeat_url, token),
            name="alpasfarm-gateway-heartbeat",
            daemon=True,
        )
        heartbeat_worker.start()
    next_inference_at = 0.0
    reconnect_delay = reconnect_delay_initial
    consecutive_read_failures = 0
    camera_connected = False
    stream_index = 0
    next_primary_retry_at = 0.0
    decoded_frames = 0
    next_diagnostics_at = time.monotonic() + 60.0
    diagnostic_frame_count = 0
    diagnostic_started_at = time.monotonic()

    signal.signal(signal.SIGINT, stop_signal)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, stop_signal)

    while not stopping:
        if stream_index > 0 and next_primary_retry_at and time.monotonic() >= next_primary_retry_at:
            log.info("Retrying the primary RTSP stream after the configured fallback interval.")
            stream_index = 0
            next_primary_retry_at = 0.0

        active_stream_path = stream_paths[stream_index]
        capture = camera_service.connect(active_stream_path)
        if not capture.isOpened():
            capture.release()
            log.warning("Camera source %s is unavailable; reconnecting after %.1f seconds.", active_stream_path, reconnect_delay)
            if stream_index == 0 and len(stream_paths) > 1:
                stream_index = 1
                next_primary_retry_at = time.monotonic() + primary_retry_seconds
                log.info("Using alternate RTSP stream %s; primary retry in %s seconds.", stream_paths[stream_index], primary_retry_seconds)
            stop_event.wait(reconnect_delay)
            reconnect_delay = min(reconnect_delay_max, reconnect_delay * 1.7)
            continue

        if stream_index == 0:
            next_primary_retry_at = 0.0
        elif not next_primary_retry_at:
            next_primary_retry_at = time.monotonic() + primary_retry_seconds
        consecutive_read_failures = 0
        try:
            while not stopping:
                now = time.monotonic()
                if stream_index > 0 and next_primary_retry_at and now >= next_primary_retry_at:
                    log.info("Retrying the primary RTSP stream after the configured fallback interval.")
                    stream_index = 0
                    next_primary_retry_at = 0.0
                    break

                received, frame = camera_service.get_stream()
                if not received or frame is None:
                    consecutive_read_failures += 1
                    if consecutive_read_failures >= read_failure_threshold:
                        if test_video_path:
                            log.info("Local CCTV replay reached its end; stopping the localhost test cleanly.")
                            stopping = True
                            stop_event.set()
                            break
                        log.warning("Camera stream %s stopped producing decoded frames; reconnecting after %.1f seconds.", active_stream_path, reconnect_delay)
                        if stream_index == 0 and len(stream_paths) > 1:
                            stream_index = 1
                            next_primary_retry_at = time.monotonic() + primary_retry_seconds
                            log.info("Using alternate RTSP stream %s; primary retry in %s seconds.", stream_paths[stream_index], primary_retry_seconds)
                        break
                    stop_event.wait(0.05)
                    continue

                consecutive_read_failures = 0
                reconnect_delay = reconnect_delay_initial
                decoded_frames += 1
                height, width = frame.shape[:2]
                if not camera_connected:
                    camera_connected = True
                    log.info(
                        "Camera source connected and decoding: source=%s codec=%s resolution=%sx%s fps=%s.",
                        "local CCTV replay" if test_video_path else active_stream_path,
                        detected_codec(capture),
                        width,
                        height,
                        detected_fps(capture),
                    )
                now = time.monotonic()
                if now >= next_diagnostics_at:
                    diagnostic_elapsed = max(now - diagnostic_started_at, 1e-3)
                    decoded_fps = (decoded_frames - diagnostic_frame_count) / diagnostic_elapsed
                    log.info(
                        "Camera relay health: stream=%s decoded_frames=%s decoded_fps=%.1f.",
                        active_stream_path,
                        decoded_frames,
                        decoded_fps,
                    )
                    next_diagnostics_at = now + 60
                    diagnostic_started_at = now
                    diagnostic_frame_count = decoded_frames
                if width > max_width:
                    scale = max_width / width
                    frame = cv2.resize(frame, (max_width, max(1, round(height * scale))), interpolation=cv2.INTER_AREA)
                if now >= next_inference_at:
                    try:
                        inference_frames.put_nowait((frame.copy(), time.monotonic()))
                        next_inference_at = now + inference_interval
                    except queue.Full:
                        try:
                            inference_frames.get_nowait()
                            inference_frames.put_nowait((frame.copy(), time.monotonic()))
                            next_inference_at = now + inference_interval
                        except queue.Empty:
                            pass
                preview_frames.publish(frame.copy())
                recording_worker.submit_frame(frame)

                if stream_index > 0 and now >= next_primary_retry_at:
                    log.info("Retrying the primary RTSP stream after the configured fallback interval.")
                    stream_index = 0
                    next_primary_retry_at = 0.0
                    break
        except Exception:
            log.exception("RTSP capture failed; reconnecting after the configured backoff.")
        finally:
            camera_service.disconnect()
        camera_connected = False
        if not stopping:
            stop_event.wait(reconnect_delay)
            reconnect_delay = min(reconnect_delay_max, reconnect_delay * 1.7)

    recording_worker.stop()
    recording_stop.set()
    if recording_uploader is not None:
        recording_uploader.join(timeout=10)
    stop_event.set()
    try:
        inference_frames.put_nowait(None)
    except queue.Full:
        pass
    inference_worker.join()
    preview_worker.join()
    if heartbeat_worker is not None:
        heartbeat_worker.join()
    log.info("Camera gateway stopped.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(run())
    except ValueError as error:
        log.error("%s", error)
        raise SystemExit(2)
