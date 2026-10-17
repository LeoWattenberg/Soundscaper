/* SPDX-License-Identifier: AGPL-3.0-only */

import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';

async function menu(page: Page, top: string, command: string): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click();
	await page.getByRole('menuitem', { name: command, exact: true }).click();
}

test('menu-opened motion preview paints real alpha pixels, seeks, plays and releases its worker on close', async ({ page }: { page: Page }) => {
	await page.goto('/embed/en/');
	await menu(page, 'File', 'New Composition');
	await page.getByLabel('Width', { exact: true }).fill('64'); await page.getByLabel('Height', { exact: true }).fill('64');
	await page.getByLabel('Duration in frames', { exact: true }).fill('120');
	await page.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.locator('canvas.motionscaper-preview-canvas')).toHaveCount(0);
	expect(page.workers()).toHaveLength(0);
	await menu(page, 'Layer', 'New Solid');
	await page.getByLabel('Width', { exact: true }).fill('32'); await page.getByLabel('Height', { exact: true }).fill('32');
	await page.getByLabel('Fill color', { exact: true }).fill('#ff0000'); await page.getByLabel('Opacity (%)', { exact: true }).fill('50');
	await page.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'View', 'Composition Preview');
	const dialog = page.getByRole('dialog', { name: 'Composition Preview', exact: true });
	const canvas = dialog.locator('canvas');
	await expect(canvas).toHaveAttribute('data-motion-frame', '0', { timeout: 15000 });
	const pixels = await canvas.evaluate((element: HTMLCanvasElement) => {
		const context = element.getContext('2d')!;
		return [Array.from(context.getImageData(8, 8, 1, 1).data), Array.from(context.getImageData(48, 48, 1, 1).data)];
	});
	expect(pixels).toEqual([[255, 0, 0, 128], [0, 0, 0, 0]]);
	expect(page.workers().length).toBeGreaterThan(0);
	await dialog.getByLabel('Frame', { exact: true }).fill('10');
	await expect(canvas).toHaveAttribute('data-motion-frame', '10');
	await dialog.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect.poll(async () => Number(await canvas.getAttribute('data-motion-frame'))).toBeGreaterThan(10);
	await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect.poll(() => page.workers().length).toBe(0);
	await expect(page.getByRole('menuitem', { name: 'View', exact: true })).toBeFocused();
});
