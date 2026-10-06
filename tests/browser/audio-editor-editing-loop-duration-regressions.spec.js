/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openClipProperties, clipField, chooseCommandAction,
	chooseNestedCommandAction, clickClipInterior } from './audio-editor-test-helpers.js';

test('the duration field changes a looped clip total length without stretching its period', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const clip = clipByName(editor, monoTone.name);
	await clip.locator('.clip-header').click();
	await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	const properties = await openClipProperties(page, editor, clip);
	await properties.getByText('Media settings', { exact: true }).click();
	await clipField(properties, 'durationFrame').fill('57600');
	await clipField(properties, 'durationFrame').press('Tab');
	await expect(clip).toHaveAccessibleName(/1\.2 seconds long$/u);
	await expect(clip.locator('[data-loop-boundary-frame]')).toHaveAttribute('data-loop-boundary-frame', '38400');
});

test('Join can restore a looped clip after a split within its first repetition', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('checkbox', { name: 'Apply 2 ms fades to new clips', exact: true }).uncheck();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await importFiles(editor, [monoTone]);
	const clip = clipByName(editor, monoTone.name);
	await clip.locator('.clip-header').click();
	await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	const split = editor.getByRole('button', { name: 'Split tool', exact: true });
	await split.click();
	await clickClipInterior(page, clip, 0.25);
	await split.click();
	const parts = editor.locator('[data-clip-id]');
	await expect(parts).toHaveCount(2);
	await parts.nth(0).press('Enter');
	await parts.nth(1).press('Shift+Enter');
	await expect(parts.locator('.clip-display[data-selected="true"]')).toHaveCount(2);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Join']);
	await expect(parts).toHaveCount(1);
	await expect(parts).toHaveAccessibleName(/1\.6 seconds long$/u);
	await expect(parts.locator('[data-loop-boundary-frame]')).toHaveAttribute('data-loop-boundary-frame', '38400');
});
