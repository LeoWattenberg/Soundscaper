/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { attemptMotionVideoDelivery, assertMotionPngDeliveryMatchesPreview, snapshotMotionPreviewFrames } from './helpers/motionscaper-preview-delivery.ts';
async function menu(page: Page, top: string, command: string): Promise<void> { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click(); }
async function create(page: Page): Promise<void> {
	await page.addInitScript(() => { Object.defineProperty(globalThis, 'showSaveFilePicker', { value: undefined, configurable: true }); });
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
	await page.getByLabel('Width', { exact: true }).fill('64'); await page.getByLabel('Height', { exact: true }).fill('64'); await page.getByLabel('Duration in frames', { exact: true }).fill('60');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
}
test('saved exact work areas drive fractional preview and declared output-grid samples', async ({ page }: { page: Page }) => {
	await create(page); await menu(page, 'View', 'Timeline'); const timeline = page.getByRole('dialog', { name: 'Timeline', exact: true });
	await timeline.getByLabel('Work area start', { exact: true }).fill('3/2'); await timeline.getByLabel('Work area end (exclusive)', { exact: true }).fill('13/4');
	await timeline.getByRole('button', { name: 'Set Work Area', exact: true }).click(); await expect(timeline.locator('[data-motion-work-area]')).toHaveAttribute('data-motion-work-start', '3/2');
	await timeline.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(timeline.locator('[data-motion-work-area]')).toHaveAttribute('data-motion-work-start', '0');
	await timeline.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(timeline.getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await page.keyboard.press('Escape'); await expect(timeline).toHaveCount(0);
	await menu(page, 'View', 'Composition Preview'); const preview = page.getByRole('dialog', { name: 'Composition Preview', exact: true });
	await expect(preview.locator('canvas')).toHaveAttribute('data-motion-frame', '3/2'); await preview.getByLabel('Frame', { exact: true }).fill('5/2'); await expect(preview.locator('canvas')).toHaveAttribute('data-motion-frame', '5/2');
	await page.keyboard.press('Escape'); await expect(preview).toHaveCount(0); await menu(page, 'File', 'Render'); const render = page.getByRole('dialog', { name: 'Render Composition', exact: true });
	await expect(render.getByLabel('First frame', { exact: true })).toHaveValue('2'); await expect(render.getByLabel('End frame (exclusive)', { exact: true })).toHaveValue('4');
	await render.getByLabel('Output format', { exact: true }).selectOption('webm');
	const download = await attemptMotionVideoDelivery(page, render);
	if (download) {
		const path = await download.path(); if (!path) throw new Error('Output is unavailable.');
		const { Input, BufferSource, ALL_FORMATS } = await import('mediabunny'); const input = new Input({ source: new BufferSource(await readFile(path)), formats: ALL_FORMATS });
		try { expect((await (await input.getPrimaryVideoTrack())!.computePacketStats()).packetCount).toBe(2); } finally { input.dispose(); }
		await expect(render.getByRole('status')).toHaveText('Render complete'); await page.keyboard.press('Escape'); await expect(render).toHaveCount(0);
	} else {
		await page.keyboard.press('Escape'); await expect(render).toHaveCount(0);
		await assertMotionPngDeliveryMatchesPreview(page, await snapshotMotionPreviewFrames(page, [2, 3]));
	}
	await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload(); await menu(page, 'File', 'Project Library');
	await page.getByRole('button', { name: 'Untitled Composition', exact: true }).click(); await menu(page, 'View', 'Timeline'); await expect(timeline.getByLabel('Work area start', { exact: true })).toHaveValue('3/2');
	await timeline.getByLabel('Work area start', { exact: true }).fill('1/4'); await timeline.getByLabel('Work area end (exclusive)', { exact: true }).fill('3/4'); await timeline.getByRole('button', { name: 'Set Work Area', exact: true }).click();
	await expect(timeline.locator('[data-motion-work-area]')).toHaveAttribute('data-motion-work-start', '1/4'); await expect(timeline.getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await page.keyboard.press('Escape'); await menu(page, 'File', 'Render');
	await expect(render.getByRole('alert')).toContainText('contains no whole-frame sample'); await expect(render.getByRole('button', { name: 'Render', exact: true })).toBeDisabled();
	await render.getByRole('button', { name: 'Use Full Composition', exact: true }).click(); await expect(render.getByRole('button', { name: 'Render', exact: true })).toBeEnabled();
});
test('preview and render can target a nested composition with its own saved work area', async ({ page }: { page: Page }) => {
	await create(page); await menu(page, 'Layer', 'New Rectangle'); await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'View', 'Timeline'); const timeline = page.getByRole('dialog', { name: 'Timeline', exact: true });
	await timeline.getByRole('checkbox', { name: 'New Rectangle', exact: true }).check(); await timeline.getByLabel('Group name', { exact: true }).fill('Nested scene');
	await timeline.getByRole('button', { name: 'Precompose', exact: true }).click(); await expect(timeline.locator('[data-motion-layer-row]')).toHaveCount(1);
	await timeline.getByRole('combobox', { name: 'Composition', exact: true }).selectOption({ label: 'Nested scene' });
	await timeline.getByLabel('Work area start', { exact: true }).fill('10'); await timeline.getByLabel('Work area end (exclusive)', { exact: true }).fill('12'); await timeline.getByRole('button', { name: 'Set Work Area', exact: true }).click();
	await expect(timeline.locator('[data-motion-work-area]')).toHaveAttribute('data-motion-work-start', '10'); await expect(timeline.getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await page.keyboard.press('Escape'); await menu(page, 'View', 'Composition Preview');
	const preview = page.getByRole('dialog', { name: 'Composition Preview', exact: true }); await preview.getByRole('combobox', { name: 'Composition', exact: true }).selectOption({ label: 'Nested scene' });
	await expect(preview.locator('canvas')).toHaveAttribute('data-motion-frame', '10'); await page.keyboard.press('Escape'); await menu(page, 'File', 'Render');
	const render = page.getByRole('dialog', { name: 'Render Composition', exact: true }); await render.getByRole('combobox', { name: 'Composition', exact: true }).selectOption({ label: 'Nested scene' });
	await expect(render.getByLabel('First frame', { exact: true })).toHaveValue('10'); await expect(render.getByLabel('End frame (exclusive)', { exact: true })).toHaveValue('12');
});
