from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


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
                "confidence": item.get("confidence"),
                "config_revision": item.get("config_revision"),
            }
            if clean_item != item:
                self._needs_save = True
            normalized.append(clean_item)
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

    def __len__(self) -> int:
        return len(self._items)
