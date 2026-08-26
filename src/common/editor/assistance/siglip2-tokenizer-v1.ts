/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic execution of the pinned SigLIP2 byte-fallback BPE tokenizer. */

const MAXIMUM_TOKENIZER_BYTES = 40 * 1024 * 1024;
const MAXIMUM_VOCABULARY = 256_000;
const MAXIMUM_MERGES = 600_000;
const MAXIMUM_TEXT_CODE_UNITS = 4_096;
const SEQUENCE_LENGTH = 64;
const PAD_ID = 0;
const EOS_ID = 1;
const UNKNOWN_ID = 3;
const CONTROL = /[\u0000\u000b\u000c\u000e-\u001f\u007f]/u;

export interface AssistanceSiglip2TokenizedTextV1 {
	readonly inputIds: BigInt64Array;
	readonly attentionMask: BigInt64Array;
}

export interface AssistanceSiglip2TokenizerV1 {
	encode(text: string): AssistanceSiglip2TokenizedTextV1;
}

export function createAssistanceSiglip2TokenizerV1(
	bytes: Uint8Array,
): AssistanceSiglip2TokenizerV1 {
	const root = jsonObject(bytes);
	validatePipeline(root);
	const model = object(root.model, 'SigLIP2 tokenizer model');
	const rawVocab = object(model.vocab, 'SigLIP2 tokenizer vocabulary');
	const entries = Object.entries(rawVocab);
	if (entries.length < 5 || entries.length > MAXIMUM_VOCABULARY) {
		throw new RangeError('The SigLIP2 tokenizer vocabulary exceeds its exact bound.');
	}
	const vocabulary = new Map<string, number>();
	const ids = new Set<number>();
	for (const [token, idValue] of entries) {
		const id = integer(idValue, 0, MAXIMUM_VOCABULARY - 1,
			'SigLIP2 tokenizer vocabulary ID');
		if (token.length < 1 || token.length > 1_024 || ids.has(id)) {
			throw new TypeError('The SigLIP2 tokenizer vocabulary is ambiguous or invalid.');
		}
		vocabulary.set(token, id);
		ids.add(id);
	}
	for (const [token, id] of [['<pad>', PAD_ID], ['<eos>', EOS_ID], ['<unk>', UNKNOWN_ID]] as const) {
		if (vocabulary.get(token) !== id) {
			throw new TypeError('The SigLIP2 tokenizer changed a required special token.');
		}
	}
	const rawMerges = array(model.merges, 'SigLIP2 tokenizer merges');
	if (rawMerges.length > MAXIMUM_MERGES) {
		throw new RangeError('The SigLIP2 tokenizer merge table exceeds its exact bound.');
	}
	const mergeRanks = new Map<string, number>();
	for (const [rank, candidate] of rawMerges.entries()) {
		if (!Array.isArray(candidate) || candidate.length !== 2
			|| candidate.some((token) => typeof token !== 'string' || token.length < 1)) {
			throw new TypeError('A SigLIP2 tokenizer merge is malformed.');
		}
		const key = pairKey(candidate[0] as string, candidate[1] as string);
		if (mergeRanks.has(key)) throw new TypeError('The SigLIP2 tokenizer merge table is ambiguous.');
		mergeRanks.set(key, rank);
	}
	return Object.freeze({
		encode(textValue: string): AssistanceSiglip2TokenizedTextV1 {
			const text = boundedText(textValue);
			const normalized = text.replaceAll(' ', '▁');
			const pieces = vocabulary.has(normalized) ? [normalized]
				: mergePieces(initialPieces(normalized, vocabulary), mergeRanks);
			const tokenIds: number[] = [];
			let priorUnknown = false;
			for (const piece of pieces) {
				const id = vocabulary.get(piece) ?? UNKNOWN_ID;
				if (id === UNKNOWN_ID && priorUnknown) continue;
				tokenIds.push(id);
				priorUnknown = id === UNKNOWN_ID;
			}
			const admitted = tokenIds.slice(0, SEQUENCE_LENGTH - 1);
			admitted.push(EOS_ID);
			const inputIds = new BigInt64Array(SEQUENCE_LENGTH);
			const attentionMask = new BigInt64Array(SEQUENCE_LENGTH);
			for (const [index, id] of admitted.entries()) {
				inputIds[index] = BigInt(id);
				attentionMask[index] = 1n;
			}
			return Object.freeze({ inputIds, attentionMask });
		},
	});
}

function validatePipeline(root: Record<string, unknown>): void {
	if (root.version !== '1.0' || root.truncation !== null) {
		throw new TypeError('The SigLIP2 tokenizer version or truncation semantics are invalid.');
	}
	const padding = object(root.padding, 'SigLIP2 tokenizer padding');
	const strategy = object(padding.strategy, 'SigLIP2 tokenizer padding strategy');
	if (strategy.Fixed !== SEQUENCE_LENGTH || padding.direction !== 'Right'
		|| padding.pad_id !== PAD_ID || padding.pad_token !== '<pad>') {
		throw new TypeError('The SigLIP2 tokenizer padding semantics are invalid.');
	}
	const normalizer = object(root.normalizer, 'SigLIP2 tokenizer normalizer');
	const pattern = object(normalizer.pattern, 'SigLIP2 tokenizer normalizer pattern');
	if (normalizer.type !== 'Replace' || pattern.String !== ' ' || normalizer.content !== '▁') {
		throw new TypeError('The SigLIP2 tokenizer normalizer semantics are invalid.');
	}
	const preTokenizer = object(root.pre_tokenizer, 'SigLIP2 tokenizer pre-tokenizer');
	const prePattern = object(preTokenizer.pattern, 'SigLIP2 tokenizer pre-tokenizer pattern');
	if (preTokenizer.type !== 'Split' || prePattern.String !== ' '
		|| preTokenizer.behavior !== 'MergedWithPrevious' || preTokenizer.invert !== false) {
		throw new TypeError('The SigLIP2 tokenizer pre-tokenizer semantics are invalid.');
	}
	const model = object(root.model, 'SigLIP2 tokenizer model');
	if (model.type !== 'BPE' || model.dropout !== null || model.unk_token !== '<unk>'
		|| model.continuing_subword_prefix !== null || model.end_of_word_suffix !== null
		|| model.fuse_unk !== true || model.byte_fallback !== true || model.ignore_merges !== false) {
		throw new TypeError('The SigLIP2 byte-fallback BPE semantics are invalid.');
	}
	const processor = object(root.post_processor, 'SigLIP2 tokenizer post-processor');
	if (processor.type !== 'TemplateProcessing') {
		throw new TypeError('The SigLIP2 tokenizer post-processor is invalid.');
	}
	const single = array(processor.single, 'SigLIP2 tokenizer single template');
	if (single.length !== 2 || sequenceId(single[0]) !== 'A'
		|| specialId(single[1]) !== '<eos>') {
		throw new TypeError('The SigLIP2 tokenizer single-sequence template is invalid.');
	}
}

function initialPieces(value: string, vocabulary: ReadonlyMap<string, number>): string[] {
	const result: string[] = [];
	const encoder = new TextEncoder();
	for (const character of value) {
		if (vocabulary.has(character)) {
			result.push(character);
			continue;
		}
		for (const byte of encoder.encode(character)) {
			const fallback = `<0x${byte.toString(16).toUpperCase().padStart(2, '0')}>`;
			result.push(vocabulary.has(fallback) ? fallback : '<unk>');
		}
	}
	return result;
}

function mergePieces(initial: readonly string[], ranks: ReadonlyMap<string, number>): string[] {
	let pieces = [...initial];
	while (pieces.length > 1) {
		let bestRank = Number.POSITIVE_INFINITY;
		let bestLeft = '';
		let bestRight = '';
		for (let index = 0; index + 1 < pieces.length; index += 1) {
			const left = pieces[index]!;
			const right = pieces[index + 1]!;
			const rank = ranks.get(pairKey(left, right));
			if (rank !== undefined && rank < bestRank) {
				bestRank = rank;
				bestLeft = left;
				bestRight = right;
			}
		}
		if (!Number.isFinite(bestRank)) break;
		const merged: string[] = [];
		for (let index = 0; index < pieces.length; index += 1) {
			if (pieces[index] === bestLeft && pieces[index + 1] === bestRight) {
				merged.push(bestLeft + bestRight);
				index += 1;
			} else merged.push(pieces[index]!);
		}
		pieces = merged;
	}
	return pieces;
}

function pairKey(left: string, right: string): string {
	return `${String(left.length)}:${left}${right}`;
}

function boundedText(value: unknown): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > MAXIMUM_TEXT_CODE_UNITS
		|| value !== value.trim() || CONTROL.test(value)) {
		throw new TypeError('SigLIP2 text must be nonempty, bounded, trimmed, and free of controls.');
	}
	return value;
}

function jsonObject(bytes: Uint8Array): Record<string, unknown> {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2
		|| bytes.byteLength > MAXIMUM_TOKENIZER_BYTES) {
		throw new RangeError('The SigLIP2 tokenizer artifact exceeds its exact byte bound.');
	}
	let value: unknown;
	try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
	catch { throw new TypeError('The SigLIP2 tokenizer artifact is not canonical UTF-8 JSON.'); }
	return object(value, 'SigLIP2 tokenizer artifact');
}

function object(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function sequenceId(value: unknown): unknown {
	return object(object(value, 'SigLIP2 tokenizer sequence template').Sequence,
		'SigLIP2 tokenizer sequence').id;
}

function specialId(value: unknown): unknown {
	return object(object(value, 'SigLIP2 tokenizer special template').SpecialToken,
		'SigLIP2 tokenizer special token').id;
}
