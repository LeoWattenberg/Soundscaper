/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	prepareLocalAssistanceGuidedHighlightInputsV1,
} from '../src/common/editor/controller/local-assistance-guided-highlight-preparation.ts';
import { defaultAssistanceWorkflowSettingsV1 } from
	'../src/common/editor/assistance/workflow-settings-v1.ts';
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
		prepareSelectedMedia: async () => fixture.preparedAudio,
		loadTranscriptBody: async (key) => key === storageKey
			? Uint8Array.from(transcriptBytes) : null,
	});
	assert.ok(result);
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
		prepareSelectedMedia: async () => fixture.preparedAudio,
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
		prepareSelectedMedia: async () => fixture.preparedAudio,
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
		prepareSelectedMedia: async () => ({ ...fixture.preparedAudio,
			selectionFence: { ...fixture.audioFence, occurrenceIds: ['video-clip'] } }),
	}), /occurrence|authority|linked/iu);

	const controller = new AbortController();
	controller.abort();
	await assert.rejects(prepareLocalAssistanceGuidedHighlightInputsV1({
		project: fixture.project, inventory: fixture.inventory,
		settings: defaultAssistanceWorkflowSettingsV1('make-highlights'), signal: controller.signal,
		describeSelectedVideoSourceTime: async () => ({
			selectionFence: fixture.videoFence, descriptor: fixture.descriptor,
		}),
		prepareSelectedMedia: async () => fixture.preparedAudio,
	}), { name: 'AbortError' });
});

function highlightFixture(transcript?: Readonly<{
	transcriptBytes: Uint8Array; transcriptSha256: string; storageKey: string;
}>) {
	const videoFence = fence('video-source', VIDEO_SHA256, 0, 15, '78'.repeat(32));
	const audioFence = fence('audio-source', AUDIO_SHA256, 0, 480_000, '9a'.repeat(32));
	const descriptor = {
		schemaVersion: 1 as const, kind: 'selected-video-source-time-authority' as const,
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
	const project = { id: 'project-a', schemaVersion: 30, revision: 7,
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
		preparedAudio: { sourceId: 'audio-source', operation: 'audio-tagging',
			selectionFence: audioFence, inputs: [{ role: 'audio', mediaType: 'audio/wav',
				bytes: new Blob([wav.slice().buffer], { type: 'audio/wav' }) }], outputs: [] },
	};
}

function fence(
	sourceId: string, sourceSha256: string, sourceStartFrame: number,
	sourceEndFrame: number, timingAuthoritySha256: string,
) {
	return { projectId: 'project-a', schemaVersion: 30, revision: 7,
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
