import { DEFAULT_LANG, isLang, type Lang } from '../i18n';

const LANG_KEY = 'event-loop-lab:lang';

/**
 * Reading or writing localStorage throws in private mode and when storage is
 * disabled outright, so every access is guarded: a lab that will not start
 * because it could not remember a preference is worse than one that forgets.
 */
export const loadLang = (): Lang => {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    return isLang(stored) ? stored : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
};

export const saveLang = (lang: Lang): void => {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Preference is lost for this session. Not worth interrupting anyone over.
  }
};
