/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { motionTrackingVideo } from './helpers/motionscaper-tracking-source.ts';
import { assertMotionPngDeliveryMatchesPreview, digest, snapshotMotionPreviewFrames } from './helpers/motionscaper-preview-delivery.ts';

async function menu(page: Page, top: string, label: string): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click();
}
async function close(page: Page): Promise<void> {
	await expect(page.getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
}
function alpha(pixels: Buffer, x: number, y: number): number { return pixels[(y * 64 + x) * 4 + 3]!; }

test('M07 keyed footage and animated mask correction survive history/reopen with identical preview and delivered PNG frames', async ({ page }) => {
	test.setTimeout(60_000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
	await page.addInitScript(() => { Object.defineProperty(globalThis, 'showSaveFilePicker', { value: undefined, configurable: true }); });
	await page.goto('/embed/en/'); const video = await motionTrackingVideo(page, { frameCount: 6, greenScreen: true });
	await menu(page, 'File', 'New Composition');
	for (const [name, value] of [['Project title', 'Keyed mask correction'], ['Width', '64'], ['Height', '64'], ['Frame rate numerator', '24'], ['Duration in frames', '6']] as const) await page.getByLabel(name, { exact: true }).fill(value);
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'File', 'Import Media'); await page.getByLabel('Media file', { exact: true }).setInputFiles({ name: 'Green plate.mp4', mimeType: 'video/mp4', buffer: video }); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Layer', 'Masks and Compositing'); const compositing = page.getByRole('dialog', { name: 'Masks and Compositing', exact: true });
	await compositing.getByLabel('Mask width', { exact: true }).fill('44'); await compositing.getByLabel('Mask height', { exact: true }).fill('64');
	await compositing.getByRole('button', { name: 'Add Mask', exact: true }).click(); await expect(compositing.locator('[data-motion-mask]')).toHaveCount(1);
	await compositing.getByRole('combobox', { name: 'Effect type', exact: true }).selectOption('chroma-key'); await compositing.getByRole('button', { name: 'Add Effect', exact: true }).click(); await expect(compositing.locator('[data-motion-effect]')).toHaveCount(1); await close(page);
	await menu(page, 'Layer', 'Paths and Motion'); const paths = page.getByRole('dialog', { name: 'Paths and Motion', exact: true });
	await paths.getByRole('combobox', { name: 'Property', exact: true }).selectOption({ label: 'Mask 1: Path' });
	await paths.getByRole('combobox', { name: 'Path edit target', exact: true }).selectOption('key'); await paths.getByRole('button', { name: 'Set Path Keyframe', exact: true }).click();
	await paths.getByLabel('Local frame', { exact: true }).fill('5');
	for (const vertex of [1, 2]) {
		await paths.locator(`[data-motion-plane-point="vertex:${String(vertex)}"]`).click(); await paths.getByLabel('Point X', { exact: true }).fill('35'); await paths.getByRole('button', { name: 'Apply Point', exact: true }).click();
		await expect(paths.locator(`[data-motion-plane-point="vertex:${String(vertex)}"]`)).toHaveAttribute('data-motion-point-x', '35');
	}
	await paths.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(paths.locator('[data-motion-plane-point="vertex:2"]')).toHaveAttribute('data-motion-point-x', '44');
	await paths.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(paths.locator('[data-motion-plane-point="vertex:2"]')).toHaveAttribute('data-motion-point-x', '35'); await close(page);
	const frames = [0, 2, 5] as const; const before = await snapshotMotionPreviewFrames(page, frames);
	expect(alpha(before.get(0)!, 0, 0)).toBe(0); expect(alpha(before.get(0)!, 14, 14)).toBe(255); expect(alpha(before.get(5)!, 34, 34)).toBe(255); expect(alpha(before.get(5)!, 36, 36)).toBe(0);
	expect(digest(before.get(0)!)).not.toBe(digest(before.get(5)!));
	await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload();
	await menu(page, 'File', 'Project Library'); await page.getByRole('button', { name: 'Keyed mask correction', exact: true }).click(); const reopened = await snapshotMotionPreviewFrames(page, frames);
	for (const frame of frames) expect(digest(reopened.get(frame)!)).toBe(digest(before.get(frame)!));
	await assertMotionPngDeliveryMatchesPreview(page, reopened); expect(errors).toEqual([]);
});
