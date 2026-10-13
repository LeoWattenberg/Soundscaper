/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/motionscaper-linked-fixture.js';
import { motionscaperMixedPreviewFixture } from '../helpers/motionscaper-mixed-preview-fixture.ts';
import { exportFramescaperSuccessorPortableArchive } from '../../src/framescaper/editor-project-successor-portable-export.ts';

async function menu(page: Page, item: string | RegExp): Promise<void> {
	await page.getByRole('menuitem', { name: 'File', exact: true }).click();
	await page.getByRole('menuitem', { name: item, exact: typeof item === 'string' }).click();
}
async function picture(page: Page): Promise<number[]> {
	return page.locator('[data-video-preview-cpu-canvas]').evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data]);
}

for (const adjustment of [false, true]) test(`successor File Open displays complete mixed CPU output or explicitly refuses GPU-only adjustment (adjustment=${String(adjustment)})`, async ({ page }) => {
	const { project, image } = motionscaperMixedPreviewFixture(false, adjustment);
	const output = await exportFramescaperSuccessorPortableArchive(project, {
		getMediaAssetMetadata: async id => id === image.source.storageKey ? { sourceId: id, size: image.bytes.length, sha256: image.source.contentSha256 } : null,
		loadMediaAsset: async id => { if (id !== image.source.storageKey) throw new Error('No encoded linked source exists'); return new Blob([image.bytes.slice()]); },
		async *readSourceChunks() { yield []; throw new Error('No ordinary PCM exists'); },
	}, { readAsset: async () => null });
	if (!output.blob) throw new Error('No mixed successor archive');
	const bytes = Buffer.from(await output.blob.arrayBuffer()); const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.addInitScript(() => {
		const original = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: [contextId: string, options?: unknown]): unknown {
			return args[0] === 'webgl2' ? null : Reflect.apply(original, this, args);
		} as typeof original;
	});
	await page.goto('/embed/en/'); await expect(page.locator('[data-audio-editor-bound="true"]')).toBeVisible();
	await expect(page.locator('[data-editor-ready]')).toHaveAttribute('data-editor-ready', 'true');
	await expect(page.locator('[data-project-id]')).not.toHaveAttribute('data-project-activation-pending', 'true');
	await expect(page.locator('[data-project-id]')).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	const selecting = page.waitForEvent('filechooser'); await menu(page, /^Open\s+Ctrl\+O$/u);
	await (await selecting).setFiles({ name: 'Mixed.fscape', mimeType: 'application/zip', buffer: bytes });
	await expect(page.locator('[data-project-id]')).toHaveAttribute('data-project-id', project.id);
	if (adjustment) {
		await expect(page.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-visual-error', /WebGL2/iu);
		await expect(page.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-renderer', 'fallback');
		await expect(page.locator('[data-video-preview-cpu-canvas]')).not.toHaveAttribute('data-renderer-state', 'ready');
		expect(errors).toEqual([]); return;
	}
	await expect(page.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-renderer', 'cpu');
	await expect(page.locator('[data-video-preview-renderer-warning]')).toHaveCount(0);
	await expect(page.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-visual-error', '');
	await expect(page.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-omitted-composition-clip-ids', '');
	await expect(page.locator('[data-video-preview-cpu-canvas]')).toHaveJSProperty('width', 4);
	const first = await picture(page); expect(first[0]).toBeGreaterThan(150); expect(first[1]).toBeGreaterThan(10);
	expect(first[12]).toBeGreaterThan(30); expect(first[12]).toBeLessThan(80); expect(first[15]).toBe(255);
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(async () => (await picture(page))[12]).toBeGreaterThan(80);
	await page.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect.poll(() => picture(page)).toEqual(first);
	await page.reload(); await expect(page.locator('[data-audio-editor-bound="true"]')).toBeVisible();
	await expect(page.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-renderer', 'cpu');
	expect(await picture(page)).toEqual(first);
	await menu(page, /^New\s+Ctrl\+N$/u); await expect(page.locator('[data-video-preview-cpu-canvas]')).toHaveJSProperty('width', 0);
	expect(errors).toEqual([]);
});
