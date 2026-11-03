from __future__ import annotations

import argparse
import logging
import os
import queue
import signal
import threading
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path

import cv2
import requests
from camera_service import CameraService
from dotenv import load_dotenv
from preview_uploader import LatestFrameBuffer, PreviewUploadConfig, PreviewUploader
from runtime_lock import GatewayProcessLock


ROOT = Path(__file__).resolve().parent
load_dotenv(os.getenv("CAMERA_GATEWAY_ENV_FILE", str(ROOT / ".env")))
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

def configure_logging() -> None:
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    log_path = os.getenv("CAMERA_GATEWAY_LOG_FILE", "").strip()
    if not log_path and os.name == "nt":
        program_data = os.getenv("PROGRAMDATA", r"C:\ProgramData")
        log_path = str(Path(program_data) / "ALPASFARM" / "logs" / "camera-gateway.log")
    if log_path:
        try:
            path = Path(log_path).expanduser()
            path.parent.mkdir(parents=True, exist_ok=True)
            handlers.append(RotatingFileHandler(
                path, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8",
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
    primary = os.getenv("CAMERA_STREAM_PATH", "/stream1").strip()
    fallback = "/stream2" if primary != "/stream2" else "/stream1"
    return [primary, fallback]


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
    if api_url.startswith("https://") and len(token) >= 32:
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


def run_inference_worker(
    frames: queue.Queue[object],
    detections_url: str,
    settings_url: str,
    token: str,
) -> None:
    try:
        from inference import LocalCameraCounter

        detector = LocalCameraCounter()
        log.info("Goat/sheep full-frame detection and gate tracking are active.")
    except Exception:
        log.exception(
            "Local camera counter could not be initialized. "
            "Install the camera-gateway requirements and check the local model weights."
        )
        return

    headers = {"X-Camera-Gateway-Token": token, "Content-Type": "application/json"}
    last_settings_poll_at = 0.0
    settings_warning_logged = False
    with requests.Session() as session:
        while not stopping:
            try:
                frame = frames.get(timeout=1)
            except queue.Empty:
                continue
            if frame is None:
                return
            try:
                now = time.monotonic()
                if now - last_settings_poll_at >= 1:
                    last_settings_poll_at = now
                    try:
                        settings_response = session.get(settings_url, headers={"X-Camera-Gateway-Token": token}, timeout=(3, 5))
                        settings_response.raise_for_status()
                        settings = settings_response.json()
                        detector.set_gate_settings(
                            settings.get("gate_line_y"),
                            settings.get("entry_flow"),
                            settings.get("revision", 0),
                            settings.get("active_session_id"),
                        )
                        settings_warning_logged = False
                    except (requests.RequestException, ValueError, TypeError, AttributeError) as error:
                        if not settings_warning_logged:
                            log.warning("Could not sync the editable camera gate line; keeping the last saved position (%s).", error)
                            settings_warning_logged = True
                count_result = detector.process(frame)
                animal_count = int(count_result.get("animal_count", 0))
                response = session.post(detections_url, json=count_result, headers=headers, timeout=(5, 15))
                if response.status_code != 200:
                    log.warning("ALPASFARM did not confirm the camera count/events (HTTP %s).", response.status_code)
                else:
                    try:
                        acknowledgement = response.json()
                        acknowledged = acknowledgement.get("acknowledged_crossing_keys", [])
                        if isinstance(acknowledged, list) and all(isinstance(key, str) for key in acknowledged):
                            detector.acknowledge_crossings(acknowledged)
                    except (ValueError, AttributeError, TypeError):
                        log.warning("ALPASFARM accepted the camera count without a valid crossing acknowledgement; events remain queued.")
                    log.info(
                        "Camera count accepted: %s goat/sheep visible, %s crossing event(s) awaiting/recently confirmed (%.0f ms inference).",
                        animal_count,
                        len(count_result.get("crossings", [])),
                        count_result["inference_ms"],
                    )
            except requests.RequestException:
                log.warning("Could not upload the camera count to ALPASFARM.")
            except Exception:
                log.exception("Local camera count inference failed.")


def run_gateway_heartbeat(heartbeat_url: str, token: str) -> None:
    headers = {"X-Camera-Gateway-Token": token}
    connected = False
    last_warning_at = 0.0
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
            except requests.RequestException:
                now = time.monotonic()
                if connected or now - last_warning_at >= 60:
                    log.warning("Could not reach ALPASFARM for the gateway heartbeat; retrying.")
                    last_warning_at = now
                connected = False

            stop_event.wait(GATEWAY_HEARTBEAT_INTERVAL_SECONDS)


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
    if not api_url.startswith("https://") or len(token) < 32:
        log.error("Set an HTTPS ALPASFARM_API_URL and a matching private gateway token in .env.")
        return 2

    upload_url = f"{api_url}/api/camera/gateway/frame"
    detections_url = f"{api_url}/api/camera/gateway/detections"
    settings_url = f"{api_url}/api/camera/gateway/settings"
    heartbeat_url = f"{api_url}/api/camera/gateway/heartbeat"
    preview_config = PreviewUploadConfig.from_env()
    reconnect_delay_initial = setting_float("RTSP_RECONNECT_DELAY", 2.0, 0.5, 60.0)
    reconnect_delay_max = setting_float("RTSP_RECONNECT_MAX_DELAY", 30.0, reconnect_delay_initial, 300.0)
    primary_retry_seconds = setting_int("RTSP_PRIMARY_RETRY_SECONDS", 300, 30, 3_600)
    read_failure_threshold = setting_int("RTSP_READ_FAILURE_THRESHOLD", 8, 2, 60)
    max_width = setting_int("CAMERA_GATEWAY_MAX_WIDTH", 960, 320, 1280)
    inference_fps = setting_int("CAMERA_INFERENCE_FPS", 1, 1, 2)
    inference_interval = 1 / inference_fps
    stream_paths = camera_stream_paths()
    camera_service = CameraService()
    for stream_path in stream_paths:
        camera_service.stream_url(stream_path)
    inference_frames: queue.Queue[object] = queue.Queue(maxsize=1)
    preview_frames = LatestFrameBuffer()
    inference_worker = threading.Thread(
        target=run_inference_worker,
        args=(inference_frames, detections_url, settings_url, token),
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
        logger=log,
    )
    preview_worker = threading.Thread(
        target=preview_uploader.run,
        name="alpasfarm-preview-uploader",
        daemon=True,
    )
    preview_worker.start()
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
    next_diagnostics_at = 0.0

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
            log.warning("RTSP stream %s is unavailable; reconnecting after %.1f seconds.", active_stream_path, reconnect_delay)
            if stream_index == 0:
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
                        log.warning("RTSP stream %s stopped producing decoded frames; reconnecting after %.1f seconds.", active_stream_path, reconnect_delay)
                        if stream_index == 0:
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
                        "RTSP stream connected and decoding: stream=%s auth=accepted codec=%s resolution=%sx%s fps=%s.",
                        active_stream_path,
                        detected_codec(capture),
                        width,
                        height,
                        detected_fps(capture),
                    )
                now = time.monotonic()
                if now >= next_diagnostics_at:
                    log.info(
                        "Camera relay health: stream=%s decoded_frames=%s.",
                        active_stream_path,
                        decoded_frames,
                    )
                    next_diagnostics_at = now + 60
                if width > max_width:
                    scale = max_width / width
                    frame = cv2.resize(frame, (max_width, max(1, round(height * scale))), interpolation=cv2.INTER_AREA)
                if now >= next_inference_at:
                    try:
                        inference_frames.put_nowait(frame.copy())
                        next_inference_at = now + inference_interval
                    except queue.Full:
                        try:
                            inference_frames.get_nowait()
                            inference_frames.put_nowait(frame.copy())
                            next_inference_at = now + inference_interval
                        except queue.Empty:
                            pass
                preview_frames.publish(frame.copy())

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

    stop_event.set()
    try:
        inference_frames.put_nowait(None)
    except queue.Full:
        pass
    inference_worker.join()
    preview_worker.join()
    heartbeat_worker.join()
    log.info("Camera gateway stopped.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(run())
    except ValueError as error:
        log.error("%s", error)
        raise SystemExit(2)
