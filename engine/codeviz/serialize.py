"""Value snapshotting into a JSON-friendly encoding.

Every traced step snapshots frame locals (and module globals) through a
:class:`Snapshotter`. The encoding is a small tagged-union dialect the UI
renders structure-aware:

* ``{"k": "num", "t": "int", "v": "5"}`` — numbers / bools
* ``{"k": "str", "v": "abc", "truncated": false}``
* ``{"k": "none"}``
* ``{"k": "seq", "t": "list"|"tuple"|"deque"|..., "id": 3,
  "items": [...], "len": 4, "truncated": false}`` — sized iterables
* ``{"k": "dict", "t": "dict"|"defaultdict"|..., "id": 4,
  "entries": [[keyEnc, valEnc], ...], "len": 2, "truncated": false}``
* ``{"k": "tree", "id": 5, "val": enc, "left": enc|None, "right": enc|None}``
* ``{"k": "listnode", "id": 6, "nodes": [{"id": 7, "val": enc}, ...],
  "cyclic": false, "truncated": false}`` — the chain starting at a node
* ``{"k": "func", "name": "twoSum"}``
* ``{"k": "obj", "id": 8, "t": "Interval", "attrs": {...}, "preview": "..."}``
* ``{"k": "ref", "id": 3}`` — back-reference for cycles/aliases within one value
* ``{"k": "repr", "t": "module", "v": "<module ...>"}`` — fallback

``id`` values are stable per Python object across the whole trace, so the
UI can detect aliasing and diff by identity.
"""

from __future__ import annotations

from array import array
from collections import Counter, OrderedDict, defaultdict, deque
import re
import types
from typing import Any

MAX_DEPTH = 4
MAX_TREE_DEPTH = 8
MAX_ITEMS = 24
MAX_CHAIN_NODES = 24
MAX_STR = 120
MAX_REPR = 120

JsonValue = Any  # JSON-serializable dict/list/str/int/float/bool/None

#: Matches the volatile address in CPython's default object repr,
#: e.g. ``<__main__.Solution object at 0x10721e8>``. Stripping it keeps
#: previews stable across runs so exported/shared traces don't churn.
_DEFAULT_REPR_ADDRESS = re.compile(r"(<.*? object) at 0x[0-9A-Fa-f]+>")


def _strip_default_repr_address(text: str) -> str:
    """Drop ``at 0x…`` from a default object repr; other reprs pass through."""
    return _DEFAULT_REPR_ADDRESS.sub(r"\1>", text)


def _safe_builtin_repr(value: Any, limit: int = MAX_REPR) -> str:
    """Return a representation without dispatching to user-defined ``__repr__``."""
    try:
        text = object.__repr__(value)
    except BaseException:
        text = f"<{_type_name(value)} object>"
    if len(text) > limit:
        return text[: limit - 3] + "..."
    return text


def _type_name(value: Any) -> str:
    try:
        return type.__getattribute__(type(value), "__name__")
    except BaseException:
        return "object"


def _raw_attrs(value: Any) -> dict[str, Any]:
    """Read an instance dictionary without invoking its attribute hooks."""
    try:
        attrs = object.__getattribute__(value, "__dict__")
    except BaseException:
        return {}
    return attrs if type(attrs) is dict else {}


_SAFE_SEQUENCE_TYPES = (list, tuple, set, frozenset, range, deque, array)
_SAFE_MAPPING_TYPES = (dict, OrderedDict, defaultdict, Counter)


def looks_like_tree(value: Any) -> bool:
    """Duck-typed binary tree node using raw attributes only."""
    attrs = _raw_attrs(value)
    return not isinstance(value, type) and all(attr in attrs for attr in ("val", "left", "right"))


def looks_like_listnode(value: Any) -> bool:
    """Duck-typed linked-list node using raw attributes only."""
    attrs = _raw_attrs(value)
    return not isinstance(value, type) and "val" in attrs and "next" in attrs and "left" not in attrs


class Snapshotter:
    """Encodes runtime values, assigning stable small integer object ids."""

    def __init__(self) -> None:
        self._object_ids: dict[int, int] = {}
        self._next_id = 1

    def object_id(self, value: Any) -> int:
        """Return a stable small id for ``value`` (allocating on first sight)."""
        key = id(value)
        existing = self._object_ids.get(key)
        if existing is not None:
            return existing
        allocated = self._next_id
        self._next_id += 1
        self._object_ids[key] = allocated
        return allocated

    def snapshot(self, value: Any, depth: int = 0, seen: set[int] | None = None) -> JsonValue:
        """Encode ``value`` into the JSON dialect described in the module docstring."""
        if seen is None:
            seen = set()

        if value is None:
            return {"k": "none"}
        if type(value) is bool:
            return {"k": "num", "t": "bool", "v": "True" if value else "False"}
        if type(value) in (int, float, complex):
            return {"k": "num", "t": _type_name(value), "v": repr(value)}
        if type(value) is str:
            truncated = len(value) > MAX_STR
            return {
                "k": "str",
                "v": value[:MAX_STR],
                "len": len(value),
                "truncated": truncated,
            }
        if type(value) in (bytes, bytearray):
            return {"k": "repr", "t": _type_name(value), "v": repr(value)}

        if id(value) in seen:
            return {"k": "ref", "id": self.object_id(value)}

        if type(value) in (types.FunctionType, types.BuiltinFunctionType, types.MethodType, type):
            name = getattr(value, "__name__", None) or _type_name(value)
            return {"k": "func", "name": name}
        if type(value) is types.ModuleType:
            return {"k": "repr", "t": "module", "v": object.__repr__(value)}

        if looks_like_tree(value):
            return self._snapshot_tree(value, depth, seen)
        if looks_like_listnode(value):
            return self._snapshot_chain(value, depth, seen)

        if type(value) in _SAFE_MAPPING_TYPES:
            return self._snapshot_mapping(value, depth, seen)
        if type(value) in _SAFE_SEQUENCE_TYPES:
            return self._snapshot_sequence(value, depth, seen)

        return self._snapshot_object(value, depth, seen)

    def _snapshot_sequence(
        self, value: Any, depth: int, seen: set[int]
    ) -> JsonValue:
        obj_id = self.object_id(value)
        type_name = _type_name(value)
        if depth >= MAX_DEPTH:
            return {"k": "repr", "t": type_name, "v": _safe_builtin_repr(value), "id": obj_id}

        seen = seen | {id(value)}
        items = []
        truncated = False
        try:
            for index, item in enumerate(value):
                if index >= MAX_ITEMS:
                    truncated = True
                    break
                items.append(self.snapshot(item, depth + 1, seen))
        except BaseException:
            return {"k": "repr", "t": type_name, "v": _safe_builtin_repr(value), "id": obj_id}
        return {
            "k": "seq",
            "t": type_name,
            "id": obj_id,
            "items": items,
            "len": len(value),
            "truncated": truncated,
        }

    def _snapshot_mapping(self, value: Any, depth: int, seen: set[int]) -> JsonValue:
        obj_id = self.object_id(value)
        type_name = _type_name(value)
        if depth >= MAX_DEPTH:
            return {"k": "repr", "t": type_name, "v": _safe_builtin_repr(value), "id": obj_id}

        seen = seen | {id(value)}
        entries = []
        truncated = False
        try:
            for index, (key, item) in enumerate(value.items()):
                if index >= MAX_ITEMS:
                    truncated = True
                    break
                entries.append(
                    [self.snapshot(key, depth + 1, seen), self.snapshot(item, depth + 1, seen)]
                )
        except BaseException:
            return {"k": "repr", "t": type_name, "v": _safe_builtin_repr(value), "id": obj_id}
        return {
            "k": "dict",
            "t": type_name,
            "id": obj_id,
            "entries": entries,
            "len": len(value),
            "truncated": truncated,
        }

    def _snapshot_tree(self, node: Any, depth: int, seen: set[int]) -> JsonValue:
        obj_id = self.object_id(node)
        if depth >= MAX_TREE_DEPTH:
            return {
                "k": "repr",
                "t": _type_name(node),
                "v": _safe_builtin_repr(node),
                "id": obj_id,
            }

        seen = seen | {id(node)}
        attrs = _raw_attrs(node)

        def encode_child(child: Any) -> JsonValue | None:
            if child is None:
                return None
            if id(child) in seen:
                return {"k": "ref", "id": self.object_id(child)}
            return self.snapshot(child, depth + 1, seen)

        return {
            "k": "tree",
            "id": obj_id,
            "val": self.snapshot(attrs["val"], depth + 1, seen),
            "left": encode_child(attrs["left"]),
            "right": encode_child(attrs["right"]),
        }

    def _snapshot_chain(self, head: Any, depth: int, seen: set[int]) -> JsonValue:
        nodes = []
        cyclic = False
        truncated = False
        walk_seen: set[int] = set()
        full_seen = seen.copy()
        node = head
        while node is not None:
            attrs = _raw_attrs(node)
            if "val" not in attrs or "next" not in attrs:
                break
            if id(node) in walk_seen:
                cyclic = True
                break
            if len(nodes) >= MAX_CHAIN_NODES:
                truncated = True
                break
            walk_seen.add(id(node))
            full_seen.add(id(node))
            nodes.append(
                {
                    "id": self.object_id(node),
                    "val": self.snapshot(attrs["val"], depth + 1, full_seen),
                }
            )
            node = attrs["next"]
            if node is not None and not looks_like_listnode(node):
                break
        return {
            "k": "listnode",
            "id": self.object_id(head),
            "nodes": nodes,
            "cyclic": cyclic,
            "truncated": truncated,
        }

    def _snapshot_object(self, value: Any, depth: int, seen: set[int]) -> JsonValue:
        obj_id = self.object_id(value)
        type_name = _type_name(value)
        attrs: dict[str, JsonValue] = {}
        if depth < MAX_DEPTH:
            seen = seen | {id(value)}
            raw_attrs = _raw_attrs(value)
            for index, (name, attr) in enumerate(raw_attrs.items()):
                if index >= MAX_ITEMS:
                    break
                if name.startswith("__"):
                    continue
                attrs[name] = self.snapshot(attr, depth + 1, seen)
        return {
            "k": "obj",
            "id": obj_id,
            "t": type_name,
            "attrs": attrs,
            "preview": _strip_default_repr_address(_safe_builtin_repr(value)),
        }
