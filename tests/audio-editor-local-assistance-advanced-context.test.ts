/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceAdvancedSelectedContextPreparation,
	LocalAssistanceAdvancedContextUnavailableError,
} from '../src/common/editor/controller/local-assistance-advanced-selected-context.ts';
import { resolveLocalAssistanceSelectedAudioAuthority } from
	'../src/common/editor/controller/local-assistance-selected-preparation.ts';
import { createLocalAssistancePreparationRuntime } from
	'../src/common/editor/controller/local-assistance-runtime.ts';
import { reviewAssistanceEditorialGenerationPlanV1 } from
	'../src/common/editor/assistance/editorial-generation-v1.ts';
import {
	SOURCE_SHA256,
	transcriptAssetFixture,
} from './helpers/audio-editor-local-assistance-guided-preparation-fixture.ts';

const FENCE = Object.freeze({
	projectId: 'project-1', schemaFamily: 'framescaper' as const, schemaVersion: 1,
	revision: 4, sequenceId: 'main-sequence',
	occurrenceIds: Object.freeze(['voice-clip']), sourceId: 'voice-source',
	sourceSha256: SOURCE_SHA256, sourceStartFrame: 24_000, sourceEndFrame: 72_000,
	linkMembershipSha256: '12'.repeat(32), timingAuthoritySha256: '34'.repeat(32),
});

test('Advanced inventory admits transcript primitives only while exact local context exists', async () => {
	const transcript = transcriptAssetFixture();
	const fixture = contextFixture(transcript.transcriptProject, transcript.storageKey,
		transcript.transcriptBytes);
	const inventory = await fixture.preparation.listSelectedMedia();
	assert.deepEqual(inventory.sources[0]?.operations, [
		'voice-activity-detection', 'speech-recognition', 'word-alignment',
		'text-embedding', 'editorial-generation',
	]);
	assert.deepEqual(inventory.sources[1]?.operations, [
		'image-text-embedding', 'optical-character-recognition', 'shot-detection',
	]);

	fixture.deleteTranscript();
	assert.deepEqual((await fixture.preparation.listSelectedMedia()).sources[0]?.operations, [
		'voice-activity-detection', 'speech-recognition',
	]);
	await assert.rejects(fixture.preparation.prepareSelectedMedia({
		sourceId: 'voice-source', operation: 'text-embedding',
	}), LocalAssistanceAdvancedContextUnavailableError);
});

test('Advanced alignment composes authenticated transcript and audio into one primitive request', async () => {
	const transcript = transcriptAssetFixture();
	const fixture = contextFixture(transcript.transcriptProject, transcript.storageKey,
		transcript.transcriptBytes);
	const prepared = await fixture.preparation.prepareSelectedMedia({
		sourceId: 'voice-source', operation: 'word-alignment',
	}) as Readonly<Record<string, unknown>>;
	assert.deepEqual((prepared.inputs as Array<Readonly<Record<string, unknown>>>).map(({ role }) => role),
		['audio', 'transcript']);
	assert.deepEqual(fixture.preparedOperations, ['word-alignment']);
});

test('Advanced transcript embedding and editorial generation stage bounded inert context only', async () => {
	const transcript = transcriptAssetFixture();
	const fixture = contextFixture(transcript.transcriptProject, transcript.storageKey,
		transcript.transcriptBytes);
	const embedding = await fixture.preparation.prepareSelectedMedia({
		sourceId: 'voice-source', operation: 'text-embedding',
	}) as Prepared;
	assert.deepEqual(embedding.inputs.map(({ role }) => role), ['transcript']);
	assert.deepEqual(embedding.outputs, [{ role: 'embeddings',
		mediaType: 'application/vnd.soundscaper.embedding-matrix-v1',
		maximumByteLength: 64 * 1024 * 1024 }]);

	const editorial = await fixture.preparation.prepareSelectedMedia({
		sourceId: 'voice-source', operation: 'editorial-generation',
	}) as Prepared;
	assert.deepEqual(editorial.inputs.map(({ role }) => role), ['editorial-context']);
	const plan = reviewAssistanceEditorialGenerationPlanV1(
		JSON.parse(await editorial.inputs[0]!.bytes.text()) as unknown,
	);
	assert.deepEqual(plan.fields, ['title', 'hook', 'chapters', 'explanation']);
	assert.equal(plan.evidence[0]?.transcriptExcerpt,
		'Selected words for editorial generation');
	assert.deepEqual(fixture.preparedOperations, [],
		'transcript-only primitives never render selected audio');
});

test('selected linked video authenticates Advanced transcript context against its audio source', async () => {
	const transcript = transcriptAssetFixture();
	const project = { ...linkedProject(),
		assistanceAssets: transcript.transcriptProject.assistanceAssets };
	let renders = 0;
	const authorityDependencies = {
		getProject: () => project, getSelectedClipId: () => 'camera-clip',
		captureProject: () => null, assertProject: () => undefined,
		renderDryTrackRange: async () => { renders += 1; return [new Float32Array(1)]; },
	};
	const fixture = contextFixture(project, transcript.storageKey, transcript.transcriptBytes,
		(sourceId) => {
			const authority = resolveLocalAssistanceSelectedAudioAuthority(authorityDependencies);
			return authority.fence.sourceId === sourceId ? authority.fence : null;
		});
	const source = (await fixture.preparation.listSelectedMedia()).sources
		.find(({ sourceId }) => sourceId === 'voice-source');
	assert.equal(source?.operations.includes('word-alignment'), true);
	assert.equal(source?.operations.includes('text-embedding'), true);
	assert.equal(source?.operations.includes('editorial-generation'), true);
	assert.equal(renders, 0, 'context discovery resolves authority without rendering linked audio');
});

test('composed runtime exposes linked-audio Advanced context without video decoding or rendering', async () => {
	const transcript = transcriptAssetFixture();
	const project = { ...linkedProject(),
		assistanceAssets: transcript.transcriptProject.assistanceAssets };
	let renders = 0;
	const runtime = createLocalAssistancePreparationRuntime({
		assistanceStore: {
			getMediaAssetMetadata: async () => null,
			loadMediaAsset: async (key: string) => key === transcript.storageKey
				? Uint8Array.from(transcript.transcriptBytes) : null,
			beginMediaAssetWrite: async () => { throw new Error('not reached'); },
			beginSourceWrite: async () => { throw new Error('not reached'); },
			deleteSource: async () => undefined,
		},
		createId: (prefix) => `${prefix}-fixture`, preflightStorage: async () => undefined,
		getProject: () => project, getSelectedClipId: () => 'camera-clip',
		captureProject: () => project, assertProject: (token) => assert.equal(token, project),
		renderDryTrackRange: async () => { renders += 1; return [new Float32Array(1)]; },
		commit: () => undefined,
	});
	const audio = (await runtime.listSelectedMedia()).sources
		.find(({ sourceId }) => sourceId === 'voice-source');
	assert.equal(audio?.operations.includes('word-alignment'), true);
	assert.equal(audio?.operations.includes('text-embedding'), true);
	assert.equal(audio?.operations.includes('editorial-generation'), true);
	assert.equal(renders, 0);
});

test('selected-media router keeps visual embedding and OCR on authenticated video custody', async () => {
	const { createLocalAssistanceSelectedMediaPreparationRouter } = await import(
		'../src/common/editor/controller/local-assistance-selected-media-router.ts'
	);
	const calls: string[] = [];
	const port = (owner: 'audio' | 'video') => Object.freeze({
		async listSelectedMedia() { return { sources: [] }; },
		async prepareSelectedMedia(request: Readonly<{ operation: string }>) {
			calls.push(`${owner}:${request.operation}`); return { owner };
		},
	});
	const router = createLocalAssistanceSelectedMediaPreparationRouter({
		audio: port('audio'), video: port('video'),
	});
	assert.deepEqual(await router.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'image-text-embedding',
	}), { owner: 'video' });
	assert.deepEqual(await router.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'optical-character-recognition',
	}), { owner: 'video' });
	assert.deepEqual(calls, [
		'video:image-text-embedding', 'video:optical-character-recognition',
	]);
});

interface Prepared {
	readonly inputs: readonly Readonly<{ role: string; bytes: Blob }>[];
	readonly outputs: readonly Readonly<Record<string, unknown>>[];
}

function contextFixture(project: Readonly<Record<string, unknown>>, storageKey: string,
	transcriptBytes: Uint8Array,
	selectionFenceForSource: (sourceId: string) => unknown =
		(sourceId) => sourceId === FENCE.sourceId ? FENCE : null,
) {
	let retained: Uint8Array | null = transcriptBytes;
	const preparedOperations: string[] = [];
	const selected = Object.freeze({
		async listSelectedMedia() { return { sources: [
			{ sourceId: 'voice-source', label: 'Voice', mediaKind: 'audio',
				operations: ['voice-activity-detection', 'speech-recognition', 'word-alignment'] },
			{ sourceId: 'video-source', label: 'Video', mediaKind: 'video',
				operations: ['image-text-embedding', 'optical-character-recognition', 'shot-detection'] },
		] }; },
		async prepareSelectedMedia(request: Readonly<{ sourceId: string; operation: string }>) {
			preparedOperations.push(request.operation);
			return { sourceId: request.sourceId, operation: request.operation, selectionFence: FENCE,
				inputs: [{ role: 'audio', mediaType: 'audio/wav',
					bytes: new Blob(['wav'], { type: 'audio/wav' }) }],
				outputs: [{ role: 'word-alignment',
					mediaType: 'application/vnd.soundscaper.word-alignment+json',
					maximumByteLength: 4096 }],
			};
		},
	});
	const preparation = createLocalAssistanceAdvancedSelectedContextPreparation({
		getProject: () => project,
		selectionFenceForSource,
		loadTranscriptBody: async (key) => key === storageKey && retained
			? Uint8Array.from(retained) : null,
		selected,
	});
	return { preparation, preparedOperations, deleteTranscript() { retained = null; } };
}

function linkedProject() {
	return {
		id: 'project-1', schemaFamily: 'framescaper' as const, schemaVersion: 1,
		revision: 4, sampleRate: 48_000,
		primarySequenceId: 'main-sequence',
		selection: { startFrame: 48_000, endFrame: 96_000,
			clipIds: ['camera-clip'], trackIds: ['video-track'] },
		sources: [{ id: 'voice-source', name: 'Interview', kind: 'audio',
			contentSha256: SOURCE_SHA256, sampleRate: 48_000, frameCount: 192_000 },
			{ id: 'camera-source', name: 'Camera', kind: 'video', contentSha256: 'cd'.repeat(32) }],
		clips: [{ id: 'voice-clip', title: 'Interview clip', kind: 'audio', sourceId: 'voice-source',
			timelineStartFrame: 24_000, durationFrames: 144_000,
			sourceStartFrame: 12_000, sourceDurationFrames: 144_000,
			reversed: false, speedRatio: 1, pitchCents: 0, stretchToTempo: false,
			anchor: 'sample', warpMap: null, avLinkId: 'linked-1' },
			{ id: 'camera-clip', title: 'Camera', kind: 'video', sourceId: 'camera-source',
				sequenceId: 'main-sequence', avLinkId: 'linked-1' }],
		tracks: [{ id: 'voice-track', type: 'audio', name: 'Voice', clipIds: ['voice-clip'] },
			{ id: 'video-track', type: 'video', name: 'Camera', clipIds: ['camera-clip'] }],
	};
}
