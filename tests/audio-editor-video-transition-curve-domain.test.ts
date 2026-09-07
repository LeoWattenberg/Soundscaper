/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { compileInterpolationCurve } from '../src/common/editor/interpolation-curve.ts';
import {
	resolveActiveVideoLayers,
	resolveVideoCompositionIntervals,
} from '../src/common/editor/video-timeline.js';

/**
 * An authored transition curve is written over the sequence-frame overlap it was
 * authored for, while the composition resolvers read a projected timeline whose
 * frames are project samples. These pin that the fallback weight still fades
 * across the whole overlap once those two domains disagree by the frame rate.
 */

const SAMPLE_RATE = 48_000;
const SEQUENCE_RATE = { num: 30, den: 1 };
const SAMPLES_PER_FRAME = SAMPLE_RATE / SEQUENCE_RATE.num;
const OVERLAP_START_FRAME = 60;
const OVERLAP_FRAMES = 30;
const CLIP_FRAMES = 90;
const OVERLAP_START_SAMPLE = OVERLAP_START_FRAME * SAMPLES_PER_FRAME;
const OVERLAP_SAMPLES = OVERLAP_FRAMES * SAMPLES_PER_FRAME;

test('a sequence-authored dissolve fades across the whole sample-domain overlap', () => {
	const layers = resolveActiveVideoLayers(sequenceProject(), OVERLAP_START_SAMPLE + OVERLAP_SAMPLES / 2);
	assert.deepEqual(layers.at(-1).clips.map(({ clipId, role, opacity }) => ({ clipId, role, opacity })), [
		{ clipId: 'outgoing', role: 'outgoing', opacity: 0.5 },
		{ clipId: 'incoming', role: 'incoming', opacity: 0.5 },
	]);
});

test('the sequence-authored dissolve is a ramp rather than an immediate cut', () => {
	const project = sequenceProject();
	const weights = [0.25, 0.5, 0.75].map((fraction) => {
		const frame = OVERLAP_START_SAMPLE + (OVERLAP_SAMPLES * fraction);
		const [clip] = resolveActiveVideoLayers(project, frame).at(-1).clips.filter(({ role }) => (
			role === 'incoming'
		));
		return clip.opacity;
	});
	assert.deepEqual(weights, [0.25, 0.5, 0.75]);
	// One sequence frame into a one-second overlap the incoming picture is barely present.
	const [early] = resolveActiveVideoLayers(project, OVERLAP_START_SAMPLE + SAMPLES_PER_FRAME)
		.at(-1).clips.filter(({ role }) => role === 'incoming');
	assert.equal(early.opacity, 1 / OVERLAP_FRAMES);
});

test('composition intervals carry the same ramp across a range inside the overlap', () => {
	const intervals = resolveVideoCompositionIntervals(sequenceProject(), {
		startFrame: OVERLAP_START_SAMPLE + (OVERLAP_SAMPLES / 4),
		endFrame: OVERLAP_START_SAMPLE + ((OVERLAP_SAMPLES * 3) / 4),
	});
	assert.equal(intervals.length, 1);
	assert.deepEqual(intervals[0].layers.at(-1).clips.map(({ clipId, opacityStart, opacityEnd }) => ({
		clipId, opacityStart, opacityEnd,
	})), [
		{ clipId: 'outgoing', opacityStart: 0.75, opacityEnd: 0.25 },
		{ clipId: 'incoming', opacityStart: 0.25, opacityEnd: 0.75 },
	]);
});

test('a legacy project whose overlap already matches the curve domain is unchanged', () => {
	// Here the timeline frames are the curve's own frames, so rescaling must be a no-op.
	const layers = resolveActiveVideoLayers(legacyProject(), 70);
	assert.deepEqual(layers.at(-1).clips.map(({ clipId, opacity }) => ({ clipId, opacity })), [
		{ clipId: 'outgoing', opacity: 0.75 },
		{ clipId: 'incoming', opacity: 0.25 },
	]);
});

function sequenceProject() {
	return {
		sampleRate: SAMPLE_RATE,
		primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: SEQUENCE_RATE }],
		sources: [videoSource('outgoing-source', SAMPLE_RATE), videoSource('incoming-source', SAMPLE_RATE)],
		clips: [
			sequenceClip({ id: 'outgoing', sequenceStartFrame: 0 }),
			sequenceClip({ id: 'incoming', sequenceStartFrame: OVERLAP_START_FRAME }),
		],
		tracks: [videoTrack(OVERLAP_FRAMES)],
	};
}

function legacyProject() {
	return {
		sampleRate: 100,
		sources: [videoSource('outgoing-source', 100), videoSource('incoming-source', 100)],
		clips: [
			legacyClip({ id: 'outgoing', timelineStartFrame: 0 }),
			legacyClip({ id: 'incoming', timelineStartFrame: 60 }),
		],
		tracks: [videoTrack(40)],
	};
}

function videoTrack(durationFrames: number) {
	return {
		type: 'video',
		id: 'video-track',
		clipIds: ['outgoing', 'incoming'],
		hidden: false,
		videoTransitions: [dissolve(durationFrames)],
	};
}

function dissolve(durationFrames: number) {
	return {
		schemaVersion: 1,
		id: 'authored-dissolve',
		type: 'dissolve',
		outgoingClipId: 'outgoing',
		incomingClipId: 'incoming',
		alignment: 'center-on-cut',
		durationFrames,
		curve: compileInterpolationCurve({
			anchors: [
				{ position: { num: 0, den: 1 }, value: 0 },
				{ position: { num: durationFrames, den: 1 }, value: 1 },
			],
			segments: [{ kind: 'linear' }],
		}),
	};
}

function videoSource(id: string, sampleRate: number) {
	return {
		kind: 'video',
		id,
		sampleRate,
		frameRate: SEQUENCE_RATE,
		width: 1_280,
		height: 720,
	};
}

function sequenceClip(options: Readonly<{ id: string; sequenceStartFrame: number }>) {
	return {
		kind: 'video',
		id: options.id,
		sourceId: `${options.id}-source`,
		sequenceId: 'main',
		sequenceStartFrame: options.sequenceStartFrame,
		sequenceFrameCount: CLIP_FRAMES,
		sourceInFrame: 0,
		sourceFrameCount: CLIP_FRAMES,
	};
}

function legacyClip(options: Readonly<{ id: string; timelineStartFrame: number }>) {
	return {
		kind: 'video',
		id: options.id,
		sourceId: `${options.id}-source`,
		timelineStartFrame: options.timelineStartFrame,
		durationFrames: 100,
		sourceStartFrame: 0,
		sourceDurationFrames: 100,
	};
}
