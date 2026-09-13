import type { TranslationKey } from './i18n';

export interface Preset {
  readonly id: string;
  readonly nameKey: TranslationKey;
  /** Stays in English: it is code, and the lab runs it verbatim. */
  readonly code: string;
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'p1',
    nameKey: 'presetP1',
    code: `console.log('1 - sync')

setTimeout(() => console.log('4 - task'), 0)

Promise.resolve().then(() => console.log('3 - microtask'))

console.log('2 - sync')`,
  },
  {
    id: 'p2',
    nameKey: 'presetP2',
    code: `setTimeout(() => console.log('task - runs last'), 0)

Promise.resolve()
  .then(() => {
    console.log('microtask 1')
    Promise.resolve().then(() => console.log('microtask 3 - queued mid-drain'))
  })
  .then(() => console.log('microtask 2'))

console.log('sync first')`,
  },
  {
    id: 'p3',
    nameKey: 'presetP3',
    code: `async function work() {
  console.log('before await')
  const v = await Promise.resolve(42)
  console.log('after await, got', v)
  return v * 2
}

work().then(r => console.log('outer promise settled with', r))
console.log('caller keeps going')`,
  },
  {
    id: 'p4',
    nameKey: 'presetP4',
    code: `async function load() {
  const res = await fetch('/users')
  const users = await res.json()
  console.log('users:', users.length)
  return users
}

load().then(u => console.log('done'))`,
  },
  {
    id: 'p5',
    nameKey: 'presetP5',
    code: `async function getUsers() {
  const res = await fetch('/users')
  const users = await res.json()

  const backgrounds = await Promise.all(
    users.map(u => fetch(u.dossier).then(r => r.json()))
  )

  return users.map(u => ({
    ...u,
    ...backgrounds.find(b => b.id === u.id)
  }))
}

getUsers().then(merged => console.log('merged', merged.length))`,
  },
  {
    id: 'p6',
    nameKey: 'presetP6',
    code: `setTimeout(() => console.log('timer 0ms'), 0)
setTimeout(() => console.log('timer 50ms'), 50)

requestAnimationFrame(() => console.log('rAF - before the next task'))

queueMicrotask(() => console.log('microtask'))

console.log('sync')`,
  },
  {
    id: 'p7',
    nameKey: 'presetP7',
    // /users takes 342ms, so the 50ms timer runs while the request is still
    // sitting in the Web API panel. That is the whole point of this one.
    code: `fetch('/users')
  .then(r => r.json())
  .then(users => console.log('data arrived:', users.length))

setTimeout(() => console.log('timer ran while the fetch was still in flight'), 50)

console.log('sync, before anything')`,
  },
];

export const DEFAULT_PRESET_ID = 'p5';

export const findPreset = (id: string): Preset | undefined =>
  PRESETS.find((preset) => preset.id === id);
