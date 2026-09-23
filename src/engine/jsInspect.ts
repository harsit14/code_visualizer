/**
 * Node-style console formatting for traced JavaScript.
 *
 * A compact port of the parts of Node's `util.format`/`util.inspect` that
 * learners see most often, so traced `console.log` output matches running the
 * same script with Node. Values are read through property descriptors: getters
 * are never invoked.
 */

const DEPTH = 2;
const BREAK_LENGTH = 80;
const COMPACT = 3;
const MAX_ARRAY_LENGTH = 100;
const MAX_STRING_LENGTH = 10_000;
const KEY_PATTERN = /^[a-zA-Z_][a-zA-Z_0-9]*$/;

type Context = {
  seen: object[];
  circular: Map<object, number> | undefined;
  indentationLvl: number;
  currentDepth: number;
  depth: number;
};

type Kind = 'object' | 'array';

const ESCAPES: Record<string, string> = {
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
  '\\': '\\\\',
};

function escapeString(value: string, quote: string): string {
  let result = '';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === quote) result += `\\${quote}`;
    else if (ESCAPES[char]) result += ESCAPES[char];
    else if (code < 0x20 || code === 0x7f)
      result += `\\x${code.toString(16).toUpperCase().padStart(2, '0')}`;
    else result += char;
  }
  return result;
}

function quoteString(value: string): string {
  let quote = "'";
  if (value.includes("'")) {
    if (!value.includes('"')) quote = '"';
    else if (!value.includes('`') && !value.includes('${')) quote = '`';
  }
  return `${quote}${escapeString(value, quote)}${quote}`;
}

function formatNumber(value: number): string {
  return Object.is(value, -0) ? '-0' : String(value);
}

function formatPrimitive(value: unknown): string {
  switch (typeof value) {
    case 'string': {
      const trailer =
        value.length > MAX_STRING_LENGTH
          ? `... ${value.length - MAX_STRING_LENGTH} more character${value.length - MAX_STRING_LENGTH > 1 ? 's' : ''}`
          : '';
      return quoteString(value.slice(0, MAX_STRING_LENGTH)) + trailer;
    }
    case 'number':
      return formatNumber(value);
    case 'bigint':
      return `${value}n`;
    case 'symbol':
      return value.toString();
    default:
      return String(value);
  }
}

/** Reads a property without running getters or proxies' `get` traps. */
function descriptorValue(target: object, key: PropertyKey): unknown {
  for (let current: object | null = target; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return 'value' in descriptor ? descriptor.value : undefined;
  }
  return undefined;
}

/** Constructor name from the prototype chain, `null` for null-prototype objects. */
export function constructorName(value: object): string | null {
  let current: object | null = value;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'constructor');
    const ctor = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    if (typeof ctor === 'function' && typeof ctor.name === 'string' && ctor.name !== '') {
      return ctor.name;
    }
    current = Object.getPrototypeOf(current);
  }
  return null;
}

type AnyFunction = (...args: never[]) => unknown;

function isClass(value: AnyFunction): boolean {
  try {
    const source = Function.prototype.toString.call(value);
    return source.startsWith('class') && source.endsWith('}');
  } catch {
    return false;
  }
}

function functionBase(value: AnyFunction): string {
  const name = descriptorValue(value, 'name');
  const label = typeof name === 'string' && name !== '' ? name : null;
  if (isClass(value)) {
    const parent = Object.getPrototypeOf(value) as AnyFunction | null;
    const parentName = parent ? descriptorValue(parent, 'name') : '';
    return `[class ${label ?? '(anonymous)'}${typeof parentName === 'string' && parentName ? ` extends ${parentName}` : ''}]`;
  }
  const tag = constructorName(value) ?? 'Function';
  const type = tag === 'AsyncFunction' || tag === 'GeneratorFunction' ? tag : 'Function';
  return label ? `[${type}: ${label}]` : `[${type} (anonymous)]`;
}

function prefix(ctor: string | null, fallback: string, size = ''): string {
  return ctor === null ? `[${fallback}${size}: null prototype] ` : `${ctor}${size} `;
}

function errorText(value: object): string {
  const name = descriptorValue(value, 'name');
  const message = descriptorValue(value, 'message');
  const label = typeof name === 'string' ? name : 'Error';
  return typeof message === 'string' && message !== '' ? `${label}: ${message}` : label;
}

function isBelowBreakLength(output: string[], start: number, base: string): boolean {
  let total = output.length + start;
  if (total + output.length > BREAK_LENGTH) return false;
  for (const entry of output) {
    total += entry.length;
    if (total > BREAK_LENGTH) return false;
  }
  return base === '' || !base.includes('\n');
}

function groupArrayElements(ctx: Context, output: string[], value: unknown[] | undefined) {
  let totalLength = 0;
  let maxLength = 0;
  let outputLength = output.length;
  if (value && output.length > 0 && output[output.length - 1].startsWith('... ')) outputLength -= 1;
  const separatorSpace = 2;
  const dataLength: number[] = [];
  for (let i = 0; i < outputLength; i += 1) {
    const length = output[i].length;
    dataLength[i] = length;
    totalLength += length + separatorSpace;
    if (maxLength < length) maxLength = length;
  }
  const actualMax = maxLength + separatorSpace;
  if (
    actualMax * 3 + ctx.indentationLvl < BREAK_LENGTH &&
    (totalLength / actualMax > 5 || maxLength <= 6)
  ) {
    const averageBias = Math.sqrt(actualMax - totalLength / output.length);
    const biasedMax = Math.max(actualMax - 3 - averageBias, 1);
    const columns = Math.min(
      Math.round(Math.sqrt(2.5 * biasedMax * outputLength) / biasedMax),
      Math.floor((BREAK_LENGTH - ctx.indentationLvl) / actualMax),
      COMPACT * 4,
      15,
    );
    if (columns <= 1) return output;
    const maxLineLength: number[] = [];
    for (let i = 0; i < columns; i += 1) {
      let lineLength = 0;
      for (let j = i; j < output.length; j += columns) {
        if (dataLength[j] > lineLength) lineLength = dataLength[j];
      }
      maxLineLength.push(lineLength + separatorSpace);
    }
    let padStart = true;
    if (value) {
      for (let i = 0; i < output.length; i += 1) {
        if (typeof value[i] !== 'number' && typeof value[i] !== 'bigint') {
          padStart = false;
          break;
        }
      }
    }
    const grouped: string[] = [];
    for (let i = 0; i < outputLength; i += columns) {
      const max = Math.min(i + columns, outputLength);
      let line = '';
      let j = i;
      for (; j < max - 1; j += 1) {
        const cell = `${output[j]}, `;
        line += padStart
          ? cell.padStart(maxLineLength[j - i], ' ')
          : cell.padEnd(maxLineLength[j - i], ' ');
      }
      line += padStart ? output[j].padStart(maxLineLength[j - i] - separatorSpace, ' ') : output[j];
      grouped.push(line);
    }
    if (outputLength < output.length) grouped.push(output[outputLength]);
    return grouped;
  }
  return output;
}

function reduceToSingleString(
  ctx: Context,
  output: string[],
  base: string,
  braces: [string, string],
  kind: Kind,
  recurseTimes: number,
  value: unknown,
): string {
  const entries = output.length;
  if (kind === 'array' && entries > 6) {
    output = groupArrayElements(ctx, output, Array.isArray(value) ? value : undefined);
  }
  if (ctx.currentDepth - recurseTimes < COMPACT && entries === output.length) {
    const start = output.length + ctx.indentationLvl + braces[0].length + base.length + 10;
    if (isBelowBreakLength(output, start, base)) {
      const joined = output.join(', ');
      if (!joined.includes('\n')) {
        return `${base ? `${base} ` : ''}${braces[0]} ${joined} ${braces[1]}`;
      }
    }
  }
  const indentation = `\n${' '.repeat(ctx.indentationLvl)}`;
  return `${base ? `${base} ` : ''}${braces[0]}${indentation}  ${output.join(`,${indentation}  `)}${indentation}${braces[1]}`;
}

function formatKey(key: PropertyKey, enumerable: boolean): string {
  if (typeof key === 'symbol') return key.toString();
  if (key === '__proto__') return "['__proto__']";
  if (!enumerable) return `[${key}]`;
  return KEY_PATTERN.test(key as string) ? (key as string) : quoteString(key as string);
}

function formatProperty(
  ctx: Context,
  target: object,
  recurseTimes: number,
  key: PropertyKey,
  kind: Kind,
): string {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  let text: string;
  if (descriptor && 'value' in descriptor && descriptor.value !== undefined) {
    ctx.indentationLvl += 2;
    text = formatValue(ctx, descriptor.value, recurseTimes);
    ctx.indentationLvl -= 2;
  } else if (descriptor?.get) {
    text = descriptor.set ? '[Getter/Setter]' : '[Getter]';
  } else if (descriptor?.set) {
    text = '[Setter]';
  } else {
    text = 'undefined';
  }
  if (kind === 'array') return text;
  return `${formatKey(key, descriptor?.enumerable ?? true)}: ${text}`;
}

function remainingText(remaining: number): string {
  return `... ${remaining} more item${remaining > 1 ? 's' : ''}`;
}

function ownKeys(value: object, skipIndices: boolean): PropertyKey[] {
  const keys: PropertyKey[] = Object.keys(value);
  const filtered = skipIndices ? keys.filter((key) => !/^(0|[1-9]\d*)$/.test(key as string)) : keys;
  for (const symbol of Object.getOwnPropertySymbols(value)) {
    if (Object.getOwnPropertyDescriptor(value, symbol)?.enumerable) filtered.push(symbol);
  }
  return filtered;
}

function formatArrayLike(ctx: Context, value: ArrayLike<unknown>, recurseTimes: number) {
  const length = value.length;
  const shown = Math.min(MAX_ARRAY_LENGTH, length);
  const output: string[] = [];
  for (let i = 0; i < shown; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, i)) {
      let holes = 0;
      while (i < length && !Object.prototype.hasOwnProperty.call(value, i)) {
        holes += 1;
        i += 1;
      }
      output.push(`<${holes} empty item${holes > 1 ? 's' : ''}>`);
      i -= 1;
      if (output.length >= MAX_ARRAY_LENGTH) break;
      continue;
    }
    output.push(formatProperty(ctx, value as object, recurseTimes, String(i), 'array'));
  }
  if (length > shown) output.push(remainingText(length - shown));
  return output;
}

type Layout = {
  base: string;
  braces: [string, string];
  kind: Kind;
  keys: PropertyKey[];
  entries: (recurseTimes: number) => string[];
};

const noEntries = () => [];

/** Returns final text for values Node prints before its depth cut-off, else a layout. */
function describe(ctx: Context, value: object, ctor: string | null): string | Layout {
  if (Array.isArray(value)) {
    const keys = ownKeys(value, true);
    const head = ctor !== 'Array' ? prefix(ctor, 'Array', `(${value.length})`) : '';
    if (value.length === 0 && keys.length === 0) return `${head}[]`;
    return {
      base: '',
      braces: [`${head}[`, ']'],
      kind: 'array',
      keys,
      entries: (depth) => formatArrayLike(ctx, value, depth),
    };
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const typed = value as unknown as ArrayLike<unknown>;
    const keys = ownKeys(value, true);
    const head = prefix(ctor, 'TypedArray', `(${typed.length})`);
    if (typed.length === 0 && keys.length === 0) return `${head}[]`;
    return {
      base: '',
      braces: [`${head}[`, ']'],
      kind: 'array',
      keys,
      entries: () => {
        const shown = Math.min(MAX_ARRAY_LENGTH, typed.length);
        const output: string[] = [];
        for (let i = 0; i < shown; i += 1) output.push(formatPrimitive(typed[i]));
        if (typed.length > shown) output.push(remainingText(typed.length - shown));
        return output;
      },
    };
  }
  if (value instanceof Set || value instanceof Map) {
    const keys = ownKeys(value, false);
    const head = prefix(ctor, value instanceof Set ? 'Set' : 'Map', `(${value.size})`);
    if (value.size === 0 && keys.length === 0) return `${head}{}`;
    return {
      base: '',
      braces: [`${head}{`, '}'],
      kind: 'object',
      keys,
      entries: (depth) => {
        const output: string[] = [];
        ctx.indentationLvl += 2;
        let count = 0;
        for (const entry of value.entries()) {
          if (count >= MAX_ARRAY_LENGTH) break;
          output.push(
            value instanceof Set
              ? formatValue(ctx, entry[0], depth)
              : `${formatValue(ctx, entry[0], depth)} => ${formatValue(ctx, entry[1], depth)}`,
          );
          count += 1;
        }
        if (value.size > count) output.push(remainingText(value.size - count));
        ctx.indentationLvl -= 2;
        return output;
      },
    };
  }

  let keys = ownKeys(value, false);
  let base = '';
  let braces: [string, string] = ['{', '}'];
  if (typeof value === 'function') {
    base = functionBase(value as AnyFunction);
  } else if (value instanceof RegExp) {
    base = RegExp.prototype.toString.call(value);
  } else if (value instanceof Date) {
    const time = Date.prototype.getTime.call(value);
    base = Number.isNaN(time) ? 'Invalid Date' : Date.prototype.toISOString.call(value);
  } else if (value instanceof Error) {
    base = ctx.seen.length > 0 ? `[${errorText(value)}]` : errorText(value);
    keys = keys.filter((key) => key !== 'stack' && key !== 'message');
  } else if (value instanceof WeakMap || value instanceof WeakSet || value instanceof Promise) {
    const fallback =
      value instanceof WeakMap ? 'WeakMap' : value instanceof WeakSet ? 'WeakSet' : 'Promise';
    return `${prefix(ctor, fallback)}{ ${value instanceof Promise ? '<unknown>' : '<items unknown>'} }`;
  } else if (
    value instanceof Number ||
    value instanceof String ||
    value instanceof Boolean ||
    value instanceof BigInt ||
    value instanceof Symbol
  ) {
    const type =
      value instanceof Number
        ? 'Number'
        : value instanceof String
          ? 'String'
          : value instanceof Boolean
            ? 'Boolean'
            : value instanceof BigInt
              ? 'BigInt'
              : 'Symbol';
    const primitive = (value as { valueOf(): unknown }).valueOf();
    base = `[${type}${ctor !== type ? ` (${ctor ?? 'null prototype'})` : ''}: ${formatPrimitive(primitive)}]`;
    if (value instanceof String) keys = keys.filter((key) => !/^\d+$/.test(String(key)));
  } else if (ctor === 'Object') {
    if (keys.length === 0) return '{}';
  } else {
    const head = prefix(ctor, 'Object');
    if (keys.length === 0) return `${head}{}`;
    braces = [`${head}{`, '}'];
  }
  if (base && keys.length === 0) return base;
  return { base, braces, kind: 'object', keys, entries: noEntries };
}

function formatRaw(ctx: Context, value: object, recurseTimes: number): string {
  const ctor = constructorName(value);
  const layout = describe(ctx, value, ctor);
  if (typeof layout === 'string') return layout;
  if (recurseTimes > ctx.depth) {
    if (ctor === null)
      return Array.isArray(value) ? '[Array: null prototype]' : '[Object: null prototype]';
    return `[${ctor}]`;
  }
  recurseTimes += 1;
  ctx.seen.push(value);
  ctx.currentDepth = recurseTimes;
  const output = layout.entries(recurseTimes);
  for (const key of layout.keys) {
    output.push(formatProperty(ctx, value, recurseTimes, key, 'object'));
  }
  ctx.seen.pop();

  let base = layout.base;
  if (ctx.circular) {
    const index = ctx.circular.get(value);
    if (index !== undefined) {
      const reference = `<ref *${index}>`;
      base = base === '' ? reference : `${reference} ${base}`;
    }
  }
  return reduceToSingleString(ctx, output, base, layout.braces, layout.kind, recurseTimes, value);
}

function formatValue(ctx: Context, value: unknown, recurseTimes: number): string {
  if (typeof value !== 'object' && typeof value !== 'function') return formatPrimitive(value);
  if (value === null) return 'null';
  if (ctx.seen.includes(value)) {
    let index = 1;
    if (!ctx.circular) {
      ctx.circular = new Map([[value, index]]);
    } else {
      const existing = ctx.circular.get(value);
      if (existing === undefined) {
        index = ctx.circular.size + 1;
        ctx.circular.set(value, index);
      } else {
        index = existing;
      }
    }
    return `[Circular *${index}]`;
  }
  try {
    return formatRaw(ctx, value, recurseTimes);
  } catch {
    return '[Uninspectable]';
  }
}

/** `util.inspect` with Node's console defaults. */
export function inspect(value: unknown, depth = DEPTH): string {
  return formatValue(
    { seen: [], circular: undefined, indentationLvl: 0, currentDepth: 0, depth },
    value,
    0,
  );
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'undefined';
  } catch {
    return '[Circular]';
  }
}

/** `util.format`, as used by `console.log`. */
export function formatLogArgs(args: readonly unknown[]): string {
  const first = args[0];
  let index = 0;
  let text = '';
  let join = '';
  if (typeof first === 'string') {
    if (args.length === 1) return first;
    let lastPos = 0;
    for (let i = 0; i < first.length - 1; i += 1) {
      if (first[i] !== '%') continue;
      const next = first[++i];
      if (index + 1 !== args.length) {
        let replacement: string;
        switch (next) {
          case 's': {
            const arg = args[++index];
            if (typeof arg === 'number') replacement = formatNumber(arg);
            else if (typeof arg === 'bigint') replacement = `${arg}n`;
            else if (typeof arg !== 'object' || arg === null) replacement = String(arg);
            else replacement = inspect(arg, 0);
            break;
          }
          case 'j':
            replacement = stringify(args[++index]);
            break;
          case 'd': {
            const arg = args[++index];
            replacement =
              typeof arg === 'bigint'
                ? `${arg}n`
                : typeof arg === 'symbol'
                  ? 'NaN'
                  : formatNumber(Number(arg));
            break;
          }
          case 'O':
            replacement = inspect(args[++index]);
            break;
          case 'o':
            replacement = inspect(args[++index], 4);
            break;
          case 'i': {
            const arg = args[++index];
            replacement =
              typeof arg === 'bigint'
                ? `${arg}n`
                : typeof arg === 'symbol'
                  ? 'NaN'
                  : formatNumber(Number.parseInt(String(arg), 10));
            break;
          }
          case 'f': {
            const arg = args[++index];
            replacement =
              typeof arg === 'symbol' ? 'NaN' : formatNumber(Number.parseFloat(String(arg)));
            break;
          }
          case 'c':
            index += 1;
            replacement = '';
            break;
          case '%':
            text += first.slice(lastPos, i);
            lastPos = i + 1;
            continue;
          default:
            continue;
        }
        if (lastPos !== i - 1) text += first.slice(lastPos, i - 1);
        text += replacement;
        lastPos = i + 1;
      } else if (next === '%') {
        text += first.slice(lastPos, i);
        lastPos = i + 1;
      }
    }
    if (lastPos !== 0) {
      index += 1;
      join = ' ';
      if (lastPos < first.length) text += first.slice(lastPos);
    }
  }
  while (index < args.length) {
    const value = args[index];
    text += join;
    text += typeof value !== 'string' ? inspect(value) : value;
    join = ' ';
    index += 1;
  }
  return text;
}
