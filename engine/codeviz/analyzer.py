"""Static analysis of user source code.

Answers three questions before anything runs:

1. **Mode** — does this file drive itself (``script``) or is it a bare
   function/class with no entry point (``function``)?
2. **Callables** — which functions/methods could be invoked, and which is
   the best default target?
3. **Parameter types** — for each parameter, what type should we generate,
   inferred from (in priority order) type hints, strong usage signals in
   the body (``p.next``, ``p[i][j]``, string methods, ...), parameter-name
   conventions (``nums``, ``s``, ``root``, ...), then weak usage signals.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field
from typing import Any, Optional

#: Canonical inferred-type vocabulary understood by ``inputgen``.
TYPES = (
    "int",
    "float",
    "bool",
    "str",
    "list[int]",
    "list[float]",
    "list[str]",
    "grid",  # list[list[int]]
    "pairs",  # list of [start, end] pairs (intervals/edges)
    "dict",
    "tree",
    "listnode",
)

_NAME_HINTS: dict[str, str] = {
    # list[int]
    "nums": "list[int]", "arr": "list[int]", "array": "list[int]",
    "numbers": "list[int]", "values": "list[int]", "vals": "list[int]",
    "digits": "list[int]", "heights": "list[int]", "prices": "list[int]",
    "nums1": "list[int]", "nums2": "list[int]", "weights": "list[int]",
    "candies": "list[int]", "gas": "list[int]", "cost": "list[int]",
    "costs": "list[int]", "stones": "list[int]", "citations": "list[int]",
    # str
    "s": "str", "t": "str", "word": "str", "text": "str", "string": "str",
    "str1": "str", "str2": "str", "s1": "str", "s2": "str",
    "pattern": "str", "haystack": "str", "needle": "str",
    "sentence": "str", "expression": "str", "path": "str", "ransomnote": "str",
    # list[str]
    "words": "list[str]", "strs": "list[str]", "tokens": "list[str]",
    "wordlist": "list[str]", "sentences": "list[str]", "dictionary": "list[str]",
    # int
    "n": "int", "k": "int", "m": "int", "x": "int", "num": "int",
    "target": "int", "amount": "int", "capacity": "int", "idx": "int",
    "index": "int", "left": "int", "right": "int", "lo": "int", "hi": "int",
    "start": "int", "end": "int", "size": "int", "length": "int",
    "numrows": "int", "numcourses": "int", "val": "int", "limit": "int",
    # float
    "ratio": "float", "rate": "float",
    # tree / linked list
    "root": "tree", "node": "tree", "p": "tree", "q": "tree",
    "head": "listnode", "list1": "listnode", "list2": "listnode",
    "l1": "listnode", "l2": "listnode",
    # grid
    "grid": "grid", "matrix": "grid", "board": "grid", "maze": "grid",
    "image": "grid", "rooms": "grid", "mat": "grid",
    # pairs
    "intervals": "pairs", "pairs": "pairs", "edges": "pairs",
    "meetings": "pairs", "points": "pairs", "trips": "pairs",
    "prerequisites": "pairs",
}

_STR_METHODS = frozenset(
    "lower upper split strip lstrip rstrip join startswith endswith isalpha "
    "isdigit isalnum islower isupper replace find rfind index count title "
    "casefold encode swapcase zfill center ljust rjust partition".split()
)

_ANNOTATION_TYPES: dict[str, str] = {
    "int": "int",
    "float": "float",
    "bool": "bool",
    "str": "str",
    "list[int]": "list[int]",
    "list[float]": "list[float]",
    "list[str]": "list[str]",
    "list[list[int]]": "grid",
    "list[list[str]]": "grid",
    "list[bool]": "list[int]",
    "dict": "dict",
    "treenode": "tree",
    "optional[treenode]": "tree",
    "treenode | none": "tree",
    "listnode": "listnode",
    "optional[listnode]": "listnode",
    "listnode | none": "listnode",
}


@dataclass
class Param:
    """A single function parameter with its inferred input type."""

    name: str
    annotation: Optional[str]
    inferred: str
    source: str  # "hint" | "usage" | "name" | "default"

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "annotation": self.annotation,
            "inferred": self.inferred,
            "source": self.source,
        }


@dataclass
class FunctionInfo:
    """A callable discovered in the user source."""

    name: str
    qualname: str
    class_name: Optional[str]
    params: list[Param]
    line: int
    is_generator: bool
    docstring: Optional[str]
    returns: Optional[str]
    pointer_hints: dict[str, list[str]] = field(default_factory=dict)
    assignment_hints: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "qualname": self.qualname,
            "className": self.class_name,
            "params": [param.to_dict() for param in self.params],
            "line": self.line,
            "isGenerator": self.is_generator,
            "docstring": self.docstring,
            "returns": self.returns,
            "pointerHints": self.pointer_hints,
            "assignmentHints": self.assignment_hints,
        }


@dataclass
class Analysis:
    """Result of statically analyzing one source file."""

    mode: str  # "script" | "function" | "empty"
    functions: list[FunctionInfo] = field(default_factory=list)
    default_function: Optional[str] = None  # qualname
    defines_tree_node: bool = False
    defines_list_node: bool = False
    references_tree_node: bool = False
    references_list_node: bool = False
    module_pointer_hints: dict[str, list[str]] = field(default_factory=dict)
    module_assignment_hints: list[dict[str, Any]] = field(default_factory=list)
    diagnostics: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "functions": [fn.to_dict() for fn in self.functions],
            "defaultFunction": self.default_function,
            "definesTreeNode": self.defines_tree_node,
            "definesListNode": self.defines_list_node,
            "referencesTreeNode": self.references_tree_node,
            "referencesListNode": self.references_list_node,
            "modulePointerHints": self.module_pointer_hints,
            "moduleAssignmentHints": self.module_assignment_hints,
            "diagnostics": self.diagnostics,
        }

    def get_function(self, qualname: str) -> Optional[FunctionInfo]:
        for fn in self.functions:
            if fn.qualname == qualname or fn.name == qualname:
                return fn
        return None


def _annotation_to_type(annotation: ast.expr) -> Optional[str]:
    try:
        text = ast.unparse(annotation).strip().lower().replace("typing.", "")
    except Exception:
        return None
    return _ANNOTATION_TYPES.get(text)


class _UsageVisitor(ast.NodeVisitor):
    """Collects strong/weak usage signals for each parameter inside a body."""

    def __init__(self, param_names: set[str]) -> None:
        self.params = param_names
        self.strong: dict[str, str] = {}
        self.weak: dict[str, str] = {}

    def _param_of(self, node: ast.expr) -> Optional[str]:
        if isinstance(node, ast.Name) and node.id in self.params:
            return node.id
        return None

    def _set_strong(self, name: Optional[str], inferred: str) -> None:
        if name and name not in self.strong:
            self.strong[name] = inferred

    def _set_weak(self, name: Optional[str], inferred: str) -> None:
        if name and name not in self.weak:
            self.weak[name] = inferred

    def visit_Attribute(self, node: ast.Attribute) -> None:
        name = self._param_of(node.value)
        if name:
            if node.attr in ("left", "right"):
                self._set_strong(name, "tree")
            elif node.attr == "next":
                self._set_strong(name, "listnode")
            elif node.attr == "val":
                self._set_weak(name, "tree")
            elif node.attr in _STR_METHODS:
                self._set_strong(name, "str")
        self.generic_visit(node)

    def visit_Subscript(self, node: ast.Subscript) -> None:
        # p[i][j] -> grid
        if isinstance(node.value, ast.Subscript):
            name = self._param_of(node.value.value)
            self._set_strong(name, "grid")
        else:
            # A bare index or a slice both signal a sequence, but neither
            # distinguishes list from str — keep it weak so name hints
            # (e.g. ``s`` -> str) and explicit annotations still win.
            name = self._param_of(node.value)
            self._set_weak(name, "list[int]")
        self.generic_visit(node)

    def visit_For(self, node: ast.For) -> None:
        name = self._param_of(node.iter)
        if name:
            if isinstance(node.target, (ast.Tuple, ast.List)) and len(
                node.target.elts
            ) == 2:
                self._set_strong(name, "pairs")
            else:
                self._set_weak(name, "list[int]")
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name) and node.args:
            name = self._param_of(node.args[0])
            if node.func.id == "range":
                self._set_weak(name, "int")
            elif node.func.id == "len":
                self._set_weak(name, "list[int]")
        self.generic_visit(node)

    def visit_BinOp(self, node: ast.BinOp) -> None:
        for side, other in ((node.left, node.right), (node.right, node.left)):
            name = self._param_of(side)
            if name and isinstance(other, ast.Constant):
                if isinstance(other.value, (int, float)) and not isinstance(
                    node.op, ast.Mult
                ):
                    self._set_weak(name, "int")
                elif isinstance(other.value, str):
                    self._set_strong(name, "str")
        self.generic_visit(node)

    def visit_Compare(self, node: ast.Compare) -> None:
        operands = [node.left, *node.comparators]
        for index, operand in enumerate(operands):
            name = self._param_of(operand)
            if not name:
                continue
            others = operands[:index] + operands[index + 1 :]
            for other in others:
                if isinstance(other, ast.Constant) and isinstance(
                    other.value, (int, float)
                ):
                    self._set_weak(name, "int")
                elif isinstance(other, ast.Constant) and isinstance(other.value, str):
                    self._set_strong(name, "str")
        self.generic_visit(node)


def _infer_params(node: ast.FunctionDef | ast.AsyncFunctionDef, is_method: bool) -> list[Param]:
    args = node.args.args
    if is_method and args and args[0].arg in ("self", "cls"):
        args = args[1:]

    param_names = {arg.arg for arg in args}
    usage = _UsageVisitor(param_names)
    for statement in node.body:
        usage.visit(statement)

    params: list[Param] = []
    for arg in args:
        annotation_text: Optional[str] = None
        if arg.annotation is not None:
            try:
                annotation_text = ast.unparse(arg.annotation)
            except Exception:
                annotation_text = None

        hinted = _annotation_to_type(arg.annotation) if arg.annotation else None
        lower = arg.arg.lower()
        if hinted:
            inferred, source = hinted, "hint"
        elif arg.arg in usage.strong:
            inferred, source = usage.strong[arg.arg], "usage"
        elif lower in _NAME_HINTS:
            inferred, source = _NAME_HINTS[lower], "name"
        elif arg.arg in usage.weak:
            inferred, source = usage.weak[arg.arg], "usage"
        else:
            inferred, source = "int", "default"
        params.append(
            Param(name=arg.arg, annotation=annotation_text, inferred=inferred, source=source)
        )
    return params


class _PointerHintVisitor(ast.NodeVisitor):
    """Collect sequence -> integer names that source uses as indexes.

    This keeps the UI from treating every in-range variable named ``i`` or
    ``left`` as a marker for every list/string in scope. Only direct index
    names, slice bounds, ``enumerate(seq)``, and ``range(len(seq))`` are
    considered strong enough hints.
    """

    def __init__(self) -> None:
        self.hints: dict[str, set[str]] = {}

    def result(self) -> dict[str, list[str]]:
        return {name: sorted(pointers) for name, pointers in sorted(self.hints.items())}

    def _add(self, sequence_name: Optional[str], pointer_name: Optional[str]) -> None:
        if not sequence_name or not pointer_name:
            return
        self.hints.setdefault(sequence_name, set()).add(pointer_name)

    @staticmethod
    def _name(node: ast.AST | None) -> Optional[str]:
        if isinstance(node, ast.Name):
            return node.id
        return None

    def _extract_names(self, node: ast.expr | None) -> list[str]:
        """Recurse into expressions to collect variable name references."""
        if node is None:
            return []
        if isinstance(node, ast.Name):
            return [node.id]
        if isinstance(node, ast.BinOp):
            return self._extract_names(node.left) + self._extract_names(node.right)
        if isinstance(node, ast.UnaryOp):
            return self._extract_names(node.operand)
        return []

    def _record_slice(self, sequence_name: str, slice_node: ast.expr) -> None:
        if isinstance(slice_node, ast.Name):
            self._add(sequence_name, slice_node.id)
        elif isinstance(slice_node, ast.Slice):
            for name in self._extract_names(slice_node.lower):
                self._add(sequence_name, name)
            for name in self._extract_names(slice_node.upper):
                self._add(sequence_name, name)
        elif isinstance(slice_node, (ast.BinOp, ast.UnaryOp)):
            for name in self._extract_names(slice_node):
                self._add(sequence_name, name)

    def visit_Subscript(self, node: ast.Subscript) -> None:
        sequence_name = self._name(node.value)
        if sequence_name:
            self._record_slice(sequence_name, node.slice)
        self.generic_visit(node)

    def visit_For(self, node: ast.For) -> None:
        target_name: Optional[str] = None
        if isinstance(node.target, ast.Name):
            target_name = node.target.id
        elif isinstance(node.target, (ast.Tuple, ast.List)) and node.target.elts:
            target_name = self._name(node.target.elts[0])

        iter_node = node.iter
        if isinstance(iter_node, ast.Call) and isinstance(iter_node.func, ast.Name):
            if iter_node.func.id == "enumerate" and iter_node.args:
                self._add(self._name(iter_node.args[0]), target_name)
            elif iter_node.func.id == "range" and iter_node.args:
                length_arg = iter_node.args[1] if len(iter_node.args) > 1 else iter_node.args[0]
                if (
                    isinstance(length_arg, ast.Call)
                    and isinstance(length_arg.func, ast.Name)
                    and length_arg.func.id == "len"
                    and length_arg.args
                ):
                    self._add(self._name(length_arg.args[0]), target_name)
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        return

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        return

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        return


def _pointer_hints_for_body(body: list[ast.stmt]) -> dict[str, list[str]]:
    visitor = _PointerHintVisitor()
    for statement in body:
        visitor.visit(statement)
    return visitor.result()


class _NameLoadVisitor(ast.NodeVisitor):
    """Collect variable names that an expression reads."""

    def __init__(self) -> None:
        self.names: set[str] = set()

    def visit_Name(self, node: ast.Name) -> None:
        if isinstance(node.ctx, ast.Load):
            self.names.add(node.id)

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Attribute):
            self.visit(node.func.value)
        for arg in node.args:
            self.visit(arg)
        for keyword in node.keywords:
            self.visit(keyword.value)


def _unparse(node: ast.AST) -> str:
    try:
        return ast.unparse(node).strip()
    except Exception:
        return "<expression>"


def _target_text(node: ast.AST) -> str:
    if isinstance(node, (ast.Tuple, ast.List)):
        return ", ".join(_unparse(item) for item in node.elts)
    return _unparse(node)


def _source_names(*nodes: ast.AST | None) -> set[str]:
    visitor = _NameLoadVisitor()
    for node in nodes:
        if node is not None:
            visitor.visit(node)
    return visitor.names


def _target_roots(node: ast.AST | None) -> list[str]:
    if node is None:
        return []
    if isinstance(node, ast.Name):
        return [node.id]
    if isinstance(node, (ast.Tuple, ast.List)):
        roots: list[str] = []
        for item in node.elts:
            roots.extend(_target_roots(item))
        return roots
    if isinstance(node, ast.Starred):
        return _target_roots(node.value)
    if isinstance(node, ast.Attribute):
        return _target_roots(node.value)
    if isinstance(node, ast.Subscript):
        return _target_roots(node.value)
    return []


class _AssignmentHintVisitor(ast.NodeVisitor):
    """Collect target -> source-expression hints for watched variables."""

    def __init__(self) -> None:
        self.hints: list[dict[str, Any]] = []

    def _add(
        self,
        target: str,
        line: int,
        statement: str,
        sources: set[str],
    ) -> None:
        filtered = sorted(name for name in sources if name and name != target)
        self.hints.append(
            {
                "target": target,
                "line": line,
                "statement": statement,
                "sources": filtered,
            }
        )

    def _record_target(
        self,
        target_node: ast.AST,
        line: int,
        statement: str,
        sources: set[str],
        include_target_root: bool = False,
    ) -> None:
        roots = _target_roots(target_node)
        target_sources = _source_names(target_node)
        for root in roots:
            combined = set(sources)
            if include_target_root:
                combined.update(target_sources)
            else:
                combined.update(name for name in target_sources if name != root)
            self._add(root, line, statement, combined)

    def _record_assign_target(
        self,
        target_node: ast.AST,
        value_node: ast.AST,
        line: int,
        fallback_statement: str,
    ) -> None:
        if (
            isinstance(target_node, (ast.Tuple, ast.List))
            and isinstance(value_node, (ast.Tuple, ast.List))
            and len(target_node.elts) == len(value_node.elts)
        ):
            for target_item, value_item in zip(target_node.elts, value_node.elts):
                statement = f"{_unparse(target_item)} = {_unparse(value_item)}"
                self._record_target(
                    target_item,
                    line,
                    statement,
                    _source_names(value_item),
                )
            return
        self._record_target(target_node, line, fallback_statement, _source_names(value_node))

    def visit_Assign(self, node: ast.Assign) -> None:
        statement = _unparse(node)
        for target in node.targets:
            self._record_assign_target(target, node.value, node.lineno, statement)
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        if node.value is not None:
            self._record_assign_target(node.target, node.value, node.lineno, _unparse(node))
        self.generic_visit(node)

    def visit_AugAssign(self, node: ast.AugAssign) -> None:
        self._record_target(
            node.target,
            node.lineno,
            _unparse(node),
            _source_names(node.value),
            include_target_root=True,
        )
        self.generic_visit(node)

    def visit_For(self, node: ast.For) -> None:
        statement = f"for {_target_text(node.target)} in {_unparse(node.iter)}"
        self._record_target(node.target, node.lineno, statement, _source_names(node.iter))
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        return

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        return

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        return


def _assignment_hints_for_body(body: list[ast.stmt]) -> list[dict[str, Any]]:
    visitor = _AssignmentHintVisitor()
    for statement in body:
        visitor.visit(statement)
    return visitor.hints


def _is_generator(node: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    for child in ast.walk(node):
        if isinstance(child, (ast.Yield, ast.YieldFrom)):
            # Nested defs have their own generator-ness; close enough for UI hints.
            return True
    return False


def _has_meaningful_top_level(tree: ast.Module) -> bool:
    """True if the module body actually *does* something when executed."""
    for node in tree.body:
        if isinstance(
            node,
            (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Import, ast.ImportFrom),
        ):
            continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            continue  # docstrings / bare literals
        if isinstance(node, (ast.Assign, ast.AnnAssign)) and isinstance(
            getattr(node, "value", None), ast.Constant
        ):
            continue  # constant config assignments alone don't drive anything
        return True
    return False


def _pick_default_function(functions: list[FunctionInfo]) -> Optional[str]:
    if not functions:
        return None
    methods = [fn for fn in functions if fn.class_name == "Solution"]
    candidates = methods or functions
    public = [fn for fn in candidates if not fn.name.startswith("_")]
    candidates = public or candidates
    # Prefer the first one with parameters (LeetCode entry points take input).
    for fn in candidates:
        if fn.params:
            return fn.qualname
    return candidates[0].qualname


def analyze(source: str) -> Analysis:
    """Statically analyze ``source`` and return an :class:`Analysis`.

    Never raises on bad input: syntax errors are reported through
    ``Analysis.diagnostics`` with ``mode == "empty"``.
    """
    try:
        tree = ast.parse(source, filename="<user_code>")
    except SyntaxError as exc:
        return Analysis(
            mode="empty",
            diagnostics=[
                {
                    "severity": "error",
                    "line": exc.lineno or 1,
                    "column": exc.offset or 0,
                    "message": f"SyntaxError: {exc.msg}",
                }
            ],
        )

    functions: list[FunctionInfo] = []
    defines_tree = False
    defines_list = False

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            functions.append(
                FunctionInfo(
                    name=node.name,
                    qualname=node.name,
                    class_name=None,
                    params=_infer_params(node, is_method=False),
                    line=node.lineno,
                    is_generator=_is_generator(node),
                    docstring=ast.get_docstring(node),
                    returns=ast.unparse(node.returns) if node.returns else None,
                    pointer_hints=_pointer_hints_for_body(node.body),
                    assignment_hints=_assignment_hints_for_body(node.body),
                )
            )
        elif isinstance(node, ast.ClassDef):
            if node.name == "TreeNode":
                defines_tree = True
            if node.name == "ListNode":
                defines_list = True
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    if item.name.startswith("__"):
                        continue
                    functions.append(
                        FunctionInfo(
                            name=item.name,
                            qualname=f"{node.name}.{item.name}",
                            class_name=node.name,
                            params=_infer_params(item, is_method=True),
                            line=item.lineno,
                            is_generator=_is_generator(item),
                            docstring=ast.get_docstring(item),
                            returns=ast.unparse(item.returns) if item.returns else None,
                            pointer_hints=_pointer_hints_for_body(item.body),
                            assignment_hints=_assignment_hints_for_body(item.body),
                        )
                    )

    references_tree = False
    references_list = False
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            if node.id == "TreeNode":
                references_tree = True
            elif node.id == "ListNode":
                references_list = True

    has_driver = _has_meaningful_top_level(tree)
    if has_driver:
        mode = "script"
    elif functions:
        mode = "function"
    else:
        mode = "empty"

    analysis = Analysis(
        mode=mode,
        functions=functions,
        default_function=_pick_default_function(functions),
        defines_tree_node=defines_tree,
        defines_list_node=defines_list,
        references_tree_node=references_tree,
        references_list_node=references_list,
        module_pointer_hints=_pointer_hints_for_body(tree.body),
        module_assignment_hints=_assignment_hints_for_body(tree.body),
    )
    if mode == "empty" and not functions:
        analysis.diagnostics.append(
            {
                "severity": "info",
                "line": 1,
                "column": 0,
                "message": "No executable statements or callable functions found.",
            }
        )
    return analysis
