/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact text edge for the pinned facebook/wav2vec2-base-960h CTC vocabulary. */

export const ASSISTANCE_WAV2VEC2_BASE_960H_VOCABULARY_V1 = Object.freeze([
	'<pad>', '<s>', '</s>', '<unk>', '|', 'E', 'T', 'A', 'O', 'N', 'I', 'H', 'S',
	'R', 'D', 'L', 'U', 'M', 'W', 'C', 'F', 'G', 'Y', 'P', 'B', 'V', 'K', "'",
	'X', 'J', 'Q', 'Z',
] as const);

export const ASSISTANCE_WAV2VEC2_BASE_960H_BLANK_TOKEN_ID = 0;
export const ASSISTANCE_WAV2VEC2_BASE_960H_UNKNOWN_TOKEN_ID = 3;
export const ASSISTANCE_WAV2VEC2_BASE_960H_FRAME_STRIDE_SAMPLES = 320;

const MAXIMUM_SEGMENT_TEXT_UNITS = 16_384;
const MAXIMUM_WORD_TEXT_UNITS = 512;
const MAXIMUM_WORDS_PER_SEGMENT = 1_000;
const WHITESPACE = /\p{White_Space}+/u;
const BOUNDARY_WHITESPACE = /^\p{White_Space}+|\p{White_Space}+$/gu;
const ANY_WHITESPACE = /\p{White_Space}/u;
const MARK = /\p{Mark}/u;
const PUNCTUATION = /\p{Punctuation}/u;
const FORBIDDEN_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const CURLY_APOSTROPHE = /[\u02bc\u2018\u2019\uff07]/gu;

const TOKEN_IDS = new Map<string, number>(
	ASSISTANCE_WAV2VEC2_BASE_960H_VOCABULARY_V1.map((token, index) => [token, index]),
);

/**
 * Split the Whisper segment text once. Exact spelling, case, and punctuation
 * remain the transcript identity; only Unicode whitespace is structural.
 */
export function splitAssistanceWav2Vec2EnglishSegmentWordsV1(
	value: unknown,
): readonly string[] {
	if (typeof value !== 'string' || value.length < 1
		|| value.length > MAXIMUM_SEGMENT_TEXT_UNITS || FORBIDDEN_CONTROL.test(value)) {
		throw new TypeError('The English alignment segment text is invalid or oversized.');
	}
	const trimmed = value.replace(BOUNDARY_WHITESPACE, '');
	if (trimmed === '') throw new TypeError('English alignment requires at least one transcript word.');
	const words = trimmed.split(WHITESPACE);
	if (words.length < 1 || words.length > MAXIMUM_WORDS_PER_SEGMENT
		|| words.some((word) => word.length < 1 || word.length > MAXIMUM_WORD_TEXT_UNITS)) {
		throw new RangeError('The English alignment transcript word inventory exceeds its bound.');
	}
	return Object.freeze(words);
}

/**
 * Normalize one preserved transcript word for the uppercase LibriSpeech label
 * inventory. Diacritics and punctuation do not invent CTC states; a word with
 * no supported speech symbol receives the model's exact unknown token once.
 */
export function tokenizeAssistanceWav2Vec2EnglishWordV1(value: unknown): readonly number[] {
	if (typeof value !== 'string' || value.length < 1 || value.length > MAXIMUM_WORD_TEXT_UNITS
		|| ANY_WHITESPACE.test(value) || FORBIDDEN_CONTROL.test(value)) {
		throw new TypeError('The English alignment word text is invalid.');
	}
	const normalized = value.normalize('NFKD').toUpperCase().replace(CURLY_APOSTROPHE, "'");
	const tokens: number[] = [];
	let unknownRun = false;
	for (const character of normalized) {
		if (MARK.test(character) || PUNCTUATION.test(character) && character !== "'") continue;
		const tokenId = TOKEN_IDS.get(character);
		if (tokenId !== undefined && tokenId >= 5) {
			tokens.push(tokenId);
			unknownRun = false;
		} else if (!unknownRun) {
			tokens.push(ASSISTANCE_WAV2VEC2_BASE_960H_UNKNOWN_TOKEN_ID);
			unknownRun = true;
		}
	}
	if (tokens.length === 0) tokens.push(ASSISTANCE_WAV2VEC2_BASE_960H_UNKNOWN_TOKEN_ID);
	return Object.freeze(tokens);
}
