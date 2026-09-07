/* SPDX-License-Identifier: AGPL-3.0-only */

// Deciding whether a translated handbook page is actually written in the
// language it claims to be.
//
// A local model asked for a language it is weak in answers in English and
// reports success, and a page of English prose filed under a locale route is
// worse than no page at all, because nothing downstream ever looks at it
// again. Two cheap signals catch that, and which one applies is decided by the
// locale's own script rather than by a list this module has to be told about:
//
//   * A locale whose language is written in a script of its own — Arabic,
//     Greek, Hebrew, Devanagari, Armenian, Cyrillic, Japanese, Korean, Han —
//     must return prose in that script. Product names and units stay Latin, so
//     the rule is only that the expected script is not swamped by Latin.
//   * A Latin-script locale is held to its own function words instead: a
//     translation that carries more English function words than its own has
//     not been translated.
//
// The English draft path is held to the mirror image of the same rule, so a
// model that answers an English request in another language is caught too.

import { COMMITTED_LOCALE_TAGS } from '../../src/common/i18n/locales.js';
import { proseText } from './markdown.mjs';

/** Function words of every Latin-script language the handbook may be translated into. */
const STOPWORDS = Object.freeze({
	cs: ['a', 'do', 'je', 'jako', 'jsou', 'na', 'nebo', 'není', 'po', 'pro', 'při', 's', 'se', 'to', 'v', 'z', 'že'],
	de: ['aber', 'auf', 'das', 'dem', 'den', 'der', 'die', 'ein', 'eine', 'für', 'ist', 'mit', 'nicht', 'oder', 'sie', 'sind', 'und', 'werden', 'wird', 'zu'],
	en: ['and', 'are', 'for', 'from', 'is', 'not', 'or', 'the', 'this', 'to', 'with', 'will'],
	es: ['con', 'del', 'el', 'en', 'es', 'la', 'las', 'los', 'no', 'para', 'por', 'que', 'se', 'son', 'un', 'una', 'y'],
	fi: ['ei', 'ja', 'kun', 'kuin', 'on', 'ovat', 'sen', 'se', 'tai', 'tämä', 'että', 'voit'],
	fr: ['dans', 'des', 'du', 'est', 'et', 'la', 'le', 'les', 'ne', 'ou', 'pas', 'pour', 'que', 'sont', 'sur', 'un', 'une', 'vous', 'avec'],
	gl: ['as', 'con', 'da', 'do', 'e', 'na', 'no', 'non', 'os', 'para', 'que', 'se', 'un', 'unha', 'é'],
	id: ['adalah', 'atau', 'dan', 'dari', 'dengan', 'ini', 'itu', 'ke', 'pada', 'tidak', 'untuk', 'yang'],
	it: ['che', 'con', 'del', 'di', 'e', 'il', 'la', 'le', 'nel', 'non', 'per', 'questo', 'si', 'sono', 'un', 'una', 'è'],
	nl: ['aan', 'dat', 'de', 'die', 'een', 'en', 'het', 'is', 'niet', 'of', 'op', 'te', 'van', 'voor', 'zijn'],
	pl: ['dla', 'do', 'i', 'jest', 'lub', 'na', 'nie', 'po', 'przez', 'się', 'są', 'to', 'w', 'z', 'że'],
	pt: ['as', 'com', 'da', 'das', 'do', 'dos', 'e', 'na', 'no', 'não', 'os', 'para', 'que', 'se', 'um', 'uma', 'é'],
	ro: ['care', 'cu', 'de', 'din', 'este', 'la', 'nu', 'pe', 'pentru', 'sau', 'sunt', 'un', 'în', 'şi', 'și'],
	tr: ['bir', 'bu', 'da', 'de', 'değil', 'için', 'ile', 'olan', 'olarak', 've', 'veya'],
	vi: ['các', 'cho', 'của', 'được', 'không', 'hoặc', 'là', 'này', 'trong', 'và', 'để'],
});

/**
 * The characters a locale's own script is written with. Chinese and Japanese
 * share Han, and Korean mixes Hangul with it, so the entry is what the prose
 * may be made of rather than one ISO 15924 code.
 */
const SCRIPT_PATTERNS = Object.freeze({
	Arab: /\p{Script=Arabic}/gu,
	Armn: /\p{Script=Armenian}/gu,
	Cyrl: /\p{Script=Cyrillic}/gu,
	Deva: /\p{Script=Devanagari}/gu,
	Grek: /\p{Script=Greek}/gu,
	Hans: /\p{Script=Han}/gu,
	Hant: /\p{Script=Han}/gu,
	Hebr: /\p{Script=Hebrew}/gu,
	Jpan: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu,
	Kore: /[\p{Script=Hangul}\p{Script=Han}]/gu,
});

const LATIN_PATTERN = /\p{Script=Latin}/gu;
/** Prose shorter than this says nothing about its language either way. */
const MINIMUM_PROSE_WORDS = 8;
/** How far one language's function words may lead another's before the page is not in it. */
const COMPETING_STOPWORD_RATIO = 2;
const MINIMUM_COMPETING_STOPWORDS = 3;

/** The locales a handbook page may be written in: English and every committed route locale. */
export function documentationLocales() {
	return COMMITTED_LOCALE_TAGS;
}

/** The language subtag whose function words or script a locale is held to. */
export function assertDocumentationLocale(locale) {
	if (!COMMITTED_LOCALE_TAGS.includes(locale)) {
		throw new Error(`Unsupported locale: ${locale}. Supported locales are ${COMMITTED_LOCALE_TAGS.join(', ')}.`);
	}
	return locale;
}

/** The script a locale's prose is expected to be written in, or null for Latin. */
export function expectedScriptPattern(locale) {
	const script = new Intl.Locale(locale).maximize().script;
	return Object.hasOwn(SCRIPT_PATTERNS, script) ? SCRIPT_PATTERNS[script] : null;
}

function count(text, pattern) {
	pattern.lastIndex = 0;
	return (text.match(pattern) ?? []).length;
}

function tally(words, language) {
	const stopwords = new Set(STOPWORDS[language] ?? []);
	return words.filter((word) => stopwords.has(word)).length;
}

function languageOf(locale) {
	return new Intl.Locale(locale).language;
}

function displayName(locale) {
	try {
		return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale) || locale;
	} catch {
		return locale;
	}
}

export function assertLocale(markdown, locale) {
	assertDocumentationLocale(locale);
	const text = proseText(markdown);
	const words = text.toLocaleLowerCase('en').match(/\p{L}+/gu) ?? [];
	if (words.length < MINIMUM_PROSE_WORDS) return;
	const script = expectedScriptPattern(locale);
	if (script) {
		const expected = count(text, script);
		const latin = count(text, LATIN_PATTERN);
		if (expected === 0 || latin > expected * COMPETING_STOPWORD_RATIO) {
			throw new Error(`Model response does not appear to use the expected ${displayName(locale)} locale.`);
		}
		return;
	}
	const language = languageOf(locale);
	const expected = tally(words, language);
	const competing = language === 'en'
		? Math.max(...Object.keys(STOPWORDS).filter((other) => other !== 'en').map((other) => tally(words, other)))
		: tally(words, 'en');
	if (competing >= MINIMUM_COMPETING_STOPWORDS && competing > expected * COMPETING_STOPWORD_RATIO) {
		throw new Error(`Model response does not appear to use the expected ${displayName(locale)} locale.`);
	}
}
