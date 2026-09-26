"""Helpers for complexity experiments: what grows, how to size it, how to
fit the measurements and what the code's shape suggests.

Nothing here executes user code; :func:`codeviz.runner.measure_complexity`
does that and uses these helpers to build inputs and describe results.

Terminology used in payloads and the UI:

* A *dimension* is one parameter (plus an axis for grids) that grows while
  every other argument stays fixed. ``meaning`` spells out what ``n`` is.
* *Steps* are trace events in user code (calls, lines, returns). Built-in
  calls count as one step, so measured growth can differ from the true cost.
* The *fit* is measured growth; the *structure* hint is a static heuristic.
  Neither is a proof of Big-O.
"""

from __future__ import annotations

import ast
import math
import random
from dataclasses import dataclass
from typing import Any, Callable, Optional, Sequence

from .analyzer import FunctionInfo, Param
from .inputgen import DEFAULT_INT_RANGE, GeneratedInput, generate_input

DEFAULT_SIZES = (4, 8, 16, 32, 64)
MAX_SAMPLES = 10
MAX_N = 1024
# A square grid grows with n², so keep it to ~4k cells at the top size.
MAX_GRID_N = 64
MIN_FIT_SAMPLES = 3

_LIST_KINDS = ("list[int]", "list[float]", "list[str]", "pairs")
_GRID_KINDS = ("grid", "grid[int]", "grid[str]")
_SET_KINDS = ("set[int]", "set[str]")


@dataclass(frozen=True)
class Dimension:
    """One way to grow the input: ``param`` along ``axis``."""

    param: str
    axis: str  # "len" | "nodes" | "value" | "both" | "rows" | "cols"
    kind: str  # the parameter's inferred type
    meaning: str
    max_n: int

    @property
    def id(self) -> str:
        # Only one-axis grid experiments need the axis to be unambiguous.
        return f"{self.param}:{self.axis}" if self.axis in ("rows", "cols") else self.param

    @property
    def is_collection(self) -> bool:
        return self.axis != "value"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "param": self.param,
            "axis": self.axis,
            "kind": self.kind,
            "meaning": self.meaning,
            "maxN": self.max_n,
        }


def _dimensions_for(param: Param) -> list[Dimension]:
    name, kind = param.name, param.inferred
    if kind in _LIST_KINDS or kind in _SET_KINDS or kind in ("str", "dict"):
        return [Dimension(name, "len", kind, f"n = len({name})", MAX_N)]
    if kind in _GRID_KINDS:
        return [
            Dimension(name, "both", kind, f"n = rows = columns of {name}", MAX_GRID_N),
            Dimension(name, "rows", kind, f"n = len({name}) (rows; columns fixed)", MAX_N),
            Dimension(name, "cols", kind, f"n = len({name}[0]) (columns; rows fixed)", MAX_N),
        ]
    if kind == "tree":
        return [Dimension(name, "nodes", kind, f"n = number of nodes in {name}", MAX_N)]
    if kind == "listnode":
        return [Dimension(name, "nodes", kind, f"n = number of nodes in {name}", MAX_N)]
    if kind == "int":
        return [Dimension(name, "value", kind, f"n = {name}", MAX_N)]
    return []


def size_dimensions(info: FunctionInfo) -> list[Dimension]:
    """Every dimension that could grow, in parameter order."""
    return [dimension for param in info.params for dimension in _dimensions_for(param)]


def default_dimension(dimensions: Sequence[Dimension]) -> Optional[Dimension]:
    """First sized collection, else the first int used as ``n``."""
    for dimension in dimensions:
        if dimension.is_collection:
            return dimension
    return dimensions[0] if dimensions else None


def pick_dimension(
    info: FunctionInfo, param: Optional[str], axis: Optional[str]
) -> Dimension:
    """Resolve the requested dimension, raising ``ValueError`` with a
    learner-facing message when it cannot grow."""
    dimensions = size_dimensions(info)
    if not dimensions:
        raise ValueError(
            f"{info.qualname} has no input that can grow. Complexity experiments need a "
            "list, string, dict, set, grid, tree, linked list or int parameter."
        )
    if not param:
        chosen = default_dimension(dimensions)
        assert chosen is not None
        return chosen
    matches = [dimension for dimension in dimensions if dimension.param == param]
    if not matches:
        known = next((p for p in info.params if p.name == param), None)
        if known is None:
            raise ValueError(f"{info.qualname} has no parameter named {param!r}.")
        raise ValueError(f"Parameter {param!r} ({known.inferred}) cannot grow with n.")
    if axis is None:
        return matches[0]
    for dimension in matches:
        if dimension.axis == axis:
            return dimension
    raise ValueError(f"Parameter {param!r} cannot grow along {axis!r}.")


def sanitize_sizes(sizes: Optional[Sequence[Any]], max_n: int) -> list[int]:
    """Sorted, unique sizes clamped to ``1..max_n``, at most ``MAX_SAMPLES``."""
    raw = list(sizes) if sizes else list(DEFAULT_SIZES)
    clean: set[int] = set()
    for size in raw:
        if isinstance(size, bool) or not isinstance(size, (int, float)):
            continue
        if not math.isfinite(size):
            continue
        clean.add(min(max(int(size), 1), max_n))
    if not clean:
        clean = {min(size, max_n) for size in DEFAULT_SIZES}
    return sorted(clean)[:MAX_SAMPLES]


def clamp_fixed_pointers(
    info: FunctionInfo,
    inputs: list[GeneratedInput],
    dimension: Dimension,
    smallest: int,
) -> None:
    """Keep generated index-like ints valid for every sampled size.

    The regular generator clamps ``k``/``left``-style indexes to the default
    collection length, but the experiment may start smaller. Only generated
    values are touched; a learner's own inputs stay exactly as typed.
    """
    if dimension.axis != "len":
        return
    by_name = {item.name: item for item in inputs}
    for pointer in info.pointer_hints.get(dimension.param, []):
        item = by_name.get(pointer)
        if item is None or item.type != "int" or pointer == dimension.param:
            continue
        try:
            value = int(item.literal)
        except ValueError:
            continue
        lower = 1 if pointer == "k" else 0
        upper = max(lower, smallest - 1)
        item.literal = repr(min(max(value, lower), upper))


def _unique_keys(rng: random.Random, count: int) -> list[str]:
    # The regular generator draws 3-letter keys, which run out at 64; a
    # random stem plus the index keeps keys unique at any size.
    return [f"{''.join(rng.choice('abcd') for _ in range(3))}{index}" for index in range(count)]


def _grid(rng: random.Random, rows: int, cols: int, strings: bool) -> list[list[Any]]:
    if strings:
        return [[rng.choice("abcd") for _ in range(cols)] for _ in range(rows)]
    return [[rng.randint(0, 9) for _ in range(cols)] for _ in range(rows)]


def _tree_values(rng: random.Random, count: int) -> list[Optional[int]]:
    """Level-order values with exactly ``count`` nodes and a few gaps."""
    values: list[Optional[int]] = []
    nodes = 0
    while nodes < count:
        # Never start with a gap: a None root would drop the whole tree.
        if values and rng.random() < 0.15:
            values.append(None)
        else:
            values.append(rng.randint(*DEFAULT_INT_RANGE))
            nodes += 1
    return values


def _grid_shape(base: Any) -> tuple[int, int]:
    """Rows/columns of the fixed grid that a one-axis experiment keeps."""
    if isinstance(base, list) and base and isinstance(base[0], list):
        return len(base), len(base[0])
    return 4, 4


def generate_sized_input(
    param: Param,
    dimension: Dimension,
    size: int,
    rng: random.Random,
    base_value: Any = None,
) -> GeneratedInput:
    """Literal for ``param`` grown to ``size`` along ``dimension``."""
    kind = param.inferred
    if dimension.axis in ("rows", "cols"):
        rows, cols = _grid_shape(base_value)
        if dimension.axis == "rows":
            rows = size
        else:
            cols = size
        literal = repr(_grid(rng, rows, cols, kind == "grid[str]"))
    elif kind == "dict":
        literal = repr({key: rng.randint(*DEFAULT_INT_RANGE) for key in _unique_keys(rng, size)})
    elif kind == "tree":
        literal = f"tree({_tree_values(rng, size)!r})"
    else:
        # Lists, strings, sets, pairs, square grids, linked lists and ints
        # already honour an explicit size in the regular generator.
        return generate_input(param, rng, size)
    return GeneratedInput(name=param.name, type=kind, literal=literal)


def measure_size(value: Any, dimension: Dimension) -> Optional[int]:
    """The ``n`` a generated value actually has along ``dimension``."""
    try:
        if dimension.axis == "value":
            return int(value) if isinstance(value, int) and not isinstance(value, bool) else None
        if dimension.axis == "cols":
            return len(value[0]) if value else 0
        if dimension.axis == "nodes":
            return _count_nodes(value)
        return len(value)
    except (TypeError, IndexError, KeyError):
        return None


def _count_nodes(root: Any, limit: int = 100_000) -> int:
    count = 0
    pending = [root]
    seen: set[int] = set()
    while pending and count < limit:
        node = pending.pop()
        if node is None or id(node) in seen:
            continue
        seen.add(id(node))
        count += 1
        for attr in ("left", "right", "next"):
            if hasattr(node, attr):
                pending.append(getattr(node, attr))
    return count


# -- fitting -----------------------------------------------------------------

#: Polynomial-family candidates, simplest first. The order is the tie-break.
MODELS: tuple[tuple[str, str, Callable[[float], float]], ...] = (
    ("1", "O(1)", lambda n: 1.0),
    ("log n", "O(log n)", lambda n: math.log2(n)),
    ("n", "O(n)", lambda n: n),
    ("n log n", "O(n log n)", lambda n: n * math.log2(n)),
    ("n^2", "O(n²)", lambda n: n * n),
    ("n^3", "O(n³)", lambda n: n**3),
)
# No exponential run could finish 1.2^64+ steps inside the limits, and much
# larger powers overflow floats, so exponentials are only tried below this.
_MAX_EXPONENTIAL_N = 64
_MIN_EXPONENTIAL_BASE = 1.2
GOOD_ERROR = 0.05
FAIR_ERROR = 0.15


@dataclass
class _Candidate:
    model: str
    label: str
    predict: Callable[[float], float]
    error: float


def _relative_error(points: Sequence[tuple[float, float]], predict: Callable[[float], float]) -> float:
    return math.sqrt(sum(((predict(n) - y) / y) ** 2 for n, y in points) / len(points))


def _fit_scaled(
    points: Sequence[tuple[float, float]], fn: Callable[[float], float]
) -> tuple[float, float]:
    """Fit ``steps ≈ a + b·f(n)`` with ``b ≥ 0`` by least squares on
    relative error (weights ``1/steps²``), so small and large samples count
    equally. ``a`` absorbs fixed overhead such as the call itself; it may be
    negative because loops like ``range(k, n)`` start part-way in."""
    fs = [fn(n) for n, _ in points]
    ys = [steps for _, steps in points]
    weights = [1.0 / (y * y) for y in ys]
    s = sum(weights)
    sf = sum(w * f for w, f in zip(weights, fs))
    sff = sum(w * f * f for w, f in zip(weights, fs))
    sy = sum(w * y for w, y in zip(weights, ys))
    sfy = sum(w * f * y for w, f, y in zip(weights, fs, ys))
    det = s * sff - sf * sf
    if det <= 1e-12 * max(s * sff, 1e-300):
        return sy / s, 0.0
    b = (s * sfy - sf * sy) / det
    a = (sy - b * sf) / s
    if b < 0:
        return sy / s, 0.0
    return a, b


def _fit_exponential(points: Sequence[tuple[float, float]]) -> Optional[_Candidate]:
    """Fit ``steps ≈ c·bⁿ`` by a straight line through ``(n, ln steps)``.

    The base is free because real exponential code rarely doubles exactly
    (naive Fibonacci grows like 1.6ⁿ)."""
    if points[-1][0] > _MAX_EXPONENTIAL_N:
        return None
    xs = [n for n, _ in points]
    ys = [math.log(steps) for _, steps in points]
    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)
    spread = sum((x - mean_x) ** 2 for x in xs)
    if spread <= 0:
        return None
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / spread
    base = math.exp(slope)
    if base < _MIN_EXPONENTIAL_BASE:
        return None
    scale = math.exp(mean_y - slope * mean_x)
    base_text = "2" if abs(base - 2) < 0.15 else f"{base:.1f}"
    predict = lambda n: scale * base**n  # noqa: E731
    return _Candidate("c^n", f"O({base_text}ⁿ)", predict, _relative_error(points, predict))


def _curve(
    predict: Callable[[float], float], low: float, high: float, count: int = 24
) -> list[dict[str, float]]:
    if high <= low:
        return [{"n": low, "ops": round(predict(low), 3)}]
    ratio = high / low
    points = []
    for index in range(count):
        n = low * ratio ** (index / (count - 1))
        points.append({"n": round(n, 3), "ops": round(predict(n), 3)})
    return points


def _scaled(a: float, b: float, fn: Callable[[float], float]) -> Callable[[float], float]:
    return lambda n: a + b * fn(n)


def fit_growth(samples: Sequence[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Choose the candidate growth model that best explains the ``ok`` samples.

    Polynomial-family models are fitted as ``a + b·f(n)`` and exponentials as
    ``c·bⁿ``. The lowest relative error wins, except that a simpler model
    within a small tolerance of the best is preferred, because a handful of
    small sizes cannot reliably tell ``n`` from ``n log n``. Returns ``None``
    with fewer than :data:`MIN_FIT_SAMPLES` distinct valid sizes.
    """
    points = sorted(
        (float(sample["n"]), float(sample["ops"]))
        for sample in samples
        if sample.get("status", "ok") == "ok" and sample["n"] >= 1 and sample["ops"] > 0
    )
    if len({n for n, _ in points}) < MIN_FIT_SAMPLES:
        return None

    smallest, largest = points[0][0], points[-1][0]
    candidates: list[_Candidate] = []
    for model, label, fn in MODELS:
        a, b = _fit_scaled(points, fn)
        # A growth term that adds less than one step across the whole range
        # is the constant model in disguise; don't let it compete.
        if model != "1" and b * (fn(largest) - fn(smallest)) < 1.0:
            continue
        predict = _scaled(a, b, fn)
        candidates.append(_Candidate(model, label, predict, _relative_error(points, predict)))
    exponential = _fit_exponential(points)
    if exponential:
        candidates.append(exponential)

    best_error = min(candidate.error for candidate in candidates)
    tolerance = 0.01 + 0.25 * best_error
    chosen = next(c for c in candidates if c.error <= best_error + tolerance)
    others = sorted((c for c in candidates if c is not chosen), key=lambda c: c.error)
    runner_up = others[0] if others else None
    error = chosen.error
    quality = "good" if error <= GOOD_ERROR else "fair" if error <= FAIR_ERROR else "poor"
    return {
        "model": chosen.model,
        "label": chosen.label,
        "error": round(error, 4),
        "quality": quality,
        "samplesUsed": len(points),
        "runnerUp": (
            {"label": runner_up.label, "error": round(runner_up.error, 4)}
            if runner_up and runner_up.error <= max(error * 1.5, error + 0.03)
            else None
        ),
        "curve": _curve(chosen.predict, smallest, largest),
    }


def fit_caveats(
    samples: Sequence[dict[str, Any]],
    fit: Optional[dict[str, Any]],
    fixed_from_user: bool,
) -> list[str]:
    """Plain-language reasons to trust the fit less."""
    valid = [sample for sample in samples if sample.get("status") == "ok"]
    failed = [sample for sample in samples if sample.get("status") not in ("ok", "skipped")]
    skipped = [sample for sample in samples if sample.get("status") == "skipped"]
    caveats: list[str] = []
    if len(valid) < MIN_FIT_SAMPLES:
        caveats.append(
            f"Only {len(valid)} sample{'s' if len(valid) != 1 else ''} finished; at least "
            f"{MIN_FIT_SAMPLES} are needed to estimate growth."
        )
    elif len(valid) < 5:
        caveats.append(f"Only {len(valid)} samples finished, so treat this as a rough guess.")
    if failed or skipped:
        left_out = len(failed) + len(skipped)
        caveats.append(
            f"{left_out} sample{'s were' if left_out != 1 else ' was'} left out of the fit "
            "(see the table)."
        )
    if valid:
        sizes = [sample["n"] for sample in valid]
        low, high = min(sizes), max(sizes)
        if low > 0 and high / low < 8 and len(valid) >= MIN_FIT_SAMPLES:
            caveats.append(
                "The sizes span less than 8×, which makes similar growth rates hard to tell apart."
            )
        if high < 16:
            caveats.append("All sizes are small, so fixed overhead can hide the real growth.")
    if fit:
        if fit["quality"] == "poor":
            caveats.append(
                "No candidate curve fits well; the step count may depend on the values in the "
                "input, not only its size."
            )
        if fit["runnerUp"]:
            caveats.append(f"{fit['runnerUp']['label']} fits almost as well.")
        if fit["model"] in ("1", "log n") and fixed_from_user:
            caveats.append(
                "Steps barely grew with n. If a fixed input lets the function exit early (for "
                "example a target that is found quickly), try generated defaults for the other "
                "inputs."
            )
    return caveats


# -- static structure --------------------------------------------------------

_SORT_CALLS = frozenset({"sorted"})
_SORT_METHODS = frozenset({"sort"})
_SCALING_OPS = (ast.FloorDiv, ast.Div, ast.Mult)


def _cost_label(power: int, logs: int) -> str:
    if power == 0 and logs == 0:
        return "O(1)"
    parts = []
    if power == 1:
        parts.append("n")
    elif power == 2:
        parts.append("n²")
    elif power == 3:
        parts.append("n³")
    elif power > 3:
        parts.append(f"n^{power}")
    if logs == 1:
        parts.append("log n")
    elif logs > 1:
        parts.append(f"log^{logs} n")
    return f"O({' '.join(parts)})"


def _is_constant(node: ast.expr) -> bool:
    if isinstance(node, ast.Constant):
        return True
    if isinstance(node, ast.UnaryOp):
        return _is_constant(node.operand)
    if isinstance(node, ast.BinOp):
        return _is_constant(node.left) and _is_constant(node.right)
    return False


def _constant_iterable(node: ast.expr) -> bool:
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return all(_is_constant(item) for item in node.elts)
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return True
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "range"
        and node.args
    ):
        return all(_is_constant(arg) for arg in node.args)
    return False


def _shallow_nodes(statements: Sequence[ast.AST]) -> list[ast.AST]:
    """All nodes under ``statements`` except those inside nested loops or
    functions, which make their own decisions."""
    found: list[ast.AST] = []
    pending = list(statements)
    while pending:
        node = pending.pop()
        found.append(node)
        for child in ast.iter_child_nodes(node):
            if not isinstance(
                child, (ast.For, ast.AsyncFor, ast.While, ast.FunctionDef, ast.AsyncFunctionDef)
            ):
                pending.append(child)
    return found


def _halving_step(node: ast.AST) -> bool:
    """``x // 2``, ``x >> 1``, ``x / 2``: a geometric step in a loop variable."""
    if not isinstance(node, ast.BinOp) or not isinstance(node.right, ast.Constant):
        return False
    value = node.right.value
    if isinstance(node.op, ast.RShift):
        return value != 0
    return isinstance(node.op, (ast.FloorDiv, ast.Div)) and value not in (0, 1)


def _halves(statements: Sequence[ast.stmt]) -> bool:
    """True when a loop body shrinks or grows a variable geometrically
    (``i //= 2``, ``mid = (lo + hi) // 2``, ``step *= 2`` ...)."""
    for node in _shallow_nodes(statements):
        if isinstance(node, ast.AugAssign) and isinstance(node.value, ast.Constant):
            value = node.value.value
            if isinstance(node.op, (ast.RShift, ast.LShift)) and value != 0:
                return True
            if isinstance(node.op, _SCALING_OPS) and value not in (0, 1):
                return True
        if isinstance(node, ast.Assign) and any(
            _halving_step(part) for part in ast.walk(node.value)
        ):
            return True
    return False


class _StructureVisitor:
    """Walks one function body tracking the costliest loop nest."""

    def __init__(self, self_names: set[str]) -> None:
        self.self_names = self_names
        self.max_depth = 0
        self.self_calls = 0
        self.uses_sort = False
        self.nested_recursion: list[str] = []

    def cost(self, statements: Sequence[ast.AST], depth: int = 0) -> tuple[int, int]:
        best = (0, 0)
        for statement in statements:
            best = max(best, self._node_cost(statement, depth))
        return best

    def _node_cost(self, node: ast.AST, depth: int) -> tuple[int, int]:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if _calls_name(node, node.name):
                self.nested_recursion.append(node.name)
            return (0, 0)
        if isinstance(node, (ast.ClassDef, ast.Lambda)):
            return (0, 0)
        if isinstance(node, (ast.For, ast.AsyncFor)):
            factor = (0, 0) if _constant_iterable(node.iter) else (1, 0)
            return max(
                self._loop(factor, node.body, depth),
                self.cost([node.iter, *node.orelse], depth),
            )
        if isinstance(node, ast.While):
            factor = (0, 1) if _halves(node.body) else (1, 0)
            return max(
                self._loop(factor, node.body, depth),
                self.cost([node.test, *node.orelse], depth),
            )
        if isinstance(node, (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp)):
            return self._comprehension(node, depth)
        own = (0, 0)
        if isinstance(node, ast.Call):
            own = self._call_cost(node)
        children = list(ast.iter_child_nodes(node))
        return max(own, self.cost(children, depth))

    def _loop(self, factor: tuple[int, int], body: Sequence[ast.AST], depth: int) -> tuple[int, int]:
        self.max_depth = max(self.max_depth, depth + (1 if factor != (0, 0) else 0))
        inner = self.cost(body, depth + (1 if factor != (0, 0) else 0))
        return (factor[0] + inner[0], factor[1] + inner[1])

    def _comprehension(self, node: ast.AST, depth: int) -> tuple[int, int]:
        generators = getattr(node, "generators", [])
        power = sum(0 if _constant_iterable(gen.iter) else 1 for gen in generators)
        self.max_depth = max(self.max_depth, depth + power)
        elements = [
            getattr(node, attr) for attr in ("elt", "key", "value") if hasattr(node, attr)
        ]
        inner = self.cost(elements, depth + power)
        return (power + inner[0], inner[1])

    def _call_cost(self, node: ast.Call) -> tuple[int, int]:
        func = node.func
        if isinstance(func, ast.Name) and func.id in self.self_names:
            self.self_calls += 1
        elif (
            isinstance(func, ast.Attribute)
            and func.attr in self.self_names
            and isinstance(func.value, ast.Name)
            and func.value.id in ("self", "cls")
        ):
            self.self_calls += 1
        if (isinstance(func, ast.Name) and func.id in _SORT_CALLS) or (
            isinstance(func, ast.Attribute) and func.attr in _SORT_METHODS
        ):
            self.uses_sort = True
            return (1, 1)
        return (0, 0)


def _calls_name(function: ast.FunctionDef | ast.AsyncFunctionDef, name: str) -> bool:
    for node in ast.walk(function):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == name:
            return True
    return False


def _find_function(
    tree: ast.Module, info: FunctionInfo
) -> Optional[ast.FunctionDef | ast.AsyncFunctionDef]:
    body: list[ast.stmt] = tree.body
    if info.class_name:
        owner = next(
            (
                node
                for node in tree.body
                if isinstance(node, ast.ClassDef) and node.name == info.class_name
            ),
            None,
        )
        if owner is None:
            return None
        body = owner.body
    return next(
        (
            node
            for node in body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == info.name
        ),
        None,
    )


def structure_hint(source: str, info: FunctionInfo) -> Optional[dict[str, Any]]:
    """Heuristic reading of loop nesting and recursion in ``info``'s body.

    Every loop that is not over a constant range counts as ``n``, a
    ``while`` loop that halves a variable counts as ``log n`` and a call to
    ``sorted``/``.sort`` counts as ``n log n``. Recursion makes the loop
    count meaningless on its own, so no label is given then.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return None
    function = _find_function(tree, info)
    if function is None:
        return None
    visitor = _StructureVisitor({info.name})
    power, logs = visitor.cost(function.body)
    notes: list[str] = []
    depth = visitor.max_depth
    if depth == 0:
        notes.append("No loops that depend on the input were found.")
    elif depth == 1:
        notes.append("Loops nest 1 level deep.")
    else:
        notes.append(f"Loops nest {depth} levels deep.")
    recursive = visitor.self_calls > 0 or bool(visitor.nested_recursion)
    if visitor.self_calls > 0:
        places = "1 place" if visitor.self_calls == 1 else f"{visitor.self_calls} places"
        notes.append(
            f"{info.name} calls itself from {places}, so loop nesting alone cannot predict "
            "the cost."
        )
    for helper in visitor.nested_recursion:
        notes.append(
            f"The nested helper {helper}() is recursive, so loop nesting alone cannot predict "
            "the cost."
        )
    if visitor.uses_sort:
        notes.append(
            "Sorting costs about O(n log n) inside Python but counts as a single step in the "
            "measurement."
        )
    return {
        "label": None if recursive else _cost_label(power, logs),
        "loopDepth": depth,
        "recursive": recursive,
        "notes": notes,
    }
