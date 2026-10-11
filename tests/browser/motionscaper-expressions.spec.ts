/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { motionWavFixture } from '../helpers/motion-media-fixture.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
async function menu(page: Page, top: string, command: string): Promise<void> { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click(); }
async function close(page: Page): Promise<void> { await expect(page.getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); }
async function create(page: Page): Promise<void> {
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
	await page.getByLabel('Width', { exact: true }).fill('100'); await page.getByLabel('Height', { exact: true }).fill('100'); await page.getByLabel('Duration in frames', { exact: true }).fill('60');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await menu(page, 'Layer', 'New Solid');
	await page.getByLabel('Fill color', { exact: true }).fill('#ff0000'); await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function opacity(page: Page, frame: number): Promise<number> {
	await menu(page, 'View', 'Composition Preview'); const canvas = page.getByRole('dialog').locator('canvas'); await expect(canvas).toHaveAttribute('data-motion-frame', '0');
	await page.getByLabel('Frame', { exact: true }).fill(String(frame)); await expect(canvas).toHaveAttribute('data-motion-frame', String(frame));
	const alpha = await canvas.evaluate((element: HTMLCanvasElement) => element.getContext('2d')!.getImageData(50, 50, 1, 1).data[3]!); await close(page); return alpha;
}
test('stable property expressions render, bake atomically, undo and survive reopening', async ({ page }: { page: Page }) => {
	await create(page); await menu(page, 'Layer', 'Expressions'); const dialog = page.getByRole('dialog', { name: 'Expressions', exact: true });
	await dialog.getByRole('combobox', { name: 'Property', exact: true }).selectOption('transform.opacity');
	await dialog.getByLabel('Reference alias', { exact: true }).fill('dimensions'); await dialog.getByRole('combobox', { name: 'Reference property', exact: true }).selectOption('size'); await dialog.getByRole('button', { name: 'Add Reference', exact: true }).click();
	await dialog.getByLabel('Expression source', { exact: true }).fill('reference("dimensions")[0] / 100 * (time < 0.5 ? 0 : 1)'); await dialog.getByLabel('Expression enabled', { exact: true }).check();
	await dialog.getByRole('button', { name: 'Apply Expression', exact: true }).click(); await close(page); expect(await opacity(page, 0)).toBe(0); expect(await opacity(page, 15)).toBe(255);
	await menu(page, 'Layer', 'Expressions'); await dialog.getByRole('combobox', { name: 'Property', exact: true }).selectOption('transform.opacity'); await dialog.getByLabel('Bake end frame', { exact: true }).fill('30'); await dialog.getByRole('button', { name: 'Bake to Keyframes', exact: true }).click();
	await expect(dialog.getByLabel('Expression enabled', { exact: true })).not.toBeChecked(); await expect(dialog.locator('[data-motion-expression-keys]')).toHaveText('30');
	await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(dialog.getByLabel('Expression enabled', { exact: true })).toBeChecked(); await dialog.getByRole('button', { name: 'Redo', exact: true }).click(); await close(page);
	await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload(); await menu(page, 'File', 'Project Library'); await page.getByRole('button', { name: 'Untitled Composition', exact: true }).click(); expect(await opacity(page, 15)).toBe(255);
});
test('invalid expression source remains editable with source diagnostics and explicit render failure', async ({ page }: { page: Page }) => {
	await create(page); await menu(page, 'Layer', 'Expressions'); const dialog = page.getByRole('dialog', { name: 'Expressions', exact: true });
	await dialog.getByRole('combobox', { name: 'Property', exact: true }).selectOption('transform.opacity'); await dialog.getByLabel('Expression source', { exact: true }).fill('window.fetch("/")');
	await expect(dialog.locator('[data-motion-expression-diagnostic]')).toBeVisible(); await dialog.getByLabel('Expression enabled', { exact: true }).check(); await dialog.getByRole('button', { name: 'Apply Expression', exact: true }).click();
	await expect(dialog.getByLabel('Expression source', { exact: true })).toHaveValue('window.fetch("/")'); await close(page); await menu(page, 'View', 'Composition Preview'); await expect(page.getByRole('alert')).toBeVisible(); await close(page);
	await menu(page, 'Layer', 'Expressions'); await dialog.getByRole('combobox', { name: 'Property', exact: true }).selectOption('transform.opacity');
	await dialog.getByLabel('Expression source', { exact: true }).fill('1 / 0'); await dialog.getByRole('button', { name: 'Apply Expression', exact: true }).click(); await dialog.getByRole('button', { name: 'Evaluate Expression', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('transform.opacity'); await expect(dialog.getByRole('alert')).toContainText('Source position');
	await dialog.getByLabel('Expression source', { exact: true }).fill('0.5'); await expect(dialog.locator('[data-motion-expression-diagnostic]')).toHaveCount(0); await dialog.getByRole('button', { name: 'Apply Expression', exact: true }).click(); await dialog.getByRole('button', { name: 'Evaluate Expression', exact: true }).click(); await expect(dialog.locator('[data-motion-expression-result]')).toHaveText('0.5'); await close(page); expect(await opacity(page, 0)).toBe(128);
});

test('retained PCM amplitude can be authored and baked while cancellation preserves the live expression', async ({ page }: { page: Page }) => {
	await create(page); await menu(page, 'File', 'Import Media'); await page.getByLabel('Media file', { exact: true }).setInputFiles({ name: 'Tone.wav', mimeType: 'audio/wav', buffer: Buffer.from(motionWavFixture(2, 48000)) }); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Layer', 'Expressions'); const dialog = page.getByRole('dialog', { name: 'Expressions', exact: true });
	await dialog.getByRole('combobox', { name: 'Property', exact: true }).selectOption('transform.opacity'); await dialog.getByRole('button', { name: 'Use Amplitude Expression', exact: true }).click(); await dialog.getByLabel('Expression enabled', { exact: true }).check(); await dialog.getByRole('button', { name: 'Apply Expression', exact: true }).click(); await close(page);
	const before = await opacity(page, 1); expect(before).toBeGreaterThan(65); expect(before).toBeLessThan(80);
	await menu(page, 'Layer', 'Expressions'); await dialog.getByRole('combobox', { name: 'Property', exact: true }).selectOption('transform.opacity');
	await dialog.getByLabel('Bake end frame', { exact: true }).fill('40'); await dialog.getByLabel('Bake frame step', { exact: true }).fill('1/100'); await dialog.getByRole('button', { name: 'Bake to Keyframes', exact: true }).click(); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog.getByLabel('Expression enabled', { exact: true })).toBeChecked(); await expect(dialog.locator('[data-motion-expression-keys]')).toHaveText('0'); await expect(dialog.getByRole('button', { name: 'Bake to Keyframes', exact: true })).toBeEnabled();
	await dialog.getByLabel('Bake end frame', { exact: true }).fill('30'); await dialog.getByLabel('Bake frame step', { exact: true }).fill('1'); await dialog.getByRole('button', { name: 'Bake to Keyframes', exact: true }).click(); await expect(dialog.getByLabel('Expression enabled', { exact: true })).not.toBeChecked(); await close(page); expect(await opacity(page, 1)).toBe(before);
});
