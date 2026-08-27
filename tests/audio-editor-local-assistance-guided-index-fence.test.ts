/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { assistanceWorkflowStageGraph } from
	'../src/common/editor/assistance/workflow.ts';
import { serializeAssistanceWorkflowSettingsV1 } from
	'../src/common/editor/assistance/workflow-settings-v1.ts';
import { defaultAssistanceWorkflowSettingsV1 } from
	'../src/common/editor/assistance/workflow-settings-v1.ts';
import { createLocalAssistanceGuidedAggregateFenceV1 } from
	'../src/common/editor/controller/local-assistance-guided-fence.ts';
import { createLocalAssistanceGuidedPublicationFenceResolver } from
	'../src/common/editor/controller/local-assistance-guided-publication-fence.ts';
import { assistanceWorkflowFixture } from './helpers/assistance-workflow-fixture.ts';

const SOURCE_SHA256 = '12'.repeat(32);
const LINK_SHA256 = '34'.repeat(32);
const TIMING_SHA256 = '56'.repeat(32);
const MODEL = Object.freeze({ bindingVersion: 1 as const, stageId: 'embed-transcript',
	slotId: 'text-embedder', modelId: 'nomic-embed-text-v1.5', version: '1.5.0',
	artifactSha256s: Object.freeze(['78'.repeat(32)]) });
const STAGES = Object.freeze(['chunk-transcript', 'embed-transcript',
	'publish-transcript-index']);
const TRANSCRIPT = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1,
	sourceId: 'source-a', sampleRate: 48_000, language: 'en', modelId: 'parakeet',
	segments: [{ startFrame: 0, endFrame: 48_000, text: 'One authenticated transcript.',
		words: [], speaker: null }] }));
const TRANSCRIPT_SHA256 = bytesToHex(sha256(TRANSCRIPT));
const STORAGE_KEY = `assistance-transcript-sha256:${TRANSCRIPT_SHA256}`;
const PRIMITIVE_FENCE = Object.freeze({ projectId: 'project-a', schemaVersion: 31,
	revision: 8, sequenceId: 'sequence-a', occurrenceIds: Object.freeze(['occurrence-a']),
	sourceId: 'source-a', sourceSha256: SOURCE_SHA256, sourceStartFrame: 0,
	sourceEndFrame: 96_000, linkMembershipSha256: LINK_SHA256,
	timingAuthoritySha256: TIMING_SHA256 });
const VIDEO_FENCE = Object.freeze({ ...PRIMITIVE_FENCE, sourceEndFrame: 240 });

test('transcript index publication reconstructs exact live aggregate authority and rereads its body',
	async () => {
		const state = fixture();
		const workflow = transcriptWorkflow(state.project);
		const resolver = createLocalAssistanceGuidedPublicationFenceResolver(state.dependencies);
		assert.deepEqual(await resolver.resolveCurrentFence(
			workflow, new AbortController().signal,
		), workflow.fence);
		assert.deepEqual(state.loads, [STORAGE_KEY]);
		assert.equal(state.assertions >= 2, true);
	});

test('transcript index publication refuses deleted, corrupt, and stale live custody', async () => {
	const state = fixture();
	const workflow = transcriptWorkflow(state.project);
	const resolver = createLocalAssistanceGuidedPublicationFenceResolver(state.dependencies);
	state.body = null;
	await assert.rejects(resolver.resolveCurrentFence(workflow, new AbortController().signal),
		/unavailable|body|custody/iu);
	state.body = Uint8Array.from([...TRANSCRIPT, 0]);
	await assert.rejects(resolver.resolveCurrentFence(workflow, new AbortController().signal),
		/changed|digest|body/iu);
	state.body = TRANSCRIPT;
	state.stale = true;
	await assert.rejects(resolver.resolveCurrentFence(workflow, new AbortController().signal),
		/stale/iu);
});

test('ordinary transcript publication rereads the aggregate transcript body', async () => {
	const state = fixture();
	const workflow = speakerWorkflow(state.project);
	const resolver = createLocalAssistanceGuidedPublicationFenceResolver(state.dependencies);
	assert.deepEqual(await resolver.resolveCurrentFence(
		workflow, new AbortController().signal,
	), workflow.fence);
	assert.deepEqual(state.loads, [STORAGE_KEY]);
	state.body = null;
	await assert.rejects(resolver.resolveCurrentFence(workflow, new AbortController().signal),
		/unavailable|body|custody/iu);
});

test('a single-source aggregate retains the complete linked A/V occurrence authority', () => {
	const linkedFence = Object.freeze({ ...PRIMITIVE_FENCE,
		occurrenceIds: Object.freeze(['audio-occurrence', 'video-occurrence']) });
	const project: Record<string, unknown> = {
		id: 'project-a', schemaVersion: 31, revision: 8, sampleRate: 48_000,
		primarySequenceId: 'sequence-a', subsequences: [], multicameraGroups: [],
		sources: [
			{ id: 'source-a', kind: 'audio', sampleRate: 48_000,
				contentSha256: SOURCE_SHA256 },
			{ id: 'source-video', kind: 'video', contentSha256: '91'.repeat(32) },
		],
		clips: [
			{ id: 'audio-occurrence', kind: 'audio', sourceId: 'source-a',
				sequenceId: 'sequence-a', avLinkId: 'link-a', reversed: false, speedRatio: 1,
				stretchToTempo: false, warpMap: null },
			{ id: 'video-occurrence', kind: 'video', sourceId: 'source-video',
				sequenceId: 'sequence-a', avLinkId: 'link-a', reversed: false, speedRatio: 1 },
		],
		tracks: [], assistanceAssets: [],
	};
	const settings = defaultAssistanceWorkflowSettingsV1('transcribe-captions');
	const aggregate = createLocalAssistanceGuidedAggregateFenceV1({ project,
		primitiveFences: [linkedFence], stages: assistanceWorkflowStageGraph('transcribe-captions'),
		settingsBody: serializeAssistanceWorkflowSettingsV1(settings), models: [] });

	assert.deepEqual(aggregate.sourceRanges[0]?.occurrenceIds, linkedFence.occurrenceIds,
		'the aggregate must not narrow the current primitive linked-occurrence fence');
});

test('video index publication reauthenticates the external original and exact video fence', async () => {
	const project: Record<string, unknown> = {
		id: 'project-a', schemaVersion: 31, revision: 8, sampleRate: 48_000,
		primarySequenceId: 'sequence-a', subsequences: [], multicameraGroups: [],
		sources: [{ id: 'source-a', kind: 'video', contentSha256: SOURCE_SHA256 }],
		clips: [{ id: 'occurrence-a', kind: 'video', sourceId: 'source-a',
			sequenceId: 'sequence-a', avLinkId: null, reversed: false, speedRatio: 1 }],
		tracks: [{ id: 'track-a', type: 'video', clipIds: ['occurrence-a'] }],
		assistanceAssets: [],
	};
	const workflow = videoWorkflow(project);
	let externalFailure: Error | null = null;
	const preparations: unknown[] = [];
	const resolver = createLocalAssistanceGuidedPublicationFenceResolver({
		getProject: () => project, captureProject: () => 8, assertProject: () => undefined,
		currentSelectionFence: () => VIDEO_FENCE,
		currentVideoSelectionFence: () => VIDEO_FENCE,
		selected: {
			listSelectedMedia: async () => ({ sources: [] }),
			prepareSelectedMedia: async (request) => {
				preparations.push(request);
				if (externalFailure !== null) throw externalFailure;
				return { sourceId: 'source-a', operation: 'shot-detection',
					shotDetectionMode: 'fast', selectionFence: VIDEO_FENCE };
			},
		},
	});
	assert.deepEqual(await resolver.resolveCurrentFence(
		workflow, new AbortController().signal,
	), workflow.fence);
	assert.equal(preparations.length, 1);
	assert.deepEqual(preparations[0], { sourceId: 'source-a', operation: 'shot-detection',
		shotDetectionMode: 'fast', signal: (preparations[0] as { signal: AbortSignal }).signal });
	for (const message of ['external original unavailable', 'external original digest mismatch']) {
		externalFailure = new Error(message);
		await assert.rejects(resolver.resolveCurrentFence(workflow, new AbortController().signal),
			new RegExp(message, 'u'));
	}
});

function transcriptWorkflow(project: Record<string, unknown>) {
	const settings = { settingsVersion: 1 as const, workflowId: 'index-transcript' as const,
		chunkTokens: 256, overlapTokens: 32 };
	const fence = createLocalAssistanceGuidedAggregateFenceV1({ project,
		primitiveFences: [PRIMITIVE_FENCE],
		stages: assistanceWorkflowStageGraph('index-transcript'),
		settingsBody: serializeAssistanceWorkflowSettingsV1(settings), models: [MODEL] });
	return assistanceWorkflowFixture({ workflowId: 'index-transcript', settings,
		stageIds: STAGES, models: [MODEL], fence,
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

function speakerWorkflow(project: Record<string, unknown>) {
	const settings = defaultAssistanceWorkflowSettingsV1('identify-speakers');
	const stageIds = ['diarize-speakers', 'attribute-speakers'];
	const models = [
		{ bindingVersion: 1 as const, stageId: 'diarize-speakers', slotId: 'diarizer',
			modelId: 'sherpa-pyannote', version: '1.0.0', artifactSha256s: ['82'.repeat(32)] },
		{ bindingVersion: 1 as const, stageId: 'diarize-speakers', slotId: 'speaker-embedding',
			modelId: 'sherpa-eres2net', version: '1.0.0', artifactSha256s: ['83'.repeat(32)] },
	];
	const stages = assistanceWorkflowStageGraph('identify-speakers');
	const fence = createLocalAssistanceGuidedAggregateFenceV1({ project,
		primitiveFences: [PRIMITIVE_FENCE], stages,
		settingsBody: serializeAssistanceWorkflowSettingsV1(settings), models });
	return assistanceWorkflowFixture({ workflowId: 'identify-speakers', settings, stageIds,
		models, fence,
		inputs: [
			claim('input', 'diarize-speakers', 'audio', 1),
			claim('input', 'attribute-speakers', 'transcript', 2),
			claim('input', 'attribute-speakers', 'speaker-turns', 3),
		],
		outputs: [
			claim('output', 'diarize-speakers', 'speaker-turns', 4),
			claim('output', 'attribute-speakers', 'attributed-transcript', 5),
		],
	});
}

function videoWorkflow(project: Record<string, unknown>) {
	const settings = { settingsVersion: 1 as const, workflowId: 'index-video' as const,
		shotMode: 'fast' as const, includeOcr: false };
	const stageIds = ['detect-shots', 'sample-shot-frames', 'embed-visuals',
		'publish-video-index'];
	const models = [{ bindingVersion: 1 as const, stageId: 'embed-visuals',
		slotId: 'visual-embedder', modelId: 'siglip2-so400m', version: '1.0.0',
		artifactSha256s: ['81'.repeat(32)] }];
	const stages = assistanceWorkflowStageGraph('index-video')
		.filter(({ stageId }) => stageIds.includes(stageId));
	const fence = createLocalAssistanceGuidedAggregateFenceV1({ project,
		primitiveFences: [VIDEO_FENCE], stages,
		settingsBody: serializeAssistanceWorkflowSettingsV1(settings), models });
	return assistanceWorkflowFixture({ workflowId: 'index-video', settings, stageIds, models, fence,
		inputs: [
			claim('input', 'detect-shots', 'video', 1),
			claim('input', 'sample-shot-frames', 'video', 2),
			claim('input', 'sample-shot-frames', 'video-authority', 3),
			claim('input', 'sample-shot-frames', 'shot-boundaries', 4),
			claim('input', 'embed-visuals', 'frame-pack', 5),
			claim('input', 'publish-video-index', 'visual-embeddings', 6),
		],
		outputs: [
			claim('output', 'detect-shots', 'shot-boundaries', 7),
			claim('output', 'sample-shot-frames', 'frame-pack', 8),
			claim('output', 'embed-visuals', 'visual-embeddings', 9),
			claim('output', 'publish-video-index', 'video-index', 10),
		],
	});
}

function fixture() {
	const project: Record<string, unknown> = {
		id: 'project-a', schemaVersion: 31, revision: 8, sampleRate: 48_000,
		primarySequenceId: 'sequence-a', subsequences: [], multicameraGroups: [],
		sources: [{ id: 'source-a', kind: 'audio', sampleRate: 48_000,
			contentSha256: SOURCE_SHA256 }],
		clips: [{ id: 'occurrence-a', kind: 'audio', sourceId: 'source-a',
			sequenceId: 'sequence-a', avLinkId: null, reversed: false, speedRatio: 1,
			stretchToTempo: false, warpMap: null }],
		tracks: [{ id: 'track-a', type: 'audio', clipIds: ['occurrence-a'] }],
		assistanceAssets: [{ id: 'transcript-a', kind: 'transcript-v1', sourceId: 'source-a',
			sourceSha256: SOURCE_SHA256, sourceStartFrame: 0, sourceEndFrame: 96_000,
			sourceVideoTimingSha256: null, recipeId: 'speech-transcript', recipeVersion: 1,
			modelArtifactSha256s: ['90'.repeat(32)], body: { storageKey: STORAGE_KEY,
				mimeType: 'application/vnd.soundscaper.assistance-transcript+json',
				byteLength: TRANSCRIPT.byteLength, sha256: TRANSCRIPT_SHA256 } }],
	};
	const state: {
		project: Record<string, unknown>;
		body: Uint8Array | null;
		stale: boolean;
		loads: string[];
		assertions: number;
		dependencies: Parameters<typeof createLocalAssistanceGuidedPublicationFenceResolver>[0];
	} = { project, body: TRANSCRIPT, stale: false, loads: [], assertions: 0,
		dependencies: null as never };
	state.dependencies = {
		getProject: () => state.project,
		captureProject: () => ({ revision: 8 }),
		assertProject: () => {
			state.assertions += 1;
			if (state.stale) throw new DOMException('stale', 'AbortError');
		},
		currentSelectionFence: () => PRIMITIVE_FENCE,
		loadTranscriptBody: (storageKey) => {
			state.loads.push(storageKey);
			return storageKey === STORAGE_KEY ? state.body : null;
		},
		selected: {
			listSelectedMedia: async () => ({ sources: [{ sourceId: 'source-a',
				mediaKind: 'audio' }] }),
			prepareSelectedMedia: async (request) => ({ sourceId: 'source-a',
				operation: request.operation, selectionFence: PRIMITIVE_FENCE }),
		},
	};
	return state;
}

function claim(direction: 'input' | 'output', stageId: string, slotId: string, index: number) {
	return { claimVersion: 1 as const, direction, claimId: index.toString(16).padStart(40, '0'),
		jobId: '01'.repeat(20), stageId, slotId };
}
