/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

for (const selection of ['time', 'clip']) {
	test(`Truncate Silence to zero removes a wholly silent ${selection} selection and Undo restores it`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Generate', 'Silence');
		const generator = page.getByRole('dialog', { name: 'Silence', exact: true });
		const duration = generator.getByRole('group', { name: 'Duration (seconds)', exact: true });
		await duration.locator('.timecode-digit').first().click();
		await page.keyboard.type('000001000');
		await page.keyboard.press('Enter');
		await generator.getByRole('button', { name: 'Generate', exact: true }).click();
		await expect(generator).toBeHidden();
		await expect(editor.locator('[data-clip-id]')).toHaveCount(1);
		if (selection === 'time') await chooseCommandAction(page, editor, 'Select', 'Select all');
		else await editor.locator('[data-clip-id]').first().locator('.clip-header').click();
		await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Truncate Silence']);
		const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		const truncate = effect.locator('[data-effect-param="truncateTo"]').getByRole('group');
		await truncate.locator('.timecode-digit').first().click();
		await page.keyboard.type('000000000');
		await page.keyboard.press('Enter');
		await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(effect).toBeHidden({ timeout: 20_000 });
		await expect(editor.locator('[data-clip-id]')).toHaveCount(0);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(editor.locator('[data-clip-id]')).toHaveCount(1);
	});
}
