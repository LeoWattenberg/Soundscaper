/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
async function menu(page: Page, top: string, command: string): Promise<void> { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click(); }
async function create(page: Page): Promise<void> {
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
	await page.getByLabel('Width', { exact: true }).fill('100'); await page.getByLabel('Height', { exact: true }).fill('100');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function solid(page: Page, name: string, color: string, width = 100): Promise<void> {
	await menu(page, 'Layer', 'New Solid'); await page.getByLabel('Layer name', { exact: true }).fill(name);
	await page.getByLabel('Width', { exact: true }).fill(String(width)); await page.getByLabel('Height', { exact: true }).fill('100');
	await page.getByLabel('Position X', { exact: true }).fill('0'); await page.getByLabel('Position Y', { exact: true }).fill('0'); await page.getByLabel('Fill color', { exact: true }).fill(color);
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function pixels(page: Page): Promise<number[]> {
	await menu(page, 'View', 'Composition Preview'); const canvas = page.getByRole('dialog').locator('canvas'); await expect(canvas).toHaveAttribute('data-motion-frame', '0');
	const data = await canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data));
	await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); return data;
}
async function close(page: Page): Promise<void> { await expect(page.getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); }
test('menu mask edits, registered keying and saved ordered intent change actual preview alpha', async ({ page }: { page: Page }) => {
	await create(page); await solid(page, 'Green', '#00ff00'); await menu(page, 'Layer', 'Masks and Compositing');
	const dialog = page.getByRole('dialog', { name: 'Masks and Compositing', exact: true });
	await dialog.getByLabel('Mask width', { exact: true }).fill('50'); await dialog.getByRole('button', { name: 'Add Mask', exact: true }).click(); await expect(dialog.locator('[data-motion-mask]')).toHaveCount(1);
	await close(page); const masked = await pixels(page); expect(masked[(50 * 100 + 25) * 4 + 3]).toBe(255); expect(masked[(50 * 100 + 75) * 4 + 3]).toBe(0);
	await menu(page, 'Layer', 'Masks and Compositing'); await dialog.getByRole('combobox', { name: 'Effect type', exact: true }).selectOption('chroma-key'); await dialog.getByRole('button', { name: 'Add Effect', exact: true }).click();
	await expect(dialog.locator('[data-motion-effect]')).toHaveCount(1); await close(page); expect((await pixels(page)).every((value, i) => i % 4 !== 3 || value === 0)).toBe(true);
	await menu(page, 'Layer', 'Masks and Compositing'); await dialog.getByLabel('Effect enabled', { exact: true }).uncheck(); await dialog.getByRole('button', { name: 'Apply Effect', exact: true }).click(); await close(page); expect(await pixels(page)).toEqual(masked);
	await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload(); await menu(page, 'File', 'Project Library'); await page.getByRole('button', { name: 'Untitled Composition', exact: true }).click(); expect(await pixels(page)).toEqual(masked);
	await menu(page, 'Layer', 'Masks and Compositing'); await dialog.getByLabel('Invert mask', { exact: true }).check(); await dialog.getByRole('button', { name: 'Apply Mask', exact: true }).click(); await close(page); const inverted = await pixels(page); expect(inverted[(50 * 100 + 25) * 4 + 3]).toBe(0); expect(inverted[(50 * 100 + 75) * 4 + 3]).toBe(255);
});
test('matte sources and adjustment effects render from menu-authored relationships and undo', async ({ page }: { page: Page }) => {
	await create(page); await solid(page, 'Red', '#ff0000'); await solid(page, 'Matte', '#ffffff', 50); await menu(page, 'Layer', 'Masks and Compositing');
	const dialog = page.getByRole('dialog', { name: 'Masks and Compositing', exact: true });
	await dialog.getByRole('combobox', { name: 'Layer', exact: true }).selectOption({ label: 'Red' }); await dialog.getByRole('combobox', { name: 'Matte source', exact: true }).selectOption({ label: 'Matte' });
	await dialog.getByRole('button', { name: 'Apply Compositing', exact: true }).click(); await close(page); const matte = await pixels(page); expect(matte.slice((50 * 100 + 25) * 4, (50 * 100 + 25) * 4 + 4)).toEqual([255, 0, 0, 255]); expect(matte[(50 * 100 + 75) * 4 + 3]).toBe(0);
	await menu(page, 'Layer', 'Masks and Compositing'); await dialog.getByRole('button', { name: 'Add Adjustment Layer', exact: true }).click(); await dialog.getByRole('combobox', { name: 'Effect type', exact: true }).selectOption('color-adjust'); await dialog.getByRole('button', { name: 'Add Effect', exact: true }).click();
	await dialog.getByLabel('Brightness', { exact: true }).fill('-1'); await dialog.getByRole('button', { name: 'Apply Effect', exact: true }).click(); await close(page); const black = await pixels(page); expect(black.slice((50 * 100 + 25) * 4, (50 * 100 + 25) * 4 + 4)).toEqual([0, 0, 0, 255]); expect(black[(50 * 100 + 75) * 4 + 3]).toBe(0);
	await menu(page, 'Layer', 'Masks and Compositing'); await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await close(page); expect(await pixels(page)).toEqual(matte);
});
