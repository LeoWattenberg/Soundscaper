/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

async function runProgram(page, editor, source) {
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill(source);
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	await expect(manager.locator('[data-macro-script-log]')).toHaveAttribute('data-outcome', 'completed', { timeout: 30_000 });
	await manager.getByRole('button', { name: 'Close', exact: true }).click();
}

test('a macro applies its effect to every audio track selected by Select all', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	const before = await exportSamples(page, editor);
	await runProgram(page, editor, "await sound.select.all(); await sound.effect('audacity-invert');");
	const after = await exportSamples(page, editor);
	expect(after).toHaveLength(before.length);
	const residual = after.reduce((peak, sample, index) => Math.max(peak, Math.abs(sample + before[index])), 0);
	expect(residual).toBeLessThan(0.0001);
});

test('two awaited concurrent macro effects cannot silently discard one request', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const before = await exportSamples(page, editor);
	await runProgram(page, editor, "await sound.select.all(); await Promise.all([sound.effect('audacity-invert'), sound.effect('audacity-invert')]);");
	const after = await exportSamples(page, editor);
	const residual = after.reduce((peak, sample, index) => Math.max(peak, Math.abs(sample - before[index])), 0);
	expect(residual).toBeLessThan(0.0001);
});
