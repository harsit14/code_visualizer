"""Practice verdicts use bounded actual values, not visualization previews."""
import json
import pytest
from codeviz.assertions import assess_return
from codeviz.api import handle_request
from codeviz.runner import run_session


@pytest.mark.parametrize(('actual', 'expected', 'status'), [
    ([0, 1], '[0,1]', 'pass'),
    ('a b', "'ab'", 'fail'),
    ('a b', "'a b'", 'pass'),
    (True, '1', 'fail'),
    (1, '1.0', 'fail'),
    ([1], '(1,)', 'fail'),
    ({'a': 1, 'b': 2}, "{'b': 2, 'a': 1}", 'pass'),
    ({1, 2}, '{2, 1}', 'pass'),
    (None, 'None', 'pass'),
    (1, "__import__('os').getcwd()", 'invalid'),
])
def test_typed_literal_comparisons(actual, expected, status):
    assert assess_return(actual, expected)['status'] == status


def test_complete_value_is_compared_when_visualization_is_truncated():
    source = 'def solve():\n    return list(range(100))'
    expected = repr(list(range(100)))
    result = run_session(source, expected=expected)
    assert result['run']['returnValue']['truncated']
    assert result['run']['assessment']['status'] == 'pass'
    assert result['run']['assessment']['actualLiteral'] == expected
    assert run_session(source, expected='[0, 1]')['run']['assessment']['status'] == 'fail'


def test_no_custom_methods_are_called():
    class Untrusted:
        def __repr__(self):
            raise AssertionError('repr must not run')
        def __eq__(self, other):
            raise AssertionError('eq must not run')
    assert assess_return([Untrusted()], '[]')['status'] == 'inconclusive'


def test_cycles_and_oversized_values_are_unchecked():
    cyclic = []
    cyclic.append(cyclic)
    for value in (cyclic, list(range(10001)), float('inf'), 'x' * 100001):
        assertion = assess_return(value, '[]')
        assert assertion['status'] == 'inconclusive'
        assert assertion['actualLiteral'] is None


def test_only_parseable_actual_literals_can_be_promoted():
    assert assess_return([frozenset({1})])['actualLiteral'] is None
    assert assess_return('a\nb "c"')['actualLiteral'] == repr('a\nb "c"')


def test_api_forwards_expected_and_marks_preline_snapshots():
    result = json.loads(handle_request(json.dumps({'op': 'run', 'source': 'def solve():\n    return 3', 'options': {'expected': '3'}})))
    assert result['run']['assessment']['status'] == 'pass'
    assert all(s['phase'] == ('before' if s['event'] == 'line' else 'event') for s in result['run']['steps'])
