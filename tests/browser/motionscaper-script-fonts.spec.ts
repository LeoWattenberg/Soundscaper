/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import CanvasKitInit from 'canvaskit-wasm';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { importMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
import { compileMotionscaperProject } from '../../src/motionscaper/editor-project-evaluation.ts';
import { createCanvasKitMotionRasterizer } from '../../src/common/editor/motion-canvaskit-rasterizer.ts';
import { renderMotionCompositionFrame } from '../../src/common/editor/motion-composition-renderer.ts';
import { motionSurfaceToRgba8 } from '../../src/common/editor/motion-surface.ts';
async function menu(page: Page, top: string, command: string): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click();
}
async function close(page: Page): Promise<void> { await page.getByRole('button', { name: 'Close', exact: true }).last().click(); await expect(page.getByRole('dialog')).toHaveCount(0); }
async function preview(page: Page): Promise<number[]> {
	await menu(page, 'View', 'Composition Preview'); await expect(page.locator('[data-motion-frame]')).toHaveAttribute('data-motion-frame', '0');
	return pixels(page);
}
async function pixels(page: Page): Promise<number[]> {
	return page.locator('[data-motion-frame]').evaluate((canvas: HTMLCanvasElement) => Array.from(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data));
}
for (const script of [{ id: 'arabic', family: 'Noto Sans Arabic', text: 'سَلَام مرحبا', width: '240' }, { id: 'cjk', family: 'Noto Sans SC Thin', text: '中文测试，动画。', width: '100' }]) {
	test(`M04 imported ${script.id} font matches CPU pixels, retains exact archive bytes and reopens for offline preview seeks`, async ({ page, context }) => {
		await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
		await page.getByLabel('Project title', { exact: true }).fill(`Retained ${script.id}`);
		for (const [name, value] of [['Width', '240'], ['Height', '160'], ['Duration in frames', '2']]) await page.getByLabel(name!, { exact: true }).fill(value!);
		await page.getByRole('button', { name: 'Create', exact: true }).click(); await menu(page, 'Layer', 'New Text');
		await page.getByRole('textbox', { name: 'Text', exact: true }).fill(script.text);
		for (const [name, value] of [['Width', script.width], ['Height', '160'], ['Position X', '0'], ['Position Y', '0'], ['Font size', '32']]) await page.getByLabel(name!, { exact: true }).fill(value!);
		await page.getByRole('button', { name: 'Create', exact: true }).click(); await menu(page, 'Layer', 'Text and Appearance');
		const path = resolve(`tests/fixtures/motionscaper-fonts/${script.id}.woff2`);
		await page.getByRole('textbox', { name: 'Fill color', exact: true }).fill('#ffffff');
		await page.getByLabel('Import Font Face', { exact: true }).setInputFiles(path);
		await expect(page.getByRole('combobox', { name: 'Font face', exact: true }).locator('option:checked')).toContainText(script.family); await close(page);
		const actual = await preview(page); expect(actual.filter((value, index) => index % 4 === 3 && value > 0).length).toBeGreaterThan(300); await close(page);
		const download = page.waitForEvent('download'); await menu(page, 'File', 'Save Copy');
		const downloadedPath = await (await download).path(); if (!downloadedPath) throw new Error('Expected a retained archive download.');
		const archive = await readFile(downloadedPath);
		const bodies = new Map<string, Uint8Array[]>();
		const opened = await importMotionscaperArchive(new Blob([archive]), () => ({
			writeAssetChunk(asset, bytes) { bodies.set(asset.id, [...bodies.get(asset.id) ?? [], new Uint8Array(bytes)]); return Promise.resolve(); },
			finishAsset() { return Promise.resolve(); }, commit() { return Promise.resolve(); }, rollback() { return Promise.resolve(); },
		}));
		if (opened.kind !== 'current') throw new Error('Expected current font archive.');
		const load = async (id: string) => new Uint8Array(await new Blob(bodies.get(id)!.map(bytes => new Uint8Array(bytes))).arrayBuffer());
		const retained = opened.project.assets.find(asset => asset.kind === 'font' && asset.family === script.family)!;
		expect(Array.from(await load(retained.id))).toEqual(Array.from(await readFile(path)));
		const kit = await CanvasKitInit(); const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: opened.project.assets, fallbackFonts: [], loadAsset: asset => load(asset.id) });
		const frame = compileMotionscaperProject(opened.project).evaluate({ compositionId: opened.project.primaryCompositionId, time: 0 });
		const surface = await renderMotionCompositionFrame(frame, { rasterizer });
		// Apply the same browser canvas presentation to the independent CPU reference.
		const presented = await page.evaluate(({ width, height, rgba }) => {
			const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
			const context = canvas.getContext('2d')!;
			context.putImageData(new ImageData(Uint8ClampedArray.from(rgba), width, height), 0, 0);
			return Array.from(context.getImageData(0, 0, width, height).data);
		}, { width: surface.width, height: surface.height, rgba: Array.from(motionSurfaceToRgba8(surface, 'srgb')) });
		expect(actual).toEqual(presented);
		await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device');
		await page.reload(); await menu(page, 'File', 'Project Library'); await page.getByRole('button', { name: `Retained ${script.id}`, exact: true }).click();
		expect(await preview(page)).toEqual(actual); await context.setOffline(true);
		await page.locator('[data-motion-preview-frame]').fill('1'); await expect(page.locator('[data-motion-frame]')).toHaveAttribute('data-motion-frame', '1');
		expect(await pixels(page)).toEqual(actual); await context.setOffline(false);
	});
}
