/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
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
