/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { getClipSpreadsheetRows, planClipSpreadsheetEdits } from '../src/common/editor/clip-spreadsheet.ts';
import { planClipSpreadsheetInsert } from '../src/common/editor/clip-spreadsheet-insert.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';

test('spreadsheet rows and prepared sources satisfy the production document schema and undo together', () => {
	const project = createSoundscaperProject({ id: 'spreadsheet-production', sampleRate: 48_000 });
	const source = createAudioSource({ id: 'imported', storageKey: 'imported', name: 'Fresh.wav', sampleRate: 44_100, frameCount: 441_000, channelCount: 2 });
	let sequence = 0;
	const command = planClipSpreadsheetInsert(project, [
		{ source: 'Fresh.wav', name: 'Verse', track: 'Imported', offset: '1', duration: '2', speed: '1.5', pitch: '3', fadeIn: '0.1' },
		{ source: 'Fresh.wav', position: '3' },
	], { createId: prefix => `${prefix}-${String(++sequence)}`, additionalSources: [source] });
	assert.ok(command);
	const history = executeSoundscaperProjectCommand(createSoundscaperProjectHistory(project), command);
	assert.equal(validateSoundscaperProject(history.present), true);
	assert.equal(history.present.sources.length, 1);
	assert.equal(history.present.tracks.length, 2);
	assert.equal(history.present.clips.length, 2);
	assert.equal(history.undoStack.length, 1);
	const restored = undoSoundscaperProjectCommand(history).present;
	assert.equal(restored.sources.length, 0);
	assert.equal(restored.tracks.length, 0);
	assert.equal(restored.clips.length, 0);
});

test('spreadsheet media replacement and track moves preserve production coordinates and undo atomically', () => {
	const original = createAudioSource({ id: 'original', storageKey: 'original', name: 'Original.wav', sampleRate: 44_100, frameCount: 441_000, channelCount: 2 });
	const replacement = createAudioSource({ id: 'replacement', storageKey: 'replacement', name: 'Replacement.wav', sampleRate: 48_000, frameCount: 240_000, channelCount: 1 });
	const initial = createSoundscaperProject({ id: 'spreadsheet-replace-production', sampleRate: 48_000 });
	let sequence = 0;
	const insertion = planClipSpreadsheetInsert(initial, [{ source: 'original', offset: '1', duration: '2' }], {
		createId: prefix => `${prefix}-${String(++sequence)}`, additionalSources: [original],
	});
	assert.ok(insertion);
	const inserted = executeSoundscaperProjectCommand(createSoundscaperProjectHistory(initial), insertion).present;
	const project = executeSoundscaperProjectCommand(createSoundscaperProjectHistory(inserted), { type: 'batch', commands: [
		{ type: 'source/add', source: replacement },
		{ type: 'track/add', track: createAudioTrack({ id: 'destination', name: 'Destination' }) },
	] }).present;
	const row = getClipSpreadsheetRows(project)[0];
	assert.ok(row);
	const command = planClipSpreadsheetEdits(project, [
		{ clipId: row.id, column: 'source', value: 'replacement' },
		{ clipId: row.id, column: 'track', value: 'destination' },
	]);
	assert.ok(command);
	const history = executeSoundscaperProjectCommand(createSoundscaperProjectHistory(project), command);
	assert.equal(validateSoundscaperProject(history.present), true);
	const replaced = getClipSpreadsheetRows(history.present)[0];
	assert.equal(replaced?.cells.source, 'replacement');
	assert.equal(replaced?.cells.track, 'destination');
	assert.equal(replaced?.cells.offset, '1');
	assert.equal(replaced?.cells.duration, '2');
	assert.equal(history.undoStack.length, 1);
	assert.deepEqual(getClipSpreadsheetRows(undoSoundscaperProjectCommand(history).present), getClipSpreadsheetRows(project));
});
