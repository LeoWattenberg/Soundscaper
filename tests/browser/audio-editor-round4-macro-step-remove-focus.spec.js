/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('keyboard removal of macro steps preserves continued step authoring', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New macro', exact: true }).click();
	for (const effect of ['Invert', 'Fade In']) {
		await manager.getByRole('button', { name: 'Add effect', exact: true }).click();
		await page.getByRole('menu', { name: 'Choose an effect', exact: true }).getByRole('menuitem', { name: effect, exact: true }).click();
	}
	const slots = manager.locator('.effect-slot');
	await expect(slots).toHaveCount(2);
	const actions = slots.first().getByRole('button', { name: 'Effect settings', exact: true });
	await actions.focus();
	await actions.press('Enter');
	await page.getByRole('menuitem', { name: 'Remove effect', exact: true }).press('Enter');
	await expect(slots).toHaveCount(1);
	await expect(slots.first()).toBeFocused();
	await slots.first().press('Enter');
	await expect(slots.first().locator('.effect-slot__drag-handle')).toBeFocused();
	await slots.first().getByRole('button', { name: 'Effect settings', exact: true }).focus();
	await slots.first().getByRole('button', { name: 'Effect settings', exact: true }).press('Enter');
	await page.getByRole('menuitem', { name: 'Remove effect', exact: true }).press('Enter');
	await expect(slots).toHaveCount(0);
	const add = manager.getByRole('button', { name: 'Add effect', exact: true });
	await expect(add).toBeFocused();
	await add.press('Enter');
	await expect(page.getByRole('menu', { name: 'Choose an effect', exact: true })).toBeVisible();
});
