/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
async function menu(page: Page, top: string, command: string): Promise<void> { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click(); }
async function canvasPoint(overlay: Locator, x: number, y: number): Promise<{ x: number; y: number }> {
	return overlay.evaluate((element: SVGSVGElement, point) => { const result = new DOMPoint(point.x, point.y).matrixTransform(element.getScreenCTM()!); return { x: result.x, y: result.y }; }, { x, y });
}
async function gesture(page: Page, overlay: Locator, from: readonly [number, number], to: readonly [number, number], cancel = false): Promise<void> {
	const a = await canvasPoint(overlay, ...from), b = await canvasPoint(overlay, ...to);
	await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 });
	if (cancel) await page.keyboard.press('Escape'); await page.mouse.up();
}
async function anchor(selected: Locator, x: number, y?: number): Promise<void> {
	await expect.poll(async () => Number(await selected.getAttribute('data-motion-anchor-x'))).toBeCloseTo(x, 8);
	if (y !== undefined) await expect.poll(async () => Number(await selected.getAttribute('data-motion-anchor-y'))).toBeCloseTo(y, 8);
}
async function create(page: Page): Promise<void> {
	await page.goto('/embed/en/'); await expect(page.locator('[data-motion-canvas-overlay]')).toHaveCount(0); await menu(page, 'File', 'New Composition');
	for (const [name, value] of [['Project title', 'Canvas study'], ['Width', '400'], ['Height', '200'], ['Duration in frames', '30']] as const) await page.getByLabel(name, { exact: true }).fill(value);
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await menu(page, 'Layer', 'New Rectangle');
	for (const [name, value] of [['Layer name', 'Card'], ['Width', '80'], ['Height', '40'], ['Position X', '40'], ['Position Y', '60']] as const) await page.getByLabel(name, { exact: true }).fill(value);
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
}
test('Composition Canvas selects, moves, scales and rotates actual pixels with one-step undo and durable reopening', async ({ page }: { page: Page }) => {
	await create(page); await menu(page, 'View', 'Composition Canvas'); const dialog = page.getByRole('dialog', { name: 'Composition Canvas', exact: true });
	const canvas = dialog.locator('canvas'), overlay = dialog.locator('svg'); const selected = dialog.locator('[data-motion-canvas-selected]');
	await expect(canvas).toHaveAttribute('data-motion-rendered'); await expect(dialog.getByLabel('Canvas layer', { exact: true })).toBeFocused();
	await gesture(page, overlay, [50, 70], [80, 90]); await anchor(selected, 70, 80);
	await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(75, 85, 1, 1).data))).toEqual([74, 128, 255, 255]);
	await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await anchor(selected, 40);
	await dialog.getByRole('button', { name: 'Redo', exact: true }).click(); await anchor(selected, 70);
	await gesture(page, overlay, [80, 90], [100, 100], true); await anchor(selected, 70);
	await gesture(page, overlay, [150, 120], [190, 140]);
	await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(185, 135, 1, 1).data))).toEqual([74, 128, 255, 255]);
	const rotate = dialog.getByRole('button', { name: 'Rotate selected layer', exact: true });
	const rotatePoint = await rotate.locator('circle').evaluate(element => [Number(element.getAttribute('cx')), Number(element.getAttribute('cy'))] as const);
	await gesture(page, overlay, rotatePoint, [70, 165]);
	await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(20, 180, 1, 1).data))).toEqual([74, 128, 255, 255]);
	await dialog.getByRole('button', { name: 'Move selected layer', exact: true }).focus(); await page.keyboard.press('ArrowRight'); await anchor(selected, 71);
	await expect(dialog.getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(page.getByRole('menuitem', { name: 'View', exact: true })).toBeFocused(); await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device');
	await page.reload(); await menu(page, 'File', 'Project Library'); await page.getByRole('button', { name: 'Canvas study', exact: true }).click();
	await menu(page, 'View', 'Composition Canvas'); await dialog.getByLabel('Canvas layer', { exact: true }).selectOption({ label: 'Card' }); await anchor(selected, 71);
	await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(20, 180, 1, 1).data))).toEqual([74, 128, 255, 255]);
	await dialog.getByLabel('Frame', { exact: true }).fill('30'); await expect(dialog.getByRole('alert')).toContainText('Enter a frame'); await expect(dialog.getByLabel('Frame', { exact: true })).toHaveAttribute('aria-invalid', 'true');
});
test('Composition Canvas preserves keyed transforms and remains a localized opt-in workspace', async ({ page }: { page: Page }) => {
	await create(page); await menu(page, 'Layer', 'Paths and Motion'); const paths = page.getByRole('dialog', { name: 'Paths and Motion', exact: true });
	await paths.getByRole('button', { name: 'Set Position Keyframe', exact: true }).click(); await expect(paths.getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await paths.getByRole('button', { name: 'Close', exact: true }).last().click();
	await menu(page, 'View', 'Composition Canvas'); const dialog = page.getByRole('dialog', { name: 'Composition Canvas', exact: true });
	await dialog.getByLabel('Canvas layer', { exact: true }).selectOption({ label: 'Card' }); await expect(dialog).toContainText('Use Properties and Keyframes'); await expect(dialog.locator('[data-motion-canvas-handle]')).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click(); await page.goto('/embed/de/');
	await expect(page.locator('[data-motion-canvas-overlay]')).toHaveCount(0); await page.getByRole('menuitem', { name: 'Ansicht', exact: true }).click();
	await expect(page.getByRole('menuitem', { name: 'Kompositions-Canvas', exact: true })).toBeDisabled();
});
