/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * International Morse code, as specified by ITU-R M.1677-1: the letters and
 * figures of its first table, the punctuation and miscellaneous signs of its
 * second, and the unit timing of its section 2 — a dash is three dots long, the
 * gap between the dots and dashes of one character is a dot, the gap between
 * characters is three dots, and the gap between words is seven.
 */

export type MorseCodeWords = readonly (readonly string[])[];

export interface MorseCodeSegment {
	readonly tone: boolean;
	readonly units: number;
}

export interface MorseCodeSummary {
	readonly empty: boolean;
	readonly unsupported: readonly string[];
	readonly code: string;
	readonly dotSeconds: number;
	readonly durationSeconds: number;
}

export const MORSE_CODE_ALPHABET: Readonly<Record<string, string>> = Object.freeze({
	A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.',
	G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..',
	M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
	S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
	Y: '-.--', Z: '--..',
	'0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
	'5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
	'.': '.-.-.-', ',': '--..--', ':': '---...', '?': '..--..',
	"'": '.----.', '-': '-....-', '/': '-..-.', '(': '-.--.',
	')': '-.--.-', '"': '.-..-.', '=': '-...-', '+': '.-.-.',
	'@': '.--.-.', '!': '-.-.--', '&': '.-...', ';': '-.-.-.',
	'_': '..--.-', '$': '...-..-',
});

export const MORSE_CODE_UNITS = Object.freeze({
	dot: 1,
	dash: 3,
	symbolGap: 1,
	characterGap: 3,
	wordGap: 7,
});

// "PARIS", the standard word, is fifty units long counting the word gap that
// follows it, so a speed in words per minute fixes the length of one dot.
const UNITS_PER_STANDARD_WORD = 50;

/** The length of one Morse time unit at a PARIS-standard speed, in seconds. */
export function morseCodeDotSeconds(wordsPerMinute: unknown): number {
	const speed = Number(wordsPerMinute);
	if (!Number.isFinite(speed) || speed <= 0) throw new RangeError('wordsPerMinute must be a positive number.');
	return 60 / (UNITS_PER_STANDARD_WORD * speed);
}

/** The characters of a message Morse code has no signal for, in order of first appearance. */
export function morseCodeUnsupportedCharacters(text: unknown): readonly string[] {
	const seen = new Set<string>();
	for (const character of String(text ?? '').toUpperCase()) {
		if (!/\s/u.test(character) && !MORSE_CODE_ALPHABET[character]) seen.add(character);
	}
	return Object.freeze([...seen]);
}

/** Split a message into words of encoded characters, rejecting anything unsendable. */
export function encodeMorseCode(text: unknown): MorseCodeWords {
	const words = String(text ?? '').toUpperCase().trim().split(/\s+/u).filter(Boolean);
	if (!words.length) throw new RangeError('A Morse message must contain at least one character.');
	return Object.freeze(words.map((word) => Object.freeze([...word].map((character) => {
		const code = MORSE_CODE_ALPHABET[character];
		if (!code) throw new RangeError(`Morse message contains an unsupported character: ${character}.`);
		return code;
	}))));
}

/** Write encoded words the way Morse is transcribed: characters spaced, words divided by a slash. */
export function morseCodeText(words: MorseCodeWords): string {
	return words.map((characters) => characters.join(' ')).join(' / ');
}

/**
 * The keying schedule of an encoded message: alternating tone and gap runs
 * measured in Morse time units, with no gap before the first character or
 * after the last. The seven units between words replace the three that would
 * otherwise separate their characters rather than adding to them.
 */
export function morseCodeKeying(words: MorseCodeWords): readonly MorseCodeSegment[] {
	const segments: MorseCodeSegment[] = [];
	words.forEach((characters, wordIndex) => {
		if (wordIndex) segments.push(Object.freeze({ tone: false, units: MORSE_CODE_UNITS.wordGap }));
		characters.forEach((code, characterIndex) => {
			if (characterIndex) segments.push(Object.freeze({ tone: false, units: MORSE_CODE_UNITS.characterGap }));
			[...code].forEach((symbol, symbolIndex) => {
				if (symbolIndex) segments.push(Object.freeze({ tone: false, units: MORSE_CODE_UNITS.symbolGap }));
				segments.push(Object.freeze({
					tone: true,
					units: symbol === '-' ? MORSE_CODE_UNITS.dash : MORSE_CODE_UNITS.dot,
				}));
			});
		});
	});
	return Object.freeze(segments);
}

/** The length of an encoded message in Morse time units. */
export function morseCodeUnitCount(words: MorseCodeWords): number {
	return morseCodeKeying(words).reduce((total, segment) => total + segment.units, 0);
}

/**
 * Everything a dialog needs to preview a message before generating it. Unlike
 * the encoder this never throws: a half-typed message reports what is wrong
 * with it instead, so the preview survives every keystroke.
 */
export function summarizeMorseCode(text: unknown, wordsPerMinute: unknown): MorseCodeSummary {
	const unsupported = morseCodeUnsupportedCharacters(text);
	const empty = !String(text ?? '').trim();
	const words = empty || unsupported.length ? [] : encodeMorseCode(text);
	const speed = Number(wordsPerMinute);
	const dotSeconds = Number.isFinite(speed) && speed > 0 ? morseCodeDotSeconds(speed) : 0;
	return Object.freeze({
		empty,
		unsupported,
		code: words.length ? morseCodeText(words) : '',
		dotSeconds,
		durationSeconds: (words.length ? morseCodeUnitCount(words) : 0) * dotSeconds,
	});
}
