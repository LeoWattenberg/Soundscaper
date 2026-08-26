/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic execution of the tokenizer shipped with nomic-embed-text-v1.5. */

import type { AssistanceTokenizerV1 } from './transcript-indexing-v1.ts';

export const ASSISTANCE_NOMIC_EMBEDDING_DIMENSIONS = 768 as const;

export interface AssistanceNomicTokenizerArtifactsV1 {
	readonly tokenizer: Uint8Array;
	readonly tokenizerConfig: Uint8Array;
	readonly specialTokensMap: Uint8Array;
	readonly config: Uint8Array;
}

export interface AssistanceNomicTokenizerV1 extends AssistanceTokenizerV1 {
	readonly specialTokenIds: Readonly<{
		readonly pad: 0;
		readonly unknown: 100;
		readonly classification: 101;
		readonly separator: 102;
		readonly mask: 103;
	}>;
	readonly embeddingDimensions: typeof ASSISTANCE_NOMIC_EMBEDDING_DIMENSIONS;
}

interface JsonObject { readonly [key: string]: unknown }

const MAXIMUM_TOKENIZER_BYTES = 16 * 1024 * 1024;
const MAXIMUM_CONFIG_BYTES = 1024 * 1024;
const MAXIMUM_TEXT_CHARACTERS = 4_000_000;
const MAXIMUM_TOKEN_ID = 30_527;
const MAXIMUM_WORD_CHARACTERS = 100;
const CONTINUING_PREFIX = '##';
const SPECIAL_TOKENS = Object.freeze([
	Object.freeze({ token: '[PAD]', id: 0 }),
	Object.freeze({ token: '[UNK]', id: 100 }),
	Object.freeze({ token: '[CLS]', id: 101 }),
	Object.freeze({ token: '[SEP]', id: 102 }),
	Object.freeze({ token: '[MASK]', id: 103 }),
]);
const SPECIAL_IDS = Object.freeze({
	pad: 0 as const, unknown: 100 as const, classification: 101 as const,
	separator: 102 as const, mask: 103 as const,
});
const WHITESPACE = /\p{White_Space}/u;
const OTHER = /\p{C}/u;
const PUNCTUATION = /\p{P}/u;
const NONSPACING_MARK = /\p{Mn}/u;

/**
 * Executes only the local artifacts pinned at nomic-ai/nomic-embed-text-v1.5
 * revision e9b6763023c676ca8431644204f50c2b100d9aab. Artifact authentication
 * remains owned by the signed catalog and the worker's exact file grant.
 * https://huggingface.co/nomic-ai/nomic-embed-text-v1.5/tree/e9b6763023c676ca8431644204f50c2b100d9aab
 * BERT semantics: https://github.com/huggingface/tokenizers/blob/v0.15.0/tokenizers/src/normalizers/bert.rs
 */
export function createAssistanceNomicTokenizerV1(
	artifacts: AssistanceNomicTokenizerArtifactsV1,
): AssistanceNomicTokenizerV1 {
	const tokenizer = jsonObject(artifacts?.tokenizer, MAXIMUM_TOKENIZER_BYTES, 'tokenizer');
	const tokenizerConfig = jsonObject(artifacts?.tokenizerConfig,
		MAXIMUM_CONFIG_BYTES, 'tokenizer config');
	const specialTokensMap = jsonObject(artifacts?.specialTokensMap,
		MAXIMUM_CONFIG_BYTES, 'special-tokens map');
	const config = jsonObject(artifacts?.config, MAXIMUM_CONFIG_BYTES, 'model config');
	const vocab = validateTokenizer(tokenizer);
	validateTokenizerConfig(tokenizerConfig);
	validateSpecialTokensMap(specialTokensMap);
	validateModelConfig(config);

	return Object.freeze({
		specialTokenIds: SPECIAL_IDS,
		embeddingDimensions: ASSISTANCE_NOMIC_EMBEDDING_DIMENSIONS,
		encode(value: string): readonly number[] {
			if (typeof value !== 'string' || value.length > MAXIMUM_TEXT_CHARACTERS) {
				throw new RangeError('Nomic tokenizer text exceeds its exact character bound.');
			}
			const result: number[] = [];
			for (const part of splitSpecialTokens(value)) {
				if (part.special !== null) {
					result.push(part.special);
					continue;
				}
				for (const word of basicTokens(part.text)) appendWordPiece(result, word, vocab);
				if (result.length > MAXIMUM_TEXT_CHARACTERS) {
					throw new RangeError('Nomic tokenizer output exceeds its exact token bound.');
				}
			}
			return Object.freeze(result);
		},
	});
}

function validateTokenizer(root: JsonObject): ReadonlyMap<string, number> {
	if (root.version !== '1.0' || root.truncation !== null || root.padding !== null) {
		throw new TypeError('The nomic tokenizer version or implicit length processing is invalid.');
	}
	const normalizer = object(root.normalizer, 'tokenizer normalizer');
	if (normalizer.type !== 'BertNormalizer' || normalizer.clean_text !== true
		|| normalizer.handle_chinese_chars !== true || normalizer.strip_accents !== null
		|| normalizer.lowercase !== true) {
		throw new TypeError('The nomic tokenizer Bert normalizer semantics are invalid.');
	}
	const preTokenizer = object(root.pre_tokenizer, 'tokenizer pre-tokenizer');
	if (preTokenizer.type !== 'BertPreTokenizer') {
		throw new TypeError('The nomic tokenizer requires its exact BERT pre-tokenizer.');
	}
	const decoder = object(root.decoder, 'tokenizer decoder');
	if (decoder.type !== 'WordPiece' || decoder.prefix !== CONTINUING_PREFIX
		|| decoder.cleanup !== true) {
		throw new TypeError('The nomic tokenizer WordPiece decoder semantics are invalid.');
	}
	validatePostProcessor(object(root.post_processor, 'tokenizer post-processor'));
	validateAddedTokens(root.added_tokens);
	const model = object(root.model, 'tokenizer model');
	if (model.type !== 'WordPiece' || model.unk_token !== '[UNK]'
		|| model.continuing_subword_prefix !== CONTINUING_PREFIX
		|| model.max_input_chars_per_word !== MAXIMUM_WORD_CHARACTERS) {
		throw new TypeError('The nomic tokenizer WordPiece model semantics are invalid.');
	}
	const rawVocab = object(model.vocab, 'tokenizer vocabulary');
	const vocab = new Map<string, number>();
	const ids = new Set<number>();
	for (const [token, candidate] of Object.entries(rawVocab)) {
		if (token === '' || !Number.isSafeInteger(candidate) || Number(candidate) < 0
			|| Number(candidate) > MAXIMUM_TOKEN_ID || ids.has(Number(candidate))) {
			throw new TypeError('The nomic tokenizer vocabulary is ambiguous or invalid.');
		}
		vocab.set(token, Number(candidate));
		ids.add(Number(candidate));
	}
	for (const { token, id } of SPECIAL_TOKENS) {
		if (vocab.get(token) !== id) {
			throw new TypeError('The nomic tokenizer vocabulary changed a required special token.');
		}
	}
	return vocab;
}

function validatePostProcessor(value: JsonObject): void {
	if (value.type !== 'TemplateProcessing') {
		throw new TypeError('The nomic tokenizer post-processor type is invalid.');
	}
	const single = array(value.single, 'tokenizer single template');
	if (single.length !== 3 || !specialTemplate(single[0], '[CLS]', 0)
		|| !sequenceTemplate(single[1], 'A', 0) || !specialTemplate(single[2], '[SEP]', 0)) {
		throw new TypeError('The nomic tokenizer single-sequence template is invalid.');
	}
	const pair = array(value.pair, 'tokenizer pair template');
	if (pair.length !== 5 || !specialTemplate(pair[0], '[CLS]', 0)
		|| !sequenceTemplate(pair[1], 'A', 0) || !specialTemplate(pair[2], '[SEP]', 0)
		|| !sequenceTemplate(pair[3], 'B', 1) || !specialTemplate(pair[4], '[SEP]', 1)) {
		throw new TypeError('The nomic tokenizer pair-sequence template is invalid.');
	}
	const tokens = object(value.special_tokens, 'tokenizer template special tokens');
	for (const { token, id } of SPECIAL_TOKENS.slice(2, 4)) {
		const candidate = object(tokens[token], `tokenizer template ${token}`);
		if (candidate.id !== token || !sameArray(candidate.ids, [id])
			|| !sameArray(candidate.tokens, [token])) {
			throw new TypeError('The nomic tokenizer template special-token binding is invalid.');
		}
	}
}

function validateAddedTokens(value: unknown): void {
	const entries = array(value, 'tokenizer added tokens');
	if (entries.length !== SPECIAL_TOKENS.length) {
		throw new TypeError('The nomic tokenizer added-token inventory is invalid.');
	}
	for (const expected of SPECIAL_TOKENS) {
		const matches = entries.filter((entry) => {
			const candidate = object(entry, 'tokenizer added token');
			return candidate.content === expected.token && candidate.id === expected.id
				&& candidate.special === true && candidate.normalized === false
				&& candidate.single_word === false && candidate.lstrip === false
				&& candidate.rstrip === false;
		});
		if (matches.length !== 1) {
			throw new TypeError('The nomic tokenizer added-token identity is invalid.');
		}
	}
}

function validateTokenizerConfig(value: JsonObject): void {
	if (value.tokenizer_class !== 'BertTokenizer' || value.do_lower_case !== true
		|| value.strip_accents !== null || value.tokenize_chinese_chars !== true
		|| value.model_max_length !== 8192 || value.clean_up_tokenization_spaces !== true) {
		throw new TypeError('The nomic tokenizer config semantics are invalid.');
	}
	const bindings = Object.freeze({
		pad_token: '[PAD]', unk_token: '[UNK]', cls_token: '[CLS]',
		sep_token: '[SEP]', mask_token: '[MASK]',
	});
	for (const [key, token] of Object.entries(bindings)) {
		if (value[key] !== token) throw new TypeError('The nomic tokenizer config token binding is invalid.');
	}
	const decoder = object(value.added_tokens_decoder, 'tokenizer added-token decoder');
	for (const { token, id } of SPECIAL_TOKENS) {
		const candidate = object(decoder[String(id)], 'tokenizer decoded special token');
		if (candidate.content !== token || candidate.special !== true
			|| candidate.normalized !== false || candidate.single_word !== false
			|| candidate.lstrip !== false || candidate.rstrip !== false) {
			throw new TypeError('The nomic tokenizer decoded special-token binding is invalid.');
		}
	}
}

function validateSpecialTokensMap(value: JsonObject): void {
	const bindings = Object.freeze({
		pad_token: '[PAD]', unk_token: '[UNK]', cls_token: '[CLS]',
		sep_token: '[SEP]', mask_token: '[MASK]',
	});
	for (const [key, expected] of Object.entries(bindings)) {
		const candidate = object(value[key], 'tokenizer special-token map entry');
		if (candidate.content !== expected || candidate.normalized !== false
			|| candidate.single_word !== false || candidate.lstrip !== false
			|| candidate.rstrip !== false) {
			throw new TypeError('The nomic tokenizer special-token map is invalid.');
		}
	}
}

function validateModelConfig(value: JsonObject): void {
	if (value.model_type !== 'nomic_bert' || !sameArray(value.architectures, ['NomicBertModel'])
		|| value.hidden_size !== ASSISTANCE_NOMIC_EMBEDDING_DIMENSIONS
		|| value.n_embd !== ASSISTANCE_NOMIC_EMBEDDING_DIMENSIONS
		|| value.type_vocab_size !== 2 || value.pad_token_id !== SPECIAL_IDS.pad
		|| value.vocab_size !== 30_528 || value.torch_dtype !== 'float32'
		|| value.max_position_embeddings !== 2048 || value.n_positions !== 8192) {
		throw new TypeError('The nomic model config does not bind the exact 768-dimensional BERT graph.');
	}
}

function splitSpecialTokens(value: string): readonly Readonly<{
	readonly text: string;
	readonly special: number | null;
}>[] {
	const result: Array<{ text: string; special: number | null }> = [];
	let start = 0;
	while (start < value.length) {
		let foundIndex = value.length;
		let found: (typeof SPECIAL_TOKENS)[number] | null = null;
		for (const candidate of SPECIAL_TOKENS) {
			const index = value.indexOf(candidate.token, start);
			if (index >= 0 && index < foundIndex) { foundIndex = index; found = candidate; }
		}
		if (found === null) break;
		if (foundIndex > start) result.push({ text: value.slice(start, foundIndex), special: null });
		result.push({ text: found.token, special: found.id });
		start = foundIndex + found.token.length;
	}
	if (start < value.length) result.push({ text: value.slice(start), special: null });
	return result;
}

function basicTokens(value: string): readonly string[] {
	let normalized = '';
	for (const character of value) {
		const codePoint = character.codePointAt(0)!;
		if (codePoint === 0 || codePoint === 0xfffd || isControl(character)) {
			continue;
		}
		if (WHITESPACE.test(character)) { normalized += ' '; continue; }
		if (isChinese(codePoint)) normalized += ` ${character} `;
		else normalized += character;
	}
	normalized = normalized.normalize('NFD');
	let stripped = '';
	for (const character of normalized) if (!NONSPACING_MARK.test(character)) stripped += character;
	stripped = stripped.toLowerCase();
	const tokens: string[] = [];
	let current = '';
	for (const character of stripped) {
		if (WHITESPACE.test(character)) {
			if (current !== '') tokens.push(current);
			current = '';
		} else if (isPunctuation(character)) {
			if (current !== '') tokens.push(current);
			tokens.push(character);
			current = '';
		} else current += character;
	}
	if (current !== '') tokens.push(current);
	return tokens;
}

function appendWordPiece(target: number[], token: string, vocab: ReadonlyMap<string, number>): void {
	const characters = Array.from(token);
	if (characters.length > MAXIMUM_WORD_CHARACTERS) { target.push(SPECIAL_IDS.unknown); return; }
	let start = 0;
	const pieces: number[] = [];
	while (start < characters.length) {
		let end = characters.length;
		let found: number | undefined;
		while (start < end) {
			const candidate = `${start === 0 ? '' : CONTINUING_PREFIX}${characters.slice(start, end).join('')}`;
			found = vocab.get(candidate);
			if (found !== undefined) break;
			end -= 1;
		}
		if (found === undefined) { target.push(SPECIAL_IDS.unknown); return; }
		pieces.push(found);
		start = end;
	}
	target.push(...pieces);
}

function isPunctuation(value: string): boolean {
	const code = value.codePointAt(0)!;
	return code >= 33 && code <= 47 || code >= 58 && code <= 64
		|| code >= 91 && code <= 96 || code >= 123 && code <= 126 || PUNCTUATION.test(value);
}

function isControl(value: string): boolean {
	return value !== '\t' && value !== '\n' && value !== '\r' && OTHER.test(value);
}

function isChinese(code: number): boolean {
	return code >= 0x4e00 && code <= 0x9fff || code >= 0x3400 && code <= 0x4dbf
		|| code >= 0x20000 && code <= 0x2a6df || code >= 0x2a700 && code <= 0x2b73f
		|| code >= 0x2b740 && code <= 0x2b81f || code >= 0x2b920 && code <= 0x2ceaf
		|| code >= 0xf900 && code <= 0xfaff || code >= 0x2f800 && code <= 0x2fa1f;
}

function jsonObject(value: Uint8Array, maximum: number, label: string): JsonObject {
	if (!(value instanceof Uint8Array) || value.byteLength < 2 || value.byteLength > maximum) {
		throw new RangeError(`The nomic ${label} artifact exceeds its exact byte bound.`);
	}
	let text: string;
	try { text = new TextDecoder('utf-8', { fatal: true }).decode(value); }
	catch { throw new TypeError(`The nomic ${label} artifact is not valid UTF-8.`); }
	let parsed: unknown;
	try { parsed = JSON.parse(text) as unknown; }
	catch { throw new TypeError(`The nomic ${label} artifact is not valid JSON.`); }
	return object(parsed, `nomic ${label}`);
}

function object(value: unknown, label: string): JsonObject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return value as JsonObject;
}

function array(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`The ${label} fields are invalid.`);
	return value;
}

function sameArray(value: unknown, expected: readonly unknown[]): boolean {
	return Array.isArray(value) && JSON.stringify(value) === JSON.stringify(expected);
}

function specialTemplate(value: unknown, id: string, typeId: number): boolean {
	const entry = object(value, 'tokenizer special template');
	const candidate = object(entry.SpecialToken, 'tokenizer special template value');
	return candidate.id === id && candidate.type_id === typeId;
}

function sequenceTemplate(value: unknown, id: string, typeId: number): boolean {
	const entry = object(value, 'tokenizer sequence template');
	const candidate = object(entry.Sequence, 'tokenizer sequence template value');
	return candidate.id === id && candidate.type_id === typeId;
}
