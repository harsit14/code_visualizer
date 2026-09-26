"""LeetCode-style names are available without imports, and errors suggest fixes."""

from codeviz.prelude import PRELUDE, exception_message, prelude_for
from codeviz.runner import run_session


def _module_locals(result):
    return set(result["run"]["steps"][-1]["stack"][0]["locals"])


def test_common_leetcode_names_work_without_imports():
    source = """counts = Counter('banana')
groups = defaultdict(list)
groups['a'].append(1)
q = deque([1, 2])
q.popleft()
heap = []
heappush(heap, 3)
where = bisect_left([1, 3], 2)
best = min(inf, 5)
root = isqrt(17)
pairs = list(combinations([1, 2, 3], 2))
total = reduce(operator.add, [1, 2, 3])
memo = lru_cache(maxsize=None)
nums: List[int] = [1]
print(counts['a'], dict(groups), list(q), heap, where, best, root, len(pairs), total)
"""
    result = run_session(source)
    assert result["status"] == "ok", result["error"]
    assert result["run"]["stdout"] == "3 {'a': [1]} [2] [3] 1 5 4 3 6\n"


def test_function_mode_solutions_can_use_prelude_names():
    source = """class Solution:
    def groupAnagrams(self, strs: List[str]) -> List[List[str]]:
        groups = defaultdict(list)
        for word in strs:
            groups[''.join(sorted(word))].append(word)
        return list(groups.values())
"""
    result = run_session(source, inputs=['["eat", "tea", "tan"]'])
    assert result["status"] == "ok", result["error"]


def test_builtins_are_never_shadowed():
    assert "pow" not in PRELUDE and "min" not in PRELUDE and "sum" not in PRELUDE
    result = run_session("x = sqrt(16)\ny = pow(2, 10, 1000)\nprint(x, y)\n")
    assert result["run"]["stdout"] == "4.0 24\n"


def test_only_used_and_undefined_names_are_injected():
    assert set(prelude_for("q = deque()\nc = Counter()")) == {"deque", "Counter"}
    assert prelude_for("from collections import deque\nq = deque()") == {}
    assert prelude_for("def deque():\n    return []\nq = deque()") == {}
    assert prelude_for("print(1)") == {}
    assert prelude_for("def broken(:") == {}


def test_prefers_collections_classes_over_typing_aliases():
    import collections

    assert PRELUDE["Counter"] is collections.Counter
    assert PRELUDE["OrderedDict"] is collections.OrderedDict


def test_injected_names_stay_out_of_variables_until_rebound():
    result = run_session("q = deque([1])\nq.append(2)\n")
    assert _module_locals(result) == {"q"}
    rebound = run_session("deque = 5\nx = deque\n")
    assert {"deque", "x"} <= _module_locals(rebound)


def test_name_errors_suggest_close_names():
    result = run_session("counts = defauldict(int)\n")
    assert result["error"]["type"] == "NameError"
    assert result["error"]["msg"] == (
        "name 'defauldict' is not defined. Did you mean 'defaultdict'?"
    )
    step = next(step for step in result["run"]["steps"] if step["event"] == "exception")
    assert "Did you mean 'defaultdict'?" in step["exc"]["msg"]
    local = run_session("def f():\n    total = 1\n    return totl\nf()\n")
    assert local["error"]["msg"].endswith("Did you mean 'total'?")


def test_attribute_errors_suggest_close_attributes():
    result = run_session("nums = [1]\nnums.appned(2)\n")
    assert result["error"]["msg"] == (
        "'list' object has no attribute 'appned'. Did you mean 'append'?"
    )


def test_messages_without_a_close_match_are_unchanged():
    assert exception_message(NameError("name 'zzqqxx' is not defined", name="zzqqxx")) == (
        "name 'zzqqxx' is not defined"
    )
    assert exception_message(ValueError("bad")) == "bad"
