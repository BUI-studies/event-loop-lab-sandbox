import { createEventLoop } from '../engine/loop';
import type { LoopEvent } from '../engine/types';
import { createWorld, writeConsole, type World } from '../engine/world';
import { msg } from '../i18n';

type Loop = Generator<LoopEvent, void, void>;

/**
 * The session's phase, and exactly the data that phase has. There is no
 * `running` or `playing` flag anywhere: a phase that cannot exist (playing
 * without a loop, an idle timer while editing) cannot be constructed, so
 * nothing downstream has to defend against it.
 *
 * Nothing in this file touches the DOM, a translator, or a timer — it is the
 * event loop's own state machine, not the UI's. `playback.ts` is the shell
 * that drives it and reacts to what it reports.
 */
export type Phase =
  | { readonly kind: 'editing'; readonly world: World }
  | { readonly kind: 'running'; readonly world: World; readonly loop: Loop }
  | { readonly kind: 'playing'; readonly world: World; readonly loop: Loop; readonly timer?: number }
  | { readonly kind: 'halted'; readonly world: World };

export const editing = (): Phase => ({ kind: 'editing', world: createWorld() });

export const compile = (source: string): Phase => {
  const world = createWorld(source);
  return { kind: 'running', world, loop: createEventLoop(world, source) };
};

export const play = (phase: Phase): Phase =>
  phase.kind === 'running' ? { kind: 'playing', world: phase.world, loop: phase.loop } : phase;

export const pause = (phase: Phase): Phase =>
  phase.kind === 'playing' ? { kind: 'running', world: phase.world, loop: phase.loop } : phase;

export const withTimer = (phase: Phase, timer: number | undefined): Phase =>
  phase.kind === 'playing' ? { ...phase, timer } : phase;

export const halt = (phase: Phase): Phase => ({ kind: 'halted', world: phase.world });

/** What one generator step reported, and what the phase became because of it. */
export type Outcome =
  | { readonly kind: 'skip' }
  | { readonly kind: 'errored'; readonly phase: Phase }
  | { readonly kind: 'finished'; readonly phase: Phase }
  | { readonly kind: 'parked'; readonly phase: Phase; readonly event: LoopEvent }
  | { readonly kind: 'event'; readonly phase: Phase; readonly event: LoopEvent };

/** Advances the generator one step. A no-op outside `running`/`playing`. */
export const advance = (phase: Phase): Outcome => {
  if (phase.kind !== 'running' && phase.kind !== 'playing') return { kind: 'skip' };

  const { world, loop } = phase;
  world.stepLines = [];

  let result: IteratorResult<LoopEvent, void>;
  try {
    result = loop.next();
  } catch (error) {
    // The engine is not supposed to throw, and compile failures no longer do.
    // If something ever slips through, the person using the lab sees it here
    // rather than in devtools.
    const message = error instanceof Error ? error.message : String(error);
    writeConsole(world, msg('iCompileError', { message }), 'error');
    return { kind: 'errored', phase: halt(phase) };
  }

  if (result.done) return { kind: 'finished', phase: halt(phase) };

  const event = result.value;
  return event.done ? { kind: 'parked', phase: halt(phase), event } : { kind: 'event', phase, event };
};
