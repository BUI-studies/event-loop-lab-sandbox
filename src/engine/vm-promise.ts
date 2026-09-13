import { msg, type Text } from '../i18n';
import type { HeapPromise, PromiseState } from './types';
import { allocate, enqueueMicrotask, trace, type World } from './world';

type SettledState = Exclude<PromiseState, 'pending'>;
type Resolver = (value: unknown) => void;
type Executor = (resolve: Resolver, reject: Resolver) => void;
type Handler = (value: unknown) => unknown;

/** A registered `.then` callback, waiting for its promise to settle. */
interface Reaction {
  readonly handler: Handler;
  readonly settleNext: (state: SettledState, value: unknown) => void;
  /** Shown on the microtask queue item once this reaction is scheduled. */
  readonly label: Text;
  readonly meta: Text;
}

const isThenable = (value: unknown): value is { then: Executor } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { then?: unknown }).then === 'function';

/**
 * Builds a promise implementation bound to one world.
 *
 * It is a real promise in every way that matters here - state, value, a
 * waiting room of reactions, and settling that schedules those reactions as
 * microtasks - except that the waiting room and the scheduling are observable,
 * which is the entire point of the lab. A native promise would use the
 * engine's own microtask queue and step right past our loop.
 */
export const createPromiseClass = (world: World) => {
  class VPromise implements HeapPromise {
    readonly kind: 'promise' = 'promise';
    readonly id: number;
    label: string;
    state: PromiseState = 'pending';
    value: unknown = undefined;

    /**
     * True once any rejection handler has been attached, at any point. Read
     * back at sweep time, so a `.catch()` added later in the same drain still
     * counts and the rejection is never reported.
     */
    handled = false;

    private fulfillReactions: Reaction[] = [];
    private rejectReactions: Reaction[] = [];

    constructor(executor?: Executor | null, label?: string) {
      this.id = ++world.promiseCount;
      this.label = label ?? `Promise#${this.id}`;
      allocate(world, this);
      if (!executor) return;
      try {
        executor(
          (value) => this.settle('fulfilled', value),
          (reason) => this.settle('rejected', reason),
        );
      } catch (error) {
        this.settle('rejected', error);
      }
    }

    /** Size of the waiting room, which the heap panel shows climbing. */
    get pendingReactions(): number {
      return this.fulfillReactions.length;
    }

    then(
      onFulfilled?: Handler | null,
      onRejected?: Handler | null,
      reactionLabel?: Text,
    ): VPromise {
      // Every `then` registers a rejection reaction, the default one being a
      // rethrow, so this promise now has a listener and the derived one does
      // not. That is exactly the chain semantics a real engine reports on.
      this.handled = true;
      const next = new VPromise(null, `${this.label} ->`);

      const makeReaction = (handler: Handler | null | undefined, fallback: Handler): Reaction => ({
        handler: handler ?? fallback,
        settleNext: (state, value) => next.settle(state, value),
        label: reactionLabel ?? msg('iReaction'),
        meta: msg('iOn', { label: this.label }),
      });

      const onFulfilledReaction = makeReaction(onFulfilled, (value) => value);
      const onRejectedReaction = makeReaction(onRejected, (reason) => {
        throw reason;
      });

      if (this.state === 'pending') {
        this.fulfillReactions.push(onFulfilledReaction);
        this.rejectReactions.push(onRejectedReaction);
      } else {
        // Already settled, so there is no waiting room to join: the reaction
        // goes straight onto the microtask queue.
        const reaction =
          this.state === 'fulfilled' ? onFulfilledReaction : onRejectedReaction;
        this.schedule(reaction, this.value, msg('iSettled', { label: reaction.label }));
      }

      return next;
    }

    catch(onRejected?: Handler | null): VPromise {
      return this.then(null, onRejected);
    }

    finally(onFinally: () => void): VPromise {
      return this.then(
        (value) => {
          onFinally();
          return value;
        },
        (reason) => {
          onFinally();
          throw reason;
        },
      );
    }

    private settle(state: SettledState, value: unknown): void {
      if (this.state !== 'pending') return;

      // Resolving with a thenable adopts its eventual state instead of
      // fulfilling with the thenable itself.
      if (state === 'fulfilled' && isThenable(value)) {
        value.then(
          (inner) => this.settle('fulfilled', inner),
          (reason) => this.settle('rejected', reason),
        );
        return;
      }

      this.state = state;
      this.value = value;

      const reactions = state === 'fulfilled' ? this.fulfillReactions : this.rejectReactions;
      trace(world, 'micro', msg('tDrain', { label: this.label, state, n: reactions.length }));
      for (const reaction of reactions) this.schedule(reaction, value);

      // A rejection nobody is listening to. Queued rather than reported now,
      // because the handler may still arrive before this drain finishes.
      // `settle` runs at most once, so each promise enters the list at most once.
      if (state === 'rejected' && !this.handled) world.pendingRejections.push(this);

      this.fulfillReactions = [];
      this.rejectReactions = [];
    }

    private schedule(reaction: Reaction, value: unknown, label: Text = reaction.label): void {
      enqueueMicrotask(world, {
        label,
        meta: reaction.meta,
        run: () => {
          try {
            reaction.settleNext('fulfilled', reaction.handler(value));
          } catch (error) {
            reaction.settleNext('rejected', error);
          }
        },
      });
    }

    static resolve(value: unknown): VPromise {
      if (value instanceof VPromise) return value;
      return new VPromise((fulfil) => fulfil(value), 'Promise.resolve');
    }

    static reject(reason: unknown): VPromise {
      return new VPromise((_, reject) => reject(reason), 'Promise.reject');
    }

    static all(items: Iterable<unknown>): VPromise {
      const list = Array.from(items);
      const results: unknown[] = new Array(list.length);
      let remaining = list.length;

      let fulfil: Resolver = () => {};
      let reject: Resolver = () => {};
      const aggregate = new VPromise((res, rej) => {
        fulfil = res;
        reject = rej;
      }, `Promise.all[${list.length}]`);

      if (remaining === 0) fulfil(results);

      list.forEach((item, index) => {
        VPromise.resolve(item).then(
          (value) => {
            results[index] = value;
            if (--remaining === 0) fulfil(results);
          },
          reject,
          `all[${index}]`,
        );
      });

      return aggregate;
    }

    static race(items: Iterable<unknown>): VPromise {
      let fulfil: Resolver = () => {};
      let reject: Resolver = () => {};
      const winner = new VPromise((res, rej) => {
        fulfil = res;
        reject = rej;
      }, 'Promise.race');

      for (const item of items) VPromise.resolve(item).then(fulfil, reject);
      return winner;
    }
  }

  return VPromise;
};

export type VPromiseClass = ReturnType<typeof createPromiseClass>;
export type VPromise = InstanceType<VPromiseClass>;
