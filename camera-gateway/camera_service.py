from __future__ import annotations

import concurrent.futures
import ipaddress
import logging
import os
import re
import socket
import subprocess
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

import cv2

log = logging.getLogger("alpasfarm-camera-gateway")


def probe_tcp(host: str, port: int, timeout_seconds: float) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout_seconds):
            return True
    except OSError:
        return False


def probe_rtsp(host: str, port: int, timeout_seconds: float = 0.8) -> bool:
    """Send RTSP OPTIONS request to confirm device is an active RTSP server."""
    try:
        with socket.create_connection((host, port), timeout=timeout_seconds) as s:
            s.settimeout(timeout_seconds)
            probe_req = f"OPTIONS rtsp://{host}:{port}/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: alpasfarm-gateway\r\n\r\n"
            s.sendall(probe_req.encode("ascii"))
            resp = s.recv(512)
            return resp.startswith(b"RTSP/")
    except OSError:
        return False


def local_route_ip(destination_ip: str, port: int) -> str | None:
    """Return the local interface address Windows routes to a destination."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route_socket:
            route_socket.connect((destination_ip, port))
            source_ip = route_socket.getsockname()[0]
        return source_ip if source_ip and source_ip != "0.0.0.0" else None
    except OSError:
        return None


def get_local_arp_table() -> dict[str, str]:
    """Returns mapping of MAC address (lowercase, colons) to IP and IP to MAC."""
    table: dict[str, str] = {}
    try:
        output = subprocess.check_output(["arp", "-a"], text=True, stderr=subprocess.DEVNULL)
        for line in output.splitlines():
            match = re.search(
                r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2})",
                line,
            )
            if match:
                ip_str, mac_str = match.groups()
                norm_mac = mac_str.lower().replace("-", ":")
                table[norm_mac] = ip_str
                table[ip_str] = norm_mac
    except Exception:
        pass
    return table


class CameraService:
    """Small RTSP camera adapter; inference receives decoded frames only."""

    def __init__(self) -> None:
        if hasattr(cv2, "setLogLevel") and hasattr(cv2, "LOG_LEVEL_SILENT"):
            cv2.setLogLevel(cv2.LOG_LEVEL_SILENT)
        self.camera_ip = os.getenv("CAMERA_IP", "").strip()
        self.camera_mac = self._clean_mac(os.getenv("CAMERA_MAC", ""))
        self.port = self._port()
        self.username = os.getenv("CAMERA_USERNAME", "").strip()
        self.password = os.getenv("CAMERA_PASSWORD", "")
        self.auto_discovery = os.getenv("CAMERA_AUTO_DISCOVERY", "true").strip().lower() in ("1", "true", "yes")
        self._last_discovery_at = 0.0
        self._discovery_cooldown_seconds = 20.0
        self._capture: cv2.VideoCapture | None = None
        self._last_frame_at = 0.0
        self.test_video_path = os.getenv("CAMERA_TEST_VIDEO_PATH", "").strip()
        self.test_video_start_seconds = self._bounded_env("CAMERA_TEST_VIDEO_START_SECONDS", 0.0, 0.0, 86_400.0)
        self.test_video_duration_seconds = self._bounded_env("CAMERA_TEST_VIDEO_DURATION_SECONDS", 0.0, 0.0, 3_600.0)
        self.test_video_speed = self._bounded_env("CAMERA_TEST_VIDEO_SPEED", 1.0, 0.25, 4.0)
        self._test_video_started_at = 0.0
        self._test_video_frame_index = 0
        self._test_video_fps = 10.0
        self._lock = threading.Lock()

    @staticmethod
    def _bounded_env(name: str, default: float, minimum: float, maximum: float) -> float:
        try:
            value = float(os.getenv(name, str(default)))
            return max(minimum, min(maximum, value)) if value == value else default
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _clean_mac(raw: str) -> str:
        cleaned = raw.strip().lower().replace("-", ":")
        return cleaned if re.match(r"^([0-9a-f]{2}:){5}[0-9a-f]{2}$", cleaned) else ""

    @staticmethod
    def _port() -> int:
        try:
            value = int(os.getenv("CAMERA_RTSP_PORT", "554"))
            if 1 <= value <= 65_535:
                return value
        except (TypeError, ValueError):
            pass
        return 554

    def update_saved_ip(self, new_ip: str) -> None:
        self.camera_ip = new_ip
        os.environ["CAMERA_IP"] = new_ip
        # Update .env file if it exists
        env_path = os.getenv("CAMERA_GATEWAY_ENV_FILE")
        if not env_path:
            candidate = Path(__file__).resolve().parent / ".env"
            if candidate.is_file():
                env_path = str(candidate)
        if env_path and os.path.isfile(env_path):
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    content = f.read()
                if re.search(r"^CAMERA_IP=.*$", content, flags=re.MULTILINE):
                    new_content = re.sub(r"^CAMERA_IP=.*$", f"CAMERA_IP={new_ip}", content, flags=re.MULTILINE)
                else:
                    new_content = content + f"\nCAMERA_IP={new_ip}\n"
                with open(env_path, "w", encoding="utf-8") as f:
                    f.write(new_content)
                log.info("Persisted new CAMERA_IP=%s to %s", new_ip, env_path)
            except Exception as e:
                log.warning("Could not persist new CAMERA_IP to %s: %s", env_path, e)

    def discover_camera(self, force: bool = False) -> str | None:
        """Automatically find the Tapo camera IP on the local subnet if it moved."""
        if not self.auto_discovery:
            return None
        now = time.monotonic()
        if not force and (now - self._last_discovery_at < self._discovery_cooldown_seconds):
            return None
        self._last_discovery_at = now

        log.info("Camera at %s unreachable; initiating auto-discovery...", self.camera_ip)

        # 1. First check ARP table for CAMERA_MAC if configured
        arp = get_local_arp_table()
        if self.camera_mac:
            found_ip = arp.get(self.camera_mac)
            if found_ip and probe_tcp(found_ip, self.port, 1.0):
                log.info("Camera found via MAC match (%s -> %s)", self.camera_mac, found_ip)
                self.update_saved_ip(found_ip)
                return found_ip
            configured_ip_mac = arp.get(self.camera_ip)
            if configured_ip_mac and configured_ip_mac != self.camera_mac:
                log.warning(
                    "ARP reports MAC %s for CAMERA_IP %s, which differs from configured CAMERA_MAC %s. "
                    "This may be proxy ARP and does not prove the camera IP is wrong; verify the router's "
                    "DHCP/ARP mapping and RTSP reachability.",
                    configured_ip_mac,
                    self.camera_ip,
                    self.camera_mac,
                )

        # 2. Collect subnets to scan
        subnets_to_scan: list[ipaddress.IPv4Network] = []
        if self.camera_ip:
            try:
                ip_obj = ipaddress.ip_address(self.camera_ip)
                if isinstance(ip_obj, ipaddress.IPv4Address) and ip_obj.is_private:
                    subnets_to_scan.append(ipaddress.ip_network(f"{self.camera_ip}/24", strict=False))
                    # If on a 10.x.x.x network, check adjacent subnets (0, 1, 2, 3) in case DHCP pool is wider
                    parts = self.camera_ip.split(".")
                    if len(parts) == 4 and parts[0] == "10":
                        for octet in ("0", "1", "2", "3"):
                            adj_net = ipaddress.ip_network(f"{parts[0]}.{parts[1]}.{octet}.0/24", strict=False)
                            if adj_net not in subnets_to_scan:
                                subnets_to_scan.append(adj_net)
            except ValueError:
                pass

        # Select the interface using the camera destination itself. This keeps
        # discovery on the wired LAN when the PC's internet default route is
        # different from the camera route (for example, Ethernet plus Wi-Fi).
        local_ip = local_route_ip(self.camera_ip, self.port) if self.camera_ip else None
        if local_ip:
            local_net = ipaddress.ip_network(f"{local_ip}/24", strict=False)
            if local_net not in subnets_to_scan:
                subnets_to_scan.append(local_net)
            log.info(
                "Camera discovery is following the route to the configured camera address (local interface IP=%s).",
                local_ip,
            )
        else:
            log.warning(
                "Could not resolve a local interface route to the configured camera address; "
                "discovery will scan the configured camera subnet only."
            )

        # 3. Fast multi-threaded scan on RTSP port 554
        candidates: list[str] = []
        for net in subnets_to_scan:
            hosts = [str(h) for h in net.hosts()]

            def check_host(h_ip: str) -> str | None:
                return h_ip if probe_tcp(h_ip, self.port, 0.25) else None

            with concurrent.futures.ThreadPoolExecutor(max_workers=40) as executor:
                results = executor.map(check_host, hosts)
                for res in results:
                    if res:
                        candidates.append(res)

        log.info("RTSP port scan found %s host(s): %s", len(candidates), candidates)

        # 4. Probe candidates with RTSP protocol handshake
        valid_ip: str | None = None
        matched_by_mac: str | None = None
        matched_by_oui: str | None = None
        first_rtsp: str | None = None
        arp = get_local_arp_table()

        for cand in candidates:
            if probe_rtsp(cand, self.port, 0.8):
                if not first_rtsp:
                    first_rtsp = cand
                cand_mac = arp.get(cand)
                if self.camera_mac and cand_mac:
                    if cand_mac.lower() == self.camera_mac.lower():
                        matched_by_mac = cand
                        break
                    # Check if it shares the first 8 chars (TP-Link OUI: 60:15:6f)
                    if len(cand_mac) >= 8 and len(self.camera_mac) >= 8 and cand_mac[:8].lower() == self.camera_mac[:8].lower():
                        matched_by_oui = cand

        valid_ip = matched_by_mac or matched_by_oui or first_rtsp

        if valid_ip:
            log.info("Camera verified at %s:%s! Auto-updating configuration.", valid_ip, self.port)
            self.update_saved_ip(valid_ip)
            return valid_ip

        log.warning("Camera auto-discovery could not locate an active RTSP camera on probed subnets.")
        return None

    def stream_url(self, stream_path: str) -> str:
        if self.test_video_path:
            return f"offline-video://{Path(self.test_video_path).name}"
        if not self.username or not self.password or not self.camera_ip:
            raise ValueError("Set CAMERA_USERNAME, CAMERA_PASSWORD, and CAMERA_IP in camera-gateway/.env.")
        try:
            address = ipaddress.ip_address(self.camera_ip)
        except ValueError as error:
            raise ValueError("CAMERA_IP must be a private local IP address.") from error
        if not address.is_private:
            raise ValueError("CAMERA_IP must be a private local IP address.")
        if not stream_path.startswith("/") or any(character in stream_path for character in "?#\r\n"):
            raise ValueError("CAMERA_STREAM_PATH must be a simple RTSP path such as /stream1.")
        host = f"[{self.camera_ip}]" if address.version == 6 else self.camera_ip
        return f"rtsp://{quote(self.username, safe='')}:{quote(self.password, safe='')}@{host}:{self.port}{stream_path}"

    def connect(self, stream_path: str) -> cv2.VideoCapture:
        self.disconnect()
        if self.test_video_path:
            video_path = Path(self.test_video_path).expanduser().resolve()
            if not video_path.is_file():
                raise FileNotFoundError(f"Configured local CCTV test video was not found: {video_path}")
            capture = cv2.VideoCapture(str(video_path))
            if not capture.isOpened():
                capture.release()
                raise ValueError("Configured local CCTV test video could not be decoded.")
            fps = capture.get(cv2.CAP_PROP_FPS)
            self._test_video_fps = fps if 0 < fps <= 240 else 10.0
            capture.set(cv2.CAP_PROP_POS_MSEC, self.test_video_start_seconds * 1_000)
            self._test_video_started_at = time.monotonic()
            self._test_video_frame_index = 0
            with self._lock:
                self._capture = capture
            return capture
        route_ip = local_route_ip(self.camera_ip, self.port) if self.camera_ip else None
        if route_ip:
            log.info(
                "RTSP connection to the configured camera follows the local interface route (source IP=%s).",
                route_ip,
            )
        else:
            log.warning("No local interface route is available to the configured camera address.")
        if not self.is_online(1.0):
            self.discover_camera()
        url = self.stream_url(stream_path)
        parameters: list[int] = []
        if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
            parameters.extend([cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 8_000])
        if hasattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC"):
            parameters.extend([cv2.CAP_PROP_READ_TIMEOUT_MSEC, 8_000])
        capture = cv2.VideoCapture(url, cv2.CAP_FFMPEG, parameters) if parameters else cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        try:
            capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass
        with self._lock:
            self._capture = capture
        return capture

    def get_stream(self) -> tuple[bool, Any | None]:
        with self._lock:
            capture = self._capture
        if capture is None:
            return False, None
        if self.test_video_path:
            frame_elapsed = self._test_video_frame_index / (self._test_video_fps * self.test_video_speed)
            if self.test_video_duration_seconds and frame_elapsed >= self.test_video_duration_seconds:
                return False, None
            next_frame_at = self._test_video_started_at + frame_elapsed
            remaining = next_frame_at - time.monotonic()
            if remaining > 0:
                time.sleep(remaining)
        received, frame = capture.read()
        if received and frame is not None:
            with self._lock:
                self._last_frame_at = time.monotonic()
            if self.test_video_path:
                self._test_video_frame_index += 1
        return bool(received), frame if received else None

    def is_online(self, timeout_seconds: float = 2.0) -> bool:
        if self.test_video_path:
            return Path(self.test_video_path).expanduser().is_file()
        if self.camera_ip and probe_tcp(self.camera_ip, self.port, timeout_seconds):
            return True
        discovered = self.discover_camera()
        if discovered and probe_tcp(discovered, self.port, timeout_seconds):
            return True
        return False

    def get_status(self, stream_timeout_seconds: int = 90) -> dict[str, bool]:
        with self._lock:
            frame_is_recent = self._last_frame_at > 0 and time.monotonic() - self._last_frame_at <= stream_timeout_seconds
        reachable = self.is_online()
        return {
            "camera_reachable": reachable,
            "stream_available": reachable and frame_is_recent,
        }

    def disconnect(self) -> None:
        with self._lock:
            capture, self._capture = self._capture, None
        if capture is not None:
            capture.release()
