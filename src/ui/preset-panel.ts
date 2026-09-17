import type { Translator } from '../i18n';
import { DEFAULT_PRESET_ID, findPreset, PRESETS } from '../presets';
import { escapeHtml, type Elements } from './dom';

/** The empty value means "none of the presets", i.e. code you typed yourself. */
const CUSTOM = '';

export interface PresetPanel {
  /** Rebuilds the dropdown's option labels, e.g. after a language switch. */
  buildOptions(): void;
  /** A no-op on the custom option, so picking it never wipes what you wrote. */
  selectCurrent(): void;
  /** Call after the editor's text changes, to keep the dropdown honest. */
  syncToCode(): void;
}

/** Owns the preset dropdown and which preset (if any) the editor's text still matches. */
export const createPresetPanel = (els: Elements, translator: () => Translator): PresetPanel => {
  /** Which preset the editor's text came from, so edits can be undone back to it. */
  let sourcePreset = DEFAULT_PRESET_ID;

  const buildOptions = (): void => {
    const selected = els.preset.value;
    els.preset.innerHTML = [
      `<option value="${CUSTOM}">${escapeHtml(translator().t('presetCustom'))}</option>`,
      ...PRESETS.map(
        (preset) =>
          `<option value="${preset.id}">${escapeHtml(translator().t(preset.nameKey))}</option>`,
      ),
    ].join('');
    els.preset.value = selected;
  };

  const selectCurrent = (): void => {
    const preset = findPreset(els.preset.value);
    if (!preset) return;
    sourcePreset = preset.id;
    els.code.value = preset.code;
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
  const syncToCode = (): void => {
    const origin = findPreset(sourcePreset);
    if (!origin) return;
    els.preset.value = els.code.value === origin.code ? origin.id : CUSTOM;
  };

  return { buildOptions, selectCurrent, syncToCode };
};
