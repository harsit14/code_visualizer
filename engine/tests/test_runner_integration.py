"""End-to-end engine tests on LeetCode-style fixtures."""

import json

from codeviz.api import handle_request
from codeviz.runner import measure_complexity, run_session

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

INORDER_TRAVERSAL = """
class Solution:
    def inorderTraversal(self, root):
        result = []

        def visit(node):
            if not node:
                return
            visit(node.left)
            result.append(node.val)
            visit(node.right)

        visit(root)
        return result
"""

SLIDING_WINDOW = """
def max_subarray_sum(nums, k):
    window = sum(nums[:k])
    best = window
    for right in range(k, len(nums)):
        window += nums[right] - nums[right - k]
        best = max(best, window)
    return best
"""


def test_two_sum_end_to_end():
    result = run_session(TWO_SUM, seed=42)
    assert result["status"] == "ok"
    assert result["mode"] == "function"
    run = result["run"]
    assert run["functionName"] == "Solution.twoSum"
    assert [i["name"] for i in run["inputs"]] == ["nums", "target"]
    assert run["steps"], "expected a non-empty trace"
    assert run["exception"] is None
    # twoSum returns a list of two indices for our coordinated inputs
    assert run["returnValue"]["k"] == "seq"
    assert len(run["returnValue"]["items"]) == 2


def test_two_sum_reproducible_with_seed():
    first = run_session(TWO_SUM, seed=7)
    second = run_session(TWO_SUM, seed=7)
    assert first["run"]["inputs"] == second["run"]["inputs"]
    assert len(first["run"]["steps"]) == len(second["run"]["steps"])


def test_two_sum_with_user_inputs():
    result = run_session(TWO_SUM, inputs=["[2, 7, 11, 15]", "9"])
    run = result["run"]
    assert run["inputs"][0]["literal"] == "[2, 7, 11, 15]"
    items = run["returnValue"]["items"]
    assert [item["v"] for item in items] == ["0", "1"]


def test_reverse_linked_list():
    result = run_session(REVERSE_LIST, inputs=["linked([1, 2, 3, 4, 5])"])
    run = result["run"]
    assert run["exception"] is None
    encoded = run["returnValue"]
    assert encoded["k"] == "listnode"
    assert [node["val"]["v"] for node in encoded["nodes"]] == ["5", "4", "3", "2", "1"]
    # Steps show the chain as a structure, not a raw object
    assert any(
        local.get("k") == "listnode"
        for step in run["steps"]
        for frame in step["stack"]
        for local in frame["locals"].values()
    )


def test_binary_tree_inorder_traversal():
    result = run_session(INORDER_TRAVERSAL, inputs=["tree([4, 2, 6, 1, 3, 5, 7])"])
    run = result["run"]
    assert run["exception"] is None
    values = [item["v"] for item in run["returnValue"]["items"]]
    assert values == ["1", "2", "3", "4", "5", "6", "7"]  # sorted = inorder of BST


def test_sliding_window_bare_function():
    result = run_session(SLIDING_WINDOW, inputs=["[1, 9, 2, 8, 3]", "2"])
    run = result["run"]
    assert result["mode"] == "function"
    assert run["functionName"] == "max_subarray_sum"
    assert run["returnValue"]["v"] == "11"


def test_script_mode_runs_top_level():
    result = run_session("total = 0\nfor i in range(5):\n    total += i\nprint(total)")
    assert result["mode"] == "script"
    run = result["run"]
    assert run["stdout"] == "10\n"
    assert run["steps"]
    assert run["runtimeMs"] >= 0
    assert run["memoryMb"] is not None
    assert run["memoryMb"] >= 0
    assert run["memoryIsEstimate"] is False


def test_script_exception_is_visualized_not_fatal():
    result = run_session("a = 1\nb = a / 0")
    run = result["run"]
    assert result["status"] == "ok"  # the tool worked; the code failed
    assert run["exception"]["type"] == "ZeroDivisionError"
    exc_steps = [s for s in run["steps"] if s["event"] == "exception"]
    assert exc_steps and exc_steps[0]["line"] == 2


def test_function_exception_recorded():
    result = run_session("def f(n):\n    return n / 0", inputs=["3"])
    run = result["run"]
    assert run["exception"]["type"] == "ZeroDivisionError"


def test_infinite_loop_truncates_gracefully():
    result = run_session("while True:\n    pass", max_steps=80)
    run = result["run"]
    assert run["truncated"] is True
    assert run["steps"]
    assert "limit" in run["truncationReason"]


def test_generator_function_materialized():
    result = run_session(
        "def countdown(n):\n    while n > 0:\n        yield n\n        n -= 1",
        inputs=["3"],
    )
    run = result["run"]
    values = [item["v"] for item in run["returnValue"]["items"]]
    assert values == ["3", "2", "1"]


def test_nested_generator_does_not_materialize_regular_iterable_return():
    result = run_session(
        "def solve(n):\n"
        "    def inner():\n"
        "        yield n\n"
        "    return 'ok'\n",
        inputs=["3"],
    )
    assert result["run"]["returnValue"]["v"] == "ok"


def test_async_function_is_awaited_and_traced():
    result = run_session(
        "import asyncio\n"
        "async def solve(n):\n"
        "    await asyncio.sleep(0)\n"
        "    return n + 1\n",
        inputs=["3"],
    )
    run = result["run"]
    assert run["exception"] is None
    assert run["returnValue"]["v"] == "4"
    assert any(step["func"] == "solve" for step in run["steps"])


def test_async_generator_is_materialized_and_traced():
    result = run_session(
        "async def countdown(n):\n"
        "    while n > 0:\n"
        "        yield n\n"
        "        n -= 1\n",
        inputs=["3"],
    )
    run = result["run"]
    assert [item["v"] for item in run["returnValue"]["items"]] == ["3", "2", "1"]
    assert any(step["func"] == "countdown" for step in run["steps"])


def test_recursive_function_mode():
    result = run_session(
        "def fib(n):\n"
        "    if n <= 1:\n"
        "        return n\n"
        "    return fib(n - 1) + fib(n - 2)",
        inputs=["6"],
    )
    run = result["run"]
    assert run["returnValue"]["v"] == "8"
    assert max(len(s["stack"]) for s in run["steps"]) >= 5


def test_syntax_error_is_reported():
    result = run_session("def broken(:\n    pass")
    assert result["status"] == "error"
    assert result["error"]["type"] == "SyntaxError"


def test_function_picker_override():
    source = "def a(n):\n    return 1\n\ndef b(n):\n    return 2"
    result = run_session(source, function="b", inputs=["1"])
    assert result["run"]["functionName"] == "b"
    assert result["run"]["returnValue"]["v"] == "2"


def test_function_parameter_kinds_are_invoked_correctly():
    result = run_session(
        "def f(a, /, b, *values, c, **options):\n"
        "    return a + b + sum(values) + c + options['extra']\n",
        inputs=["1", "2", "[3, 4]", "5", "{'extra': 6}"],
    )
    assert result["run"]["returnValue"]["v"] == "21"


def test_instance_method_accepts_constructor_inputs():
    result = run_session(
        "class Solver:\n"
        "    def __init__(self, base: int):\n"
        "        self.base = base\n"
        "    def solve(self, n: int):\n"
        "        return self.base + n\n",
        inputs=["10", "4"],
    )
    run = result["run"]
    assert [item["name"] for item in run["inputs"]] == ["__init__.base", "n"]
    assert run["returnValue"]["v"] == "14"


def test_static_and_class_methods_do_not_construct_instances():
    source = (
        "class Solver:\n"
        "    def __init__(self, required):\n"
        "        raise AssertionError('must not construct')\n"
        "    @staticmethod\n"
        "    def static_solve(n: int):\n"
        "        return n + 1\n"
        "    @classmethod\n"
        "    def class_solve(cls, n: int):\n"
        "        return n + 2\n"
    )
    static_result = run_session(source, function="Solver.static_solve", inputs=["3"])
    class_result = run_session(source, function="Solver.class_solve", inputs=["3"])
    assert static_result["run"]["returnValue"]["v"] == "4"
    assert class_result["run"]["returnValue"]["v"] == "5"


def test_complexity_measurement_linear_vs_quadratic():
    linear = measure_complexity("def f(nums):\n    return sum(nums)", seed=1)
    quadratic = measure_complexity(
        "def f(nums):\n"
        "    count = 0\n"
        "    for a in nums:\n"
        "        for b in nums:\n"
        "            count += 1\n"
        "    return count",
        seed=1,
    )
    assert len(linear["samples"]) >= 3
    assert len(quadratic["samples"]) >= 3
    n_small, n_big = linear["samples"][0]["n"], linear["samples"][-1]["n"]
    ratio = n_big / n_small
    linear_growth = linear["samples"][-1]["ops"] / linear["samples"][0]["ops"]
    quadratic_growth = quadratic["samples"][-1]["ops"] / quadratic["samples"][0]["ops"]
    assert quadratic_growth > linear_growth * 2
    assert quadratic_growth > ratio**1.5


def test_complexity_reports_when_sampling_stops_early():
    result = measure_complexity(
        "def f(nums):\n"
        "    total = 0\n"
        "    while True:\n"
        "        total += 1\n",
        seed=1,
        max_seconds=0.0,
    )
    assert result["truncated"] is True
    assert result["truncationReason"].startswith("Stopped at n=4:")


def test_json_api_round_trip():
    response = json.loads(
        handle_request(json.dumps({"op": "run", "source": TWO_SUM, "options": {"seed": 5}}))
    )
    assert response["status"] == "ok"
    assert response["run"]["functionName"] == "Solution.twoSum"

    analysis = json.loads(handle_request(json.dumps({"op": "analyze", "source": TWO_SUM})))
    assert analysis["analysis"]["mode"] == "function"

    bad = json.loads(handle_request("{not json"))
    assert bad["error"]["type"] == "JSONDecodeError"


def test_pointer_hints_in_analysis_for_two_sum():
    analysis = json.loads(handle_request(json.dumps({"op": "analyze", "source": TWO_SUM})))
    fn = analysis["analysis"]["functions"][0]
    assert fn["qualname"] == "Solution.twoSum"
    # i and value are enumerate targets; i should be a pointer to nums
    hints = fn["pointerHints"]
    assert "nums" in hints
    assert "i" in hints["nums"]


def test_pointer_hints_in_analysis_for_sliding_window():
    analysis = json.loads(handle_request(json.dumps({"op": "analyze", "source": SLIDING_WINDOW})))
    fn = analysis["analysis"]["functions"][0]
    hints = fn["pointerHints"]
    assert "nums" in hints
    assert "right" in hints["nums"]


def test_assignment_hints_in_analysis_for_sliding_window():
    analysis = json.loads(handle_request(json.dumps({"op": "analyze", "source": SLIDING_WINDOW})))
    fn = analysis["analysis"]["functions"][0]
    hints = fn["assignmentHints"]
    assert {
        "target": "window",
        "line": 3,
        "statement": "window = sum(nums[:k])",
        "sources": ["k", "nums"],
    } in hints
    assert {
        "target": "window",
        "line": 6,
        "statement": "window += nums[right] - nums[right - k]",
        "sources": ["k", "nums", "right"],
    } in hints


def test_pointer_hints_in_module_scope_script():
    script = "nums = [1, 2, 3]\nfor i in range(len(nums)):\n    print(nums[i])\n"
    analysis = json.loads(handle_request(json.dumps({"op": "analyze", "source": script})))
    hints = analysis["analysis"].get("modulePointerHints", {})
    assert "nums" in hints
    assert "i" in hints["nums"]


def test_pointer_hints_do_not_include_unrelated_vars():
    code = """
class Solution:
    def process(self, nums):
        cur = 0
        for i in range(len(nums)):
            cur += nums[i]
        return cur
"""
    analysis = json.loads(handle_request(json.dumps({"op": "analyze", "source": code})))
    fn = analysis["analysis"]["functions"][0]
    hints = fn["pointerHints"]
    assert "nums" in hints
    assert "i" in hints["nums"]
    # 'cur' is NOT used as an index into nums, should not be in hints
    assert "cur" not in hints.get("nums", [])


def test_pointer_hints_for_slice_bounds():
    code = "def f(arr, left, right):\n    return arr[left:right]\n"
    analysis = json.loads(handle_request(json.dumps({"op": "analyze", "source": code})))
    fn = analysis["analysis"]["functions"][0]
    hints = fn["pointerHints"]
    assert "arr" in hints
    assert set(hints["arr"]) == {"left", "right"}


def test_pointer_hints_for_double_subscript_ignored():
    code = "def f(grid, i, j):\n    return grid[i][j]\n"
    analysis = json.loads(handle_request(json.dumps({"op": "analyze", "source": code})))
    fn = analysis["analysis"]["functions"][0]
    hints = fn["pointerHints"]
    # grid[i][j] only records i as a pointer to 'grid' (j is on the inner list)
    assert "grid" in hints
    assert "i" in hints["grid"]
    assert "j" not in hints.get("grid", [])


def test_pointer_hints_for_slice_with_binop_bound():
    code = "def f(s, left, right):\n    return s[left:right+1]\n"
    analysis = json.loads(handle_request(json.dumps({"op": "analyze", "source": code})))
    fn = analysis["analysis"]["functions"][0]
    hints = fn["pointerHints"]
    assert "s" in hints
    assert set(hints["s"]) == {"left", "right"}


def test_deque_locals_are_structured_for_data_panel():
    code = """
from collections import deque

class Solution:
    def maxSlidingWindow(self, nums, k):
        q = deque()
        for r in range(len(nums)):
            q.append(r)
            if r >= k:
                q.popleft()
        return list(q)
"""
    result = run_session(code, inputs=["[1, 3, 1, 18, 9, 13, 5, 7]", "3"])
    deque_values = [
        frame["locals"]["q"]
        for step in result["run"]["steps"]
        for frame in step["stack"]
        if "q" in frame["locals"] and frame["locals"]["q"].get("len", 0) > 0
    ]
    assert deque_values
    assert deque_values[-1]["k"] == "seq"
    assert deque_values[-1]["t"] == "deque"
