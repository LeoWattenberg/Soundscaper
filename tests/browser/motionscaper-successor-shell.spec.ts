/* SPDX-License-Identifier: AGPL-3.0-only */
import { test, expect } from './helpers/motionscaper-linked-fixture.js';
test('successor opens the real editor with its own durable owner and menu-only upgrade workflow', async ({ page }) => {
	const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
	await page.goto('/embed/en/');
	await expect(page.locator('[data-audio-editor-bound="true"]')).toBeVisible();
	await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).map(database => database.name))).toContain('kw-media-framescaper-editor-v2');
	await expect(page.locator('[data-framescaper-successor-migration]')).toHaveCount(0);
	await page.getByRole('menuitem', { name: 'File', exact: true }).click();
	await page.getByRole('menuitem', { name: /Upgrade archive for Framescaper/u }).click();
	await expect(page.locator('[data-framescaper-successor-migration]')).toBeVisible();
	await page.locator('dialog[data-framescaper-successor-migration]').getByRole('button', { name: 'Close', exact: true }).click();
	await page.reload(); await expect(page.locator('[data-audio-editor-bound="true"]')).toBeVisible();
	expect(errors).toEqual([]);
});

test('saved-revision pairing is menu opened, survives dialog close, and can be disconnected', async ({ page }) => {
	await page.goto('/embed/en/'); await expect(page.locator('[data-audio-editor-bound="true"]')).toBeVisible();
	await expect(page.locator('[data-framescaper-composition-links]')).toHaveCount(0);
	await page.getByRole('menuitem', { name: 'File', exact: true }).click(); await page.getByRole('menuitem', { name: 'Linked compositions…', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Linked Motionscaper compositions' }); await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Create pairing URL', exact: true }).click();
	const url = dialog.getByRole('textbox', { name: 'Pairing URL', exact: true }); await expect(url).toHaveValue(/\/composition-link\/receive\/#cap=[a-f0-9]{64}$/u);
	const pairing = await url.inputValue(); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
	await page.getByRole('menuitem', { name: 'File', exact: true }).click(); await page.getByRole('menuitem', { name: 'Linked compositions…', exact: true }).click();
	await expect(dialog.getByRole('textbox', { name: 'Pairing URL', exact: true })).toHaveValue(pairing);
	await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click(); await expect(dialog.getByRole('textbox', { name: 'Pairing URL', exact: true })).toHaveCount(0);
});
