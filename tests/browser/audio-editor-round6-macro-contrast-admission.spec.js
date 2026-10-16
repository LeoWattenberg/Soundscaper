/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('a program refuses the interactive Contrast command before admitting it as a bare analysis', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const palette = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await palette.getByRole('button', { name: 'New program', exact: true }).click();
	await palette.getByRole('textbox', { name: 'Program', exact: true }).fill([
		"try { await sound.command('ContrastAnalyser'); }",
		"catch (error) { sound.log.info(error.message); }",
	].join('\n'));
	await palette.getByRole('button', { name: 'Run program', exact: true }).click();
	const log = palette.locator('[data-macro-script-log]');
	await expect(log).toHaveAttribute('data-outcome', 'completed');
	await expect(log).toContainText(/cannot run.*ContrastAnalyser/u);
	await palette.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Analyze', 'Contrast');
	const contrast = page.getByRole('dialog', { name: 'Contrast', exact: true });
	await contrast.getByRole('button', { name: 'Measure foreground', exact: true }).click();
	await expect(contrast.locator('[data-analysis-report="contrast"]')).toBeVisible();
	await contrast.getByRole('button', { name: 'Measure background', exact: true }).click();
	await expect(contrast.locator('[data-analysis-report="contrast"]')).toContainText('0.00 dB');
});
