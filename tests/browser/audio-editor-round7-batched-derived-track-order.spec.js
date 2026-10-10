/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

for (const foldered of [false, true]) test(`a ${foldered ? 'foldered' : 'root'} multi-track range lift keeps each derived lane directly below its recording`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const names = ['Alpha recording.wav', 'Bravo recording.wav'];
	await importFiles(editor, names.map(name => createWavFixture({ name, duration: .2 })));
	const projectId = await editor.getAttribute('data-project-id');
	const namesInTimeline = async () => {
		const project = await persistedProject(page, projectId);
		const tracks = new Map(project.tracks.map(track => [track.id, track.name]));
		return editor.locator('[data-track-row]').evaluateAll((rows, trackNames) => rows.map(row =>
			trackNames[row.dataset.trackId]), Object.fromEntries(tracks));
	};
	await expect.poll(namesInTimeline).toEqual(['Track 1', 'Alpha recording', 'Bravo recording']);
	if (foldered) {
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		const track = clipByName(editor, names[0]).locator('xpath=ancestor::*[@data-track-row][1]');
		await chooseTrackMenuAction(page, editor, track, 'Move selection into new folder');
		await expect(editor.getByRole('treeitem')).toHaveCount(1);
		await expect.poll(namesInTimeline).toEqual(['Track 1', 'Alpha recording', 'Bravo recording']);
	}
	await clipByName(editor, names[0]).locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Track start to end']);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Split into new track']);
	await expect(editor).toHaveAttribute('data-track-count', '4');
	await expect.poll(namesInTimeline).toEqual(['Track 1', 'Alpha recording', 'Alpha recording 2', 'Bravo recording']);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-track-count', '3');
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Split into new track']);
	await expect(editor).toHaveAttribute('data-track-count', '5');
	await expect.poll(namesInTimeline).toEqual(['Track 1', 'Alpha recording', 'Alpha recording 2', 'Bravo recording', 'Bravo recording 2']);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(namesInTimeline).toEqual(['Track 1', 'Alpha recording', 'Bravo recording']);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(namesInTimeline).toEqual(['Track 1', 'Alpha recording', 'Alpha recording 2', 'Bravo recording', 'Bravo recording 2']);
});
