/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	computeAudioTrackFreezeDigestsV1,
	type AudioTrackFreezeV1,
} from '../src/common/editor/audio-track-freeze-v21.ts';
import {
	projectForAudioRenderedFallbackExport,
} from '../src/common/editor/controller/audio-rendered-fallback-export.ts';
import {
	projectForVideoRenderedFallbackExport,
} from '../src/common/editor/controller/video-rendered-fallback-export.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	createSoundscaperAudioTrackFreezePlaybackService,
} from '../src/soundscaper/editor-audio-track-freeze-playback.ts';
import { createSoundscaperPlaybackProjectService } from '../src/soundscaper/editor-project-playback.ts';
import {
	createSoundscaperProjectRuntimeSelection,
} from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperVideoExportStrategy } from '../src/soundscaper/video-export-strategy.ts';

/**
 * A fresh freeze is a substitution, not a compatibility fallback.
 *
 * The freeze wrapper publishes the derived render's source as a required root of
 * the delivery projection while leaving the rendered-fallback metadata null: the
 * render reads that source from the project like any other. The delivery
 * assertions read a retained root as evidence that a projector had lost its
 * fallback metadata and refused it, so every export of a project with one frozen
 * track failed — audio at the admission, video before the strategy — and the keyed
 * video strategy refused the same projection again. Neither message named freeze.
 */

const NOW = '2026-09-05T12:00:00.000Z';
const CONTENT_SHA256 = 'a'.repeat(64);
const DERIVED_SHA256 = 'b'.repeat(64);

test('a fresh freeze delivers its render to export instead of reading as a lost fallback', () => {
	const { project, playback } = frozenFixture();
	assert.equal(playback.getFreezeStatus(project, 'voice'), 'fresh');

	const audio = projectForAudioRenderedFallbackExport(project, playback);
	assert.equal(audio.audioRenderedFallback, null);
	assert.deepEqual(audio.requiredAudioSourceIds, ['voice-freeze']);

	const video = projectForVideoRenderedFallbackExport(project, playback);
	assert.equal(video.audioRenderedFallback, null);
	assert.equal(video.videoRenderedFallback, null);
	assert.deepEqual(video.requiredAudioSourceIds, ['voice-freeze']);
	assert.deepEqual(video.requiredVideoSourceIds, []);
});

test('the Soundscaper keyed video strategy exports the frozen render playback renders', () => {
	const { project, playback } = frozenFixture();
	const strategy = createSoundscaperVideoExportStrategy(
		createSoundscaperProjectRuntimeSelection(),
		{
			encodeOffline: async () => { throw new Error('The projection must not encode.'); },
			encodeOfflineToSink: async () => { throw new Error('The projection must not encode.'); },
		},
	);

	const exportProject = strategy.createExportProject({
		canonicalProject: project,
		delivery: projectForVideoRenderedFallbackExport(project, playback),
	});

	const tracks = exportProject.tracks as readonly Readonly<Record<string, unknown>>[];
	const track = tracks.find(({ id }) => id === 'voice');
	assert.ok(track, 'the frozen track must survive the export projection');
	assert.equal(Object.hasOwn(track, 'audioFreeze'), false);
	const clipIds = track.clipIds as readonly string[];
	assert.equal(clipIds.length, 1);
	const clips = exportProject.clips as readonly Readonly<Record<string, unknown>>[];
	const clip = clips.find(({ id }) => id === clipIds[0]);
	assert.equal(clip?.sourceId, 'voice-freeze', 'the export must render the frozen substitution');
});

function frozenFixture() {
	const source = createAudioSource({
		id: 'voice-source', storageKey: 'pcm:voice', contentSha256: CONTENT_SHA256,
		frameCount: 8, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClip({
		id: 'voice-clip', sourceId: 'voice-source', title: 'Voice', timelineStartFrame: 0,
		durationFrames: 8, sourceStartFrame: 0, sourceDurationFrames: 8,
	});
	const derivedSource = createAudioSource({
		id: 'voice-freeze', storageKey: 'derived:voice-freeze', contentSha256: DERIVED_SHA256,
		frameCount: 8, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const freeze: AudioTrackFreezeV1 = {
		schemaVersion: 1,
		derivedSourceId: 'voice-freeze',
		...computeAudioTrackFreezeDigestsV1({
			sampleRate: 48_000, renderStartFrame: 0, renderFrameCount: 8,
			track: createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'], effects: [] }),
			clips: [clip],
			sourceContentIdentities: [{ sourceId: 'voice-source', contentSha256: CONTENT_SHA256 }],
			automationLanes: [], tempoMap: null,
		}),
		renderStartFrame: 0,
		renderFrameCount: 8,
		capturePosition: 'post-insert-pre-strip',
	};
	const project = createSoundscaperProject({
		id: 'frozen-track-export', title: 'Frozen track export', now: NOW,
		sources: [source, derivedSource], clips: [clip],
		tracks: [createAudioTrack({
			id: 'voice', name: 'Voice', clipIds: ['voice-clip'], effects: [], audioFreeze: freeze,
		})],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
	});
	const playback = createSoundscaperAudioTrackFreezePlaybackService(
		createSoundscaperPlaybackProjectService(),
		{
			getSourceMetadata: () => null,
			readSourceChunks: () => { throw new Error('The projection must not read PCM.'); },
			openSourceReadSession: () => null,
		} as never,
	);
	playback.admitVerifiedFreeze({
		project, trackId: 'voice', freeze, derivedSource,
		sourceContentIdentities: [{ sourceId: 'voice-source', contentSha256: CONTENT_SHA256 }],
	});
	return { project, derivedSource, playback };
}
