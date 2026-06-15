"""Orchestration: analyze source, prepare inputs, execute under the tracer.

:func:`run_session` is the engine's public entry point (the Pyodide worker
calls it with JSON-ish options and relays the result to the UI), and
:func:`measure_complexity` powers the complexity-hint feature by running a
function at several input sizes and counting operations.
"""

from __future__ import annotations

import io
import traceback
from contextlib import redirect_stderr, redirect_stdout
from typing import Any, Optional

from .analyzer import Analysis, FunctionInfo, analyze
from .inputgen import GeneratedInput, evaluate_input, generate_inputs
from .serialize import Snapshotter
from .structures import ListNode, TreeNode, build_linked_list, build_tree
from .tracer import DEFAULT_MAX_STEPS, TraceLimitError, Tracer

USER_FILENAME = "<user_code>"


def _base_globals(analysis: Analysis) -> dict[str, Any]:
    """Globals for user code, with TreeNode/ListNode injected when needed."""
    env: dict[str, Any] = {"__name__": "__main__", "__file__": USER_FILENAME}
    if analysis.references_tree_node and not analysis.defines_tree_node:
        env["TreeNode"] = TreeNode
    if analysis.references_list_node and not analysis.defines_list_node:
        env["ListNode"] = ListNode
    return env


def _error_payload(exc: BaseException) -> dict[str, Any]:
    return {
        "type": type(exc).__name__,
        "msg": str(exc),
        "traceback": traceback.format_exc(limit=20),
    }


def _resolve_callable(
    env: dict[str, Any], info: FunctionInfo
) -> Any:
    """Find the runtime callable for ``info``, instantiating ``Solution``-style
    classes for methods."""
    if info.class_name is None:
        target = env.get(info.name)
        if not callable(target):
            raise NameError(f"Function {info.name!r} not found after executing source.")
        return target

    cls = env.get(info.class_name)
    if cls is None:
        raise NameError(f"Class {info.class_name!r} not found after executing source.")
    instance = cls()
    return getattr(instance, info.name)


def run_session(
    source: str,
    *,
    mode: Optional[str] = None,
    function: Optional[str] = None,
    inputs: Optional[list[str]] = None,
    seed: Optional[int] = None,
    max_steps: int = DEFAULT_MAX_STEPS,
    max_seconds: float = 8.0,
) -> dict[str, Any]:
    """Analyze and execute ``source``, returning the full session payload.

    Args:
        source: User Python code.
        mode: Force ``"script"`` or ``"function"``; default is auto-detected.
        function: Qualname of the function to call in function mode
            (defaults to the analyzer's pick).
        inputs: Literal strings overriding generated inputs, one per
            parameter (e.g. ``["[2,7,11,15]", "9"]``).
        seed: RNG seed for input generation (reproducibility).
        max_steps: Trace step cap.
        max_seconds: Wall-clock execution cap inside the tracer.

    Returns:
        A JSON-serializable dict::

            {
              "status": "ok" | "error",
              "mode": "script" | "function" | "empty",
              "analysis": {...},
              "run": {
                "functionName": str | None,
                "inputs": [{"name", "type", "literal"}, ...],
                "seed": int | None,
                "steps": [...],
                "returnValue": enc | None,
                "exception": {...} | None,
                "stdout": str, "stderr": str,
                "opCount": int,
                "truncated": bool, "truncationReason": str | None,
              } | None,
              "error": {...} | None,
            }
    """
    analysis = analyze(source)
    result: dict[str, Any] = {
        "status": "ok",
        "mode": mode or analysis.mode,
        "analysis": analysis.to_dict(),
        "run": None,
        "error": None,
    }
    if analysis.mode == "empty" and any(
        diag["severity"] == "error" for diag in analysis.diagnostics
    ):
        result["status"] = "error"
        result["error"] = {
            "type": "SyntaxError",
            "msg": analysis.diagnostics[0]["message"],
            "line": analysis.diagnostics[0].get("line"),
        }
        return result
    if result["mode"] == "empty":
        return result

    if result["mode"] == "script":
        result["run"] = _run_script(source, analysis, max_steps, max_seconds)
    else:
        result["run"] = _run_function(
            source, analysis, function, inputs, seed, max_steps, max_seconds
        )
        if result["run"].get("setupError"):
            result["status"] = "error"
            result["error"] = result["run"]["setupError"]
    return result


def _finalize_run(
    run: dict[str, Any],
    tracer: Tracer,
    stdout: io.StringIO,
    stderr: io.StringIO,
) -> dict[str, Any]:
    run["steps"] = tracer.steps
    run["opCount"] = tracer.op_count
    run["truncated"] = tracer.truncated
    run["truncationReason"] = tracer.truncation_reason
    run["stdout"] = stdout.getvalue()
    run["stderr"] = stderr.getvalue()
    return run


def _run_script(
    source: str, analysis: Analysis, max_steps: int, max_seconds: float
) -> dict[str, Any]:
    stdout, stderr = io.StringIO(), io.StringIO()
    snapshotter = Snapshotter()
    tracer = Tracer(
        filename=USER_FILENAME,
        snapshotter=snapshotter,
        max_steps=max_steps,
        max_seconds=max_seconds,
        stdout_len=lambda: len(stdout.getvalue()),
    )
    run: dict[str, Any] = {
        "functionName": None,
        "inputs": [],
        "seed": None,
        "returnValue": None,
        "exception": None,
    }
    env = _base_globals(analysis)
    code = compile(source, USER_FILENAME, "exec")
    try:
        with redirect_stdout(stdout), redirect_stderr(stderr):
            with tracer:
                exec(code, env)
    except TraceLimitError:
        pass  # partial trace retained, truncation flags already set
    except BaseException as exc:
        run["exception"] = _error_payload(exc)
    return _finalize_run(run, tracer, stdout, stderr)


def _run_function(
    source: str,
    analysis: Analysis,
    function: Optional[str],
    input_literals: Optional[list[str]],
    seed: Optional[int],
    max_steps: int,
    max_seconds: float,
) -> dict[str, Any]:
    stdout, stderr = io.StringIO(), io.StringIO()
    run: dict[str, Any] = {
        "functionName": None,
        "inputs": [],
        "seed": None,
        "returnValue": None,
        "exception": None,
        "setupError": None,
        "steps": [],
        "opCount": 0,
        "truncated": False,
        "truncationReason": None,
        "stdout": "",
        "stderr": "",
    }

    target_name = function or analysis.default_function
    info = analysis.get_function(target_name) if target_name else None
    if info is None:
        run["setupError"] = {
            "type": "AnalysisError",
            "msg": f"No callable function found (looked for {target_name!r}).",
        }
        return run
    run["functionName"] = info.qualname

    # Execute the definitions (untraced) to materialize functions/classes.
    env = _base_globals(analysis)
    try:
        with redirect_stdout(stdout), redirect_stderr(stderr):
            exec(compile(source, USER_FILENAME, "exec"), env)
        target = _resolve_callable(env, info)
    except BaseException as exc:
        run["setupError"] = _error_payload(exc)
        run["stdout"] = stdout.getvalue()
        run["stderr"] = stderr.getvalue()
        return run

    # Build inputs: user-supplied literals win, otherwise generate from seed.
    if input_literals is not None and len(input_literals) == len(info.params):
        generated = [
            GeneratedInput(name=param.name, type=param.inferred, literal=literal)
            for param, literal in zip(info.params, input_literals)
        ]
        used_seed = seed
    else:
        generated, used_seed = generate_inputs(info, seed=seed)
    run["inputs"] = [item.to_dict() for item in generated]
    run["seed"] = used_seed

    try:
        arguments = [evaluate_input(item.literal) for item in generated]
    except BaseException as exc:
        run["setupError"] = {
            "type": type(exc).__name__,
            "msg": f"Could not evaluate inputs: {exc}",
        }
        return run

    snapshotter = Snapshotter()
    tracer = Tracer(
        filename=USER_FILENAME,
        snapshotter=snapshotter,
        max_steps=max_steps,
        max_seconds=max_seconds,
        stdout_len=lambda: len(stdout.getvalue()),
    )
    try:
        with redirect_stdout(stdout), redirect_stderr(stderr):
            with tracer:
                return_value = target(*arguments)
                if info.is_generator and hasattr(return_value, "__iter__"):
                    return_value = list(return_value)
        run["returnValue"] = snapshotter.snapshot(return_value)
    except TraceLimitError:
        pass
    except BaseException as exc:
        run["exception"] = _error_payload(exc)
    return _finalize_run(run, tracer, stdout, stderr)


def measure_complexity(
    source: str,
    function: Optional[str] = None,
    seed: Optional[int] = None,
    sizes: Optional[list[int]] = None,
    max_seconds: float = 4.0,
) -> dict[str, Any]:
    """Run ``function`` at increasing input sizes and count operations.

    Uses a counting-only tracer (no snapshots) so larger sizes stay cheap.
    Returns ``{"functionName", "seed", "samples": [{"n", "ops"} ...],
    "error", "truncated", "truncationReason"}`` — the UI fits a growth
    label to the samples and warns when slow growth stopped sampling early.
    """
    analysis = analyze(source)
    target_name = function or analysis.default_function
    info = analysis.get_function(target_name) if target_name else None
    payload: dict[str, Any] = {
        "functionName": info.qualname if info else None,
        "seed": seed,
        "samples": [],
        "error": None,
        "truncated": False,
        "truncationReason": None,
    }
    if info is None:
        payload["error"] = {"type": "AnalysisError", "msg": "No function to measure."}
        return payload

    env = _base_globals(analysis)
    try:
        exec(compile(source, USER_FILENAME, "exec"), env)
        target = _resolve_callable(env, info)
    except BaseException as exc:
        payload["error"] = _error_payload(exc)
        return payload

    used_seed = seed if seed is not None else 1234
    payload["seed"] = used_seed
    for size in sizes or [4, 8, 16, 32, 64]:
        generated, _ = generate_inputs(info, seed=used_seed, size=size, make_solvable=False)
        try:
            arguments = [evaluate_input(item.literal) for item in generated]
        except BaseException:
            continue
        stdout, stderr = io.StringIO(), io.StringIO()
        tracer = Tracer(
            filename=USER_FILENAME,
            max_steps=10**9,
            max_seconds=max_seconds,
            count_only=True,
        )
        try:
            with redirect_stdout(stdout), redirect_stderr(stderr):
                with tracer:
                    value = target(*arguments)
                    if info.is_generator and hasattr(value, "__iter__"):
                        list(value)
        except TraceLimitError as exc:
            payload["truncated"] = True
            payload["truncationReason"] = (
                f"Stopped at n={size}: {exc.reason} Earlier samples were kept."
            )
            break
        except BaseException:
            continue  # this size failed (e.g. int param scaled oddly); skip it
        payload["samples"].append({"n": size, "ops": tracer.op_count})
    return payload
