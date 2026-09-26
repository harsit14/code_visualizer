"""Names that LeetCode-style Python environments provide without imports.

LeetCode runs Python solutions after ``from collections import *``,
``from heapq import *``, ``from typing import *`` and similar lines, so pasted
solutions often use ``defaultdict``, ``Counter``, ``deque``, ``heappush``,
``bisect_left``, ``inf`` or ``lru_cache`` without importing them.

Only names the program actually reads, and never binds itself, are injected.
Builtins are never shadowed, so ``pow(a, b, mod)`` keeps working even though
``math.pow`` exists. Injected names are hidden from snapshots unless the program
rebinds them, keeping the Variables panel about the learner's own state.
"""

from __future__ import annotations

import ast
import bisect
import builtins
import collections
import difflib
import functools
import heapq
import itertools
import math
import operator
import random
import re
import string
import typing
from types import ModuleType
from typing import Any, Optional

# Earlier modules win on name clashes, so collections.Counter beats typing.Counter.
_STAR_MODULES: tuple[ModuleType, ...] = (
    collections,
    heapq,
    bisect,
    itertools,
    functools,
    math,
    typing,
)
_MODULES: tuple[ModuleType, ...] = (
    bisect,
    collections,
    functools,
    heapq,
    itertools,
    math,
    operator,
    random,
    re,
    string,
    typing,
)


def _public_names(module: ModuleType) -> list[str]:
    names = getattr(module, "__all__", None)
    if names is None:
        names = [name for name in dir(module) if not name.startswith("_")]
    return list(names)


def _catalog() -> dict[str, Any]:
    catalog: dict[str, Any] = {}
    for module in _STAR_MODULES:
        for name in _public_names(module):
            if hasattr(builtins, name) or not hasattr(module, name):
                continue
            catalog.setdefault(name, getattr(module, name))
    for module in _MODULES:
        catalog.setdefault(module.__name__, module)
    return catalog


PRELUDE: dict[str, Any] = _catalog()


def _read_and_bound_names(tree: ast.AST) -> tuple[set[str], set[str]]:
    read: set[str] = set()
    bound: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            (read if isinstance(node.ctx, ast.Load) else bound).add(node.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound.add(node.name)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                bound.add((alias.asname or alias.name).split(".")[0])
        elif isinstance(node, ast.arg):
            bound.add(node.arg)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            bound.add(node.name)
    return read, bound


def prelude_for(source: str) -> dict[str, Any]:
    """The prelude names ``source`` reads without defining or importing them."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return {}
    read, bound = _read_and_bound_names(tree)
    return {name: PRELUDE[name] for name in sorted(read - bound) if name in PRELUDE}


def is_hidden_prelude(name: str, value: Any, injected: dict[str, Any]) -> bool:
    """True while ``name`` still holds the object the prelude injected."""
    return name in injected and value is injected[name]


def _closest(name: str, candidates: set[str]) -> Optional[str]:
    matches = difflib.get_close_matches(name, sorted(candidates - {name}), n=1, cutoff=0.75)
    return matches[0] if matches else None


def exception_message(
    exc: BaseException,
    local_names: Optional[dict[str, Any]] = None,
    global_names: Optional[dict[str, Any]] = None,
) -> str:
    """``str(exc)`` plus a "Did you mean …?" hint for misspelled names and attributes.

    Python prints these hints only in tracebacks; learners see the message.
    """
    message = str(exc)
    if "Did you mean" in message:
        return message
    suggestion: Optional[str] = None
    try:
        if isinstance(exc, NameError) and getattr(exc, "name", None):
            candidates = (
                set(local_names or {}) | set(global_names or {}) | set(dir(builtins)) | set(PRELUDE)
            )
            suggestion = _closest(exc.name, {n for n in candidates if not n.startswith("__")})
        elif isinstance(exc, AttributeError) and getattr(exc, "name", None):
            target = getattr(exc, "obj", None)
            if target is not None:
                # object.__dir__ lists attributes without running a custom __dir__.
                names = {n for n in object.__dir__(target) if not n.startswith("_")}
                suggestion = _closest(exc.name, names)
    except Exception:
        suggestion = None
    return f"{message}. Did you mean '{suggestion}'?" if suggestion else message
