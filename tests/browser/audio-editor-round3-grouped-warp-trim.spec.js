/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('a grouped keyboard trim resolves an editable boundary on every participating recording', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const plain = createWavFixture({ name: 'plain-recording.wav', frequency: 440, duration: 1, channelCount: 1 });
	const warped = createWavFixture({ name: 'aligned-recording.wav', frequency: 440, duration: 1, channelCount: 1 });
	await importFiles(editor, [plain, warped]);
	await clipByName(editor, warped.name).locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	const warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
	await warp.getByLabel('Outer position', { exact: true }).fill('43201');
	await warp.getByLabel('Source sample', { exact: true }).fill('43200');
	await warp.getByRole('button', { name: 'Add marker', exact: true }).click();
	await expect(warp.getByLabel('Marker 1 source sample', { exact: true })).toHaveValue('43200/1');
	await warp.getByRole('button', { name: 'Close', exact: true }).click();
	await clipByName(editor, plain.name).locator('.clip-header').click({ modifiers: ['Shift'] });
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Group clips']);
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(2);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	const clip = clipByName(editor, plain.name);
	await clip.focus();
	await expect(clip).toBeFocused();
	await clip.press('[');
	await expect(editor.locator('[data-editor-toast="workspace-error"]')).toBeHidden();
	const properties = await openClipProperties(page, editor, clip);
	await properties.getByText('Media settings', { exact: true }).click();
	const duration = properties.locator('[data-clip-field="durationFrame"]');
	await duration.locator('.timecode__format-button').click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	await expect(duration.locator('.timecode__display')).toHaveText('000,000,043,201samples');
});
