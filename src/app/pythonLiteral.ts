/**
 * Parses the Python literals used for practice expectations and explains how
 * an actual return value differs from the expected one. Equality follows the
 * engine's assertions: types are strict, lists/tuples are ordered, and dicts
 * and sets are compared without order.
 */

export type PyValue =
  | { t: 'None' }
  | { t: 'bool'; v: boolean }
  | { t: 'int'; v: bigint }
  | { t: 'float'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bytes'; v: string }
  | { t: 'list' | 'tuple' | 'set' | 'frozenset'; items: PyValue[] }
  | { t: 'dict'; entries: [PyValue, PyValue][] };

const MAX_DEPTH = 64;
const MAX_HINTS = 3;
const PREVIEW = 40;

class LiteralParser {
  private pos = 0;

  constructor(private readonly text: string) {}

  parse(): PyValue {
    const value = this.value(0);
    this.space();
    if (this.pos !== this.text.length) this.fail();
    return value;
  }

  private fail(): never {
    throw new SyntaxError(`Unexpected input at position ${this.pos}`);
  }

  private space() {
    while (/\s/.test(this.text[this.pos] ?? '')) this.pos += 1;
  }

  private eat(token: string): boolean {
    this.space();
    if (this.text.startsWith(token, this.pos)) {
      this.pos += token.length;
      return true;
    }
    return false;
  }

  private value(depth: number): PyValue {
    if (depth > MAX_DEPTH) this.fail();
    this.space();
    const char = this.text[this.pos];
    if (char === '[') return this.sequence('list', ']', depth);
    if (char === '(') return this.parenthesized(depth);
    if (char === '{') return this.braced(depth);
    const word = /^(True|False|None|set\(\)|frozenset\(\))/.exec(this.text.slice(this.pos));
    if (word) {
      this.pos += word[0].length;
      if (word[0] === 'True' || word[0] === 'False') return { t: 'bool', v: word[0] === 'True' };
      if (word[0] === 'None') return { t: 'None' };
      return { t: word[0] === 'set()' ? 'set' : 'frozenset', items: [] };
    }
    const string = /^([rRbBuU]{0,2})(['"])/.exec(this.text.slice(this.pos));
    if (string) return this.string(string[1].toLowerCase(), depth);
    return this.number();
  }

  private sequence(type: 'list' | 'set' | 'frozenset' | 'tuple', close: string, depth: number) {
    this.pos += 1;
    const items: PyValue[] = [];
    while (!this.eat(close)) {
      items.push(this.value(depth + 1));
      if (!this.eat(',')) {
        if (!this.eat(close)) this.fail();
        break;
      }
    }
    return { t: type, items } as PyValue;
  }

  private parenthesized(depth: number): PyValue {
    this.pos += 1;
    if (this.eat(')')) return { t: 'tuple', items: [] };
    const first = this.value(depth + 1);
    if (this.eat(')')) return first;
    if (!this.eat(',')) this.fail();
    const items = [first];
    while (!this.eat(')')) {
      items.push(this.value(depth + 1));
      if (!this.eat(',')) {
        if (!this.eat(')')) this.fail();
        break;
      }
    }
    return { t: 'tuple', items };
  }

  private braced(depth: number): PyValue {
    this.pos += 1;
    if (this.eat('}')) return { t: 'dict', entries: [] };
    const first = this.value(depth + 1);
    if (!this.eat(':')) {
      const items = [first];
      while (this.eat(',')) {
        if (this.eat('}')) return { t: 'set', items };
        items.push(this.value(depth + 1));
      }
      if (!this.eat('}')) this.fail();
      return { t: 'set', items };
    }
    const entries: [PyValue, PyValue][] = [[first, this.value(depth + 1)]];
    while (this.eat(',')) {
      if (this.eat('}')) return { t: 'dict', entries };
      const key = this.value(depth + 1);
      if (!this.eat(':')) this.fail();
      entries.push([key, this.value(depth + 1)]);
    }
    if (!this.eat('}')) this.fail();
    return { t: 'dict', entries };
  }

  private string(prefix: string, depth: number): PyValue {
    this.pos += prefix.length;
    const raw = prefix.includes('r');
    const quote = this.text[this.pos];
    const triple = this.text.startsWith(quote.repeat(3), this.pos);
    const end = triple ? quote.repeat(3) : quote;
    this.pos += end.length;
    let value = '';
    while (!this.text.startsWith(end, this.pos)) {
      const char = this.text[this.pos];
      if (char === undefined || (!triple && char === '\n')) this.fail();
      if (char === '\\' && !raw) {
        value += this.escape();
        continue;
      }
      value += char;
      this.pos += 1;
    }
    this.pos += end.length;
    // Adjacent string literals concatenate, as in Python source.
    this.space();
    const next = /^([rRbBuU]{0,2})(['"])/.exec(this.text.slice(this.pos));
    if (next && depth < MAX_DEPTH) {
      const rest = this.string(next[1].toLowerCase(), depth + 1) as { v: string };
      value += rest.v;
    }
    return { t: prefix.includes('b') ? 'bytes' : 'str', v: value };
  }

  private escape(): string {
    const next = this.text[this.pos + 1];
    const simple: Record<string, string> = {
      n: '\n',
      t: '\t',
      r: '\r',
      '0': '\0',
      '\\': '\\',
      "'": "'",
      '"': '"',
      a: '\x07',
      b: '\b',
      f: '\f',
      v: '\v',
      '\n': '',
    };
    if (next in simple) {
      this.pos += 2;
      return simple[next];
    }
    const hex = /^\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8}))/.exec(
      this.text.slice(this.pos),
    );
    if (hex) {
      this.pos += hex[0].length;
      return String.fromCodePoint(parseInt(hex[1] ?? hex[2] ?? hex[3], 16));
    }
    this.pos += 1;
    return '\\';
  }

  private number(): PyValue {
    const match =
      /^[+-]?(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*)?\.?[\d_]*(?:[eE][+-]?\d[\d_]*)?)/.exec(
        this.text.slice(this.pos),
      );
    const text = match?.[0] ?? '';
    if (!/\d/.test(text)) this.fail();
    this.pos += text.length;
    const clean = text.replace(/_/g, '');
    if (/^[+-]?0[xXoObB]/.test(clean)) {
      const negative = clean.startsWith('-');
      const magnitude = BigInt(clean.replace(/^[+-]/, ''));
      return { t: 'int', v: negative ? -magnitude : magnitude };
    }
    if (/[.eE]/.test(clean)) return { t: 'float', v: Number(clean) };
    return { t: 'int', v: BigInt(clean) };
  }
}

export function parsePythonLiteral(text: string): PyValue {
  return new LiteralParser(text).parse();
}

function quote(text: string): string {
  const quoteChar = text.includes("'") && !text.includes('"') ? '"' : "'";
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(new RegExp(quoteChar, 'g'), `\\${quoteChar}`);
  return `${quoteChar}${escaped}${quoteChar}`;
}

function formatFloat(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e16) return `${value}.0`;
  return String(value);
}

/** Python-style repr, shortened for messages. */
export function pyRepr(value: PyValue, limit = PREVIEW): string {
  let text: string;
  switch (value.t) {
    case 'None':
      text = 'None';
      break;
    case 'bool':
      text = value.v ? 'True' : 'False';
      break;
    case 'int':
      text = value.v.toString();
      break;
    case 'float':
      text = formatFloat(value.v);
      break;
    case 'str':
      text = quote(value.v);
      break;
    case 'bytes':
      text = `b${quote(value.v)}`;
      break;
    case 'dict':
      text = `{${value.entries.map(([k, v]) => `${pyRepr(k, limit)}: ${pyRepr(v, limit)}`).join(', ')}}`;
      break;
    case 'tuple':
      text =
        value.items.length === 1
          ? `(${pyRepr(value.items[0], limit)},)`
          : `(${value.items.map((item) => pyRepr(item, limit)).join(', ')})`;
      break;
    case 'set':
    case 'frozenset': {
      const body = value.items.map((item) => pyRepr(item, limit)).join(', ');
      text =
        value.items.length === 0
          ? `${value.t}()`
          : value.t === 'set'
            ? `{${body}}`
            : `frozenset({${body}})`;
      break;
    }
    default:
      text = `[${value.items.map((item) => pyRepr(item, limit)).join(', ')}]`;
  }
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function key(value: PyValue): string {
  switch (value.t) {
    case 'set':
    case 'frozenset':
      return `${value.t}{${value.items.map(key).sort().join(',')}}`;
    case 'dict':
      return `dict{${value.entries
        .map(([k, v]) => `${key(k)}:${key(v)}`)
        .sort()
        .join(',')}}`;
    case 'list':
    case 'tuple':
      return `${value.t}[${value.items.map(key).join(',')}]`;
    case 'int':
      return `int:${value.v}`;
    case 'float':
      return `float:${Object.is(value.v, -0) ? 0 : value.v}`;
    case 'bool':
      return `bool:${value.v}`;
    case 'None':
      return 'None';
    default:
      return `${value.t}:${JSON.stringify(value.v)}`;
  }
}

export function pyEqual(a: PyValue, b: PyValue): boolean {
  return key(a) === key(b);
}

function typeLabel(value: PyValue): string {
  const articles: Record<string, string> = {
    int: 'an int',
    None: 'None',
  };
  return articles[value.t] ?? `a ${value.t}`;
}

function at(path: string): string {
  return path ? `At ${path}: ` : '';
}

function explainNumbers(path: string, expected: PyValue, actual: PyValue): string {
  const e = expected.t === 'int' ? Number(expected.v) : (expected as { v: number }).v;
  const a = actual.t === 'int' ? Number(actual.v) : (actual as { v: number }).v;
  const base = `${at(path)}expected ${pyRepr(expected)}, got ${pyRepr(actual)}`;
  if (expected.t !== actual.t) {
    return `${base}. The numbers are ${e === a ? 'equal' : 'different'} but one is ${typeLabel(expected)} and the other ${typeLabel(actual)}.`;
  }
  if (expected.t === 'float' && Math.abs(e - a) <= 1e-9 * Math.max(1, Math.abs(e))) {
    return `${base}. This is floating-point rounding; round the result or compare with a tolerance.`;
  }
  const difference = a - e;
  if (Number.isSafeInteger(difference) && Math.abs(difference) <= 2) {
    return `${base} (off by ${Math.abs(difference)}${difference > 0 ? ', too high' : ', too low'}).`;
  }
  return `${base}.`;
}

function explainStrings(path: string, expected: string, actual: string): string {
  const base = `${at(path)}expected ${quote(expected)}, got ${quote(actual)}`;
  if (expected.toLowerCase() === actual.toLowerCase()) {
    return `${base}. Only capitalization differs.`;
  }
  if (expected.replace(/\s+/g, '') === actual.replace(/\s+/g, '')) {
    return `${base}. Only whitespace differs (${expected.length} vs ${actual.length} characters).`;
  }
  let index = 0;
  while (index < expected.length && expected[index] === actual[index]) index += 1;
  if (index >= actual.length) {
    return `${base}. The actual string stops after ${actual.length} characters.`;
  }
  if (index >= expected.length) {
    return `${base}. The actual string has extra text from index ${index}.`;
  }
  return `${base}. They first differ at index ${index}.`;
}

function explain(path: string, expected: PyValue, actual: PyValue, hints: string[]): void {
  if (hints.length >= MAX_HINTS || pyEqual(expected, actual)) return;
  const numeric = (value: PyValue) => value.t === 'int' || value.t === 'float';
  if (numeric(expected) && numeric(actual)) {
    hints.push(explainNumbers(path, expected, actual));
    return;
  }
  if (actual.t === 'None' && expected.t !== 'None') {
    hints.push(
      `${at(path)}expected ${pyRepr(expected)}, got None. Check that every path returns a value.`,
    );
    return;
  }
  if (expected.t !== actual.t) {
    const sameItems =
      'items' in expected &&
      'items' in actual &&
      pyEqual({ t: 'list', items: expected.items }, { t: 'list', items: actual.items });
    hints.push(
      `${at(path)}expected ${typeLabel(expected)} but got ${typeLabel(actual)}${sameItems ? ' with the same items' : ''}.`,
    );
    return;
  }
  if (expected.t === 'str' && actual.t === 'str') {
    hints.push(explainStrings(path, expected.v, actual.v));
    return;
  }
  if ((expected.t === 'list' || expected.t === 'tuple') && 'items' in actual) {
    const e = expected.items;
    const a = actual.items;
    const sorted = (items: PyValue[]) => items.map(key).sort().join('|');
    if (e.length === a.length && sorted(e) === sorted(a)) {
      hints.push(
        `${at(path)}same items in a different order. Check whether the result should be sorted or keep the input order.`,
      );
      return;
    }
    if (e.length !== a.length) {
      hints.push(`${at(path)}expected ${e.length} items, got ${a.length}.`);
    }
    for (
      let index = 0;
      index < Math.max(e.length, a.length) && hints.length < MAX_HINTS;
      index += 1
    ) {
      const child = `${path}[${index}]`;
      if (index >= a.length) {
        hints.push(`Missing ${child} = ${pyRepr(e[index])}.`);
        return;
      }
      if (index >= e.length) {
        hints.push(`Unexpected ${child} = ${pyRepr(a[index])}.`);
        return;
      }
      if (!pyEqual(e[index], a[index])) {
        explain(child, e[index], a[index], hints);
        return;
      }
    }
    return;
  }
  if ((expected.t === 'set' || expected.t === 'frozenset') && 'items' in actual) {
    const actualKeys = new Set(actual.items.map(key));
    const expectedKeys = new Set(expected.items.map(key));
    const missing = expected.items.filter((item) => !actualKeys.has(key(item)));
    const extra = actual.items.filter((item) => !expectedKeys.has(key(item)));
    const parts = [
      missing.length ? `missing ${missing.map((item) => pyRepr(item)).join(', ')}` : '',
      extra.length ? `unexpected ${extra.map((item) => pyRepr(item)).join(', ')}` : '',
    ].filter(Boolean);
    hints.push(`${at(path)}${parts.join('; ')}.`);
    return;
  }
  if (expected.t === 'dict' && actual.t === 'dict') {
    const actualMap = new Map(actual.entries.map(([k, v]) => [key(k), [k, v] as const]));
    const expectedMap = new Map(expected.entries.map(([k, v]) => [key(k), [k, v] as const]));
    for (const [id, [k, v]] of expectedMap) {
      if (hints.length >= MAX_HINTS) return;
      const found = actualMap.get(id);
      if (!found)
        hints.push(`Missing key ${pyRepr(k)}${path ? ` in ${path}` : ''} (expected ${pyRepr(v)}).`);
      else explain(`${path}[${pyRepr(k)}]`, v, found[1], hints);
    }
    for (const [id, [k, v]] of actualMap) {
      if (hints.length >= MAX_HINTS) return;
      if (!expectedMap.has(id))
        hints.push(`Unexpected key ${pyRepr(k)}${path ? ` in ${path}` : ''} = ${pyRepr(v)}.`);
    }
    return;
  }
  hints.push(`${at(path)}expected ${pyRepr(expected)}, got ${pyRepr(actual)}.`);
}

/**
 * Up to three short explanations of how `actual` differs from `expected`, or
 * an empty list when either literal cannot be parsed or they are equal.
 */
export function explainMismatch(expectedText: string, actualText: string): string[] {
  let expected: PyValue;
  let actual: PyValue;
  try {
    expected = parsePythonLiteral(expectedText);
    actual = parsePythonLiteral(actualText);
  } catch {
    return [];
  }
  const hints: string[] = [];
  explain('', expected, actual, hints);
  return hints.map((hint) => hint.charAt(0).toUpperCase() + hint.slice(1));
}
