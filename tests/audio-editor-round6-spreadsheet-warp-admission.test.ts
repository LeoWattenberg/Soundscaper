/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { getClipSpreadsheetRows, isClipSpreadsheetCellEditable, planClipSpreadsheetEdits, type ClipSpreadsheetColumnId } from '../src/common/editor/clip-spreadsheet.ts';

function fixture(warped: boolean) {
	const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Recording.wav', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', title: source.name, sourceId: source.id, sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000,
		...(warped ? { warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' }, { outer: 48_000, source: 48_000, mode: 'forward' },
		] } } : {}) });
	return createSoundscaperProject({ id: 'project', sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] });
}

for (const column of ['source', 'offset', 'duration', 'speed', 'reversed'] as const) {
	test(`spreadsheet ${column} availability matches authored warp authority`, () => {
		const ordinary = fixture(false);
		const warped = fixture(true);
		const values = { source: 'Other.wav', offset: '0.1', duration: '0.5', speed: '2', reversed: 'true' };
		const ordinaryRow = getClipSpreadsheetRows(ordinary)[0];
		const warpedRow = getClipSpreadsheetRows(warped)[0];
		assert.ok(ordinaryRow && warpedRow);
		assert.equal(isClipSpreadsheetCellEditable(ordinaryRow, column), true);
		if (column === 'duration' || column === 'speed') assert.throws(() =>
			planClipSpreadsheetEdits(warped, [{ clipId: 'clip', column, value: values[column] }]), RangeError);
		if (column === 'reversed') assert.throws(() => applySoundscaperProjectCommand(warped,
			{ type: 'clip/update', clipId: 'clip', changes: { reversed: true } }), RangeError);
		assert.equal(isClipSpreadsheetCellEditable(warpedRow, column), false);
	});
}

test('warped spreadsheet preserves supported edits and unwarped timing commands', () => {
	const warped = fixture(true);
	const row = getClipSpreadsheetRows(warped)[0];
	assert.ok(row);
	for (const column of ['name', 'track', 'position', 'pitch', 'gain', 'fadeIn', 'fadeOut', 'inverted'] satisfies ClipSpreadsheetColumnId[]) {
		assert.equal(isClipSpreadsheetCellEditable(row, column), true, column);
	}
	const command = planClipSpreadsheetEdits(warped, [{ clipId: 'clip', column: 'inverted', value: 'true' }, { clipId: 'clip', column: 'name', value: 'New name' }]);
	assert.ok(command);
	const changed = applySoundscaperProjectCommand(warped, command);
	assert.equal(changed.clips[0]?.inverted, true);
	assert.equal(changed.clips[0]?.title, 'New name');
	assert.deepEqual(changed.clips[0]?.warpMap, warped.clips[0]?.warpMap);
	const timing = planClipSpreadsheetEdits(fixture(false), [{ clipId: 'clip', column: 'duration', value: '0.5' }]);
	assert.ok(timing);
	assert.equal(applySoundscaperProjectCommand(fixture(false), timing).clips[0]?.durationFrames, 24_000);
});
