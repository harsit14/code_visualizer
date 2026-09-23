"""Bounded, typed assertions on actual return values, never display previews.

Only exact builtin types are traversed. User equality, repr, properties and
iterators are not invoked. Unsupported/cyclic/oversized values are unscored.
"""
from __future__ import annotations

import ast
import math
from typing import Any

MAX_EXPECTED_CHARS = 10_000
MAX_NODES = 10_000
MAX_VALUE_CHARS = 100_000
MAX_DEPTH = 32


class InconclusiveValue(ValueError):
    pass


def _canonical(value: Any, budget: list[int], active: set[int], depth: int = 0) -> Any:
    budget[0] -= 1
    if budget[0] < 0 or depth > MAX_DEPTH:
        raise InconclusiveValue("Value exceeds the assertion size or depth limit.")
    kind = type(value)
    if value is None or kind in (bool, int, float, str, bytes):
        if kind is float and not math.isfinite(value):
            raise InconclusiveValue("Non-finite numbers need an explicit comparison policy.")
        if kind is int and value.bit_length() > 32_000:
            raise InconclusiveValue("Integer exceeds the assertion size limit.")
        budget[1] -= len(value) if kind in (str, bytes) else 32
        if budget[1] < 0:
            raise InconclusiveValue("Value exceeds the assertion size limit.")
        return (kind.__name__, value)
    if kind not in (list, tuple, dict, set, frozenset):
        raise InconclusiveValue("Exact comparison supports Python literals, not custom objects.")
    if id(value) in active:
        raise InconclusiveValue("Cyclic values cannot be compared to a Python literal.")
    if len(value) > budget[0]:
        raise InconclusiveValue("Value exceeds the assertion item limit.")
    active.add(id(value))
    try:
        if kind is dict:
            items = [(_canonical(k, budget, active, depth + 1),
                      _canonical(v, budget, active, depth + 1)) for k, v in value.items()]
            items.sort(key=repr)
        else:
            items = [_canonical(v, budget, active, depth + 1) for v in value]
            if kind in (set, frozenset):
                items.sort(key=repr)
        return (kind.__name__, tuple(items))
    finally:
        active.remove(id(value))


def assess_return(value: Any, expected: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "status": "unscored", "message": None, "actualLiteral": None,
        "expected": expected,
    }
    try:
        actual = _canonical(value, [MAX_NODES, MAX_VALUE_CHARS], set())
        # Traversal established that repr cannot call user-defined methods.
        literal = repr(value)
        if len(literal) <= MAX_EXPECTED_CHARS:
            try:
                parsed_literal = ast.literal_eval(literal)
                if _canonical(parsed_literal, [MAX_NODES, MAX_VALUE_CHARS], set()) == actual:
                    result["actualLiteral"] = literal
            except (ValueError, SyntaxError, RecursionError, TypeError):
                pass
    except (InconclusiveValue, ValueError, RecursionError) as exc:
        result.update(status="inconclusive", message=str(exc))
        return result
    if expected is None or not expected.strip():
        return result
    try:
        if len(expected) > MAX_EXPECTED_CHARS:
            raise ValueError("Expected value exceeds 10,000 characters.")
        parsed = ast.literal_eval(expected)
        target = _canonical(parsed, [MAX_NODES, MAX_VALUE_CHARS], set())
    except (ValueError, SyntaxError, RecursionError, TypeError) as exc:
        result.update(status="invalid", message=f"Expected output must be a supported Python literal: {exc}")
        return result
    result["status"] = "pass" if actual == target else "fail"
    return result
