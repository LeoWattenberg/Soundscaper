/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { MOTION_WEBM_TIMECODE_QUANTUM_SECONDS } from '../../src/common/editor/motion-video-delivery.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { attemptMotionVideoDelivery, assertMotionPngDeliveryMatchesPreview, snapshotMotionPreviewFrames } from './helpers/motionscaper-preview-delivery.ts';

async function menu(page: Page, top: string, command: string): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click();
	await page.getByRole('menuitem', { name: command, exact: true }).click();
}
function tarEntries(bytes: Uint8Array): Map<string, Uint8Array> {
	const entries = new Map<string, Uint8Array>(); const decode = new TextDecoder();
	for (let offset = 0; offset + 512 <= bytes.length && bytes[offset];) {
		const name = decode.decode(bytes.subarray(offset, offset + 100)).split('\0')[0]!;
		const size = Number.parseInt(decode.decode(bytes.subarray(offset + 124, offset + 136)), 8);
		entries.set(name, bytes.slice(offset + 512, offset + 512 + size)); offset += 512 + Math.ceil(size / 512) * 512;
	}
	return entries;
}

test('File Render exports a pinned transparent PNG sequence with exact frame metadata and pixels', async ({ page }: { page: Page }) => {
	await page.addInitScript(() => { Object.defineProperty(globalThis, 'showSaveFilePicker', { value: undefined, configurable: true }); });
	await page.goto('/embed/en/');
	await menu(page, 'File', 'New Composition');
	await page.getByLabel('Project title', { exact: true }).fill('Alpha render');
	await page.getByLabel('Width', { exact: true }).fill('64'); await page.getByLabel('Height', { exact: true }).fill('64');
	await page.getByLabel('Duration in frames', { exact: true }).fill('2');
	await page.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Layer', 'New Solid');
	await page.getByLabel('Fill color', { exact: true }).fill('#ff0000'); await page.getByLabel('Opacity (%)', { exact: true }).fill('50');
	await page.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'File', 'Render');
	const dialog = page.getByRole('dialog', { name: 'Render Composition', exact: true });
	await expect(dialog.getByLabel('Output format', { exact: true })).toHaveValue('png');
	const pending = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Render', exact: true }).click();
	const download = await pending; expect(download.suggestedFilename()).toBe('Alpha render.tar');
	const path = await download.path(); if (!path) throw new Error('Rendered download is unavailable.');
	const entries = tarEntries(await readFile(path));
	expect([...entries.keys()]).toEqual(['frames/frame000000000001.png', 'frames/frame000000000002.png', 'sequence.json']);
	const metadata = JSON.parse(new TextDecoder().decode(entries.get('sequence.json'))) as { frameRate: { num: number; den: number }; firstFrame: number; frameCount: number; alphaMode: string };
	expect(metadata.frameRate).toEqual({ num: 30, den: 1 }); expect(metadata.firstFrame).toBe(0); expect(metadata.frameCount).toBe(2); expect(metadata.alphaMode).toBe('straight');
	const pixel = await page.evaluate(async (bytes: number[]) => {
		const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }));
		const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
		const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close();
		return Array.from(context.getImageData(8, 8, 1, 1).data);
	}, Array.from(entries.get('frames/frame000000000001.png')!));
	expect(pixel).toEqual([255, 0, 0, 128]);
	await expect(dialog.getByRole('status')).toHaveText('Render complete');
	await expect(page.locator('[data-motion-save-status]')).toHaveText('Unsaved changes');
});

for (const format of ['mp4', 'webm'] as const) test(`File Render attempts ${format} delivery or visibly refuses before PNG recovery without publishing the draft`, async ({ page }: { page: Page }) => {
	await page.addInitScript(() => { Object.defineProperty(globalThis, 'showSaveFilePicker', { value: undefined, configurable: true }); });
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
	await page.getByLabel('Width', { exact: true }).fill('64'); await page.getByLabel('Height', { exact: true }).fill('64');
	await page.getByLabel('Duration in frames', { exact: true }).fill('2');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Layer', 'New Solid'); await page.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.locator('[data-motion-save-status]')).toHaveText('Unsaved changes');
	await menu(page, 'File', 'Render'); const dialog = page.getByRole('dialog', { name: 'Render Composition', exact: true });
	await dialog.getByLabel('Output format', { exact: true }).selectOption(format);
	await expect(dialog).toContainText('Video replaces transparent areas');
	const download = await attemptMotionVideoDelivery(page, dialog);
	if (!download) {
		await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
		await assertMotionPngDeliveryMatchesPreview(page, await snapshotMotionPreviewFrames(page, [0, 1]));
		await expect(page.locator('[data-motion-save-status]')).toHaveText('Unsaved changes'); return;
	}
	expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`, 'u'));
	const path = await download.path(); if (!path) throw new Error('Video download is unavailable.');
	const { Input, BufferSource, ALL_FORMATS } = await import('mediabunny');
	const input = new Input({ source: new BufferSource(await readFile(path)), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryVideoTrack(); expect(track).not.toBeNull();
		expect(await track!.getDisplayWidth()).toBe(64); expect(await track!.getDisplayHeight()).toBe(64);
		expect((await track!.computePacketStats()).packetCount).toBe(2);
		const duration = await input.computeDuration();
		if (format === 'webm') expect(Math.abs(duration - 2 / 30)).toBeLessThanOrEqual(MOTION_WEBM_TIMECODE_QUANTUM_SECONDS);
		else expect(duration).toBeCloseTo(2 / 30, 5);
	} finally { input.dispose(); }
	await expect(dialog.getByRole('status')).toHaveText('Render complete');
	await expect(page.locator('[data-motion-save-status]')).toHaveText('Unsaved changes');
});

test('a running render can be cancelled and restarted without publishing partial output', async ({ page }: { page: Page }) => {
	await page.addInitScript(() => { Object.defineProperty(globalThis, 'showSaveFilePicker', { value: undefined, configurable: true }); });
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
	await page.getByLabel('Width', { exact: true }).fill('64'); await page.getByLabel('Height', { exact: true }).fill('64');
	await page.getByLabel('Duration in frames', { exact: true }).fill('1000');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'File', 'Render'); const dialog = page.getByRole('dialog', { name: 'Render Composition', exact: true });
	const downloads: string[] = []; page.on('download', (download) => downloads.push(download.suggestedFilename()));
	await dialog.getByRole('button', { name: 'Render', exact: true }).click();
	await expect(dialog.getByRole('progressbar')).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Render', exact: true })).toBeEnabled();
	await expect(dialog.getByRole('progressbar')).toHaveCount(0);
	await expect(dialog.getByRole('alert')).toHaveCount(0); expect(downloads).toEqual([]);
	await dialog.getByLabel('End frame (exclusive)', { exact: true }).fill('2');
	const pending = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Render', exact: true }).click(); await pending;
	await expect(dialog.getByRole('status')).toHaveText('Render complete'); expect(downloads).toHaveLength(1);
});
