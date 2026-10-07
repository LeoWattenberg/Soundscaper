/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('deleting a focused timeline label keeps editing on a surviving label', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	for (const name of ['First label', 'Second label']) {
		await page.keyboard.press('Control+b');
		const field = editor.getByRole('textbox', { name: /^Edit labels:/u });
		await field.fill(name);
		await field.press('Enter');
	}
	const first = editor.getByRole('group', { name: 'Edit labels: First label', exact: true });
	const second = editor.getByRole('group', { name: 'Edit labels: Second label', exact: true });
	await expect(first).toBeVisible();
	await expect(second).toBeFocused();
	await page.keyboard.press('Delete');
	await expect(second).toHaveCount(0);
	await expect(first).toBeFocused();
	await page.keyboard.press('F2');
	await expect(editor.getByRole('textbox', { name: 'Edit labels: First label', exact: true })).toBeFocused();
});
