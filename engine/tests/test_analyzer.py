from codeviz.analyzer import analyze

TWO_SUM = """
class Solution:
    def twoSum(self, nums, target):
        lookup = {}
        for i, value in enumerate(nums):
            if target - value in lookup:
                return [lookup[target - value], i]
            lookup[value] = i
        return []
"""

REVERSE_LIST = """
class Solution:
    def reverseList(self, head):
        prev = None
        while head:
            head.next, prev, head = prev, head, head.next
        return prev
"""


def test_script_mode_detection():
    analysis = analyze("x = input_data()\nprint(x)")
    assert analysis.mode == "script"


def test_function_mode_for_bare_class():
    analysis = analyze(TWO_SUM)
    assert analysis.mode == "function"
    assert analysis.default_function == "Solution.twoSum"


def test_defs_plus_driver_is_script():
    analysis = analyze("def f(n):\n    return n\n\nprint(f(3))")
    assert analysis.mode == "script"


def test_docstring_and_constants_do_not_make_script():
    analysis = analyze('"""Doc."""\nLIMIT = 10\n\ndef f(n):\n    return n + LIMIT')
    assert analysis.mode == "function"


def test_main_guard_is_script():
    analysis = analyze(
        "def f(n):\n    return n\n\nif __name__ == '__main__':\n    print(f(1))"
    )
    assert analysis.mode == "script"


def test_syntax_error_reported():
    analysis = analyze("def broken(:\n    pass")
    assert analysis.mode == "empty"
    assert analysis.diagnostics[0]["severity"] == "error"


def test_type_hint_inference_beats_names():
    analysis = analyze("def f(nums: str):\n    return nums")
    param = analysis.functions[0].params[0]
    assert param.inferred == "str"
    assert param.source == "hint"


def test_list_int_hint():
    analysis = analyze("from typing import List\ndef f(a: List[int]):\n    return a")
    assert analysis.functions[0].params[0].inferred == "list[int]"


def test_optional_treenode_hint():
    analysis = analyze(
        "from typing import Optional\ndef f(x: Optional[TreeNode]):\n    return x"
    )
    param = analysis.functions[0].params[0]
    assert param.inferred == "tree"
    assert analysis.references_tree_node


def test_name_based_inference():
    analysis = analyze("def f(nums, s, n, root, head, grid, intervals):\n    pass")
    inferred = {p.name: p.inferred for p in analysis.functions[0].params}
    assert inferred == {
        "nums": "list[int]",
        "s": "str",
        "n": "int",
        "root": "tree",
        "head": "listnode",
        "grid": "grid",
        "intervals": "pairs",
    }


def test_usage_next_beats_name():
    analysis = analyze("def f(s):\n    return s.next")
    assert analysis.functions[0].params[0].inferred == "listnode"


def test_usage_left_right_means_tree():
    analysis = analyze("def f(thing):\n    return thing.left or thing.right")
    assert analysis.functions[0].params[0].inferred == "tree"


def test_usage_double_subscript_means_grid():
    analysis = analyze("def f(data):\n    return data[0][0]")
    assert analysis.functions[0].params[0].inferred == "grid"


def test_usage_index_or_slice_infers_list_weakly():
    # A bare index and a slice both infer a sequence (weak list[int])...
    indexed = analyze("def f(data):\n    return data[0]")
    sliced = analyze("def f(data):\n    return data[1:3]")
    assert indexed.functions[0].params[0].inferred == "list[int]"
    assert indexed.functions[0].params[0].source == "usage"
    assert sliced.functions[0].params[0].inferred == "list[int]"


def test_slicing_does_not_override_str_name_hint():
    # ...but the weak signal must not beat a name hint: a sliced ``s`` is str.
    analysis = analyze("def f(s):\n    return s[1:3]")
    param = analysis.functions[0].params[0]
    assert param.inferred == "str"
    assert param.source == "name"


def test_usage_string_method():
    analysis = analyze("def f(thing):\n    return thing.lower()")
    assert analysis.functions[0].params[0].inferred == "str"


def test_unknown_param_defaults_to_int():
    analysis = analyze("def f(zzz):\n    pass")
    param = analysis.functions[0].params[0]
    assert param.inferred == "int"
    assert param.source == "default"


def test_self_excluded_from_params():
    analysis = analyze(TWO_SUM)
    names = [p.name for p in analysis.functions[0].params]
    assert names == ["nums", "target"]


def test_all_parameter_kinds_are_preserved():
    analysis = analyze(
        "def f(a, /, b, *values, c, **options):\n"
        "    return a, b, values, c, options\n"
    )
    params = analysis.functions[0].params
    assert [(param.name, param.kind) for param in params] == [
        ("a", "positional_only"),
        ("b", "positional_or_keyword"),
        ("values", "var_positional"),
        ("c", "keyword_only"),
        ("options", "var_keyword"),
    ]
    assert params[2].inferred == "list[int]"
    assert params[4].inferred == "dict"


def test_instance_method_includes_constructor_inputs():
    analysis = analyze(
        "class Solver:\n"
        "    def __init__(self, base: int):\n"
        "        self.base = base\n"
        "    def solve(self, n: int):\n"
        "        return self.base + n\n"
    )
    function = analysis.functions[0]
    assert function.binding == "instance"
    assert function.constructor_param_count == 1
    assert [param.name for param in function.params] == ["__init__.base", "n"]


def test_generator_detection():
    analysis = analyze("def gen(n):\n    for i in range(n):\n        yield i")
    assert analysis.functions[0].is_generator


def test_nested_generator_does_not_mark_outer_function():
    analysis = analyze(
        "def solve(n):\n"
        "    def inner():\n"
        "        yield n\n"
        "    return 'ok'\n"
    )
    assert analysis.functions[0].is_generator is False


def test_default_function_prefers_solution_method():
    analysis = analyze(
        "def helper(x):\n    return x\n\n"
        "class Solution:\n    def solve(self, nums):\n        return helper(nums)"
    )
    assert analysis.default_function == "Solution.solve"


def test_reverse_list_inference():
    analysis = analyze(REVERSE_LIST)
    param = analysis.functions[0].params[0]
    assert param.inferred == "listnode"


def test_pointer_hints_capture_index_usage():
    analysis = analyze(
        "def f(nums, s, k):\n"
        "    total = nums[k]\n"
        "    for i, ch in enumerate(s):\n"
        "        total += i\n"
        "    for j in range(len(nums)):\n"
        "        total += nums[j]\n"
        "    return total\n"
    )
    assert analysis.functions[0].pointer_hints == {
        "nums": ["j", "k"],
        "s": ["i"],
    }


def test_pointer_hints_capture_slice_bounds():
    analysis = analyze("def f(nums, left, right):\n    return nums[left:right]\n")
    assert analysis.functions[0].pointer_hints == {"nums": ["left", "right"]}


def test_pointer_hints_capture_range_with_start_bound():
    analysis = analyze("def f(nums, k):\n    for right in range(k, len(nums)):\n        nums[right]\n")
    assert analysis.functions[0].pointer_hints == {"nums": ["right"]}


def test_pointer_hints_extract_names_from_computed_expressions():
    analysis = analyze("def f(nums, right, k):\n    return nums[right - k]\n")
    assert analysis.functions[0].pointer_hints == {"nums": ["k", "right"]}


def test_module_pointer_hints_capture_script_indexes():
    analysis = analyze("nums = [1, 2, 3]\nfor i in range(len(nums)):\n    print(nums[i])\n")
    assert analysis.module_pointer_hints == {"nums": ["i"]}


def test_assignment_hints_capture_sliding_window_dependencies():
    analysis = analyze(
        "def f(nums, k):\n"
        "    window = sum(nums[:k])\n"
        "    for right in range(k, len(nums)):\n"
        "        window += nums[right] - nums[right - k]\n"
    )
    hints = analysis.functions[0].assignment_hints
    assert {
        "target": "window",
        "line": 2,
        "statement": "window = sum(nums[:k])",
        "sources": ["k", "nums"],
    } in hints
    assert {
        "target": "right",
        "line": 3,
        "statement": "for right in range(k, len(nums))",
        "sources": ["k", "nums"],
    } in hints
    assert {
        "target": "window",
        "line": 4,
        "statement": "window += nums[right] - nums[right - k]",
        "sources": ["k", "nums", "right"],
    } in hints


def test_assignment_hints_capture_mutated_container_roots():
    analysis = analyze(
        "def f(nums, target):\n"
        "    lookup = {}\n"
        "    for i, value in enumerate(nums):\n"
        "        lookup[value] = i\n"
    )
    hints = analysis.functions[0].assignment_hints
    assert {
        "target": "lookup",
        "line": 4,
        "statement": "lookup[value] = i",
        "sources": ["i", "value"],
    } in hints
    assert {
        "target": "i",
        "line": 3,
        "statement": "for i, value in enumerate(nums)",
        "sources": ["nums"],
    } in hints
    assert {
        "target": "value",
        "line": 3,
        "statement": "for i, value in enumerate(nums)",
        "sources": ["nums"],
    } in hints


def test_module_assignment_hints_capture_script_assignments():
    analysis = analyze("nums = [1, 2, 3]\ntotal = sum(nums)\n")
    assert {
        "target": "total",
        "line": 2,
        "statement": "total = sum(nums)",
        "sources": ["nums"],
    } in analysis.module_assignment_hints
