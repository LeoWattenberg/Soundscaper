/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { readClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { planClipSpreadsheetEdits, type ClipSpreadsheetEdit } from '../src/common/editor/clip-spreadsheet.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createEditorHistory, executeEditorCommand, undoEditorCommand } from '../src/common/editor/history.js';

function fixture(sourceRate = 48_000, phase = 0) {
	let project = createCurrentAudioEditorProject({ id: 'looped-table', sampleRate: 48_000 });
	project = applyEditorCommand(project, { type: 'batch', commands: [
		{ type: 'source/add', source: { id: 'source', storageKey: 'source', name: 'Take.wav', sampleRate: sourceRate,
			frameCount: sourceRate * 4, channelCount: 1 } },
		{ type: 'track/add', track: { id: 'track', name: 'Take' } },
		{ type: 'clip/add', trackId: 'track', clip: { id: 'clip', title: 'Take', sourceId: 'source', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: sourceRate, durationFrames: 48_000,
			envelope: [{ frame: 0, value: 1 }, { frame: 24_000, value: 0.5 }, { frame: 48_000, value: 1 }] } },
	] });
	project = applyEditorCommand(project, { type: 'clip/update', clipId: 'clip', changes: {
		loop: { periodFrames: 48_000, durationFrames: 120_000, offsetFrames: phase },
	} });
	project = applyEditorCommand(project, { type: 'clip/update', clipId: 'clip', changes: {
		envelope: [{ frame: 0, value: 1 }, { frame: 60_000, value: 0.5 }, { frame: 120_000, value: 1 }],
	} });
	return project;
}

function edit(project: ReturnType<typeof fixture>, edits: readonly ClipSpreadsheetEdit[]) {
	const command = planClipSpreadsheetEdits(project, edits);
	assert.ok(command);
	return executeEditorCommand(createEditorHistory(project), command);
}

test('speed preserves fractional repeats, native source bounds, phase and one-entry undo', () => {
	const project = fixture(44_100, 12_000);
	const history = edit(project, [{ clipId: 'clip', column: 'speed', value: '2' }]);
	const clip = history.present.clips[0]!;
	assert.equal(clip.durationFrames, 60_000);
	assert.equal(clip.sourceDurationFrames, 44_100);
	assert.equal(clip.speedRatio, 2);
	assert.deepEqual(readClipLoop(clip), { periodFrames: 24_000, offsetFrames: 6_000 });
	assert.deepEqual(clip.envelope.map((point: Readonly<{ frame: number }>) => point.frame), [0, 30_000, 60_000]);
	assert.equal(history.undoStack.length, 1);
	const restored = undoEditorCommand(history).present;
	assert.deepEqual(restored.clips, project.clips);
	assert.deepEqual(restored.sources, project.sources);
	assert.deepEqual(restored.tracks, project.tracks);
});

test('an explicit pasted loop duration is divided across its repeats when resolving source media', () => {
	const clip = edit(fixture(), [
		{ clipId: 'clip', column: 'duration', value: '2.5' },
		{ clipId: 'clip', column: 'speed', value: '2' },
	]).present.clips[0]!;
	assert.equal(clip.durationFrames, 120_000);
	assert.equal(clip.sourceDurationFrames, 96_000);
	assert.deepEqual(readClipLoop(clip), { periodFrames: 48_000, offsetFrames: 0 });
});

test('slowing a loop extends all repeats and preserves the period media', () => {
	const clip = edit(fixture(), [{ clipId: 'clip', column: 'speed', value: '0.5' }]).present.clips[0]!;
	assert.equal(clip.durationFrames, 240_000);
	assert.equal(clip.sourceDurationFrames, 48_000);
	assert.deepEqual(readClipLoop(clip), { periodFrames: 96_000, offsetFrames: 0 });
});
