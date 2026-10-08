/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('a linked Truncate Silence macro removes only the dialogue tracks shared pause', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recordings = [.3, .7].map((pause, index) => {
		const file = createWavFixture({ name: `macro-dialogue-${index}.wav`, frequency: index ? 440 : 330,
			duration: 2, channelCount: 1 });
		file.buffer.fill(0, 44 + Math.round(pause * 48_000) * 2, 44 + Math.round((pause + 1) * 48_000) * 2);
		return file;
	});
	await importFiles(editor, recordings);
	await clipByName(editor, recordings[0].name).locator('.clip-header').click();
	await clipByName(editor, recordings[1].name).locator('.clip-header').click({ modifiers: ['Shift'] });
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New macro', exact: true }).click();
	await manager.getByRole('button', { name: 'Add effect', exact: true }).click();
	await page.getByRole('menu', { name: 'Choose an effect', exact: true })
		.getByRole('menuitem', { name: 'Truncate Silence', exact: true }).click();
	await manager.getByRole('button', { name: 'Select effect', exact: true }).click();
	const settings = page.getByRole('dialog', { name: 'Truncate Silence', exact: true });
	await expect(settings.locator('[data-effect-param="independent"]').getByRole('checkbox')).not.toBeChecked();
	await settings.locator('[data-effect-param="truncateTo"] .timecode-digit').first().click();
	await page.keyboard.type('000000000');
	await page.keyboard.press('Enter');
	await settings.getByRole('button', { name: 'Close', exact: true }).click();
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(manager).toContainText('Macro applied.');
	await manager.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const after = await exportSamples(page, editor);
	expect(after.length / 48_000).toBeCloseTo(1.4, 2);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const restored = await exportSamples(page, editor);
	expect(restored.length).toBe(96_000);
});
