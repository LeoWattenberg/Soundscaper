/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('a single range macro Invert preserves the level at existing clip fades', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const before = await exportSamples(page, editor);
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill("await sound.select.all(); await sound.effect('audacity-invert');");
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	await expect(manager.locator('[data-macro-script-log]')).toHaveAttribute('data-outcome', 'completed', { timeout: 30_000 });
	await manager.getByRole('button', { name: 'Close', exact: true }).click();
	const after = await exportSamples(page, editor);
	const residual = after.reduce((peak, sample, index) => Math.max(peak, Math.abs(sample + before[index])), 0);
	expect(residual).toBeLessThan(0.0001);
});
