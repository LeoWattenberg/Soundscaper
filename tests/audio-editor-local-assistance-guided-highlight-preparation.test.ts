/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	prepareLocalAssistanceGuidedHighlightInputsV1,
} from '../src/common/editor/controller/local-assistance-guided-highlight-preparation.ts';
import {
	prepareLocalAssistanceGuidedHighlightVisualEvidenceV1,
} from '../src/common/editor/controller/local-assistance-guided-highlight-visual-evidence.ts';
import { defaultAssistanceWorkflowSettingsV1 } from
	'../src/common/editor/assistance/workflow-settings-v1.ts';
import { createAssistanceEmbeddingMatrixV1 } from
	'../src/common/editor/assistance/binary-formats-v1.ts';
import { createAssistanceOwnedVideoHighlightTransformRegistryV1 } from
	'../src/common/editor/assistance/owned-video-highlight-transform-registry-v1.ts';
import {
	ASSISTANCE_SEMANTIC_DERIVATIVE_MEDIA_TYPE,
	createAssistanceSemanticDerivativeBundleV1,
} from '../src/common/editor/assistance/semantic-derivative-bundle-v1.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const VIDEO_SHA256 = '12'.repeat(32);
const AUDIO_SHA256 = '34'.repeat(32);
const LINK_SHA256 = '56'.repeat(32);

test('guided highlight preparation authenticates linked A/V and emits bounded JSON signals', async () => {
	const transcriptBytes = transcriptBody();
	const transcriptSha256 = bytesToHex(sha256(transcriptBytes));
	const storageKey = `assistance-transcript-sha256:${transcriptSha256}`;
	const fixture = highlightFixture({ transcriptBytes, transcriptSha256, storageKey });
	const result = await prepareLocalAssistanceGuidedHighlightInputsV1({
		project: fixture.project, inventory: fixture.inventory,
		settings: defaultAssistanceWorkflowSettingsV1('make-highlights'),
		signal: new AbortController().signal,
		describeSelectedVideoSourceTime: async () => ({
			selectionFence: fixture.videoFence, descriptor: fixture.descriptor,
		}),
		prepareSelectedMedia: async ({ operation }) => operation === 'shot-detection'
			? fixture.preparedVideo : fixture.preparedAudio,
		loadTranscriptBody: async (key) => key === storageKey
			? Uint8Array.from(transcriptBytes) : null,
	});
	assert.ok(result);
	assert.ok(result.audio);
	assert.ok(result.audioWave);
	assert.equal(result.embeddings, null);
	assert.equal(result.reviewVideo.mediaType, 'video/mp4');
	assert.equal(result.reviewVideo.bytes, fixture.preparedVideo.inputs[0]!.bytes);
	assert.deepEqual(result.reviewVideo.fence, fixture.videoFence);
	assert.equal(result.video.mediaType,
		'application/vnd.soundscaper.highlight-video-signals+json');
	assert.equal(result.audio.mediaType,
		'application/vnd.soundscaper.highlight-audio-signals+json');
	assert.equal(result.transcript?.mediaType,
		'application/vnd.soundscaper.highlight-transcript-signals+json');
	assert.equal(result.audioWave.mediaType, 'audio/wav');
	assert.deepEqual(result.video.fence, fixture.videoFence);
	assert.deepEqual(result.audio.fence, fixture.audioFence);
	assert.deepEqual(result.audioWave.fence, fixture.audioFence);

	const video = await jsonBody(result.video.bytes);
	assert.equal(video.kind, 'highlight-video-signals');
	assert.equal(video.videoOccurrenceId, 'video-clip');
	assert.equal(video.audioOccurrenceId, 'audio-clip');
	assert.deepEqual(video.windows, [{
		id: `highlight:${VIDEO_SHA256.slice(0, 12)}:0:15`,
		startFrame: 0, endFrame: 15_000, shotStructure: 0, visualInterest: 0,
	}]);
	const audio = await jsonBody(result.audio.bytes);
	assert.equal(audio.kind, 'highlight-audio-signals');
	assert.deepEqual(audio.signals, [{
		candidateId: `highlight:${VIDEO_SHA256.slice(0, 12)}:0:15`,
		energyDynamics: 0.888889,
	}]);
	const transcript = await jsonBody(result.transcript!.bytes);
	assert.equal(transcript.kind, 'highlight-transcript-signals');
	assert.deepEqual((transcript.signals as readonly Record<string, unknown>[])
		.map(({ candidateId }) => candidateId),
		[`highlight:${VIDEO_SHA256.slice(0, 12)}:0:15`]);
});

test('guided highlight preparation keeps transcript optional and rejects unlinked authority', async () => {
	const fixture = highlightFixture();
	const withoutTranscript = await prepareLocalAssistanceGuidedHighlightInputsV1({
		project: fixture.project, inventory: fixture.inventory,
		settings: defaultAssistanceWorkflowSettingsV1('make-highlights'),
		signal: new AbortController().signal,
		describeSelectedVideoSourceTime: async () => ({
			selectionFence: fixture.videoFence, descriptor: fixture.descriptor,
		}),
		prepareSelectedMedia: async ({ operation }) => operation === 'shot-detection'
			? fixture.preparedVideo : fixture.preparedAudio,
	});
	assert.ok(withoutTranscript);
	assert.equal(withoutTranscript.transcript, null);

	const unlinkedProject = { ...fixture.project,
		clips: fixture.project.clips.map((clip) => clip.id === 'audio-clip'
			? { ...clip, avLinkId: 'different-link' } : clip) };
	assert.equal(await prepareLocalAssistanceGuidedHighlightInputsV1({
		project: unlinkedProject, inventory: fixture.inventory,
		settings: defaultAssistanceWorkflowSettingsV1('make-highlights'),
		signal: new AbortController().signal,
		describeSelectedVideoSourceTime: async () => ({
			selectionFence: fixture.videoFence, descriptor: fixture.descriptor,
		}),
		prepareSelectedMedia: async ({ operation }) => operation === 'shot-detection'
			? fixture.preparedVideo : fixture.preparedAudio,
	}), null);
});

test('guided highlight preparation admits video-only speechless source authority', async () => {
	const fixture = highlightFixture();
	const videoOnlyProject = { ...fixture.project,
		sources: fixture.project.sources.filter(({ kind }) => kind === 'video'),
		clips: fixture.project.clips.filter(({ kind }) => kind === 'video').map((clip) => ({
			...clip, avLinkId: null,
		})),
	};
	const videoOnlyFence = { ...fixture.videoFence, occurrenceIds: ['video-clip'] };
	const result = await prepareLocalAssistanceGuidedHighlightInputsV1({
		project: videoOnlyProject,
		inventory: [{ sourceId: 'video-source', mediaKind: 'video' }],
		settings: defaultAssistanceWorkflowSettingsV1('make-highlights'),
		signal: new AbortController().signal,
		describeSelectedVideoSourceTime: async () => ({
			selectionFence: videoOnlyFence, descriptor: fixture.descriptor,
		}),
		prepareSelectedMedia: async ({ operation, shotDetectionMode }) => {
			assert.equal(operation, 'shot-detection');
			assert.equal(shotDetectionMode, 'fast');
			return { ...fixture.preparedVideo, selectionFence: videoOnlyFence };
		},
	});
	assert.ok(result);
	assert.equal(result.audio, null);
	assert.equal(result.audioWave, null);
	assert.equal(result.transcript, null);
	assert.equal(result.embeddings, null);
	assert.equal(result.reviewVideo.mediaType, 'video/mp4');
	assert.deepEqual(result.reviewVideo.fence, videoOnlyFence);
	assert.deepEqual(result.video.fence, videoOnlyFence);
	const video = await jsonBody(result.video.bytes);
	assert.equal(video.audioOccurrenceId, null);
	assert.equal((video.windows as readonly unknown[]).length, 1);
});

test('guided highlight visual evidence derives semantic interest and duplication from its index', async () => {
	const root = Math.fround(Math.SQRT1_2);
	const matrix = createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [
		[1, 0], [1, 0], [root, root], [root, root], [1, 0], [1, 0],
	] });
	const bytes = createAssistanceSemanticDerivativeBundleV1({
		provider: 'visual', schemaFamily: 'framescaper', schemaVersion: 1,
		projectId: 'project-a', projectRevision: 7,
		sequenceId: 'sequence-a', sourceId: 'video-source', matrix,
		rows: [5_000, 10_000, 20_000, 25_000, 35_000, 40_000].map((timelineFrame, index) => ({
			resultId: `visual-${String(index)}`, timelineFrame, label: 'Authenticated visual sample',
		})), ocr: [],
	});
	const videoFence = { ...fence('video-source', VIDEO_SHA256, 0, 45, '78'.repeat(32)),
		occurrenceIds: ['video-clip'] };
	const descriptor = {
		descriptorVersion: 1 as const, kind: 'selected-video-source-time-authority' as const,
		schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
		projectId: 'project-a', projectRevision: 7, sequenceId: 'sequence-a',
		videoOccurrenceId: 'video-clip', sourceId: 'video-source', sourceSha256: VIDEO_SHA256,
		timingAuthoritySha256: videoFence.timingAuthoritySha256,
		sourceWidth: 1_920, sourceHeight: 1_080, sourceStartFrame: 0, sourceEndFrame: 45,
		sampleRate: 1_000, timescale: 1_000, selectionStartFrame: 0, selectionEndFrame: 45_000,
		frames: [0, 15, 30, 45].map((sourceFrame) => ({ sourceFrame,
			presentationTick: String(sourceFrame * 1_000), timelineFrame: sourceFrame * 1_000 })),
	};
	const records = [{ recordVersion: 1, derivativeVersion: 1,
			schemaFamily: 'framescaper', schemaVersion: 1,
			kind: 'visual-index', projectId: 'project-a',
			mediaType: ASSISTANCE_SEMANTIC_DERIVATIVE_MEDIA_TYPE,
			payloadByteLength: bytes.byteLength, payloadSha256: bytesToHex(sha256(bytes)), bytes }];
	const prepared = await prepareLocalAssistanceGuidedHighlightInputsV1({
		project: { id: 'project-a', schemaFamily: 'framescaper', schemaVersion: 1,
			revision: 7, sampleRate: 1_000,
			sources: [{ id: 'video-source', kind: 'video', contentSha256: VIDEO_SHA256 }],
			clips: [{ id: 'video-clip', kind: 'video', sourceId: 'video-source',
				sequenceId: 'sequence-a', avLinkId: null, reversed: false, speedRatio: 1 }] },
		inventory: [{ sourceId: 'video-source', mediaKind: 'video' }],
		settings: defaultAssistanceWorkflowSettingsV1('make-highlights'),
		signal: new AbortController().signal,
		describeSelectedVideoSourceTime: async () => ({ selectionFence: videoFence, descriptor }),
		prepareSelectedMedia: async () => ({ sourceId: 'video-source',
			operation: 'shot-detection', shotDetectionMode: 'fast', selectionFence: videoFence,
			inputs: [{ role: 'video', mediaType: 'video/mp4',
				bytes: new Blob([new Uint8Array([1])], { type: 'video/mp4' }) }], outputs: [] }),
		loadVisualIndexDerivatives: async (projectId) => {
			assert.equal(projectId, 'project-a');
			return records;
		},
	});
	assert.ok(prepared?.embeddings);
	const video = await jsonBody(prepared.video.bytes);
	const windows = video.windows as readonly Readonly<{ visualInterest: number }>[];
	assert.deepEqual(windows.map(({ visualInterest }) => visualInterest), [
		0, 0.292893230915, 0,
	]);
	const gathered = createAssistanceOwnedVideoHighlightTransformRegistryV1().run({
		schemaVersion: 1, transformId: 'gather-signals',
		settings: defaultAssistanceWorkflowSettingsV1('make-highlights'),
		inputs: { video, audio: null, transcript: null,
			'shot-boundaries': null, 'audio-tags': null, 'reaction-ranges': null,
			embeddings: new Uint8Array(await prepared.embeddings.bytes.arrayBuffer()) },
	}).outputs['highlight-signals'];
	assert.deepEqual(gathered.candidates.map(({ visualInterest, duplication,
		speechlessAvailableWeight, audioOccurrenceId }) => ({ visualInterest, duplication,
		speechlessAvailableWeight, audioOccurrenceId })), [
		{ visualInterest: 0, duplication: 1, speechlessAvailableWeight: 0.4,
			audioOccurrenceId: null },
		{ visualInterest: 0.292893230915, duplication: root,
			speechlessAvailableWeight: 0.4, audioOccurrenceId: null },
		{ visualInterest: 0, duplication: 1, speechlessAvailableWeight: 0.4,
			audioOccurrenceId: null },
	]);
});

test('guided highlight visual evidence rejects a Float32-scale cancelling centroid', () => {
	const matrix = createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [
		[1, 0], [-1, 2 ** -24],
	] });
	const bytes = createAssistanceSemanticDerivativeBundleV1({
		provider: 'visual', schemaFamily: 'framescaper', schemaVersion: 1,
		projectId: 'project-a', projectRevision: 7,
		sequenceId: 'sequence-a', sourceId: 'video-source', matrix,
		rows: [1, 2].map((timelineFrame, index) => ({
			resultId: `cancelling-visual-${String(index)}`, timelineFrame,
			label: 'Cancelling visual sample',
		})), ocr: [],
	});
	const video = {
		schemaVersion: 1 as const, kind: 'highlight-video-signals' as const,
		sourceId: 'video-source', sampleRate: 1_000, timescale: 1_000,
		sourceSize: { width: 1_920, height: 1_080 },
		videoOccurrenceId: 'video-clip', audioOccurrenceId: null,
		selectionStartFrame: 0, selectionEndFrame: 10,
		reframeEvidence: null, sourceTimeAuthority: [],
		windows: [{ id: 'window-a', startFrame: 0, endFrame: 10,
			shotStructure: 0 as const, visualInterest: 0 }],
	};
	const visualFence = fence('video-source', VIDEO_SHA256, 0, 10, '78'.repeat(32));
	const record = { recordVersion: 1, derivativeVersion: 1,
		schemaFamily: 'framescaper', schemaVersion: 1,
		kind: 'visual-index', projectId: 'project-a',
		mediaType: ASSISTANCE_SEMANTIC_DERIVATIVE_MEDIA_TYPE,
		payloadByteLength: bytes.byteLength, payloadSha256: bytesToHex(sha256(bytes)), bytes };

	assert.equal(prepareLocalAssistanceGuidedHighlightVisualEvidenceV1({
		video, fence: visualFence, records: [record], signal: new AbortController().signal,
	}), null);
});

test('guided highlight preparation refuses stale audio geometry and cancellation', async () => {
	const fixture = highlightFixture();
	await assert.rejects(prepareLocalAssistanceGuidedHighlightInputsV1({
		project: fixture.project, inventory: fixture.inventory,
		settings: defaultAssistanceWorkflowSettingsV1('make-highlights'),
		signal: new AbortController().signal,
		describeSelectedVideoSourceTime: async () => ({
			selectionFence: fixture.videoFence, descriptor: fixture.descriptor,
		}),
		prepareSelectedMedia: async ({ operation }) => operation === 'shot-detection'
			? fixture.preparedVideo : { ...fixture.preparedAudio,
				selectionFence: { ...fixture.audioFence, occurrenceIds: ['video-clip'] } },
	}), /occurrence|authority|linked/iu);

	const controller = new AbortController();
	controller.abort();
	await assert.rejects(prepareLocalAssistanceGuidedHighlightInputsV1({
		project: fixture.project, inventory: fixture.inventory,
		settings: defaultAssistanceWorkflowSettingsV1('make-highlights'), signal: controller.signal,
		describeSelectedVideoSourceTime: async () => ({
			selectionFence: fixture.videoFence, descriptor: fixture.descriptor,
		}),
		prepareSelectedMedia: async ({ operation }) => operation === 'shot-detection'
			? fixture.preparedVideo : fixture.preparedAudio,
	}), { name: 'AbortError' });
});

function highlightFixture(transcript?: Readonly<{
	transcriptBytes: Uint8Array; transcriptSha256: string; storageKey: string;
}>) {
	const videoFence = fence('video-source', VIDEO_SHA256, 0, 15, '78'.repeat(32));
	const audioFence = fence('audio-source', AUDIO_SHA256, 0, 480_000, '9a'.repeat(32));
	const descriptor = {
		descriptorVersion: 1 as const, kind: 'selected-video-source-time-authority' as const,
		schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
		projectId: 'project-a', projectRevision: 7, sequenceId: 'sequence-a',
		videoOccurrenceId: 'video-clip', sourceId: 'video-source', sourceSha256: VIDEO_SHA256,
		timingAuthoritySha256: videoFence.timingAuthoritySha256,
		sourceWidth: 1_920, sourceHeight: 1_080, sourceStartFrame: 0, sourceEndFrame: 15,
		sampleRate: 1_000, timescale: 1_000, selectionStartFrame: 0,
		selectionEndFrame: 15_000, frames: [
			{ sourceFrame: 0, presentationTick: '0', timelineFrame: 0 },
			{ sourceFrame: 15, presentationTick: '15000', timelineFrame: 15_000 },
		],
	};
	const samples = new Float32Array(480_000);
	samples.fill(0.1, 0, 240_000);
	samples.fill(0.9, 240_000);
	const wav = encodeWav([samples], {
		sampleRate: 32_000, bitDepth: 32, float: true, dither: false,
	});
	const assistanceAssets = transcript ? [{
		id: 'transcript-a', kind: 'transcript-v1', sourceId: 'audio-source',
		sourceSha256: AUDIO_SHA256, sourceStartFrame: 0, sourceEndFrame: 480_000,
		sourceVideoTimingSha256: null, recipeId: 'speech-transcript', recipeVersion: 1,
		modelArtifactSha256s: ['ab'.repeat(32)], body: {
			storageKey: transcript.storageKey,
			mimeType: 'application/vnd.soundscaper.assistance-transcript+json',
			byteLength: transcript.transcriptBytes.byteLength,
			sha256: transcript.transcriptSha256,
		},
	}] : [];
	const project = { id: 'project-a', schemaFamily: 'framescaper', schemaVersion: 1,
		revision: 7,
		sampleRate: 1_000, assistanceAssets,
		sources: [{ id: 'video-source', kind: 'video', contentSha256: VIDEO_SHA256 },
			{ id: 'audio-source', kind: 'audio', contentSha256: AUDIO_SHA256,
				sampleRate: 32_000 }],
		clips: [{ id: 'video-clip', kind: 'video', sourceId: 'video-source',
			sequenceId: 'sequence-a', avLinkId: 'linked-a', reversed: false, speedRatio: 1 },
		{ id: 'audio-clip', kind: 'audio', sourceId: 'audio-source',
			sequenceId: 'sequence-a', avLinkId: 'linked-a', reversed: false, speedRatio: 1,
			pitchCents: 0, stretchToTempo: false, warpMap: null }],
	};
	return { project, descriptor, videoFence, audioFence,
		inventory: [{ sourceId: 'video-source', mediaKind: 'video' },
			{ sourceId: 'audio-source', mediaKind: 'audio' }],
		preparedVideo: { sourceId: 'video-source', operation: 'shot-detection',
			shotDetectionMode: 'fast', selectionFence: videoFence,
			inputs: [{ role: 'video', mediaType: 'video/mp4',
				bytes: new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' }) }], outputs: [] },
		preparedAudio: { sourceId: 'audio-source', operation: 'audio-tagging',
			selectionFence: audioFence, inputs: [{ role: 'audio', mediaType: 'audio/wav',
				bytes: new Blob([wav.slice().buffer], { type: 'audio/wav' }) }], outputs: [] },
	};
}

function fence(
	sourceId: string, sourceSha256: string, sourceStartFrame: number,
	sourceEndFrame: number, timingAuthoritySha256: string,
) {
	return { schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
		projectId: 'project-a', revision: 7,
		sequenceId: 'sequence-a', occurrenceIds: ['audio-clip', 'video-clip'], sourceId,
		sourceSha256, sourceStartFrame, sourceEndFrame, linkMembershipSha256: LINK_SHA256,
		timingAuthoritySha256 };
}

function transcriptBody(): Uint8Array {
	return new TextEncoder().encode(JSON.stringify({ schemaVersion: 1,
		sourceId: 'audio-source', sampleRate: 32_000, language: 'en', modelId: 'whisper-small',
		segments: [{ startFrame: 16_000, endFrame: 400_000,
			text: 'Why does this authenticated clip deliver a complete payoff?', speaker: null,
			words: [{ text: 'Why', startFrame: 16_000, endFrame: 24_000, confidence: 0.95 }],
		}],
	}));
}

async function jsonBody(blob: Blob): Promise<Record<string, unknown>> {
	return JSON.parse(await blob.text()) as Record<string, unknown>;
}
