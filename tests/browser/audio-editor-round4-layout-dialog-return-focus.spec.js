/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('closing Preferences after choosing Compact returns to a visible menu control', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Appearance$/u }).click();
	const layout = preferences.getByRole('button', { name: 'Layout', exact: true });
	await layout.click();
	await page.getByRole('option', { name: 'Compact (menus and track headers in drawers)', exact: true }).click();
	await expect(editor.locator('[data-chrome-layout]')).toHaveAttribute('data-chrome-layout', 'compact');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(preferences).toBeHidden();
	await test.info().attach('return-focus', { body: JSON.stringify(await page.evaluate(() => ({
		tag: document.activeElement?.tagName, role: document.activeElement?.getAttribute('role'),
		text: document.activeElement?.textContent?.slice(0, 100),
	}))), contentType: 'application/json' });
	const menu = editor.locator('[data-chrome-drawer-toggle]');
	await expect(menu).toBeFocused();
	await menu.press('Enter');
	await expect(editor.locator('[data-chrome-drawer]')).toHaveAttribute('data-open', 'true');
});
