import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createEnvelopeValueEvaluator,
	envelopeDbToValue,
	envelopeFramesToDesignPoints,
	envelopeValueAtFrame,
	envelopeValueToDb,
	mergeDesignEnvelopePoints,
} from '../src/lib/tools/audio-editor/automation.js';
import { applyEditorCommand } from '../src/lib/tools/audio-editor/commands.js';
import {
	createAudioClipV2,
	createAudioEditorProjectV2,
	createAudioSourceV2,
	createAudioTrackV2,
} from '../src/lib/tools/audio-editor/project-v2.js';

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
	const source = createAudioSourceV2({
		id: 'source', storageKey: 'source', name: 'Source', frameCount: 96_000,
		channelCount: 1, sampleRate: 48_000,
	});
	const clip = createAudioClipV2({
		id: 'clip', sourceId: source.id, timelineStartFrame: 10_000,
		durationFrames: 40_000, envelope: [
			{ frame: 5_000, value: 0.5 },
			{ frame: 20_000, value: 0.25 },
			{ frame: 35_000, value: 1 },
		],
	});
	const track = createAudioTrackV2({
		id: 'track', clipIds: [clip.id],
	});
	let project = createAudioEditorProjectV2({
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
	assert.deepEqual(project.clips[0].envelope, [{ frame: 10_000, value: 0.25 }]);
});
