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


def test_generator_detection():
    analysis = analyze("def gen(n):\n    for i in range(n):\n        yield i")
    assert analysis.functions[0].is_generator


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
