"""Guided lessons: every checkpoint must land where its explanation says.

The app reads ``src/lessons/lessons.json`` and computes answers from the real
trace. This test runs each lesson through the engine with the same checkpoint
rules and checks the authored ``expected`` values, so lesson text cannot drift
from what learners will actually see.
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path
from typing import Any

import pytest

from codeviz.runner import run_session

LESSONS = json.loads(
    (Path(__file__).resolve().parents[2] / "src" / "lessons" / "lessons.json").read_text()
)

_MISSING = object()
_PATH = re.compile(r"^([A-Za-z_]\w*)(?:\[(.+)\])?$")


def _decode(value: dict[str, Any]) -> Any:
    kind = value["k"]
    if kind == "none":
        return None
    if kind == "num":
        return ast.literal_eval(value["v"])
    if kind == "str":
        return value["v"]
    if kind == "seq":
        items = [_decode(item) for item in value["items"]]
        return tuple(items) if value["t"] == "tuple" else items
    if kind == "dict":
        return {_decode(key): _decode(item) for key, item in value["entries"]}
    raise AssertionError(f"Lesson targets must be plain values, got {kind}")


def _resolve(target: str, locals_: dict[str, Any]) -> Any:
    match = _PATH.match(target)
    assert match, f"Unsupported lesson target {target!r}"
    name, key = match.groups()
    if name not in locals_:
        return _MISSING
    value = _decode(locals_[name])
    if key is None:
        return value
    return value[ast.literal_eval(key)]


def _answer(steps: list[dict[str, Any]], checkpoint: dict[str, Any]) -> tuple[int, Any]:
    visits = [
        index
        for index, step in enumerate(steps)
        if step["event"] == "line" and step["line"] == checkpoint["line"]
    ]
    assert len(visits) >= checkpoint["visit"], f"line {checkpoint['line']} is not visited enough"
    index = visits[checkpoint["visit"] - 1]
    frame_id = steps[index]["stack"][-1]["id"]
    for later in steps[index + 1 :]:
        top = later["stack"][-1] if later["stack"] else None
        if top is None or top["id"] != frame_id:
            continue
        if checkpoint["target"] == "<return>":
            if later["event"] == "return":
                return index, _decode(later["ret"])
            continue
        if later["event"] == "call":
            continue
        return index, _resolve(checkpoint["target"], top["locals"])
    raise AssertionError(f"No answer step for {checkpoint}")


@pytest.mark.parametrize("lesson", LESSONS, ids=[lesson["id"] for lesson in LESSONS])
def test_lesson_checkpoints_match_the_engine(lesson: dict[str, Any]) -> None:
    result = run_session(lesson["code"], mode="script")
    assert result["status"] == "ok", result["error"]
    steps = result["run"]["steps"]
    assert not result["run"]["truncated"]
    seen_steps = set()
    for checkpoint in lesson["checkpoints"]:
        step, actual = _answer(steps, checkpoint)
        assert actual is not _MISSING, f"{checkpoint['target']} is not defined yet"
        assert actual == ast.literal_eval(checkpoint["expected"]), checkpoint["prompt"]
        assert step not in seen_steps, "two checkpoints share a step"
        seen_steps.add(step)


def test_lessons_have_the_required_fields() -> None:
    ids = [lesson["id"] for lesson in LESSONS]
    assert len(ids) == len(set(ids))
    for lesson in LESSONS:
        for field in ("title", "pattern", "goal", "invariant", "code"):
            assert lesson[field].strip()
        assert lesson["checkpoints"]
        for checkpoint in lesson["checkpoints"]:
            assert checkpoint["visit"] >= 1
            assert checkpoint["prompt"].strip() and checkpoint["explanation"].strip()
