import type { EngineError } from './types';

export type ExceptionExplanation = {
  title: string;
  detail: string;
  checks: string[];
};

const EXPLANATIONS: Record<string, ExceptionExplanation> = {
  AttributeError: {
    title: 'That value does not have the attribute being used.',
    detail:
      'This often means the variable is a different type than expected, or it is None when the code expects an object.',
    checks: [
      'Inspect the variable on the failing line.',
      'Check where that variable was last assigned.',
    ],
  },
  ImportError: {
    title: 'The import could not be loaded.',
    detail:
      'The module or name may be misspelled, unavailable in Pyodide, or imported from the wrong package.',
    checks: ['Check the import spelling.', 'Try a standard-library alternative when possible.'],
  },
  IndexError: {
    title: 'An index went outside the sequence.',
    detail:
      'A list, string, tuple, or similar value was accessed with a position that is not currently valid.',
    checks: [
      'Compare the index with the sequence length.',
      'Watch loop bounds and moving pointers.',
    ],
  },
  KeyError: {
    title: 'The dictionary key is missing.',
    detail: 'The code tried to read a key that is not present in the dictionary or map.',
    checks: ['Inspect the dictionary keys.', 'Use membership checks before reading optional keys.'],
  },
  ModuleNotFoundError: {
    title: 'The module could not be found.',
    detail:
      'The import name may be misspelled, unavailable in Pyodide, or not part of the bundled runtime.',
    checks: [
      'Check the module spelling.',
      'Prefer standard-library modules for browser execution.',
    ],
  },
  NameError: {
    title: 'A name is being used before Python knows it.',
    detail: 'The variable or function name has not been defined in the current scope.',
    checks: ['Check for typos.', 'Confirm the assignment runs before this line.'],
  },
  RecursionError: {
    title: 'The recursion went too deep.',
    detail: 'The recursive calls did not stop before Python reached its recursion limit.',
    checks: ['Verify the base case.', 'Check that each call moves closer to the base case.'],
  },
  TypeError: {
    title: 'A value has the wrong type for this operation.',
    detail:
      'Python received a type that the current operator, function, or indexing operation cannot use.',
    checks: [
      'Inspect the value type on the failing line.',
      'Check whether a function returned None.',
    ],
  },
  UnboundLocalError: {
    title: 'A local variable is read before assignment.',
    detail: 'Python sees the name as local to this function, but the assignment did not run first.',
    checks: [
      'Initialize the variable before branching.',
      'Check if an if/else path skipped the assignment.',
    ],
  },
  ValueError: {
    title: 'The value has the right type but an invalid content.',
    detail: 'The operation accepts this kind of value, but not the specific value it received.',
    checks: [
      'Inspect the exact value.',
      'Check conversions like int(...), unpacking, and searches.',
    ],
  },
  ZeroDivisionError: {
    title: 'The code divided by zero.',
    detail: 'The denominator became 0 at runtime.',
    checks: ['Inspect the denominator.', 'Add a guard for zero before dividing.'],
  },
};

export function explainException(
  error: Pick<EngineError, 'type' | 'msg'> | null | undefined,
): ExceptionExplanation | null {
  if (!error) {
    return null;
  }
  return EXPLANATIONS[error.type] ?? null;
}
