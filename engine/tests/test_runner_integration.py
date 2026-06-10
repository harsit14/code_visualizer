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
