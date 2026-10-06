/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('Escape first cancels an active preferences-window resize', async ({ page }) => {
	const editor = await bootEditor(page, '/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	const original = await dialog.boundingBox();
	const handle = await dialog.getByRole('button', { name: 'Resize: Editor preferences', exact: true }).boundingBox();
	expect(original).not.toBeNull();
	expect(handle).not.toBeNull();
	const x = handle.x + handle.width / 2;
	const y = handle.y + handle.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x - 60, y - 40, { steps: 5 });
	await expect.poll(async () => (await dialog.boundingBox()).width).toBeLessThan(original.width - 20);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeVisible();
	await expect.poll(async () => (await dialog.boundingBox()).width).toBeCloseTo(original.width, 0);
	await page.mouse.up();
	await expect.poll(async () => (await dialog.boundingBox()).width).toBeCloseTo(original.width, 0);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
});
