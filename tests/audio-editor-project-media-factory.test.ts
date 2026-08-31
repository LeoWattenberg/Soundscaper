/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_SOURCE_CHUNK_FRAMES,
	audioTrackChannelCount,
	createAudioClip,
	createAudioMixerBus,
	createAudioSource,
	createAudioTrack,
	createLabel,
} from '../src/common/editor/project-audio-factory.js';
import {
	AUDIO_EDITOR_MEDIA_KINDS,
	AUDIO_EDITOR_TRACK_TYPES,
	createAudioClip as createCurrentAudioClip,
	createAudioSource as createCurrentAudioSource,
	createLabel as createCurrentLabel,
	createLabelTrack as createCurrentLabelTrack,
	createProjectBin,
	createVideoClip,
	createVideoSource,
} from '../src/common/editor/project-media-factory.ts';

test('schema-neutral audio leaves retain the established audio and mixer contract', () => {
	const source = createAudioSource({
		id: 'source',
		storageKey: 'source-key',
		frameCount: 96_000,
		channelCount: 2,
	});
	const clip = createAudioClip({
		id: 'clip',
		sourceId: source.id,
		durationFrames: 48_000,
	});
	const track = createAudioTrack({ id: 'track', clipIds: [clip.id] });

	assert.equal(source.chunkFrames, AUDIO_EDITOR_SOURCE_CHUNK_FRAMES);
	assert.equal(audioTrackChannelCount({ sources: [source], clips: [clip] }, track), 2);
	assert.deepEqual(createAudioMixerBus({ id: 'bus', effects: [] }), {
		id: 'bus',
		name: 'Group 1',
		color: '#4f87c8',
		gain: 1,
		pan: 0,
		mute: false,
		solo: false,
		envelope: [],
		collapsed: true,
		effectsActive: true,
		effects: [],
	});
	assert.deepEqual(createLabel({ id: 'label', startFrame: 4, endFrame: 8 }), {
		id: 'label',
		title: '',
		startFrame: 4,
		endFrame: 8,
		color: 'auto',
		opaqueExtensions: {},
	});
});

test('current media leaves accumulate extension, musical, and rational video authority', () => {
	assert.deepEqual(AUDIO_EDITOR_MEDIA_KINDS, ['audio', 'video']);
	assert.deepEqual(AUDIO_EDITOR_TRACK_TYPES, ['audio', 'video', 'label']);
	const audioSource = createCurrentAudioSource({
		id: 'audio-source',
		storageKey: 'audio-key',
		frameCount: 96_000,
		channelCount: 1,
		contentSha256: 'a'.repeat(64),
	});
	assert.equal(audioSource.kind, 'audio');
	assert.equal(audioSource.contentSha256, 'a'.repeat(64));
	const tempoMap = {
		mode: 'musical' as const,
		events: [{
			id: 'tempo',
			beat: { num: 0, den: 1 },
			bpm: { num: 120, den: 1 },
		}],
	};
	const musicalClip = createCurrentAudioClip({
		id: 'audio-clip',
		sourceId: audioSource.id,
		anchor: 'musical',
		musicalStartBeat: { num: 1, den: 1 },
		musicalExtent: 'beat',
		musicalDurationBeats: { num: 2, den: 1 },
	}, { projectSampleRate: 48_000, tempoMap });
	assert.equal(Object.hasOwn(musicalClip, 'timelineStartFrame'), false);
	assert.equal(Object.hasOwn(musicalClip, 'durationFrames'), false);
	assert.equal(musicalClip.sourceDurationFrames, 48_000);

	const videoSource = createVideoSource({
		id: 'video-source',
		storageKey: 'video-key',
		frameCount: 48_000,
		sampleRate: 48_000,
		width: 1_920,
		height: 1_080,
		frameRate: { num: 24, den: 1 },
		sourceFrameCount: 24,
		timingDecision: {
			mode: 'conform-cfr-at-ingest',
			rate: { num: 24, den: 1 },
		},
	});
	assert.equal(Object.hasOwn(videoSource, 'frameCount'), false);
	assert.equal(videoSource.sampleFrameCount, 48_000);
	assert.deepEqual(videoSource.frameRate, { num: 24, den: 1 });
	const context = {
		projectSampleRate: 48_000,
		tempoMap,
		sequence: { id: 'main', rate: { num: 24, den: 1 } },
		source: videoSource,
	};
	const videoClip = createVideoClip({
		kind: 'video',
		id: 'video-clip',
		sourceId: 'video-source',
		sequenceStartFrame: 1,
		sequenceFrameCount: 2,
		sourceInFrame: 3,
		sourceFrameCount: 2,
	}, context);
	assert.equal(Object.hasOwn(videoClip, 'timelineStartFrame'), false);
	assert.deepEqual(
		[videoClip.sequenceId, videoClip.sequenceStartFrame, videoClip.sequenceFrameCount],
		['main', 1, 2],
	);
	const bin = createProjectBin({ clips: [{ ...videoClip, binItemId: 'bin-item' }] }, () => context);
	assert.equal(bin.clips[0]?.binItemId, 'bin-item');
	assert.deepEqual(createCurrentLabel({
		id: 'marker',
		anchor: 'musical',
		startBeat: { num: 3, den: 2 },
	}), {
		id: 'marker',
		title: '',
		color: 'auto',
		opaqueExtensions: {},
		anchor: 'musical',
		startBeat: { num: 3, den: 2 },
		endBeat: { num: 3, den: 2 },
	});
	assert.deepEqual(createCurrentLabelTrack({
		id: 'label-track',
		labels: [{ id: 'sample-label', startFrame: 4, endFrame: 8 }],
	}).labels, [{
		id: 'sample-label',
		title: '',
		startFrame: 4,
		endFrame: 8,
		color: 'auto',
		opaqueExtensions: {},
		anchor: 'sample',
		startBeat: null,
		endBeat: null,
	}]);
});

test('context-free video clip fixtures retain real sample-coordinate authority', () => {
	const clip = createVideoClip({
		kind: 'video',
		id: 'fixture-video-clip',
		sourceId: 'fixture-video-source',
		timelineStartFrame: 12_000,
		durationFrames: 48_000,
		sourceStartFrame: 24_000,
		sourceDurationFrames: 48_000,
	});

	assert.deepEqual({
		kind: clip.kind,
		id: clip.id,
		timelineStartFrame: clip.timelineStartFrame,
		durationFrames: clip.durationFrames,
		sourceStartFrame: clip.sourceStartFrame,
		sourceDurationFrames: clip.sourceDurationFrames,
	}, {
		kind: 'video',
		id: 'fixture-video-clip',
		timelineStartFrame: 12_000,
		durationFrames: 48_000,
		sourceStartFrame: 24_000,
		sourceDurationFrames: 48_000,
	});
	assert.equal(Object.hasOwn(clip, 'sequenceStartFrame'), false);
});
