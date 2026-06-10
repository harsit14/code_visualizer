import ast

from codeviz.analyzer import analyze
from codeviz.inputgen import evaluate_input, generate_inputs
from codeviz.structures import ListNode, TreeNode


def _function(source: str):
    analysis = analyze(source)
    return analysis.functions[0]


def test_seeded_generation_is_reproducible():
    fn = _function("def f(nums, target):\n    pass")
    first, seed = generate_inputs(fn, seed=42)
    second, _ = generate_inputs(fn, seed=42)
    assert [i.literal for i in first] == [i.literal for i in second]
    assert seed == 42


def test_unseeded_generation_returns_seed():
    fn = _function("def f(n):\n    pass")
    _, seed = generate_inputs(fn)
    assert isinstance(seed, int)


def test_list_int_size_bounds():
    fn = _function("def f(nums):\n    pass")
    inputs, _ = generate_inputs(fn, seed=7)
    values = ast.literal_eval(inputs[0].literal)
    assert 5 <= len(values) <= 8
    assert all(isinstance(v, int) for v in values)


def test_string_size_bounds():
    fn = _function("def f(s):\n    pass")
    inputs, _ = generate_inputs(fn, seed=7)
    value = ast.literal_eval(inputs[0].literal)
    assert 6 <= len(value) <= 10


def test_two_sum_target_is_reachable():
    fn = _function("def f(nums, target):\n    pass")
    for seed in range(20):
        inputs, _ = generate_inputs(fn, seed=seed)
        nums = ast.literal_eval(inputs[0].literal)
        target = ast.literal_eval(inputs[1].literal)
        assert any(
            nums[i] + nums[j] == target
            for i in range(len(nums))
            for j in range(i + 1, len(nums))
        ), f"seed {seed}: target {target} unreachable in {nums}"


def test_k_clamped_to_list_length():
    fn = _function("def f(nums, k):\n    pass")
    for seed in range(20):
        inputs, _ = generate_inputs(fn, seed=seed)
        nums = ast.literal_eval(inputs[0].literal)
        k = ast.literal_eval(inputs[1].literal)
        assert 1 <= k < len(nums)


def test_tree_literal_evaluates_to_tree():
    fn = _function("def f(root):\n    pass")
    inputs, _ = generate_inputs(fn, seed=3)
    assert inputs[0].literal.startswith("tree(")
    value = evaluate_input(inputs[0].literal)
    assert isinstance(value, TreeNode)


def test_linked_literal_evaluates_to_listnode():
    fn = _function("def f(head):\n    pass")
    inputs, _ = generate_inputs(fn, seed=3)
    assert inputs[0].literal.startswith("linked(")
    value = evaluate_input(inputs[0].literal)
    assert isinstance(value, ListNode)


def test_grid_generation():
    fn = _function("def f(grid):\n    pass")
    inputs, _ = generate_inputs(fn, seed=3)
    grid = ast.literal_eval(inputs[0].literal)
    assert isinstance(grid, list)
    assert all(isinstance(row, list) for row in grid)
    assert len({len(row) for row in grid}) == 1  # rectangular


def test_pairs_are_sorted_intervals():
    fn = _function("def f(intervals):\n    pass")
    inputs, _ = generate_inputs(fn, seed=3)
    pairs = ast.literal_eval(inputs[0].literal)
    assert all(len(pair) == 2 and pair[0] < pair[1] for pair in pairs)
    assert pairs == sorted(pairs)


def test_evaluate_input_blocks_builtins():
    try:
        evaluate_input("__import__('os')")
    except Exception:
        return
    raise AssertionError("builtins should not be reachable from input literals")


def test_size_hint_scales_collections():
    fn = _function("def f(nums):\n    pass")
    small, _ = generate_inputs(fn, seed=5, size=4)
    large, _ = generate_inputs(fn, seed=5, size=32)
    assert len(ast.literal_eval(small[0].literal)) == 4
    assert len(ast.literal_eval(large[0].literal)) == 32
