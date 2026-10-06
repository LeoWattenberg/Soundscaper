/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, showToolbarButton } from './audio-editor-test-helpers.js';

test('Undo restores the sequence name in the open Project properties panel', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	const panel = editor.locator('[data-workspace-panel="metadata"]');
	await panel.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
	const name = panel.getByRole('textbox', { name: 'Sequence name', exact: true });
	const original = await name.inputValue();
	await name.fill('Changed sequence');
	await name.press('Tab');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(name).toHaveValue(original);
});

async function openSnapMenu(page) {
	const editor = await bootEditor(page, '/embed/en/');
	await showToolbarButton(page, editor, 'Snap');
	const snap = editor.getByRole('checkbox', { name: 'Snap', exact: true });
	if (await snap.getAttribute('aria-checked') !== 'true') await snap.click();
	const interval = editor.getByRole('button', { name: /^Snap interval:/u });
	await interval.click();
	return page.getByRole('menuitem', { name: /^Seconds and samples/u });
}

test('ArrowRight enters a snap submenu that the pointer has already opened', async ({ page }) => {
	const parent = await openSnapMenu(page);
	await parent.click();
	await parent.press('ArrowRight');
	await expect(page.getByRole('menuitem', { name: 'Seconds', exact: true })).toBeFocused();
});

test('Escape from a snap submenu returns to its parent without dismissing the menu', async ({ page }) => {
	const parent = await openSnapMenu(page);
	await parent.press('ArrowRight');
	const seconds = page.getByRole('menuitem', { name: 'Seconds', exact: true });
	await expect(seconds).toBeFocused();
	await seconds.press('Escape');
	await expect(parent).toBeVisible();
	await expect(parent).toBeFocused();
	await parent.press('Escape');
	await expect(parent).toBeHidden();
});
