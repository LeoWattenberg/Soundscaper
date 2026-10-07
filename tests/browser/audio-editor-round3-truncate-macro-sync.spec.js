/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('an independent-track Truncate Silence macro preserves its stereo channel clock', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'stereo-dialogue.wav', frequency: 440, duration: 2 });
	for (let channel = 0; channel < 2; channel++) {
		const start = channel ? 33_600 : 14_400;
		for (let frame = start; frame < start + 48_000; frame++) recording.buffer.writeInt16LE(0, 44 + (frame * 2 + channel) * 2);
	}
	await importFiles(editor, [recording]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New macro', exact: true }).click();
	await manager.getByRole('button', { name: 'Add effect', exact: true }).click();
	await page.getByRole('menu', { name: 'Choose an effect', exact: true }).getByRole('menuitem', { name: 'Truncate Silence', exact: true }).click();
	await manager.getByRole('button', { name: 'Select effect', exact: true }).click();
	const settings = page.getByRole('dialog', { name: 'Truncate Silence', exact: true });
	await settings.locator('[data-effect-param="independent"]').getByRole('checkbox').check();
	await settings.locator('[data-effect-param="truncateTo"] .timecode-digit').first().click();
	await page.keyboard.type('000000000');
	await page.keyboard.press('Enter');
	await settings.getByRole('button', { name: 'Close', exact: true }).click();
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(manager).toContainText('Macro applied.');
	await manager.getByRole('button', { name: 'Close', exact: true }).click();
	const rendered = await exportSamples(page, editor);
	expect(rendered.length / 48_000).toBeCloseTo(1.4, 2);
});
