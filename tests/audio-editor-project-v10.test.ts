/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	createAudioClipV10,
	createAudioEditorProjectV10,
	createAudioSourceV10,
	createAudioTrackV10,
	createVideoClipV10,
	createVideoSourceV10,
	createVideoTrackV10,
	loadAudioEditorProjectV10,
	validateAudioEditorProjectV10,
} from '../src/common/editor/project-v10.ts';
import { resolveRuntimeClipProjection } from '../src/common/editor/runtime-clip-projection.ts';

const NOW = '2026-08-09T12:00:00.000Z';

test('foundation projects close sequence, tempo, signature, and sample-rate wire contracts', () => {
	const project = createAudioEditorProjectV10({ id: 'foundation', now: NOW });
	assert.equal(project.schemaVersion, 10);
	assert.equal(project.sampleRate, 48_000);
	assert.equal(project.primarySequenceId, 'main-sequence');
	assert.deepEqual(project.sequences, [{
		id: 'main-sequence', name: 'Main sequence', rate: { num: 30, den: 1 },
		dropFrame: false,
		startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
		trackIds: [],
	}]);
	assert.deepEqual(project.tempoMap, {
		mode: 'musical',
		events: [{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
	});
	assert.deepEqual(project.signatureMap, {
		events: [{ id: 'signature-1', bar: 0, numerator: 4, denominator: 4 }],
	});
	assert.equal(validateAudioEditorProjectV10(project), true);
	assert.throws(() => createAudioEditorProjectV10({ now: NOW, sampleRate: 7_999 }), /sampleRate/iu);
	assert.throws(() => validateAudioEditorProjectV10(createAudioEditorProjectV10({
		now: NOW,
		sequences: [{ id: 'main', rate: { num: 24, den: 1 }, dropFrame: true }],
		primarySequenceId: 'main',
	})), /drop.frame/iu);
});

test('video source and clip factories retain exact source and sequence authority', () => {
	const source = createVideoSourceV10({
		id: 'video-source', frameCount: 44_100, sampleRate: 44_100,
		width: 1_920, height: 1_080, frameRate: 24,
		sourceFrameRate: { num: 24, den: 1 }, sourceFrameCount: 24,
		videoCodec: 'h264', timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 24, den: 1 } },
	});
	const clip = createVideoClipV10({
		id: 'video-clip', sourceId: source.id, sequenceId: 'main',
		sequenceStartFrame: 1, sequenceFrameCount: 1,
		sourceInFrame: 0, sourceFrameCount: 1,
	}, {
		projectSampleRate: 44_100,
		sequence: { id: 'main', rate: { num: 24, den: 1 } },
		source,
	});
	assert.equal(source.sampleFrameCount, 44_100);
	assert.deepEqual(source.frameRate, { num: 24, den: 1 });
	assert.equal(Object.hasOwn(source, 'frameCount'), false);
	assert.equal(Object.hasOwn(clip, 'timelineStartFrame'), false);
	assert.equal(clip.sequenceStartFrame, 1);
	assert.equal(clip.sequenceFrameCount, 1);
	assert.equal(clip.sourceInFrame, 0);
	const resolved = resolveRuntimeClipProjection({
		schemaVersion: 10, sampleRate: 44_100, primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: { num: 24, den: 1 } }],
	}, clip);
	assert.deepEqual([resolved.timelineStartFrame, resolved.durationFrames], [1_838, 1_837]);
});

test('musical audio authority and foundation breakpoint maps survive load and edit normalization', () => {
	const source = createAudioSourceV10({ id: 'source', frameCount: 96_000, channelCount: 1 });
	const clip = createAudioClipV10({
		id: 'clip', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000,
		anchor: 'musical', musicalStartBeat: { num: 3, den: 1 }, musicalExtent: 'beat',
		musicalDurationBeats: { num: 2, den: 1 },
		warpMap: {
			feature: 'audio-warp',
			points: [
				{ outer: 0, source: 0, mode: 'forward' },
				{ outer: 2, source: 48_000, mode: 'forward' },
			],
		},
	});
	const track = createAudioTrackV10({ id: 'track', clipIds: [clip.id] });
	const project = createAudioEditorProjectV10({ now: NOW, sources: [source], clips: [clip], tracks: [track] });
	const resolved = resolveRuntimeClipProjection(project, project.clips[0]);
	assert.deepEqual([resolved.timelineStartFrame, resolved.timelineEndFrame], [72_000, 120_000]);
	const serialized = JSON.stringify(project);
	const loaded = loadAudioEditorProjectV10(JSON.parse(serialized));
	assert.equal(loaded.readOnly, false);
	assert.equal(JSON.stringify(loaded.project), serialized, 'load/save without edits is byte-identical');
	const updated = applyEditorCommand(project, { type: 'clip/update', clipId: 'clip', changes: { title: 'Renamed' } }, { now: NOW });
	const reloadResult = loadAudioEditorProjectV10(JSON.parse(JSON.stringify(updated)));
	assert.equal(reloadResult.readOnly, false);
	const reloaded = reloadResult.project as typeof project;
	assert.deepEqual(reloaded.clips[0].musicalStartBeat, { num: 3, den: 1 });
	assert.deepEqual(reloaded.clips[0].warpMap, clip.warpMap);
});

test('derived A/V equality and frame-grid caches are validator invariants', () => {
	const videoSource = createVideoSourceV10({
		id: 'video-source', frameCount: 44_100, sampleRate: 44_100, width: 16, height: 16,
		frameRate: 24, sourceFrameRate: { num: 24, den: 1 }, sourceFrameCount: 24,
	});
	const audioSource = createAudioSourceV10({ id: 'audio-source', frameCount: 44_100, sampleRate: 44_100, channelCount: 1 });
	const video = createVideoClipV10({
		id: 'video', sourceId: videoSource.id, sequenceId: 'main', sequenceStartFrame: 1,
		sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1, avLinkId: 'link',
	}, { projectSampleRate: 44_100, sequence: { id: 'main', rate: { num: 24, den: 1 } }, source: videoSource });
	const audio = createAudioClipV10({
		id: 'audio', sourceId: audioSource.id, timelineStartFrame: 1_838,
		durationFrames: 1_837, sourceDurationFrames: 1_837, avLinkId: 'link',
	});
	const project = createAudioEditorProjectV10({
		now: NOW, sampleRate: 44_100,
		sequences: [{ id: 'main', rate: { num: 24, den: 1 } }], primarySequenceId: 'main',
		sources: [videoSource, audioSource], clips: [video, audio],
		tracks: [
			createVideoTrackV10({ id: 'video-track', laneGroupId: 'lane', clipIds: ['video'] }),
			createAudioTrackV10({ id: 'audio-track', laneGroupId: 'lane', clipIds: ['audio'] }),
		],
	});
	assert.equal(validateAudioEditorProjectV10(project), true);
	assert.throws(() => validateAudioEditorProjectV10({
		...project,
		clips: project.clips.map((candidate) => candidate.id === 'video'
			? { ...candidate, timelineStartFrame: 1_839 }
			: candidate),
	}), /derived|cache/iu);
});
