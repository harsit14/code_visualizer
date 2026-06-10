"""Seeded generation of test inputs for inferred parameter types.

Inputs are produced as **Python literal strings** (e.g. ``"[3, 7, 1]"`` or
``"tree([5, 3, 8])"``) so the UI can show and let the user edit them, and
``evaluate_input`` turns a literal back into a runtime value inside a
restricted namespace that only exposes the structure builders.
"""

from __future__ import annotations

import ast
import random
from dataclasses import dataclass
from typing import Any, Optional

from .analyzer import FunctionInfo, Param
from .structures import ListNode, TreeNode, build_linked_list, build_tree

DEFAULT_LIST_SIZE = (5, 8)
DEFAULT_STR_SIZE = (6, 10)
DEFAULT_INT_RANGE = (1, 20)


@dataclass
class GeneratedInput:
    """One generated argument, as an editable literal."""

    name: str
    type: str
    literal: str

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "type": self.type, "literal": self.literal}


def _gen_list_int(rng: random.Random, size: Optional[int] = None) -> list[int]:
    length = size if size is not None else rng.randint(*DEFAULT_LIST_SIZE)
    return [rng.randint(*DEFAULT_INT_RANGE) for _ in range(length)]


def _gen_str(rng: random.Random, size: Optional[int] = None) -> str:
    length = size if size is not None else rng.randint(*DEFAULT_STR_SIZE)
    # Small alphabet so duplicate/palindrome patterns actually occur.
    return "".join(rng.choice("abcd") for _ in range(length))


def _gen_pairs(rng: random.Random, size: Optional[int] = None) -> list[list[int]]:
    count = size if size is not None else rng.randint(3, 5)
    pairs = []
    for _ in range(count):
        start = rng.randint(0, 12)
        pairs.append([start, start + rng.randint(1, 5)])
    pairs.sort()
    return pairs


def _gen_grid(rng: random.Random, size: Optional[int] = None) -> list[list[int]]:
    rows = size if size is not None else rng.randint(3, 4)
    cols = rng.randint(3, 4) if size is None else size
    return [[rng.randint(0, 9) for _ in range(cols)] for _ in range(rows)]


def _gen_tree_values(rng: random.Random, size: Optional[int] = None) -> list[int | None]:
    """Level-order values for a small random tree with a few gaps."""
    count = size if size is not None else rng.randint(5, 7)
    values: list[int | None] = [rng.randint(1, 20)]
    while sum(1 for v in values if v is not None) < count and len(values) < count * 2:
        if rng.random() < 0.85:
            values.append(rng.randint(1, 20))
        else:
            values.append(None)
    while values and values[-1] is None:
        values.pop()
    return values


def generate_input(
    param: Param, rng: random.Random, size: Optional[int] = None
) -> GeneratedInput:
    """Generate a literal for one parameter based on its inferred type."""
    kind = param.inferred
    if kind == "int":
        value = rng.randint(*DEFAULT_INT_RANGE) if size is None else size
        literal = repr(value)
    elif kind == "float":
        literal = repr(round(rng.uniform(0.5, 10.0), 2))
    elif kind == "bool":
        literal = repr(rng.random() < 0.5)
    elif kind == "str":
        literal = repr(_gen_str(rng, size))
    elif kind == "list[int]":
        literal = repr(_gen_list_int(rng, size))
    elif kind == "list[str]":
        count = size if size is not None else rng.randint(3, 5)
        literal = repr([_gen_str(rng, rng.randint(3, 5)) for _ in range(count)])
    elif kind == "grid":
        literal = repr(_gen_grid(rng, size))
    elif kind == "pairs":
        literal = repr(_gen_pairs(rng, size))
    elif kind == "dict":
        keys = [_gen_str(rng, 3) for _ in range(size if size is not None else 4)]
        literal = repr({key: rng.randint(*DEFAULT_INT_RANGE) for key in keys})
    elif kind == "tree":
        literal = f"tree({_gen_tree_values(rng, size)!r})"
    elif kind == "listnode":
        literal = f"linked({_gen_list_int(rng, size)!r})"
    else:
        literal = repr(rng.randint(*DEFAULT_INT_RANGE))
    return GeneratedInput(name=param.name, type=kind, literal=literal)


def _coordinate(inputs: list[GeneratedInput], params: list[Param], rng: random.Random) -> None:
    """Make related parameters consistent so runs are meaningful.

    * ``target`` next to a ``list[int]`` becomes the sum of two distinct
      elements (the two-sum family has an answer).
    * ``k``/index-like ints are clamped into the bounds of a sibling list
      or string.
    """
    by_name = {generated.name: generated for generated in inputs}
    list_values: Optional[list[int]] = None
    sized_length: Optional[int] = None
    for generated in inputs:
        if generated.type == "list[int]":
            list_values = ast.literal_eval(generated.literal)
            sized_length = len(list_values)
            break
        if generated.type == "str" and sized_length is None:
            sized_length = len(ast.literal_eval(generated.literal))

    target = by_name.get("target")
    if target is not None and target.type == "int" and list_values and len(list_values) >= 2:
        first, second = rng.sample(range(len(list_values)), 2)
        target.literal = repr(list_values[first] + list_values[second])

    if sized_length:
        for name in ("k", "idx", "index"):
            generated = by_name.get(name)
            if generated is not None and generated.type == "int":
                generated.literal = repr(rng.randint(1, max(1, sized_length - 1)))


def generate_inputs(
    function: FunctionInfo, seed: Optional[int] = None, size: Optional[int] = None
) -> tuple[list[GeneratedInput], int]:
    """Generate inputs for every parameter of ``function``.

    Returns ``(inputs, seed_used)`` — pass the seed back in to reproduce.
    """
    seed_used = seed if seed is not None else random.SystemRandom().randint(0, 999_999)
    rng = random.Random(seed_used)
    inputs = [generate_input(param, rng, size) for param in function.params]
    _coordinate(inputs, function.params, rng)
    return inputs, seed_used


def evaluate_input(literal: str, extra_env: Optional[dict[str, Any]] = None) -> Any:
    """Evaluate an input literal in a restricted namespace.

    Only structure builders (``tree``, ``linked``, ``TreeNode``,
    ``ListNode``) are available; there are no builtins. Execution happens
    inside the Pyodide sandbox regardless — this just keeps input
    expressions honest.
    """
    env: dict[str, Any] = {
        "__builtins__": {},
        "tree": build_tree,
        "linked": build_linked_list,
        "TreeNode": TreeNode,
        "ListNode": ListNode,
    }
    if extra_env:
        env.update(extra_env)
    return eval(literal, env)  # noqa: S307 - restricted env, sandboxed runtime
