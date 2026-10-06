/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('a mixed offline and realtime macro renders its staged audio', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const original = await exportSamples(page, editor);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill(
		"await sound.effects([{type:'audacity-amplify',params:{gainDb:0}},{type:'audacity-invert',params:{}}]);",
	);
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	await expect(manager.locator('[data-macro-script-log]')).toHaveAttribute('data-outcome', 'completed', { timeout: 10_000 });
	await manager.getByRole('button', { name: 'Close', exact: true }).click();
	const inverted = await exportSamples(page, editor);
	expect(inverted).toHaveLength(original.length);
	expect(inverted.reduce((peak, sample, index) => Math.max(peak, Math.abs(sample + original[index])), 0)).toBeLessThan(0.0001);
});
