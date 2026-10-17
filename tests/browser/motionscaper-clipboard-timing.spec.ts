/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page, Locator } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
async function menu(page: Page, top: string, command: string): Promise<void> { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click(); }
async function create(page: Page, title: string): Promise<void> {
	await menu(page, 'File', 'New Composition'); await page.getByLabel('Project title', { exact: true }).fill(title);
	await page.getByLabel('Width', { exact: true }).fill('160'); await page.getByLabel('Height', { exact: true }).fill('80'); await page.getByLabel('Duration in frames', { exact: true }).fill('60');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function close(page: Page, dialog: Locator): Promise<void> { await expect(dialog.getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); }
test('layer clipboard reuses retained image bytes across projects with exact placement and undo', async ({ page }: { page: Page }) => {
	await page.goto('/embed/en/'); await create(page, 'Source'); const png = await page.evaluate(async () => {
		const canvas = new OffscreenCanvas(160, 80); const context = canvas.getContext('2d')!; context.fillStyle = '#ff0000'; context.fillRect(0, 0, 160, 80);
		return Array.from(new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()));
	});
	await menu(page, 'File', 'Import Media'); await page.getByLabel('Media file', { exact: true }).setInputFiles({ name: 'Red.png', mimeType: 'image/png', buffer: Buffer.from(png) }); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'View', 'Timeline'); const timeline = page.getByRole('dialog', { name: 'Timeline', exact: true }); await timeline.getByRole('checkbox', { name: 'Red.png', exact: true }).check();
	await timeline.getByRole('button', { name: 'Copy Layers', exact: true }).click(); await expect(timeline.getByRole('status')).toHaveText('Layers copied in this window'); await close(page, timeline);
	await create(page, 'Destination'); await menu(page, 'View', 'Timeline'); await timeline.getByRole('checkbox', { name: 'Keep original timing', exact: true }).uncheck();
	await timeline.getByLabel('Paste at frame', { exact: true }).fill('3/2'); await timeline.getByRole('button', { name: 'Paste Layers', exact: true }).click();
	await expect(timeline.locator('[data-motion-layer-row]')).toHaveAttribute('data-motion-in', '3/2'); await timeline.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(timeline.locator('[data-motion-layer-row]')).toHaveCount(0);
	await timeline.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(timeline.locator('[data-motion-layer-row]')).toHaveCount(1); await close(page, timeline);
	await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload(); await menu(page, 'File', 'Project Library'); await page.getByRole('button', { name: 'Destination', exact: true }).click();
	await menu(page, 'View', 'Composition Preview'); const preview = page.getByRole('dialog', { name: 'Composition Preview', exact: true }); await expect(preview.locator('canvas')).toHaveAttribute('data-motion-frame', '0');
	await preview.getByLabel('Frame', { exact: true }).fill('2'); await expect(preview.locator('canvas')).toHaveAttribute('data-motion-frame', '2');
	expect(await preview.locator('canvas').evaluate((canvas: HTMLCanvasElement) => Array.from(canvas.getContext('2d')!.getImageData(10, 10, 1, 1).data))).toEqual([255, 0, 0, 255]);
});
test('reverse precomposition timing and editable remap keep source-seconds authority', async ({ page }: { page: Page }) => {
	await page.goto('/embed/en/'); await create(page, 'Reverse'); await menu(page, 'Layer', 'New Rectangle');
	for (const [label, value] of [['Width', '20'], ['Height', '20'], ['Position X', '0'], ['Position Y', '0']] as const) await page.getByLabel(label, { exact: true }).fill(value);
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await menu(page, 'Layer', 'Properties and Keyframes');
	const properties = page.getByRole('dialog', { name: 'Properties and Keyframes', exact: true });
	for (const [at, value] of [['0', '0'], ['30', '100']] as const) { await properties.getByLabel('Keyframe frame', { exact: true }).fill(at); await properties.getByLabel('Keyframe value', { exact: true }).fill(value); await properties.getByRole('button', { name: 'Set Keyframe', exact: true }).click(); }
	await close(page, properties); await menu(page, 'View', 'Timeline'); const timeline = page.getByRole('dialog', { name: 'Timeline', exact: true });
	await timeline.getByRole('checkbox', { name: 'New Rectangle', exact: true }).check(); await timeline.getByLabel('Group name', { exact: true }).fill('Child'); await timeline.getByRole('button', { name: 'Precompose', exact: true }).click();
	await timeline.getByRole('checkbox', { name: 'Child', exact: true }).check(); await timeline.getByLabel('Source start (seconds)', { exact: true }).fill('1'); await timeline.getByLabel('Source speed', { exact: true }).fill('-1');
	await timeline.getByRole('button', { name: 'Apply Source Timing', exact: true }).click(); await expect(timeline.locator('[data-motion-source-timing]')).toHaveAttribute('data-motion-time-scale', '-1');
	await timeline.getByRole('button', { name: 'Enable Time Remap', exact: true }).click(); await expect(timeline.locator('[data-motion-source-timing]')).toHaveAttribute('data-motion-remapped', 'true'); await close(page, timeline);
	await menu(page, 'View', 'Composition Preview'); const preview = page.getByRole('dialog', { name: 'Composition Preview', exact: true }); const canvas = preview.locator('canvas');
	await expect(canvas).toHaveAttribute('data-motion-frame', '0'); expect(await canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(110, 10, 1, 1).data))).toEqual([74, 128, 255, 255]);
	await preview.getByLabel('Frame', { exact: true }).fill('15'); await expect(canvas).toHaveAttribute('data-motion-frame', '15'); expect(await canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(60, 10, 1, 1).data))).toEqual([74, 128, 255, 255]);
	await close(page, preview); await menu(page, 'View', 'Timeline'); await timeline.getByRole('checkbox', { name: 'Child', exact: true }).check();
	await timeline.getByRole('button', { name: 'Clear Time Remap', exact: true }).click(); await expect(timeline.locator('[data-motion-source-timing]')).toHaveAttribute('data-motion-remapped', 'false');
	await timeline.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(timeline.locator('[data-motion-source-timing]')).toHaveAttribute('data-motion-remapped', 'true');
});
