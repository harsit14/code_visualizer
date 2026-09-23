import { constructorName } from './jsInspect';
import type { EncodedValue } from './types';

const MAX_ITEMS = 24;
const MAX_STRING = 160;
const MAX_DEPTH = 4;
const MAX_TREE_DEPTH = 8;
const MAX_CHAIN_NODES = 24;
const MAX_SNAPSHOT_NODES = 200_000;

export class TraceLimitError extends Error {}

type Descriptors = Record<string, PropertyDescriptor>;

/** Own data properties only; accessors are never invoked. */
function ownDataValue(descriptors: Descriptors, key: string): unknown {
  const descriptor = descriptors[key];
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function hasOwnData(descriptors: Descriptors, key: string): boolean {
  const descriptor = descriptors[key];
  return !!descriptor && 'value' in descriptor;
}

function looksLikeTree(descriptors: Descriptors): boolean {
  return (
    hasOwnData(descriptors, 'val') &&
    hasOwnData(descriptors, 'left') &&
    hasOwnData(descriptors, 'right')
  );
}

function looksLikeListNode(descriptors: Descriptors): boolean {
  return (
    hasOwnData(descriptors, 'val') &&
    hasOwnData(descriptors, 'next') &&
    !hasOwnData(descriptors, 'left')
  );
}

function descriptorsOf(value: object): Descriptors {
  return Object.getOwnPropertyDescriptors(value) as Descriptors;
}

function describeError(value: object): string {
  const descriptors = descriptorsOf(value);
  let name = ownDataValue(descriptors, 'name');
  for (let proto = Object.getPrototypeOf(value); typeof name !== 'string' && proto; ) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'name');
    if (descriptor && 'value' in descriptor) name = descriptor.value;
    proto = Object.getPrototypeOf(proto);
  }
  const message = ownDataValue(descriptors, 'message');
  const label = typeof name === 'string' ? name : 'Error';
  return typeof message === 'string' && message ? `${label}: ${message}` : label;
}

/**
 * Encodes JavaScript values into the trace dialect shared with the Python engine.
 * Object ids are stable across the whole run so the UI can follow identity.
 */
export class Snapshotter {
  private ids = new WeakMap<object, number>();
  private nextId = 1;
  private nodes = 0;

  private idFor(value: object): number {
    const existing = this.ids.get(value);
    if (existing !== undefined) return existing;
    const id = this.nextId++;
    this.ids.set(value, id);
    return id;
  }

  private count() {
    if (++this.nodes > MAX_SNAPSHOT_NODES) {
      throw new TraceLimitError('Snapshot size limit reached; execution was stopped.');
    }
  }

  snapshot(value: unknown, depth = 0, active: ReadonlySet<object> = new Set()): EncodedValue {
    this.count();
    if (value === null || value === undefined) {
      return { k: 'repr', t: value === null ? 'null' : 'undefined', v: String(value) };
    }
    switch (typeof value) {
      case 'number':
        return { k: 'num', t: 'number', v: Object.is(value, -0) ? '-0' : String(value) };
      case 'bigint':
        return { k: 'num', t: 'bigint', v: value.toString() };
      case 'boolean':
        return { k: 'repr', t: 'boolean', v: String(value) };
      case 'string':
        return {
          k: 'str',
          v: value.slice(0, MAX_STRING),
          len: value.length,
          truncated: value.length > MAX_STRING,
        };
      case 'symbol':
        return { k: 'repr', t: 'symbol', v: value.toString() };
      case 'function':
        return {
          k: 'func',
          name: (value as { name?: unknown }).name ? String(value.name) : 'anonymous',
        };
      default:
        break;
    }
    const object = value as object;
    const id = this.idFor(object);
    if (active.has(object)) return { k: 'ref', id };
    try {
      return this.snapshotObject(object, id, depth, new Set([...active, object]));
    } catch (error) {
      if (error instanceof TraceLimitError) throw error;
      return { k: 'repr', t: 'Object', v: '[unavailable]', id };
    }
  }

  private snapshotObject(
    value: object,
    id: number,
    depth: number,
    active: ReadonlySet<object>,
  ): EncodedValue {
    const type = constructorName(value) ?? 'Object';
    if (value instanceof Date) {
      const time = Date.prototype.getTime.call(value);
      return {
        k: 'repr',
        t: 'Date',
        v: Number.isNaN(time) ? 'Invalid Date' : Date.prototype.toISOString.call(value),
        id,
      };
    }
    if (value instanceof RegExp) {
      return { k: 'repr', t: 'RegExp', v: RegExp.prototype.toString.call(value), id };
    }
    if (value instanceof Error) return { k: 'repr', t: type, v: describeError(value), id };
    if (value instanceof WeakMap || value instanceof WeakSet || value instanceof Promise) {
      return { k: 'repr', t: type, v: `${type} {…}`, id };
    }
    if (depth >= MAX_DEPTH) return { k: 'repr', t: type, v: `[${type}]`, id };

    if (Array.isArray(value)) {
      return {
        k: 'seq',
        t: 'Array',
        id,
        items: Array.from({ length: Math.min(value.length, MAX_ITEMS) }, (_, index) => {
          const descriptor = Object.getOwnPropertyDescriptor(value, index);
          return this.snapshot(
            descriptor && 'value' in descriptor ? descriptor.value : undefined,
            depth + 1,
            active,
          );
        }),
        len: value.length,
        truncated: value.length > MAX_ITEMS,
      };
    }
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
      const typed = value as unknown as ArrayLike<number | bigint>;
      return {
        k: 'seq',
        t: type,
        id,
        items: Array.from({ length: Math.min(typed.length, MAX_ITEMS) }, (_, index) =>
          this.snapshot(typed[index], depth + 1, active),
        ),
        len: typed.length,
        truncated: typed.length > MAX_ITEMS,
      };
    }
    if (value instanceof Set) {
      const items: EncodedValue[] = [];
      for (const item of value) {
        if (items.length >= MAX_ITEMS) break;
        items.push(this.snapshot(item, depth + 1, active));
      }
      return { k: 'seq', t: 'Set', id, items, len: value.size, truncated: value.size > MAX_ITEMS };
    }
    if (value instanceof Map) {
      const entries: [EncodedValue, EncodedValue][] = [];
      for (const [key, item] of value) {
        if (entries.length >= MAX_ITEMS) break;
        entries.push([
          this.snapshot(key, depth + 1, active),
          this.snapshot(item, depth + 1, active),
        ]);
      }
      return {
        k: 'dict',
        id,
        t: 'Map',
        entries,
        len: value.size,
        truncated: value.size > MAX_ITEMS,
      };
    }

    const descriptors = descriptorsOf(value);
    if (looksLikeTree(descriptors)) return this.snapshotTree(value, id, depth, active, descriptors);
    if (looksLikeListNode(descriptors)) return this.snapshotChain(value, id, depth, active);

    const attrs: Record<string, EncodedValue> = {};
    for (const [key, descriptor] of Object.entries(descriptors).slice(0, MAX_ITEMS)) {
      attrs[key] =
        'value' in descriptor
          ? this.snapshot(descriptor.value, depth + 1, active)
          : { k: 'repr', t: 'accessor', v: '[Getter/Setter]' };
    }
    return { k: 'obj', id, t: type, attrs, preview: type === 'Object' ? '{...}' : `${type} {...}` };
  }

  private snapshotTree(
    node: object,
    id: number,
    depth: number,
    active: ReadonlySet<object>,
    descriptors: Descriptors,
  ): EncodedValue {
    if (depth >= MAX_TREE_DEPTH) {
      return { k: 'repr', t: constructorName(node) ?? 'Object', v: '[TreeNode]', id };
    }
    const child = (value: unknown): EncodedValue | null => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'object' && active.has(value))
        return { k: 'ref', id: this.idFor(value) };
      return this.snapshot(value, depth + 1, active);
    };
    return {
      k: 'tree',
      id,
      val: this.snapshot(ownDataValue(descriptors, 'val'), depth + 1, active),
      left: child(ownDataValue(descriptors, 'left')),
      right: child(ownDataValue(descriptors, 'right')),
    };
  }

  private snapshotChain(
    head: object,
    id: number,
    depth: number,
    active: ReadonlySet<object>,
  ): EncodedValue {
    const nodes: { id: number; val: EncodedValue }[] = [];
    const walked = new Set<object>();
    const seen = new Set(active);
    let cyclic = false;
    let truncated = false;
    let node: unknown = head;
    while (node !== null && node !== undefined && typeof node === 'object') {
      const descriptors = descriptorsOf(node);
      if (!looksLikeListNode(descriptors)) break;
      if (walked.has(node)) {
        cyclic = true;
        break;
      }
      if (nodes.length >= MAX_CHAIN_NODES) {
        truncated = true;
        break;
      }
      this.count();
      walked.add(node);
      seen.add(node);
      nodes.push({
        id: this.idFor(node),
        val: this.snapshot(ownDataValue(descriptors, 'val'), depth + 1, seen),
      });
      node = ownDataValue(descriptors, 'next');
    }
    return { k: 'listnode', id, nodes, cyclic, truncated };
  }
}
