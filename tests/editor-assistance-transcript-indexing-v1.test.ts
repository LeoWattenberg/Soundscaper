/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_NOMIC_DOCUMENT_PREFIX,
	ASSISTANCE_NOMIC_QUERY_PREFIX,
	createAssistanceNomicDocumentChunksV1,
	createAssistanceNomicQueryV1,
	type AssistanceTokenizerV1,
} from '../src/common/editor/assistance/transcript-indexing-v1.ts';
import { createAssistanceTranscript } from '../src/common/editor/assistance/transcript.ts';

const tokenizer: AssistanceTokenizerV1 = Object.freeze({
	encode(value: string): readonly number[] {
		if (value === '\n') return [tokenId(value)];
		return value.trim().split(/\s+/u).filter(Boolean).map((token) => tokenId(token));
	},
});

test('transcript indexing emits 256-token nomic document windows with exact 32-token overlap', () => {
	const transcript = createAssistanceTranscript({
		sourceId: 'source-a', sampleRate: 48_000, modelId: 'whisper-large-v3-turbo',
		segments: [
			segment(0, 10, words('alpha', 100)),
			segment(10, 20, words('beta', 100)),
			segment(20, 30, words('gamma', 100)),
		],
	});
	const chunks = createAssistanceNomicDocumentChunksV1(transcript, tokenizer);
	const prefixLength = tokenizer.encode(ASSISTANCE_NOMIC_DOCUMENT_PREFIX).length;

	assert.equal(chunks.length, 2);
	assert.equal(chunks[0]!.inputIds.length, 256);
	assert.deepEqual(
		chunks[0]!.inputIds.slice(-32),
		chunks[1]!.inputIds.slice(prefixLength, prefixLength + 32),
	);
	assert.deepEqual(chunks.map(({ sourceStartFrame, sourceEndFrame,
		segmentStartIndex, segmentEndIndexExclusive }) => ({
		sourceStartFrame, sourceEndFrame, segmentStartIndex, segmentEndIndexExclusive,
	})), [
		{ sourceStartFrame: 0, sourceEndFrame: 30, segmentStartIndex: 0, segmentEndIndexExclusive: 3 },
		{ sourceStartFrame: 20, sourceEndFrame: 30, segmentStartIndex: 2, segmentEndIndexExclusive: 3 },
	]);
	assert.ok(chunks.every(({ inputIds }) => Object.isFrozen(inputIds)));
});

test('short transcript chunks retain exact segment timing and stable identities', () => {
	const transcript = createAssistanceTranscript({
		sourceId: 'source-a', sampleRate: 48_000, modelId: 'parakeet-tdt-0.6b-v3',
		segments: [segment(100, 200, 'one'), segment(250, 400, 'two words')],
	});
	assert.deepEqual(createAssistanceNomicDocumentChunksV1(transcript, tokenizer), [{
		schemaVersion: 1,
		chunkId: 'transcript:0',
		sourceStartFrame: 100,
		sourceEndFrame: 400,
		segmentStartIndex: 0,
		segmentEndIndexExclusive: 2,
		inputIds: [tokenId(ASSISTANCE_NOMIC_DOCUMENT_PREFIX.trim()), tokenId('one'),
			tokenId('\n'), tokenId('two'), tokenId('words')],
	}]);
});

test('nomic queries use the query prefix and remain separate from document preparation', () => {
	const query = createAssistanceNomicQueryV1('find the red bicycle', tokenizer);
	assert.equal(query.schemaVersion, 1);
	assert.deepEqual(query.inputIds, tokenizer.encode(`${ASSISTANCE_NOMIC_QUERY_PREFIX}find the red bicycle`));
	assert.notEqual(query.inputIds[0], tokenizer.encode(ASSISTANCE_NOMIC_DOCUMENT_PREFIX)[0]);
	assert.throws(() => createAssistanceNomicQueryV1('   ', tokenizer), /query/iu);
	assert.throws(() => createAssistanceNomicQueryV1(words('huge', 256), tokenizer), /256|token/iu);
});

test('transcript indexing fails closed on invalid tokenizer output and empty transcripts', () => {
	const empty = createAssistanceTranscript({
		sourceId: 'source-a', sampleRate: 48_000, modelId: 'parakeet', segments: [],
	});
	assert.throws(() => createAssistanceNomicDocumentChunksV1(empty, tokenizer), /segment|empty/iu);
	assert.throws(() => createAssistanceNomicDocumentChunksV1(createAssistanceTranscript({
		sourceId: 'source-a', sampleRate: 48_000, modelId: 'parakeet',
		segments: [segment(0, 1, 'bad')],
	}), { encode: () => [Number.NaN] }), /token/iu);
});

function segment(startFrame: number, endFrame: number, text: string) {
	return { startFrame, endFrame, text, words: [], speaker: null };
}

function words(prefix: string, count: number): string {
	return Array.from({ length: count }, (_, index) => `${prefix}-${String(index)}`).join(' ');
}

function tokenId(value: string): number {
	let result = 17;
	for (const character of value) result = (result * 31 + character.codePointAt(0)!) >>> 0;
	return result;
}
