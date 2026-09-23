/**
 * Parser-based JavaScript instrumentation for the trace engine.
 *
 * The source is parsed with acorn, then trace calls are inserted as text edits
 * so the user's formatting and line numbers are preserved. The emitted program
 * reports to a runtime object (`__cv$`):
 *
 * - `t(line, getters)` before every executed statement and at the start of every
 *   loop iteration (Python-style "before execution" line events);
 * - `enter`/`exit` around every function body, with `x` recording exceptions
 *   that leave a frame and `r` recording return values;
 * - `c(error)` at the start of `catch` blocks so trace limits cannot be swallowed.
 *
 * Variables are read through getter closures (`() => name`) so block scoping,
 * shadowing and the temporal dead zone behave natively.
 */
import { parse } from 'acorn';
import type {
  AnyNode,
  ArrowFunctionExpression,
  CatchClause,
  Class,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  ModuleDeclaration,
  Node,
  Pattern,
  PrivateIdentifier,
  Program,
  Statement,
  StaticBlock,
  VariableDeclaration,
} from 'acorn';

export const TRACE_RUNTIME = '__cv$';
const HIDDEN_PREFIX = '__cv$';
const STRICT_PREFIX = '"use strict";';
const CAUGHT = `${TRACE_RUNTIME}e`;

export type JsSourceErrorKind = 'SyntaxError' | 'NotSupportedError' | 'LoadError';

/** A problem found before execution, with a 1-based source line. */
export class JsSourceError extends Error {
  constructor(
    readonly kind: JsSourceErrorKind,
    message: string,
    readonly line: number,
    readonly column: number | null = null,
  ) {
    super(message);
    this.name = kind;
  }
}

type FunctionNode = FunctionDeclaration | FunctionExpression | ArrowFunctionExpression;
type ListItem = Statement | ModuleDeclaration;
type Edit = { pos: number; text: string; rank: number; seq: number };
type Scope = { blocks: readonly (readonly string[])[] };

const TOP: Scope = { blocks: [] };

function withBlock(scope: Scope, names: readonly string[]): Scope {
  return names.length ? { blocks: [...scope.blocks, names] } : scope;
}

function isNode(value: unknown): value is AnyNode {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Node).type === 'string' &&
    typeof (value as Node).start === 'number'
  );
}

function isFunction(node: unknown): node is FunctionNode {
  return (
    isNode(node) &&
    (node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression')
  );
}

function lineOf(node: Node): number {
  return node.loc!.start.line;
}

function patternNames(node: Pattern | null | undefined, out: string[] = []): string[] {
  if (!node) return out;
  switch (node.type) {
    case 'Identifier':
      out.push(node.name);
      break;
    case 'ObjectPattern':
      for (const property of node.properties) {
        patternNames(property.type === 'RestElement' ? property.argument : property.value, out);
      }
      break;
    case 'ArrayPattern':
      for (const element of node.elements) patternNames(element, out);
      break;
    case 'AssignmentPattern':
      patternNames(node.left, out);
      break;
    case 'RestElement':
      patternNames(node.argument, out);
      break;
    default:
      break;
  }
  return out;
}

function declarationNames(node: VariableDeclaration): string[] {
  return node.declarations.flatMap((declarator) => patternNames(declarator.id));
}

/** let/const/class/function bindings created directly by a statement list. */
function lexicalNames(statements: readonly ListItem[]): string[] {
  const names: string[] = [];
  for (const statement of statements) {
    if (statement.type === 'VariableDeclaration' && statement.kind !== 'var') {
      names.push(...declarationNames(statement));
    } else if (
      (statement.type === 'ClassDeclaration' || statement.type === 'FunctionDeclaration') &&
      statement.id
    ) {
      names.push(statement.id.name);
    }
  }
  return names;
}

/** `var` bindings hoisted to the nearest function (or static block) scope. */
function varNames(node: AnyNode | null | undefined, out: string[] = []): string[] {
  if (!node) return out;
  switch (node.type) {
    case 'VariableDeclaration':
      if (node.kind === 'var') out.push(...declarationNames(node));
      break;
    case 'Program':
    case 'BlockStatement':
    case 'StaticBlock':
      for (const statement of node.body) varNames(statement, out);
      break;
    case 'IfStatement':
      varNames(node.consequent, out);
      varNames(node.alternate, out);
      break;
    case 'ForStatement':
      varNames(node.init, out);
      varNames(node.body, out);
      break;
    case 'ForInStatement':
    case 'ForOfStatement':
      varNames(node.left, out);
      varNames(node.body, out);
      break;
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'LabeledStatement':
      varNames(node.body, out);
      break;
    case 'SwitchStatement':
      for (const branch of node.cases) branch.consequent.forEach((item) => varNames(item, out));
      break;
    case 'TryStatement':
      varNames(node.block, out);
      varNames(node.handler?.body, out);
      varNames(node.finalizer, out);
      break;
    default:
      break;
  }
  return out;
}

function unique(names: readonly string[]): string[] {
  return [...new Set(names)].filter((name) => !name.startsWith(HIDDEN_PREFIX));
}

function getters(names: readonly string[]): string {
  const list = unique(names);
  return `[${list.map((name) => `[${JSON.stringify(name)},()=>${name}]`).join(',')}]`;
}

function propertyName(key: Expression | PrivateIdentifier, computed: boolean): string {
  if (computed) return '<computed>';
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'PrivateIdentifier') return `#${key.name}`;
  if (key.type === 'Literal') return String(key.value);
  return '<computed>';
}

function unsupported(node: Node, what: string): JsSourceError {
  return new JsSourceError(
    'NotSupportedError',
    `${what} ${what.endsWith('s') ? 'are' : 'is'} not supported by the JavaScript tracer yet.`,
    lineOf(node),
    node.loc!.start.column,
  );
}

class Instrumenter {
  private readonly edits: Edit[] = [];
  private seq = 0;

  constructor(private readonly offset: number) {}

  /** Opening text: outer constructs first at a shared position. */
  private open(pos: number, depth: number, text: string) {
    this.edits.push({ pos: pos - this.offset, text, rank: 1_000_000 + depth, seq: this.seq++ });
  }

  /** Closing text: inner constructs first at a shared position. */
  private close(pos: number, depth: number, text: string) {
    this.edits.push({ pos: pos - this.offset, text, rank: -depth, seq: this.seq++ });
  }

  apply(source: string): string {
    const edits = [...this.edits].sort((a, b) => a.pos - b.pos || a.rank - b.rank || a.seq - b.seq);
    let output = '';
    let cursor = 0;
    for (const edit of edits) {
      output += source.slice(cursor, edit.pos) + edit.text;
      cursor = edit.pos;
    }
    return output + source.slice(cursor);
  }

  private trace(line: number, scope: Scope): string {
    return `${TRACE_RUNTIME}.t(${line},${getters(scope.blocks.flat())});`;
  }

  program(program: Program) {
    const body = program.body.filter((statement) => statement.start >= this.offset);
    const names = [...varNames(program), ...lexicalNames(body)];
    this.open(this.offset, 0, `${TRACE_RUNTIME}.enter("<module>","<module>",1,${getters(names)});`);
    this.statements(body, TOP, 1);
  }

  /**
   * Traces each statement in a list. `headerLine` is the line of an enclosing
   * `if`/loop header that was just traced; a first statement on that same line
   * is not traced again, so one-line bodies produce one step.
   */
  private statements(list: readonly ListItem[], scope: Scope, depth: number, headerLine?: number) {
    let first = true;
    for (const statement of list) {
      if (statement.start < this.offset) continue;
      const directive =
        statement.type === 'ExpressionStatement' && statement.directive !== undefined;
      const traced =
        statement.type !== 'FunctionDeclaration' &&
        statement.type !== 'EmptyStatement' &&
        !directive;
      if (traced && !(first && lineOf(statement) === headerLine)) {
        this.open(statement.start, depth, this.trace(lineOf(statement), scope));
      }
      if (traced) first = false;
      this.statement(statement, scope, depth + 1);
    }
  }

  /** A statement in a non-list position, such as an unbraced `if` or loop body. */
  private body(
    statement: Statement,
    scope: Scope,
    depth: number,
    headerLine: number,
    loop = false,
  ) {
    const iteration = loop ? this.trace(headerLine, scope) : '';
    if (statement.type === 'BlockStatement') {
      if (iteration) this.open(statement.start + 1, depth, iteration);
      this.statements(
        statement.body,
        withBlock(scope, lexicalNames(statement.body)),
        depth + 1,
        headerLine,
      );
      return;
    }
    const own =
      statement.type === 'EmptyStatement' || lineOf(statement) === headerLine
        ? ''
        : this.trace(lineOf(statement), scope);
    this.open(statement.start, depth, `{${iteration}${own}`);
    this.statement(statement, scope, depth + 1);
    this.close(statement.end, depth, '}');
  }

  private statement(statement: ListItem, scope: Scope, depth: number): void {
    switch (statement.type) {
      case 'BlockStatement':
        this.statements(statement.body, withBlock(scope, lexicalNames(statement.body)), depth);
        return;
      case 'IfStatement':
        this.node(statement.test, scope, depth);
        this.body(statement.consequent, scope, depth, lineOf(statement));
        if (statement.alternate) this.body(statement.alternate, scope, depth, lineOf(statement));
        return;
      case 'ForStatement': {
        const init = statement.init;
        const loop =
          init?.type === 'VariableDeclaration' && init.kind !== 'var'
            ? withBlock(scope, declarationNames(init))
            : scope;
        this.node(init, loop, depth);
        this.node(statement.test, loop, depth);
        this.node(statement.update, loop, depth);
        this.body(statement.body, loop, depth, lineOf(statement), true);
        return;
      }
      case 'ForInStatement':
      case 'ForOfStatement': {
        if (statement.type === 'ForOfStatement' && statement.await) {
          throw unsupported(statement, 'for await loops');
        }
        const left = statement.left;
        const loop =
          left.type === 'VariableDeclaration' && left.kind !== 'var'
            ? withBlock(scope, declarationNames(left))
            : scope;
        this.node(left, loop, depth);
        this.node(statement.right, scope, depth);
        this.body(statement.body, loop, depth, lineOf(statement), true);
        return;
      }
      case 'WhileStatement':
        this.node(statement.test, scope, depth);
        this.body(statement.body, scope, depth, lineOf(statement), true);
        return;
      case 'DoWhileStatement':
        this.body(statement.body, scope, depth, lineOf(statement), true);
        this.node(statement.test, scope, depth);
        return;
      case 'LabeledStatement':
        // Loops keep their label directly; wrapping them would break `continue label`.
        this.statement(statement.body, scope, depth);
        return;
      case 'SwitchStatement': {
        this.node(statement.discriminant, scope, depth);
        const inner = withBlock(
          scope,
          lexicalNames(statement.cases.flatMap((branch) => branch.consequent)),
        );
        for (const branch of statement.cases) {
          this.node(branch.test, scope, depth);
          this.statements(branch.consequent, inner, depth + 1);
        }
        return;
      }
      case 'TryStatement':
        this.statement(statement.block, scope, depth);
        if (statement.handler) this.catchClause(statement.handler, scope, depth);
        if (statement.finalizer) this.statement(statement.finalizer, scope, depth);
        return;
      case 'ReturnStatement': {
        const where = `${lineOf(statement)},${getters(scope.blocks.flat())}`;
        if (statement.argument) {
          this.open(statement.argument.start, depth, `${TRACE_RUNTIME}.r(${where},`);
          this.node(statement.argument, scope, depth + 1);
          this.close(statement.argument.end, depth, ')');
        } else {
          this.open(
            statement.start + 'return'.length,
            depth,
            ` ${TRACE_RUNTIME}.r(${where},void 0)`,
          );
        }
        return;
      }
      case 'FunctionDeclaration':
        this.fn(statement, statement.id.name, statement.id.name, depth, false);
        return;
      case 'ClassDeclaration':
        this.cls(statement, scope, depth, statement.id.name);
        return;
      case 'WithStatement':
        throw unsupported(statement, '`with` statements');
      case 'ImportDeclaration':
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration':
      case 'ExportAllDeclaration':
        throw unsupported(statement, 'Modules (import/export)');
      default:
        this.children(statement, scope, depth);
    }
  }

  private catchClause(handler: CatchClause, scope: Scope, depth: number) {
    const names = [...patternNames(handler.param), ...lexicalNames(handler.body.body)];
    const inner = withBlock(scope, names);
    let caught: string | null = null;
    if (!handler.param) {
      this.open(handler.body.start, depth, `(${CAUGHT})`);
      caught = CAUGHT;
    } else if (handler.param.type === 'Identifier') {
      caught = handler.param.name;
    }
    this.node(handler.param, inner, depth);
    // Destructured catch parameters rely on the runtime's sticky stop instead.
    if (caught) this.open(handler.body.start + 1, depth, `${TRACE_RUNTIME}.c(${caught});`);
    this.statements(handler.body.body, inner, depth + 1);
  }

  private fn(node: FunctionNode, func: string, qualname: string, depth: number, method: boolean) {
    if (node.async) throw unsupported(node, 'Async functions');
    if (node.generator) throw unsupported(node, 'Generator functions');
    const body = node.body;
    const names = [
      ...(method ? ['this'] : []),
      ...node.params.flatMap((param) => patternNames(param)),
      ...(body.type === 'BlockStatement' ? [...varNames(body), ...lexicalNames(body.body)] : []),
    ];
    for (const param of node.params) this.node(param, TOP, depth + 1);
    const enter = `${TRACE_RUNTIME}.enter(${JSON.stringify(func)},${JSON.stringify(qualname)},${lineOf(node)},${getters(names)});`;
    const handler = `catch(${CAUGHT}){${TRACE_RUNTIME}.x(${CAUGHT});throw ${CAUGHT};}finally{${TRACE_RUNTIME}.exit(${node.loc!.end.line});}`;
    if (body.type === 'BlockStatement') {
      if (body.body.length === 0) {
        this.open(body.start + 1, depth, `try{${enter}}${handler}`);
        return;
      }
      this.open(body.start + 1, depth, `try{${enter}`);
      this.statements(body.body, TOP, depth + 1);
      this.close(body.end - 1, depth, `}${handler}`);
      return;
    }
    this.open(body.start, depth, `{try{${enter}return ${TRACE_RUNTIME}.r(${lineOf(body)},[],`);
    this.node(body, TOP, depth + 1);
    this.close(body.end, depth, `);}${handler}}`);
  }

  private cls(node: Class, scope: Scope, depth: number, inferred?: string) {
    const className = node.id?.name ?? inferred ?? '<anonymous class>';
    this.node(node.superClass, scope, depth);
    for (const element of node.body.body) {
      if (element.type === 'StaticBlock') {
        this.staticBlock(element, scope, depth + 1);
        continue;
      }
      if (element.computed) this.node(element.key, scope, depth);
      const key = propertyName(element.key, element.computed);
      if (element.type === 'MethodDefinition') {
        const func = element.kind === 'constructor' ? 'constructor' : key;
        this.fn(element.value, func, `${className}.${func}`, depth + 1, true);
      } else if (isFunction(element.value)) {
        const method = element.value.type !== 'ArrowFunctionExpression';
        this.fn(element.value, key, `${className}.${key}`, depth + 1, method);
      } else {
        this.node(element.value, scope, depth + 1);
      }
    }
  }

  private staticBlock(block: StaticBlock, scope: Scope, depth: number) {
    const names = [...varNames(block), ...lexicalNames(block.body)];
    this.statements(block.body, withBlock(scope, names), depth);
  }

  private children(node: AnyNode, scope: Scope, depth: number) {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'type' || key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) this.node(item, scope, depth);
      } else if (isNode(value)) {
        this.node(value, scope, depth);
      }
    }
  }

  private node(node: AnyNode | null | undefined, scope: Scope, depth: number, name?: string) {
    if (!node) return;
    switch (node.type) {
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        const func = (node.type === 'FunctionExpression' && node.id?.name) || name || '<anonymous>';
        this.fn(node, func, func, depth, false);
        return;
      }
      case 'ClassExpression':
        this.cls(node, scope, depth, name);
        return;
      case 'AwaitExpression':
        throw unsupported(node, '`await`');
      case 'YieldExpression':
        throw unsupported(node, '`yield`');
      case 'ImportExpression':
        throw unsupported(node, 'Dynamic `import()`');
      case 'MetaProperty':
        if (node.meta.name === 'import') throw unsupported(node, '`import.meta`');
        return;
      case 'Identifier':
        if (node.name.startsWith(HIDDEN_PREFIX)) {
          throw new JsSourceError(
            'NotSupportedError',
            `Names starting with ${HIDDEN_PREFIX} are reserved by the tracer.`,
            lineOf(node),
            node.loc!.start.column,
          );
        }
        return;
      case 'VariableDeclarator':
        this.node(node.id, scope, depth);
        this.node(
          node.init,
          scope,
          depth,
          node.id.type === 'Identifier' ? node.id.name : undefined,
        );
        return;
      case 'AssignmentExpression': {
        const target = node.left;
        const inferred =
          target.type === 'Identifier'
            ? target.name
            : target.type === 'MemberExpression' && !target.computed
              ? propertyName(target.property, false)
              : undefined;
        this.node(target, scope, depth);
        this.node(node.right, scope, depth, inferred);
        return;
      }
      case 'AssignmentPattern':
        this.node(node.left, scope, depth);
        this.node(
          node.right,
          scope,
          depth,
          node.left.type === 'Identifier' ? node.left.name : undefined,
        );
        return;
      case 'Property': {
        if (node.computed) this.node(node.key, scope, depth);
        const key = propertyName(node.key, node.computed);
        if (isFunction(node.value)) {
          const method =
            node.value.type !== 'ArrowFunctionExpression' && (node.method || node.kind !== 'init');
          this.fn(node.value, key, key, depth, method);
        } else {
          this.node(node.value, scope, depth, key);
        }
        return;
      }
      default:
        if (
          node.type.endsWith('Statement') ||
          node.type.endsWith('Declaration') ||
          node.type === 'VariableDeclaration'
        ) {
          this.statement(node as Statement, scope, depth);
          return;
        }
        this.children(node, scope, depth);
    }
  }
}

function sourceError(error: unknown): JsSourceError {
  const loc = (error as { loc?: { line: number; column: number } }).loc;
  const line = loc?.line ?? 1;
  const column = loc ? (line === 1 ? loc.column - STRICT_PREFIX.length : loc.column) : null;
  const message = String((error as Error).message ?? error).replace(/\s*\(\d+:\d+\)$/, '');
  if (/may appear only with 'sourceType: module'/.test(message)) {
    return new JsSourceError(
      'NotSupportedError',
      'Modules (import/export) are not supported by the JavaScript tracer yet; paste a single script.',
      line,
      column,
    );
  }
  if (/Unexpected character '@'/.test(message)) {
    return new JsSourceError(
      'NotSupportedError',
      'Decorators are not supported by the tracer yet.',
      line,
      column,
    );
  }
  if (/'await'/.test(message)) {
    return new JsSourceError(
      'NotSupportedError',
      '`await` is not supported by the JavaScript tracer yet.',
      line,
      column,
    );
  }
  return new JsSourceError('SyntaxError', message, line, column);
}

/**
 * Parses strict-mode script source and returns the body for
 * `new Function('console', TRACE_RUNTIME, body)`.
 */
export function instrumentScript(source: string): string {
  const normalized = source.replace(/\r\n?/g, '\n');
  let program: Program;
  try {
    program = parse(STRICT_PREFIX + normalized, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
      preserveParens: true,
      // Parse top-level `await` so it is reported as unsupported, not as a typo.
      allowAwaitOutsideFunction: true,
    });
  } catch (error) {
    throw sourceError(error);
  }
  const instrumenter = new Instrumenter(STRICT_PREFIX.length);
  instrumenter.program(program);
  // The block lets user code shadow `console` and keeps the runtime parameter private.
  return `"use strict";{${instrumenter.apply(normalized)}\n}`;
}
