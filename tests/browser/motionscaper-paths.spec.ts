/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
async function menu(page: Page, top: string, command: string): Promise<void> { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click(); }
async function create(page: Page): Promise<void> {
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
	await page.getByLabel('Width', { exact: true }).fill('400'); await page.getByLabel('Height', { exact: true }).fill('200'); await page.getByLabel('Duration in frames', { exact: true }).fill('60');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await menu(page, 'Layer', 'New Rectangle');
	for (const [name, value] of [['Width', '40'], ['Height', '40'], ['Position X', '0'], ['Position Y', '0']] as const) await page.getByLabel(name, { exact: true }).fill(value);
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await menu(page, 'Layer', 'Paths and Motion');
}
test('spatial Bezier authoring drives actual preview pixels and keeps gesture undo atomic', async ({ page }: { page: Page }) => {
	await create(page); const dialog = page.getByRole('dialog', { name: 'Paths and Motion', exact: true });
	const base = dialog.locator('[data-motion-plane-point="base"]'); await base.focus(); await page.keyboard.press('ArrowRight');
	await expect(base).toHaveAttribute('data-motion-point-x', '1'); await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(base).toHaveAttribute('data-motion-point-x', '0');
	for (const [frame, x] of [['0', '0'], ['30', '300']] as const) {
		await dialog.getByLabel('Local frame', { exact: true }).fill(frame); await dialog.getByLabel('Position X', { exact: true }).fill(x); await dialog.getByLabel('Position Y', { exact: true }).fill('0');
		await dialog.getByRole('button', { name: 'Set Position Keyframe', exact: true }).click();
	}
	await dialog.locator('[data-motion-plane-point="key:0/1"]').click(); await dialog.getByRole('button', { name: 'Create Spatial Bézier', exact: true }).click();
	const handle = dialog.locator('[data-motion-plane-point="handle:0/1:1"]'); await handle.click();
	await dialog.getByLabel('Point X', { exact: true }).fill('100'); await dialog.getByLabel('Point Y', { exact: true }).fill('200');
	await dialog.getByRole('button', { name: 'Apply Point', exact: true }).click(); await expect(handle).toHaveAttribute('data-motion-point-y', '200');
	await expect(dialog.getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await handle.focus(); await page.keyboard.press('ArrowUp');
	await expect(handle).toHaveAttribute('data-motion-point-y', '199'); await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(handle).toHaveAttribute('data-motion-point-y', '200');
	await expect(dialog.getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await handle.scrollIntoViewIfNeeded();
	const start = (await handle.boundingBox())!; await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
	await page.mouse.move(start.x + 25, start.y + 20, { steps: 4 }); await page.mouse.up(); await expect(handle).not.toHaveAttribute('data-motion-point-y', '200');
	await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(handle).toHaveAttribute('data-motion-point-y', '200');
	await expect(dialog.getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await handle.scrollIntoViewIfNeeded();
	const cancelled = (await handle.boundingBox())!; await page.mouse.move(cancelled.x + cancelled.width / 2, cancelled.y + cancelled.height / 2); await page.mouse.down();
	await page.mouse.move(cancelled.x + 30, cancelled.y + 15); await dialog.locator('[data-motion-plane]').dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up();
	await expect(handle).toHaveAttribute('data-motion-point-y', '200'); await expect(dialog.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
	await expect(dialog.getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'View', 'Composition Preview'); const preview = page.getByRole('dialog', { name: 'Composition Preview', exact: true }); const canvas = preview.locator('canvas');
	await expect(canvas).toHaveAttribute('data-motion-frame', '0'); await preview.getByLabel('Frame', { exact: true }).fill('15'); await expect(canvas).toHaveAttribute('data-motion-frame', '15');
	expect(await canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(160, 85, 1, 1).data))).toEqual([74, 128, 255, 255]);
});
test('path topology and morph edits survive undo and save/reopen', async ({ page }: { page: Page }) => {
	await create(page); const dialog = page.getByRole('dialog', { name: 'Paths and Motion', exact: true });
	await dialog.getByRole('combobox', { name: 'Property', exact: true }).selectOption({ label: 'Shape 1: Path' });
	await expect(dialog.locator('[data-motion-plane-kind="anchor"]')).toHaveCount(4);
	await dialog.locator('[data-motion-plane-point="vertex:0"]').click(); await dialog.getByRole('button', { name: 'Insert Path Point', exact: true }).click();
	await expect(dialog.locator('[data-motion-plane-kind="anchor"]')).toHaveCount(5); await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(dialog.locator('[data-motion-plane-kind="anchor"]')).toHaveCount(4);
	await dialog.getByRole('combobox', { name: 'Path edit target', exact: true }).selectOption('key'); await dialog.getByRole('button', { name: 'Set Path Keyframe', exact: true }).click();
	await dialog.getByLabel('Local frame', { exact: true }).fill('30'); await dialog.locator('[data-motion-plane-point="vertex:1"]').click();
	await dialog.getByLabel('Point X', { exact: true }).fill('140'); await dialog.getByRole('button', { name: 'Apply Point', exact: true }).click();
	await expect(dialog.locator('[data-motion-plane-point="vertex:1"]')).toHaveAttribute('data-motion-point-x', '140');
	await dialog.getByRole('checkbox', { name: 'Keyframe 0', exact: true }).check();
	await dialog.getByRole('combobox', { name: 'Interpolation', exact: true }).selectOption('bezier');
	await dialog.getByLabel('First control value', { exact: true }).fill('0'); await dialog.getByLabel('Second control value', { exact: true }).fill('1');
	await dialog.getByRole('button', { name: 'Apply Interpolation', exact: true }).click();
	await dialog.getByLabel('Local frame', { exact: true }).fill('15/2'); await expect(dialog.locator('[data-motion-plane-point="vertex:1"]')).toHaveAttribute('data-motion-point-x', '55.625');
	await dialog.getByRole('checkbox', { name: 'Keyframe 30', exact: true }).check(); await dialog.getByRole('button', { name: 'Copy Keyframes', exact: true }).click();
	await dialog.getByLabel('Local frame', { exact: true }).fill('15'); await dialog.getByRole('button', { name: 'Paste Keyframes', exact: true }).click();
	await expect(dialog.locator('[data-motion-path-keyframe]')).toHaveCount(4); await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(dialog.locator('[data-motion-path-keyframe]')).toHaveCount(2);
	await expect(dialog.locator('[data-motion-plane-point="vertex:1"]')).toHaveAttribute('data-motion-point-x', '90');
	await expect(dialog.getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload();
	await menu(page, 'File', 'Project Library'); await page.getByRole('button', { name: 'Untitled Composition', exact: true }).click(); await menu(page, 'Layer', 'Paths and Motion');
	await dialog.getByRole('combobox', { name: 'Property', exact: true }).selectOption({ label: 'Shape 1: Path' }); await dialog.getByRole('combobox', { name: 'Path edit target', exact: true }).selectOption('key');
	await dialog.getByLabel('Local frame', { exact: true }).fill('15'); await expect(dialog.locator('[data-motion-plane-point="vertex:1"]')).toHaveAttribute('data-motion-point-x', '90');
});
test('incompatible morph paste preserves the path and leaves the preceding topology edit first in undo', async ({ page }: { page: Page }) => {
	await create(page); const dialog = page.getByRole('dialog', { name: 'Paths and Motion', exact: true });
	await dialog.getByRole('combobox', { name: 'Property', exact: true }).selectOption({ label: 'Shape 1: Path' });
	const anchors = dialog.locator('[data-motion-plane-kind="anchor"]'), keys = dialog.locator('[data-motion-path-keyframe]');
	await expect(anchors).toHaveCount(4);
	await dialog.getByRole('combobox', { name: 'Path edit target', exact: true }).selectOption('key');
	await dialog.getByRole('button', { name: 'Set Path Keyframe', exact: true }).click();
	await dialog.getByLabel('Local frame', { exact: true }).fill('30'); await dialog.locator('[data-motion-plane-point="vertex:1"]').click();
	await dialog.getByLabel('Point X', { exact: true }).fill('140'); await dialog.getByRole('button', { name: 'Apply Point', exact: true }).click();
	await expect(dialog.locator('[data-motion-plane-point="vertex:1"]')).toHaveAttribute('data-motion-point-x', '140');
	await dialog.getByRole('checkbox', { name: 'Keyframe 0', exact: true }).check();
	await dialog.getByRole('button', { name: 'Copy Keyframes', exact: true }).click();
	// The clipboard keeps four vertices; insertion changes the base and both authored keys to five.
	await dialog.locator('[data-motion-plane-point="vertex:0"]').click(); await dialog.getByRole('button', { name: 'Insert Path Point', exact: true }).click();
	await expect(anchors).toHaveCount(5); await dialog.getByLabel('Local frame', { exact: true }).fill('15');
	await expect(dialog.locator('[data-motion-plane-point="vertex:2"]')).toHaveAttribute('data-motion-point-x', '90');
	const beforePaste = await anchors.evaluateAll((points) => points.map((point) => ['data-motion-plane-point', 'data-motion-point-x', 'data-motion-point-y'].map((name) => point.getAttribute(name))));
	await dialog.getByRole('button', { name: 'Paste Keyframes', exact: true }).click();
	await expect(dialog.getByRole('alert')).toHaveText('The edit could not be applied. Animated path topology must match its base path.');
	await expect(anchors).toHaveCount(5); await expect(keys).toHaveCount(2);
	expect(await anchors.evaluateAll((points) => points.map((point) => ['data-motion-plane-point', 'data-motion-point-x', 'data-motion-point-y'].map((name) => point.getAttribute(name))))).toEqual(beforePaste);
	await expect(dialog.getByRole('checkbox', { name: 'Keyframe 0', exact: true })).toHaveCount(1);
	await expect(dialog.getByRole('checkbox', { name: 'Keyframe 30', exact: true })).toHaveCount(1);
	await expect(dialog.getByRole('checkbox', { name: 'Keyframe 15', exact: true })).toHaveCount(0);
	for (const [frame, x] of [['0', '40'], ['30', '140'], ['15', '90']] as const) {
		await dialog.getByLabel('Local frame', { exact: true }).fill(frame);
		await expect(dialog.locator('[data-motion-plane-point="vertex:2"]')).toHaveAttribute('data-motion-point-x', x);
	}
	// A refused paste creates no history entry: the first Undo must remove the earlier insertion.
	await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(anchors).toHaveCount(4); await expect(keys).toHaveCount(2);
	await expect(dialog.locator('[data-motion-plane-point="vertex:1"]')).toHaveAttribute('data-motion-point-x', '90');
	await dialog.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(anchors).toHaveCount(5); await expect(keys).toHaveCount(2);
	await expect(dialog.locator('[data-motion-plane-point="vertex:2"]')).toHaveAttribute('data-motion-point-x', '90');
	await expect(dialog.getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload();
	await menu(page, 'File', 'Project Library'); await page.getByRole('button', { name: 'Untitled Composition', exact: true }).click(); await menu(page, 'Layer', 'Paths and Motion');
	await dialog.getByRole('combobox', { name: 'Property', exact: true }).selectOption({ label: 'Shape 1: Path' });
	await dialog.getByRole('combobox', { name: 'Path edit target', exact: true }).selectOption('key'); await dialog.getByLabel('Local frame', { exact: true }).fill('15');
	await expect(anchors).toHaveCount(5); await expect(keys).toHaveCount(2);
	await expect(dialog.getByRole('checkbox', { name: 'Keyframe 0', exact: true })).toHaveCount(1);
	await expect(dialog.getByRole('checkbox', { name: 'Keyframe 30', exact: true })).toHaveCount(1);
	await expect(dialog.locator('[data-motion-plane-point="vertex:2"]')).toHaveAttribute('data-motion-point-x', '90');
});
