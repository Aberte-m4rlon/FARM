from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


log = logging.getLogger("alpasfarm.camera_gateway.outbox")


class CrossingOutbox:
    """Durable, idempotent queue for crossings awaiting database confirmation."""

    def __init__(self, path: Path, *, max_items: int = 10_000) -> None:
        self.path = path
        self.max_items = max_items
        self._needs_save = False
        self._items = self._read()
        if self._needs_save:
            self._save()

    def _read(self) -> list[dict[str, Any]]:
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return []
        except (OSError, json.JSONDecodeError):
            raise RuntimeError(f"Could not read the camera crossing outbox: {self.path}")
        if not isinstance(value, list):
            raise RuntimeError(f"Camera crossing outbox is not a list: {self.path}")
        normalized: list[dict[str, Any]] = []
        discarded_unverified = 0
        for item in value:
            if not isinstance(item, dict) or not isinstance(item.get("event_key"), str):
                continue
            animal_type = item.get("animal_type", item.get("species_detected"))
            clean_item = {
                "session_id": item.get("session_id"),
                "event_key": item["event_key"],
                "tracking_id": item.get("tracking_id"),
                "animal_type": animal_type,
                "direction": item.get("direction"),
                "event_type": item.get("event_type"),
                "crossing_direction": item.get("crossing_direction"),
                "previous_side": item.get("previous_side"),
                "current_side": item.get("current_side"),
                "previous_centroid": item.get("previous_centroid"),
                "current_centroid": item.get("current_centroid"),
                "line_y": item.get("line_y"),
                "crossing_margin": item.get("crossing_margin"),
                "frame_width": item.get("frame_width"),
                "frame_height": item.get("frame_height"),
                "minimum_displacement_px": item.get("minimum_displacement_px"),
                "track_state": item.get("track_state"),
                "validation_status": item.get("validation_status"),
                "confidence": item.get("confidence"),
                "config_revision": item.get("config_revision"),
            }
            if not all(clean_item.get(key) is not None for key in (
                "event_type",
                "crossing_direction",
                "previous_side",
                "current_side",
                "previous_centroid",
                "current_centroid",
                "line_y",
                "crossing_margin",
                "frame_width",
                "frame_height",
                "minimum_displacement_px",
                "track_state",
                "validation_status",
            )):
                discarded_unverified += 1
                self._needs_save = True
                continue
            if clean_item != item:
                self._needs_save = True
            normalized.append(clean_item)
        if discarded_unverified:
            log.warning(
                "Discarded %s pending camera crossing(s) without saved geometric validation evidence.",
                discarded_unverified,
            )
        return normalized

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self.path.with_suffix(self.path.suffix + ".tmp")
        try:
            with temporary_path.open("w", encoding="utf-8", newline="\n") as handle:
                json.dump(self._items, handle, separators=(",", ":"), ensure_ascii=True)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, self.path)
        except OSError:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise

    def enqueue(self, events: list[dict[str, Any]]) -> None:
        known = {item["event_key"] for item in self._items}
        additions = [event for event in events if isinstance(event, dict)
                     and isinstance(event.get("event_key"), str)
                     and event["event_key"] not in known]
        if len(self._items) + len(additions) > self.max_items:
            raise OverflowError("Camera crossing outbox is full; refusing to silently drop crossings.")
        if not additions:
            return
        self._items.extend(additions)
        self._save()

    def pending(self, limit: int = 100) -> list[dict[str, Any]]:
        return [dict(item) for item in self._items[:max(0, limit)]]

    def acknowledge(self, event_keys: list[str]) -> None:
        if not event_keys:
            return
        accepted = set(event_keys)
        remaining = [item for item in self._items if item.get("event_key") not in accepted]
        if len(remaining) == len(self._items):
            return
        self._items = remaining
        self._save()

    def archive_unrecorded(self, outcomes: list[dict[str, str]]) -> int:
        if not outcomes:
            return 0

        pending_by_key = {item["event_key"]: item for item in self._items}
        archive_path = self.path.with_name(f"{self.path.stem}-unrecorded{self.path.suffix}")
        try:
            existing = json.loads(archive_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            existing = []
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Could not read the camera unrecorded-crossing archive: {archive_path}") from error
        if not isinstance(existing, list) or any(not isinstance(item, dict) for item in existing):
            raise RuntimeError(f"Camera unrecorded-crossing archive is invalid: {archive_path}")

        archived_keys = {
            item.get("event_key") for item in existing if isinstance(item.get("event_key"), str)
        }
        archived_at = datetime.now(timezone.utc).isoformat()
        additions: list[dict[str, Any]] = []
        for outcome in outcomes:
            event_key = outcome.get("event_key")
            reason = outcome.get("reason")
            event = pending_by_key.get(event_key)
            if not isinstance(event_key, str) or not isinstance(reason, str) or event is None:
                raise RuntimeError("Database returned an unrecorded crossing that is missing from the local outbox.")
            if event_key in archived_keys:
                continue
            additions.append({**event, "not_recorded_reason": reason, "archived_at": archived_at})
            archived_keys.add(event_key)

        if not additions:
            return 0
        if len(existing) + len(additions) > self.max_items:
            raise OverflowError("Camera unrecorded-crossing archive is full; refusing to drop event evidence.")

        temporary_path = archive_path.with_suffix(archive_path.suffix + ".tmp")
        try:
            archive_path.parent.mkdir(parents=True, exist_ok=True)
            with temporary_path.open("w", encoding="utf-8", newline="\n") as handle:
                json.dump(existing + additions, handle, separators=(",", ":"), ensure_ascii=True)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, archive_path)
        except OSError as error:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise RuntimeError(f"Could not save the camera unrecorded-crossing archive: {archive_path}") from error
        return len(additions)

    def __len__(self) -> int:
        return len(self._items)
