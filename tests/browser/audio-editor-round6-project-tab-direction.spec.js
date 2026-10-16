/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { localeCopy } from './helpers/locale-copy.js';

test('Project tab arrows follow their visible physical order in Arabic', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/ar/');
	const copy = localeCopy('ar');
	for (let index = 0; index < 2; index++) {
		await editor.getByRole('button', { name: copy.newProject, exact: true }).click();
		await waitForProjectActivation(editor);
	}
	await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
	const tabs = editor.locator('.kw-audio-editor__project-tab-strip').getByRole('tab');
	await expect(tabs).toHaveCount(3);
	const [first, second, third] = [tabs.nth(0), tabs.nth(1), tabs.nth(2)];
	const [firstBox, secondBox, thirdBox] = await Promise.all([first.boundingBox(), second.boundingBox(), third.boundingBox()]);
	expect(firstBox.x).toBeGreaterThan(secondBox.x);
	expect(secondBox.x).toBeGreaterThan(thirdBox.x);
	await second.click();
	await waitForProjectActivation(editor);
	await second.press('Home');
	await expect(first).toHaveAttribute('aria-selected', 'true');
	await waitForProjectActivation(editor);
	await first.press('End');
	await expect(third).toHaveAttribute('aria-selected', 'true');
	await waitForProjectActivation(editor);
	await second.click();
	await waitForProjectActivation(editor);
	await second.press('ArrowRight');
	await expect(first).toHaveAttribute('aria-selected', 'true');
	await waitForProjectActivation(editor);
	await expect(first).toBeFocused();
	await first.press('ArrowLeft');
	await expect(second).toHaveAttribute('aria-selected', 'true');
	await waitForProjectActivation(editor);
	await expect(second).toBeFocused();
});
