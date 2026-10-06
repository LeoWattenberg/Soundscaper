/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('Escape cancels a captured automation-point drag before release', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const row = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	const overlay = row.locator('[data-track-automation-overlay]');
	await overlay.getByRole('button', { name: /^Insert automation point:/u }).press('Enter');
	const point = overlay.locator('[data-automation-point-id]').last();
	const before = await point.getAttribute('aria-valuenow');
	const bounds = await point.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width / 2 + 10, bounds.y - 25, { steps: 4 });
	await expect(point).not.toHaveAttribute('aria-valuenow', before);
	await page.keyboard.press('Escape');
	await expect(point).toHaveAttribute('aria-valuenow', before);
	await page.mouse.up();
	await expect(point).toHaveAttribute('aria-valuenow', before);
});

test('automation curve menus close when the user clicks another control', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const row = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	const overlay = row.locator('[data-track-automation-overlay]');
	const curve = overlay.getByRole('button', { name: /^Insert automation point:/u });
	await curve.press('Enter');
	await curve.press('Shift+F10');
	const menu = overlay.getByRole('menu', { name: 'Automation curve', exact: true });
	await expect(menu).toBeVisible();
	await editor.getByRole('button', { name: 'Jump to project end', exact: true }).click();
	await expect(menu).toHaveCount(0);
});
