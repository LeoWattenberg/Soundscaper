/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, clickClipInterior, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('moving a track automation point across a split keeps subsequent keyboard editing on that point', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const split = editor.getByRole('button', { name: 'Split tool', exact: true });
	await split.click();
	await clickClipInterior(page, clipByName(editor, monoTone.name), 0.5);
	await split.click();
	const row = clipByName(editor, monoTone.name).first().locator('xpath=ancestor::div[@data-track-row][1]');
	await expect(row.locator('[data-clip-id][role="group"]')).toHaveCount(2);
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	const overlay = row.locator('[data-track-automation-overlay]');
	await overlay.getByRole('button', { name: /^Insert automation point:/u }).first().press('Enter');
	const points = overlay.locator('[data-automation-point-id]');
	await expect(points).toHaveCount(2);
	const id = await points.last().getAttribute('data-automation-point-id');
	const point = overlay.locator(`[data-automation-point-id="${id}"]`);
	await point.focus();
	for (let step = 0; step < 4; step += 1) {
		await page.keyboard.press('Shift+ArrowRight');
		await expect(point).toBeFocused();
	}
	const before = Number(await point.getAttribute('aria-valuenow'));
	await page.keyboard.press('ArrowDown');
	await expect.poll(async () => Number(await point.getAttribute('aria-valuenow'))).toBeLessThan(before);
});
