/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { createAssistanceEmbeddingMatrixV1 } from
	'../src/common/editor/assistance/binary-formats-v1.ts';
import { reviewAssistanceSemanticDerivativeBundleV1 } from
	'../src/common/editor/assistance/semantic-derivative-bundle-v1.ts';
import { publishLocalAssistanceGuidedIndex } from
	'../src/common/editor/controller/local-assistance-guided-index-publication.ts';
import { AssistanceDerivativeRepository } from
	'../src/common/editor/storage/assistance-derivative-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import type { AssistanceWorkflowV1 } from '../src/common/editor/assistance/workflow.ts';
import type { LocalAssistanceGuidedReviewedResult } from
	'../src/common/editor/ui/local-assistance-guided-result-review.ts';
import { assistanceWorkflowFixture, WORKFLOW_JOB_ID } from './helpers/assistance-workflow-fixture.ts';

const MATRIX = createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [[1, 0]] });
const MATRIX_SHA256 = bytesToHex(sha256(MATRIX));
const SHOTS = Object.freeze({ schemaVersion: 1, detector: 'ffmpeg-scdet', timescale: 1_000,
	sourceFrameCount: 96_000, boundaries: Object.freeze([
		Object.freeze({ sourceFrame: 100, presentationTick: '100', score: 0.9 }),
	]) });

test('accepting a transcript index atomically publishes its reviewed matrix and rows as disposable custody',
	async () => {
		const workflow = transcriptWorkflow();
		const repository = derivativeRepository();
		const result = await publishLocalAssistanceGuidedIndex({
			workflow, review: transcriptReview(workflow), selectedChoiceIds: ['transcript-index'],
			readOutput: async ({ claim }) => {
				assert.equal(`${claim.stageId}:${claim.slotId}`, 'embed-transcript:embeddings');
				return new Blob([MATRIX], { type: 'application/vnd.soundscaper.embedding-matrix-v1' });
			},
			repository,
			resolveCurrentFence: () => workflow.fence,
		});
		assert.equal(result.outcome, 'published');
		assert.equal(result.record.kind, 'embeddings');
		const records = await repository.listProject('project-a');
		assert.equal(records.length, 1);
		const bundle = reviewAssistanceSemanticDerivativeBundleV1(records[0]!.bytes);
		assert.equal(bundle.provider, 'transcript');
		assert.deepEqual(bundle.rows, [{
			resultId: 'transcript:0', timelineFrame: 100, label: 'one two words',
		}]);
		assert.deepEqual(bundle.matrix.vector(0), new Float32Array([1, 0]));
	});

test('index publication is explicit and rejects stale authority or an altered intermediate matrix', async () => {
	const workflow = transcriptWorkflow();
	const repository = derivativeRepository();
	const base = {
		workflow, review: transcriptReview(workflow), readOutput: async () =>
			new Blob([MATRIX], { type: 'application/vnd.soundscaper.embedding-matrix-v1' }),
		repository,
		resolveCurrentFence: () => workflow.fence,
	};
	assert.deepEqual(await publishLocalAssistanceGuidedIndex({
		...base, selectedChoiceIds: [],
	}), { outcome: 'not-selected' });
	await assert.rejects(publishLocalAssistanceGuidedIndex({
		...base, selectedChoiceIds: ['transcript-index'],
		resolveCurrentFence: () => ({ ...workflow.fence, revision: 9 }),
	}), /stale|revision|authority/iu);
	await assert.rejects(publishLocalAssistanceGuidedIndex({
		...base, selectedChoiceIds: ['transcript-index'], readOutput: async () => new Blob([
			createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [[0, 1]] }),
		], { type: 'application/vnd.soundscaper.embedding-matrix-v1' }),
	}), /digest|matrix|disagree/iu);
	assert.deepEqual(await repository.listProject('project-a'), []);
});

test('accepting a video index publishes its exact visual matrix and normalized OCR rows', async () => {
	const matrix = createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [] });
	const workflow = videoWorkflow();
	const repository = derivativeRepository();
	const result = await publishLocalAssistanceGuidedIndex({
		workflow, review: videoReview(workflow, matrix), selectedChoiceIds: ['video-index'],
		readOutput: async ({ claim }) => {
			if (claim.slotId === 'visual-embeddings') {
				return new Blob([matrix], {
					type: 'application/vnd.soundscaper.embedding-matrix-v1',
				});
			}
			assert.equal(`${claim.stageId}:${claim.slotId}`, 'detect-shots:shot-boundaries');
			return new Blob([JSON.stringify(SHOTS)], {
				type: 'application/vnd.soundscaper.shot-boundaries+json',
			});
		},
		repository,
		resolveCurrentFence: () => workflow.fence,
	});
	assert.equal(result.outcome, 'published');
	assert.equal(result.record.kind, 'visual-index');
	const bundle = reviewAssistanceSemanticDerivativeBundleV1(result.record.bytes);
	assert.equal(bundle.provider, 'visual');
	assert.deepEqual(bundle.rows, []);
	assert.deepEqual(bundle.ocr, []);
	assert.deepEqual((await repository.listProject('project-a')).map(({ kind }) => kind),
		['visual-index', 'shot-table']);
});

test('index publication revalidates every aggregate-fence field immediately before saving', async () => {
	const workflow = transcriptWorkflow();
	const repository = derivativeRepository();
	let resolutions = 0;
	await assert.rejects(publishLocalAssistanceGuidedIndex({
		workflow, review: transcriptReview(workflow), selectedChoiceIds: ['transcript-index'],
		readOutput: async () => new Blob([MATRIX], {
			type: 'application/vnd.soundscaper.embedding-matrix-v1',
		}),
		repository,
		resolveCurrentFence: () => {
			resolutions += 1;
			return resolutions === 1 ? workflow.fence : {
				...workflow.fence,
				sourceRanges: workflow.fence.sourceRanges.map((range) => ({
					...range, timingAuthoritySha256: 'ef'.repeat(32),
				})),
			};
		},
	}), /aggregate fence|stale|timing/iu);
	assert.equal(resolutions, 2);
	assert.deepEqual(await repository.listProject('project-a'), []);
});

test('index publication detects an aggregate-fence change after disposable save completion', async () => {
	const workflow = transcriptWorkflow();
	const repository = derivativeRepository();
	let resolutions = 0;
	await assert.rejects(publishLocalAssistanceGuidedIndex({
		workflow, review: transcriptReview(workflow), selectedChoiceIds: ['transcript-index'],
		readOutput: async () => new Blob([MATRIX], {
			type: 'application/vnd.soundscaper.embedding-matrix-v1',
		}), repository,
		resolveCurrentFence: () => {
			resolutions += 1;
			return resolutions < 3 ? workflow.fence : { ...workflow.fence, revision: 9 };
		},
	}), /aggregate fence|stale/iu);
	assert.equal(resolutions, 3);
	assert.equal((await repository.listProject('project-a')).length, 1,
		'the stale post-publication derivative remains disposable and exact-key isolated');
});

function transcriptWorkflow(): AssistanceWorkflowV1 {
	const stageIds = ['chunk-transcript', 'embed-transcript', 'publish-transcript-index'];
	const models = [{ bindingVersion: 1 as const, stageId: 'embed-transcript', slotId: 'text-embedder',
		modelId: 'nomic-embed-text-v1.5', version: '1.5.0', artifactSha256s: ['78'.repeat(32)] }];
	return assistanceWorkflowFixture({ workflowId: 'index-transcript', stageIds, models,
		inputs: [
			claim('input', 'chunk-transcript', 'transcript', 1),
			claim('input', 'embed-transcript', 'text-chunks', 2),
			claim('input', 'publish-transcript-index', 'text-chunks', 3),
			claim('input', 'publish-transcript-index', 'embeddings', 4),
		],
		outputs: [
			claim('output', 'chunk-transcript', 'text-chunks', 5),
			claim('output', 'embed-transcript', 'embeddings', 6),
			claim('output', 'publish-transcript-index', 'transcript-index', 7),
		],
	});
}

function transcriptReview(workflow: AssistanceWorkflowV1): LocalAssistanceGuidedReviewedResult {
	const semantic = {
		schemaVersion: 1, kind: 'transcript-index', sourceId: 'source-a', sampleRate: 48_000,
		embedding: { schemaVersion: 1, byteLength: MATRIX.byteLength, sha256: MATRIX_SHA256,
			rowCount: 1, dimensions: 2 },
		rows: [{ resultId: 'transcript:0', timelineFrame: 100, sourceEndFrame: 400,
			segmentStartIndex: 0, segmentEndIndexExclusive: 2, label: 'one two words', embeddingRow: 0 }],
	};
	const claimValue = workflow.outputs.find(({ slotId }) => slotId === 'transcript-index')!;
	const body = new Blob([JSON.stringify(semantic)], {
		type: 'application/vnd.soundscaper.transcript-index+json',
	});
	return Object.freeze({ reviewVersion: 1, jobId: workflow.jobId, workflowId: 'index-transcript',
		outputs: Object.freeze([{ stageId: claimValue.stageId, slotId: claimValue.slotId,
			claim: claimValue, mediaType: body.type, byteLength: body.size,
			sha256: 'ab'.repeat(32), body, semantic }]),
		choices: Object.freeze([{ id: 'transcript-index', kind: 'index',
			label: '1 transcript index row', selected: false as const, enabled: true }]),
	});
}

function videoWorkflow(): AssistanceWorkflowV1 {
	const stageIds = ['detect-shots', 'sample-shot-frames', 'embed-visuals', 'recognize-text',
		'publish-video-index'];
	const models = [
		{ bindingVersion: 1 as const, stageId: 'embed-visuals', slotId: 'visual-embedder',
			modelId: 'siglip2-so400m', version: '1.0.0', artifactSha256s: ['81'.repeat(32)] },
		{ bindingVersion: 1 as const, stageId: 'recognize-text', slotId: 'text-detector',
			modelId: 'pp-ocrv4-det', version: '4.0.0', artifactSha256s: ['82'.repeat(32)] },
		{ bindingVersion: 1 as const, stageId: 'recognize-text', slotId: 'text-recognizer',
			modelId: 'pp-ocrv4-rec', version: '4.0.0', artifactSha256s: ['83'.repeat(32)] },
	];
	const workflow = assistanceWorkflowFixture({ workflowId: 'index-video', stageIds, models,
		inputs: [
			claim('input', 'detect-shots', 'video', 9),
			claim('input', 'sample-shot-frames', 'video', 10),
			claim('input', 'sample-shot-frames', 'video-authority', 20),
			claim('input', 'sample-shot-frames', 'shot-boundaries', 11),
			claim('input', 'embed-visuals', 'frame-pack', 12),
			claim('input', 'recognize-text', 'frame-pack', 13),
			claim('input', 'publish-video-index', 'visual-embeddings', 14),
			claim('input', 'publish-video-index', 'recognized-text', 15),
		],
		outputs: [
			claim('output', 'detect-shots', 'shot-boundaries', 16),
			claim('output', 'sample-shot-frames', 'frame-pack', 17),
			claim('output', 'embed-visuals', 'visual-embeddings', 18),
			claim('output', 'recognize-text', 'recognized-text', 19),
			claim('output', 'publish-video-index', 'video-index', 20),
		],
	});
	return { ...workflow, fence: { ...workflow.fence, sourceRanges: [{
		...workflow.fence.sourceRanges[0]!, slotId: 'primary-video', mediaKind: 'video',
		sourceSampleRate: null,
	}] } };
}

function videoReview(
	workflow: AssistanceWorkflowV1,
	matrix: Uint8Array,
): LocalAssistanceGuidedReviewedResult {
	const semantic = {
		schemaVersion: 1, kind: 'video-index', sourceId: 'source-a', timescale: 1_000,
		sampleAuthority: [],
		embedding: { schemaVersion: 1, byteLength: matrix.byteLength,
			sha256: bytesToHex(sha256(matrix)), rowCount: 0, dimensions: 2 },
		records: { schemaVersion: 1, tagTaxonomyVersion: 1, visual: [], ocr: [] },
		rows: { visual: [], ocr: [] },
	};
	const claimValue = workflow.outputs.find(({ slotId }) => slotId === 'video-index')!;
	const body = new Blob([JSON.stringify(semantic)], {
		type: 'application/vnd.soundscaper.video-index+json',
	});
	return Object.freeze({ reviewVersion: 1, jobId: workflow.jobId, workflowId: 'index-video',
		outputs: Object.freeze([{ stageId: claimValue.stageId, slotId: claimValue.slotId,
			claim: claimValue, mediaType: body.type, byteLength: body.size,
			sha256: 'cd'.repeat(32), body, semantic }]),
		choices: Object.freeze([{ id: 'video-index', kind: 'index', label: '0 video index rows',
			selected: false as const, enabled: true }]),
	});
}

function derivativeRepository(): AssistanceDerivativeRepository {
	const memory = getMemoryDatabase(`guided-index-${String(Date.now())}-${Math.random().toString(16)}`);
	const port: StorageRepositoryPort = { memory, database: async () => null };
	return new AssistanceDerivativeRepository(port);
}

function claim(direction: 'input' | 'output', stageId: string, slotId: string, index: number) {
	return { claimVersion: 1 as const, direction, claimId: index.toString(16).padStart(40, '0'),
		jobId: WORKFLOW_JOB_ID, stageId, slotId };
}
