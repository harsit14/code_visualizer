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

from collections.abc import Iterable, Mapping, Sized
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


def _safe_repr(value: Any, limit: int = MAX_REPR) -> str:
    try:
        text = repr(value)
    except BaseException as exc:  # user __repr__ may raise anything
        text = f"<repr failed: {type(exc).__name__}>"
    if len(text) > limit:
        return text[: limit - 3] + "..."
    return text


def _safe_len(value: Any) -> int | None:
    try:
        return len(value)
    except BaseException:
        return None


def _is_sized_iterable(value: Any) -> bool:
    return isinstance(value, Sized) and isinstance(value, Iterable) and _safe_len(value) is not None


def looks_like_tree(value: Any) -> bool:
    """Duck-typed binary tree node: has ``val``, ``left`` and ``right``."""
    cls = type(value)
    return (
        hasattr(cls, "__dict__")
        and not isinstance(value, type)
        and all(hasattr(value, attr) for attr in ("val", "left", "right"))
    )


def looks_like_listnode(value: Any) -> bool:
    """Duck-typed linked list node: has ``val`` and ``next`` but no children."""
    return (
        not isinstance(value, type)
        and hasattr(value, "val")
        and hasattr(value, "next")
        and not hasattr(value, "left")
    )


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
        if isinstance(value, bool):
            return {"k": "num", "t": "bool", "v": "True" if value else "False"}
        if isinstance(value, (int, float, complex)):
            return {"k": "num", "t": type(value).__name__, "v": _safe_repr(value)}
        if isinstance(value, str):
            truncated = len(value) > MAX_STR
            return {
                "k": "str",
                "v": value[:MAX_STR],
                "len": len(value),
                "truncated": truncated,
            }
        if isinstance(value, (bytes, bytearray)):
            return {"k": "repr", "t": type(value).__name__, "v": _safe_repr(value)}

        if id(value) in seen:
            return {"k": "ref", "id": self.object_id(value)}

        if isinstance(
            value,
            (types.FunctionType, types.BuiltinFunctionType, types.MethodType, type),
        ):
            name = getattr(value, "__name__", None) or _safe_repr(value)
            return {"k": "func", "name": name}
        if isinstance(value, types.ModuleType):
            return {"k": "repr", "t": "module", "v": _safe_repr(value)}

        if looks_like_tree(value):
            return self._snapshot_tree(value, depth, seen)
        if looks_like_listnode(value):
            return self._snapshot_chain(value, depth, seen)

        if isinstance(value, Mapping):
            return self._snapshot_mapping(value, depth, seen)
        if _is_sized_iterable(value):
            return self._snapshot_sequence(value, depth, seen)

        return self._snapshot_object(value, depth, seen)

    def _snapshot_sequence(
        self, value: Any, depth: int, seen: set[int]
    ) -> JsonValue:
        obj_id = self.object_id(value)
        type_name = type(value).__name__
        if depth >= MAX_DEPTH:
            return {"k": "repr", "t": type_name, "v": _safe_repr(value), "id": obj_id}

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
            return {"k": "repr", "t": type_name, "v": _safe_repr(value), "id": obj_id}
        return {
            "k": "seq",
            "t": type_name,
            "id": obj_id,
            "items": items,
            "len": _safe_len(value) or len(items),
            "truncated": truncated,
        }

    def _snapshot_mapping(self, value: Mapping[Any, Any], depth: int, seen: set[int]) -> JsonValue:
        obj_id = self.object_id(value)
        type_name = type(value).__name__
        if depth >= MAX_DEPTH:
            return {"k": "repr", "t": type_name, "v": _safe_repr(value), "id": obj_id}

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
            return {"k": "repr", "t": type_name, "v": _safe_repr(value), "id": obj_id}
        return {
            "k": "dict",
            "t": type_name,
            "id": obj_id,
            "entries": entries,
            "len": _safe_len(value) or len(entries),
            "truncated": truncated,
        }

    def _snapshot_tree(self, node: Any, depth: int, seen: set[int]) -> JsonValue:
        obj_id = self.object_id(node)
        if depth >= MAX_TREE_DEPTH:
            return {"k": "repr", "t": type(node).__name__, "v": _safe_repr(node), "id": obj_id}

        seen = seen | {id(node)}

        def encode_child(child: Any) -> JsonValue | None:
            if child is None:
                return None
            if id(child) in seen:
                return {"k": "ref", "id": self.object_id(child)}
            return self.snapshot(child, depth + 1, seen)

        return {
            "k": "tree",
            "id": obj_id,
            "val": self.snapshot(node.val, depth + 1, seen),
            "left": encode_child(node.left),
            "right": encode_child(node.right),
        }

    def _snapshot_chain(self, head: Any, depth: int, seen: set[int]) -> JsonValue:
        nodes = []
        cyclic = False
        truncated = False
        walk_seen: set[int] = set()
        full_seen = seen.copy()
        node = head
        while node is not None:
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
                    "val": self.snapshot(node.val, depth + 1, full_seen),
                }
            )
            node = getattr(node, "next", None)
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
        type_name = type(value).__name__
        attrs: dict[str, JsonValue] = {}
        if depth < MAX_DEPTH:
            seen = seen | {id(value)}
            try:
                raw_attrs = vars(value)
            except TypeError:
                raw_attrs = {}
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
            "preview": _strip_default_repr_address(_safe_repr(value)),
        }
