/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect } from './browser-coverage-fixture.js';

async function menu(page: Page, top: string, label: string): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click();
}
export async function snapshotMotionPreviewFrames(page: Page, frames: readonly number[]): Promise<Map<number, Buffer>> {
	await menu(page, 'View', 'Composition Preview'); const dialog = page.getByRole('dialog', { name: 'Composition Preview', exact: true }); const canvas = dialog.locator('canvas');
	const result = new Map<number, Buffer>();
	for (const frame of frames) {
		await dialog.getByLabel('Frame', { exact: true }).fill(String(frame)); await expect(canvas).toHaveAttribute('data-motion-frame', String(frame));
		result.set(frame, Buffer.from(await canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data))));
	}
	await expect(dialog.getByRole('button', { name: 'Close', exact: true }).last()).toBeEnabled(); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); return result;
}

export async function assertMotionPngDeliveryMatchesPreview(page: Page, frames: ReadonlyMap<number, Buffer>): Promise<void> {
	const requested = [...frames.keys()]; const first = Math.min(...requested); const end = Math.max(...requested) + 1;
	if (!requested.length || !Number.isSafeInteger(first) || first < 0 || end > 32_768) throw new Error('A bounded preview frame range is required.');
	await menu(page, 'File', 'Render'); const dialog = page.getByRole('dialog', { name: 'Render Composition', exact: true });
	await dialog.getByLabel('End frame (exclusive)', { exact: true }).fill(String(end)); await dialog.getByLabel('First frame', { exact: true }).fill(String(first));
	const downloaded = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Render', exact: true }).click(); const path = await (await downloaded).path(); if (!path) throw new Error('The PNG sequence is unavailable.');
	const entries = pngEntries(await readFile(path)); const metadata = JSON.parse(new TextDecoder().decode(entries.get('sequence.json'))) as { firstFrame: number; frameCount: number };
	expect(metadata.firstFrame).toBe(first); expect(metadata.frameCount).toBe(end - first);
	for (const [frame, preview] of frames) {
		const bytes = entries.get(`frames/frame${String(frame - first + 1).padStart(12, '0')}.png`); expect(bytes).toBeDefined();
		const decoded = await page.evaluate(async bytes => {
			const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' })); const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
			const context = canvas.getContext('2d')!; try { context.drawImage(bitmap, 0, 0); return Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data); } finally { bitmap.close(); }
		}, Array.from(bytes!));
		expect(digest(Buffer.from(decoded)), `delivered frame ${String(frame)}`).toBe(digest(preview));
	}
	await expect(dialog.getByRole('status')).toHaveText('Render complete'); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
}
export function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function pngEntries(bytes: Uint8Array): Map<string, Uint8Array> {
	const entries = new Map<string, Uint8Array>(); const decode = new TextDecoder();
	for (let offset = 0; offset + 512 <= bytes.length && bytes[offset];) {
		const name = decode.decode(bytes.subarray(offset, offset + 100)).split('\0')[0]!;
		const size = Number.parseInt(decode.decode(bytes.subarray(offset + 124, offset + 136)), 8);
		if (!Number.isSafeInteger(size) || size < 0 || size > bytes.length - offset - 512) throw new Error('The generated sequence contains an invalid tar entry.');
		entries.set(name, bytes.slice(offset + 512, offset + 512 + size)); offset += 512 + Math.ceil(size / 512) * 512;
	}
	return entries;
}
