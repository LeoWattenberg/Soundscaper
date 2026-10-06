/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('a header-selected clip exposes its duration in Change Tempo', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await editor.locator('[data-clip-id]').first().locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Change tempo']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await expect(dialog.locator('[data-effect-param="effectAudacityCurrentLength"]')).toBeVisible();
	await expect(dialog.locator('[data-effect-param="effectAudacityNewLength"]')).toBeVisible();
	const current = dialog.getByRole('group', { name: /^Current duration/u }).last();
	const desired = dialog.getByRole('group', { name: /^Desired duration/u }).last();
	await expect(current).toContainText('800');
	await expect(desired).toContainText('800');
	await desired.focus();
	await desired.press('Enter');
	await page.keyboard.type('000000400');
	const percent = dialog.getByRole('group', { name: /^Percent change/u }).getByRole('spinbutton');
	await percent.focus();
	await expect(percent).toHaveValue('100');
	await expect(desired).toContainText('400');
});
