/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { BufferSource, EncodedPacketSink, Input, WEBM } from 'mediabunny';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { importMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
import { createMotionscaperOfflineSite } from './helpers/motionscaper-offline-site.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { assertMotionPngDeliveryMatchesPreview, digest, snapshotMotionPreviewFrames } from './helpers/motionscaper-preview-delivery.ts';

async function menu(page: Page, top: string, command: string): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click();
	await page.getByRole('menuitem', { name: command, exact: true }).click();
}
async function fill(page: Page, fields: Readonly<Record<string, string>>): Promise<void> {
	for (const [name, value] of Object.entries(fields)) await page.getByRole('dialog').getByLabel(name, { exact: true }).fill(value);
}
async function createScene(page: Page, offlineOrigin?: string): Promise<void> {
	// The portable download route is shared by engines without a native picker.
	await page.addInitScript(() => { Object.defineProperty(globalThis, 'showSaveFilePicker', { value: undefined, configurable: true }); });
	await page.goto(offlineOrigin ? `${offlineOrigin}/en/` : '/en/');
	if (offlineOrigin) {
		await page.evaluate(async () => {
			await navigator.serviceWorker.ready;
			if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
		});
		// Load the product under the installed worker before exercising lazy tools.
		await page.reload();
	}
	await menu(page, 'File', 'New Composition');
	await fill(page, { 'Project title': 'Platform scene', Width: '64', Height: '48', 'Duration in frames': '3' });
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Layer', 'New Rectangle');
	await fill(page, { 'Layer name': 'Card', Width: '20', Height: '12', 'Position X': '4', 'Position Y': '4' });
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Layer', 'New Text');
	await fill(page, { 'Layer name': 'Title', Text: 'M', 'Font size': '18', Width: '32', Height: '24', 'Position X': '4', 'Position Y': '22', 'Fill color': '#ffffff' });
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function receipt(context: BrowserContext, info: TestInfo, details: Readonly<Record<string, unknown>>): Promise<void> {
	await info.attach('motion-platform-receipt', { body: JSON.stringify({ engine: info.project.name, version: context.browser()?.version(), ...details }, null, 2), contentType: 'application/json' });
}

test('platform shell stays isolated and German menus restore keyboard focus', async ({ page }: { page: Page }) => {
	const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
	await page.goto('/embed/de/'); await expect(page.locator('[data-motion-editor-bound]')).toBeVisible();
	await expect(page).toHaveTitle('Motionscaper'); await expect(page.locator('html')).toHaveAttribute('data-product', 'motionscaper');
	await expect(page.locator('[data-audio-editor], [data-frame-editor], [data-motion-workspace]')).toHaveCount(0);
	expect(await page.evaluate(async () => (await indexedDB.databases()).map(database => database.name))).toEqual([]);
	const file = page.getByRole('menuitem', { name: 'Datei', exact: true }); await file.focus(); await page.keyboard.press('Enter');
	await expect(page.getByRole('menuitem', { name: 'Neue Komposition', exact: true })).toBeFocused(); await page.keyboard.press('Enter');
	await expect(page.getByRole('dialog', { name: 'Neue Komposition', exact: true }).getByLabel('Projekttitel', { exact: true })).toBeFocused();
	await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(file).toBeFocused();
	await expect(page.locator('[data-motion-workspace]')).toHaveCount(0); expect(errors).toEqual([]);
});

test('platform retains authored keys and font bytes through save/reopen and matches PNG delivery to CanvasKit preview', async ({ page, context }: { page: Page; context: BrowserContext }, info: TestInfo) => {
	test.setTimeout(60_000); await createScene(page); await menu(page, 'Layer', 'Properties and Keyframes');
	const properties = page.getByRole('dialog'); await properties.getByLabel('Layer', { exact: true }).selectOption({ label: 'Card' });
	await properties.getByLabel('Property', { exact: true }).selectOption('transform.position');
	for (const [frame, value] of [['0', '4'], ['2', '20']] as const) {
		await fill(page, { 'Keyframe frame': frame, 'Keyframe value': value }); await properties.getByRole('button', { name: 'Set Keyframe', exact: true }).click();
	}
	await properties.getByRole('button', { name: 'Close', exact: true }).last().click(); await expect(properties).toHaveCount(0);
	await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device');
	const downloaded = page.waitForEvent('download'); await menu(page, 'File', 'Save Copy');
	const path = await (await downloaded).path(); if (!path) throw new Error('Missing portable project copy.');
	let retainedFontBytes = 0;
	const archived = await importMotionscaperArchive(new Blob([await readFile(path)]), () => ({
		async writeAssetChunk(asset, bytes) { if (asset.kind === 'font') retainedFontBytes += bytes.byteLength; },
		async finishAsset() {}, async commit() {}, async rollback() {},
	}));
	if (archived.kind !== 'current') throw new Error('The saved Motion project is not editable.');
	expect(archived.project.assets.filter(asset => asset.kind === 'font')).toHaveLength(1); expect(retainedFontBytes).toBeGreaterThan(1_000);
	await page.reload(); await expect(page.locator('[data-motion-workspace]')).toHaveCount(0); await menu(page, 'File', 'Project Library');
	await page.getByRole('button', { name: 'Platform scene', exact: true }).click();
	const frames = await snapshotMotionPreviewFrames(page, [0, 2]); const first = frames.get(0)!; const last = frames.get(2)!;
	expect(digest(first)).not.toBe(digest(last)); expect([...first.subarray((8 * 64 + 8) * 4, (8 * 64 + 8) * 4 + 4)]).toEqual([74, 128, 255, 255]);
	expect([...last.subarray((8 * 64 + 8) * 4, (8 * 64 + 8) * 4 + 4)]).toEqual([0, 0, 0, 0]);
	let textPixels = 0; for (let index = 22 * 64 * 4; index < first.length; index += 4) if (first[index]! > 240 && first[index + 1]! > 240 && first[index + 2]! > 240 && first[index + 3]! > 240) textPixels++;
	expect(textPixels).toBeGreaterThan(20); await assertMotionPngDeliveryMatchesPreview(page, frames);
	await receipt(context, info, { retainedFontBytes, textPixels, previewSha256: [...frames].map(([frame, pixels]) => ({ frame, sha256: digest(pixels) })), pngPreviewPixels: 'exact' });
});

test('platform either delivers real VP9 packets or visibly refuses unsupported encoding before a PNG recovery', async ({ page, context }: { page: Page; context: BrowserContext }, info: TestInfo) => {
	test.setTimeout(60_000); await createScene(page);
	const capability = await page.evaluate(async () => {
		const unsafeProbe = /^Linux\b/u.test(navigator.platform) && /\bAppleWebKit\//u.test(navigator.userAgent) && !/\b(?:Chrome|Chromium|HeadlessChrome|Edg|OPR)\//u.test(navigator.userAgent);
		if (unsafeProbe) return { supported: false, refusedBeforeProbe: true };
		if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return { supported: false, refusedBeforeProbe: false };
		try { return { supported: (await VideoEncoder.isConfigSupported({ codec: 'vp09.00.10.08', width: 64, height: 48, framerate: 30, bitrate: 8_000_000, latencyMode: 'quality', alpha: 'discard' })).supported === true, refusedBeforeProbe: false }; }
		catch { return { supported: false, refusedBeforeProbe: false }; }
	});
	await menu(page, 'File', 'Render'); const dialog = page.getByRole('dialog', { name: 'Render Composition', exact: true });
	await expect(dialog.getByRole('option', { name: /ProRes/u })).toHaveCount(0); await dialog.getByLabel('Output format', { exact: true }).selectOption('webm');
	await dialog.getByLabel('End frame (exclusive)', { exact: true }).fill('2');
	let downloads = 0; page.on('download', () => { downloads++; });
	if (capability.supported) {
		const downloaded = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Render', exact: true }).click();
		const path = await (await downloaded).path(); if (!path) throw new Error('The admitted VP9 render was not downloaded.');
		const input = new Input({ source: new BufferSource(await readFile(path)), formats: [WEBM] });
		try {
			const track = await input.getPrimaryVideoTrack(); if (!track) throw new Error('Missing generated VP9 track.');
			expect(track.codec).toBe('vp9'); expect([track.displayWidth, track.displayHeight]).toEqual([64, 48]);
			const timestamps: number[] = []; for await (const packet of new EncodedPacketSink(track).packets()) { expect(packet.data.byteLength).toBeGreaterThan(0); timestamps.push(packet.timestamp); }
			expect(timestamps).toEqual([0, 0.033]); expect(await input.computeDuration()).toBeCloseTo(0.066, 6);
		} finally { input.dispose(); }
		await expect(dialog.getByRole('status')).toHaveText('Render complete'); expect(downloads).toBe(1);
	} else {
		await dialog.getByRole('button', { name: 'Render', exact: true }).click();
		await expect(dialog.getByRole('alert')).toHaveText(capability.refusedBeforeProbe
			? 'Video encoding is unavailable in Linux WebKit. Choose a PNG sequence or another qualified browser.'
			: 'No VP9 browser encoder supports this canvas and frame rate.'); expect(downloads).toBe(0);
	}
	await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
	const frames = await snapshotMotionPreviewFrames(page, [0]); await assertMotionPngDeliveryMatchesPreview(page, frames);
	await receipt(context, info, { vp9: capability.supported ? 'actual two-packet WebM delivery' : 'explicit unsupported encoder refusal without download', refusedBeforeProbe: capability.refusedBeforeProbe, pngAfterAttempt: 'exact preview pixels' });
});

const offlineTest = test.extend<{ offlineSite: Awaited<ReturnType<typeof createMotionscaperOfflineSite>> }>({
	// eslint-disable-next-line no-empty-pattern -- Playwright requires fixture argument destructuring.
	offlineSite: async ({}, use) => {
		const site = await createMotionscaperOfflineSite();
		try { await use(site); } finally { await site.dispose(); }
	},
	// The context depends on this fixture; its collector finishes before the
	// authenticated clone and sibling maps are removed. Only this product is served.
	browserCoverageSites: async ({ offlineSite }, use) => { await use([offlineSite.descriptor]); },
});
offlineTest.describe('platform offline authoring', () => {
	offlineTest.use({ serviceWorkers: 'allow' });
	offlineTest('platform reopens a retained-font composition and its warmed CanvasKit preview offline', async ({ page, context, offlineSite: site }, info: TestInfo) => {
		test.setTimeout(60_000); const failures: string[] = [];
		page.on('requestfailed', request => failures.push(`${request.url()}: ${request.failure()?.errorText ?? 'failed'}`));
		page.on('pageerror', error => failures.push(error.message));
		await createScene(page, site.baseURL);
		const before = await snapshotMotionPreviewFrames(page, [0]); await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device');
		// Warm the opt-in library route before disconnecting, just like the renderer.
		await menu(page, 'File', 'Project Library'); await page.getByRole('button', { name: 'Platform scene', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
		// Closing the real origin also covers WebKit, whose driver offline emulation
		// refuses even a minimal cached service-worker document before dispatch.
		await site.close(); await page.reload({ waitUntil: 'domcontentloaded' }); await expect(page.locator('[data-motion-editor-bound]')).toBeVisible();
		await menu(page, 'File', 'Project Library');
		try { await expect(page.getByRole('dialog', { name: 'Project Library', exact: true })).toBeVisible(); }
		finally { await info.attach('offline-request-failures', { body: JSON.stringify(failures, null, 2), contentType: 'application/json' }); }
		await page.getByRole('button', { name: 'Platform scene', exact: true }).click();
		const after = await snapshotMotionPreviewFrames(page, [0]); expect(digest(after.get(0)!)).toBe(digest(before.get(0)!));
		await receipt(context, info, { offlineSavedScenePreview: 'exact retained-font and shape pixels' });
	});
});
