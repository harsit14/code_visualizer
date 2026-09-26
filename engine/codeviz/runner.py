"""Orchestration: analyze source, prepare inputs, execute under the tracer.

:func:`run_session` is the engine's public entry point (the Pyodide worker
calls it with JSON-ish options and relays the result to the UI), and
:func:`measure_complexity` powers the complexity-hint feature by running a
function at several input sizes and counting operations.
"""

from __future__ import annotations

import asyncio
import io
import inspect
import random
import time
import traceback
import tracemalloc
from contextlib import redirect_stderr, redirect_stdout
from typing import Any, Optional

from .analyzer import Analysis, FunctionInfo, analyze
from .assertions import assess_return
from .complexity import (
    clamp_fixed_pointers,
    fit_caveats,
    fit_growth,
    generate_sized_input,
    measure_size,
    pick_dimension,
    sanitize_sizes,
    structure_hint,
)
from .inputgen import GeneratedInput, evaluate_input, generate_inputs
from .serialize import Snapshotter
from .structures import ListNode, TreeNode, build_linked_list, build_tree
from .tracer import DEFAULT_MAX_STEPS, TraceLimitError, Tracer

USER_FILENAME = "<user_code>"
BYTES_PER_MB = 1024 * 1024
# Complexity experiments: each sample stops at whichever cap it hits first,
# and the whole experiment stays well inside the client's 30s timeout.
COMPLEXITY_SAMPLE_STEPS = 1_000_000
COMPLEXITY_SAMPLE_SECONDS = 4.0
COMPLEXITY_TOTAL_SECONDS = 20.0


def _javascript_string_length(value: str) -> int:
    """Length in UTF-16 code units, matching JavaScript ``String.length``."""
    return len(value.encode("utf-16-le")) // 2


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


def _start_run_metrics() -> tuple[float, bool]:
    """Start measuring just the user execution window.

    ``tracemalloc`` is process-global, so remember whether something else
    had it enabled and restore that state after the run.
    """
    was_tracing = tracemalloc.is_tracing()
    if was_tracing:
        tracemalloc.reset_peak()
    else:
        tracemalloc.start()
    return time.perf_counter(), was_tracing


def _finish_run_metrics(
    run: dict[str, Any], started_at: float, tracemalloc_was_tracing: bool
) -> None:
    run["runtimeMs"] = max(0.0, (time.perf_counter() - started_at) * 1000)
    try:
        _, peak_bytes = tracemalloc.get_traced_memory()
        run["memoryMb"] = peak_bytes / BYTES_PER_MB
    except RuntimeError:
        run["memoryMb"] = None
    finally:
        if not tracemalloc_was_tracing:
            tracemalloc.stop()


def _resolve_callable(
    env: dict[str, Any], info: FunctionInfo, constructor_values: list[Any]
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
    if info.binding in ("static", "class"):
        return getattr(cls, info.name)
    constructor_args, constructor_kwargs = _prepare_call(
        info.params[: info.constructor_param_count], constructor_values
    )
    instance = cls(*constructor_args, **constructor_kwargs)
    return getattr(instance, info.name)


def _prepare_call(params: list[Any], values: list[Any]) -> tuple[list[Any], dict[str, Any]]:
    args: list[Any] = []
    kwargs: dict[str, Any] = {}
    for param, value in zip(params, values):
        name = param.runtime_name or param.name
        if param.kind in ("positional_only", "positional_or_keyword"):
            args.append(value)
        elif param.kind == "keyword_only":
            kwargs[name] = value
        elif param.kind == "var_positional":
            if not isinstance(value, (list, tuple)):
                raise TypeError(f"Input for *{name} must be a list or tuple.")
            args.extend(value)
        elif param.kind == "var_keyword":
            if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
                raise TypeError(f"Input for **{name} must be a dictionary with string keys.")
            kwargs.update(value)
    return args, kwargs


async def _collect_async_generator(value: Any) -> list[Any]:
    return [item async for item in value]


async def _await_value(value: Any) -> Any:
    return await value


def _materialize_return_value(value: Any, is_generator: bool) -> Any:
    """Resolve coroutine/generator results while tracing their execution."""
    if inspect.isasyncgen(value):
        return asyncio.run(_collect_async_generator(value))
    if inspect.isawaitable(value):
        value = asyncio.run(_await_value(value))
    if is_generator and inspect.isgenerator(value):
        return list(value)
    return value


def run_session(
    source: str,
    *,
    mode: Optional[str] = None,
    function: Optional[str] = None,
    inputs: Optional[list[str]] = None,
    seed: Optional[int] = None,
    max_steps: int = DEFAULT_MAX_STEPS,
    max_seconds: float = 8.0,
    expected: str | None = None,
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
                "runtimeMs": float, "memoryMb": float | None,
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
            source, analysis, function, inputs, seed, max_steps, max_seconds, expected
        )
        if result["run"].get("setupError"):
            result["status"] = "error"
            result["error"] = result["run"]["setupError"]
    if result["run"] and result["run"].get("exception"):
        result["status"] = "error"
        result["error"] = result["run"]["exception"]
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
        stdout_len=lambda: _javascript_string_length(stdout.getvalue()),
    )
    run: dict[str, Any] = {
        "functionName": None,
        "inputs": [],
        "seed": None,
        "returnValue": None,
        "exception": None,
        "runtimeMs": 0.0,
        "memoryMb": 0.0,
        "memoryIsEstimate": False,
    }
    env = _base_globals(analysis)
    code = compile(source, USER_FILENAME, "exec")
    try:
        with redirect_stdout(stdout), redirect_stderr(stderr):
            with tracer:
                metric_started_at, tracemalloc_was_tracing = _start_run_metrics()
                try:
                    exec(code, env)
                finally:
                    _finish_run_metrics(run, metric_started_at, tracemalloc_was_tracing)
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
    expected: str | None,
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
        "runtimeMs": 0.0,
        "memoryMb": 0.0,
        "memoryIsEstimate": False,
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


    constructor_values = arguments[: info.constructor_param_count]
    function_values = arguments[info.constructor_param_count :]
    try:
        with redirect_stdout(stdout), redirect_stderr(stderr):
            target = _resolve_callable(env, info, constructor_values)
    except BaseException as exc:
        run["setupError"] = _error_payload(exc)
        run["stdout"] = stdout.getvalue()
        run["stderr"] = stderr.getvalue()
        return run
    try:
        call_args, call_kwargs = _prepare_call(
            info.params[info.constructor_param_count :], function_values
        )
    except BaseException as exc:
        run["setupError"] = _error_payload(exc)
        run["stdout"] = stdout.getvalue()
        run["stderr"] = stderr.getvalue()
        return run

    snapshotter = Snapshotter()
    tracer = Tracer(
        filename=USER_FILENAME,
        snapshotter=snapshotter,
        max_steps=max_steps,
        max_seconds=max_seconds,
        stdout_len=lambda: _javascript_string_length(stdout.getvalue()),
    )
    try:
        with redirect_stdout(stdout), redirect_stderr(stderr):
            with tracer:
                metric_started_at, tracemalloc_was_tracing = _start_run_metrics()
                try:
                    return_value = _materialize_return_value(
                        target(*call_args, **call_kwargs), info.is_generator
                    )
                finally:
                    _finish_run_metrics(run, metric_started_at, tracemalloc_was_tracing)
        run["returnValue"] = snapshotter.snapshot(return_value)
        run["assessment"] = assess_return(return_value, expected)
    except TraceLimitError:
        pass
    except BaseException as exc:
        run["exception"] = _error_payload(exc)
    return _finalize_run(run, tracer, stdout, stderr)


def _short_literal(literal: str, limit: int = 60) -> str:
    return literal if len(literal) <= limit else f"{literal[: limit - 1]}…"


def measure_complexity(
    source: str,
    function: Optional[str] = None,
    seed: Optional[int] = None,
    sizes: Optional[list[int]] = None,
    max_seconds: float = COMPLEXITY_SAMPLE_SECONDS,
    *,
    param: Optional[str] = None,
    axis: Optional[str] = None,
    inputs: Optional[list[str]] = None,
    max_steps: int = COMPLEXITY_SAMPLE_STEPS,
    total_seconds: float = COMPLEXITY_TOTAL_SECONDS,
) -> dict[str, Any]:
    """Run ``function`` while one input grows and count trace events.

    Only the chosen dimension (``param``/``axis``, default: the first sized
    collection) grows. Other arguments stay fixed: the ``inputs`` literals
    when given, otherwise generated defaults that avoid early exits. Uses a
    counting-only tracer (no snapshots) so larger sizes stay cheap.

    Every requested size gets a sample row with a ``status`` — ``ok``,
    ``exception``, ``step-limit``, ``time-limit``, ``setup-error`` or
    ``skipped`` — so failures are reported rather than dropped. Only ``ok``
    samples feed ``fit`` (measured growth); ``structure`` is a separate
    static heuristic. Neither is a proof of Big-O.
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
        "dimension": None,
        "fixed": [],
        "fit": None,
        "caveats": [],
        "structure": None,
        "limits": {"maxSteps": max_steps, "maxSeconds": max_seconds},
    }
    if info is None:
        payload["error"] = {"type": "AnalysisError", "msg": "No function to measure."}
        return payload

    try:
        dimension = pick_dimension(info, param, axis)
    except ValueError as exc:
        payload["error"] = {"type": "ValueError", "msg": str(exc)}
        return payload
    payload["dimension"] = dimension.to_dict()
    payload["structure"] = structure_hint(source, info)

    try:
        code = compile(source, USER_FILENAME, "exec")
    except BaseException as exc:
        payload["error"] = _error_payload(exc)
        return payload

    used_seed = seed if seed is not None else 1234
    payload["seed"] = used_seed
    size_list = sanitize_sizes(sizes, dimension.max_n)
    grow_index = next(i for i, p in enumerate(info.params) if p.name == dimension.param)
    grow_param = info.params[grow_index]

    base, _ = generate_inputs(info, seed=used_seed, make_solvable=False)
    from_user = inputs is not None and len(inputs) == len(info.params)
    if from_user:
        base = [
            GeneratedInput(name=p.name, type=p.inferred, literal=literal)
            for p, literal in zip(info.params, inputs or [])
        ]
    else:
        clamp_fixed_pointers(info, base, dimension, size_list[0])
    try:
        # The grown input's own value only sets the fixed axis of a grid, so
        # an unparsable draft there should not block the experiment.
        base_grow_value = evaluate_input(base[grow_index].literal)
    except Exception:
        base_grow_value = None
    try:
        for index, item in enumerate(base):
            if index != grow_index:
                evaluate_input(item.literal)
    except Exception as exc:
        payload["error"] = {"type": type(exc).__name__, "msg": f"Could not evaluate inputs: {exc}"}
        return payload
    payload["fixed"] = [
        {
            "name": item.name,
            "literal": _short_literal(item.literal),
            "source": "current" if from_user else "generated",
        }
        for index, item in enumerate(base)
        if index != grow_index
    ]

    deadline = time.perf_counter() + total_seconds
    skip_note: Optional[str] = None
    for size in size_list:
        sample: dict[str, Any] = {
            "n": size,
            "ops": 0,
            "ms": None,
            "status": "skipped",
            "error": None,
            "note": None,
        }
        payload["samples"].append(sample)
        remaining = deadline - time.perf_counter()
        if skip_note is None and remaining <= 0:
            skip_note = "Skipped: the experiment's total time budget was used up."
            payload["truncated"] = True
            payload["truncationReason"] = (
                f"Stopped before n={size}: the {total_seconds:.0f}s budget for the whole "
                "experiment was used up."
            )
        if skip_note is not None:
            sample["note"] = skip_note
            continue

        # Start every sample from a clean module and class instance so caches,
        # globals, and attributes cannot leak into the next input size.
        env = _base_globals(analysis)
        setup_stdout, setup_stderr = io.StringIO(), io.StringIO()
        try:
            with redirect_stdout(setup_stdout), redirect_stderr(setup_stderr):
                exec(code, env)
        except KeyboardInterrupt:
            raise
        except BaseException as exc:
            sample["status"] = "setup-error"
            sample["error"] = {"type": type(exc).__name__, "msg": str(exc)}
            payload["error"] = _error_payload(exc)
            break

        rng = random.Random(used_seed * 100_003 + size)
        try:
            grown = generate_sized_input(grow_param, dimension, size, rng, base_grow_value)
            grown_value = evaluate_input(grown.literal)
            measured = measure_size(grown_value, dimension)
            sample["n"] = measured if measured is not None else size
            # Re-evaluate fixed inputs each time: the function may mutate them.
            arguments = [
                grown_value if index == grow_index else evaluate_input(item.literal)
                for index, item in enumerate(base)
            ]
            constructor_values = arguments[: info.constructor_param_count]
            function_values = arguments[info.constructor_param_count :]
            with redirect_stdout(setup_stdout), redirect_stderr(setup_stderr):
                target = _resolve_callable(env, info, constructor_values)
            call_args, call_kwargs = _prepare_call(
                info.params[info.constructor_param_count :], function_values
            )
        except KeyboardInterrupt:
            raise
        except BaseException as exc:
            sample["status"] = "setup-error"
            sample["error"] = {"type": type(exc).__name__, "msg": str(exc)}
            continue

        stdout, stderr = io.StringIO(), io.StringIO()
        tracer = Tracer(
            filename=USER_FILENAME,
            max_steps=max_steps,
            max_seconds=min(max_seconds, max(remaining, 0.0)),
            count_only=True,
        )
        started_at = time.perf_counter()
        try:
            with redirect_stdout(stdout), redirect_stderr(stderr):
                with tracer:
                    _materialize_return_value(
                        target(*call_args, **call_kwargs), info.is_generator
                    )
            sample["status"] = "ok"
        except TraceLimitError as exc:
            hit_steps = tracer.op_count > max_steps
            sample["status"] = "step-limit" if hit_steps else "time-limit"
            sample["note"] = exc.reason
            payload["truncated"] = True
            payload["truncationReason"] = (
                f"Stopped at n={sample['n']}: {exc.reason} Larger sizes were skipped."
            )
            skip_note = (
                f"Skipped: n={sample['n']} already hit the "
                f"{'step' if hit_steps else 'time'} limit."
            )
        except KeyboardInterrupt:
            raise
        except BaseException as exc:
            sample["status"] = "exception"
            sample["error"] = {"type": type(exc).__name__, "msg": str(exc)}
        finally:
            sample["ms"] = round((time.perf_counter() - started_at) * 1000, 3)
            sample["ops"] = tracer.op_count

    fit = fit_growth(payload["samples"])
    payload["fit"] = fit
    payload["caveats"] = fit_caveats(
        payload["samples"], fit, fixed_from_user=from_user and len(info.params) > 1
    )
    return payload
