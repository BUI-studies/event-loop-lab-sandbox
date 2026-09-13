import type { Text } from '../i18n';
import type {
  ConsoleLine,
  Frame,
  HeapEntry,
  Job,
  Lane,
  PendingRejection,
  TraceLine,
  WebApiEntry,
} from './types';

export type AnimationFrameCallback = (time: number) => void;

/**
 * Every piece of mutable state the loop owns, in one object.
 *
 * The engine is a simulation, so this is genuinely stateful and is not dressed
 * up as anything else. Keeping the state in a single value rather than in
 * module globals is what makes Reset a one-line rebuild and what lets the
 * promise implementation, the Web API mocks and the loop share a world without
 * any of them reaching for a global.
 */
export interface World {
  /** Virtual clock in ms. It jumps to the next due Web API rather than ticking. */
  clock: number;

  readonly callStack: Frame[];
  readonly microtasks: Job[];
  readonly macrotasks: Job[];
  readonly webApi: WebApiEntry[];
  readonly heap: HeapEntry[];
  readonly animationFrames: AnimationFrameCallback[];
  /** Rejections awaiting the sweep that runs after each microtask drain. */
  readonly pendingRejections: PendingRejection[];

  readonly consoleLines: ConsoleLine[];
  readonly traceLines: TraceLine[];

  /** The loaded program, split for the line-highlighting code view. */
  readonly sourceLines: readonly string[];
  /** Line the last step stopped on, or 0 before anything runs. */
  currentLine: number;
  /** Every line that ran during the current step, including `currentLine`. */
  stepLines: number[];

  promiseCount: number;
  webApiCount: number;
}

export const createWorld = (source = ''): World => ({
  clock: 0,
  callStack: [],
  microtasks: [],
  macrotasks: [],
  webApi: [],
  heap: [],
  animationFrames: [],
  pendingRejections: [],
  consoleLines: [],
  traceLines: [],
  sourceLines: source ? source.split('\n') : [],
  currentLine: 0,
  stepLines: [],
  promiseCount: 0,
  webApiCount: 0,
});

export const enqueueTask = (world: World, job: Job): void => {
  world.macrotasks.push(job);
};

export const enqueueMicrotask = (world: World, job: Job): void => {
  world.microtasks.push(job);
};

export const pushFrame = (world: World, label: Text, meta?: Text): void => {
  world.callStack.push({ label, meta });
};

export const popFrame = (world: World): void => {
  world.callStack.pop();
};

export const allocate = <T extends HeapEntry>(world: World, entry: T): T => {
  world.heap.push(entry);
  return entry;
};

export const release = (world: World, entry: HeapEntry): void => {
  const at = world.heap.indexOf(entry);
  if (at > -1) world.heap.splice(at, 1);
};

export const trace = (world: World, lane: Lane, text: Text): void => {
  world.traceLines.push({ lane, text, at: world.clock });
};

export const writeConsole = (world: World, text: Text, level: ConsoleLine['level']): void => {
  world.consoleLines.push({ text, level });
};

/** Called from instrumented user code before each statement. */
export const markLine = (world: World, line: number): void => {
  world.currentLine = line;
  if (!world.stepLines.includes(line)) world.stepLines.push(line);
};
