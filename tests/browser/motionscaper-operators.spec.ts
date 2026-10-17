/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
async function menu(page: Page, top: string, command: string): Promise<void> { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click(); }
async function create(page: Page, kind: 'New Rectangle' | 'New Text'): Promise<void> {
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
	await page.getByLabel('Width', { exact: true }).fill('400'); await page.getByLabel('Height', { exact: true }).fill('200'); await page.getByLabel('Duration in frames', { exact: true }).fill('60');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await menu(page, 'Layer', kind);
	for (const [name, value] of [['Width', kind === 'New Rectangle' ? '40' : '300'], ['Height', '100'], ['Position X', '0'], ['Position Y', '0']] as const) await page.getByLabel(name, { exact: true }).fill(value);
	if (kind === 'New Text') { await page.getByLabel('Text', { exact: true }).fill('office'); await page.getByLabel('Font size', { exact: true }).fill('48'); }
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function pixels(page: Page): Promise<number[]> {
	await menu(page, 'View', 'Composition Preview'); const canvas = page.getByRole('dialog').locator('canvas'); await expect(canvas).toHaveAttribute('data-motion-frame', '0');
	const result = await canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data));
	await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); return result;
}
test('ordered shape operators and multiple paths render, undo and reopen through menus', async ({ page }: { page: Page }) => {
	await create(page, 'New Rectangle'); await menu(page, 'Layer', 'Shapes and Text Animation'); const dialog = page.getByRole('dialog', { name: 'Shapes and Text Animation', exact: true });
	await dialog.getByRole('combobox', { name: 'Operator type', exact: true }).selectOption('repeater'); await dialog.getByRole('button', { name: 'Add Operator', exact: true }).click();
	await expect(dialog.locator('[data-motion-operator]')).toHaveCount(1);
	await dialog.getByLabel('Copies', { exact: true }).fill('2'); await dialog.getByRole('button', { name: 'Apply Operator', exact: true }).click();
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	const repeated = await pixels(page); expect(repeated[(10 * 400 + 110) * 4 + 3]).toBe(255); expect(repeated[(10 * 400 + 210) * 4 + 3]).toBe(0);
	await menu(page, 'Layer', 'Shapes and Text Animation');
	await dialog.getByRole('button', { name: 'Remove Operator', exact: true }).click();
	await dialog.getByLabel('Shape X', { exact: true }).fill('20'); await dialog.getByLabel('Shape width', { exact: true }).fill('40'); await dialog.getByLabel('Shape height', { exact: true }).fill('100');
	await dialog.getByRole('button', { name: 'Add Shape', exact: true }).click(); await expect(dialog.locator('[data-motion-shape]')).toHaveCount(2);
	await dialog.getByRole('combobox', { name: 'Operator type', exact: true }).selectOption('boolean'); await dialog.getByRole('button', { name: 'Add Operator', exact: true }).click();
	await dialog.getByRole('combobox', { name: 'Boolean operation', exact: true }).selectOption('subtract'); await dialog.getByRole('button', { name: 'Apply Operator', exact: true }).click();
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click(); const subtracted = await pixels(page);
	expect(subtracted[(10 * 400 + 10) * 4 + 3]).toBe(255); expect(subtracted[(10 * 400 + 30) * 4 + 3]).toBe(0);
	await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload(); await menu(page, 'File', 'Project Library');
	await page.getByRole('button', { name: 'Untitled Composition', exact: true }).click(); expect(await pixels(page)).toEqual(subtracted);
	await menu(page, 'Layer', 'Shapes and Text Animation'); await dialog.getByRole('button', { name: 'Remove Operator', exact: true }).click(); await expect(dialog.locator('[data-motion-operator]')).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(dialog.locator('[data-motion-operator]')).toHaveCount(1);
});
test('text animator selection changes actual shaped coverage and its edit is undoable', async ({ page }: { page: Page }) => {
	await create(page, 'New Text'); const before = await pixels(page); expect(before.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
	await menu(page, 'Layer', 'Shapes and Text Animation'); const dialog = page.getByRole('dialog', { name: 'Shapes and Text Animation', exact: true });
	await dialog.getByRole('button', { name: 'Add Animator', exact: true }).click(); await dialog.getByRole('combobox', { name: 'Selection unit', exact: true }).selectOption('word');
	await dialog.getByLabel('Animator opacity', { exact: true }).fill('0'); await dialog.getByRole('button', { name: 'Apply Animator', exact: true }).click();
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click(); expect((await pixels(page)).every((value, index) => index % 4 !== 3 || value === 0)).toBe(true);
	await menu(page, 'Layer', 'Shapes and Text Animation'); await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click(); expect(await pixels(page)).toEqual(before);
});
