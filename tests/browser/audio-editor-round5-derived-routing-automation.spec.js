/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('Duplicate track preserves automation on its output connection', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	const row = clip.locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	const controls = row.locator('[data-track-automation-controls]');
	await controls.getByRole('combobox', { name: 'Automation parameter', exact: true })
		.selectOption({ label: 'Master assignment' });
	const points = row.locator('[data-automation-point-id]');
	await row.getByRole('button', { name: /^Insert automation point:/u }).press('Enter');
	await expect(points).toHaveCount(2);
	for (let index = 0; index < 2; index += 1) await points.nth(index).press('ArrowDown');
	const values = await points.evaluateAll(elements => elements.map(element => element.getAttribute('aria-valuenow')));
	expect(values).not.toContain('1');
	const rows = editor.locator('[data-track-row]');
	const originalCount = await rows.count();
	await chooseTrackMenuAction(page, editor, row, 'Duplicate track');
	await expect(rows).toHaveCount(originalCount + 1);
	const copied = rows.last();
	await chooseTrackMenuAction(page, editor, copied, 'Add automation');
	await copied.getByRole('combobox', { name: 'Automation parameter', exact: true })
		.selectOption({ label: 'Master assignment' });
	const copiedPoints = copied.locator('[data-automation-point-id]');
	await expect(copiedPoints).toHaveCount(2);
	expect(await copiedPoints.evaluateAll(elements => elements.map(element => element.getAttribute('aria-valuenow')))).toEqual(values);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(rows).toHaveCount(originalCount);
	await expect(points).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(rows).toHaveCount(originalCount + 1);
	await chooseTrackMenuAction(page, editor, copied, 'Add automation');
	await copied.getByRole('combobox', { name: 'Automation parameter', exact: true })
		.selectOption({ label: 'Master assignment' });
	await expect(copiedPoints).toHaveCount(2);
});
