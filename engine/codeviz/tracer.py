"""``sys.settrace`` execution tracer with safety limits.

Records one step per call/line/return/exception event inside user code
(identified by filename). Each step snapshots the full user call stack
with encoded locals, so the UI can navigate time freely and diff
variables between steps.

Safeguards:

* ``max_steps`` — recording stops and execution is aborted via
  :class:`TraceLimitError` once the cap is hit (the partial trace is kept).
* ``max_seconds`` — wall-clock guard checked periodically, independent of
  the worker-level timeout.
* All values pass through :class:`~codeviz.serialize.Snapshotter`, which
  truncates huge structures.
"""

from __future__ import annotations

import sys
import time
import types
from types import FrameType
from typing import Any, Callable, Optional

from .serialize import Snapshotter

DEFAULT_MAX_STEPS = 3000
DEFAULT_MAX_SECONDS = 8.0
MAX_DETAILED_FRAMES = 12
_TIME_CHECK_EVERY = 256

_HIDDEN_PREFIXES = ("__codeviz", "_codeviz")


class TraceLimitError(RuntimeError):
    """Raised inside traced code to abort execution when a limit is hit."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class Tracer:
    """Line-by-line tracer producing JSON-friendly steps.

    Usage::

        tracer = Tracer(filename="<user_code>", stdout_len=lambda: len(buf.getvalue()))
        with tracer:
            exec(code, globals_dict)
        steps = tracer.steps
    """

    def __init__(
        self,
        filename: str = "<user_code>",
        snapshotter: Optional[Snapshotter] = None,
        max_steps: int = DEFAULT_MAX_STEPS,
        max_seconds: float = DEFAULT_MAX_SECONDS,
        stdout_len: Optional[Callable[[], int]] = None,
        count_only: bool = False,
    ) -> None:
        self.filename = filename
        self.snapshotter = snapshotter or Snapshotter()
        self.max_steps = max_steps
        self.max_seconds = max_seconds
        self.stdout_len = stdout_len or (lambda: 0)
        self.count_only = count_only
        self.steps: list[dict[str, Any]] = []
        self.op_count = 0
        self.truncated = False
        self.truncation_reason: Optional[str] = None
        self._started_at = 0.0

    # -- context manager -------------------------------------------------

    def __enter__(self) -> "Tracer":
        self._started_at = time.monotonic()
        sys.settrace(self._trace)
        return self

    def __exit__(self, *exc_info: object) -> None:
        sys.settrace(None)

    # -- internals --------------------------------------------------------

    def _is_user_frame(self, frame: FrameType) -> bool:
        return frame.f_code.co_filename == self.filename

    def _check_limits(self) -> None:
        if self.op_count % _TIME_CHECK_EVERY == 0:
            if time.monotonic() - self._started_at > self.max_seconds:
                self.truncated = True
                self.truncation_reason = (
                    f"Execution exceeded {self.max_seconds:.0f}s and was stopped."
                )
                raise TraceLimitError(self.truncation_reason)
        if not self.count_only and len(self.steps) >= self.max_steps:
            self.truncated = True
            self.truncation_reason = (
                f"Trace limit of {self.max_steps} steps reached; execution was stopped."
            )
            raise TraceLimitError(self.truncation_reason)

    def _snapshot_locals(self, frame: FrameType) -> dict[str, Any]:
        snapshot: dict[str, Any] = {}
        for name, value in frame.f_locals.items():
            if name.startswith(_HIDDEN_PREFIXES) or name.startswith("__"):
                continue
            snapshot[name] = self.snapshotter.snapshot(value)
        return snapshot

    def _snapshot_globals(self, frame: FrameType) -> dict[str, Any]:
        snapshot: dict[str, Any] = {}
        for name, value in frame.f_globals.items():
            if name.startswith(_HIDDEN_PREFIXES) or name.startswith("__"):
                continue
            if isinstance(value, types.ModuleType):
                continue
            if name in ("tree", "linked") and callable(value):
                continue
            snapshot[name] = self.snapshotter.snapshot(value)
        return snapshot

    def _snapshot_stack(self, frame: FrameType) -> list[dict[str, Any]]:
        """Snapshot the user portion of the stack, bottom (oldest) first.

        Locals are captured only for the top ``MAX_DETAILED_FRAMES`` frames;
        deeper frames keep function/line metadata with ``elided: True`` so
        deep recursion stays memory-bounded.
        """
        frames: list[dict[str, Any]] = []
        current: Optional[FrameType] = frame
        position = 0
        while current is not None and self._is_user_frame(current):
            entry: dict[str, Any] = {
                "id": f"frame-{id(current)}",
                "func": current.f_code.co_name,
                "qualname": getattr(current.f_code, "co_qualname", current.f_code.co_name),
                "line": current.f_lineno,
            }
            if position < MAX_DETAILED_FRAMES:
                entry["locals"] = self._snapshot_locals(current)
            else:
                entry["locals"] = {}
                entry["elided"] = True
            frames.append(entry)
            current = current.f_back
            position += 1
        frames.reverse()
        return frames

    def _record(self, event: str, frame: FrameType, arg: Any) -> None:
        self.op_count += 1
        self._check_limits()
        if self.count_only:
            return

        stack = self._snapshot_stack(frame)
        # At module level the frame locals *are* the globals; skip the duplicate.
        is_module_bottom = bool(stack) and stack[0]["func"] == "<module>"
        step: dict[str, Any] = {
            "i": len(self.steps),
            "event": event,
            "line": frame.f_lineno,
            "func": frame.f_code.co_name,
            "stack": stack,
            "globals": {} if is_module_bottom else self._snapshot_globals(frame),
            "stdoutLen": self.stdout_len(),
        }
        if event == "return":
            step["ret"] = self.snapshotter.snapshot(arg)
        if event == "exception" and arg is not None:
            exc_type, exc_value, _ = arg
            if exc_type is TraceLimitError:
                return
            step["exc"] = {"type": exc_type.__name__, "msg": str(exc_value)}
        self.steps.append(step)

    def _trace(self, frame: FrameType, event: str, arg: Any) -> Optional[Callable]:
        if not self._is_user_frame(frame):
            return None
        if event in ("call", "line", "return", "exception"):
            self._record(event, frame, arg)
        return self._trace
