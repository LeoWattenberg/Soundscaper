/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyEditorCommand,
	createUpdateSequenceTimingCommand,
} from '../src/common/editor/commands.js';
import {
	createCurrentAudioEditorProject,
	loadCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { sequenceFrameBoundarySample } from '../src/common/editor/sequence-frame-navigation.ts';
import { resolveSequenceTimingView } from '../src/common/editor/sequence-timing-model.ts';

const NOW = '2026-08-10T12:00:00.000Z';
const SAMPLE_RATE = 48_000;
const RATE_30 = { num: 30, den: 1 };
const RATE_25 = { num: 25, den: 1 };
const NTSC = { num: 30_000, den: 1_001 };

test('a sequence keeps its name, rate, drop frame, and start timecode through one command', () => {
	const edited = applyEditorCommand(project(), createUpdateSequenceTimingCommand('main', {
		name: 'Programme',
		rate: NTSC,
		dropFrame: true,
		startTimecode: { negative: false, hours: 1, minutes: 0, seconds: 0, frames: 0 },
	}), { now: NOW });
	const sequence = edited.sequences[0] as Record<string, unknown>;

	assert.equal(sequence.name, 'Programme');
	assert.deepEqual(sequence.rate, NTSC);
	assert.equal(sequence.dropFrame, true);
	assert.deepEqual(sequence.startTimecode, {
		negative: false, hours: 1, minutes: 0, seconds: 0, frames: 0,
	});
	assert.equal(validateCurrentAudioEditorProject(edited), true);
	assert.equal(loadCurrentAudioEditorProject(JSON.parse(JSON.stringify(edited))).readOnly, false);
});

test('a rate change conforms video placement from resolved boundaries, not frame indices', () => {
	const before = project();
	const beforeResolved = resolveRuntimeProjectProjection(before).clips
		.map((clip) => [clip.id, clip.timelineStartFrame, clip.timelineEndFrame]);
	const edited = applyEditorCommand(before, createUpdateSequenceTimingCommand('main', { rate: RATE_25 }), { now: NOW });
	const video = edited.clips.find((clip) => clip.id === 'video') as Record<string, unknown>;
	const resolved = resolveRuntimeProjectProjection(edited).clips
		.map((clip) => [clip.id, clip.timelineStartFrame, clip.timelineEndFrame]);

	assert.deepEqual(beforeResolved, [['video', 6_400, 16_000], ['audio', 6_400, 16_000]]);
	assert.deepEqual([video.sequenceStartFrame, video.sequenceFrameCount], [3, 5]);
	assert.deepEqual(resolved, [['video', 5_760, 15_360], ['audio', 5_760, 15_360]]);
	assert.deepEqual([video.sourceInFrame, video.sourceFrameCount], [4, 6]);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

test('every conformed placement lands on a boundary of the new grid', () => {
	const edited = applyEditorCommand(project(), createUpdateSequenceTimingCommand('main', { rate: NTSC }), { now: NOW });
	const view = resolveSequenceTimingView(edited);
	for (const clip of resolveRuntimeProjectProjection(edited).clips) {
		if (clip.sequenceStartFrame === null) continue;
		assert.equal(
			clip.timelineStartFrame,
			sequenceFrameBoundarySample(clip.sequenceStartFrame, view.rate, SAMPLE_RATE),
		);
		assert.equal(
			clip.timelineEndFrame,
			sequenceFrameBoundarySample(clip.sequenceEndFrame ?? 0, view.rate, SAMPLE_RATE),
		);
	}
});

test('linked audio follows the conformed video endpoints rather than its own rounding', () => {
	const edited = applyEditorCommand(project(), createUpdateSequenceTimingCommand('main', { rate: NTSC }), { now: NOW });
	const resolved = resolveRuntimeProjectProjection(edited).clips;
	const video = resolved.find((clip) => clip.kind === 'video');
	const audio = resolved.find((clip) => clip.kind === 'audio');

	assert.ok(video && audio);
	assert.equal(audio.timelineStartFrame, video.timelineStartFrame);
	assert.equal(audio.timelineEndFrame, video.timelineEndFrame);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

test('a Project Bin pair keeps aligned resolved durations across a rate change', () => {
	const edited = applyEditorCommand(project(), createUpdateSequenceTimingCommand('main', { rate: RATE_25 }), { now: NOW });
	const bin = resolveRuntimeProjectProjection(edited).projectBin.clips;
	const video = bin.find((clip) => clip.kind === 'video');
	const audio = bin.find((clip) => clip.kind === 'audio');

	assert.ok(video && audio);
	assert.equal(video.durationFrames, audio.durationFrames);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

test('a clip outside the edited sequence keeps its own grid', () => {
	const before = twoSequenceProject();
	const edited = applyEditorCommand(before, createUpdateSequenceTimingCommand('other', { rate: RATE_25 }), { now: NOW });
	const video = edited.clips.find((clip) => clip.id === 'video') as Record<string, unknown>;

	assert.deepEqual([video.sequenceStartFrame, video.sequenceFrameCount], [3, 2]);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

test('a start timecode survives a rate change and conforms only when its label disappears', () => {
	const withTimecode = applyEditorCommand(project(), createUpdateSequenceTimingCommand('main', {
		startTimecode: { negative: false, hours: 0, minutes: 1, seconds: 0, frames: 29 },
	}), { now: NOW });
	const slower = applyEditorCommand(withTimecode, createUpdateSequenceTimingCommand('main', {
		rate: RATE_25,
	}), { now: NOW });
	const dropped = applyEditorCommand(withTimecode, createUpdateSequenceTimingCommand('main', {
		rate: NTSC, dropFrame: true,
	}), { now: NOW });
	const skipped = applyEditorCommand(withTimecode, createUpdateSequenceTimingCommand('main', {
		startTimecode: { negative: false, hours: 0, minutes: 1, seconds: 0, frames: 0 },
	}), { now: NOW });

	assert.deepEqual(slower.sequences[0].startTimecode, {
		negative: false, hours: 0, minutes: 1, seconds: 0, frames: 24,
	});
	assert.deepEqual(dropped.sequences[0].startTimecode, {
		negative: false, hours: 0, minutes: 1, seconds: 0, frames: 29,
	});
	assert.deepEqual(skipped.sequences[0].startTimecode, {
		negative: false, hours: 0, minutes: 1, seconds: 0, frames: 0,
	});
	assert.equal(validateCurrentAudioEditorProject(slower), true);
});

test('the command rejects illegal rates, drop-frame pairings, and requested labels', () => {
	const base = project();
	assert.throws(
		() => applyEditorCommand(base, createUpdateSequenceTimingCommand('main', { dropFrame: true }), { now: NOW }),
		/only legal at 30000\/1001/,
	);
	assert.throws(
		() => applyEditorCommand(base, createUpdateSequenceTimingCommand('main', {
			rate: NTSC, dropFrame: true,
			startTimecode: { negative: false, hours: 0, minutes: 1, seconds: 0, frames: 0 },
		}), { now: NOW }),
		/label the sequence rate produces/,
	);
	assert.throws(
		() => applyEditorCommand(base, createUpdateSequenceTimingCommand('main', {
			rate: { num: SAMPLE_RATE + 1, den: 1 },
		}), { now: NOW }),
		/sample-rate bound/,
	);
	assert.throws(
		() => applyEditorCommand(base, createUpdateSequenceTimingCommand('missing', { name: 'x' }), { now: NOW }),
		/Sequence missing is missing/,
	);
});

test('a rate change cannot silently share one batch with a clip edit it conformed', () => {
	assert.throws(() => applyEditorCommand(project(), {
		type: 'batch',
		commands: [
			createUpdateSequenceTimingCommand('main', { rate: RATE_25 }),
			{ type: 'clip/move', clipId: 'video', trackId: 'video-track', timelineStartFrame: 19_200 },
		],
	}, { now: NOW }), /inconsistent conformed sequence placement/);
});

test('a requested rate is stored in canonical reduced form', () => {
	const edited = applyEditorCommand(project(), createUpdateSequenceTimingCommand('main', {
		rate: { num: 60_000, den: 2_002 },
	}), { now: NOW });

	assert.deepEqual(edited.sequences[0].rate, NTSC);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

test('repeating a rate change is idempotent and a commensurable round trip restores the grid', () => {
	const before = project();
	const once = applyEditorCommand(before, createUpdateSequenceTimingCommand('main', { rate: RATE_25 }), { now: NOW });
	const twice = applyEditorCommand(once, createUpdateSequenceTimingCommand('main', { rate: RATE_25 }), { now: NOW });
	const restored = applyEditorCommand(twice, createUpdateSequenceTimingCommand('main', { rate: RATE_30 }), { now: NOW });

	assert.deepEqual(twice.clips, once.clips);
	assert.deepEqual(
		restored.clips.map((clip) => [clip.id, clip.sequenceStartFrame, clip.sequenceFrameCount]),
		before.clips.map((clip) => [clip.id, clip.sequenceStartFrame, clip.sequenceFrameCount]),
	);
	assert.equal(validateCurrentAudioEditorProject(restored), true);
});

function project(): ReturnType<typeof createCurrentAudioEditorProject> {
	const video = createVideoSource({
		id: 'video-source', frameCount: SAMPLE_RATE, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: RATE_30, sourceFrameCount: 30,
	}, SAMPLE_RATE);
	const audio = createAudioSource({
		id: 'audio-source', frameCount: SAMPLE_RATE, sampleRate: SAMPLE_RATE, channelCount: 1,
	});
	const context = { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate: RATE_30 }, source: video };
	return createCurrentAudioEditorProject({
		id: 'sequence-timing', now: NOW, sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate: RATE_30 }], primarySequenceId: 'main',
		sources: [video, audio],
		clips: [
			createVideoClip({
				id: 'video', sourceId: video.id, sequenceId: 'main',
				sequenceStartFrame: 4, sequenceFrameCount: 6,
				sourceInFrame: 4, sourceFrameCount: 6, avLinkId: 'link',
			}, context),
			createAudioClip({
				id: 'audio', sourceId: audio.id, timelineStartFrame: 6_400,
				durationFrames: 9_600, sourceDurationFrames: 9_600, avLinkId: 'link',
			}),
		],
		projectBin: {
			clips: [
				createVideoClip({
					id: 'bin-video', binItemId: 'bin-item', sourceId: video.id, sequenceId: 'main',
					sequenceStartFrame: 0, sequenceFrameCount: 5,
					sourceInFrame: 0, sourceFrameCount: 5,
				}, context),
				createAudioClip({
					id: 'bin-audio', binItemId: 'bin-item', sourceId: audio.id,
					timelineStartFrame: 0, durationFrames: 8_000, sourceDurationFrames: 8_000,
				}),
			],
		},
		tracks: [
			createVideoTrack({ id: 'video-track', laneGroupId: 'lanes', clipIds: ['video'] }),
			createAudioTrack({ id: 'audio-track', laneGroupId: 'lanes', clipIds: ['audio'] }, SAMPLE_RATE),
		],
	});
}

function twoSequenceProject(): ReturnType<typeof createCurrentAudioEditorProject> {
	const video = createVideoSource({
		id: 'video-source', frameCount: SAMPLE_RATE, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: RATE_30, sourceFrameCount: 30,
	}, SAMPLE_RATE);
	return createCurrentAudioEditorProject({
		id: 'two-sequence-timing', now: NOW, sampleRate: SAMPLE_RATE,
		sequences: [
			{ id: 'main', rate: RATE_30, trackIds: ['video-track'] },
			{ id: 'other', rate: RATE_30, trackIds: ['other-track'] },
		],
		primarySequenceId: 'main',
		sources: [video],
		clips: [createVideoClip({
			id: 'video', sourceId: video.id, sequenceId: 'main',
			sequenceStartFrame: 3, sequenceFrameCount: 2,
			sourceInFrame: 3, sourceFrameCount: 2,
		}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate: RATE_30 }, source: video })],
		tracks: [
			createVideoTrack({ id: 'video-track', clipIds: ['video'] }),
			createVideoTrack({ id: 'other-track', clipIds: [] }),
		],
	});
}
