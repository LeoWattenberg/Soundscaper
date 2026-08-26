/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceNomicTokenizerV1,
} from '../src/common/editor/assistance/nomic-tokenizer-v1.ts';
import { nomicTokenizerArtifactFixture } from './assistance-nomic-tokenizer-fixture.ts';

test('the pinned nomic tokenizer executes lowercase, accent, punctuation, and WordPiece rules', () => {
	const tokenizer = createAssistanceNomicTokenizerV1(nomicTokenizerArtifactFixture());

	assert.deepEqual(tokenizer.encode('Héllo, cafés!'), [7592, 1010, 7668, 2015, 999]);
	assert.deepEqual(tokenizer.encode('[MASK] hello'), [103, 7592]);
	assert.deepEqual(tokenizer.encode('search_document: '), [3945, 1035, 6254, 1024]);
	assert.deepEqual(tokenizer.encode('search_query: '), [3945, 1035, 23032, 1024]);
	assert.deepEqual(tokenizer.specialTokenIds, {
		pad: 0, unknown: 100, classification: 101, separator: 102, mask: 103,
	});
	assert.equal(tokenizer.embeddingDimensions, 768);
});

test('the pinned nomic tokenizer fails closed on altered artifact semantics', () => {
	const valid = nomicTokenizerArtifactFixture();
	const parse = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
	const alteredNormalizer = parse(valid.tokenizer);
	alteredNormalizer.normalizer = { type: 'BertNormalizer', clean_text: true,
		handle_chinese_chars: true, strip_accents: null, lowercase: false };
	assert.throws(() => createAssistanceNomicTokenizerV1({
		...valid, tokenizer: new TextEncoder().encode(JSON.stringify(alteredNormalizer)),
	}), /normalizer|lowercase|tokenizer/iu);

	const alteredConfig = parse(valid.config);
	alteredConfig.hidden_size = 512;
	assert.throws(() => createAssistanceNomicTokenizerV1({
		...valid, config: new TextEncoder().encode(JSON.stringify(alteredConfig)),
	}), /768|hidden|config/iu);

	assert.throws(() => createAssistanceNomicTokenizerV1({
		...valid, tokenizerConfig: new Uint8Array([0xff]),
	}), /UTF-8|JSON|tokenizer/iu);
});

test('the pinned nomic tokenizer bounds input and emits unknown tokens without fallback', () => {
	const tokenizer = createAssistanceNomicTokenizerV1(nomicTokenizerArtifactFixture());
	assert.deepEqual(tokenizer.encode('not-in-the-pinned-vocab'),
		[100, 100, 100, 100, 1996, 100, 100, 100, 100]);
	assert.throws(() => tokenizer.encode('x'.repeat(4_000_001)), /bound|length|text/iu);
});
