/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import { insertAutomationLanePointV21 } from '../src/common/editor/automation-lane-inline-edit-v21.ts';
import {
	projectTrackAutomationOverlayV21,
} from '../src/common/editor/ui/timeline/track-automation-overlay-projection.ts';
import { trackAutomationPathData } from '../src/common/editor/ui/timeline/track-automation-overlay-bezier.ts';

const address = Object.freeze({
	kind: 'strip' as const,
	strip: Object.freeze({ kind: 'track' as const, id: 'voice' }),
	parameterId: 'pan' as const,
});
const descriptor = stripParameterDescriptor(address);

test('automation overlay projects the selected lane only across clip bodies', () => {
	const lane = {
		id: 'pan-lane', address, timebase: 'absolute-samples' as const,
		points: [
			{ id: 'a', position: 0, value: -1 },
			{ id: 'b', position: 100, value: 1 },
		],
		segments: [{ kind: 'linear' as const }],
	};
	const projection = projectTrackAutomationOverlayV21({
		descriptor,
		lane,
		currentValue: 0,
		clips: [
			{ id: 'first', timelineStartFrame: 25, durationFrames: 25 },
			{ id: 'second', timelineStartFrame: 75, durationFrames: 25 },
		],
		viewportStartFrame: 0,
		viewportEndFrame: 100,
		pixelsPerSecond: 100,
		sampleRate: 100,
		width: 112,
		height: 100,
	});

	assert.equal(projection.spans.length, 2);
	assert.deepEqual(projection.spans.map(({ clipId, startFrame, endFrame }) => (
		[clipId, startFrame, endFrame]
	)), [['first', 25, 50], ['second', 75, 100]]);
	assert.deepEqual(projection.spans[0]?.samples.at(0), {
		frame: 25, x: 37, y: 80, value: -0.5,
	});
	assert.deepEqual(projection.spans[1]?.points.map(({ id }) => id), ['b']);
});

test('automation overlay renders an unpersisted target as a constant implicit curve', () => {
	const projection = projectTrackAutomationOverlayV21({
		descriptor,
		lane: null,
		currentValue: 0.5,
		clips: [{ id: 'clip', timelineStartFrame: 20, durationFrames: 40 }],
		viewportStartFrame: 10,
		viewportEndFrame: 70,
		pixelsPerSecond: 100,
		sampleRate: 100,
		width: 72,
		height: 100,
	});

	assert.equal(projection.spans.length, 1);
	assert.equal(projection.spans[0]?.samples.at(0)?.x, 22);
	assert.ok(projection.spans[0]?.samples.every(({ value, y }) => value === 0.5 && y === 40));
	assert.deepEqual(projection.spans[0]?.points, []);
});

test('automation overlay coordinates are local to a scrolled overscan window', () => {
	const projection = projectTrackAutomationOverlayV21({
		descriptor,
		lane: null,
		currentValue: 0,
		clips: [{ id: 'clip', timelineStartFrame: 125, durationFrames: 25 }],
		viewportStartFrame: 200,
		viewportEndFrame: 300,
		projectionStartFrame: 100,
		projectionEndFrame: 400,
		pixelsPerSecond: 100,
		sampleRate: 100,
		width: 87,
		height: 100,
	});

	assert.equal(projection.spans[0]?.samples[0]?.x, 37);
	assert.equal(projection.spans[0]?.samples.at(-1)?.x, 62);
});

test('hold segments project an exact horizontal then vertical step', () => {
	const projection = projectTrackAutomationOverlayV21({
		descriptor,
		lane: {
			id: 'hold-lane', address, timebase: 'absolute-samples',
			points: [
				{ id: 'low', position: 0, value: -1 },
				{ id: 'high', position: 50, value: 1 },
			],
			segments: [{ kind: 'hold' }],
		},
		currentValue: 0,
		clips: [{ id: 'clip', timelineStartFrame: 0, durationFrames: 100 }],
		viewportStartFrame: 0,
		viewportEndFrame: 100,
		pixelsPerSecond: 100,
		sampleRate: 100,
		width: 112,
		height: 100,
	});
	const boundary = projection.spans[0]!.samples.filter(({ frame }) => frame === 50);
	assert.deepEqual(boundary.map(({ x, y, value }) => [x, y, value]), [
		[62, 100, -1], [62, 20, 1],
	]);
	assert.match(trackAutomationPathData(projection.spans[0]!.samples), /L 62 100 L 62 20/u);
});

test('musical-beat edits retain beat positions while projecting and evaluating in frames', () => {
	const tempoMap = Object.freeze({
		mode: 'musical' as const,
		events: Object.freeze([Object.freeze({
			beat: Object.freeze({ num: 0, den: 1 }),
			bpm: Object.freeze({ num: 120, den: 1 }),
		})]),
	});
	const lane = insertAutomationLanePointV21({
		id: 'beat-lane', address, timebase: 'musical-beats',
		points: [
			{ id: 'start', position: { num: 0, den: 1 }, value: -1 },
			{ id: 'end', position: { num: 2, den: 1 }, value: 1 },
		],
		segments: [{ kind: 'linear' }],
	}, {
		frame: 25,
		value: -0.5,
		pointId: 'half-beat',
		descriptor,
		sampleRate: 100,
		tempoMap,
	});
	assert.deepEqual(lane.points[1]?.position, { num: 1, den: 2 });

	const projection = projectTrackAutomationOverlayV21({
		descriptor,
		lane,
		currentValue: 0,
		clips: [{ id: 'clip', timelineStartFrame: 0, durationFrames: 100 }],
		viewportStartFrame: 0,
		viewportEndFrame: 100,
		pixelsPerSecond: 100,
		sampleRate: 100,
		width: 112,
		height: 100,
		tempoMap,
	});
	assert.deepEqual(projection.spans[0]?.points.map(({ id, frame, x, value }) => (
		[id, frame, x, value]
	)), [
		['start', 0, 12, -1],
		['half-beat', 25, 37, -0.5],
		['end', 100, 112, 1],
	]);
	assert.deepEqual(projection.spans[0]?.samples.find(({ frame }) => frame === 50), {
		frame: 50, x: 62, y: 60, value: 0,
	});
});
