/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';

async function menu(page: Page, top: string, command: string): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click();
}
async function create(page: Page): Promise<void> {
	await page.goto('/embed/en/'); await expect(page.locator('[data-motion-property-graph], [data-motion-plane]')).toHaveCount(0);
	await menu(page, 'File', 'New Composition'); await page.getByLabel('Duration in frames', { exact: true }).fill('60');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Layer', 'New Rectangle'); await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function ignoredActivation(point: Locator, activation: string): Promise<void> {
	for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) {
		const consumed = await point.evaluate((node, options) => {
			const event = new KeyboardEvent('keydown', { ...options, bubbles: true, cancelable: true }); node.dispatchEvent(event); return event.defaultPrevented;
		}, { key: activation === 'Space' ? ' ' : activation, ...extra });
		expect(consumed).toBe(false); await expect(point).toHaveAttribute('aria-pressed', 'false');
	}
}

for (const activation of ['Enter', 'Space']) {
	test(`graph ${activation} selects focused keys without adding Undo history and preserves arrow editing`, async ({ page }) => {
		await create(page); await menu(page, 'Layer', 'Properties and Keyframes'); const dialog = page.getByRole('dialog', { name: 'Properties and Keyframes', exact: true });
		for (const [frame, value] of [['0', '0'], ['30', '300']] as const) {
			await dialog.getByLabel('Keyframe frame', { exact: true }).fill(frame); await dialog.getByLabel('Keyframe value', { exact: true }).fill(value);
			await dialog.getByRole('button', { name: 'Set Keyframe', exact: true }).click();
		}
		for (const frame of ['0', '30']) await dialog.getByRole('checkbox', { name: `Keyframe ${frame}`, exact: true }).uncheck();
		const first = dialog.locator('[data-motion-key-point="0/1"]'), last = dialog.locator('[data-motion-key-point="30/1"]');
		await expect(first).toHaveAttribute('aria-pressed', 'false'); await first.focus(); await ignoredActivation(first, activation); await page.keyboard.press(activation);
		await expect(first).toHaveAttribute('aria-pressed', 'true'); await expect(first).toBeFocused();
		await expect(dialog.getByRole('checkbox', { name: 'Keyframe 0', exact: true })).toBeChecked();
		await last.focus(); await page.keyboard.press(activation); await expect(last).toHaveAttribute('aria-pressed', 'true'); await expect(first).toHaveAttribute('aria-pressed', 'false');
		await expect(last).toBeFocused(); await page.keyboard.press('ArrowRight'); await expect(dialog.locator('[data-motion-key-point="31/1"]')).toBeVisible();
		await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(last).toBeVisible();
		await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(last).toHaveCount(0); await expect(first).toBeVisible();
		await expect(dialog.getByRole('alert')).toHaveCount(0);
	});
	test(`path ${activation} selects a focused vertex without moving it or adding Undo history`, async ({ page }) => {
		await create(page); await menu(page, 'Layer', 'Paths and Motion'); const dialog = page.getByRole('dialog', { name: 'Paths and Motion', exact: true });
		await dialog.getByRole('combobox', { name: 'Property', exact: true }).selectOption({ label: 'Shape 1: Path' });
		const first = dialog.locator('[data-motion-plane-point="vertex:0"]'), next = dialog.locator('[data-motion-plane-point="vertex:1"]');
		const x = Number(await next.getAttribute('data-motion-point-x')); const y = await next.getAttribute('data-motion-point-y');
		await expect(next).toHaveAttribute('aria-pressed', 'false'); await next.focus(); await ignoredActivation(next, activation); await page.keyboard.press(activation);
		await expect(next).toHaveAttribute('aria-pressed', 'true'); await expect(first).toHaveAttribute('aria-pressed', 'false'); await expect(next).toBeFocused();
		await expect(next).toHaveAttribute('data-motion-point-x', String(x)); await expect(next).toHaveAttribute('data-motion-point-y', y!);
		await expect(dialog.getByLabel('Point X', { exact: true })).toHaveValue(String(x));
		await page.keyboard.press('ArrowRight'); await expect(next).toHaveAttribute('data-motion-point-x', String(x + 1));
		await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(next).toHaveAttribute('data-motion-point-x', String(x));
		await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(dialog.locator('[data-motion-plane-point]')).toHaveCount(0);
		await expect(dialog.getByRole('alert')).toHaveCount(0);
	});
}
