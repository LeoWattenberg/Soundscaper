/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	createLocalAssistanceGuidedWorkflowPreparation,
	type LocalAssistanceAggregateCustodyPort,
} from '../src/common/editor/controller/local-assistance-guided-preparation.ts';
import { defaultAssistanceWorkflowSettingsV1 } from '../src/common/editor/assistance/workflow-settings-v1.ts';
import {
	createAssistanceWorkflowCustodyClaimV1,
	workflowClaimFromCustodyV1,
} from '../src/common/editor/assistance/workflow-custody-v1.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const JOB_ID = '01'.repeat(20);
const SOURCE_SHA256 = 'ab'.repeat(32);
const MAXIMUM_OUTPUT_BYTES = 64 * 1024 * 1024;

test('enhancement preparation binds exact media, model, settings, recipe, and capacity authority', async () => {
	const fixture = preparationFixture();
	const result = await fixture.preparation.prepareGuidedWorkflow({
		jobId: JOB_ID, workflowId: 'enhance-dialogue',
		settings: defaultAssistanceWorkflowSettingsV1('enhance-dialogue'),
		models: [model('deepfilternet3', '3.0.0', 'speech-enhancement', 1)],
		custody: fixture.custody, signal: new AbortController().signal,
	});
	assert.equal(result.outcome, 'prepared');
	if (result.outcome !== 'prepared') return;
	assert.deepEqual(result.workflow.stageIds, ['enhance-dialogue']);
	assert.deepEqual(result.workflow.models, [{
		bindingVersion: 1, stageId: 'enhance-dialogue', slotId: 'enhancer',
		modelId: 'deepfilternet3', version: '3.0.0',
		artifactSha256s: ['1'.padStart(64, '0')],
	}]);
	assert.equal(result.workflow.inputs.length, 1);
	assert.equal(result.workflow.outputs.length, 1);
	assert.deepEqual(result.reviewAuthority, { reviewAuthorityVersion: 1,
		audioWave: { sampleRate: 48_000, channelCount: 2, frameCount: 3 },
		editorialCandidateIds: null });
	assert.deepEqual(result.workflow.fence.sourceRanges, [{
		slotId: 'primary-audio', mediaKind: 'audio', sourceId: 'voice-source',
		sourceSha256: SOURCE_SHA256, sourceSampleRate: 48_000, occurrenceIds: ['voice-clip'],
		sourceStartFrame: 24_000, sourceEndFrame: 72_000,
		linkMembershipSha256: '12'.repeat(32), timingAuthoritySha256: '34'.repeat(32),
		retimeKind: 'identity',
	}]);
	for (const field of ['recipeSha256', 'settingsSha256', 'modelBindingsSha256'] as const) {
		assert.match(result.workflow.fence[field], /^[a-f\d]{64}$/u);
	}
	assert.deepEqual(fixture.preflights, [MAXIMUM_OUTPUT_BYTES]);
	assert.deepEqual(fixture.operations, ['speech-enhancement']);
	assert.equal(fixture.custodyEvents[0]?.kind, 'input');
	assert.equal(fixture.custodyEvents[1]?.kind, 'output');
	assert.equal(Object.isFrozen(result.workflow), true);
});

test('TIGER preparation reserves dialogue, music, and effects once in canonical order', async () => {
	const fixture = preparationFixture();
	const result = await fixture.preparation.prepareGuidedWorkflow({
		jobId: JOB_ID, workflowId: 'separate-dialogue-music-effects',
		settings: defaultAssistanceWorkflowSettingsV1('separate-dialogue-music-effects'),
		models: [model('tiger-dnr', '1.0.0', 'source-separation', 2)],
		custody: fixture.custody, signal: new AbortController().signal,
	});
	assert.equal(result.outcome, 'prepared');
	if (result.outcome !== 'prepared') return;
	assert.deepEqual(result.workflow.outputs.map(({ slotId }) => slotId),
		['dialogue', 'music', 'effects']);
	assert.deepEqual(result.reviewAuthority.audioWave,
		{ sampleRate: 44_100, channelCount: 2, frameCount: 3 });
	assert.deepEqual(fixture.preflights, [3 * MAXIMUM_OUTPUT_BYTES]);
	assert.deepEqual(fixture.operations, ['source-separation']);
	assert.equal(fixture.custodyEvents.filter(({ kind }) => kind === 'output').length, 3);
});

test('transcript indexing stages one authenticated stored transcript without rendering media', async () => {
	const { transcriptBytes, transcriptSha256, storageKey, transcriptProject } = transcriptAssetFixture();
	const fixture = preparationFixture(transcriptProject, false, { storageKey, bytes: transcriptBytes });
	const result = await fixture.preparation.prepareGuidedWorkflow({
		jobId: JOB_ID, workflowId: 'index-transcript',
		settings: defaultAssistanceWorkflowSettingsV1('index-transcript'),
		models: [model('nomic-embed-text-v1.5', '1.5.0', 'text-embedding', 7)],
		custody: fixture.custody, signal: new AbortController().signal,
	});
	assert.equal(result.outcome, 'prepared');
	if (result.outcome !== 'prepared') return;
	assert.deepEqual(result.workflow.stageIds,
		['chunk-transcript', 'embed-transcript', 'publish-transcript-index']);
	assert.equal(result.workflow.fence.transcriptBodySha256, transcriptSha256);
	assert.deepEqual(fixture.operations, [], 'stored transcript indexing does not render selected audio');
	assert.deepEqual(fixture.custodyEvents.map(({ kind, slotId }) => `${kind}:${slotId}`), [
		'input:transcript', 'output:text-chunks', 'producer:text-chunks', 'output:embeddings',
		'producer:text-chunks', 'producer:embeddings', 'output:transcript-index',
	]);
});

test('transcript indexing refuses external deletion and corruption before staging', async () => {
	const { transcriptBytes, storageKey, transcriptProject } = transcriptAssetFixture();
	const missing = preparationFixture(transcriptProject, false, {
		storageKey: 'assistance-transcript-sha256:missing', bytes: transcriptBytes,
	});
	assert.deepEqual(await missing.preparation.prepareGuidedWorkflow({
		jobId: JOB_ID, workflowId: 'index-transcript',
		settings: defaultAssistanceWorkflowSettingsV1('index-transcript'),
		models: [model('nomic-embed-text-v1.5', '1.5.0', 'text-embedding', 7)],
		custody: missing.custody, signal: new AbortController().signal,
	}), { outcome: 'unavailable', reason: 'transcript-custody-unavailable' });
	assert.deepEqual(missing.custodyEvents, []);
	const corrupt = preparationFixture(transcriptProject, false, {
		storageKey, bytes: Uint8Array.from([...transcriptBytes, 0]),
	});
	await assert.rejects(corrupt.preparation.prepareGuidedWorkflow({
		jobId: JOB_ID, workflowId: 'index-transcript',
		settings: defaultAssistanceWorkflowSettingsV1('index-transcript'),
		models: [model('nomic-embed-text-v1.5', '1.5.0', 'text-embedding', 7)],
		custody: corrupt.custody, signal: new AbortController().signal,
	}), /transcript body changed/iu);
	assert.deepEqual(corrupt.custodyEvents, []);
	assert.equal(corrupt.releases, 1);
});

test('missing or ambiguous exact models and unavailable aggregate custody are typed refusals', async () => {
	const fixture = preparationFixture();
	for (const models of [[], [
		model('deepfilternet3', '3.0.0', 'speech-enhancement', 1),
		model('deepfilternet3', '3.0.0', 'speech-enhancement', 2),
	]]) {
		const result = await fixture.preparation.prepareGuidedWorkflow({
			jobId: JOB_ID, workflowId: 'enhance-dialogue',
			settings: defaultAssistanceWorkflowSettingsV1('enhance-dialogue'),
			models, custody: fixture.custody, signal: new AbortController().signal,
		});
		assert.deepEqual(result, { outcome: 'unavailable', reason: 'model-binding-unavailable' });
	}
	assert.deepEqual(fixture.preflights, []);
	assert.deepEqual(fixture.operations, []);
});

test('reverse, nested, multicamera, live, linked-unverifiable, and stale authority refuse before staging', async () => {
	for (const change of [
		{ clips: [{ ...project().clips[0], reversed: true }] },
		{ subsequences: [{ id: 'nested' }] },
		{ multicameraGroups: [{ id: 'multicam' }] },
		{ sources: [{ ...project().sources[0], liveCapture: true }] },
		{ clips: [...project().clips, { id: 'linked-video', kind: 'video', sourceId: 'camera',
			avLinkId: 'linked' }], sources: [...project().sources, { id: 'camera', kind: 'video',
			contentSha256: 'cd'.repeat(32) }] },
	] as const) {
		const fixture = preparationFixture({ ...project(), ...change });
		const result = await fixture.preparation.prepareGuidedWorkflow({
			jobId: JOB_ID, workflowId: 'enhance-dialogue',
			settings: defaultAssistanceWorkflowSettingsV1('enhance-dialogue'),
			models: [model('deepfilternet3', '3.0.0', 'speech-enhancement', 1)],
			custody: fixture.custody, signal: new AbortController().signal,
		});
		assert.equal(result.outcome, 'unavailable');
		assert.equal(fixture.custodyEvents.length, 0);
	}

	const stale = preparationFixture(project(), true);
	await assert.rejects(stale.preparation.prepareGuidedWorkflow({
		jobId: JOB_ID, workflowId: 'enhance-dialogue',
		settings: defaultAssistanceWorkflowSettingsV1('enhance-dialogue'),
		models: [model('deepfilternet3', '3.0.0', 'speech-enhancement', 1)],
		custody: stale.custody, signal: new AbortController().signal,
	}), { name: 'AbortError' });
	assert.equal(stale.releases, 1);
});

test('Accurate Mark Cuts stages its exact frame pack and never substitutes Fast', async () => {
	const fixture = preparationFixture();
	const videoProject: FixtureProject = { ...project(),
		sources: [{ id: 'video-source', kind: 'video', contentSha256: SOURCE_SHA256 }],
		clips: [{ id: 'video-clip', kind: 'video', sourceId: 'video-source',
			sequenceId: 'main-sequence', avLinkId: null, reversed: false, speedRatio: 1 }],
	};
	const modes: unknown[] = [];
	const preparation = createLocalAssistanceGuidedWorkflowPreparation({
		getProject: () => videoProject, getSelectedClipId: () => 'video-clip',
		captureProject: () => ({ revision: 4 }), assertProject: () => undefined,
		preflightStorage: async () => undefined,
		currentSelectionFence: () => ({
			projectId: 'project-1', schemaVersion: 30, revision: 4,
			sequenceId: 'main-sequence', occurrenceIds: ['video-clip'],
			sourceId: 'video-source', sourceSha256: SOURCE_SHA256,
			sourceStartFrame: 0, sourceEndFrame: 120,
			linkMembershipSha256: '12'.repeat(32), timingAuthoritySha256: '34'.repeat(32),
		}),
		selected: {
			listSelectedMedia: async () => ({ sources: [{ sourceId: 'video-source',
				label: 'Video', mediaKind: 'video', operations: ['shot-detection'] }] }),
			prepareSelectedMedia: async (request) => {
				modes.push(request.shotDetectionMode);
				return { sourceId: 'video-source', operation: 'shot-detection',
					shotDetectionMode: 'accurate', selectionFence: {
						projectId: 'project-1', schemaVersion: 30, revision: 4,
						sequenceId: 'main-sequence', occurrenceIds: ['video-clip'],
						sourceId: 'video-source', sourceSha256: SOURCE_SHA256,
						sourceStartFrame: 0, sourceEndFrame: 120,
						linkMembershipSha256: '12'.repeat(32), timingAuthoritySha256: '34'.repeat(32),
					}, inputs: [{ role: 'frame-pack',
						mediaType: 'application/vnd.soundscaper.frame-pack',
						bytes: new Blob([new Uint8Array([1, 2, 3])]) }],
					outputs: [{ role: 'shot-boundaries', mediaType: 'application/json',
						maximumByteLength: MAXIMUM_OUTPUT_BYTES }],
				};
			},
		},
	});
	const result = await preparation.prepareGuidedWorkflow({ jobId: JOB_ID,
		workflowId: 'mark-cuts', settings: { settingsVersion: 1, workflowId: 'mark-cuts',
			mode: 'accurate' }, models: [model('transnetv2', '2.0.0', 'shot-detection', 9)],
		custody: fixture.custody, signal: new AbortController().signal });
	assert.equal(result.outcome, 'prepared');
	if (result.outcome !== 'prepared') return;
	assert.deepEqual(result.workflow.inputs.map(({ stageId, slotId }) => `${stageId}:${slotId}`), [
		'detect-shots:frame-pack', 'normalize-cuts:shot-boundaries',
	]);
	assert.deepEqual(modes, ['accurate']);
	assert.equal(fixture.custodyEvents[0]?.kind, 'input');
	assert.equal(fixture.custodyEvents[0]?.slotId, 'frame-pack');
});

test('Make Highlights adds Qwen only after explicit editorial rerank opt-in', async () => {
	const fixture = preparationFixture();
	const videoProject: FixtureProject = { ...project(),
		sources: [{ id: 'video-source', kind: 'video', contentSha256: SOURCE_SHA256 }],
		clips: [{ id: 'video-clip', kind: 'video', sourceId: 'video-source',
			sequenceId: 'main-sequence', avLinkId: null, reversed: false, speedRatio: 1 }],
	};
	const preparation = createLocalAssistanceGuidedWorkflowPreparation({
		getProject: () => videoProject, getSelectedClipId: () => 'video-clip',
		captureProject: () => ({ revision: 4 }), assertProject: () => undefined,
		preflightStorage: async () => undefined,
		currentSelectionFence: () => ({
			projectId: 'project-1', schemaVersion: 30, revision: 4,
			sequenceId: 'main-sequence', occurrenceIds: ['video-clip'],
			sourceId: 'video-source', sourceSha256: SOURCE_SHA256,
			sourceStartFrame: 0, sourceEndFrame: 120,
			linkMembershipSha256: '12'.repeat(32), timingAuthoritySha256: '34'.repeat(32),
		}),
		selected: {
			listSelectedMedia: async () => ({ sources: [{ sourceId: 'video-source',
				label: 'Video', mediaKind: 'video', operations: ['shot-detection'] }] }),
			prepareSelectedMedia: async () => ({ sourceId: 'video-source',
				operation: 'shot-detection', shotDetectionMode: 'fast', selectionFence: {
					projectId: 'project-1', schemaVersion: 30, revision: 4,
					sequenceId: 'main-sequence', occurrenceIds: ['video-clip'],
					sourceId: 'video-source', sourceSha256: SOURCE_SHA256,
					sourceStartFrame: 0, sourceEndFrame: 120,
					linkMembershipSha256: '12'.repeat(32), timingAuthoritySha256: '34'.repeat(32),
				}, inputs: [{ role: 'video', mediaType: 'video/mp4',
					bytes: new Blob([new Uint8Array([1, 2, 3])]) }], outputs: [],
			}),
		},
	});
	const settings = { ...defaultAssistanceWorkflowSettingsV1('make-highlights'),
		editorialRerank: true } as const;
	const result = await preparation.prepareGuidedWorkflow({ jobId: JOB_ID,
		workflowId: 'make-highlights', settings,
		models: [model('qwen3-4b-q4-k-m', '1.0.0', 'editorial-generation', 10)],
		custody: fixture.custody, signal: new AbortController().signal });
	assert.equal(result.outcome, 'prepared');
	if (result.outcome !== 'prepared') return;
	assert.deepEqual(result.workflow.stageIds, [
		'gather-signals', 'rank-highlights', 'rerank-editorial', 'assemble-highlights',
	]);
	assert.deepEqual(result.workflow.models.map(({ stageId, slotId, modelId }) => ({
		stageId, slotId, modelId,
	})), [{ stageId: 'rerank-editorial', slotId: 'editorial-generator',
		modelId: 'qwen3-4b-q4-k-m' }]);
	assert.ok(result.workflow.inputs.some(({ stageId, slotId }) => (
		stageId === 'rerank-editorial' && slotId === 'highlight-candidates'
	)));
	assert.ok(result.workflow.inputs.some(({ stageId, slotId }) => (
		stageId === 'assemble-highlights' && slotId === 'editorial-proposal'
	)));
});

interface FixtureProject {
	readonly id: string;
	readonly schemaVersion: number;
	readonly revision: number;
	readonly clips: readonly Readonly<Record<string, unknown> & { id: string }>[];
	readonly sources: readonly Readonly<Record<string, unknown> & { id: string }>[];
	readonly [key: string]: unknown;
}

function preparationFixture(
	projectValue: FixtureProject = project(),
	stale = false,
	transcript?: Readonly<{ storageKey: string; bytes: Uint8Array }>,
) {
	const operations: string[] = [];
	const preflights: number[] = [];
	const custodyEvents: Array<{ kind: 'input' | 'output' | 'producer'; slotId: string }> = [];
	let releases = 0;
	let claimOrdinal = 10;
	const custody: LocalAssistanceAggregateCustodyPort = Object.freeze({
		stageInput: async (
			request: Parameters<LocalAssistanceAggregateCustodyPort['stageInput']>[0],
		) => {
			custodyEvents.push({ kind: 'input', slotId: request.slotId });
			const bytes = new Uint8Array(await request.bytes.arrayBuffer());
			const custody = createAssistanceWorkflowCustodyClaimV1({
				custodyVersion: 1, workflowId: request.workflowId, direction: 'input',
				jobId: request.jobId, stageId: request.stageId, slotId: request.slotId,
				claimId: (++claimOrdinal).toString(16).padStart(40, '0'),
				role: request.slotId as 'audio', mediaType: request.mediaType,
				byteLength: bytes.byteLength, sha256: bytesToHex(sha256(bytes)),
				maximumByteLength: null,
			});
			return Object.freeze({ custody, workflowClaim: workflowClaimFromCustodyV1(custody) });
		},
		reserveOutput: async (
			request: Parameters<LocalAssistanceAggregateCustodyPort['reserveOutput']>[0],
		) => {
			custodyEvents.push({ kind: 'output', slotId: request.slotId });
			const custody = createAssistanceWorkflowCustodyClaimV1({
				custodyVersion: 1, workflowId: request.workflowId, direction: 'output',
				jobId: request.jobId, stageId: request.stageId, slotId: request.slotId,
				claimId: (++claimOrdinal).toString(16).padStart(40, '0'),
				byteLength: null, sha256: null, maximumByteLength: request.maximumByteLength,
			});
			return Object.freeze({ custody, workflowClaim: workflowClaimFromCustodyV1(custody) });
		},
		bindProducer: async (
			request: Parameters<LocalAssistanceAggregateCustodyPort['bindProducer']>[0],
		) => {
			custodyEvents.push({ kind: 'producer', slotId: request.slotId });
			const custody = createAssistanceWorkflowCustodyClaimV1({
				custodyVersion: 1, workflowId: request.workflowId, direction: 'input',
				jobId: request.jobId, stageId: request.stageId, slotId: request.slotId,
				claimId: request.producer.claimId, role: request.producer.role,
				mediaType: request.producer.mediaType, byteLength: null, sha256: null,
				maximumByteLength: request.producer.maximumByteLength,
				producer: { stageId: request.producer.stageId, slotId: request.producer.slotId,
					claimId: request.producer.claimId },
			});
			return Object.freeze({ custody, workflowClaim: workflowClaimFromCustodyV1(custody) });
		},
		release: async () => { releases += 1; return true; },
	});
	const preparedFence = {
		projectId: 'project-1', schemaVersion: 30, revision: 4, sequenceId: 'main-sequence',
		occurrenceIds: projectValue.clips.map(({ id }) => id), sourceId: 'voice-source',
		sourceSha256: SOURCE_SHA256, sourceStartFrame: 24_000, sourceEndFrame: 72_000,
		linkMembershipSha256: '12'.repeat(32), timingAuthoritySha256: '34'.repeat(32),
	};
	const preparation = createLocalAssistanceGuidedWorkflowPreparation({
		getProject: () => projectValue, getSelectedClipId: () => 'voice-clip',
		captureProject: () => ({ revision: 4 }),
		assertProject: () => {
			if (stale) throw new DOMException('stale', 'AbortError');
		},
		preflightStorage: async (bytes) => { preflights.push(bytes); },
		currentSelectionFence: () => preparedFence,
		...(transcript ? { loadTranscriptBody: async (storageKey: string) => {
			if (storageKey !== transcript.storageKey) return null;
			return Uint8Array.from(transcript.bytes);
		} } : {}),
		selected: {
			listSelectedMedia: async () => ({ sources: [{ sourceId: 'voice-source',
				label: 'Voice', mediaKind: 'audio', operations: [] }] }),
			prepareSelectedMedia: async ({ operation }) => {
				operations.push(operation);
				const sampleRate = operation === 'source-separation' ? 44_100 : 48_000;
				const wav = encodeWav([
					Float32Array.of(0.25, 0, -0.25), Float32Array.of(-0.25, 0, 0.25),
				], { sampleRate, bitDepth: 32, float: true, dither: false });
				return { sourceId: 'voice-source', operation, selectionFence: preparedFence,
					inputs: [{ role: 'audio', mediaType: 'audio/wav',
						bytes: new Blob([wav.slice().buffer], { type: 'audio/wav' }) }],
					outputs: operation === 'source-separation'
						? ['dialogue', 'music', 'effects'].map((slotId) => ({ slotId,
							role: 'separated-audio', mediaType: 'audio/wav',
							maximumByteLength: MAXIMUM_OUTPUT_BYTES }))
						: [{ slotId: 'enhanced-audio', role: 'enhanced-audio', mediaType: 'audio/wav',
							maximumByteLength: MAXIMUM_OUTPUT_BYTES }],
				};
			},
		},
	});
	return { preparation, custody, custodyEvents, operations, preflights,
		get releases() { return releases; } };
}

function project(): FixtureProject {
	return {
		id: 'project-1', schemaVersion: 30, revision: 4, sampleRate: 48_000,
		primarySequenceId: 'main-sequence', subsequences: [], multicameraGroups: [],
		assistanceAssets: [],
		sources: [{ id: 'voice-source', kind: 'audio', contentSha256: SOURCE_SHA256 }],
		clips: [{ id: 'voice-clip', kind: 'audio', sourceId: 'voice-source', sequenceId: 'main-sequence',
			avLinkId: null, reversed: false, speedRatio: 1, pitchCents: 0,
			stretchToTempo: false, warpMap: null }],
		tracks: [{ id: 'voice-track', type: 'audio', clipIds: ['voice-clip'] }],
	};
}

function transcriptAssetFixture() {
	const transcriptBytes = new TextEncoder().encode(JSON.stringify({
		sourceId: 'voice-source', sampleRate: 48_000, language: 'en', segments: [],
	}));
	const transcriptSha256 = bytesToHex(sha256(transcriptBytes));
	const storageKey = `assistance-transcript-sha256:${transcriptSha256}`;
	const transcriptProject: FixtureProject = { ...project(), assistanceAssets: [{
		id: 'transcript-1', kind: 'transcript-v1', sourceId: 'voice-source',
		sourceSha256: SOURCE_SHA256, sourceStartFrame: 0, sourceEndFrame: 96_000,
		sourceVideoTimingSha256: null, recipeId: 'speech-transcript', recipeVersion: 1,
		modelArtifactSha256s: ['90'.repeat(32)], body: {
			storageKey, mimeType: 'application/vnd.soundscaper.assistance-transcript+json',
			byteLength: transcriptBytes.byteLength, sha256: transcriptSha256,
		},
	}] };
	return { transcriptBytes, transcriptSha256, storageKey, transcriptProject };
}

function model(modelId: string, version: string, task: string, ordinal: number) {
	return Object.freeze({ modelId, version, task,
		artifactSha256s: Object.freeze([ordinal.toString(16).padStart(64, '0')]) });
}
