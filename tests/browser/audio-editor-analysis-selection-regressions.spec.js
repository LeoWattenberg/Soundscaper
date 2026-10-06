/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, clipField, closeClipProperties,
	importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('Plot spectrum includes audio after a silent lead-in in the selected range', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const properties = await openClipProperties(page, editor, clipByName(editor, monoTone.name));
	await properties.getByText('Media settings', { exact: true }).click();
	await clipField(properties, 'startFrame').fill('24000');
	await clipField(properties, 'startFrame').press('Tab');
	await closeClipProperties(properties);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Analyze', 'Plot spectrum');
	const dialog = page.getByRole('dialog', { name: 'Plot spectrum', exact: true });
	await expect(dialog.locator('[data-analysis-report="spectrum"]')).toContainText(/Peak frequency: 4[0-9]{2}\.\d Hz/u);
});

test('Plot spectrum preserves energy in stereo channels with opposite polarity', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const original = clipByName(editor, monoTone.name);
	const row = original.locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, row, 'Duplicate track');
	await expect(editor.locator('[data-clip-id]')).toHaveCount(2);
	await editor.locator('[data-clip-id]').nth(1).locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
	await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.', { timeout: 20_000 });
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseTrackMenuAction(page, editor, row, ['Track channels', 'Make stereo track']);
	await expect(editor.locator('[data-clip-id]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Analyze', 'Plot spectrum');
	const dialog = page.getByRole('dialog', { name: 'Plot spectrum', exact: true });
	await expect(dialog.locator('[data-analysis-report="spectrum"]')).toContainText(/Peak frequency: 4[0-9]{2}\.\d Hz/u);
});
