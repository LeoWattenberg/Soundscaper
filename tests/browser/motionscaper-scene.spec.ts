/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
async function menu(page: Page, top: string, item: string): Promise<void> { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: true }).click(); }
async function close(page: Page): Promise<void> { await page.getByRole('button', { name: 'Close', exact: true }).last().click(); await expect(page.getByRole('dialog')).toHaveCount(0); }
async function create(page: Page): Promise<void> {
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
	for (const [name, value] of [['Width', '80'], ['Height', '60'], ['Duration in frames', '60']] as const) await page.getByLabel(name, { exact: true }).fill(value);
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await menu(page, 'Layer', 'New Solid');
	for (const [name, value] of [['Width', '20'], ['Height', '20'], ['Position X', '30'], ['Position Y', '20'], ['Fill color', '#ffffff']] as const) await page.getByLabel(name, { exact: true }).fill(value);
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('checkbox', { name: '3D layer', exact: true })).toHaveCount(0);
}
async function pixels(page: Page): Promise<number[]> {
	await menu(page, 'View', 'Composition Preview'); const canvas = page.getByRole('dialog').locator('canvas'); await expect(canvas).toHaveAttribute('data-motion-frame', '0');
	const result = await canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data)); await close(page); return result;
}
async function saveReopen(page: Page): Promise<void> { await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload(); await menu(page, 'File', 'Project Library'); await page.getByRole('button', { name: 'Untitled Composition', exact: true }).click(); }
const pixel = (data: readonly number[], x: number, y: number) => data.slice((y * 80 + x) * 4, (y * 80 + x) * 4 + 4);
test('menu 3D transforms and camera optics change projected pixels with reversible edits', async ({ page }: { page: Page }) => {
	await create(page); const flat = await pixels(page); expect(pixel(flat, 31, 21)).toEqual([255, 255, 255, 255]); await menu(page, 'Layer', '3D Scene and Quality');
	const dialog = page.getByRole('dialog', { name: '3D Scene and Quality', exact: true }); await dialog.getByRole('checkbox', { name: '3D layer', exact: true }).check();
	await dialog.getByRole('spinbutton', { name: 'Position Z', exact: true }).fill('80'); await dialog.getByRole('button', { name: 'Apply Scene Transform', exact: true }).click(); await close(page);
	const perspective = await pixels(page); expect(pixel(perspective, 31, 21)[3]).toBe(0); expect(pixel(perspective, 40, 30)).toEqual([255, 255, 255, 255]);
	await menu(page, 'Layer', '3D Scene and Quality'); await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await close(page); expect(await pixels(page)).toEqual(flat);
	await menu(page, 'Layer', '3D Scene and Quality'); await dialog.getByRole('button', { name: 'Redo', exact: true }).click(); await dialog.getByRole('button', { name: 'Add Camera', exact: true }).click();
	await expect(dialog.getByRole('spinbutton', { name: 'Position Z', exact: true })).toHaveValue('-80'); await close(page); expect(await pixels(page)).toEqual(perspective);
	await menu(page, 'Layer', '3D Scene and Quality'); await dialog.getByRole('combobox', { name: 'Layer', exact: true }).selectOption({ label: 'Camera' }); await dialog.getByRole('combobox', { name: 'Projection', exact: true }).selectOption('orthographic');
	await dialog.getByRole('spinbutton', { name: 'Focus distance', exact: true }).fill('160'); await dialog.getByRole('spinbutton', { name: 'Aperture diameter', exact: true }).fill('8'); await dialog.getByRole('button', { name: 'Apply Camera', exact: true }).click(); await close(page); expect(await pixels(page)).toEqual(flat);
	await saveReopen(page); expect(await pixels(page)).toEqual(flat); await menu(page, 'Layer', '3D Scene and Quality'); await dialog.getByRole('combobox', { name: 'Layer', exact: true }).selectOption({ label: 'Camera' }); await expect(dialog.getByRole('combobox', { name: 'Projection', exact: true })).toHaveValue('orthographic'); await expect(dialog.getByRole('spinbutton', { name: 'Aperture diameter', exact: true })).toHaveValue('8'); await close(page);
	await menu(page, 'Layer', '3D Scene and Quality'); await dialog.getByRole('combobox', { name: 'Layer', exact: true }).selectOption({ label: 'Camera' }); await dialog.getByRole('spinbutton', { name: 'Aperture diameter', exact: true }).fill('-1'); await dialog.getByRole('button', { name: 'Apply Camera', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('aperture'); await close(page); expect(await pixels(page)).toEqual(flat);
});
test('menu lights material and independent temporal lens quality retain saved render authority', async ({ page }: { page: Page }) => {
	await create(page); await menu(page, 'Layer', '3D Scene and Quality'); const dialog = page.getByRole('dialog', { name: '3D Scene and Quality', exact: true });
	await dialog.getByRole('checkbox', { name: '3D layer', exact: true }).check(); await dialog.getByRole('button', { name: 'Apply Scene Transform', exact: true }).click();
	await dialog.getByRole('checkbox', { name: 'Respond to lights', exact: true }).check(); await dialog.getByRole('checkbox', { name: 'Cast shadows', exact: true }).check(); await dialog.getByRole('checkbox', { name: 'Receive shadows', exact: true }).check();
	await dialog.getByRole('spinbutton', { name: 'Ambient response', exact: true }).fill('1'); await dialog.getByRole('spinbutton', { name: 'Diffuse response', exact: true }).fill('0'); await dialog.getByRole('button', { name: 'Apply Material', exact: true }).click();
	await dialog.getByRole('group', { name: 'Property selection', exact: true }).getByRole('combobox', { name: 'Light type', exact: true }).selectOption('ambient'); await dialog.getByRole('button', { name: 'Add Light', exact: true }).click();
	const light = dialog.getByRole('group', { name: 'Light', exact: true }); await light.getByRole('textbox', { name: 'Fill color', exact: true }).fill('#ff0000'); await light.getByRole('button', { name: 'Apply Light', exact: true }).click();
	await dialog.getByRole('checkbox', { name: 'Motion blur', exact: true }).check(); await dialog.getByRole('textbox', { name: 'Shutter open offset in frames', exact: true }).fill('0'); await dialog.getByRole('textbox', { name: 'Shutter close offset in frames', exact: true }).fill('1/2'); await dialog.getByRole('spinbutton', { name: 'Motion samples', exact: true }).fill('2');
	await dialog.getByRole('checkbox', { name: 'Set depth of field quality', exact: true }).check(); await dialog.getByRole('spinbutton', { name: 'Lens samples', exact: true }).fill('4'); await dialog.getByRole('button', { name: 'Apply Render Quality', exact: true }).click(); await close(page);
	const lit = await pixels(page); expect(pixel(lit, 40, 30)).toEqual([255, 0, 0, 255]);
	await saveReopen(page); expect(await pixels(page)).toEqual(lit);
	await menu(page, 'Layer', '3D Scene and Quality'); await expect(dialog.getByRole('spinbutton', { name: 'Motion samples', exact: true })).toHaveValue('2'); await expect(dialog.getByRole('spinbutton', { name: 'Lens samples', exact: true })).toHaveValue('4'); await expect(dialog.getByRole('textbox', { name: 'Shutter close offset in frames', exact: true })).toHaveValue('1/2');
	await dialog.getByRole('combobox', { name: 'Layer', exact: true }).selectOption({ label: 'New Solid' }); await expect(dialog.getByRole('checkbox', { name: 'Respond to lights', exact: true })).toBeChecked(); await expect(dialog.getByRole('checkbox', { name: 'Cast shadows', exact: true })).toBeChecked();
});
