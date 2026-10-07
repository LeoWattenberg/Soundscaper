/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseNestedCommandAction, clipByName, closeDialog,
	closeEffectsPanel, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

for (const mode of ['header', 'range']) test(`Split into new track retains the processor chain for ${mode} selection`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Resonant low-pass filter');
	await closeDialog(page.getByRole('dialog', { name: 'Resonant low-pass filter', exact: true }));
	await closeEffectsPanel(panel);
	await clip.locator('.clip-header').click();
	if (mode === 'range') await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Track start to end']);
	else await editor.getByRole('slider', { name: 'Playhead', exact: true }).press('ArrowRight');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Split into new track']);
	await expect(editor.locator('[data-track-row]')).toHaveCount(3);
	const derived = await openEffectsForTrack(editor, 2);
	await expect(derived.getByRole('group', { name: 'Resonant low-pass filter', exact: true })).toBeVisible();
	await closeEffectsPanel(derived);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(editor.locator('[data-track-row]')).toHaveCount(2);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(editor.locator('[data-track-row]')).toHaveCount(3);
	const restored = await openEffectsForTrack(editor, 2);
	await expect(restored.getByRole('group', { name: 'Resonant low-pass filter', exact: true })).toBeVisible();
});
