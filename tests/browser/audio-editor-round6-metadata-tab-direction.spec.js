/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { localeCopy } from './helpers/locale-copy.js';

test('Metadata section arrows follow their visible physical order in Arabic', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/ar/');
	const copy = localeCopy('ar');
	await editor.getByRole('menubar').getByRole('menuitem', { name: copy.editMenu, exact: true }).press('Enter');
	await page.getByRole('menu', { name: copy.editMenu, exact: true })
		.getByRole('menuitem', { name: copy.metadata, exact: true }).press('Enter');
	const tabs = editor.locator('.audio-editor-metadata-tabs').getByRole('tab');
	await expect(tabs).toHaveCount(4);
	const first = tabs.nth(0);
	const second = tabs.nth(1);
	const third = tabs.nth(2);
	const [firstBox, secondBox, thirdBox] = await Promise.all([
		first.boundingBox(), second.boundingBox(), third.boundingBox(),
	]);
	expect(firstBox.x).toBeGreaterThan(secondBox.x);
	expect(secondBox.x).toBeGreaterThan(thirdBox.x);
	await second.focus();
	await second.press('ArrowRight');
	await expect(first).toBeFocused();
	await expect(first).toHaveAttribute('aria-selected', 'true');
	await first.press('ArrowLeft');
	await expect(second).toBeFocused();
	await second.press('Home');
	await expect(first).toBeFocused();
	await first.press('End');
	await expect(tabs.last()).toBeFocused();
});
