import ast
import json
import math
import random

import pytest

from codeviz.analyzer import analyze
from codeviz.api import handle_request
from codeviz.complexity import (
    MAX_GRID_N,
    MAX_N,
    MAX_SAMPLES,
    fit_caveats,
    fit_growth,
    generate_sized_input,
    measure_size,
    pick_dimension,
    sanitize_sizes,
    size_dimensions,
    structure_hint,
)
from codeviz.inputgen import evaluate_input, generate_inputs
from codeviz.runner import measure_complexity


def _function(source: str, name: str | None = None):
    analysis = analyze(source)
    return analysis.get_function(name) if name else analysis.functions[0]


def _samples(fn, sizes=(4, 8, 16, 32, 64)):
    return [{"n": n, "ops": fn(n), "status": "ok"} for n in sizes]


# -- dimension selection ------------------------------------------------------


def test_dimensions_follow_parameter_types():
    fn = _function(
        "def f(nums: list[int], s: str, grid: list[list[int]], root, head, k: int, "
        "d: dict, seen: set[int], ratio: float):\n    pass"
    )
    dims = {dim.id: dim for dim in size_dimensions(fn)}
    assert dims["nums"].meaning == "n = len(nums)"
    assert dims["s"].meaning == "n = len(s)"
    assert dims["grid"].axis == "both"
    assert dims["grid"].max_n == MAX_GRID_N
    assert dims["grid:rows"].meaning.startswith("n = len(grid) (rows")
    assert dims["grid:cols"].meaning.startswith("n = len(grid[0]) (columns")
    assert dims["root"].meaning == "n = number of nodes in root"
    assert dims["head"].meaning == "n = number of nodes in head"
    assert dims["k"].axis == "value"
    assert dims["k"].meaning == "n = k"
    assert dims["d"].meaning == "n = len(d)"
    assert dims["seen"].kind == "set[int]"
    assert "ratio" not in dims


def test_default_dimension_is_first_sized_collection():
    fn = _function("def f(k: int, nums: list[int], target: int):\n    pass")
    assert pick_dimension(fn, None, None).param == "nums"
    only_ints = _function("def fib(n: int):\n    pass")
    assert pick_dimension(only_ints, None, None).param == "n"


def test_pick_dimension_explains_parameters_that_cannot_grow():
    fn = _function("def f(nums: list[int], ratio: float):\n    pass")
    with pytest.raises(ValueError, match="'ratio' \\(float\\) cannot grow"):
        pick_dimension(fn, "ratio", None)
    with pytest.raises(ValueError, match="no parameter named 'missing'"):
        pick_dimension(fn, "missing", None)
    with pytest.raises(ValueError, match="cannot grow along 'rows'"):
        pick_dimension(fn, "nums", "rows")
    no_inputs = _function("def f(ratio: float):\n    pass")
    with pytest.raises(ValueError, match="no input that can grow"):
        pick_dimension(no_inputs, None, None)


def test_sanitize_sizes_clamps_dedupes_and_bounds_count():
    assert sanitize_sizes(None, MAX_N) == [4, 8, 16, 32, 64]
    assert sanitize_sizes([64, 8, 8, 0, 5000, True, "9", float("nan")], MAX_N) == [
        1,
        8,
        64,
        MAX_N,
    ]
    assert sanitize_sizes([16, 32, 64, 128], MAX_GRID_N) == [16, 32, 64]
    assert len(sanitize_sizes(list(range(1, 50)), MAX_N)) == MAX_SAMPLES


# -- sizing -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("source", "param", "axis"),
    [
        ("def f(nums: list[int]):\n    pass", "nums", None),
        ("def f(words: list[str]):\n    pass", "words", None),
        ("def f(s: str):\n    pass", "s", None),
        ("def f(d: dict):\n    pass", "d", None),
        ("def f(seen: set[int]):\n    pass", "seen", None),
        ("def f(seen: set[str]):\n    pass", "seen", None),
        ("def f(intervals):\n    pass", "intervals", None),
        ("def f(root):\n    pass", "root", None),
        ("def f(head):\n    pass", "head", None),
        ("def f(n: int):\n    pass", "n", None),
        ("def f(grid: list[list[int]]):\n    pass", "grid", "both"),
    ],
)
def test_generated_inputs_have_exactly_the_requested_size(source, param, axis):
    fn = _function(source)
    dimension = pick_dimension(fn, param, axis)
    for size in (1, 7, 100, 300):
        literal = generate_sized_input(fn.params[0], dimension, size, random.Random(size)).literal
        assert measure_size(evaluate_input(literal), dimension) == size


def test_one_axis_grid_growth_keeps_the_other_axis_fixed():
    fn = _function("def f(grid: list[list[str]]):\n    pass")
    base = [["a", "b", "c"], ["d", "e", "f"]]
    rows = pick_dimension(fn, "grid", "rows")
    cols = pick_dimension(fn, "grid", "cols")
    grown_rows = evaluate_input(
        generate_sized_input(fn.params[0], rows, 9, random.Random(1), base).literal
    )
    grown_cols = evaluate_input(
        generate_sized_input(fn.params[0], cols, 9, random.Random(1), base).literal
    )
    assert (len(grown_rows), len(grown_rows[0])) == (9, 3)
    assert (len(grown_cols), len(grown_cols[0])) == (2, 9)
    assert isinstance(grown_rows[0][0], str)


def test_set_inputs_are_generated_reproducibly():
    fn = _function("def f(tags: set[str], ids: set[int]):\n    pass")
    first, _ = generate_inputs(fn, seed=3)
    second, _ = generate_inputs(fn, seed=3)
    assert [item.literal for item in first] == [item.literal for item in second]
    assert [item.type for item in first] == ["set[str]", "set[int]"]
    assert isinstance(evaluate_input(first[0].literal), set)
    assert evaluate_input("set()") == set()


# -- fitting ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("steps", "label"),
    [
        (lambda n: 7, "O(1)"),
        (lambda n: 5 * math.log2(n) + 4, "O(log n)"),
        (lambda n: 3 * n + 4, "O(n)"),
        (lambda n: 3 * n - 4, "O(n)"),  # e.g. range(k, n) starts part-way in
        (lambda n: 4 * n * math.log2(n) + 6 * n + 8, "O(n log n)"),
        (lambda n: n * n + 3 * n + 4, "O(n²)"),
        (lambda n: n**3 + n * n + 5, "O(n³)"),
    ],
)
def test_fit_recovers_polynomial_family_models(steps, label):
    fit = fit_growth(_samples(steps))
    assert fit is not None
    assert fit["label"] == label
    assert fit["quality"] == "good"
    assert fit["samplesUsed"] == 5


@pytest.mark.parametrize(
    ("points", "label"),
    [
        ([(4, 40), (8, 82), (16, 158), (32, 330)], "O(n)"),
        ([(4, 20), (8, 70), (16, 270), (32, 1060)], "O(n²)"),
        ([(4, 6), (8, 6), (16, 6)], "O(1)"),
    ],
)
def test_fit_matches_the_former_client_side_fixtures(points, label):
    fit = fit_growth([{"n": n, "ops": ops, "status": "ok"} for n, ops in points])
    assert fit["label"] == label


def test_fit_reports_exponential_base():
    fib_calls = lambda n: 2 * round(1.618 ** (n + 1) / 2.236) - 1  # noqa: E731
    fit = fit_growth(_samples(lambda n: 4 * fib_calls(n), sizes=(2, 4, 8, 12, 16, 20)))
    assert fit["model"] == "c^n"
    assert fit["label"] == "O(1.6ⁿ)"
    doubling = fit_growth(_samples(lambda n: 3 * 2**n + 5, sizes=(4, 6, 8, 10, 12)))
    assert doubling["label"] == "O(2ⁿ)"


def test_fit_prefers_the_simpler_model_on_near_ties():
    # Three points cannot separate n from n log n; the simpler one wins and
    # the close alternative is reported.
    fit = fit_growth(_samples(lambda n: 3 * n + 4, sizes=(4, 8, 16)))
    assert fit["label"] == "O(n)"
    assert fit["runnerUp"]["label"] == "O(n log n)"


def test_fit_is_robust_to_moderate_noise():
    rng = random.Random(5)
    noisy = [
        {"n": n, "ops": round((n * n + 2 * n) * (1 + rng.uniform(-0.08, 0.08))), "status": "ok"}
        for n in (8, 16, 32, 64, 128, 256)
    ]
    assert fit_growth(noisy)["label"] == "O(n²)"


def test_fit_uses_only_valid_samples():
    samples = _samples(lambda n: 3 * n + 4) + [
        {"n": 128, "ops": 1_000_001, "status": "step-limit"},
        {"n": 256, "ops": 0, "status": "skipped"},
        {"n": 2, "ops": 9, "status": "exception"},
    ]
    fit = fit_growth(samples)
    assert fit["label"] == "O(n)"
    assert fit["samplesUsed"] == 5
    assert fit["curve"][0]["n"] == 4
    assert fit["curve"][-1]["n"] == 64


def test_fit_needs_three_valid_sizes():
    assert fit_growth(_samples(lambda n: n, sizes=(4, 8))) is None
    assert fit_growth([{"n": 4, "ops": 3, "status": "ok"}] * 3) is None


def test_caveats_flag_small_ranges_failures_and_early_exits():
    samples = [
        {"n": 4, "ops": 17, "status": "ok"},
        {"n": 8, "ops": 17, "status": "ok"},
        {"n": 16, "ops": 17, "status": "ok"},
        {"n": 32, "ops": 3, "status": "exception"},
    ]
    fit = fit_growth(samples)
    assert fit["label"] == "O(1)"
    caveats = fit_caveats(samples, fit, fixed_from_user=True)
    assert any("Only 3 samples" in caveat for caveat in caveats)
    assert any("1 sample was left out" in caveat for caveat in caveats)
    assert any("less than 8×" in caveat for caveat in caveats)
    assert any("exit early" in caveat for caveat in caveats)
    assert not any("exit early" in caveat for caveat in fit_caveats(samples, fit, False))


# -- structure heuristic ------------------------------------------------------


@pytest.mark.parametrize(
    ("body", "label", "depth"),
    [
        ("    return nums[0]\n", "O(1)", 0),
        ("    for x in nums:\n        pass\n", "O(n)", 1),
        ("    for c in 'abc':\n        for x in range(26):\n            pass\n", "O(1)", 0),
        (
            "    for i in range(len(nums)):\n"
            "        for j in range(i + 1, len(nums)):\n"
            "            pass\n",
            "O(n²)",
            2,
        ),
        ("    return [a + b for a in nums for b in nums]\n", "O(n²)", 2),
        (
            "    lo, hi = 0, len(nums) - 1\n"
            "    while lo <= hi:\n"
            "        mid = (lo + hi) // 2\n"
            "        lo = mid + 1\n",
            "O(log n)",
            1,
        ),
        ("    for x in nums:\n        nums.sort()\n", "O(n² log n)", 1),
    ],
)
def test_structure_hint_reads_loop_nesting(body, label, depth):
    fn_source = f"def f(nums):\n{body}"
    hint = structure_hint(fn_source, _function(fn_source))
    assert hint["label"] == label
    assert hint["loopDepth"] == depth
    assert hint["recursive"] is False


def test_structure_hint_gives_no_label_for_recursion():
    source = (
        "class Solution:\n"
        "    def fib(self, n: int) -> int:\n"
        "        return n if n < 2 else self.fib(n - 1) + self.fib(n - 2)\n"
    )
    hint = structure_hint(source, _function(source, "Solution.fib"))
    assert hint["label"] is None
    assert hint["recursive"] is True
    assert any("calls itself from 2 places" in note for note in hint["notes"])

    helper = "def f(nums):\n    def go(i):\n        return go(i + 1) if i < len(nums) else 0\n    return go(0)\n"
    helper_hint = structure_hint(helper, _function(helper))
    assert helper_hint["label"] is None
    assert any("go()" in note for note in helper_hint["notes"])


# -- measure_complexity -------------------------------------------------------

LINEAR_WITH_TARGET = (
    "def find(nums: list[int], target: int) -> int:\n"
    "    for i, value in enumerate(nums):\n"
    "        if value == target:\n"
    "            return i\n"
    "    return -1\n"
)


def test_only_the_chosen_dimension_grows():
    grow_nums = measure_complexity(LINEAR_WITH_TARGET, seed=2, sizes=[4, 8, 16, 32])
    assert grow_nums["dimension"]["meaning"] == "n = len(nums)"
    assert [sample["n"] for sample in grow_nums["samples"]] == [4, 8, 16, 32]
    assert all(sample["status"] == "ok" for sample in grow_nums["samples"])
    assert grow_nums["fixed"] == [{"name": "target", "literal": "-1", "source": "generated"}]
    assert grow_nums["fit"]["label"] == "O(n)"

    grow_target = measure_complexity(
        LINEAR_WITH_TARGET, seed=2, param="target", sizes=[4, 8, 16, 32]
    )
    assert grow_target["dimension"]["meaning"] == "n = target"
    assert grow_target["fixed"][0]["name"] == "nums"
    # nums stays the same list, so the scan length does not change with n.
    assert len({sample["ops"] for sample in grow_target["samples"]}) == 1
    assert grow_target["fit"]["label"] == "O(1)"


def test_fixed_inputs_use_the_learners_current_values():
    result = measure_complexity(
        LINEAR_WITH_TARGET, seed=2, inputs=["[1, 2, 3]", "2"], sizes=[4, 8, 16]
    )
    assert result["fixed"] == [{"name": "target", "literal": "2", "source": "current"}]
    assert all(sample["status"] == "ok" for sample in result["samples"])


def test_one_axis_grid_experiment_keeps_the_current_width():
    source = (
        "def total(grid: list[list[int]]) -> int:\n"
        "    return sum(v for row in grid for v in row)\n"
    )
    result = measure_complexity(
        source, param="grid", axis="cols", inputs=["[[1, 2], [3, 4], [5, 6]]"], sizes=[4, 8]
    )
    assert result["dimension"]["id"] == "grid:cols"
    assert [sample["n"] for sample in result["samples"]] == [4, 8]
    assert result["fixed"] == []


def test_failed_samples_are_reported_not_dropped():
    source = (
        "def f(nums):\n"
        "    if len(nums) == 8:\n"
        "        raise ValueError('eight is unlucky')\n"
        "    for x in nums:\n"
        "        pass\n"
    )
    result = measure_complexity(source, seed=1, sizes=[4, 8, 16, 32])
    statuses = [(sample["n"], sample["status"]) for sample in result["samples"]]
    assert statuses == [(4, "ok"), (8, "exception"), (16, "ok"), (32, "ok")]
    failed = result["samples"][1]
    assert failed["error"] == {"type": "ValueError", "msg": "eight is unlucky"}
    assert failed["ms"] is not None
    assert result["fit"]["samplesUsed"] == 3
    assert any("left out of the fit" in caveat for caveat in result["caveats"])


def test_step_limit_stops_sampling_and_marks_the_rest_skipped():
    source = (
        "def f(nums):\n"
        "    c = 0\n"
        "    for a in nums:\n"
        "        for b in nums:\n"
        "            c += 1\n"
        "    return c\n"
    )
    result = measure_complexity(source, seed=1, sizes=[4, 8, 16, 64, 128], max_steps=2_000)
    statuses = [sample["status"] for sample in result["samples"]]
    assert statuses == ["ok", "ok", "ok", "step-limit", "skipped"]
    assert "Step limit of 2,000" in result["samples"][3]["note"]
    assert result["samples"][4]["note"] == "Skipped: n=64 already hit the step limit."
    assert result["truncated"] is True
    assert result["truncationReason"].startswith("Stopped at n=64:")
    assert result["fit"]["samplesUsed"] == 3


def test_total_time_budget_skips_remaining_samples():
    result = measure_complexity(
        "def f(nums):\n    return len(nums)\n", seed=1, sizes=[4, 8], total_seconds=0.0
    )
    assert [sample["status"] for sample in result["samples"]] == ["skipped", "skipped"]
    assert result["truncationReason"].startswith("Stopped before n=4:")


def test_setup_errors_are_per_sample():
    source = (
        "class Solution:\n"
        "    def __init__(self, size: int):\n"
        "        if size > 5:\n"
        "            raise ValueError('too big')\n"
        "    def solve(self, nums: list[int]) -> int:\n"
        "        return len(nums)\n"
    )
    result = measure_complexity(source, param="__init__.size", sizes=[4, 8])
    assert [sample["status"] for sample in result["samples"]] == ["ok", "setup-error"]
    assert result["samples"][1]["error"]["type"] == "ValueError"


def test_unknown_dimension_is_an_error_payload():
    result = measure_complexity(LINEAR_WITH_TARGET, param="ratio")
    assert result["error"]["type"] == "ValueError"
    assert result["samples"] == []


def test_complexity_api_passes_experiment_options():
    response = json.loads(
        handle_request(
            json.dumps(
                {
                    "op": "complexity",
                    "source": LINEAR_WITH_TARGET,
                    "seed": 4,
                    "param": "nums",
                    "sizes": [4, 16, 64],
                    "inputs": ["[1]", "3"],
                }
            )
        )
    )
    assert [sample["n"] for sample in response["samples"]] == [4, 16, 64]
    assert response["fixed"][0]["source"] == "current"
    assert response["structure"]["label"] == "O(n)"
    assert response["limits"]["maxSteps"] > 0
    assert ast.literal_eval(response["fixed"][0]["literal"]) == 3
