from codeviz.structures import (
    build_linked_list,
    build_tree,
    linked_list_to_list,
    tree_to_list,
)


def test_tree_round_trip():
    values = [3, 9, 20, None, None, 15, 7]
    root = build_tree(values)
    assert root is not None
    assert root.val == 3
    assert root.left.val == 9
    assert root.right.left.val == 15
    assert tree_to_list(root) == values


def test_empty_tree():
    assert build_tree([]) is None
    assert tree_to_list(None) == []


def test_tree_with_gaps():
    root = build_tree([1, 2, 3, None, 4])
    assert root.left.right.val == 4
    assert root.left.left is None


def test_linked_list_round_trip():
    head = build_linked_list([1, 2, 3, 4, 5])
    values, cyclic = linked_list_to_list(head)
    assert values == [1, 2, 3, 4, 5]
    assert not cyclic


def test_linked_list_cycle_detection():
    head = build_linked_list([1, 2, 3])
    head.next.next.next = head  # 3 -> 1 cycle
    values, cyclic = linked_list_to_list(head)
    assert values == [1, 2, 3]
    assert cyclic


def test_empty_linked_list():
    assert build_linked_list([]) is None
