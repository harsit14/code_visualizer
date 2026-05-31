import { loadPyodide, version as pyodideVersion, type PyodideAPI } from 'pyodide';
import type {
  PythonCallFrameSnapshot,
  PythonFunctionTransition,
  PythonLoopSnapshot,
  PythonLoopTransition,
  PythonRunError,
  PythonRunResult,
  PythonStaticAnalysis,
  PythonStaticNode,
  PythonTraceEvent,
  PythonWorkerInbound,
  PythonWorkerOutbound,
} from './runtimeTypes';

type PyProxyLike = {
  destroy?: () => void;
  toJs: (options?: unknown) => unknown;
};

const PYTHON_RUNNER = `
import ast
import contextlib
import io
import sys
import traceback

def __codeviz_run_user_code(__codeviz_source):
    __codeviz_stdout = io.StringIO()
    __codeviz_stderr = io.StringIO()
    __codeviz_trace = []
    __codeviz_stack = []
    __codeviz_diagnostics = []
    __codeviz_max_trace_events = 2500
    __codeviz_trace_limit_hit = False
    __codeviz_previous_scopes = {}
    __codeviz_previous_objects = {}
    __codeviz_result = {
        "status": "ok",
        "stdout": "",
        "stderr": "",
        "traceEvents": __codeviz_trace,
        "staticAnalysis": None,
        "diagnostics": __codeviz_diagnostics,
        "error": None,
    }

    __codeviz_globals = {
        "__name__": "__main__",
        "__file__": "<user_code>",
    }

    def __codeviz_static_empty_analysis():
        return {
            "nodes": [],
            "symbols": [],
            "diagnostics": [],
            "lineToNodeIds": {},
            "summary": {
                "functions": 0,
                "loops": 0,
                "branches": 0,
                "assignments": 0,
            },
        }

    def __codeviz_ast_preview(__codeviz_node, __codeviz_fallback):
        try:
            __codeviz_preview = ast.unparse(__codeviz_node)
        except BaseException:
            __codeviz_preview = __codeviz_fallback
        if len(__codeviz_preview) > 54:
            return __codeviz_preview[:51] + "..."
        return __codeviz_preview

    def __codeviz_target_names(__codeviz_node):
        __codeviz_names = []

        def __codeviz_visit_target(__codeviz_target):
            if isinstance(__codeviz_target, ast.Name):
                __codeviz_names.append(__codeviz_target.id)
                return
            if isinstance(__codeviz_target, (ast.Tuple, ast.List)):
                for __codeviz_item in __codeviz_target.elts:
                    __codeviz_visit_target(__codeviz_item)
                return
            if isinstance(__codeviz_target, ast.Attribute):
                __codeviz_names.append(__codeviz_ast_preview(__codeviz_target, "attribute"))
                return
            if isinstance(__codeviz_target, ast.Subscript):
                __codeviz_names.append(__codeviz_ast_preview(__codeviz_target, "subscript"))

        __codeviz_visit_target(__codeviz_node)
        return __codeviz_names

    def __codeviz_analyze_source(__codeviz_source):
        __codeviz_analysis = __codeviz_static_empty_analysis()
        __codeviz_nodes = __codeviz_analysis["nodes"]
        __codeviz_symbols_by_name = {}
        __codeviz_line_to_node_ids = __codeviz_analysis["lineToNodeIds"]
        __codeviz_summary = __codeviz_analysis["summary"]

        def __codeviz_register_symbol(__codeviz_name, __codeviz_role, __codeviz_line):
            if not __codeviz_name:
                return
            __codeviz_symbol = __codeviz_symbols_by_name.get(__codeviz_name)
            if __codeviz_symbol is None:
                __codeviz_symbol = {
                    "name": __codeviz_name,
                    "lines": [],
                    "roles": [],
                }
                __codeviz_symbols_by_name[__codeviz_name] = __codeviz_symbol
            if __codeviz_line not in __codeviz_symbol["lines"]:
                __codeviz_symbol["lines"].append(__codeviz_line)
            if __codeviz_role not in __codeviz_symbol["roles"]:
                __codeviz_symbol["roles"].append(__codeviz_role)

        def __codeviz_register_references(__codeviz_node):
            __codeviz_line = getattr(__codeviz_node, "lineno", 1)
            for __codeviz_child in ast.walk(__codeviz_node):
                if isinstance(__codeviz_child, ast.Name) and isinstance(__codeviz_child.ctx, ast.Load):
                    __codeviz_register_symbol(__codeviz_child.id, "referenced", __codeviz_line)

        def __codeviz_add_node(
            __codeviz_kind,
            __codeviz_label,
            __codeviz_node,
            __codeviz_depth,
            __codeviz_parent_id=None,
            __codeviz_detail="",
            __codeviz_symbol_names=None,
        ):
            __codeviz_start_line = getattr(__codeviz_node, "lineno", 1)
            __codeviz_end_line = getattr(__codeviz_node, "end_lineno", __codeviz_start_line)
            __codeviz_id = (
                __codeviz_kind
                + "-"
                + str(__codeviz_start_line)
                + "-"
                + str(len(__codeviz_nodes))
            )
            __codeviz_node_payload = {
                "id": __codeviz_id,
                "kind": __codeviz_kind,
                "label": __codeviz_label,
                "startLine": __codeviz_start_line,
                "endLine": __codeviz_end_line,
                "depth": __codeviz_depth,
                "symbolNames": __codeviz_symbol_names or [],
            }
            if __codeviz_parent_id is not None:
                __codeviz_node_payload["parentId"] = __codeviz_parent_id
            if __codeviz_detail:
                __codeviz_node_payload["detail"] = __codeviz_detail
            __codeviz_nodes.append(__codeviz_node_payload)

            for __codeviz_line in range(__codeviz_start_line, __codeviz_end_line + 1):
                __codeviz_line_key = str(__codeviz_line)
                __codeviz_line_to_node_ids.setdefault(__codeviz_line_key, []).append(__codeviz_id)

            if __codeviz_kind == "function":
                __codeviz_summary["functions"] += 1
            elif __codeviz_kind == "loop":
                __codeviz_summary["loops"] += 1
            elif __codeviz_kind == "branch":
                __codeviz_summary["branches"] += 1
            elif __codeviz_kind == "assignment":
                __codeviz_summary["assignments"] += 1

            return __codeviz_id

        def __codeviz_visit_body(__codeviz_body, __codeviz_depth, __codeviz_parent_id):
            for __codeviz_statement in __codeviz_body:
                __codeviz_visit_statement(__codeviz_statement, __codeviz_depth, __codeviz_parent_id)

        def __codeviz_visit_statement(__codeviz_node, __codeviz_depth, __codeviz_parent_id):
            __codeviz_register_references(__codeviz_node)
            __codeviz_line = getattr(__codeviz_node, "lineno", 1)

            if isinstance(__codeviz_node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                __codeviz_params = [__codeviz_arg.arg for __codeviz_arg in __codeviz_node.args.args]
                __codeviz_label = __codeviz_node.name + "(" + ", ".join(__codeviz_params) + ")"
                __codeviz_id = __codeviz_add_node(
                    "function",
                    __codeviz_label,
                    __codeviz_node,
                    __codeviz_depth,
                    __codeviz_parent_id,
                    "defines a callable scope",
                    [__codeviz_node.name] + __codeviz_params,
                )
                __codeviz_register_symbol(__codeviz_node.name, "assigned", __codeviz_line)
                for __codeviz_param in __codeviz_params:
                    __codeviz_register_symbol(__codeviz_param, "parameter", __codeviz_line)
                __codeviz_visit_body(__codeviz_node.body, __codeviz_depth + 1, __codeviz_id)
                return

            if isinstance(__codeviz_node, ast.For):
                __codeviz_targets = __codeviz_target_names(__codeviz_node.target)
                __codeviz_iter_preview = __codeviz_ast_preview(__codeviz_node.iter, "iterable")
                __codeviz_label = "for " + ", ".join(__codeviz_targets or ["item"])
                __codeviz_id = __codeviz_add_node(
                    "loop",
                    __codeviz_label,
                    __codeviz_node,
                    __codeviz_depth,
                    __codeviz_parent_id,
                    "in " + __codeviz_iter_preview,
                    __codeviz_targets,
                )
                for __codeviz_target in __codeviz_targets:
                    __codeviz_register_symbol(__codeviz_target, "assigned", __codeviz_line)
                __codeviz_visit_body(__codeviz_node.body, __codeviz_depth + 1, __codeviz_id)
                __codeviz_visit_body(__codeviz_node.orelse, __codeviz_depth + 1, __codeviz_id)
                return

            if isinstance(__codeviz_node, ast.While):
                __codeviz_test = __codeviz_ast_preview(__codeviz_node.test, "condition")
                __codeviz_id = __codeviz_add_node(
                    "loop",
                    "while",
                    __codeviz_node,
                    __codeviz_depth,
                    __codeviz_parent_id,
                    __codeviz_test,
                )
                __codeviz_visit_body(__codeviz_node.body, __codeviz_depth + 1, __codeviz_id)
                __codeviz_visit_body(__codeviz_node.orelse, __codeviz_depth + 1, __codeviz_id)
                return

            if isinstance(__codeviz_node, ast.If):
                __codeviz_test = __codeviz_ast_preview(__codeviz_node.test, "condition")
                __codeviz_id = __codeviz_add_node(
                    "branch",
                    "if",
                    __codeviz_node,
                    __codeviz_depth,
                    __codeviz_parent_id,
                    __codeviz_test,
                )
                __codeviz_visit_body(__codeviz_node.body, __codeviz_depth + 1, __codeviz_id)
                __codeviz_visit_body(__codeviz_node.orelse, __codeviz_depth + 1, __codeviz_id)
                return

            if isinstance(__codeviz_node, ast.Assign):
                __codeviz_targets = []
                for __codeviz_target in __codeviz_node.targets:
                    __codeviz_targets.extend(__codeviz_target_names(__codeviz_target))
                __codeviz_label = "assign " + ", ".join(__codeviz_targets or ["value"])
                __codeviz_add_node(
                    "assignment",
                    __codeviz_label,
                    __codeviz_node,
                    __codeviz_depth,
                    __codeviz_parent_id,
                    __codeviz_ast_preview(__codeviz_node.value, "value"),
                    __codeviz_targets,
                )
                for __codeviz_target in __codeviz_targets:
                    __codeviz_register_symbol(__codeviz_target, "assigned", __codeviz_line)
                return

            if isinstance(__codeviz_node, ast.AnnAssign):
                __codeviz_targets = __codeviz_target_names(__codeviz_node.target)
                __codeviz_label = "annotate " + ", ".join(__codeviz_targets or ["value"])
                __codeviz_add_node(
                    "assignment",
                    __codeviz_label,
                    __codeviz_node,
                    __codeviz_depth,
                    __codeviz_parent_id,
                    __codeviz_ast_preview(__codeviz_node.annotation, "annotation"),
                    __codeviz_targets,
                )
                for __codeviz_target in __codeviz_targets:
                    __codeviz_register_symbol(__codeviz_target, "assigned", __codeviz_line)
                return

            if isinstance(__codeviz_node, ast.AugAssign):
                __codeviz_targets = __codeviz_target_names(__codeviz_node.target)
                __codeviz_label = "update " + ", ".join(__codeviz_targets or ["value"])
                __codeviz_add_node(
                    "assignment",
                    __codeviz_label,
                    __codeviz_node,
                    __codeviz_depth,
                    __codeviz_parent_id,
                    __codeviz_node.op.__class__.__name__,
                    __codeviz_targets,
                )
                for __codeviz_target in __codeviz_targets:
                    __codeviz_register_symbol(__codeviz_target, "assigned", __codeviz_line)
                return

            if isinstance(__codeviz_node, ast.Return):
                __codeviz_add_node(
                    "return",
                    "return",
                    __codeviz_node,
                    __codeviz_depth,
                    __codeviz_parent_id,
                    __codeviz_ast_preview(__codeviz_node.value, "value") if __codeviz_node.value else "",
                )
                return

            if isinstance(__codeviz_node, ast.Expr) and isinstance(__codeviz_node.value, ast.Call):
                __codeviz_call = __codeviz_ast_preview(__codeviz_node.value, "call")
                __codeviz_add_node(
                    "call",
                    "call",
                    __codeviz_node,
                    __codeviz_depth,
                    __codeviz_parent_id,
                    __codeviz_call,
                )
                return

            if isinstance(__codeviz_node, (ast.Import, ast.ImportFrom)):
                __codeviz_names = []
                for __codeviz_alias in __codeviz_node.names:
                    __codeviz_name = __codeviz_alias.asname or __codeviz_alias.name.split(".")[0]
                    __codeviz_names.append(__codeviz_name)
                    __codeviz_register_symbol(__codeviz_name, "imported", __codeviz_line)
                __codeviz_add_node(
                    "assignment",
                    "import " + ", ".join(__codeviz_names),
                    __codeviz_node,
                    __codeviz_depth,
                    __codeviz_parent_id,
                    "",
                    __codeviz_names,
                )
                return

            __codeviz_add_node(
                "statement",
                __codeviz_node.__class__.__name__,
                __codeviz_node,
                __codeviz_depth,
                __codeviz_parent_id,
            )

        try:
            __codeviz_tree = ast.parse(__codeviz_source, filename="<user_code>")
        except SyntaxError as __codeviz_syntax_error:
            __codeviz_analysis["diagnostics"].append({
                "severity": "error",
                "line": __codeviz_syntax_error.lineno,
                "column": __codeviz_syntax_error.offset,
                "message": __codeviz_syntax_error.msg,
            })
            return __codeviz_analysis

        __codeviz_module_id = __codeviz_add_node(
            "module",
            "module",
            __codeviz_tree,
            0,
            None,
            "top-level script",
        )
        __codeviz_visit_body(__codeviz_tree.body, 1, __codeviz_module_id)

        for __codeviz_symbol in __codeviz_symbols_by_name.values():
            __codeviz_symbol["lines"].sort()
            __codeviz_symbol["roles"].sort()
            __codeviz_analysis["symbols"].append(__codeviz_symbol)
        __codeviz_analysis["symbols"].sort(key=lambda __codeviz_symbol: __codeviz_symbol["name"])

        return __codeviz_analysis

    def __codeviz_safe_repr(__codeviz_value):
        try:
            __codeviz_preview = repr(__codeviz_value)
        except BaseException as __codeviz_repr_exc:
            __codeviz_preview = "<repr failed: " + __codeviz_repr_exc.__class__.__name__ + ">"

        if len(__codeviz_preview) > 120:
            return __codeviz_preview[:117] + "..."
        return __codeviz_preview

    def __codeviz_locals_snapshot(__codeviz_frame):
        __codeviz_snapshot = {}
        for __codeviz_name, __codeviz_value in __codeviz_frame.f_locals.items():
            if __codeviz_name.startswith("__") or __codeviz_name.startswith("_Python"):
                continue
            if __codeviz_name in ("In", "Out"):
                continue
            __codeviz_snapshot[__codeviz_name] = __codeviz_safe_repr(__codeviz_value)
        return __codeviz_snapshot

    def __codeviz_object_kind(__codeviz_value):
        if __codeviz_value is None or isinstance(__codeviz_value, (bool, int, float, complex, str, bytes)):
            return "primitive"
        if isinstance(__codeviz_value, (list, tuple, set, frozenset, dict)):
            return "collection"
        if callable(__codeviz_value):
            return "function"
        return "object"

    def __codeviz_object_size(__codeviz_value):
        try:
            if hasattr(__codeviz_value, "__len__") and not isinstance(__codeviz_value, (str, bytes)):
                return len(__codeviz_value)
        except BaseException:
            return None
        return None

    def __codeviz_entry_object_id(__codeviz_value):
        if __codeviz_object_kind(__codeviz_value) == "primitive":
            return None
        return "obj-" + str(id(__codeviz_value))

    def __codeviz_build_object_entry(__codeviz_key, __codeviz_value, __codeviz_key_preview=None):
        __codeviz_entry = {
            "key": str(__codeviz_key),
            "keyPreview": __codeviz_key_preview if __codeviz_key_preview is not None else str(__codeviz_key),
            "valuePreview": __codeviz_safe_repr(__codeviz_value),
            "valueTypeName": type(__codeviz_value).__name__,
        }
        __codeviz_nested_object_id = __codeviz_entry_object_id(__codeviz_value)
        if __codeviz_nested_object_id is not None:
            __codeviz_entry["objectId"] = __codeviz_nested_object_id
        return __codeviz_entry

    def __codeviz_object_entries(__codeviz_value, __codeviz_max_entries=6):
        __codeviz_entries = []
        __codeviz_entry_count = __codeviz_object_size(__codeviz_value)
        __codeviz_truncated = False

        def __codeviz_take_entry(__codeviz_index, __codeviz_key, __codeviz_item, __codeviz_key_preview=None):
            nonlocal __codeviz_truncated
            if __codeviz_index >= __codeviz_max_entries:
                __codeviz_truncated = True
                return False
            __codeviz_entries.append(
                __codeviz_build_object_entry(__codeviz_key, __codeviz_item, __codeviz_key_preview)
            )
            return True

        try:
            if isinstance(__codeviz_value, (list, tuple)):
                for __codeviz_index, __codeviz_item in enumerate(__codeviz_value):
                    if not __codeviz_take_entry(
                        __codeviz_index,
                        "[" + str(__codeviz_index) + "]",
                        __codeviz_item,
                    ):
                        break
            elif isinstance(__codeviz_value, dict):
                for __codeviz_index, (__codeviz_key, __codeviz_item) in enumerate(__codeviz_value.items()):
                    if not __codeviz_take_entry(
                        __codeviz_index,
                        __codeviz_safe_repr(__codeviz_key),
                        __codeviz_item,
                    ):
                        break
            elif isinstance(__codeviz_value, (set, frozenset)):
                for __codeviz_index, __codeviz_item in enumerate(__codeviz_value):
                    if not __codeviz_take_entry(
                        __codeviz_index,
                        "{" + str(__codeviz_index) + "}",
                        __codeviz_item,
                    ):
                        break
            elif hasattr(__codeviz_value, "__dict__"):
                __codeviz_attributes = vars(__codeviz_value)
                __codeviz_entry_count = len(__codeviz_attributes)
                for __codeviz_index, (__codeviz_key, __codeviz_item) in enumerate(__codeviz_attributes.items()):
                    if not __codeviz_take_entry(
                        __codeviz_index,
                        "." + str(__codeviz_key),
                        __codeviz_item,
                    ):
                        break
        except BaseException as __codeviz_entry_exc:
            __codeviz_entries = [
                {
                    "key": "preview",
                    "keyPreview": "preview",
                    "valuePreview": "<entries failed: " + __codeviz_entry_exc.__class__.__name__ + ">",
                    "valueTypeName": "error",
                }
            ]
            __codeviz_entry_count = 1
            __codeviz_truncated = False

        if __codeviz_entry_count is None:
            __codeviz_entry_count = len(__codeviz_entries)
        if __codeviz_entry_count > len(__codeviz_entries):
            __codeviz_truncated = True

        return {
            "entries": __codeviz_entries,
            "entryCount": __codeviz_entry_count,
            "truncated": __codeviz_truncated,
        }

    def __codeviz_scope_id(__codeviz_frame):
        if __codeviz_frame.f_code.co_name == "<module>":
            return "scope-global"
        return "scope-" + str(id(__codeviz_frame))

    def __codeviz_scope_name(__codeviz_frame):
        if __codeviz_frame.f_code.co_name == "<module>":
            return "global"
        return __codeviz_frame.f_code.co_name

    def __codeviz_build_scope_snapshot(__codeviz_frame):
        __codeviz_scope_id_value = __codeviz_scope_id(__codeviz_frame)
        __codeviz_previous_variables = __codeviz_previous_scopes.get(__codeviz_scope_id_value, {})
        __codeviz_next_variables = {}
        __codeviz_variables = []
        __codeviz_objects_by_id = {}
        __codeviz_created_variables = []
        __codeviz_updated_variables = []
        __codeviz_reference_changed_variables = []
        __codeviz_mutated_objects = []

        for __codeviz_name, __codeviz_value in __codeviz_frame.f_locals.items():
            if __codeviz_name.startswith("__") or __codeviz_name.startswith("_Python"):
                continue
            if __codeviz_name in ("In", "Out"):
                continue

            __codeviz_object_id = "obj-" + str(id(__codeviz_value))
            __codeviz_preview = __codeviz_safe_repr(__codeviz_value)
            __codeviz_type_name = type(__codeviz_value).__name__
            __codeviz_previous_variable = __codeviz_previous_variables.get(__codeviz_name)
            __codeviz_is_new = __codeviz_previous_variable is None
            __codeviz_is_reference_changed = (
                __codeviz_previous_variable is not None
                and __codeviz_previous_variable.get("objectId") != __codeviz_object_id
            )
            __codeviz_is_changed = (
                __codeviz_previous_variable is not None
                and __codeviz_previous_variable.get("valuePreview") != __codeviz_preview
            )

            if __codeviz_is_new:
                __codeviz_created_variables.append(__codeviz_name)
            elif __codeviz_is_changed:
                __codeviz_updated_variables.append(__codeviz_name)
            if __codeviz_is_reference_changed:
                __codeviz_reference_changed_variables.append(__codeviz_name)

            __codeviz_variable = {
                "name": __codeviz_name,
                "objectId": __codeviz_object_id,
                "typeName": __codeviz_type_name,
                "valuePreview": __codeviz_preview,
                "isNew": __codeviz_is_new,
                "isChanged": __codeviz_is_changed,
                "isReferenceChanged": __codeviz_is_reference_changed,
            }
            __codeviz_variables.append(__codeviz_variable)
            __codeviz_next_variables[__codeviz_name] = {
                "objectId": __codeviz_object_id,
                "valuePreview": __codeviz_preview,
            }

            if __codeviz_object_id not in __codeviz_objects_by_id:
                __codeviz_previous_object_preview = __codeviz_previous_objects.get(__codeviz_object_id)
                __codeviz_mutated = (
                    __codeviz_previous_object_preview is not None
                    and __codeviz_previous_object_preview != __codeviz_preview
                )
                if __codeviz_mutated:
                    __codeviz_mutated_objects.append(__codeviz_object_id)

                __codeviz_object = {
                    "id": __codeviz_object_id,
                    "kind": __codeviz_object_kind(__codeviz_value),
                    "typeName": __codeviz_type_name,
                    "preview": __codeviz_preview,
                    "mutated": __codeviz_mutated,
                }
                __codeviz_size = __codeviz_object_size(__codeviz_value)
                if __codeviz_size is not None:
                    __codeviz_object["size"] = __codeviz_size
                __codeviz_entry_snapshot = __codeviz_object_entries(__codeviz_value)
                __codeviz_object["entries"] = __codeviz_entry_snapshot["entries"]
                __codeviz_object["entryCount"] = __codeviz_entry_snapshot["entryCount"]
                __codeviz_object["truncated"] = __codeviz_entry_snapshot["truncated"]
                __codeviz_objects_by_id[__codeviz_object_id] = __codeviz_object

        __codeviz_previous_scopes[__codeviz_scope_id_value] = __codeviz_next_variables
        for __codeviz_object_id, __codeviz_object in __codeviz_objects_by_id.items():
            __codeviz_previous_objects[__codeviz_object_id] = __codeviz_object["preview"]

        return {
            "scope": {
                "id": __codeviz_scope_id_value,
                "name": __codeviz_scope_name(__codeviz_frame),
                "functionName": __codeviz_frame.f_code.co_name,
                "variables": __codeviz_variables,
            },
            "objects": list(__codeviz_objects_by_id.values()),
            "changes": {
                "createdVariables": __codeviz_created_variables,
                "updatedVariables": __codeviz_updated_variables,
                "referenceChangedVariables": __codeviz_reference_changed_variables,
                "mutatedObjects": __codeviz_mutated_objects,
            },
        }

    def __codeviz_add_trace_event(__codeviz_event_type, __codeviz_frame, __codeviz_arg=None):
        nonlocal __codeviz_trace_limit_hit

        if __codeviz_frame.f_code.co_filename != "<user_code>":
            return True

        if len(__codeviz_trace) >= __codeviz_max_trace_events:
            if not __codeviz_trace_limit_hit:
                __codeviz_trace_limit_hit = True
                __codeviz_diagnostics.append("Trace event limit reached; later steps were not recorded.")
                __codeviz_snapshot = __codeviz_build_scope_snapshot(__codeviz_frame)
                __codeviz_trace.append({
                    "id": "trace-" + str(len(__codeviz_trace)),
                    "step": len(__codeviz_trace),
                    "type": "trace_limit",
                    "line": __codeviz_frame.f_lineno,
                    "functionName": __codeviz_frame.f_code.co_name,
                    "depth": len(__codeviz_stack),
                    "locals": __codeviz_locals_snapshot(__codeviz_frame),
                    "scope": __codeviz_snapshot["scope"],
                    "objects": __codeviz_snapshot["objects"],
                    "changes": __codeviz_snapshot["changes"],
                    "stdout": __codeviz_stdout.getvalue(),
                    "stdoutLength": len(__codeviz_stdout.getvalue()),
                    "stderr": __codeviz_stderr.getvalue(),
                    "stderrLength": len(__codeviz_stderr.getvalue()),
                })
                sys.settrace(None)
            return False

        __codeviz_snapshot = __codeviz_build_scope_snapshot(__codeviz_frame)
        __codeviz_payload = {
            "id": "trace-" + str(len(__codeviz_trace)),
            "step": len(__codeviz_trace),
            "type": __codeviz_event_type,
            "line": __codeviz_frame.f_lineno,
            "functionName": __codeviz_frame.f_code.co_name,
            "depth": len(__codeviz_stack),
            "locals": __codeviz_locals_snapshot(__codeviz_frame),
            "scope": __codeviz_snapshot["scope"],
            "objects": __codeviz_snapshot["objects"],
            "changes": __codeviz_snapshot["changes"],
            "stdout": __codeviz_stdout.getvalue(),
            "stdoutLength": len(__codeviz_stdout.getvalue()),
            "stderr": __codeviz_stderr.getvalue(),
            "stderrLength": len(__codeviz_stderr.getvalue()),
        }

        if __codeviz_event_type == "return":
            __codeviz_payload["valuePreview"] = __codeviz_safe_repr(__codeviz_arg)

        if __codeviz_event_type == "exception" and __codeviz_arg:
            __codeviz_exc_type, __codeviz_exc_value, _ = __codeviz_arg
            __codeviz_payload["exception"] = {
                "name": __codeviz_exc_type.__name__,
                "message": str(__codeviz_exc_value),
            }

        __codeviz_trace.append(__codeviz_payload)
        return True

    def __codeviz_trace_func(__codeviz_frame, __codeviz_event, __codeviz_arg):
        if __codeviz_frame.f_code.co_filename != "<user_code>":
            return __codeviz_trace_func

        if __codeviz_event == "call":
            __codeviz_stack.append(__codeviz_frame.f_code.co_name)
            if not __codeviz_add_trace_event("call", __codeviz_frame, __codeviz_arg):
                return None
            return __codeviz_trace_func

        if __codeviz_event == "line":
            if not __codeviz_add_trace_event("line", __codeviz_frame, __codeviz_arg):
                return None
            return __codeviz_trace_func

        if __codeviz_event == "return":
            __codeviz_add_trace_event("return", __codeviz_frame, __codeviz_arg)
            if __codeviz_stack:
                __codeviz_stack.pop()
            return __codeviz_trace_func

        if __codeviz_event == "exception":
            __codeviz_add_trace_event("exception", __codeviz_frame, __codeviz_arg)
            return __codeviz_trace_func

        return __codeviz_trace_func

    try:
        __codeviz_result["staticAnalysis"] = __codeviz_analyze_source(__codeviz_source)
        __codeviz_code = compile(__codeviz_source, "<user_code>", "exec")
        with contextlib.redirect_stdout(__codeviz_stdout), contextlib.redirect_stderr(__codeviz_stderr):
            sys.settrace(__codeviz_trace_func)
            exec(__codeviz_code, __codeviz_globals)
    except BaseException as __codeviz_exc:
        __codeviz_name = __codeviz_exc.__class__.__name__
        __codeviz_result["status"] = "timeout" if __codeviz_name == "KeyboardInterrupt" else "error"
        __codeviz_result["error"] = {
            "name": __codeviz_name,
            "message": str(__codeviz_exc),
            "traceback": traceback.format_exc(limit=20),
        }
    finally:
        sys.settrace(None)
        __codeviz_result["stdout"] = __codeviz_stdout.getvalue()
        __codeviz_result["stderr"] = __codeviz_stderr.getvalue()

    return __codeviz_result
`;

let pyodidePromise: Promise<PyodideAPI> | null = null;
let interruptBuffer: Uint8Array | undefined;

function postMessageToMain(message: PythonWorkerOutbound) {
  self.postMessage(message);
}

function emitStatus(
  phase: 'loading' | 'ready' | 'running',
  message: string,
  interruptSupported = Boolean(interruptBuffer),
) {
  postMessageToMain({
    type: 'status',
    status: {
      phase,
      message,
      interruptSupported,
    },
  });
}

function getPyodideBaseUrl() {
  const assetPath = import.meta.env.DEV
    ? '/node_modules/pyodide/'
    : `${import.meta.env.BASE_URL}assets/pyodide/`;

  return new URL(assetPath, self.location.origin).toString();
}

async function ensurePyodide() {
  if (!pyodidePromise) {
    emitStatus('loading', 'Loading Python runtime');
    pyodidePromise = loadPyodide({
      indexURL: getPyodideBaseUrl(),
    }).then((pyodide) => {
      if (interruptBuffer) {
        pyodide.setInterruptBuffer(interruptBuffer);
      }

      pyodide.runPython(PYTHON_RUNNER);
      emitStatus('ready', `Python ${pyodideVersion} ready`);
      return pyodide;
    });
  }

  return pyodidePromise;
}

function normalizeError(error: unknown): PythonRunError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      traceback: error.stack,
    };
  }

  return {
    name: 'WorkerError',
    message: String(error),
  };
}

function createEmptyStaticAnalysis(): PythonStaticAnalysis {
  return {
    diagnostics: [],
    lineToNodeIds: {},
    nodes: [],
    summary: {
      assignments: 0,
      branches: 0,
      functions: 0,
      loops: 0,
    },
    symbols: [],
  };
}

function getStaticNodeIdForLine(line: number | undefined, staticAnalysis: PythonStaticAnalysis) {
  if (!line) {
    return undefined;
  }

  const candidates = staticAnalysis.nodes
    .filter((node) => node.kind !== 'module' && node.startLine <= line && node.endLine >= line)
    .sort((left, right) => {
      const depthDelta = right.depth - left.depth;

      if (depthDelta !== 0) {
        return depthDelta;
      }

      const leftSpan = left.endLine - left.startLine;
      const rightSpan = right.endLine - right.startLine;
      return leftSpan - rightSpan;
    });

  return candidates[0]?.id;
}

function getVariablePreview(event: PythonTraceEvent, name: string) {
  return (
    event.scope.variables.find((variable) => variable.name === name)?.valuePreview ??
    event.locals[name]
  );
}

function getActiveLoopNodes(line: number | undefined, staticAnalysis: PythonStaticAnalysis) {
  if (!line) {
    return [];
  }

  return staticAnalysis.nodes
    .filter((node) => node.kind === 'loop' && node.startLine <= line && node.endLine >= line)
    .sort((left, right) => left.depth - right.depth || left.startLine - right.startLine);
}

function annotateLoopContext(
  traceEvents: PythonTraceEvent[],
  staticAnalysis: PythonStaticAnalysis,
) {
  type LoopRuntimeState = {
    iteration: number;
    label: string;
    lastTargetValue?: string;
    wasActive: boolean;
  };

  const loopStates = new Map<string, LoopRuntimeState>();
  let previousActiveLoopIds = new Set<string>();

  return traceEvents.map((event) => {
    const activeLoopNodes = getActiveLoopNodes(event.line, staticAnalysis);
    const activeLoopIds = new Set(activeLoopNodes.map((node) => node.id));
    const loopTransitions: PythonLoopTransition[] = Array.from(previousActiveLoopIds)
      .filter((loopId) => !activeLoopIds.has(loopId))
      .map((loopId) => {
        const node = staticAnalysis.nodes.find((candidate) => candidate.id === loopId);
        const state = loopStates.get(loopId);

        return {
          loopId,
          label: node?.label ?? 'loop',
          startLine: node?.startLine ?? event.line ?? 0,
          endLine: node?.endLine ?? event.line ?? 0,
          depth: node?.depth ?? 0,
          iteration: state?.iteration ?? 0,
          phase: 'exit',
        };
      });
    const loopStack: PythonLoopSnapshot[] = activeLoopNodes.map((node) => {
      const targetName = node.symbolNames[0];
      const targetValue = targetName ? getVariablePreview(event, targetName) : undefined;
      const state =
        loopStates.get(node.id) ??
        ({
          iteration: 0,
          label: node.label,
          wasActive: false,
        } satisfies LoopRuntimeState);
      const changedVariables = [
        ...event.changes.createdVariables,
        ...event.changes.updatedVariables,
        ...event.changes.referenceChangedVariables,
      ].filter((name, index, names) => names.indexOf(name) === index);
      let phase: PythonLoopSnapshot['phase'] = state.wasActive ? 'body' : 'enter';

      if (targetValue !== undefined && targetValue !== state.lastTargetValue) {
        state.iteration += 1;
        state.lastTargetValue = targetValue;
        phase = state.iteration === 1 ? 'enter' : 'iterate';
      } else if (!targetName && event.line === node.startLine && event.type === 'line') {
        state.iteration += 1;
        phase = state.iteration === 1 ? 'enter' : 'iterate';
      }

      state.wasActive = true;
      loopStates.set(node.id, state);

      return {
        loopId: node.id,
        label: node.label,
        startLine: node.startLine,
        endLine: node.endLine,
        depth: node.depth,
        iteration: state.iteration,
        phase,
        changedVariables,
        detail: node.detail,
        targetName,
        targetValue,
      };
    });

    loopStates.forEach((state, loopId) => {
      state.wasActive = activeLoopIds.has(loopId);
    });
    previousActiveLoopIds = activeLoopIds;

    return {
      ...event,
      loopStack,
      loopTransitions,
    };
  });
}

function annotateFunctionContext(traceEvents: PythonTraceEvent[]) {
  type FrameState = {
    argumentNames: string[];
    depth: number;
    displayName: string;
    frameId: string;
    functionName: string;
    line?: number;
    returnValue?: string;
    scopeId: string;
    status: PythonCallFrameSnapshot['status'];
    variables: PythonTraceEvent['scope']['variables'];
  };

  const stack: FrameState[] = [];

  function buildDisplayName(event: PythonTraceEvent) {
    if (event.functionName === '<module>') {
      return 'module';
    }

    const args = event.scope.variables
      .filter((variable) => variable.isNew)
      .slice(0, 3)
      .map((variable) => `${variable.name}=${variable.valuePreview}`)
      .join(', ');

    return args ? `${event.functionName}(${args})` : `${event.functionName}()`;
  }

  function snapshotStack() {
    return stack.map((frame) => {
      const argumentNameSet = new Set(frame.argumentNames);

      return {
        frameId: frame.frameId,
        functionName: frame.functionName,
        displayName: frame.displayName,
        depth: frame.depth,
        scopeId: frame.scopeId,
        line: frame.line,
        status: frame.status,
        arguments: frame.variables.filter((variable) => argumentNameSet.has(variable.name)),
        variables: frame.variables,
        returnValue: frame.returnValue,
      };
    });
  }

  return traceEvents.map((event) => {
    let functionTransition: PythonFunctionTransition | undefined;
    const existingFrameIndex = stack.findIndex((frame) => frame.scopeId === event.scope.id);

    stack.forEach((frame) => {
      if (frame.status !== 'returning' && frame.status !== 'exception') {
        frame.status = 'active';
      }
    });

    if (event.type === 'call') {
      const frame: FrameState = {
        argumentNames:
          event.functionName === '<module>'
            ? []
            : event.scope.variables.map((variable) => variable.name),
        depth: event.depth,
        displayName: buildDisplayName(event),
        frameId: event.scope.id,
        functionName: event.functionName,
        line: event.line,
        scopeId: event.scope.id,
        status: 'entering',
        variables: event.scope.variables,
      };

      stack.push(frame);
      functionTransition = {
        frameId: frame.frameId,
        functionName: frame.functionName,
        depth: frame.depth,
        type: 'call',
      };
    } else {
      const frame = existingFrameIndex >= 0 ? stack[existingFrameIndex] : stack[stack.length - 1];

      if (frame) {
        frame.line = event.line;
        frame.variables = event.scope.variables;

        if (event.type === 'return') {
          frame.status = 'returning';
          frame.returnValue = event.valuePreview;
          functionTransition = {
            frameId: frame.frameId,
            functionName: frame.functionName,
            depth: frame.depth,
            type: 'return',
            valuePreview: event.valuePreview,
          };
        } else if (event.type === 'exception') {
          frame.status = 'exception';
          functionTransition = {
            frameId: frame.frameId,
            functionName: frame.functionName,
            depth: frame.depth,
            type: 'exception',
            message: event.exception
              ? `${event.exception.name}: ${event.exception.message}`
              : 'exception',
          };
        }
      }
    }

    const annotatedEvent = {
      ...event,
      callStack: snapshotStack(),
      functionTransition,
    };

    if (event.type === 'return') {
      const returningFrameIndex = stack.findIndex((frame) => frame.scopeId === event.scope.id);

      if (returningFrameIndex >= 0) {
        stack.splice(returningFrameIndex, 1);
      }
    }

    return annotatedEvent;
  });
}

function normalizeStaticAnalysis(rawStaticAnalysis: unknown): PythonStaticAnalysis {
  const fallback = createEmptyStaticAnalysis();
  const staticAnalysis = rawStaticAnalysis as Partial<PythonStaticAnalysis> | null | undefined;

  if (!staticAnalysis) {
    return fallback;
  }

  return {
    diagnostics: staticAnalysis.diagnostics ?? [],
    lineToNodeIds: staticAnalysis.lineToNodeIds ?? {},
    nodes: (staticAnalysis.nodes ?? []) as PythonStaticNode[],
    summary: {
      assignments: staticAnalysis.summary?.assignments ?? 0,
      branches: staticAnalysis.summary?.branches ?? 0,
      functions: staticAnalysis.summary?.functions ?? 0,
      loops: staticAnalysis.summary?.loops ?? 0,
    },
    symbols: staticAnalysis.symbols ?? [],
  };
}

function normalizePythonResult(
  rawResult: unknown,
  requestId: string,
  durationMs: number,
): PythonRunResult {
  const result = rawResult as {
    status?: PythonRunResult['status'];
    stdout?: string;
    stderr?: string;
    traceEvents?: PythonTraceEvent[];
    staticAnalysis?: PythonStaticAnalysis;
    diagnostics?: string[];
    error?: PythonRunError | null;
  };

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const staticAnalysis = normalizeStaticAnalysis(result.staticAnalysis);
  const traceEvents = annotateFunctionContext(
    annotateLoopContext(
      (result.traceEvents ?? []).map((event) => ({
        ...event,
        staticNodeId: event.staticNodeId ?? getStaticNodeIdForLine(event.line, staticAnalysis),
        stdout:
          typeof event.stdoutLength === 'number'
            ? stdout.slice(0, event.stdoutLength)
            : (event.stdout ?? ''),
        stderr:
          typeof event.stderrLength === 'number'
            ? stderr.slice(0, event.stderrLength)
            : (event.stderr ?? ''),
      })),
      staticAnalysis,
    ),
  );

  return {
    requestId,
    status: result.status ?? 'error',
    stdout,
    stderr,
    traceEvents,
    staticAnalysis,
    diagnostics: result.diagnostics ?? [],
    error: result.error ?? undefined,
    durationMs,
    interruptMode: interruptBuffer ? 'shared-array-buffer' : 'none',
    pyodideVersion,
  };
}

async function runPython(requestId: string, source: string) {
  const startedAt = performance.now();

  try {
    const pyodide = await ensurePyodide();
    emitStatus('running', 'Running Python code');
    pyodide.globals.set('__codeviz_source', source);
    const resultProxy = pyodide.runPython(
      '__codeviz_run_user_code(__codeviz_source)',
    ) as PyProxyLike;
    const rawResult = resultProxy.toJs({ dict_converter: Object.fromEntries });
    resultProxy.destroy?.();
    pyodide.runPython('del __codeviz_source');

    postMessageToMain({
      type: 'result',
      requestId,
      result: normalizePythonResult(rawResult, requestId, performance.now() - startedAt),
    });
    emitStatus('ready', `Python ${pyodideVersion} ready`);
  } catch (error) {
    postMessageToMain({
      type: 'result',
      requestId,
      result: {
        requestId,
        status: 'error',
        stdout: '',
        stderr: '',
        traceEvents: [],
        diagnostics: [],
        error: normalizeError(error),
        durationMs: performance.now() - startedAt,
        interruptMode: interruptBuffer ? 'shared-array-buffer' : 'none',
        pyodideVersion,
      },
    });
    emitStatus('ready', `Python ${pyodideVersion} ready`);
  }
}

self.addEventListener('message', (event: MessageEvent<PythonWorkerInbound>) => {
  const message = event.data;

  if (message.type === 'setInterruptBuffer') {
    const nextInterruptBuffer = message.interruptBuffer;
    interruptBuffer = nextInterruptBuffer;
    if (pyodidePromise) {
      void pyodidePromise.then((pyodide) => pyodide.setInterruptBuffer(nextInterruptBuffer));
    }
    return;
  }

  if (message.type === 'run') {
    void runPython(message.requestId, message.source);
  }
});
