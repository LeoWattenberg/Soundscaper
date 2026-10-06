/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('Ctrl+B on an automation point adds a label without changing the curve', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const row = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	const overlay = row.locator('[data-track-automation-overlay]');
	await overlay.getByRole('button', { name: /^Insert automation point:/u }).press('Enter');
	const point = overlay.locator('[data-automation-point-id]').first();
	await expect(overlay.locator('[data-automation-point-id]')).toHaveCount(2);
	await point.focus();
	await page.keyboard.press('Control+b');
	await expect(editor.locator('[data-label-id]')).toHaveCount(1);
	await expect(overlay.locator('[data-automation-bezier-control]')).toHaveCount(0);
});
