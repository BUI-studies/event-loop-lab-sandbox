import { en, type TranslationKey } from './en';
import { uk } from './uk';

export type { TranslationKey };

export type Lang = 'en' | 'uk';

/** The lab is made for a Ukrainian audience; English is the fallback. */
export const DEFAULT_LANG: Lang = 'uk';

export const isLang = (value: unknown): value is Lang => value === 'en' || value === 'uk';

/**
 * A placeholder value. Nested `Msg` lets one message quote another, and an
 * array joins its parts with a comma, which covers every composite the loop
 * needs without any string concatenation in the engine.
 */
export type MsgParam = string | number | Msg | readonly MsgParam[];

export type MsgParams = Readonly<Record<string, MsgParam>>;

/**
 * A message the engine can emit without knowing any language: a key plus its
 * placeholders. Translation happens at paint time, which is what lets the
 * language toggle relabel items that are already sitting in the queues.
 */
export interface Msg {
  readonly key: TranslationKey;
  readonly params?: MsgParams;
}

/**
 * A label that is either translatable prose or a verbatim identifier.
 * Identifiers (`Promise#3`, `fetch(/users)`, `Promise.all[3]`) are code, not
 * copy, so they stay in whatever language the code was written in.
 */
export type Text = string | Msg;

/** Terse constructor, because the engine builds these by the dozen. */
export const msg = (key: TranslationKey, params?: MsgParams): Msg => ({ key, params });

export interface Translator {
  readonly lang: Lang;
  /** Look up a key and interpolate its placeholders. */
  t(key: TranslationKey, params?: MsgParams): string;
  /** Resolve either half of the `Text` union to a display string. */
  resolve(text: Text): string;
}

const DICTIONARIES: Record<Lang, Record<TranslationKey, string>> = { en, uk };

export const createTranslator = (lang: Lang): Translator => {
  const dictionary = DICTIONARIES[lang];

  // Declarations, not arrow consts: `t` and `resolve` are mutually recursive
  // so that a placeholder can itself be a message.
  function t(key: TranslationKey, params?: MsgParams): string {
    const template = dictionary[key] ?? en[key] ?? key;
    if (!params) return template;
    return Object.entries(params).reduce(
      (filled, [name, value]) => filled.split(`{${name}}`).join(resolveParam(value)),
      template,
    );
  }

  function resolve(text: Text): string {
    return typeof text === 'string' ? text : t(text.key, text.params);
  }

  function resolveParam(value: MsgParam): string {
    if (Array.isArray(value)) return value.map(resolveParam).join(', ');
    return typeof value === 'number' ? String(value) : resolve(value as Text);
  }

  return { lang, t, resolve };
};
