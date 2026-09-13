import { msg } from '../i18n';
import type { HeapAsyncFrame } from './types';
import type { VPromise, VPromiseClass } from './vm-promise';
import { allocate, popFrame, pushFrame, release, type World } from './world';

/** An `async function` after the source transform rewrote `await` into `yield`. */
export type AsyncBody = (...args: unknown[]) => Generator<unknown, unknown, unknown>;

/** Wraps a transformed body into the callable the user's code sees. */
export type RunAsync = (body: AsyncBody, name: string, thisArg?: unknown) => AsyncFunction;

export type AsyncFunction = (...args: unknown[]) => VPromise;

/** Runs a whole script that used top-level await. */
export type RunTopLevel = (body: AsyncBody) => VPromise;

/**
 * Drives a transformed async function, one `await` at a time.
 *
 * This is what makes the pause real rather than narrated. Each resume pushes a
 * frame, advances the generator to the next `yield`, and pops the frame again,
 * so between two awaits the function is genuinely off the call stack: only the
 * paused record on the heap and a resume closure parked inside the awaited
 * promise keep it alive.
 */
export const createAsyncDriver = (world: World, VPromiseClass: VPromiseClass) => {
  const start = (body: AsyncBody, name: string, thisArg: unknown, args: unknown[]): VPromise => {
    let fulfil: (value: unknown) => void = () => {};
    let reject: (reason: unknown) => void = () => {};
    const result = new VPromiseClass((res, rej) => {
      fulfil = res;
      reject = rej;
    }, `${name}()`);

    const paused = allocate<HeapAsyncFrame>(world, { kind: 'async', name, step: 0, at: 'start' });
    const iterator = body.apply(thisArg, args) as ReturnType<AsyncBody>;

    const resume = (input?: unknown, failed = false): void => {
      pushFrame(world, msg('iResume', { name }), msg('iStep', { n: paused.step }));

      let progress: IteratorResult<unknown, unknown>;
      try {
        progress = failed ? iterator.throw(input) : iterator.next(input);
      } catch (error) {
        popFrame(world);
        release(world, paused);
        reject(error);
        return;
      }
      popFrame(world);

      if (progress.done) {
        release(world, paused);
        fulfil(progress.value);
        return;
      }

      paused.step += 1;
      paused.at = 'awaiting';
      VPromiseClass.resolve(progress.value).then(
        (value) => resume(value, false),
        (error) => resume(error, true),
        msg('iResume', { name }),
      );
    };

    resume();
    return result;
  };

  const asyncFn: RunAsync =
    (body, name, thisArg) =>
    (...args) =>
      start(body, name, thisArg, args);

  const runTopLevel: RunTopLevel = (body) => start(body, 'script', undefined, []);

  return { asyncFn, runTopLevel };
};
