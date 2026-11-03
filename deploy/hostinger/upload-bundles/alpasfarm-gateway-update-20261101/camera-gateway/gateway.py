from __future__ import annotations

import argparse
import logging
import os
import queue
import signal
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import cv2
import requests
from camera_service import CameraService
from dotenv import load_dotenv
from iot import IoTPublisher, TOPIC_ROOT, probe_tcp


ROOT = Path(__file__).resolve().parent
load_dotenv(os.getenv("CAMERA_GATEWAY_ENV_FILE", str(ROOT / ".env")))
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("alpasfarm-camera-gateway")
stopping = False
PRIMARY_STREAM_RETRY_SECONDS = 300
GATEWAY_ID = "ALPASFARM-GATEWAY-01"
CAMERA_ID = os.getenv("CAMERA_ID", "C320WS-01").strip() or "C320WS-01"


def utc_timestamp() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def setting_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        return max(minimum, min(maximum, int(os.getenv(name, str(default)))))
    except (TypeError, ValueError):
        return default


def camera_stream_paths() -> list[str]:
    primary = os.getenv("CAMERA_STREAM_PATH", "/stream1").strip()
    fallback = "/stream2" if primary != "/stream2" else "/stream1"
    return [primary, fallback]


def stop_signal(_signum: int, _frame: object) -> None:
    global stopping
    stopping = True


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


def gateway_heartbeat_loop(publisher: IoTPublisher, camera_service: CameraService) -> None:
    heartbeat_seconds = setting_int("AWS_IOT_HEARTBEAT_SECONDS", 30, 10, 300)
    endpoint = os.getenv("AWS_IOT_ENDPOINT", "").strip()
    previous_camera_state: str | None = None

    while not stopping:
        camera_status = camera_service.get_status()
        camera_reachable = camera_status["camera_reachable"]
        stream_available = camera_status["stream_available"]
        internet_connected = probe_tcp("1.1.1.1", 443, 2)
        camera_state = "online" if camera_reachable and stream_available else (
            "stream_unavailable" if camera_reachable else "network_unreachable"
        )
        payload = {
            "gateway_id": GATEWAY_ID,
            "status": "online",
            "timestamp": utc_timestamp(),
            "camera_id": CAMERA_ID,
            "camera_reachable": camera_reachable,
            "stream_available": stream_available,
            "internet_connected": internet_connected,
            "mqtt_connected": publisher.connected.is_set(),
        }
        publisher.publish_latest(f"{TOPIC_ROOT}/status", payload)

        if camera_state != "online" and (
            previous_camera_state is None or camera_state != previous_camera_state
        ):
            alert_type = (
                "camera_stream_unavailable" if camera_state == "stream_unavailable"
                else "camera_network_unreachable"
            )
            publisher.publish_event(f"{TOPIC_ROOT}/alerts", {
                "alert_id": str(uuid.uuid4()),
                "alert_type": alert_type,
                "timestamp": utc_timestamp(),
                "camera_id": CAMERA_ID,
            })
        elif previous_camera_state is not None and camera_state != previous_camera_state:
            alert_type = "camera_recovered" if camera_state == "online" else (
                "camera_stream_unavailable" if camera_state == "stream_unavailable" else "camera_network_unreachable"
            )
            publisher.publish_event(f"{TOPIC_ROOT}/alerts", {
                "alert_id": str(uuid.uuid4()),
                "alert_type": alert_type,
                "timestamp": utc_timestamp(),
                "camera_id": CAMERA_ID,
            })
        previous_camera_state = camera_state

        endpoint_host = urlsplit(f"//{endpoint}").hostname if endpoint else None
        if endpoint_host and not probe_tcp(endpoint_host, 8883, 2):
            log.warning("AWS IoT endpoint is not reachable over TCP; MQTT will reconnect when the network returns.")
        for _ in range(heartbeat_seconds * 2):
            if stopping:
                return
            time.sleep(0.5)


def run_diagnostics() -> int:
    camera_service = CameraService()
    endpoint = os.getenv("AWS_IOT_ENDPOINT", "").strip()
    print("ALPASFARM Gateway Diagnostics")

    internet_ok = probe_tcp("1.1.1.1", 443, 3)
    print(f"Internet connectivity: {'OK' if internet_ok else 'Unavailable'}")

    endpoint_host = urlsplit(f"//{endpoint}").hostname if endpoint else None
    aws_tcp_ok = bool(endpoint_host and probe_tcp(endpoint_host, 8883, 3))
    print(f"AWS IoT endpoint: {'Reachable' if aws_tcp_ok else 'Unavailable or not configured'}")
    mqtt = IoTPublisher()
    mqtt_started = mqtt.start()
    mqtt_ok = mqtt.connected.wait(20) if mqtt_started else False
    print(f"MQTT X.509 connection: {'Connected' if mqtt_ok else 'Not connected'}")
    mqtt.stop()

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

    return 0 if internet_ok and aws_tcp_ok and mqtt_ok and camera_tcp_ok and stream_ok else 1


def run_inference_worker(
    frames: queue.Queue[object],
    detections_url: str,
    settings_url: str,
    token: str,
    publisher: IoTPublisher,
) -> None:
    try:
        from inference import LocalCameraCounter

        detector = LocalCameraCounter()
    except Exception:
        log.exception(
            "Local camera counter could not be initialized. "
            "Install the camera-gateway requirements and check the local model weights."
        )
        return

    headers = {"X-Camera-Gateway-Token": token, "Content-Type": "application/json"}
    last_published_count: tuple[int, int, int] | None = None
    last_count_publish_at = 0.0
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
                if now - last_settings_poll_at >= 5:
                    last_settings_poll_at = now
                    try:
                        settings_response = session.get(settings_url, headers={"X-Camera-Gateway-Token": token}, timeout=(3, 5))
                        settings_response.raise_for_status()
                        settings = settings_response.json()
                        detector.set_gate_settings(settings.get("gate_line_y"), settings.get("entry_flow"))
                        settings_warning_logged = False
                    except (requests.RequestException, ValueError, TypeError, AttributeError) as error:
                        if not settings_warning_logged:
                            log.warning("Could not sync the editable camera gate line; keeping the last saved position (%s).", error)
                            settings_warning_logged = True
                count_result = detector.process(frame)
                animal_count = int(count_result.get("animal_count", 0))
                entries_total = int(count_result.get("entries_total", 0))
                exits_total = int(count_result.get("exits_total", 0))
                current_counts = (animal_count, entries_total, exits_total)
                now = time.monotonic()
                if current_counts != last_published_count or now - last_count_publish_at >= 60:
                    timestamp = utc_timestamp()
                    publisher.publish_latest(f"{TOPIC_ROOT}/count", {
                        "camera_id": CAMERA_ID,
                        "animal_count": animal_count,
                        "entries_total": entries_total,
                        "exits_total": exits_total,
                        "timestamp": timestamp,
                    })
                    last_published_count = current_counts
                    last_count_publish_at = now
                response = session.post(detections_url, json=count_result, headers=headers, timeout=(5, 15))
                if response.status_code != 204:
                    log.warning("ALPASFARM did not accept the camera count (HTTP %s).", response.status_code)
                else:
                    log.info(
                        "Camera count updated: %s visible, %s entered, %s exited (%.0f ms inference).",
                        animal_count,
                        entries_total,
                        exits_total,
                        count_result["inference_ms"],
                    )
            except requests.RequestException:
                log.warning("Could not upload the camera count to ALPASFARM.")
            except Exception:
                log.exception("Local camera count inference failed.")


def run() -> int:
    global stopping
    parser = argparse.ArgumentParser(description="ALPASFARM Tapo camera gateway")
    parser.add_argument("--diagnostics", action="store_true", help="Check Internet, AWS IoT, Tapo reachability, and RTSP decoding")
    args = parser.parse_args()
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
    # The API accepts at most one frame every 125 ms. Keep the configured
    # interval above that limit and avoid adding another fixed delay after each
    # successful HTTPS round trip.
    fps = setting_int("CAMERA_GATEWAY_MAX_FPS", 7, 1, 7)
    frame_interval = 1 / fps
    max_width = setting_int("CAMERA_GATEWAY_MAX_WIDTH", 960, 320, 1280)
    jpeg_quality = setting_int("CAMERA_GATEWAY_JPEG_QUALITY", 72, 45, 90)
    inference_fps = setting_int("CAMERA_INFERENCE_FPS", 1, 1, 2)
    inference_interval = 1 / inference_fps
    stream_paths = camera_stream_paths()
    camera_service = CameraService()
    for stream_path in stream_paths:
        camera_service.stream_url(stream_path)
    publisher = IoTPublisher()
    publisher.start()
    heartbeat_worker = threading.Thread(
        target=gateway_heartbeat_loop,
        args=(publisher, camera_service),
        name="alpasfarm-gateway-heartbeat",
        daemon=True,
    )
    heartbeat_worker.start()
    session = requests.Session()
    inference_frames: queue.Queue[object] = queue.Queue(maxsize=1)
    inference_worker = threading.Thread(
        target=run_inference_worker,
        args=(inference_frames, detections_url, settings_url, token, publisher),
        name="alpasfarm-local-inference",
        daemon=True,
    )
    inference_worker.start()
    headers = {"X-Camera-Gateway-Token": token, "Content-Type": "image/jpeg"}
    next_publish_at = 0.0
    next_inference_at = 0.0
    reconnect_delay = 2.0
    consecutive_read_failures = 0
    camera_connected = False
    first_upload_logged = False
    stream_index = 0
    next_primary_retry_at = 0.0
    decoded_frames = 0
    relayed_frames = 0
    next_diagnostics_at = 0.0

    signal.signal(signal.SIGINT, stop_signal)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, stop_signal)

    while not stopping:
        active_stream_path = stream_paths[stream_index]
        capture = camera_service.connect(active_stream_path)
        if not capture.isOpened():
            capture.release()
            log.warning("RTSP stream %s is unavailable; checking the alternate stream.", active_stream_path)
            stream_index = (stream_index + 1) % len(stream_paths)
            next_primary_retry_at = time.monotonic() + PRIMARY_STREAM_RETRY_SECONDS if stream_index else 0.0
            time.sleep(reconnect_delay)
            reconnect_delay = min(30.0, reconnect_delay * 1.7)
            continue

        if stream_index == 0:
            next_primary_retry_at = 0.0
        elif not next_primary_retry_at:
            next_primary_retry_at = time.monotonic() + PRIMARY_STREAM_RETRY_SECONDS
        reconnect_delay = 2.0
        consecutive_read_failures = 0
        try:
            while not stopping:
                received, frame = camera_service.get_stream()
                if not received or frame is None:
                    consecutive_read_failures += 1
                    if consecutive_read_failures >= 8:
                        log.warning("RTSP stream %s stopped producing decoded frames; checking the alternate stream.", active_stream_path)
                        stream_index = (stream_index + 1) % len(stream_paths)
                        next_primary_retry_at = time.monotonic() + PRIMARY_STREAM_RETRY_SECONDS if stream_index else 0.0
                        break
                    time.sleep(0.05)
                    continue

                consecutive_read_failures = 0
                decoded_frames += 1
                height, width = frame.shape[:2]
                if not camera_connected:
                    camera_connected = True
                    log.info(
                        "RTSP video decoded: stream=%s auth=accepted codec=%s resolution=%sx%s fps=%s.",
                        active_stream_path,
                        detected_codec(capture),
                        width,
                        height,
                        detected_fps(capture),
                    )
                now = time.monotonic()
                if now >= next_diagnostics_at:
                    log.info(
                        "Camera relay health: stream=%s decoded_frames=%s relayed_frames=%s.",
                        active_stream_path,
                        decoded_frames,
                        relayed_frames,
                    )
                    next_diagnostics_at = now + 60
                if stream_index > 0 and now >= next_primary_retry_at:
                    log.info("Retrying the primary RTSP stream after using the fallback.")
                    stream_index = 0
                    next_primary_retry_at = 0.0
                    break
                request_started_at = time.monotonic()
                if request_started_at < next_publish_at:
                    continue
                if width > max_width:
                    scale = max_width / width
                    frame = cv2.resize(frame, (max_width, max(1, round(height * scale))), interpolation=cv2.INTER_AREA)
                if request_started_at >= next_inference_at:
                    try:
                        inference_frames.put_nowait(frame.copy())
                        next_inference_at = request_started_at + inference_interval
                    except queue.Full:
                        try:
                            inference_frames.get_nowait()
                            inference_frames.put_nowait(frame.copy())
                            next_inference_at = request_started_at + inference_interval
                        except queue.Empty:
                            pass
                encoded, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
                if not encoded:
                    next_publish_at = time.monotonic() + 0.5
                    continue

                try:
                    response = session.post(upload_url, data=jpeg.tobytes(), headers=headers, timeout=(5, 8))
                    response_received_at = time.monotonic()
                    if response.status_code not in (200, 204):
                        log.warning("ALPASFARM did not accept the camera frame (HTTP %s).", response.status_code)
                        retry_delay = 2.0
                        if response.status_code == 429:
                            try:
                                retry_after_ms = response.headers.get("X-Camera-Retry-After-Ms")
                                retry_delay = (
                                    float(retry_after_ms) / 1_000
                                    if retry_after_ms is not None
                                    else float(response.headers.get("Retry-After", "1"))
                                )
                                retry_delay = max(0.1, min(10.0, retry_delay))
                            except (TypeError, ValueError):
                                retry_delay = 1.0
                        next_publish_at = response_received_at + retry_delay
                    else:
                        relayed_frames += 1
                        if not first_upload_logged:
                            log.info("Live camera feed reached ALPASFARM.")
                            first_upload_logged = True
                        next_publish_at = max(
                            request_started_at + frame_interval,
                            response_received_at + 0.015,
                        )
                except requests.RequestException:
                    log.warning("Could not reach ALPASFARM; keeping the camera connection and retrying.")
                    next_publish_at = time.monotonic() + 2.0
        except Exception:
            log.warning("Camera read stopped; reconnecting without exposing camera details.")
        finally:
            camera_service.disconnect()
        camera_connected = False
        if not stopping:
            time.sleep(reconnect_delay)
            reconnect_delay = min(30.0, reconnect_delay * 1.7)

    try:
        inference_frames.put_nowait(None)
    except queue.Full:
        pass
    inference_worker.join(timeout=15)
    heartbeat_worker.join(timeout=5)
    publisher.stop()
    session.close()
    log.info("Camera gateway stopped.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(run())
    except ValueError as error:
        log.error("%s", error)
        raise SystemExit(2)
