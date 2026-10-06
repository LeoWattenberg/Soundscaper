/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPencilSampleEdits, createSmoothSampleRange, timelineFrameToSourceFrame } from '../src/common/editor/sample-edit.js';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';

const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 96,
	channelCount: 1, chunkFrames: 96 });
const clip = { id: 'clip', kind: 'audio', anchor: 'sample', sourceId: source.id,
	timelineStartFrame: 0, durationFrames: 96, sourceStartFrame: 0, sourceDurationFrames: 96,
	warpMap: { feature: 'audio-warp', points: [
		{ outer: 0, source: 0, mode: 'forward' },
		{ outer: 32, source: 64, mode: 'forward' },
		{ outer: 96, source: 96, mode: 'forward' },
	] } };
const project = { sampleRate: 48_000, tempoMap: { mode: 'musical' as const,
	events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] } };

test('a nonlinear warped pencil point writes the addressed immutable source sample', () => {
	const request = { clip, source, project, points: [{ timelineFrame: 32, value: 0.5 }] };
	assert.deepEqual(createPencilSampleEdits(request), [{ channel: 0, frame: 64, value: 0.5 }]);
});

test('a pencil stroke interpolates its height in timeline space across warp-rate changes', () => {
	const request = { clip, source, project, points: [
		{ timelineFrame: 16, value: 0.2 }, { timelineFrame: 48, value: 0.8 },
	] };
	const edits = createPencilSampleEdits(request);
	assert.equal(edits[0]?.frame, 32);
	assert.equal(edits.at(-1)?.frame, 72);
	assert.ok(Math.abs((edits.find(edit => edit.frame === 48)?.value ?? -1) - 0.35) < 1e-12);
	assert.ok(Math.abs((edits.find(edit => edit.frame === 64)?.value ?? -1) - 0.5) < 1e-12);
});

test('warped smoothing uses the source window under its timeline selection', () => {
	const request = { clip, source, project, startFrame: 32, endFrame: 40 };
	assert.deepEqual(createSmoothSampleRange(request), { startFrame: 64, endFrame: 68, channel: null });
});

test('ordinary unwarped sample mapping retains its exact existing orientation', () => {
	const unwarped = { ...clip, warpMap: undefined };
	assert.equal(timelineFrameToSourceFrame(unwarped, source, 32), 32);
	assert.equal(timelineFrameToSourceFrame({ ...unwarped, reversed: true }, source, 32), 63);
});

test('musical warp points retain the project beat clock while addressing source samples', () => {
	const musical = { ...clip, anchor: 'musical', musicalStartBeat: { num: 0, den: 1 },
		musicalExtent: 'beat', musicalDurationBeats: { num: 1, den: 250 },
		warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' },
			{ outer: { num: 1, den: 750 }, source: 64, mode: 'forward' },
			{ outer: { num: 1, den: 250 }, source: 96, mode: 'forward' },
		] } };
	assert.deepEqual(createPencilSampleEdits({ clip: musical, source, project,
		points: [{ timelineFrame: 32, value: -0.25 }] }), [{ channel: 0, frame: 64, value: -0.25 }]);
});

test('backwards pointer strokes retain their drawn timeline interpolation', () => {
	const edits = createPencilSampleEdits({ clip, source, project, points: [
		{ timelineFrame: 48, value: 0.2 }, { timelineFrame: 16, value: 0.8 },
	] });
	assert.equal(edits[0]?.frame, 32);
	assert.equal(edits.at(-1)?.frame, 72);
	assert.ok(Math.abs((edits.find(edit => edit.frame === 48)?.value ?? -1) - 0.65) < 1e-12);
	assert.ok(Math.abs((edits.find(edit => edit.frame === 64)?.value ?? -1) - 0.5) < 1e-12);
});
