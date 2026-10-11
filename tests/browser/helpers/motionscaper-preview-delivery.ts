/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Download, Locator, Page } from '@playwright/test';
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

/** These callers author 64x64 at 30 fps, with the default 8 Mbps video/128 kbps stereo audio. */
async function motionVideoRefusalWitness(page: Page, format: string, audio: boolean): Promise<string | null> {
	if (format !== 'mp4' && format !== 'webm') throw new Error('A video delivery witness requires MP4 or WebM.');
	return page.evaluate(async ({ format, audio }) => {
		// Do not touch either encoder on this host: its native GStreamer probe can terminate the page.
		if (/^Linux\b/u.test(navigator.platform) && /\bAppleWebKit\//u.test(navigator.userAgent)
			&& !/\b(?:Chrome|Chromium|HeadlessChrome|Edg|OPR)\//u.test(navigator.userAgent)) {
			return 'Video encoding is unavailable in Linux WebKit. Choose a PNG sequence or another qualified browser.';
		}
		const mp4 = format === 'mp4'; let videoSupported = false;
		if (typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined') {
			for (const codec of mp4 ? ['avc1.640034', 'avc1.64002a', 'avc1.42001f'] : ['vp09.00.10.08']) {
				const config: VideoEncoderConfig = { codec, width: 64, height: 64, framerate: 30, bitrate: 8_000_000,
					latencyMode: 'quality', alpha: 'discard', ...(mp4 ? { avc: { format: 'avc' as const } } : {}) };
				try { if ((await VideoEncoder.isConfigSupported(config)).supported === true) { videoSupported = true; break; } } catch { /* Native refusal is a capability result. */ }
			}
		}
		if (!videoSupported) return `No ${mp4 ? 'H.264' : 'VP9'} browser encoder supports this canvas and frame rate.`;
		if (audio) {
			let audioSupported = false;
			if (typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined') {
				const config = { codec: mp4 ? 'mp4a.40.2' : 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000,
					...(mp4 ? { aac: { format: 'aac' as const } } : { opus: { format: 'opus' as const } }) };
				try { audioSupported = (await AudioEncoder.isConfigSupported(config)).supported === true; } catch { /* Native refusal is a capability result. */ }
			}
			if (!audioSupported) return `No ${mp4 ? 'AAC' : 'Opus'} browser audio encoder supports this sample rate and channel layout. Choose another container.`;
		}
		return null;
	}, { format, audio });
}

/** Exercise actual product admission; capable hosts must produce a completed download. */
export async function attemptMotionVideoDelivery(page: Page, dialog: Locator, { audio = false }: { audio?: boolean } = {}): Promise<Download | null> {
	const downloads: Download[] = []; const received = (download: Download): void => { downloads.push(download); };
	page.on('download', received);
	try {
		const expectedRefusal = await motionVideoRefusalWitness(page, await dialog.getByLabel('Output format', { exact: true }).inputValue(), audio);
		await dialog.getByRole('button', { name: 'Render', exact: true }).click();
		await expect.poll(async () => await dialog.getByRole('alert').count() > 0
			|| await dialog.getByRole('status').textContent() === 'Render complete', { timeout: 30_000 }).toBe(true);
		await expect(dialog.getByRole('button', { name: 'Render', exact: true })).toBeEnabled();
		await expect(dialog.getByRole('progressbar')).toHaveCount(0);
		if (await dialog.getByRole('alert').count()) {
			expect(expectedRefusal, 'Native encoder support must independently justify product refusal').not.toBeNull();
			await expect(dialog.getByRole('alert')).toHaveText(expectedRefusal!);
			expect(downloads).toEqual([]); return null;
		}
		expect(expectedRefusal, 'Delivery must agree with native capability and the Linux WebKit pre-probe boundary').toBeNull();
		await expect.poll(() => downloads.length).toBe(1); return downloads[0]!;
	} finally { page.off('download', received); }
}
