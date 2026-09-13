import { msg, type Text } from '../i18n';
import { formatValue, truncateUrl } from './format';
import type { VPromise, VPromiseClass } from './vm-promise';
import {
  enqueueMicrotask,
  enqueueTask,
  writeConsole,
  type AnimationFrameCallback,
  type World,
} from './world';

/** The mock network. Two endpoints, deterministic bodies, no real I/O. */
const MOCK_USERS = [
  { id: 1, name: 'ada', gender: 'female', status: 'offline', age: 13 },
  { id: 2, name: 'linus', gender: 'male', status: 'online', age: 40 },
  { id: 3, name: 'grace', gender: null, status: 'online', age: 23 },
];

const DOSSIER_URL = /dossier|background/;
const JSON_PARSE_MS = 90;

const mockBody = (url: string): unknown => {
  if (!DOSSIER_URL.test(url)) {
    return MOCK_USERS.map((user) => ({ ...user, dossier: `/dossier/${user.id}` }));
  }
  const id = Number(url.match(/(\d+)/)?.[1] ?? 1);
  return { id, clearance: `level-${id}`, since: 2019 + id };
};

/** Latency is a hash of the URL, so a given preset always traces identically. */
const latencyFor = (url: string): number => 240 + ((url.length * 17) % 420);

export interface VmConsole {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

/** The host globals handed to user code in place of the real ones. */
export interface WebApis {
  setTimeout: (callback: () => void, delay?: unknown) => number;
  clearTimeout: (id?: unknown) => void;
  setInterval: (callback: () => void, period?: unknown) => number;
  clearInterval: (id?: unknown) => void;
  fetch: (input: unknown) => VPromise;
  queueMicrotask: (callback: () => void) => void;
  requestAnimationFrame: (callback: AnimationFrameCallback) => number;
  cancelAnimationFrame: (handle?: unknown) => void;
  console: VmConsole;
}

/**
 * Host-provided globals, all of them off the JS thread by construction.
 *
 * Nothing here ever calls user code directly: a timer or a request parks in
 * `world.webApi` with a virtual fire time, and the only way back into
 * JavaScript is the task it queues once the loop advances the clock past it.
 */
export const createWebApis = (world: World, VPromiseClass: VPromiseClass): WebApis => {
  interface ScheduleSpec {
    label: Text;
    meta: Text;
    delay: number;
    fire: (id: number) => void;
  }

  /** `reuseId` lets a repeating timer keep one id across re-arms. */
  const schedule = ({ label, meta, delay, fire }: ScheduleSpec, reuseId?: number): number => {
    const id = reuseId ?? ++world.webApiCount;
    world.webApi.push({ id, label, meta, due: world.clock + delay, fire: () => fire(id) });
    return id;
  };

  /** Cancellation is just removing the entry before the clock reaches it. */
  const cancel = (id: unknown): void => {
    const at = world.webApi.findIndex((entry) => entry.id === Number(id));
    if (at > -1) world.webApi.splice(at, 1);
  };

  /** Second hop: reading the body is its own async round trip, like the real thing. */
  const readBody = (url: string): VPromise => {
    let deliver: (value: unknown) => void = () => {};
    const parsed = new VPromiseClass((res) => {
      deliver = res;
    }, `json(${truncateUrl(url)})`);

    schedule({
      label: msg('iParse', { url: truncateUrl(url) }),
      meta: msg('iParseMeta'),
      delay: JSON_PARSE_MS,
      fire: () =>
        enqueueTask(world, {
          label: msg('iResolve', { label: parsed.label }),
          meta: msg('iBodyRead'),
          run: () => deliver(mockBody(url)),
        }),
    });

    return parsed;
  };

  return {
    setTimeout(callback, delay) {
      const ms = Number(delay) || 0;
      return schedule({
        label: msg('iTimer', { ms }),
        meta: msg('iTimerMeta'),
        delay: ms,
        fire: (id) =>
          enqueueTask(world, {
            label: msg('iTimerCb', { ms }),
            meta: msg('iTimerId', { id }),
            run: callback,
          }),
      });
    },

    fetch(input) {
      const url = String(input);
      let deliver: (value: unknown) => void = () => {};
      const response = new VPromiseClass((res) => {
        deliver = res;
      }, `fetch(${truncateUrl(url)})`);

      schedule({
        label: msg('iNet', { url: truncateUrl(url) }),
        meta: msg('iNetMeta', { ms: latencyFor(url) }),
        delay: latencyFor(url),
        fire: () =>
          enqueueTask(world, {
            label: msg('iResolve', { label: response.label }),
            meta: msg('iHeaders'),
            run: () => deliver({ ok: true, status: 200, url, json: () => readBody(url) }),
          }),
      });

      return response;
    },

    clearTimeout: cancel,
    clearInterval: cancel,

    /**
     * Re-arms itself from inside `fire`. `sleepUntilDue` removes the due entry
     * before firing it, so the fresh entry lands cleanly, and reusing the id
     * keeps `clearInterval` working after any number of ticks.
     */
    setInterval(callback, period) {
      const ms = Math.max(1, Number(period) || 0);

      const arm = (reuseId?: number): number =>
        schedule(
          {
            label: msg('iInterval', { ms }),
            meta: msg('iTimerMeta'),
            delay: ms,
            fire: (id) => {
              enqueueTask(world, {
                label: msg('iIntervalCb', { ms }),
                meta: msg('iTimerId', { id }),
                run: callback,
              });
              arm(id);
            },
          },
          reuseId,
        );

      return arm();
    },

    queueMicrotask(callback) {
      enqueueMicrotask(world, { label: msg('iQmt'), meta: msg('iQmtMeta'), run: callback });
    },

    requestAnimationFrame(callback) {
      return world.animationFrames.push(callback);
    },

    cancelAnimationFrame(handle) {
      const at = Number(handle) - 1;
      if (at >= 0 && at < world.animationFrames.length) world.animationFrames.splice(at, 1);
    },

    console: {
      log: (...args) => writeConsole(world, args.map(formatValue).join(' '), 'log'),
      warn: (...args) => writeConsole(world, args.map(formatValue).join(' '), 'log'),
      error: (...args) => writeConsole(world, args.map(formatValue).join(' '), 'error'),
    },
  };
};
