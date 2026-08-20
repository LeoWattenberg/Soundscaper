/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';
import {
	cloneAudioEditorProjectV17,
	createAudioEditorProjectV17,
	validateAudioEditorProjectV17,
} from '../src/common/editor/project-v17.ts';
import { resolveRuntimeClipProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { sampleFrameToBeat } from '../src/common/editor/timeline-tempo-inverse.ts';

const NOW = '2026-08-09T12:00:00.000Z';
const MUSICAL_TEMPO_MAP = {
	mode: 'musical' as const,
	events: [{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
};

test('the exact-current foundation closes sequence, tempo, signature, and sample-rate contracts', () => {
	const project = createAudioEditorProjectV17({ id: 'foundation', now: NOW });
	assert.equal(project.schemaVersion, AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION);
	assert.equal(project.schemaVersion, 17);
	assert.equal(project.sampleRate, 48_000);
	assert.equal(project.primarySequenceId, 'main-sequence');
	assert.deepEqual(project.sequences[0], {
		id: 'main-sequence',
		name: 'Main sequence',
		rate: { num: 30, den: 1 },
		dropFrame: false,
		startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
		trackIds: [],
		trackNodes: [],
	});
	assert.deepEqual(project.tempoMap, MUSICAL_TEMPO_MAP);
	assert.deepEqual(project.signatureMap, {
		events: [{ id: 'signature-1', bar: 0, numerator: 4, denominator: 4 }],
	});
	assert.equal(validateAudioEditorProjectV17(project), true);
	assert.throws(() => createAudioEditorProjectV17({
		now: NOW,
		tempoMap: {
			mode: 'musical',
			events: [{ id: 'tempo-1', beat: 0, bpm: { num: 1, den: 2 } }],
		},
	}), /root tempo event.*1 BPM/iu);
	assert.throws(() => createAudioEditorProjectV17({ now: NOW, sampleRate: 7_999 }), /sampleRate/iu);
	assert.throws(() => createAudioEditorProjectV17({
		now: NOW,
		sequences: [{ id: 'main', rate: { num: 24, den: 1 }, dropFrame: true }],
		primarySequenceId: 'main',
	}), /drop.frame/iu);
});

test('legacy tempo remains an exact projection of authoritative musical maps', () => {
	const project = createAudioEditorProjectV17({
		now: NOW,
		tempo: { bpm: 111, timeSignature: { numerator: 3, denominator: 4 }, detected: true },
		tempoMap: {
			mode: 'musical',
			events: [{ id: 'tempo-main', beat: 0, bpm: { num: 275, den: 2 } }],
		},
		signatureMap: {
			events: [{ id: 'signature-main', bar: 0, numerator: 7, denominator: 8 }],
		},
	});
	assert.deepEqual(project.tempo, {
		bpm: 137.5,
		timeSignature: { numerator: 7, denominator: 8 },
		detected: true,
	});
	const tempo = project.tempo as Readonly<{
		bpm: number;
		timeSignature: Readonly<{ numerator: number; denominator: number }>;
	}>;
	assert.throws(() => validateAudioEditorProjectV17({
		...project,
		tempo: { ...tempo, bpm: 111 },
	}), /legacy tempo.*authoritative tempo map/iu);
	assert.throws(() => validateAudioEditorProjectV17({
		...project,
		tempo: { ...tempo, timeSignature: { numerator: 3, denominator: 4 } },
	}), /legacy signature.*authoritative signature map/iu);
});

test('foundation tempo maps reject ramps and unsafe inverse rationals', () => {
	assert.throws(() => createAudioEditorProjectV17({
		now: NOW,
		tempoMap: {
			mode: 'musical',
			interpolation: 'ramp',
			events: [{ id: 'tempo-1', beat: 0, bpm: 120 }],
		},
	} as never), /tempoMap.*unsupported field.*interpolation/iu);
	const tempoMap = {
		mode: 'musical' as const,
		events: [
			{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
			{
				id: 'tempo-2',
				beat: { num: 1, den: 999_983 },
				bpm: { num: 120_000_001, den: 1_000_000 },
			},
		],
	};
	assert.throws(() => sampleFrameToBeat(1, tempoMap, 48_000), /safe integer domain/iu);
	assert.throws(
		() => createAudioEditorProjectV17({ now: NOW, tempoMap }),
		/inverse|reconcil|safe rational/iu,
	);
});

test('neutral video leaves retain exact source and sequence authority in current projects', () => {
	const source = createVideoSource({
		id: 'video-source',
		frameCount: 44_100,
		sampleRate: 44_100,
		width: 1_920,
		height: 1_080,
		frameRate: { num: 24, den: 1 },
		sourceFrameCount: 24,
		videoCodec: 'h264',
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 24, den: 1 } },
	});
	const sequence = { id: 'main', rate: { num: 24, den: 1 } };
	const clip = createVideoClip({
		kind: 'video',
		id: 'video-clip',
		sourceId: source.id,
		sequenceId: sequence.id,
		sequenceStartFrame: 1,
		sequenceFrameCount: 1,
		sourceInFrame: 0,
		sourceFrameCount: 1,
	}, { projectSampleRate: 44_100, sequence, source });
	const track = createVideoTrack({ id: 'video-track', clipIds: [clip.id] });
	const project = createAudioEditorProjectV17({
		now: NOW,
		sampleRate: 44_100,
		primarySequenceId: sequence.id,
		sequences: [sequence],
		sources: [source],
		clips: [clip],
		tracks: [track],
	});

	assert.equal(source.sampleFrameCount, 44_100);
	assert.deepEqual(source.frameRate, { num: 24, den: 1 });
	assert.equal(Object.hasOwn(source, 'frameCount'), false);
	assert.equal(Object.hasOwn(clip, 'timelineStartFrame'), false);
	assert.equal(clip.sequenceStartFrame, 1);
	assert.equal(clip.sourceInFrame, 0);
	const resolved = resolveRuntimeClipProjection(project, project.clips[0]!);
	assert.deepEqual([resolved.timelineStartFrame, resolved.durationFrames], [1_838, 1_837]);
	assert.equal(validateAudioEditorProjectV17(project), true);
});

test('exact video timing decisions require their immutable timing sidecar', () => {
	const sourceOptions = {
		id: 'video-source',
		frameCount: 48_000,
		sampleRate: 48_000,
		width: 16,
		height: 16,
		frameRate: { num: 24, den: 1 },
		sourceFrameCount: 24,
		timingDecision: { mode: 'exact', rate: { num: 24, den: 1 } },
	};
	assert.throws(() => createVideoSource(sourceOptions), /exact.*timing asset|timing asset.*exact/iu);
	const source = createVideoSource({
		...sourceOptions,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 24, den: 1 } },
	});
	const project = createAudioEditorProjectV17({ now: NOW, sources: [source] });
	assert.throws(() => validateAudioEditorProjectV17({
		...project,
		sources: project.sources.map((value) => value.id === source.id
			? { ...value, timingDecision: sourceOptions.timingDecision }
			: value),
	}), /exact.*timing asset|timing asset.*exact/iu);
});

test('musical audio authority and breakpoint maps survive current clone and command normalization', () => {
	const source = createAudioSource({ id: 'source', frameCount: 96_000, channelCount: 1 });
	const warpMap = {
		feature: 'audio-warp' as const,
		points: [
			{ outer: 0, source: 0, mode: 'forward' as const },
			{ outer: 2, source: 48_000, mode: 'forward' as const },
		],
	};
	const clip = createAudioClip({
		id: 'clip',
		sourceId: source.id,
		sourceDurationFrames: 48_000,
		anchor: 'musical',
		musicalStartBeat: 3,
		musicalExtent: 'beat',
		musicalDurationBeats: 2,
		warpMap,
	}, { projectSampleRate: 48_000, tempoMap: MUSICAL_TEMPO_MAP });
	const track = createAudioTrack({ id: 'track', clipIds: [clip.id] });
	const project = createAudioEditorProjectV17({
		now: NOW,
		sources: [source],
		clips: [clip],
		tracks: [track],
	});
	const resolved = resolveRuntimeClipProjection(project, project.clips[0]!);
	assert.deepEqual([resolved.timelineStartFrame, resolved.timelineEndFrame], [72_000, 120_000]);

	const cloned = cloneAudioEditorProjectV17(project);
	assert.deepEqual(cloned.clips[0]?.warpMap, warpMap);
	assert.notStrictEqual(cloned.clips[0]?.warpMap, project.clips[0]?.warpMap);
	const updated = applyEditorCommand(project, {
		type: 'clip/update',
		clipId: 'clip',
		changes: { title: 'Renamed' },
	}, { now: NOW });
	assert.deepEqual(updated.clips[0]?.musicalStartBeat, { num: 3, den: 1 });
	assert.deepEqual(updated.clips[0]?.warpMap, warpMap);
	assert.equal(validateAudioEditorProjectV17(updated), true);
});

test('the current foundation binds clips to same-kind sources', () => {
	const audioSource = createAudioSource({ id: 'audio-source', frameCount: 48_000, channelCount: 1 });
	const videoSource = createVideoSource({
		id: 'video-source',
		frameCount: 48_000,
		sampleRate: 48_000,
		width: 16,
		height: 16,
		frameRate: { num: 24, den: 1 },
		sourceFrameCount: 24,
	});
	const clip = createAudioClip({
		id: 'audio-clip',
		sourceId: audioSource.id,
		durationFrames: 100,
		sourceDurationFrames: 100,
	});
	const track = createAudioTrack({ id: 'audio-track', clipIds: [clip.id] });
	const project = createAudioEditorProjectV17({
		now: NOW,
		sources: [audioSource, videoSource],
		clips: [clip],
		tracks: [track],
	});
	assert.throws(() => validateAudioEditorProjectV17({
		...project,
		clips: project.clips.map((value) => value.id === clip.id
			? { ...value, sourceId: videoSource.id }
			: value),
	}), /source kind|different source kind/iu);
});
