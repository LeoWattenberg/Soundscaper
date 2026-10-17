/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
async function menu(page: Page, top: string, command: string): Promise<void> { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click(); }
async function close(page: Page): Promise<void> { await page.getByRole('button', { name: 'Close', exact: true }).last().click(); await expect(page.getByRole('dialog')).toHaveCount(0); }
async function alpha(page: Page): Promise<number> {
	await menu(page, 'View', 'Composition Preview'); const canvas = page.getByRole('dialog').locator('canvas'); await expect(canvas).toHaveAttribute('data-motion-frame', '0');
	const result = await canvas.evaluate((element: HTMLCanvasElement) => element.getContext('2d')!.getImageData(16, 16, 1, 1).data[3]!); await close(page); return result;
}
test('Timeline renames referenced layers, hides and removes selections with atomic Undo and portable saved intent', async ({ page }) => {
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition'); await page.getByLabel('Project title', { exact: true }).fill('Layer lifecycle');
	await page.getByLabel('Width', { exact: true }).fill('32'); await page.getByLabel('Height', { exact: true }).fill('32'); await page.getByRole('button', { name: 'Create', exact: true }).click();
	await menu(page, 'View', 'Timeline'); await page.getByLabel('Group name', { exact: true }).fill('Source'); await page.getByRole('button', { name: 'Group with Null', exact: true }).click(); await close(page);
	await menu(page, 'Layer', 'New Solid'); await page.getByLabel('Layer name', { exact: true }).fill('Dependent'); await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Layer', 'Expressions'); let dialog = page.getByRole('dialog'); await dialog.getByRole('combobox', { name: 'Layer', exact: true }).selectOption({ label: 'Dependent' });
	await dialog.getByRole('combobox', { name: 'Property', exact: true }).selectOption('transform.opacity'); await dialog.getByLabel('Reference alias', { exact: true }).fill('opacity');
	await dialog.getByRole('combobox', { name: 'Reference layer', exact: true }).selectOption({ label: 'Source' }); await dialog.getByRole('combobox', { name: 'Reference property', exact: true }).selectOption('transform.opacity');
	await dialog.getByRole('button', { name: 'Add Reference', exact: true }).click(); await dialog.getByLabel('Expression source', { exact: true }).fill('reference("opacity") * .5');
	await dialog.getByLabel('Expression enabled', { exact: true }).check(); await dialog.getByRole('button', { name: 'Apply Expression', exact: true }).click(); await close(page); expect(await alpha(page)).toBe(128);
	await menu(page, 'View', 'Timeline'); dialog = page.getByRole('dialog'); await dialog.getByRole('checkbox', { name: 'Source', exact: true }).check();
	await dialog.getByLabel('New layer name', { exact: true }).fill('Renamed source'); await dialog.getByRole('button', { name: 'Rename Layer', exact: true }).click();
	await expect(dialog.getByRole('checkbox', { name: 'Renamed source', exact: true })).toBeChecked();
	await dialog.getByRole('button', { name: 'Remove Selected Layers', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('dependent layer');
	await expect(dialog.locator('[data-motion-layer-row]')).toHaveCount(2); await dialog.getByRole('checkbox', { name: 'Renamed source', exact: true }).uncheck();
	await dialog.getByRole('checkbox', { name: 'Dependent', exact: true }).check(); await dialog.getByRole('button', { name: 'Disable Selected Layers', exact: true }).click(); await close(page); expect(await alpha(page)).toBe(0);
	await menu(page, 'View', 'Timeline'); dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await close(page); expect(await alpha(page)).toBe(128);
	await menu(page, 'View', 'Timeline'); dialog = page.getByRole('dialog'); await dialog.getByRole('checkbox', { name: 'Renamed source', exact: true }).check(); await dialog.getByRole('checkbox', { name: 'Dependent', exact: true }).check();
	await dialog.getByRole('button', { name: 'Remove Selected Layers', exact: true }).click(); await expect(dialog.locator('[data-motion-layer-row]')).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(dialog.locator('[data-motion-layer-row]')).toHaveCount(2); await close(page);
	await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload();
	await menu(page, 'File', 'Project Library'); await page.getByRole('button', { name: 'Layer lifecycle', exact: true }).click(); expect(await alpha(page)).toBe(128);
	await menu(page, 'View', 'Timeline'); await expect(page.getByRole('checkbox', { name: 'Renamed source', exact: true })).toBeVisible();
});
