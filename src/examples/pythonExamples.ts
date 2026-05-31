export type PythonExample = {
  id: string;
  title: string;
  category: string;
  difficulty: 'Intro' | 'Flow' | 'Objects' | 'Functions';
  code: string;
  highlights: string[];
};

export const pythonExamples: PythonExample[] = [
  {
    id: 'variables',
    title: 'Variable handoff',
    category: 'Variables',
    difficulty: 'Intro',
    code: `x = 1
y = x + 2
x = y * 3
print(x)`,
    highlights: ['assignment', 'reference', 'stdout'],
  },
  {
    id: 'loop-total',
    title: 'Loop accumulator',
    category: 'Loops',
    difficulty: 'Flow',
    code: `total = 0
for i in range(5):
    total += i
print(total)`,
    highlights: ['loop', 'iteration', 'mutation'],
  },
  {
    id: 'list-alias',
    title: 'List alias mutation',
    category: 'Objects',
    difficulty: 'Objects',
    code: `nums = [1, 2, 3]
same = nums
same.append(4)
print(nums)`,
    highlights: ['object identity', 'alias', 'mutation'],
  },
  {
    id: 'factorial',
    title: 'Recursive factorial',
    category: 'Functions',
    difficulty: 'Functions',
    code: `def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print(factorial(4))`,
    highlights: ['call stack', 'return', 'recursion'],
  },
  {
    id: 'dict-update',
    title: 'Dictionary update',
    category: 'Objects',
    difficulty: 'Objects',
    code: `data = {"a": 1, "b": 2}
for key in data:
    data[key] = data[key] + 10
print(data)`,
    highlights: ['dictionary', 'loop', 'mutation'],
  },
];

export const CUSTOM_SNIPPET_ID = 'custom-snippet';
export const CUSTOM_SNIPPET_TITLE = 'Custom snippet';
export const DEFAULT_EXAMPLE_ID = 'loop-total';

export function isPythonExampleId(id: string): boolean {
  return pythonExamples.some((example) => example.id === id);
}

export function getPythonExample(id: string): PythonExample {
  return pythonExamples.find((example) => example.id === id) ?? pythonExamples[0];
}
