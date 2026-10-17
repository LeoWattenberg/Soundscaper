/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
async function menu(page: Page, top: string, item: string): Promise<void> { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: true }).click(); }
async function close(page: Page): Promise<void> { await page.getByRole('button', { name: 'Close', exact: true }).last().click(); await expect(page.getByRole('dialog')).toHaveCount(0); }
async function create(page: Page, kind: 'New Text' | 'New Rectangle'): Promise<void> {
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
	for (const [label, value] of [['Width', '200'], ['Height', '100'], ['Duration in frames', '60']] as const) await page.getByLabel(label, { exact: true }).fill(value);
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await menu(page, 'Layer', kind);
	for (const [label, value] of [['Width', '180'], ['Height', '80'], ['Position X', '10'], ['Position Y', '10']] as const) await page.getByLabel(label, { exact: true }).fill(value);
	if (kind === 'New Text') { await page.getByRole('textbox', { name: 'Text', exact: true }).fill('office'); await page.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('32'); }
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByRole('combobox', { name: 'Font face', exact: true })).toHaveCount(0); await expect(page.getByRole('combobox', { name: 'Fill type', exact: true })).toHaveCount(0);
}
async function pixels(page: Page): Promise<number[]> {
	await menu(page, 'View', 'Composition Preview'); const canvas = page.getByRole('dialog').locator('canvas'); await expect(canvas).toHaveAttribute('data-motion-frame', '0');
	const result = await canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data)); await close(page); return result;
}
async function saveReopen(page: Page): Promise<void> {
	await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload(); await menu(page, 'File', 'Project Library'); await page.getByRole('button', { name: 'Untitled Composition', exact: true }).click();
}
test('menu text style, retained font, layout and runs render and survive undo and reopen', async ({ page }: { page: Page }) => {
	await create(page, 'New Text'); const before = await pixels(page); await menu(page, 'Layer', 'Text and Appearance');
	const dialog = page.getByRole('dialog', { name: 'Text and Appearance', exact: true });
	await dialog.getByRole('textbox', { name: 'Text', exact: true }).fill('motion'); await dialog.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('40'); await dialog.getByRole('spinbutton', { name: 'Character spacing', exact: true }).fill('1');
	await dialog.getByRole('textbox', { name: 'Fill color', exact: true }).fill('#ff0000'); await dialog.getByRole('textbox', { name: 'Font style name', exact: true }).fill('Bold');
	await dialog.getByLabel('Import Font Face', { exact: true }).setInputFiles(resolve('node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2'));
	await expect(dialog.getByRole('combobox', { name: 'Font face', exact: true }).locator('option:checked')).toContainText('Bold'); await expect(dialog.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('motion'); await close(page);
	const bold = await pixels(page); expect(bold).not.toEqual(before); expect(bold.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
	expect(bold.every((value, index) => index % 4 !== 1 && index % 4 !== 2 || value === 0)).toBe(true);
	await menu(page, 'Layer', 'Text and Appearance'); await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await close(page); expect(await pixels(page)).toEqual(before);
	await menu(page, 'Layer', 'Text and Appearance'); await dialog.getByRole('button', { name: 'Redo', exact: true }).click();
	await dialog.getByRole('combobox', { name: 'Alignment', exact: true }).selectOption('center'); await dialog.getByRole('spinbutton', { name: 'Line height', exact: true }).fill('1.5'); await dialog.getByRole('button', { name: 'Apply Text Layout', exact: true }).click();
	await dialog.getByRole('button', { name: 'Add Text Run', exact: true }).click(); await dialog.getByRole('textbox', { name: 'Text', exact: true }).fill('!'); await dialog.getByRole('button', { name: 'Apply Text Style', exact: true }).click();
	await expect(dialog.getByRole('combobox', { name: 'Text run', exact: true }).locator('option')).toHaveCount(2); await close(page); const final = await pixels(page); expect(final).not.toEqual(bold);
	await saveReopen(page); expect(await pixels(page)).toEqual(final); await menu(page, 'Layer', 'Text and Appearance');
	await expect(dialog.getByRole('combobox', { name: 'Font face', exact: true }).locator('option:checked')).toContainText('Bold'); await expect(dialog.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('motion');
	await expect(dialog.getByRole('combobox', { name: 'Text run', exact: true }).locator('option')).toHaveCount(2); await expect(dialog.getByRole('combobox', { name: 'Alignment', exact: true })).toHaveValue('center'); await expect(dialog.getByRole('spinbutton', { name: 'Line height', exact: true })).toHaveValue('1.5');
});
test('menu gradients and strokes change actual pixels and retain appearance on reopen', async ({ page }: { page: Page }) => {
	await create(page, 'New Rectangle'); await menu(page, 'Layer', 'Text and Appearance'); const dialog = page.getByRole('dialog', { name: 'Text and Appearance', exact: true });
	await dialog.getByRole('combobox', { name: 'Fill type', exact: true }).selectOption('linear-gradient'); await dialog.getByRole('spinbutton', { name: 'Gradient end X', exact: true }).fill('180');
	await dialog.getByRole('group', { name: 'Gradient stop 1', exact: true }).getByRole('textbox', { name: 'Fill color', exact: true }).fill('#ff0000');
	await dialog.getByRole('group', { name: 'Gradient stop 2', exact: true }).getByRole('textbox', { name: 'Fill color', exact: true }).fill('#0000ff'); await dialog.getByRole('button', { name: 'Apply Fill', exact: true }).click();
	await dialog.getByLabel('Draw stroke', { exact: true }).check(); const stroke = dialog.getByRole('group', { name: 'Stroke', exact: true });
	await stroke.getByRole('textbox', { name: 'Fill color', exact: true }).fill('#00ff00'); await stroke.getByRole('spinbutton', { name: 'Stroke width', exact: true }).fill('4'); await stroke.getByRole('combobox', { name: 'Line join', exact: true }).selectOption('round'); await stroke.getByRole('button', { name: 'Apply Stroke', exact: true }).click(); await close(page);
	const gradient = await pixels(page); const left = gradient.slice((50 * 200 + 20) * 4, (50 * 200 + 20) * 4 + 4), right = gradient.slice((50 * 200 + 180) * 4, (50 * 200 + 180) * 4 + 4);
	expect(left[0]).toBeGreaterThan(left[2]!); expect(right[2]).toBeGreaterThan(right[0]!); expect(gradient.slice((50 * 200 + 10) * 4, (50 * 200 + 10) * 4 + 4)).toEqual([0, 255, 0, 255]);
	await saveReopen(page); expect(await pixels(page)).toEqual(gradient); await menu(page, 'Layer', 'Text and Appearance');
	await expect(dialog.getByRole('combobox', { name: 'Fill type', exact: true })).toHaveValue('linear-gradient'); await expect(dialog.getByRole('spinbutton', { name: 'Stroke width', exact: true })).toHaveValue('4');
	await dialog.getByRole('combobox', { name: 'Fill type', exact: true }).selectOption('radial-gradient'); await dialog.getByRole('spinbutton', { name: 'Gradient center X', exact: true }).fill('90'); await dialog.getByRole('spinbutton', { name: 'Gradient center Y', exact: true }).fill('40'); await dialog.getByRole('spinbutton', { name: 'Gradient radius', exact: true }).fill('40'); await dialog.getByRole('button', { name: 'Apply Fill', exact: true }).click(); await close(page); const radial = await pixels(page); expect(radial).not.toEqual(gradient);
	await menu(page, 'Layer', 'Text and Appearance'); await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await close(page); expect(await pixels(page)).toEqual(gradient);
});
