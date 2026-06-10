"""Code Visualizer execution engine.

This package is the Python half of Code Visualizer. It runs both under
CPython (for tests) and under Pyodide inside the browser worker, where
``runner.run_session`` is the single entry point.

Modules:
    structures: TreeNode / ListNode definitions and builders.
    serialize:  Value snapshotting into a JSON-friendly heap encoding.
    analyzer:   AST analysis, entry-point detection, parameter inference.
    inputgen:   Seeded generation of test inputs for inferred types.
    tracer:     sys.settrace tracer with step/time safeguards.
    runner:     Orchestration of analysis + generation + traced execution.
"""

__version__ = "2.0.0"
