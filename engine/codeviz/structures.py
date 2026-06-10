"""Common data structures used by LeetCode-style snippets.

These classes are injected into user code when the source references
``TreeNode`` / ``ListNode`` without defining them, and the builders are
exposed to the input DSL as ``tree(...)`` and ``linked(...)``.
"""

from __future__ import annotations

from collections import deque
from typing import Any, Iterable, Optional


class TreeNode:
    """Binary tree node compatible with LeetCode's definition."""

    def __init__(
        self,
        val: Any = 0,
        left: Optional["TreeNode"] = None,
        right: Optional["TreeNode"] = None,
    ) -> None:
        self.val = val
        self.left = left
        self.right = right

    def __repr__(self) -> str:
        return f"TreeNode({tree_to_list(self)!r})"


class ListNode:
    """Singly linked list node compatible with LeetCode's definition."""

    def __init__(self, val: Any = 0, next: Optional["ListNode"] = None) -> None:
        self.val = val
        self.next = next

    def __repr__(self) -> str:
        values, cyclic = linked_list_to_list(self)
        suffix = ", cyclic" if cyclic else ""
        return f"ListNode({values!r}{suffix})"


def build_tree(values: Iterable[Any]) -> Optional[TreeNode]:
    """Build a binary tree from a level-order list with ``None`` gaps.

    ``build_tree([1, 2, 3, None, 4])`` produces the same tree LeetCode
    would for that input.
    """
    items = list(values)
    if not items or items[0] is None:
        return None

    root = TreeNode(items[0])
    queue: deque[TreeNode] = deque([root])
    index = 1
    while queue and index < len(items):
        node = queue.popleft()
        if index < len(items):
            value = items[index]
            index += 1
            if value is not None:
                node.left = TreeNode(value)
                queue.append(node.left)
        if index < len(items):
            value = items[index]
            index += 1
            if value is not None:
                node.right = TreeNode(value)
                queue.append(node.right)
    return root


def tree_to_list(root: Optional[TreeNode]) -> list[Any]:
    """Serialize a tree back to a level-order list, trimming trailing ``None``s."""
    if root is None:
        return []

    result: list[Any] = []
    queue: deque[Optional[TreeNode]] = deque([root])
    while queue:
        node = queue.popleft()
        if node is None:
            result.append(None)
            continue
        result.append(node.val)
        queue.append(node.left)
        queue.append(node.right)

    while result and result[-1] is None:
        result.pop()
    return result


def build_linked_list(values: Iterable[Any]) -> Optional[ListNode]:
    """Build a singly linked list from an iterable of values."""
    head: Optional[ListNode] = None
    tail: Optional[ListNode] = None
    for value in values:
        node = ListNode(value)
        if tail is None:
            head = node
        else:
            tail.next = node
        tail = node
    return head


def linked_list_to_list(
    head: Optional[ListNode], max_nodes: int = 64
) -> tuple[list[Any], bool]:
    """Collect values from a linked list.

    Returns ``(values, cyclic)`` where ``cyclic`` is True if a cycle was
    detected (or the walk was cut off at ``max_nodes``).
    """
    values: list[Any] = []
    seen: set[int] = set()
    node = head
    while node is not None and len(values) < max_nodes:
        if id(node) in seen:
            return values, True
        seen.add(id(node))
        values.append(node.val)
        node = node.next
    return values, node is not None
