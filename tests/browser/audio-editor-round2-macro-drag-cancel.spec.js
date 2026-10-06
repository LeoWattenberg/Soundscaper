/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

for (const cancel of [true, false]) {
test(cancel ? 'Escape cancels a native macro step drag without saving the preview order'
	: 'dropping a native macro step drag saves the preview order', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New macro', exact: true }).click();
	for (const effect of ['Invert', 'Fade In', 'Fade Out']) {
		await manager.getByRole('button', { name: 'Add effect', exact: true }).click();
		await page.getByRole('menu', { name: 'Choose an effect', exact: true }).getByRole('menuitem', { name: effect, exact: true }).click();
	}
	const names = manager.locator('.effect-slot__name-text');
	await expect(names).toHaveText(['Invert', 'Fade In', 'Fade Out']);
	const from = await manager.locator('.effect-slot__drag-handle').first().boundingBox();
	const to = await manager.locator('.effect-slot').nth(2).boundingBox();
	if (!from || !to) throw new Error('Missing macro step drag bounds');
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2, { steps: 3 });
	await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
	await page.mouse.move(to.x + to.width / 2 + 1, to.y + to.height / 2);
	await expect(manager.locator('.effect-slot--dragging')).toHaveCount(1);
	await expect.poll(async () => manager.locator('.effect-slot').nth(2).evaluate((element) => element.style.outline)).toBe('1px solid var(--accent)');
	if (cancel) await page.keyboard.press('Escape');
	await page.mouse.up();
	await expect(manager).toBeVisible();
	const expected = cancel ? ['Invert', 'Fade In', 'Fade Out'] : ['Fade In', 'Fade Out', 'Invert'];
	await expect(names).toHaveText(expected);
	await manager.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	await expect(names).toHaveText(expected);
});
}
