/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

for (const key of ['Enter', 'Escape']) {
	test(`output bus rename ${key} keeps native keyboard continuation`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		for (let index = 0; index < 2; index += 1) {
			await editor.getByRole('button', { name: 'Add track', exact: true }).click();
			await page.locator('.add-track-flyout').getByRole('menuitem', { name: 'Send track', exact: true }).click();
		}
		const rows = editor.locator('[data-output-track-row][data-output-scope="send"]');
		await expect(rows).toHaveCount(2);
		const row = rows.first();
		const name = row.locator('.track-control-panel__track-name-text');
		const panel = row.locator('.track-control-panel');
		const original = await name.innerText();
		await name.dblclick();
		const input = row.getByRole('textbox');
		await expect(input).toBeFocused();
		await input.fill('Keyboard return');
		await input.press(key);
		await expect(input).toHaveCount(0);
		await expect(name).toHaveText(key === 'Enter' ? 'Keyboard return' : original);
		await expect(panel).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(rows.nth(1).locator('.track-control-panel')).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(panel).toBeFocused();
		if (key === 'Enter') {
			await chooseCommandAction(page, editor, 'Edit', 'Undo');
			await expect(name).toHaveText(original);
			await chooseCommandAction(page, editor, 'Edit', 'Redo');
			await expect(name).toHaveText('Keyboard return');
		}
	});
}
