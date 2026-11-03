from __future__ import annotations

import os
from pathlib import Path
from typing import BinaryIO


class GatewayProcessLock:
    """Hold an OS-managed lock so only one process opens the camera pipeline."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._handle: BinaryIO | None = None
        self._platform_lock: object | None = None

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.path.open("a+b")
        try:
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)

            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                self._platform_lock = msvcrt
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                self._platform_lock = fcntl

            handle.seek(0)
            handle.truncate()
            handle.write(str(os.getpid()).encode("ascii"))
            handle.flush()
            self._handle = handle
            return True
        except (BlockingIOError, OSError):
            handle.close()
            return False

    def release(self) -> None:
        handle, self._handle = self._handle, None
        platform_lock, self._platform_lock = self._platform_lock, None
        if handle is None or platform_lock is None:
            return
        try:
            handle.seek(0)
            if os.name == "nt":
                platform_lock.locking(handle.fileno(), platform_lock.LK_UNLCK, 1)
            else:
                platform_lock.flock(handle.fileno(), platform_lock.LOCK_UN)
        except OSError:
            pass
        finally:
            handle.close()
