/* SPDX-License-Identifier: AGPL-3.0-only */

import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
async function menu(page: Page, top: string, command: string): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click();
	await page.getByRole('menuitem', { name: command, exact: true }).click();
}

test('property keyframes animate actual rendered pixels and survive undo, clipboard and reopen', async ({ page }: { page: Page }) => {
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
	await page.getByLabel('Project title', { exact: true }).fill('Keyframe motion');
	await page.getByLabel('Width', { exact: true }).fill('400'); await page.getByLabel('Height', { exact: true }).fill('100');
	await page.getByLabel('Duration in frames', { exact: true }).fill('60');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Layer', 'New Rectangle');
	for (const [name, value] of [['Width', '40'], ['Height', '40'], ['Position X', '0'], ['Position Y', '0']] as const) await page.getByLabel(name, { exact: true }).fill(value);
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Layer', 'Properties and Keyframes'); const dialog = page.getByRole('dialog', { name: 'Properties and Keyframes', exact: true });
	await dialog.getByLabel('Property', { exact: true }).selectOption('transform.position');
	await dialog.getByLabel('Channel', { exact: true }).selectOption('0');
	for (const [position, value] of [['0', '0'], ['30', '300']] as const) {
		await dialog.getByLabel('Keyframe frame', { exact: true }).fill(position); await dialog.getByLabel('Keyframe value', { exact: true }).fill(value);
		await dialog.getByRole('button', { name: 'Set Keyframe', exact: true }).click();
	}
	await expect(dialog.locator('[data-motion-keyframe-row]')).toHaveCount(2);
	await dialog.getByRole('checkbox', { name: 'Keyframe 0', exact: true }).check();
	await dialog.getByLabel('Interpolation', { exact: true }).selectOption('eased');
	await dialog.getByRole('button', { name: 'Apply Interpolation', exact: true }).click();
	await expect(dialog.locator('[data-motion-keyframe-row]').first()).toHaveAttribute('data-motion-interpolation', 'eased');
	await expect(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await menu(page, 'View', 'Composition Preview');
	const preview = page.getByRole('dialog', { name: 'Composition Preview', exact: true }); const canvas = preview.locator('canvas');
	await expect(canvas).toHaveAttribute('data-motion-frame', '0'); await preview.getByLabel('Frame', { exact: true }).fill('15');
	await expect(canvas).toHaveAttribute('data-motion-frame', '15');
	const pixels = await canvas.evaluate((element: HTMLCanvasElement) => {
		const context = element.getContext('2d')!; return [Array.from(context.getImageData(160, 10, 1, 1).data), Array.from(context.getImageData(10, 10, 1, 1).data)];
	});
	expect(pixels).toEqual([[74, 128, 255, 255], [0, 0, 0, 0]]);
	await expect(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await menu(page, 'Layer', 'Properties and Keyframes');
	await dialog.getByLabel('Property', { exact: true }).selectOption('transform.position');
	await dialog.getByRole('checkbox', { name: 'Keyframe 0', exact: true }).check();
	await dialog.getByRole('checkbox', { name: 'Keyframe 30', exact: true }).check();
	await dialog.getByRole('button', { name: 'Copy Keyframes', exact: true }).click();
	await dialog.getByLabel('Keyframe frame', { exact: true }).fill('15');
	await dialog.getByRole('button', { name: 'Paste Keyframes', exact: true }).click();
	await expect(dialog.locator('[data-motion-keyframe-row]')).toHaveCount(4);
	await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(dialog.locator('[data-motion-keyframe-row]')).toHaveCount(2);
	await expect(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device');
	await page.reload(); await menu(page, 'File', 'Project Library'); await page.getByRole('button', { name: 'Keyframe motion', exact: true }).click();
	await menu(page, 'Layer', 'Properties and Keyframes'); await dialog.getByLabel('Property', { exact: true }).selectOption('transform.position');
	await expect(dialog.locator('[data-motion-keyframe-row]')).toHaveCount(2);
	await expect(dialog.locator('[data-motion-keyframe-row]').first()).toHaveAttribute('data-motion-interpolation', 'eased');
});
