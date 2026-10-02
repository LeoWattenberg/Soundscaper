/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { clipSourceStretchFeedback, formatSourceStretchSpeed } from '../src/common/editor/ui/inspector/clip-source-stretch-feedback.ts';

const project = { sampleRate: 48_000, tempoMap: { mode: 'musical' as const, events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] } };
const source = { sampleRate: 24_000, frameCount: 96_000 };
const clip = { kind: 'audio', anchor: 'sample', timelineStartFrame: 48_000, durationFrames: 96_000, sourceStartFrame: 24_000, sourceDurationFrames: 48_000,
	warpMap: { feature: 'audio-warp', points: [
		{ outer: 0, source: 24_000, mode: 'forward' }, { outer: 48_000, source: 48_000, mode: 'forward' }, { outer: 96_000, source: 72_000, mode: 'forward' },
	] },
};

test('drag feedback reports the speed of both neighboring source segments at their native sample rate', () => {
	const initial = clipSourceStretchFeedback(project, clip, source, 1)!;
	assert.equal(initial.beforeSpeed, 1);
	assert.equal(initial.afterSpeed, 1);
	const dragged = clipSourceStretchFeedback(project, clip, source, 1, 108_000)!;
	assert.equal(dragged.sourceFrame, 48_000);
	assert.equal(dragged.displayFrame, 108_000);
	assert.equal(dragged.beforeSpeed, 0.8);
	assert.equal(dragged.afterSpeed, 4 / 3);
	assert.equal(formatSourceStretchSpeed(dragged.beforeSpeed), '0.80× (80%)');
	assert.equal(formatSourceStretchSpeed(dragged.afterSpeed), '1.33× (133.3%)');
});

test('marker feedback clamps a drag between its adjacent markers without changing its sample', () => {
	assert.equal(clipSourceStretchFeedback(project, clip, source, 0), null);
	assert.equal(clipSourceStretchFeedback(project, clip, source, 1, 0)?.displayFrame, 48_001);
	assert.equal(clipSourceStretchFeedback(project, clip, source, 1, 200_000)?.displayFrame, 143_999);
	assert.equal(clipSourceStretchFeedback(project, clip, source, 1, 200_000)?.sourceFrame, 48_000);
});

test('musical markers measure each neighboring speed through its actual project tempo', () => {
	const musicalProject = { ...project, tempoMap: { mode: 'musical' as const, events: [
		{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }, { beat: { num: 2, den: 1 }, bpm: { num: 60, den: 1 } },
	] } };
	const musical = { ...clip, anchor: 'musical', musicalExtent: 'beat', musicalStartBeat: { num: 0, den: 1 }, musicalDurationBeats: { num: 4, den: 1 },
		timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 144_000, warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' }, { outer: 2, source: 24_000, mode: 'forward' }, { outer: 4, source: 48_000, mode: 'forward' },
		] } };
	assert.equal(clipSourceStretchFeedback(musicalProject, musical, source, 1)?.beforeSpeed, 1);
	assert.equal(clipSourceStretchFeedback(musicalProject, musical, source, 1)?.afterSpeed, 0.5);
	const dragged = clipSourceStretchFeedback(musicalProject, musical, source, 1, 72_000)!;
	assert.equal(dragged.beforeSpeed, 2 / 3);
	assert.equal(dragged.afterSpeed, 2 / 3);
});
