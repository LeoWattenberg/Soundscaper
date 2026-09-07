/* SPDX-License-Identifier: AGPL-3.0-only */

// Which locally installed model translates a given language.
//
// The project's translations — the editor's interface strings and the
// handbook's pages alike — are made by Ollama on the maintainer's own machine,
// and the choice of model is a property of the target language rather than of
// the thing being translated. Aya Expanse is the preferred translator and
// covers twenty-three languages; the rest fall to the general model, which is
// weaker at translation but speaks more languages. Both writers read this one
// module so a language is never translated by two different defaults.
//
// `scripts/i18n-ai/workflows.mjs` still carries its own copy of this choice
// while a separate change is in flight across that file. The two must agree —
// a handbook page and the interface strings it quotes are worthless to a
// reader if they were written by different translators — and
// `tests/docs-ai-config.test.js` fails the moment they stop agreeing.

/** The preferred translation model, and the one that covers the languages it does not. */
export const DEFAULT_TRANSLATION_MODEL = 'aya-expanse:32b';
export const FALLBACK_TRANSLATION_MODEL = 'qwen3.8:latest';

/** The languages Aya Expanse is trained on, by ISO 639-1 subtag. */
export const AYA_EXPANSE_LANGUAGES = Object.freeze([
	'ar', 'zh', 'cs', 'nl', 'en', 'fr', 'de', 'el', 'he', 'hi', 'id', 'it', 'ja', 'ko', 'fa', 'pl', 'pt', 'ro', 'ru', 'es', 'tr', 'uk', 'vi',
]);

const AYA_EXPANSE_LANGUAGE_SET = new Set(AYA_EXPANSE_LANGUAGES);

/** The model a locale is translated with when none is named: Aya where it speaks the language. */
export function defaultModelForLocale(locale) {
	return AYA_EXPANSE_LANGUAGE_SET.has(new Intl.Locale(locale).language)
		? DEFAULT_TRANSLATION_MODEL
		: FALLBACK_TRANSLATION_MODEL;
}
