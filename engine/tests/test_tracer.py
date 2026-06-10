import pytest

from codeviz.tracer import MAX_DETAILED_FRAMES, TraceLimitError, Tracer

FILENAME = "<user_code>"


def run_traced(source: str, max_steps: int = 3000, env: dict | None = None) -> Tracer:
    tracer = Tracer(filename=FILENAME, max_steps=max_steps)
    code = compile(source, FILENAME, "exec")
    env = env if env is not None else {"__name__": "__main__"}
    with tracer:
        exec(code, env)
    return tracer


def test_records_line_events_with_locals():
    tracer = run_traced("x = 1\ny = x + 2")
    lines = [s["line"] for s in tracer.steps if s["event"] == "line"]
    assert lines == [1, 2]
    final = tracer.steps[-1]
    assert final["stack"][0]["locals"]["x"]["v"] == "1"


def test_call_and_return_events():
    tracer = run_traced("def f(n):\n    return n * 2\n\nresult = f(5)")
    events = [(s["event"], s["func"]) for s in tracer.steps]
    assert ("call", "f") in events
    returns = [s for s in tracer.steps if s["event"] == "return" and s["func"] == "f"]
    assert returns[0]["ret"]["v"] == "10"


def test_recursion_builds_stack():
    tracer = run_traced(
        "def fact(n):\n"
        "    if n <= 1:\n"
        "        return 1\n"
        "    return n * fact(n - 1)\n"
        "\n"
        "fact(4)"
    )
    deepest = max(len(s["stack"]) for s in tracer.steps)
    assert deepest == 5  # module + 4 fact frames


def test_deep_recursion_elides_old_frames():
    tracer = run_traced(
        "def down(n):\n"
        "    if n == 0:\n"
        "        return 0\n"
        "    return down(n - 1)\n"
        "\n"
        "down(30)",
        max_steps=3000,
    )
    deepest_step = max(tracer.steps, key=lambda s: len(s["stack"]))
    elided = [f for f in deepest_step["stack"] if f.get("elided")]
    detailed = [f for f in deepest_step["stack"] if not f.get("elided")]
    assert elided, "expected deep frames to be elided"
    assert len(detailed) == MAX_DETAILED_FRAMES


def test_exception_recorded_at_failing_line():
    tracer = Tracer(filename=FILENAME)
    code = compile("a = 1\nb = a / 0", FILENAME, "exec")
    with pytest.raises(ZeroDivisionError):
        with tracer:
            exec(code, {"__name__": "__main__"})
    exc_steps = [s for s in tracer.steps if s["event"] == "exception"]
    assert exc_steps
    assert exc_steps[0]["line"] == 2
    assert exc_steps[0]["exc"]["type"] == "ZeroDivisionError"


def test_step_limit_aborts_execution():
    tracer = Tracer(filename=FILENAME, max_steps=50)
    code = compile("i = 0\nwhile True:\n    i += 1", FILENAME, "exec")
    with pytest.raises(TraceLimitError):
        with tracer:
            exec(code, {"__name__": "__main__"})
    assert tracer.truncated
    assert len(tracer.steps) <= 51


def test_time_limit_aborts_execution():
    tracer = Tracer(filename=FILENAME, max_steps=10**9, max_seconds=0.2, count_only=True)
    code = compile("i = 0\nwhile True:\n    i += 1", FILENAME, "exec")
    with pytest.raises(TraceLimitError):
        with tracer:
            exec(code, {"__name__": "__main__"})
    assert "stopped" in tracer.truncation_reason


def test_stdout_length_tracked():
    import io
    from contextlib import redirect_stdout

    buffer = io.StringIO()
    tracer = Tracer(filename=FILENAME, stdout_len=lambda: len(buffer.getvalue()))
    code = compile("print('ab')\nprint('cd')", FILENAME, "exec")
    with redirect_stdout(buffer):
        with tracer:
            exec(code, {"__name__": "__main__"})
    lengths = [s["stdoutLen"] for s in tracer.steps]
    assert lengths[-1] == len("ab\ncd\n")
    assert lengths[0] == 0


def test_generator_steps_traced():
    tracer = run_traced(
        "def gen():\n"
        "    yield 1\n"
        "    yield 2\n"
        "\n"
        "values = list(gen())"
    )
    gen_lines = [s for s in tracer.steps if s["func"] == "gen"]
    assert len(gen_lines) >= 4  # call + yields + resumes


def test_count_only_mode_collects_no_steps():
    tracer = Tracer(filename=FILENAME, count_only=True)
    code = compile("total = 0\nfor i in range(10):\n    total += i", FILENAME, "exec")
    with tracer:
        exec(code, {"__name__": "__main__"})
    assert tracer.steps == []
    assert tracer.op_count > 10


def test_non_user_frames_ignored():
    tracer = run_traced("import json\nx = json.dumps({'a': 1})")
    funcs = {s["func"] for s in tracer.steps}
    assert funcs == {"<module>"}
