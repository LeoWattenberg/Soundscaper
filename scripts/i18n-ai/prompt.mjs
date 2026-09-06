/* SPDX-License-Identifier: AGPL-3.0-only */

// The closed request one batch of catalog keys is translated through, and the
// reading of the model's answer. The packet carries the English messages, the
// human German translations of the same keys as a meaning reference, and the
// Audacity-reviewed glossary for the target language; the answer must return
// exactly the requested keys, and every value is held to the same predicate
// the runtime applies before it shows a machine translation.

import { asInvalidModelOutput } from '../docs-ai/generation.mjs';
import {
	acceptableMachineTranslation,
	protectedTokens,
	sameNamedPlaceholders,
} from '../../src/common/i18n/machine-catalog.js';

export const MACHINE_TRANSLATION_PROMPT_VERSION = 'i18n-machine-v1';

export const MACHINE_TRANSLATION_SYSTEM_PROMPT = `You translate the user-interface strings of Soundscaper, a browser-based multitrack audio and video editor in the tradition of Audacity, from English into the requested language.
The request is a closed packet. Translate every entry of "messages" and nothing else. Return JSON with exactly two fields: "locale", the requested target locale, and "translations", an object with exactly the same keys as "messages" whose values are the translated strings.
Rules:
- Keep every placeholder written as {name} exactly as it appears in the English, with the same name, the same number of times.
- Keep product names (Soundscaper, Framescaper, Audacity, Nyquist, StaffPad), file formats, codec names, units such as dB, Hz, kHz, LUFS, BPM, ms and px, and keyboard key names, unless the target language has an established translation for them.
- Never use an ellipsis character or three dots. Never add, remove, soften, strengthen or explain anything. Keep a string that is only a product name, unit, symbol or abbreviation unchanged.
- Write in the register of professional audio software in the target language: concise, imperative for commands, following that language's user-interface conventions for capitalisation and punctuation.
- "glossary" lists translations reviewed by Audacity's translators for this language. Use their wording for the same terms wherever it applies.
- "reference" gives the reviewed German translation of the same message. Use it only to resolve what the English means; translate from the English, not from the German.`;

const MAXIMUM_TRANSLATION_GROWTH = 3;

export function translationPacket({ targetLocale, targetLanguage, glossary = [], reference = {}, messages }) {
	return JSON.stringify({
		sourceLocale: 'en',
		targetLocale,
		targetLanguage,
		glossary: glossary.map(({ english, translation }) => ({ english, translation })),
		reference,
		messages,
	});
}

/** English display name of a locale for the packet; the model reads names better than tags. */
export function targetLanguageName(locale) {
	try {
		return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale) || locale;
	} catch {
		return locale;
	}
}

/** Read a batch answer: exact key set, strings, acceptable against their English source. */
export function validateTranslationResponse(response, { targetLocale, messages }) {
	try {
		if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('The response must be a JSON object.');
		if (response.locale !== targetLocale) throw new Error(`The response locale must be "${targetLocale}".`);
		const translations = response.translations;
		if (!translations || typeof translations !== 'object' || Array.isArray(translations)) {
			throw new Error('The response must carry a "translations" object.');
		}
		const expected = Object.keys(messages);
		const received = Object.keys(translations);
		const missing = expected.filter((key) => !Object.hasOwn(translations, key));
		if (missing.length) throw new Error(`Missing translations for: ${missing.slice(0, 5).join(', ')}.`);
		const unexpected = received.filter((key) => !Object.hasOwn(messages, key));
		if (unexpected.length) throw new Error(`Unexpected keys: ${unexpected.slice(0, 5).join(', ')}.`);
		const result = {};
		for (const key of expected) {
			const source = messages[key];
			const raw = translations[key];
			if (typeof raw !== 'string') throw new Error(`"${key}" must be a string.`);
			const translation = raw.trim();
			if (!translation) throw new Error(`"${key}" must not be empty.`);
			if (/…|\.\.\./u.test(translation)) throw new Error(`"${key}" must not contain an ellipsis.`);
			if (source.split('\n').length !== translation.split('\n').length) {
				throw new Error(source.includes('\n') ? `"${key}" must keep the line breaks of its English.` : `"${key}" must stay on one line.`);
			}
			if (!sameNamedPlaceholders(source, translation)) throw new Error(`"${key}" must keep the placeholders of ${JSON.stringify(source)}.`);
			const tokens = protectedTokens(source).filter((token) => !translation.includes(token));
			if (tokens.length) throw new Error(`"${key}" must keep ${tokens.join(', ')} unchanged.`);
			if (!acceptableMachineTranslation(source, translation)) throw new Error(`"${key}" is not an acceptable translation of ${JSON.stringify(source)}.`);
			if (translation.length > Math.max(source.length * MAXIMUM_TRANSLATION_GROWTH, source.length + 40)) {
				throw new Error(`"${key}" is far longer than its English.`);
			}
			result[key] = translation;
		}
		return result;
	} catch (error) {
		throw asInvalidModelOutput(error);
	}
}
