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
async function menu(page: Page, top: string, command: string): Promise<void> { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click(); }
async function close(page: Page): Promise<void> { await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click(); await expect(page.getByRole('dialog')).toHaveCount(0); }

test('a canvas-positioned title card keeps its curve, null parenting and precomposition through save/reopen and actual PNG delivery', async ({ page }: { page: Page }) => {
	await page.addInitScript(() => { Object.defineProperty(globalThis, 'showSaveFilePicker', { value: undefined, configurable: true }); });
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
	for (const [name, value] of [['Project title', 'Motion title card'], ['Width', '400'], ['Height', '160'], ['Duration in frames', '30']] as const) await page.getByLabel(name, { exact: true }).fill(value);
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Layer', 'New Rectangle');
	for (const [name, value] of [['Layer name', 'Card'], ['Width', '280'], ['Height', '100'], ['Position X', '20'], ['Position Y', '20']] as const) await page.getByLabel(name, { exact: true }).fill(value);
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Layer', 'New Text');
	const title = 'Motion سَلَام'; const fontPath = resolve('tests/fixtures/motionscaper-fonts/arabic.woff2');
	for (const [name, value] of [['Layer name', 'Title'], ['Text', 'Motion'], ['Font size', '40'], ['Width', '240'], ['Height', '70'], ['Position X', '80'], ['Position Y', '35'], ['Fill color', '#ffffff']] as const) await page.getByLabel(name, { exact: true }).fill(value);
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Layer', 'Text and Appearance'); await page.getByRole('button', { name: 'Add Text Run', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue(''); await page.getByRole('textbox', { name: 'Text', exact: true }).fill(' سَلَام');
	await page.getByLabel('Import Font Face', { exact: true }).setInputFiles(fontPath);
	await expect(page.getByRole('combobox', { name: 'Font face', exact: true }).locator('option:checked')).toContainText('Noto Sans Arabic'); await close(page);
	await menu(page, 'Layer', 'Shapes and Text Animation'); await page.getByRole('button', { name: 'Add Animator', exact: true }).click();
	await page.getByRole('combobox', { name: 'Selection unit', exact: true }).selectOption('line'); await page.getByRole('button', { name: 'Apply Animator', exact: true }).click(); await close(page);
	await menu(page, 'View', 'Composition Canvas'); let dialog = page.getByRole('dialog');
	await expect(dialog.locator('canvas')).toHaveAttribute('data-motion-rendered'); await dialog.getByLabel('Canvas layer', { exact: true }).selectOption({ label: 'Card' });
	await dialog.getByRole('button', { name: 'Move selected layer', exact: true }).focus(); await page.keyboard.press('Shift+ArrowRight');
	await expect(dialog.locator('[data-motion-canvas-selected]')).toHaveAttribute('data-motion-anchor-x', '30'); await close(page);
	await menu(page, 'Layer', 'Properties and Keyframes'); dialog = page.getByRole('dialog');
	await dialog.getByLabel('Layer', { exact: true }).selectOption({ label: 'Card' }); await dialog.getByLabel('Property', { exact: true }).selectOption('transform.position');
	for (const [frame, value] of [['0', '30'], ['15', '70']] as const) {
		await dialog.getByLabel('Keyframe frame', { exact: true }).fill(frame); await dialog.getByLabel('Keyframe value', { exact: true }).fill(value); await dialog.getByRole('button', { name: 'Set Keyframe', exact: true }).click();
	}
	await dialog.getByRole('checkbox', { name: 'Keyframe 0', exact: true }).check(); await dialog.getByLabel('Interpolation', { exact: true }).selectOption('eased');
	await dialog.getByRole('button', { name: 'Apply Interpolation', exact: true }).click(); await expect(dialog.locator('[data-motion-keyframe-row]').first()).toHaveAttribute('data-motion-interpolation', 'eased'); await close(page);
	await menu(page, 'Layer', 'Properties and Keyframes'); dialog = page.getByRole('dialog');
	await dialog.getByLabel('Layer', { exact: true }).selectOption({ label: 'Title' }); await dialog.getByLabel('Property', { exact: true }).selectOption('document.animators.0.position');
	for (const [frame, value] of [['0', '0'], ['15', '20']] as const) {
		await dialog.getByLabel('Keyframe frame', { exact: true }).fill(frame); await dialog.getByLabel('Keyframe value', { exact: true }).fill(value); await dialog.getByRole('button', { name: 'Set Keyframe', exact: true }).click();
	}
	await expect(dialog.locator('[data-motion-keyframe-row]')).toHaveCount(2);
	await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(dialog.locator('[data-motion-keyframe-row]')).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(dialog.locator('[data-motion-keyframe-row]')).toHaveCount(2); await close(page);
	await menu(page, 'View', 'Timeline'); dialog = page.getByRole('dialog');
	await dialog.getByRole('checkbox', { name: 'Title', exact: true }).check(); await dialog.getByRole('checkbox', { name: 'Card', exact: true }).check();
	await dialog.getByLabel('Group name', { exact: true }).fill('Title parent'); await dialog.getByRole('button', { name: 'Group with Null', exact: true }).click();
	await expect(dialog.locator('[data-motion-layer-row]')).toHaveCount(3); await dialog.getByRole('checkbox', { name: 'Title parent', exact: true }).check();
	await dialog.getByLabel('Group name', { exact: true }).fill('Title scene'); await dialog.getByRole('button', { name: 'Precompose', exact: true }).click();
	await expect(dialog.locator('[data-motion-layer-row]')).toHaveCount(1); await close(page);
	const archiveDownload = page.waitForEvent('download'); await menu(page, 'File', 'Save Copy');
	const archivePath = await (await archiveDownload).path(); if (!archivePath) throw new Error('Expected retained title archive.');
	const bodies = new Map<string, Uint8Array[]>();
	const opened = await importMotionscaperArchive(new Blob([await readFile(archivePath)]), () => ({
		writeAssetChunk(asset, bytes) { bodies.set(asset.id, [...bodies.get(asset.id) ?? [], new Uint8Array(bytes)]); return Promise.resolve(); },
		finishAsset() { return Promise.resolve(); }, commit() { return Promise.resolve(); }, rollback() { return Promise.resolve(); },
	}));
	if (opened.kind !== 'current') throw new Error('Expected current title archive.');
	const load = async (id: string) => new Uint8Array(await new Blob(bodies.get(id)!.map(bytes => new Uint8Array(bytes))).arrayBuffer());
	const retainedFont = opened.project.assets.find(asset => asset.kind === 'font' && asset.family === 'Noto Sans Arabic'); expect(retainedFont).toBeDefined();
	expect(Array.from(await load(retainedFont!.id))).toEqual(Array.from(await readFile(fontPath)));
	const savedTitle = opened.project.compositions.flatMap(composition => composition.layers).find(layer => layer.name === 'Title');
	expect(savedTitle?.kind).toBe('text'); if (savedTitle?.kind !== 'text') throw new Error('Expected retained title.');
	expect(savedTitle.document.runs.map(run => run.text).join('')).toBe(title); expect(savedTitle.document.animators?.[0]?.position.curves[0]?.anchors.map(anchor => anchor.value)).toEqual([0, 20]);
	const kit = await CanvasKitInit(); const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: opened.project.assets, fallbackFonts: [], loadAsset: asset => load(asset.id) });
	const evaluator = compileMotionscaperProject(opened.project);
	await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload();
	await menu(page, 'File', 'Project Library'); await page.getByRole('button', { name: 'Motion title card', exact: true }).click();
	await menu(page, 'Layer', 'Properties and Keyframes'); dialog = page.getByRole('dialog');
	await dialog.getByLabel('Composition', { exact: true }).selectOption({ label: 'Title scene' }); await dialog.getByLabel('Layer', { exact: true }).selectOption({ label: 'Card' });
	await dialog.getByLabel('Property', { exact: true }).selectOption('transform.position'); await expect(dialog.locator('[data-motion-keyframe-row]')).toHaveCount(2);
	await expect(dialog.locator('[data-motion-keyframe-row]').first()).toHaveAttribute('data-motion-interpolation', 'eased'); await close(page);
	await menu(page, 'View', 'Composition Preview'); dialog = page.getByRole('dialog'); const canvas = dialog.locator('canvas');
	await expect(canvas).toHaveAttribute('data-motion-frame', '0');
	const firstPreview = await canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data));
	await dialog.getByLabel('Frame', { exact: true }).fill('15'); await expect(canvas).toHaveAttribute('data-motion-frame', '15');
	const preview = await canvas.evaluate((element: HTMLCanvasElement) => {
		const context = element.getContext('2d')!; const rgba = Array.from(context.getImageData(0, 0, element.width, element.height).data);
		let titlePixels = 0; for (let y = 35; y < 105; y++) for (let x = 80; x < 320; x++) { const i = (y * element.width + x) * 4; if (rgba[i]! > 240 && rgba[i + 1]! > 240 && rgba[i + 2]! > 240 && rgba[i + 3]! > 240) titlePixels++; }
		return { rgba, titlePixels, card: Array.from(context.getImageData(75, 110, 1, 1).data), outside: Array.from(context.getImageData(5, 5, 1, 1).data) };
	});
	expect(preview.titlePixels).toBeGreaterThan(300); expect(preview.card).toEqual([74, 128, 255, 255]); expect(preview.outside).toEqual([0, 0, 0, 0]); await close(page);
	expect(preview.rgba).not.toEqual(firstPreview);
	const whiteCoverage = (rgba: readonly number[]) => rgba.flatMap((value, index) => index % 4 === 0 && value > 240 && rgba[index + 1]! > 240 && rgba[index + 2]! > 240 && rgba[index + 3]! > 240 ? [index / 4] : []);
	expect(whiteCoverage(firstPreview).length).toBeGreaterThan(300); expect(whiteCoverage(preview.rgba)).not.toEqual(whiteCoverage(firstPreview));
	const shaped = [];
	for (const frame of [0, 15]) {
		const evaluated = evaluator.evaluate({ compositionId: opened.project.primaryCompositionId, time: { num: frame, den: 30 } });
		const textState = evaluated.layers.flatMap(layer => layer.precomposition?.layers ?? []).find(layer => layer.state.name === 'Title')?.state;
		if (textState?.kind !== 'text') throw new Error('Expected shaped nested title.');
		const metrics = await rasterizer.shapeText(textState.document); const glyphs = metrics.lines.flatMap(line => line.runs.flatMap(run => run.glyphs));
		expect(metrics.unresolvedCodepoints).toEqual([]); expect(glyphs.length).toBeGreaterThan(8); expect(glyphs.every(glyph => glyph > 0)).toBe(true); shaped.push(metrics);
		const surface = await renderMotionCompositionFrame(evaluated, { rasterizer });
		const reference = await page.evaluate(({ width, height, rgba }) => {
			const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d')!;
			context.putImageData(new ImageData(Uint8ClampedArray.from(rgba), width, height), 0, 0); return Array.from(context.getImageData(0, 0, width, height).data);
		}, { width: surface.width, height: surface.height, rgba: Array.from(motionSurfaceToRgba8(surface, 'srgb')) });
		expect(reference).toEqual(frame === 0 ? firstPreview : preview.rgba);
	}
	expect(shaped[0]).toEqual(shaped[1]);
	await menu(page, 'File', 'Render'); dialog = page.getByRole('dialog'); await dialog.getByLabel('First frame', { exact: true }).fill('0'); await dialog.getByLabel('End frame (exclusive)', { exact: true }).fill('16');
	const pending = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Render', exact: true }).click(); const download = await pending;
	const output = await download.path(); if (!output) throw new Error('The title-card render was not downloaded.');
	const archive = await readFile(output); const entries = new Map<string, Uint8Array>();
	for (let offset = 0; offset + 512 <= archive.length && archive[offset];) {
		const size = Number.parseInt(new TextDecoder().decode(archive.subarray(offset + 124, offset + 136)), 8); const name = new TextDecoder().decode(archive.subarray(offset, offset + 100)).split('\0')[0]!;
		entries.set(name, archive.subarray(offset + 512, offset + 512 + size)); offset += 512 + Math.ceil(size / 512) * 512;
	}
	expect([...entries.keys()].filter(name => name.endsWith('.png'))).toHaveLength(16);
	for (const [frame, pixels] of [[0, firstPreview], [15, preview.rgba]] as const) {
		const png = entries.get(`frames/frame${String(frame + 1).padStart(12, '0')}.png`); expect(png).toBeDefined();
		const difference = await page.evaluate(async ({ png, preview }) => {
			const bitmap = await createImageBitmap(new Blob([Uint8Array.from(png)], { type: 'image/png' })); const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
			const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close(); const rendered = context.getImageData(0, 0, canvas.width, canvas.height).data;
			let maximum = 0; for (let i = 0; i < rendered.length; i++) maximum = Math.max(maximum, Math.abs(rendered[i]! - preview[i]!)); return maximum;
		}, { png: Array.from(png!), preview: pixels });
		expect(difference).toBeLessThanOrEqual(1);
	}
	expect(entries.get('frames/frame000000000001.png')).not.toEqual(entries.get('frames/frame000000000016.png'));
	await expect(dialog.getByRole('status')).toHaveText('Render complete');
});
