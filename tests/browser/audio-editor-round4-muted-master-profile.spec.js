/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction,
	disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('master Noise Reduction profiles its rack input while the master listening strip is muted', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	const master = mixer.locator('.kw-audio-editor__mixer-channel--master');
	await master.getByRole('button', { name: 'Mute', exact: true }).click();
	await master.getByRole('button', { name: 'Select effect', exact: true }).first().click();
	await addRackEffect(page, editor.locator('[data-workspace-panel="effects"]'), 'master', 'Noise Reduction');
	const dialog = page.locator('[data-effects-window-host]').last()
		.getByRole('dialog', { name: 'Noise Reduction', exact: true });
	await dialog.getByRole('button', { name: 'Get noise profile', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Replace noise profile', exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await master.getByRole('button', { name: 'Mute', exact: true }).click();
	const samples = await exportSamples(page, editor);
	const steady = samples.slice(12_000, 24_000);
	const peak = Math.max(...steady.map(sample => Math.abs(sample)));
	expect(peak).toBeGreaterThan(0.08);
	expect(peak).toBeLessThan(0.16);
});
