/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clickClipInterior, clipByName,
	disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { addClipGainPoint } from './helpers/complex-editing-workflows.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Join preserves the independent clip envelopes on both sides of a split', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('checkbox', { name: 'Apply 2 ms fades to new clips', exact: true }).uncheck();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await importFiles(editor, [monoTone]);
	const original = clipByName(editor, monoTone.name);
	const split = editor.getByRole('button', { name: 'Split tool', exact: true });
	await split.click();
	await clickClipInterior(page, original, 0.5);
	await split.click();
	const parts = editor.locator('[data-clip-id]');
	await expect(parts).toHaveCount(2);
	await addClipGainPoint(page, editor, parts.first(), 0.5);
	const point = parts.first().locator('.envelope-point').first();
	const box = await point.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 20, { steps: 4 });
	await page.mouse.up();
	await editor.getByRole('button', { name: 'Clip gain', exact: true }).click();
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const before = await exportSamples(page, editor);
	await parts.nth(0).press('Enter');
	await parts.nth(1).press('Shift+Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Join']);
	await expect(parts).toHaveCount(1);
	const after = await exportSamples(page, editor);
	expect(after).toHaveLength(before.length);
	const difference = after.reduce((maximum, sample, index) => Math.max(maximum, Math.abs(sample - before[index])), 0);
	expect(difference).toBeLessThan(0.00001);
});
