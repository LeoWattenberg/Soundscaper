/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('Alt context clicks preserve automation points while Alt primary clicks delete them', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const row = clipByName(editor, monoTone.name).locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	await row.locator('[data-automation-insert-point]').first().press('i');
	const points = row.locator('[data-automation-point-id]');
	await expect(points).toHaveCount(2);
	await points.last().click({ modifiers: ['Alt'] });
	await expect(points).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(points).toHaveCount(2);
	const ids = await points.evaluateAll(elements => elements.map(element => element.dataset.automationPointId));
	await points.last().click({ button: 'right', modifiers: ['Alt'] });
	await page.keyboard.press('Escape');
	await expect(points).toHaveCount(2);
	expect(await points.evaluateAll(elements => elements.map(element => element.dataset.automationPointId))).toEqual(ids);
	await points.last().click({ modifiers: ['Alt'] });
	await expect(points).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(points).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(points).toHaveCount(1);
});
