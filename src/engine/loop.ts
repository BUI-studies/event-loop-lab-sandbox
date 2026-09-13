import { msg } from '../i18n';
import { createAsyncDriver } from './async-driver';
import { compile } from './transform';
import type { Job, LoopEvent, WebApiEntry } from './types';
import { createPromiseClass } from './vm-promise';
import { createWebApis } from './web-apis';
import {
  enqueueTask,
  markLine,
  popFrame,
  pushFrame,
  trace,
  writeConsole,
  type World,
} from './world';

type Step = Generator<LoopEvent, void, void>;

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** User code throwing must not kill the loop; it lands in the mock console. */
const invoke = (world: World, run: () => void): void => {
  try {
    run();
  } catch (error) {
    writeConsole(world, msg('iUncaught', { error: describeError(error) }), 'error');
  }
};

/**
 * Compiles the program and queues it as the very first task.
 *
 * Returns false when the source could not be compiled. Compilation never
 * throws, so a typo reaches the student as a console line rather than as an
 * exception nobody sees.
 */
const loadScript = (world: World, source: string): boolean => {
  const compiled = compile(source);
  if (!compiled.ok) {
    writeConsole(world, compiled.error.text, 'error');
    return false;
  }

  const VPromiseClass = createPromiseClass(world);
  const webApis = createWebApis(world, VPromiseClass);
  const { asyncFn, runTopLevel } = createAsyncDriver(world, VPromiseClass);

  enqueueTask(world, {
    label: msg('iScript'),
    meta: msg('iScriptMeta'),
    run: () =>
      compiled.script.run({
        ...webApis,
        Promise: VPromiseClass,
        __asyncFn: asyncFn,
        __runTopLevel: runTopLevel,
        __line: (line) => markLine(world, line),
      }),
  });
  return true;
};

function* runJob(world: World, job: Job, lane: 'macro' | 'micro'): Step {
  pushFrame(world, job.label, job.meta);
  yield lane === 'macro'
    ? { lane, message: msg('pTaskTaken', { label: job.label }) }
    : {
        lane,
        message: msg('pMicroTaken', {
          label: job.label,
          queued: world.microtasks.length ? msg('pMicroQueued', { n: world.microtasks.length }) : '',
        }),
      };
  invoke(world, job.run);
  popFrame(world);
}

function* runNextTask(world: World): Step {
  const job = world.macrotasks.shift();
  if (!job) return;

  yield* runJob(world, job, 'macro');
  trace(world, 'macro', msg('tRanTask', { label: job.label }));
  yield { lane: 'macro', message: msg('pTaskDone', { label: job.label }) };
}

/**
 * Empties the microtask queue completely.
 *
 * The loop condition is re-checked every pass on purpose: a microtask that
 * queues another microtask is swallowed by this same drain, so a thousand of
 * them still run before `setTimeout(fn, 0)` gets its turn. That is the rule
 * people get wrong, so it is the one the lab makes impossible to miss.
 */
function* drainMicrotasks(world: World): Step {
  let drained = 0;

  while (world.microtasks.length) {
    const job = world.microtasks.shift();
    if (!job) return;

    yield* runJob(world, job, 'micro');
    drained += 1;
    trace(world, 'micro', msg('tRanMicro', { label: job.label }));

    yield world.microtasks.length
      ? { lane: 'micro', message: msg('pMicroMore') }
      : { lane: 'micro', message: msg('pMicroEmpty', { n: drained }) };
  }
}

/**
 * Reports rejections nobody caught, the way a real console prints
 * `Uncaught (in promise)`.
 *
 * It runs only once the microtask queue is empty, because a `.catch()`
 * attached during the drain still counts. Yields nothing when there is nothing
 * to say, so stepping through well-behaved code is unaffected.
 *
 * Known simplification: a handler attached after this point does not retract a
 * report. Real engines fire `rejectionhandled` for that; here the line stands.
 */
function* reportRejections(world: World): Step {
  const unhandled = world.pendingRejections.filter((rejection) => !rejection.handled);
  world.pendingRejections.length = 0;
  if (!unhandled.length) return;

  for (const rejection of unhandled) {
    writeConsole(world, msg('iUnhandledRejection', { error: describeError(rejection.value) }), 'error');
  }

  trace(world, 'micro', msg('tUnhandled', { n: unhandled.length }));
  yield { lane: 'micro', message: msg('pUnhandled', { n: unhandled.length }) };
}

function* runRenderStep(world: World): Step {
  const callbacks = world.animationFrames.splice(0, world.animationFrames.length);

  pushFrame(world, msg('iRaf'), msg('iRafMeta', { n: callbacks.length }));
  yield { lane: 'render', message: msg('pRenderRun', { n: callbacks.length }) };

  for (const callback of callbacks) invoke(world, () => callback(world.clock));
  popFrame(world);

  trace(world, 'render', msg('tPainted'));
  yield { lane: 'render', message: msg('pRenderDone') };
}

/**
 * The `os.block_until_event()` of a real engine, made visible.
 *
 * A real thread sleeps in `epoll_wait`/`kqueue` at 0% CPU until the OS pokes
 * it. Here the clock simply jumps to the earliest pending Web API entry, which
 * is the same behaviour minus the waiting: no spinning, no polling.
 */
function* sleepUntilDue(world: World): Step {
  const earliest = world.webApi.reduce((soonest, entry) =>
    entry.due < soonest.due ? entry : soonest,
  );
  const waited = Math.max(0, earliest.due - world.clock);
  world.clock = Math.max(world.clock, earliest.due);
  yield { lane: 'sleep', message: msg('pSleep', { ms: waited }) };

  const isDue = (entry: WebApiEntry): boolean => entry.due <= world.clock;
  const due = world.webApi.filter(isDue);
  const stillPending = world.webApi.filter((entry) => !isDue(entry));
  world.webApi.splice(0, world.webApi.length, ...stillPending);

  for (const entry of due) {
    entry.fire();
    trace(world, 'web', msg('tWebDone', { label: entry.label }));
  }

  yield { lane: 'web', message: msg('pWoken', { what: due.map((entry) => entry.label) }) };
}

/**
 * One full iteration per pass: run a task, drain every microtask, maybe paint,
 * otherwise sleep. Each `yield` is one atomic action, which is what the Step
 * button advances.
 *
 * The loop deliberately knows nothing about promises or async functions. It
 * shifts things out of arrays and calls them; everything else is a consequence.
 */
export function* createEventLoop(world: World, source: string): Step {
  if (!loadScript(world, source)) {
    yield { lane: 'sleep', message: msg('pCompileFailed'), done: true };
    return;
  }
  yield { lane: 'macro', message: msg('pScript') };

  while (true) {
    if (world.macrotasks.length) yield* runNextTask(world);

    yield* drainMicrotasks(world);
    yield* reportRejections(world);

    if (world.animationFrames.length) yield* runRenderStep(world);

    if (!world.macrotasks.length && !world.microtasks.length) {
      if (!world.webApi.length) {
        yield { lane: 'sleep', message: msg('pPark'), done: true };
        return;
      }
      yield* sleepUntilDue(world);
    }
  }
}
