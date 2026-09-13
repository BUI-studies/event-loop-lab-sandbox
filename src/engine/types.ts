import type { Msg, Text } from '../i18n';

/**
 * Which part of the loop an event or trace line belongs to. Drives the colour
 * coding in the UI, and nothing else.
 */
export type Lane = 'macro' | 'micro' | 'render' | 'web' | 'sleep';

/** An entry on the call stack. */
export interface Frame {
  readonly label: Text;
  readonly meta?: Text;
}

/** A queued unit of work: a frame plus the callback to invoke inside it. */
export interface Job extends Frame {
  readonly run: () => void;
}

/**
 * Work owned by the host, not by the JS thread. It carries a virtual fire time
 * and only touches JS by queueing a task once that time is reached.
 */
export interface WebApiEntry {
  readonly id: number;
  readonly label: Text;
  readonly meta: Text;
  readonly due: number;
  readonly fire: () => void;
}

export type PromiseState = 'pending' | 'fulfilled' | 'rejected';

/**
 * The parts of a promise the heap panel renders. `VPromise` implements it.
 *
 * The label is a plain string on purpose: it identifies the object
 * (`Promise#3`, `fetch(/users)`, `Promise.all[3]`) the way a variable name
 * would, so it reads the same in every language.
 */
export interface HeapPromise {
  kind: 'promise';
  label: string;
  state: PromiseState;
  value: unknown;
  /** Reactions registered but not yet queued, i.e. the size of the waiting room. */
  readonly pendingReactions: number;
}

/** An async function suspended at an `await`, with its locals still alive. */
export interface HeapAsyncFrame {
  kind: 'async';
  name: string;
  step: number;
  at: 'start' | 'awaiting';
}

export type HeapEntry = HeapPromise | HeapAsyncFrame;

/**
 * A rejection with nobody listening, queued for the sweep that runs once the
 * microtask queue is empty. `handled` is re-read at sweep time, because a
 * `.catch()` attached later in the same drain still counts as catching it.
 */
export interface PendingRejection {
  readonly label: string;
  readonly value: unknown;
  readonly handled: boolean;
}

export interface ConsoleLine {
  /** User output is a plain string; an uncaught error is engine prose. */
  readonly text: Text;
  readonly level: 'log' | 'error';
}

export interface TraceLine {
  readonly lane: Lane;
  readonly text: Text;
  /** Virtual clock reading, in ms. */
  readonly at: number;
}

/** One atomic action of the loop. The generator yields exactly one per step. */
export interface LoopEvent {
  readonly lane: Lane;
  readonly message: Msg;
  /** Set when the loop has parked for good and there is nothing left to step. */
  readonly done?: boolean;
}
