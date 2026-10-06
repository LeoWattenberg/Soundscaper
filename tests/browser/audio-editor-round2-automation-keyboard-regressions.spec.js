/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('deleting an automation point keeps keyboard editing on a surviving point', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const row = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	const overlay = row.locator('[data-track-automation-overlay]');
	await overlay.getByRole('button', { name: /^Insert automation point:/u }).press('Enter');
	const points = overlay.locator('[data-automation-point-id]');
	await expect(points).toHaveCount(2);
	await points.last().focus();
	await page.keyboard.press('Delete');
	await expect(points).toHaveCount(1);
	await expect(points.first()).toBeFocused();
	const value = Number(await points.first().getAttribute('aria-valuenow'));
	await page.keyboard.press('ArrowDown');
	await expect.poll(async () => Number(await points.first().getAttribute('aria-valuenow'))).toBeLessThan(value);
	await page.keyboard.press('Shift+Delete');
	await expect(points).toHaveCount(0);
	await expect(overlay.getByRole('button', { name: /^Insert automation point:/u })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(points).toHaveCount(2);
});
