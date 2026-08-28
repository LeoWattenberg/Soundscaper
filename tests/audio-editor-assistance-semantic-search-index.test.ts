/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceSemanticIndexSearchProviderV1,
} from '../src/common/editor/assistance/semantic-search-index-v1.ts';
import { createAssistanceEmbeddingMatrixV1 } from
	'../src/common/editor/assistance/binary-formats-v1.ts';

const NOW = 1_800_000_000_000;
const SESSION = Object.freeze({
	sessionVersion: 1,
	sessionId: 'a'.repeat(40),
	schemaFamily: 'framescaper' as const,
	schemaVersion: 1 as const,
	projectId: 'project-1',
	projectRevision: 7,
	expiresAtEpochMs: NOW + 60_000,
});

const transcriptMatrix = () => createAssistanceEmbeddingMatrixV1({
	dimensions: 2,
	vectors: [[1, 0], [0, 1]],
});

const visualMatrix = () => createAssistanceEmbeddingMatrixV1({
	dimensions: 2,
	vectors: [[1, 0], [0, 1]],
});

function index() {
	return {
		indexVersion: 1 as const,
		schemaFamily: 'framescaper' as const,
		schemaVersion: 1 as const,
		projectId: 'project-1',
		projectRevision: 7,
		transcript: {
			matrix: transcriptMatrix(),
			rows: [
				{ resultId: 'shared', timelineFrame: 100, label: 'spoken launch plan' },
				{ resultId: 'spoken-other', timelineFrame: 200, label: 'spoken other' },
			],
		},
		visual: {
			matrix: visualMatrix(),
			rows: [
				{ resultId: 'shared', timelineFrame: 100, label: 'launch slide' },
				{ resultId: 'visual-other', timelineFrame: 300, label: 'other image' },
			],
		},
		ocr: [
			{ resultId: 'shared', timelineFrame: 100, label: 'Launch Plan' },
			{ resultId: 'ocr-other', timelineFrame: 400, label: 'Quarterly plan' },
		],
	};
}

test('semantic index queries nomic and SigLIP spaces and fuses transcript, visual, and OCR ranks', async () => {
	const calls: string[] = [];
	const provider = createAssistanceSemanticIndexSearchProviderV1({
		index: index(),
		now: () => NOW,
		embedQuery: async ({ provider: kind, query, signal }) => {
			calls.push(`${kind}:${query}`);
			assert.equal(signal.aborted, false);
			return new Float32Array([1, 0]);
		},
	});
	const results = await provider.search({
		session: SESSION,
		query: 'launch plan',
		maximumResults: 50,
		signal: new AbortController().signal,
	});
	assert.deepEqual(calls, ['transcript:launch plan', 'visual:launch plan']);
	assert.deepEqual(results[0], {
		resultId: 'shared',
		timelineFrame: 100,
		label: 'spoken launch plan',
		detail: 'Visual: launch slide · OCR: Launch Plan',
		providers: ['transcript', 'visual', 'ocr'],
	});
	assert.equal(results.length, 4);
});

test('semantic index is project/revision bound and refuses malformed custody before inference', async () => {
	let calls = 0;
	const provider = createAssistanceSemanticIndexSearchProviderV1({
		index: index(),
		now: () => NOW,
		embedQuery: async () => { calls += 1; return [1, 0]; },
	});
	await assert.rejects(provider.search({
		session: { ...SESSION, projectRevision: 8 },
		query: 'query', maximumResults: 50, signal: new AbortController().signal,
	}), /project.*revision|authority/iu);
	assert.equal(calls, 0);
	assert.throws(() => createAssistanceSemanticIndexSearchProviderV1({
		index: {
			...index(),
			transcript: { matrix: transcriptMatrix(), rows: index().transcript.rows.slice(0, 1) },
		},
		embedQuery: async () => [1, 0],
	}), /row.*matrix|inventory/iu);
});

test('semantic index rejects non-normalized query vectors, timing disagreement, and cancellation', async () => {
	const malformed = createAssistanceSemanticIndexSearchProviderV1({
		index: index(), now: () => NOW, embedQuery: async () => [0.5, 0.5],
	});
	await assert.rejects(malformed.search({
		session: SESSION, query: 'query', maximumResults: 50,
		signal: new AbortController().signal,
	}), /normalized/iu);

	const disagreement = index();
	disagreement.visual.rows[0] = { ...disagreement.visual.rows[0], timelineFrame: 101 };
	const provider = createAssistanceSemanticIndexSearchProviderV1({
		index: disagreement, now: () => NOW, embedQuery: async () => [1, 0],
	});
	await assert.rejects(provider.search({
		session: SESSION, query: 'launch', maximumResults: 50,
		signal: new AbortController().signal,
	}), /timeline|disagree/iu);

	const controller = new AbortController();
	controller.abort(new DOMException('cancelled', 'AbortError'));
	await assert.rejects(provider.search({
		session: SESSION, query: 'launch', maximumResults: 50, signal: controller.signal,
	}), /cancel/iu);
});
