import { createTranslator, type Lang, type Translator, type TranslationKey } from '../i18n';
import { loadLang, saveLang } from './preferences';
import { escapeHtml, type Elements } from './dom';

const LEGEND: readonly (readonly [cssVar: string, key: TranslationKey])[] = [
  ['--stack', 'legStack'],
  ['--task', 'legTask'],
  ['--micro', 'legMicro'],
  ['--webapi', 'legWeb'],
  ['--heapc', 'legHeap'],
];

export interface LanguageController {
  getTranslator(): Translator;
  setLanguage(lang: Lang): void;
  /** Redraws every label that is static prose, independent of the run in progress. */
  applyStaticText(): void;
}

/** Owns which language is active and every piece of chrome that is plain, static prose. */
export const createLanguageController = (els: Elements): LanguageController => {
  const staticText: readonly (readonly [HTMLElement, TranslationKey])[] = [
    [els.title, 'title'],
    [els.subtitle, 'sub'],
    [els.yourCode, 'yourcode'],
    [els.pace, 'pace'],
    [els.consoleTitle, 'console'],
    [els.traceTitle, 'trace'],
    [els.stackTitle, 'stack'],
    [els.webTitle, 'web'],
    [els.microTitle, 'micro'],
    [els.macroTitle, 'macro'],
    [els.heapTitle, 'heap'],
    [els.load, 'load'],
    [els.step, 'step'],
    [els.finish, 'finish'],
    [els.edit, 'edit'],
    [els.reset, 'reset'],
  ];

  let translator: Translator = createTranslator(loadLang());

  const applyStaticText = (): void => {
    document.documentElement.lang = translator.lang;
    for (const [el, key] of staticText) el.textContent = translator.t(key);

    // The note is the one string that carries markup, hence innerHTML.
    els.note.innerHTML = translator.t('note');
    els.legend.innerHTML = LEGEND.map(
      ([cssVar, key]) =>
        `<span><i class="dot" style="background:var(${cssVar})"></i> ${escapeHtml(translator.t(key))}</span>`,
    ).join('');

    els.langEn.setAttribute('aria-pressed', String(translator.lang === 'en'));
    els.langUk.setAttribute('aria-pressed', String(translator.lang === 'uk'));
  };

  const setLanguage = (lang: Lang): void => {
    translator = createTranslator(lang);
    saveLang(lang);
    applyStaticText();
  };

  return { getTranslator: () => translator, setLanguage, applyStaticText };
};
