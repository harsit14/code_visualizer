export type Example = {
  id: string;
  title: string;
  category: 'LeetCode style' | 'Scripts';
  code: string;
};

export const examples: Example[] = [
  {
    id: 'two-sum',
    title: 'Two Sum (no entry point)',
    category: 'LeetCode style',
    code: `class Solution:
    def twoSum(self, nums, target):
        lookup = {}
        for i, value in enumerate(nums):
            if target - value in lookup:
                return [lookup[target - value], i]
            lookup[value] = i
        return []
`,
  },
  {
    id: 'reverse-linked-list',
    title: 'Reverse Linked List',
    category: 'LeetCode style',
    code: `class Solution:
    def reverseList(self, head):
        prev = None
        curr = head
        while curr:
            nxt = curr.next
            curr.next = prev
            prev = curr
            curr = nxt
        return prev
`,
  },
  {
    id: 'inorder-traversal',
    title: 'Binary Tree Inorder Traversal',
    category: 'LeetCode style',
    code: `class Solution:
    def inorderTraversal(self, root):
        result = []

        def visit(node):
            if not node:
                return
            visit(node.left)
            result.append(node.val)
            visit(node.right)

        visit(root)
        return result
`,
  },
  {
    id: 'sliding-window',
    title: 'Sliding Window (max sum of k)',
    category: 'LeetCode style',
    code: `def max_subarray_sum(nums, k):
    window = sum(nums[:k])
    best = window
    for right in range(k, len(nums)):
        window += nums[right] - nums[right - k]
        best = max(best, window)
    return best
`,
  },
  {
    id: 'binary-search',
    title: 'Binary Search (lo/hi pointers)',
    category: 'LeetCode style',
    code: `def search(nums, target):
    lo, hi = 0, len(nums) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
`,
  },
  {
    id: 'loop-accumulator',
    title: 'Loop accumulator',
    category: 'Scripts',
    code: `total = 0
for i in range(5):
    total += i
print(total)
`,
  },
  {
    id: 'recursive-factorial',
    title: 'Recursive factorial',
    category: 'Scripts',
    code: `def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print(factorial(4))
`,
  },
  {
    id: 'list-aliasing',
    title: 'List aliasing & mutation',
    category: 'Scripts',
    code: `nums = [1, 2, 3]
same = nums
same.append(4)
copy = list(nums)
copy.append(5)
print(nums, copy)
`,
  },
  {
    id: 'shared-references',
    title: 'Shared nested references',
    category: 'Scripts',
    code: `shared = [1, 2, 3]
matrix = [shared, shared]
matrix[0].append(99)
row = matrix[1]
print(matrix, row)
`,
  },
];

export const DEFAULT_EXAMPLE_ID = 'two-sum';

export function getExample(id: string): Example | undefined {
  return examples.find((example) => example.id === id);
}
