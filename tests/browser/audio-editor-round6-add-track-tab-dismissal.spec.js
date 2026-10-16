/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

for (const key of ['Tab', 'Shift+Tab']) test(`Add track ${key} dismissal resumes navigation from its trigger`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const add = editor.getByRole('button', { name: 'Add track', exact: true });
	await add.focus();
	await page.keyboard.press(key);
	const expectedTarget = await page.evaluate(() => ({ label: document.activeElement?.getAttribute('aria-label'), text: document.activeElement?.textContent, tag: document.activeElement?.tagName }));
	await add.focus();
	await page.keyboard.press('Enter');
	const menu = page.locator('.add-track-flyout');
	await expect(menu.getByRole('menuitem', { name: 'Audio track', exact: true })).toBeFocused();
	await page.keyboard.press(key);
	await expect(menu).toBeHidden();
	await expect.poll(() => page.evaluate(() => ({ label: document.activeElement?.getAttribute('aria-label'), text: document.activeElement?.textContent, tag: document.activeElement?.tagName }))).toEqual(expectedTarget);
});
