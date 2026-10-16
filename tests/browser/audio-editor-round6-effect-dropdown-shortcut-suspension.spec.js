/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('an ordinary effect choice popup retains its window shortcut suspension', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Tremolo');
	const dialog = page.getByRole('dialog', { name: 'Tremolo', exact: true });
	const trigger = dialog.locator('[data-effect-param="waveform"] .dropdown__trigger');
	await trigger.press('Control+b');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await trigger.press('Enter');
	const menu = page.locator('.dropdown__menu');
	await expect(menu).toBeVisible();
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
	await expect(menu).toBeHidden();
	await expect(trigger).toContainText('Triangle');
	await trigger.press('Enter');
	await expect(menu).toBeVisible();
	await page.keyboard.press('Control+b');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await expect(dialog).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await expect(trigger).toBeFocused();
	await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
	await editor.getByRole('group', { name: 'Playhead', exact: true }).focus();
	await page.keyboard.press('Control+b');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
});
