/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('program name composition does not prematurely publish the unfinished name', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	const name = manager.getByRole('textbox', { name: 'Program name', exact: true });
	const library = manager.locator('.audio-editor-macros-palette__library');
	await name.fill('とう');
	await expect(library).not.toContainText('とう');
	const prevented = await name.evaluate(input => {
		const event = new KeyboardEvent('keydown', {
			key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true,
		});
		input.dispatchEvent(event);
		return event.defaultPrevented;
	});
	await expect(library).not.toContainText('とう');
	expect(prevented).toBe(false);
	await expect(name).toBeFocused();
	await name.fill('東京の作業');
	await name.press('Enter');
	await expect(library).toContainText('東京の作業');
	await expect(name).toBeFocused();
	await name.press('Tab');
	await expect(manager.getByRole('textbox', { name: 'Program', exact: true })).toBeFocused();
});
