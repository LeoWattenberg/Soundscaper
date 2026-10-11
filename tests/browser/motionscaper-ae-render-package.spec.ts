/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { BlobReader, BlobWriter, TextWriter, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { ordinaryBrowserProductSitePlan } from '../../scripts/lib/browser-product-site-plan.mjs';
import { motionAeRenderFixture } from '../helpers/motionscaper-ae-render-fixture.ts';
import { exportMotionscaperArchive, importMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
import { prepareMotionAeHostImport } from '../../src/common/editor/motion-ae-host-import-plan.ts';
import { createMotionscaperRevision } from '../../src/motionscaper/editor-project-revision.ts';
import { digestScapeBytes } from '../../src/common/editor/scape-archive-media.ts';
import type { MotionAeExchange } from '../../src/common/editor/motion-ae-exchange-types.ts';
test.use({ baseURL: ordinaryBrowserProductSitePlan().sites[2]!.origin });
async function menu(page: Page, command: string): Promise<void> { await page.getByRole('menuitem', { name: 'File', exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click(); }
async function open(page: Page, duration = 3) {
	const fixture = motionAeRenderFixture(duration), archive = await exportMotionscaperArchive(fixture.project, () => new Blob([fixture.bytes])); if (!archive) throw new Error('Missing fixture archive.');
	await page.goto('/embed/en/'); await menu(page, 'Open'); await page.getByLabel('Scape project (.mscape, .fscape, .sscape)', { exact: true }).setInputFiles({ name: 'Source.mscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); return fixture;
}
function tarEntries(bytes: Uint8Array): Map<string, Uint8Array> {
	const entries = new Map<string, Uint8Array>(), decoder = new TextDecoder();
	for (let at = 0; at + 512 <= bytes.length && bytes[at];) { const name = decoder.decode(bytes.subarray(at, at + 100)).split('\0')[0]!, size = Number.parseInt(decoder.decode(bytes.subarray(at + 124, at + 136)), 8); entries.set(name, bytes.slice(at + 512, at + 512 + size)); at += 512 + Math.ceil(size / 512) * 512; }
	return entries;
}
test('Motion AE rendered File transfer matches every normal full-quality PNG, preserves complete original custody and admits a muted host composition', async ({ page }) => {
	await page.addInitScript(() => { Object.defineProperty(globalThis, 'showSaveFilePicker', { value: undefined, configurable: true }); });
	const fixture = await open(page); await menu(page, 'Render'); const render = page.getByRole('dialog', { name: 'Render Composition', exact: true });
	await render.getByRole('button', { name: 'Use Full Composition', exact: true }).click(); const normalDownload = page.waitForEvent('download'); await render.getByRole('button', { name: 'Render', exact: true }).click(); const normal = await normalDownload; const png = tarEntries(await readFile((await normal.path())!)); await render.getByRole('button', { name: 'Close', exact: true }).last().click();
	await menu(page, 'After Effects Bridge'); const dialog = page.getByRole('dialog', { name: 'After Effects Bridge', exact: true });
	await dialog.getByRole('button', { name: 'Review Rendered Transfer', exact: true }).click(); const review = dialog.getByRole('region', { name: 'Complete rendered transfer', exact: true });
	await expect(review).toContainText('8-bit sRGB'); await expect(review).toContainText('Audio is omitted'); const download = review.getByRole('button', { name: 'Render and Download AE Package', exact: true }); await expect(download).toBeDisabled(); await review.getByRole('checkbox').check();
	const pending = page.waitForEvent('download'); await download.click(); const artifact = await pending; const zip = new ZipReader(new BlobReader(new Blob([new Uint8Array(await readFile((await artifact.path())!))])));
	try {
		const entries = await zip.getEntries(); const get = (name: string) => { const item = entries.find(entry => entry.filename === name); if (!item || item.directory) throw new Error(`Missing ${name}`); return item; };
		const manifest = await get('motionae.json').getData!(new TextWriter()), exchange = JSON.parse(manifest) as MotionAeExchange, host = prepareMotionAeHostImport(manifest);
		expect(host.muteAudio).toBe(true); expect(host.compositions[0]!.layers).toHaveLength(3); expect(exchange.source.revisionDigest).toBe(createMotionscaperRevision(fixture.project).digest); expect(exchange.report.filter(entry => entry.code === 'composition-render-frame')).toHaveLength(3);
		for (let index = 0; index < 3; index++) { const bytes = await get(`media/render-frame-${index}.png`).getData!(new Uint8ArrayWriter()); expect(bytes).toEqual(png.get(`frames/frame${String(index + 1).padStart(12, '0')}.png`)); expect(digestScapeBytes(bytes)).toBe(exchange.footage[index]!.sha256); }
		expect(png.get('frames/frame000000000001.png')).not.toEqual(png.get('frames/frame000000000002.png'));
		const retained: Uint8Array[] = []; const original = await importMotionscaperArchive(await get('original.mscape').getData!(new BlobWriter()), () => ({ async writeAssetChunk(_asset, chunk) { retained.push(chunk); }, async finishAsset() {}, async commit() {}, async rollback() {} }));
		if (original.kind !== 'current') throw new Error('Expected complete Motion custody.'); expect(original.project).toEqual(fixture.project); expect(Buffer.concat(retained)).toEqual(Buffer.from(fixture.bytes));
		const sequence = JSON.parse(await get('sequence.json').getData!(new TextWriter())) as { frameRate: unknown; frameCount: number; firstFrame: number; temporal: { samples: number }; depthOfFieldSamples: number; audio: string };
		expect(sequence.frameRate).toEqual({ num: 30000, den: 1001 }); expect(sequence.frameCount).toBe(3); expect(sequence.firstFrame).toBe(0); expect(sequence.temporal.samples).toBe(4); expect(sequence.depthOfFieldSamples).toBe(4); expect(sequence.audio).toBe('omitted');
		const pixels = await page.evaluate(async (bytes: number[]) => { const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' })); const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close(); const data = context.getImageData(0, 0, canvas.width, canvas.height).data; return { visible: data.filter((_value, index) => index % 4 === 3 && data[index]! > 0).length, partial: data.filter((_value, index) => index % 4 === 3 && data[index]! > 0 && data[index]! < 128).length }; }, [...png.get('frames/frame000000000001.png')!]);
		expect(pixels.visible).toBeGreaterThan(0); expect(pixels.partial).toBeGreaterThan(0);
	} finally { await zip.close(); }
	await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device');
});
test('Motion AE rendered menu refuses a partial over-budget composition and cancels a real render without a download', async ({ page }) => {
	await open(page, 257); await menu(page, 'After Effects Bridge'); let dialog = page.getByRole('dialog', { name: 'After Effects Bridge', exact: true }); await dialog.getByRole('button', { name: 'Review Rendered Transfer', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('256 frames'); await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await open(page, 256); await menu(page, 'After Effects Bridge'); dialog = page.getByRole('dialog', { name: 'After Effects Bridge', exact: true }); await dialog.getByRole('button', { name: 'Review Rendered Transfer', exact: true }).click(); const review = dialog.getByRole('region', { name: 'Complete rendered transfer', exact: true }); await review.getByRole('checkbox').check();
	const downloads: string[] = []; page.on('download', value => downloads.push(value.suggestedFilename())); await review.getByRole('button', { name: 'Render and Download AE Package', exact: true }).click(); await expect.poll(async () => Number(await review.getByRole('progressbar').getAttribute('value'))).toBeGreaterThan(0); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(dialog).toContainText('Transfer cancelled'); expect(downloads).toEqual([]); await expect(review.getByRole('button', { name: 'Render and Download AE Package', exact: true })).toBeEnabled();
});
