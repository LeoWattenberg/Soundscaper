/* SPDX-License-Identifier: AGPL-3.0-only */
import { test, expect } from '@playwright/test';
test('successor opens the real editor with its own durable owner and menu-only upgrade workflow', async ({ page }) => {
	const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
	await page.goto('/embed/en/');
	await expect(page.locator('[data-audio-editor-bound="true"]')).toBeVisible();
	await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).map(database => database.name))).toContain('kw-media-framescaper-editor-v2');
	await expect(page.locator('[data-framescaper-successor-migration]')).toHaveCount(0);
	await page.getByRole('menuitem', { name: 'File', exact: true }).click();
	await page.getByRole('menuitem', { name: /Upgrade archive for Framescaper/u }).click();
	await expect(page.locator('[data-framescaper-successor-migration]')).toBeVisible();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await page.reload(); await expect(page.locator('[data-audio-editor-bound="true"]')).toBeVisible();
	expect(errors).toEqual([]);
});
