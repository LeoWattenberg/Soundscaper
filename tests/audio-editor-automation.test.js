import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createEnvelopeValueEvaluator,
	envelopeDbToValue,
	envelopeFramesToDesignPoints,
	envelopeValueAtFrame,
	envelopeValueToDb,
	mergeDesignEnvelopePoints,
} from '../src/common/editor/automation.js';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	createCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';

test('volume automation converts between frame-linear gain and design-system dB points', () => {
	assert.equal(envelopeValueToDb(0), -Infinity);
	assert.ok(Math.abs(envelopeValueToDb(0.5) + 6.020599913) < 1e-6);
	assert.equal(envelopeDbToValue(-Infinity), 0);
	assert.ok(Math.abs(envelopeDbToValue(6.020599913, 2) - 2) < 1e-6);

	const points = [{ frame: 12_000, value: 0.5 }, { frame: 24_000, value: 1 }];
	const projected = envelopeFramesToDesignPoints(points, 48_000, {
		startFrame: 6_000,
		endFrame: 18_000,
	});
	assert.equal(projected.length, 1);
	assert.equal(projected[0].time, 0.125);

	assert.equal(envelopeValueAtFrame(points, 0, 48_000), 1);
	assert.equal(envelopeValueAtFrame(points, 12_000, 48_000), 0.5);
	assert.equal(envelopeValueAtFrame(points, 18_000, 48_000), 0.75);
	const evaluate = createEnvelopeValueEvaluator(points, 48_000);
	assert.equal(evaluate(12_000), 0.5);
	assert.equal(evaluate(18_000), 0.75);
});

test('projected automation edits preserve offscreen points and canonical ordering', () => {
	const current = [
		{ frame: 1_000, value: 0.25 },
		{ frame: 10_000, value: 0.5 },
		{ frame: 30_000, value: 0.75 },
	];
	const merged = mergeDesignEnvelopePoints(current, [
		{ time: 0.1, db: 0 },
		{ time: 0.2, db: -Infinity },
	], 48_000, 48_000, { startFrame: 8_000, endFrame: 24_000, maximumValue: 2 });
	assert.deepEqual(merged, [
		{ frame: 1_000, value: 0.25 },
		{ frame: 12_800, value: 1 },
		{ frame: 17_600, value: 0 },
		{ frame: 30_000, value: 0.75 },
	]);
});

test('clip automation moves with clips and is trimmed in timeline coordinates', () => {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', name: 'Source', frameCount: 96_000,
		channelCount: 1, sampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'clip', sourceId: source.id, timelineStartFrame: 10_000,
		durationFrames: 40_000, envelope: [
			{ frame: 5_000, value: 0.5 },
			{ frame: 20_000, value: 0.25 },
			{ frame: 35_000, value: 1 },
		],
	});
	const track = createAudioTrack({
		id: 'track', clipIds: [clip.id],
	});
	let project = createCurrentAudioEditorProject({
		id: 'project', title: 'Automation', sources: [source], clips: [clip], tracks: [track],
	});
	project = applyEditorCommand(project, {
		type: 'clip/move', clipId: clip.id, trackId: track.id, timelineStartFrame: 30_000,
	});
	assert.deepEqual(project.clips[0].envelope, clip.envelope);

	project = applyEditorCommand(project, {
		type: 'clip/trim', clipId: clip.id,
		timelineStartFrame: 40_000,
		sourceStartFrame: 10_000,
		durationFrames: 20_000,
	});
	// A trim keeps the gain over the material it retains, so both new edges carry
	// the value the envelope described there: the new start sits a third of the
	// way from 0.5 down to 0.25, and the new end two thirds of the way from 0.25
	// up to 1.
	const trimmed = project.clips[0].envelope;
	assert.deepEqual(trimmed.map(({ frame }) => frame), [0, 10_000, 20_000]);
	assert.ok(Math.abs(trimmed[0].value - 5 / 12) < 1e-12, `${trimmed[0].value} is not 5/12`);
	assert.equal(trimmed[1].value, 0.25);
	assert.equal(trimmed[2].value, 0.75);
});
