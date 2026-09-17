import type { Lang } from '../i18n';
import { DEFAULT_PRESET_ID } from '../presets';
import type { Elements } from './dom';
import { createLanguageController } from './language';
import * as playback from './playback';
import { createPresetPanel } from './preset-panel';

/**
 * Wires the session together from three independent parts — which language is
 * active, which preset the editor matches, and how far the loop has been
 * stepped — each owning its own state. This function only composes them and
 * hands out the DOM events.
 */
export const createController = (els: Elements): void => {
  const language = createLanguageController(els);
  const presetPanel = createPresetPanel(els, language.getTranslator);
  playback.initPlayback(els, language.getTranslator);

  /** Everything that reads the translator needs to redraw when it changes. */
  const refreshForLanguage = (): void => {
    language.applyStaticText();
    presetPanel.buildOptions();
    playback.retranslate();
  };

  const setLanguage = (lang: Lang): void => {
    language.setLanguage(lang);
    refreshForLanguage();
  };

  /** Reset means what it says: the preset comes back and edits are discarded. */
  const reset = (): void => {
    playback.returnToEditor();
    presetPanel.selectCurrent();
  };

  els.credits.textContent = `© ${new Date().getFullYear()} ${els.credits.textContent}`;
  els.load.addEventListener('click', playback.load);
  els.edit.addEventListener('click', playback.returnToEditor);
  els.reset.addEventListener('click', reset);
  els.step.addEventListener('click', playback.step);
  els.play.addEventListener('click', playback.togglePlay);
  els.finish.addEventListener('click', playback.finish);
  els.langEn.addEventListener('click', () => setLanguage('en'));
  els.langUk.addEventListener('click', () => setLanguage('uk'));
  els.preset.addEventListener('change', presetPanel.selectCurrent);
  els.code.addEventListener('input', presetPanel.syncToCode);

  refreshForLanguage();
  els.preset.value = DEFAULT_PRESET_ID;
  reset();
};
