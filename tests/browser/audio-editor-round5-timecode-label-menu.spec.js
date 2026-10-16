/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('choosing a labeled time format leaves its menu closed and digits editable', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const dialog = page.getByRole('dialog', { name: 'Tone', exact: true });
	const duration = dialog.getByRole('group', { name: 'Duration (seconds)', exact: true });
	await duration.getByRole('button', { name: 'Duration (seconds): format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	await expect(page.getByRole('menuitem', { name: 'samples', exact: true })).toHaveCount(0);
	await expect(duration.locator('.timecode-digit')).toHaveCount(12);
	const last = duration.locator('.timecode-digit').last();
	await last.click();
	await expect(last).toBeFocused();
	await page.keyboard.type('1');
	await page.keyboard.press('Enter');
	await expect(duration).toBeFocused();
	await expect(duration.locator('.timecode__display')).toHaveText('000,001,440,001samples');
	await expect(dialog).toBeVisible();
});
