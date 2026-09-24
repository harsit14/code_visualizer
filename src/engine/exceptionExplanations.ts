import type { EngineError, Language } from './types';

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

const SCRIPT_EXPLANATIONS: Record<string, ExceptionExplanation> = {
  TypeError: {
    title: 'A value was used in a way its type does not allow.',
    detail:
      'Common causes are reading a property of undefined or null, or calling something that is not a function.',
    checks: [
      'Inspect the value on the failing line: is it undefined or null?',
      'Check what the previous call or lookup returned.',
    ],
  },
  ReferenceError: {
    title: 'A name is used before it exists.',
    detail:
      'The variable is not declared in this scope, is misspelled, or is a let/const read before its declaration runs.',
    checks: ['Check the spelling.', 'Make sure the declaration runs before this line.'],
  },
  RangeError: {
    title: 'A value is outside the allowed range.',
    detail:
      'Examples are an invalid array length, too many decimal digits, or recursion deep enough to exceed the call stack.',
    checks: [
      'For "Maximum call stack size exceeded", check the base case.',
      'Inspect the numbers passed on the failing line.',
    ],
  },
  SyntaxError: {
    title: 'Text could not be parsed.',
    detail:
      'While the program runs this usually comes from JSON.parse or a regular expression built from a string. Before running, it means the code itself has a typo.',
    checks: ['Inspect the string being parsed.', 'Check quotes and brackets.'],
  },
  NotSupportedError: {
    title: 'The tracer does not support this code yet.',
    detail:
      'Async functions, generators, modules, TypeScript namespaces and decorators cannot be traced yet.',
    checks: ['Rewrite the code as one synchronous script.', 'Move helpers into the same file.'],
  },
  Uncaught: {
    title: 'A value that is not an Error was thrown.',
    detail:
      'JavaScript allows throwing any value; the program stopped because nothing caught it.',
    checks: [
      'Throw an Error object to get a type and message.',
      'Add a try/catch where the value should be handled.',
    ],
  },
};

export function explainException(
  error: Pick<EngineError, 'type' | 'msg'> | null | undefined,
  language: Language = 'python',
): ExceptionExplanation | null {
  if (!error) {
    return null;
  }
  return (language === 'python' ? EXPLANATIONS : SCRIPT_EXPLANATIONS)[error.type] ?? null;
}
