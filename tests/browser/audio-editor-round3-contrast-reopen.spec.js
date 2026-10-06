/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('reopening Contrast retains its captured measurements and exportable report', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Analyze', 'Contrast');
	const dialog = page.getByRole('dialog', { name: 'Contrast', exact: true });
	await dialog.getByRole('button', { name: 'Measure foreground', exact: true }).click();
	await expect(dialog.locator('[data-analysis-report="contrast"]')).toBeVisible();
	await dialog.getByRole('button', { name: 'Measure background', exact: true }).click();
	await expect(dialog.locator('[data-analysis-report="contrast"]')).toContainText('0.00 dB');
	const measurements = await dialog.locator('[data-analysis-report="contrast"]').innerText();
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Analyze', 'Contrast');
	await expect(dialog.locator('[data-analysis-report="contrast"]')).toHaveText(measurements, { useInnerText: true });
	await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
});
