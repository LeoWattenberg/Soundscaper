/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

test('a modified command leaves a native video effect slider unchanged', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('brightness-shortcut.webm')]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const row = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await row.getByRole('textbox').first().fill('Ctrl+Alt+Up');
	await row.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const properties = await openClipProperties(page, editor, editor.getByRole('group', { name: /^Video clip:/u }).first());
	const rack = properties.locator('[data-video-effect-rack]');
	await rack.getByRole('button', { name: 'Add effect', exact: true }).click();
	const effect = rack.locator('[data-video-effect-type="color-adjust"]');
	const brightness = effect.getByRole('slider', { name: 'Brightness', exact: true });
	const value = effect.locator('[data-video-effect-param="brightness"] input[type="number"]');
	await expect(value).toHaveValue('0');
	await brightness.focus(); await brightness.press('Control+Alt+ArrowUp');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await expect(brightness).toHaveValue('0');
	await expect(value).toHaveValue('0');
	await brightness.press('ArrowRight'); await brightness.press('Enter');
	await expect(value).toHaveValue('0.01');
});
