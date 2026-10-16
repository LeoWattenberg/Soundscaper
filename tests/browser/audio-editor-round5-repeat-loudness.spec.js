/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('Repeat last analyzer repeats the most recent loudness measurement', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Analyze', 'Measure loudness');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	await expect(report).toBeVisible({ timeout: 20_000 });
	await expect(report.locator('[data-delivery-report]')).toContainText('loudness-measurement');
	await report.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' }).click();
	await expect(report).toBeHidden();
	await editor.getByRole('menubar').getByRole('menuitem', { name: 'Analyze', exact: true }).focus();
	await page.keyboard.press('Enter');
	const repeat = page.getByRole('menuitem', { name: /^Repeat last analyzer(?:\s|$)/u });
	await expect(repeat).toBeEnabled();
	await repeat.click();
	await expect(report).toBeVisible({ timeout: 20_000 });
	await expect(report.locator('[data-delivery-report]')).toContainText('loudness-measurement');
	await expect(editor.locator('[data-status]')).toHaveText('Loudness measured');
});
