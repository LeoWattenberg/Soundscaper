/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
async function menu(page: Page, top: string, command: string): Promise<void> { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click(); }
async function close(page: Page): Promise<void> { await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click(); await expect(page.getByRole('dialog')).toHaveCount(0); }

test('a canvas-positioned title card keeps its curve, null parenting and precomposition through save/reopen and actual PNG delivery', async ({ page }: { page: Page }) => {
	await page.addInitScript(() => { Object.defineProperty(globalThis, 'showSaveFilePicker', { value: undefined, configurable: true }); });
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
	for (const [name, value] of [['Project title', 'Motion title card'], ['Width', '400'], ['Height', '160'], ['Duration in frames', '30']] as const) await page.getByLabel(name, { exact: true }).fill(value);
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Layer', 'New Rectangle');
	for (const [name, value] of [['Layer name', 'Card'], ['Width', '280'], ['Height', '100'], ['Position X', '20'], ['Position Y', '20']] as const) await page.getByLabel(name, { exact: true }).fill(value);
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Layer', 'New Text');
	for (const [name, value] of [['Layer name', 'Title'], ['Text', 'Motion'], ['Font size', '40'], ['Width', '240'], ['Height', '70'], ['Position X', '80'], ['Position Y', '35'], ['Fill color', '#ffffff']] as const) await page.getByLabel(name, { exact: true }).fill(value);
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'View', 'Composition Canvas'); let dialog = page.getByRole('dialog');
	await expect(dialog.locator('canvas')).toHaveAttribute('data-motion-rendered'); await dialog.getByLabel('Canvas layer', { exact: true }).selectOption({ label: 'Card' });
	await dialog.getByRole('button', { name: 'Move selected layer', exact: true }).focus(); await page.keyboard.press('Shift+ArrowRight');
	await expect(dialog.locator('[data-motion-canvas-selected]')).toHaveAttribute('data-motion-anchor-x', '30'); await close(page);
	await menu(page, 'Layer', 'Properties and Keyframes'); dialog = page.getByRole('dialog');
	await dialog.getByLabel('Layer', { exact: true }).selectOption({ label: 'Card' }); await dialog.getByLabel('Property', { exact: true }).selectOption('transform.position');
	for (const [frame, value] of [['0', '30'], ['15', '70']] as const) {
		await dialog.getByLabel('Keyframe frame', { exact: true }).fill(frame); await dialog.getByLabel('Keyframe value', { exact: true }).fill(value); await dialog.getByRole('button', { name: 'Set Keyframe', exact: true }).click();
	}
	await dialog.getByRole('checkbox', { name: 'Keyframe 0', exact: true }).check(); await dialog.getByLabel('Interpolation', { exact: true }).selectOption('eased');
	await dialog.getByRole('button', { name: 'Apply Interpolation', exact: true }).click(); await expect(dialog.locator('[data-motion-keyframe-row]').first()).toHaveAttribute('data-motion-interpolation', 'eased'); await close(page);
	await menu(page, 'View', 'Timeline'); dialog = page.getByRole('dialog');
	await dialog.getByRole('checkbox', { name: 'Title', exact: true }).check(); await dialog.getByRole('checkbox', { name: 'Card', exact: true }).check();
	await dialog.getByLabel('Group name', { exact: true }).fill('Title parent'); await dialog.getByRole('button', { name: 'Group with Null', exact: true }).click();
	await expect(dialog.locator('[data-motion-layer-row]')).toHaveCount(3); await dialog.getByRole('checkbox', { name: 'Title parent', exact: true }).check();
	await dialog.getByLabel('Group name', { exact: true }).fill('Title scene'); await dialog.getByRole('button', { name: 'Precompose', exact: true }).click();
	await expect(dialog.locator('[data-motion-layer-row]')).toHaveCount(1); await close(page);
	await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload();
	await menu(page, 'File', 'Project Library'); await page.getByRole('button', { name: 'Motion title card', exact: true }).click();
	await menu(page, 'Layer', 'Properties and Keyframes'); dialog = page.getByRole('dialog');
	await dialog.getByLabel('Composition', { exact: true }).selectOption({ label: 'Title scene' }); await dialog.getByLabel('Layer', { exact: true }).selectOption({ label: 'Card' });
	await dialog.getByLabel('Property', { exact: true }).selectOption('transform.position'); await expect(dialog.locator('[data-motion-keyframe-row]')).toHaveCount(2);
	await expect(dialog.locator('[data-motion-keyframe-row]').first()).toHaveAttribute('data-motion-interpolation', 'eased'); await close(page);
	await menu(page, 'View', 'Composition Preview'); dialog = page.getByRole('dialog'); const canvas = dialog.locator('canvas');
	await expect(canvas).toHaveAttribute('data-motion-frame', '0'); await dialog.getByLabel('Frame', { exact: true }).fill('15'); await expect(canvas).toHaveAttribute('data-motion-frame', '15');
	const preview = await canvas.evaluate((element: HTMLCanvasElement) => {
		const context = element.getContext('2d')!; const rgba = Array.from(context.getImageData(0, 0, element.width, element.height).data);
		let titlePixels = 0; for (let y = 35; y < 105; y++) for (let x = 80; x < 320; x++) { const i = (y * element.width + x) * 4; if (rgba[i]! > 240 && rgba[i + 1]! > 240 && rgba[i + 2]! > 240 && rgba[i + 3]! > 240) titlePixels++; }
		return { rgba, titlePixels, card: Array.from(context.getImageData(75, 110, 1, 1).data), outside: Array.from(context.getImageData(5, 5, 1, 1).data) };
	});
	expect(preview.titlePixels).toBeGreaterThan(300); expect(preview.card).toEqual([74, 128, 255, 255]); expect(preview.outside).toEqual([0, 0, 0, 0]); await close(page);
	await menu(page, 'File', 'Render'); dialog = page.getByRole('dialog'); await dialog.getByLabel('First frame', { exact: true }).fill('15'); await dialog.getByLabel('End frame (exclusive)', { exact: true }).fill('16');
	const pending = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Render', exact: true }).click(); const download = await pending;
	const output = await download.path(); if (!output) throw new Error('The title-card render was not downloaded.');
	const archive = await readFile(output); const size = Number.parseInt(new TextDecoder().decode(archive.subarray(124, 136)), 8); expect(new TextDecoder().decode(archive.subarray(0, 100))).toContain('.png');
	const difference = await page.evaluate(async ({ png, preview }) => {
		const bitmap = await createImageBitmap(new Blob([Uint8Array.from(png)], { type: 'image/png' })); const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
		const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close(); const rendered = context.getImageData(0, 0, canvas.width, canvas.height).data;
		let maximum = 0; for (let i = 0; i < rendered.length; i++) maximum = Math.max(maximum, Math.abs(rendered[i]! - preview[i]!)); return maximum;
	}, { png: Array.from(archive.subarray(512, 512 + size)), preview: preview.rgba });
	expect(difference).toBeLessThanOrEqual(1); await expect(dialog.getByRole('status')).toHaveText('Render complete');
});
