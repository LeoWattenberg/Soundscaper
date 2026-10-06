/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, clipByName, closeDialog, closeEffectsPanel,
	importFiles, openEffectsForTrack,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('stereo split preserves the effect parameter curves on both copied processors', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	const originalRow = clip.locator('xpath=ancestor::div[@data-track-row][1]');
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Resonant low-pass filter');
	await closeDialog(page.getByRole('dialog', { name: 'Resonant low-pass filter', exact: true }));
	await closeEffectsPanel(panel);
	await chooseTrackMenuAction(page, editor, originalRow, 'Add automation');
	await originalRow.getByRole('button', { name: /^Insert automation point:/u }).press('Enter');
	await expect(originalRow.locator('[data-automation-point-id]')).toHaveCount(2);
	await originalRow.getByRole('combobox', { name: 'Automation parameter', exact: true }).selectOption({ label: 'Frequency' });
	await originalRow.getByRole('button', { name: /^Insert automation point:/u }).press('Enter');
	const points = originalRow.locator('[data-automation-point-id]');
	await expect(points).toHaveCount(2);
	await points.first().press('Shift+ArrowDown');
	const firstValue = await points.first().getAttribute('aria-valuenow');
	await chooseTrackMenuAction(page, editor, originalRow, ['Track channels', 'Split stereo to left/right mono']);
	const rows = editor.locator('[data-track-row]');
	await expect(rows).toHaveCount(3);
	for (const index of [1, 2]) {
		const row = rows.nth(index);
		if (!await row.getByRole('combobox', { name: 'Automation parameter', exact: true }).count()) {
			await chooseTrackMenuAction(page, editor, row, 'Add automation');
		}
		await row.getByRole('combobox', { name: 'Automation parameter', exact: true }).selectOption({ label: 'Volume' });
		await expect(row.locator('[data-automation-point-id]')).toHaveCount(2);
		await row.getByRole('combobox', { name: 'Automation parameter', exact: true }).selectOption({ label: 'Frequency' });
		await expect(row.locator('[data-automation-point-id]')).toHaveCount(2);
		await expect(row.locator('[data-automation-point-id]').first()).toHaveAttribute('aria-valuenow', firstValue);
	}
});
