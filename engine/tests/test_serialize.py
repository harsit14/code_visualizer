from array import array
from collections import Counter, defaultdict, deque

from codeviz.serialize import MAX_ITEMS, MAX_STR, Snapshotter
from codeviz.structures import build_linked_list, build_tree


def test_primitives():
    snap = Snapshotter()
    assert snap.snapshot(5) == {"k": "num", "t": "int", "v": "5"}
    assert snap.snapshot(True) == {"k": "num", "t": "bool", "v": "True"}
    assert snap.snapshot(None) == {"k": "none"}
    assert snap.snapshot("hi") == {"k": "str", "v": "hi", "truncated": False}


def test_long_string_truncated():
    snap = Snapshotter()
    encoded = snap.snapshot("x" * 500)
    assert encoded["truncated"] is True
    assert len(encoded["v"]) == MAX_STR


def test_list_encoding_with_stable_ids():
    snap = Snapshotter()
    value = [1, 2, 3]
    first = snap.snapshot(value)
    second = snap.snapshot(value)
    assert first["k"] == "seq"
    assert first["t"] == "list"
    assert first["len"] == 3
    assert first["id"] == second["id"]  # identity is stable across snapshots


def test_aliasing_detectable_via_ids():
    snap = Snapshotter()
    shared = [1, 2]
    a = snap.snapshot(shared)
    b = snap.snapshot(shared)
    other = snap.snapshot([1, 2])
    assert a["id"] == b["id"]
    assert a["id"] != other["id"]


def test_huge_list_truncated():
    snap = Snapshotter()
    encoded = snap.snapshot(list(range(1000)))
    assert encoded["truncated"] is True
    assert len(encoded["items"]) == MAX_ITEMS
    assert encoded["len"] == 1000


def test_dict_encoding():
    snap = Snapshotter()
    encoded = snap.snapshot({"a": 1})
    assert encoded["k"] == "dict"
    assert encoded["t"] == "dict"
    assert encoded["entries"][0][0]["v"] == "a"
    assert encoded["entries"][0][1]["v"] == "1"


def test_deque_encoding_as_sequence():
    snap = Snapshotter()
    encoded = snap.snapshot(deque([5, 6]))
    assert encoded["k"] == "seq"
    assert encoded["t"] == "deque"
    assert encoded["len"] == 2
    assert [item["v"] for item in encoded["items"]] == ["5", "6"]


def test_stdlib_sized_iterables_encode_as_sequences():
    snap = Snapshotter()
    encoded_range = snap.snapshot(range(3))
    encoded_array = snap.snapshot(array("i", [7, 8]))
    assert encoded_range["k"] == "seq"
    assert encoded_range["t"] == "range"
    assert [item["v"] for item in encoded_range["items"]] == ["0", "1", "2"]
    assert encoded_array["k"] == "seq"
    assert encoded_array["t"] == "array"
    assert [item["v"] for item in encoded_array["items"]] == ["7", "8"]


def test_mapping_subclasses_encode_as_dicts():
    snap = Snapshotter()
    counter = snap.snapshot(Counter(["a", "a", "b"]))
    defaults = defaultdict(int, {"seen": 3})
    encoded_defaultdict = snap.snapshot(defaults)
    assert counter["k"] == "dict"
    assert counter["t"] == "Counter"
    assert counter["len"] == 2
    assert encoded_defaultdict["k"] == "dict"
    assert encoded_defaultdict["t"] == "defaultdict"
    assert encoded_defaultdict["entries"][0][0]["v"] == "seen"


def test_cyclic_list_uses_ref():
    snap = Snapshotter()
    value = [1]
    value.append(value)
    encoded = snap.snapshot(value)
    assert encoded["items"][1] == {"k": "ref", "id": encoded["id"]}


def test_tree_encoding():
    snap = Snapshotter()
    encoded = snap.snapshot(build_tree([1, 2, 3]))
    assert encoded["k"] == "tree"
    assert encoded["val"]["v"] == "1"
    assert encoded["left"]["val"]["v"] == "2"
    assert encoded["right"]["val"]["v"] == "3"


def test_linked_list_encoding_shares_node_ids():
    snap = Snapshotter()
    head = build_linked_list([1, 2, 3])
    head_encoded = snap.snapshot(head)
    mid_encoded = snap.snapshot(head.next)
    assert head_encoded["k"] == "listnode"
    assert [node["val"]["v"] for node in head_encoded["nodes"]] == ["1", "2", "3"]
    # A pointer into the middle of the chain shares node ids with the head chain.
    assert mid_encoded["nodes"][0]["id"] == head_encoded["nodes"][1]["id"]


def test_cyclic_linked_list():
    snap = Snapshotter()
    head = build_linked_list([1, 2])
    head.next.next = head
    encoded = snap.snapshot(head)
    assert encoded["cyclic"] is True


def test_custom_object():
    class Point:
        def __init__(self):
            self.x = 1
            self.y = 2

    snap = Snapshotter()
    encoded = snap.snapshot(Point())
    assert encoded["k"] == "obj"
    assert encoded["t"] == "Point"
    assert encoded["attrs"]["x"]["v"] == "1"


def test_function_encoding():
    snap = Snapshotter()
    encoded = snap.snapshot(len)
    assert encoded == {"k": "func", "name": "len"}
