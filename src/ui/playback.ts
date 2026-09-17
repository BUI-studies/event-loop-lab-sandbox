import type { LoopEvent } from "../engine/types"
import type { Translator, TranslationKey } from "../i18n"
import type { Elements } from "./dom"
import { render } from "./render"
import * as session from "./session"
import type { Phase } from "./session"

/** Upper bound on "Run to idle", so a runaway program cannot hang the tab. */
const RUN_TO_IDLE_GUARD = 4000

/**
 * The page has exactly one editor and one run in flight, so this module *is*
 * the session — the same encapsulation a class instance would give, except
 * there is only ever one of it and nothing outside this file can reach it.
 * `initPlayback` exists only because `els` and the translator are built at
 * runtime, after this module has already loaded.
 */
let els: Elements
let translator: () => Translator
let phase: Phase = session.editing()
let lastEvent: LoopEvent | null = null

export const initPlayback = (
  elements: Elements,
  getTranslator: () => Translator,
): void => {
  els = elements
  translator = getTranslator
}

/** Compiles the editor's contents and starts a fresh run. */
export const load = (): void => {
  stopTimer()
  phase = session.compile(els.code.value)
  syncChrome()
  advanceOnce()
}

/** Pauses autoplay (if any) and advances one event. */
export const step = (): void => {
  stopPlaying()
  advanceOnce()
}

export const togglePlay = (): void => {
  if (phase.kind === "playing") stopPlaying()
  else startPlaying()
}

/** Runs to completion (or the guard limit) without animating each step. */
export const finish = (): void => {
  stopPlaying()
  for (
    let guard = 0;
    phase.kind === "running" && guard < RUN_TO_IDLE_GUARD;
    guard += 1
  )
    advanceOnce()
}

/** Drops the run and puts the editor back in front, keeping what was typed. */
export const returnToEditor = (): void => {
  stopTimer()
  phase = session.editing()
  lastEvent = null
  syncChrome()
  announce("startHint")
  render(els, phase.world, translator(), null)
}

/** Redraws everything in the new language, without touching the run itself. */
export const retranslate = (): void => {
  syncChrome()
  if (phase.kind === "editing") announce("startHint")
  render(els, phase.world, translator(), lastEvent)
}

// --- internals: react to `phase`, never called from outside this module ----

const stopTimer = (): void => {
  if (phase.kind === "playing" && phase.timer !== undefined)
    clearTimeout(phase.timer)
}

/** Everything about the chrome that follows mechanically from the phase. */
const syncChrome = (): void => {
  const controlsEnabled = phase.kind === "running" || phase.kind === "playing"
  for (const button of [els.step, els.play, els.finish])
    button.disabled = !controlsEnabled

  const editing = phase.kind === "editing"
  els.code.hidden = !editing
  els.codeView.hidden = editing
  els.edit.disabled = editing

  els.play.textContent = translator().t(
    phase.kind === "playing" ? "pause" : "play",
  )
}

const announce = (key: TranslationKey): void => {
  els.phase.dataset.lane = "sleep"
  els.phaseMessage.textContent = translator().t(key)
}

const startPlaying = (): void => {
  if (phase.kind !== "running") return
  phase = session.play(phase)
  syncChrome()
  tick()
}

const stopPlaying = (): void => {
  if (phase.kind !== "playing") return
  stopTimer()
  phase = session.pause(phase)
  syncChrome()
}

/** One generator step, folded into whatever it means for the page. */
const advanceOnce = (): void => {
  const outcome = session.advance(phase)
  switch (outcome.kind) {
    case "skip":
      return
    case "errored":
      phase = outcome.phase
      syncChrome()
      render(els, phase.world, translator(), lastEvent)
      return
    case "finished":
      phase = outcome.phase
      syncChrome()
      announce("pIdle")
      return
    case "parked":
      phase = outcome.phase
      lastEvent = outcome.event
      syncChrome()
      render(els, phase.world, translator(), lastEvent)
      return
    case "event":
      phase = outcome.phase
      lastEvent = outcome.event
      render(els, phase.world, translator(), lastEvent)
      return
  }
}

/**
 * Autoplay: step, then reschedule itself, for as long as the phase holds. The
 * one function here that reaches across a `setTimeout` boundary, which is why
 * it has to mutate `phase` directly rather than returning it — there is no
 * caller left to hand a return value to by the time it fires.
 */
const tick = (): void => {
  if (phase.kind !== "playing") return
  advanceOnce()
  if (phase.kind === "playing")
    phase = session.withTimer(phase, window.setTimeout(tick, stepDelayMs()))
}

/**
 * The slider reads as pace, so dragging right must run faster. Playback needs
 * a delay, which is the opposite, hence the reflection across the range. The
 * bounds come from the input itself so the markup stays the only place they
 * are written down.
 */
const stepDelayMs = (): number =>
  Number(els.speed.min) + Number(els.speed.max) - Number(els.speed.value)
