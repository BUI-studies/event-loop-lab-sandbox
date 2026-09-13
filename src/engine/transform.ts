import { parse } from 'acorn';
import { ancestor } from 'acorn-walk';
import type {
  AnyNode,
  ArrowFunctionExpression,
  FunctionDeclaration,
  FunctionExpression,
  Node,
  Program,
} from 'acorn';
import { msg, type Msg } from '../i18n';
import type { RunAsync, RunTopLevel } from './async-driver';
import type { VPromiseClass } from './vm-promise';
import type { WebApis } from './web-apis';

/** Everything user code sees in place of the real globals. */
export type SandboxGlobals = WebApis & {
  Promise: VPromiseClass;
  __asyncFn: RunAsync;
  __runTopLevel: RunTopLevel;
  __line: (line: number) => void;
};

export interface CompiledScript {
  readonly run: (globals: SandboxGlobals) => void;
}

export interface CompileError {
  /** Already translated at render time: this is a message descriptor. */
  readonly text: Msg;
}

export type CompileResult =
  | { readonly ok: true; readonly script: CompiledScript }
  | { readonly ok: false; readonly error: CompileError };

const SANDBOX_PARAM = '__sandbox';

const SANDBOX_NAMES = [
  'Promise',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'fetch',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'console',
  '__asyncFn',
  '__runTopLevel',
  '__line',
] as const;

const SANDBOX_PRELUDE = `const { ${SANDBOX_NAMES.join(', ')} } = ${SANDBOX_PARAM};\n`;

const ASYNC = 'async';
const AWAIT = 'await';
const FUNCTION = 'function';

/* ------------------------------------------------------------------ *
 * Edits
 *
 * Every rewrite is recorded against the ORIGINAL source and applied
 * right-to-left, so offsets collected during the walk stay valid. Generated
 * columns drift, which costs nothing: line highlighting reads the explicit
 * `__line(n)` argument captured from the AST, never a generated position.
 * ------------------------------------------------------------------ */

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /**
   * Left-to-right position among insertions sharing an offset, lowest first.
   * A concise arrow body ends exactly where its function ends, so the body's
   * closing brace and the wrapper's closing paren both land on that offset and
   * their order is the difference between `x }, "f", this)` and `x, "f", this) }`.
   */
  readonly order?: number;
}

const applyEdits = (source: string, edits: readonly Edit[]): string =>
  [...edits]
    // Right to left, so offsets collected during the walk stay valid. Among
    // ties the rightmost output goes first, since each application pushes
    // previously applied text further right.
    .sort((a, b) => b.start - a.start || b.end - a.end || (b.order ?? 0) - (a.order ?? 0))
    .reduce((out, edit) => out.slice(0, edit.start) + edit.text + out.slice(edit.end), source);

/* ------------------------------------------------------------------ *
 * Transform
 * ------------------------------------------------------------------ */

type AsyncFunctionNode = FunctionDeclaration | FunctionExpression | ArrowFunctionExpression;

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

const parentOf = (ancestors: readonly Node[]): Node | undefined =>
  ancestors[ancestors.length - 2];

const lineOf = (node: Node): number => node.loc?.start.line ?? 0;

/** The name shown on the heap and the call stack for a paused function. */
const inferName = (node: AsyncFunctionNode, ancestors: readonly Node[]): string => {
  if (node.type !== 'ArrowFunctionExpression' && node.id) return node.id.name;

  const parent = parentOf(ancestors) as AnyNode | undefined;
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  if (parent?.type === 'Property' && parent.key.type === 'Identifier') return parent.key.name;
  if (parent?.type === 'AssignmentExpression' && parent.left.type === 'Identifier') {
    return parent.left.name;
  }
  return 'async';
};

interface TransformOk {
  readonly ok: true;
  readonly code: string;
}

type TransformResult = TransformOk | { readonly ok: false; readonly error: CompileError };

const transform = (source: string, program: Program): TransformResult => {
  const edits: Edit[] = [];
  /** Hoisted `var f = __asyncFn(...)` lines, keyed by the offset they belong at. */
  const preludes = new Map<number, string[]>();
  let refusal: CompileError | null = null;
  let topLevelAwait = false;

  const refuse = (what: Msg, node: Node): void => {
    refusal ??= { text: msg('iUnsupported', { line: lineOf(node), what }) };
  };

  const insert = (at: number, text: string, order = 0): void => {
    edits.push({ start: at, end: at, text, order });
  };

  /** Marks statements only in real statement-list positions. */
  const markStatements = (body: readonly Node[]): void => {
    for (const statement of body) {
      const line = lineOf(statement);
      if (line > 0) insert(statement.start, `__line(${line});`);
    }
  };

  /**
   * Async declarations keep their hoisting by putting the wrapper binding at
   * the top of the scope that contains them, which is where the engine would
   * have hoisted the declaration itself.
   */
  const addPrelude = (ancestors: readonly Node[], line: string): void => {
    for (let i = ancestors.length - 2; i >= 0; i -= 1) {
      const node = ancestors[i] as AnyNode | undefined;
      if (node?.type !== 'BlockStatement' && node?.type !== 'Program') continue;
      const at = node.type === 'Program' ? 0 : node.start + 1;
      preludes.set(at, [...(preludes.get(at) ?? []), line]);
      return;
    }
  };

  /** Order 1 keeps the wrapper outside anything the body inserts at the same offset. */
  const wrap = (node: AsyncFunctionNode, name: string): void => {
    insert(node.start, '__asyncFn(');
    insert(node.end, `, ${JSON.stringify(name)}, this)`, 1);
  };

  ancestor(program, {
    Program: (node) => markStatements(node.body),
    BlockStatement: (node) => markStatements(node.body),
    SwitchCase: (node) => markStatements(node.consequent),

    AwaitExpression(node, _state, ancestors) {
      edits.push({ start: node.start, end: node.start + AWAIT.length, text: 'yield' });
      const inFunction = ancestors
        .slice(0, -1)
        .some((ancestor_) => FUNCTION_TYPES.has(ancestor_.type));
      if (!inFunction) topLevelAwait = true;
    },

    FunctionDeclaration(node, _state, ancestors) {
      if (!node.async || !node.id) return;
      const id = node.id;
      const name = id.name;
      const keyword = source.indexOf(FUNCTION, node.start);

      edits.push({ start: node.start, end: node.start + ASYNC.length, text: '' });
      insert(keyword + FUNCTION.length, '*');
      edits.push({ start: id.start, end: id.end, text: `${name}__gen` });
      addPrelude(ancestors, `var ${name} = __asyncFn(${name}__gen, ${JSON.stringify(name)});`);
    },

    FunctionExpression(node, _state, ancestors) {
      if (!node.async) return;

      // Method shorthand is rewritten by the Property visitor, which owns the
      // key as well as the function.
      const parent = parentOf(ancestors) as AnyNode | undefined;
      if (parent?.type === 'MethodDefinition') return;
      if (parent?.type === 'Property' && parent.method) return;

      const keyword = source.indexOf(FUNCTION, node.start);
      edits.push({ start: node.start, end: node.start + ASYNC.length, text: '' });
      insert(keyword + FUNCTION.length, '*');
      wrap(node, inferName(node, ancestors));
    },

    ArrowFunctionExpression(node, _state, ancestors) {
      if (!node.async) return;

      const first = node.params[0];
      const parenthesised = !first || source.slice(node.start + ASYNC.length, first.start).includes('(');

      edits.push({
        start: node.start,
        end: node.start + ASYNC.length,
        text: parenthesised ? 'function*' : 'function* (',
      });
      if (!parenthesised && first) insert(first.end, ')');

      const arrow = source.lastIndexOf('=>', node.body.start);
      edits.push({ start: arrow, end: arrow + 2, text: '' });

      // A concise body is an expression, and a generator needs a statement.
      if (node.body.type !== 'BlockStatement') {
        insert(node.body.start, '{ return ');
        insert(node.body.end, ' }');
      }

      wrap(node, inferName(node, ancestors));
    },

    Property(node) {
      if (!node.method || node.value.type !== 'FunctionExpression' || !node.value.async) return;
      if (node.computed || node.value.generator) {
        refuse(msg('iComputedMethod'), node);
        return;
      }
      // A shorthand method's function node starts at its parameter list. If a
      // future parser says otherwise, refuse rather than emit broken code.
      if (source[node.value.start] !== '(') {
        refuse(msg('iComputedMethod'), node);
        return;
      }

      const name = node.key.type === 'Identifier' ? node.key.name : 'method';
      edits.push({ start: node.start, end: node.key.start, text: '' });
      insert(node.key.end, ': __asyncFn(function* ');
      insert(node.end, `, ${JSON.stringify(name)}, this)`);
    },

    MethodDefinition(node) {
      if (node.value.async) refuse(msg('iClassMethod'), node);
    },
  });

  if (refusal) return { ok: false, error: refusal };

  for (const [at, lines] of preludes) insert(at, lines.join(''));

  const body = applyEdits(source, edits);

  // Wrapping only when needed keeps an ordinary script a plain script task.
  // The trailing newline is safe: appending at the very end shifts no line.
  return {
    ok: true,
    code: topLevelAwait ? `__runTopLevel(function* () {${body}\n})` : body,
  };
};

/* ------------------------------------------------------------------ *
 * Compilation
 * ------------------------------------------------------------------ */

interface LocatedError {
  loc?: { line: number; column: number };
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const toCompileError = (error: unknown): CompileError => {
  const loc = (error as LocatedError).loc;
  // Acorn appends "(line:column)" to the message; the line is rendered separately.
  const message = describe(error).replace(/\s*\(\d+:\d+\)\s*$/, '');
  return {
    text: loc ? msg('iSyntaxError', { line: loc.line, message }) : msg('iCompileError', { message }),
  };
};

const build = (code: string): CompiledScript['run'] =>
  new Function(SANDBOX_PARAM, SANDBOX_PRELUDE + code) as CompiledScript['run'];

/**
 * Turns user source into a callable that receives the sandbox globals as one
 * object, so their names cannot drift out of sync with the call site.
 *
 * Nothing here throws. A typo, an unsupported construct, or a bug in our own
 * code generation all come back as an error the UI can show on the right line.
 */
export const compile = (source: string): CompileResult => {
  let program: Program;
  try {
    program = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      locations: true,
    });
  } catch (error) {
    return { ok: false, error: toCompileError(error) };
  }

  const transformed = transform(source, program);
  if (!transformed.ok) return transformed;

  try {
    return { ok: true, script: { run: build(transformed.code) } };
  } catch (error) {
    return { ok: false, error: toCompileError(error) };
  }
};
