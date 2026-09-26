"""JSON-string API used by the Pyodide worker.

The worker passes a JSON request and receives a JSON response, avoiding
PyProxy conversion pitfalls at the JS boundary.

Request shapes::

    {"op": "run", "source": "...", "options": {"mode"?, "function"?,
     "inputs"?, "seed"?, "maxSteps"?}}
    {"op": "analyze", "source": "..."}
    {"op": "complexity", "source": "...", "function"?, "seed"?, "param"?,
     "axis"?, "sizes"?, "inputs"?}
"""

from __future__ import annotations

import json
import traceback
from typing import Any

from .analyzer import analyze
from .runner import measure_complexity, run_session


def handle_request(request_json: str) -> str:
    """Dispatch a JSON request string and return a JSON response string."""
    try:
        request = json.loads(request_json)
        op = request.get("op")
        if op == "analyze":
            payload: dict[str, Any] = {"analysis": analyze(request["source"]).to_dict()}
        elif op == "run":
            options = request.get("options") or {}
            payload = run_session(
                request["source"],
                mode=options.get("mode"),
                function=options.get("function"),
                inputs=options.get("inputs"),
                seed=options.get("seed"),
                max_steps=options.get("maxSteps", 3000),
                max_seconds=options.get("maxSeconds", 8.0),
                expected=options.get("expected"),
            )
        elif op == "complexity":
            sizes = request.get("sizes")
            inputs = request.get("inputs")
            payload = measure_complexity(
                request["source"],
                function=request.get("function"),
                seed=request.get("seed"),
                sizes=sizes if isinstance(sizes, list) else None,
                param=request.get("param"),
                axis=request.get("axis"),
                inputs=(
                    inputs
                    if isinstance(inputs, list) and all(isinstance(item, str) for item in inputs)
                    else None
                ),
            )
        else:
            payload = {"error": {"type": "BadRequest", "msg": f"Unknown op {op!r}"}}
        return json.dumps(payload)
    except BaseException as exc:  # the worker must always get a response
        return json.dumps(
            {
                "error": {
                    "type": type(exc).__name__,
                    "msg": str(exc),
                    "traceback": traceback.format_exc(limit=10),
                }
            }
        )
