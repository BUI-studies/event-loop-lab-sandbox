import { createEventLoop } from '../engine/loop';
import type { LoopEvent } from '../engine/types';
import { createWorld, type World } from '../engine/world';
import { createTranslator, type Lang, type TranslationKey, type Translator } from '../i18n';
import { DEFAULT_PRESET_ID, findPreset, PRESETS } from '../presets';
import { escapeHtml, type Elements } from './dom';
import { loadLang, saveLang } from './preferences';
import { render } from './render';

/** Upper bound on "Run to idle", so a runaway program cannot hang the tab. */
const RUN_TO_IDLE_GUARD = 4000;

const LEGEND: readonly (readonly [cssVar: string, key: TranslationKey])[] = [
  ['--stack', 'legStack'],
  ['--task', 'legTask'],
  ['--micro', 'legMicro'],
  ['--webapi', 'legWeb'],
  ['--heapc', 'legHeap'],
];

/**
 * Owns the session: which language is active, which world is loaded, and how
 * far the loop has been stepped. Everything it touches is either an element it
 * was handed or state private to this closure.
 */
export const createController = (els: Elements): void => {
  let translator: Translator = createTranslator(loadLang());
  let world: World = createWorld();
  let loop: Generator<LoopEvent, void, void> | null = null;
  let lastEvent: LoopEvent | null = null;
  let running = false;
  let playing = false;
  let playTimer: number | undefined;
  /** Which preset the editor's text came from, so edits can be undone back to it. */
  let sourcePreset = DEFAULT_PRESET_ID;

  /** Repaints with the last event when called bare, which is what a language switch needs. */
  const paint = (event: LoopEvent | null = lastEvent): void => {
    lastEvent = event;
    render(els, world, translator, event);
  };

  const setStepControls = (enabled: boolean): void => {
    for (const button of [els.step, els.play, els.finish]) button.disabled = !enabled;
  };

  /**
   * The slider reads as pace, so dragging right must run faster. Playback needs
   * a delay, which is the opposite, hence the reflection across the range. The
   * bounds come from the input itself so the markup stays the only place they
   * are written down.
   */
  const stepDelayMs = (): number =>
    Number(els.speed.min) + Number(els.speed.max) - Number(els.speed.value);

  const pausePlayback = (): void => {
    playing = false;
    if (playTimer !== undefined) clearTimeout(playTimer);
    playTimer = undefined;
    els.play.textContent = translator.t('play');
  };

  const startPlayback = (): void => {
    playing = true;
    els.play.textContent = translator.t('pause');

    const tick = (): void => {
      if (!playing || !running) {
        pausePlayback();
        return;
      }
      step();
      if (playing && running) playTimer = window.setTimeout(tick, stepDelayMs());
    };

    tick();
  };

  const halt = (): void => {
    running = false;
    pausePlayback();
    setStepControls(false);
  };

  function step(): void {
    if (!loop) return;
    world.stepLines = [];

    let result: IteratorResult<LoopEvent, void>;
    try {
      result = loop.next();
    } catch (error) {
      // The engine is not supposed to throw, and compile failures no longer do.
      // If something ever slips through, the person using the lab sees it here
      // rather than in devtools.
      halt();
      world.consoleLines.push({
        text: translator.t('iCompileError', {
          message: error instanceof Error ? error.message : String(error),
        }),
        level: 'error',
      });
      paint();
      return;
    }

    if (result.done) {
      halt();
      els.phase.dataset.lane = 'sleep';
      els.phaseMessage.textContent = translator.t('pIdle');
      return;
    }

    paint(result.value);
    if (result.value.done) halt();
  }

  const runToIdle = (): void => {
    pausePlayback();
    for (let guard = 0; running && guard < RUN_TO_IDLE_GUARD; guard += 1) step();
  };

  /** Drops the run and puts the editor back in front, keeping what was typed. */
  const returnToEditor = (): void => {
    pausePlayback();
    world = createWorld();
    loop = null;
    lastEvent = null;
    running = false;

    setStepControls(false);
    els.edit.disabled = true;
    els.codeView.hidden = true;
    els.code.hidden = false;
    els.phase.dataset.lane = 'sleep';
    els.phaseMessage.textContent = translator.t('startHint');
    paint(null);
  };

  /** Reset means what it says: the preset comes back and edits are discarded. */
  const reset = (): void => {
    returnToEditor();
    selectPreset();
  };

  const load = (): void => {
    returnToEditor();

    const source = els.code.value;
    world = createWorld(source);
    loop = createEventLoop(world, source);
    running = true;

    els.code.hidden = true;
    els.codeView.hidden = false;
    setStepControls(true);
    els.edit.disabled = false;

    step();
  };

  /** The empty value means "none of the presets", i.e. code you typed yourself. */
  const CUSTOM = '';

  const buildPresetOptions = (): void => {
    const selected = els.preset.value;
    els.preset.innerHTML = [
      `<option value="${CUSTOM}">${escapeHtml(translator.t('presetCustom'))}</option>`,
      ...PRESETS.map(
        (preset) =>
          `<option value="${preset.id}">${escapeHtml(translator.t(preset.nameKey))}</option>`,
      ),
    ].join('');
    els.preset.value = selected;
  };

  /**
   * Typing something a preset does not say means you are no longer running that
   * preset, and the dropdown should stop claiming otherwise.
   *
   * The comparison is against the preset the text came from, remembered in
   * `sourcePreset`, rather than a dirty flag. That way undoing an edit back to
   * the original text puts the preset label back instead of leaving the
   * dropdown stuck on custom.
   */
  const syncPresetToCode = (): void => {
    const origin = findPreset(sourcePreset);
    if (!origin) return;
    els.preset.value = els.code.value === origin.code ? origin.id : CUSTOM;
  };

  const applyLanguage = (): void => {
    document.documentElement.lang = translator.lang;

    els.title.textContent = translator.t('title');
    els.subtitle.textContent = translator.t('sub');
    els.yourCode.textContent = translator.t('yourcode');
    els.pace.textContent = translator.t('pace');
    els.consoleTitle.textContent = translator.t('console');
    els.traceTitle.textContent = translator.t('trace');
    els.stackTitle.textContent = translator.t('stack');
    els.webTitle.textContent = translator.t('web');
    els.microTitle.textContent = translator.t('micro');
    els.macroTitle.textContent = translator.t('macro');
    els.heapTitle.textContent = translator.t('heap');

    els.load.textContent = translator.t('load');
    els.step.textContent = translator.t('step');
    els.play.textContent = translator.t(playing ? 'pause' : 'play');
    els.finish.textContent = translator.t('finish');
    els.edit.textContent = translator.t('edit');
    els.reset.textContent = translator.t('reset');

    // The note is the one string that carries markup, hence innerHTML.
    els.note.innerHTML = translator.t('note');
    els.legend.innerHTML = LEGEND.map(
      ([cssVar, key]) =>
        `<span><i class="dot" style="background:var(${cssVar})"></i> ${escapeHtml(translator.t(key))}</span>`,
    ).join('');

    els.langEn.setAttribute('aria-pressed', String(translator.lang === 'en'));
    els.langUk.setAttribute('aria-pressed', String(translator.lang === 'uk'));

    buildPresetOptions();
    if (!loop) els.phaseMessage.textContent = translator.t('startHint');
    paint();
  };

  const setLanguage = (lang: Lang): void => {
    translator = createTranslator(lang);
    saveLang(lang);
    applyLanguage();
  };

  /** A no-op on the custom option, so picking it never wipes what you wrote. */
  const selectPreset = (): void => {
    const preset = findPreset(els.preset.value);
    if (!preset) return;
    sourcePreset = preset.id;
    els.code.value = preset.code;
  };

  els.credits.textContent = `© ${new Date().getFullYear()} ${els.credits.textContent}`
  els.load.addEventListener('click', load);
  els.edit.addEventListener('click', returnToEditor);
  els.reset.addEventListener('click', reset);
  els.step.addEventListener('click', () => {
    pausePlayback();
    step();
  });
  els.play.addEventListener('click', () => (playing ? pausePlayback() : startPlayback()));
  els.finish.addEventListener('click', runToIdle);
  els.langEn.addEventListener('click', () => setLanguage('en'));
  els.langUk.addEventListener('click', () => setLanguage('uk'));
  els.preset.addEventListener('change', selectPreset);
  els.code.addEventListener('input', syncPresetToCode);

  applyLanguage();
  els.preset.value = DEFAULT_PRESET_ID;
  reset();
};
