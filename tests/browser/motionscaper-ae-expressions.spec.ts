/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { BlobReader, BlobWriter, TextWriter, ZipReader } from '@zip.js/zip.js';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import type { MotionAeExchange } from '../../src/common/editor/motion-ae-exchange-types.ts';
import { importMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
async function menu(page: Page, top: string, command: string): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click();
	await page.getByRole('menuitem', { name: command, exact: true }).click();
}
async function close(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function alpha(page: Page): Promise<number> {
	await menu(page, 'View', 'Composition Preview'); const dialog = page.getByRole('dialog'), canvas = dialog.locator('canvas');
	await expect(canvas).toHaveAttribute('data-motion-frame', '0');
	await dialog.getByLabel('Frame', { exact: true }).fill('15'); await expect(canvas).toHaveAttribute('data-motion-frame', '15');
	const value = await canvas.evaluate((element: HTMLCanvasElement) => element.getContext('2d')!.getImageData(16, 16, 1, 1).data[3]!);
	await close(page); return value;
}
test('AE scalar translation is opt-in and preserves expression pixels and original source through exchange and reopening', async ({ page }) => {
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
	await page.getByLabel('Project title', { exact: true }).fill('Scalar expression exchange');
	await page.getByLabel('Width', { exact: true }).fill('32'); await page.getByLabel('Height', { exact: true }).fill('32');
	await page.getByLabel('Duration in frames', { exact: true }).fill('60'); await page.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0); await menu(page, 'Layer', 'New Rectangle');
	await page.getByLabel('Layer name', { exact: true }).fill('Expression rectangle');
	await page.getByLabel('Width', { exact: true }).fill('32'); await page.getByLabel('Height', { exact: true }).fill('32');
	await page.getByLabel('Position X', { exact: true }).fill('0'); await page.getByLabel('Position Y', { exact: true }).fill('0');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Layer', 'Expressions'); let dialog = page.getByRole('dialog');
	await dialog.getByRole('combobox', { name: 'Property', exact: true }).selectOption('transform.opacity');
	const source = 'value * (.25 + time*.25)'; await dialog.getByLabel('Expression source', { exact: true }).fill(source);
	await dialog.getByLabel('Expression enabled', { exact: true }).check(); await dialog.getByRole('button', { name: 'Apply Expression', exact: true }).click(); await close(page);
	expect(await alpha(page)).toBe(96); await menu(page, 'File', 'After Effects Bridge'); dialog = page.getByRole('dialog');
	const enabled = dialog.getByLabel('Translate supported scalar expressions on export', { exact: true }); await expect(enabled).not.toBeChecked();
	await enabled.check(); await dialog.getByRole('button', { name: 'Review Export', exact: true }).click();
	const report = dialog.getByRole('region', { name: 'Export conversion report', exact: true }); await expect(report).toContainText('Closed scalar arithmetic');
	await enabled.uncheck(); await expect(report).toHaveCount(0); await enabled.check(); await dialog.getByRole('button', { name: 'Review Export', exact: true }).click();
	await report.getByRole('checkbox').check(); const pending = page.waitForEvent('download'); await report.getByRole('button', { name: 'Download AE Exchange Package', exact: true }).click();
	const downloaded = await pending, reader = new ZipReader(new BlobReader(new Blob([new Uint8Array(await readFile((await downloaded.path())!))])));
	let manifest: string;
	try {
		const entries = await reader.getEntries(), exchangeEntry = entries.find(entry => entry.filename === 'motionae.json'), original = entries.find(entry => entry.filename === 'original.mscape');
		if (!exchangeEntry || exchangeEntry.directory || !original || original.directory) throw new Error('Expected exchange and source custody.');
		manifest = await exchangeEntry.getData!(new TextWriter()); const exchange = JSON.parse(manifest) as MotionAeExchange;
		const transform = exchange.compositions[0]!.layers[0]!.properties.find(property => property.matchName === 'ADBE Transform Group');
		if (transform?.kind !== 'group') throw new Error('Expected transform.'); const opacity = transform.children.find(property => property.matchName === 'ADBE Opacity');
		if (opacity?.kind !== 'numeric') throw new Error('Expected opacity.'); expect(opacity.expression?.disposition).toBe('translated'); expect(opacity.expression?.source).toContain('100');
		const opened = await importMotionscaperArchive(await original.getData!(new BlobWriter()), () => ({ async writeAssetChunk() {}, async finishAsset() {}, async commit() {}, async rollback() {} }));
		if (opened.kind !== 'current') throw new Error('Expected retained source.'); expect(opened.project.compositions[0]!.layers[0]!.transform.opacity.expression?.source).toBe(source);
	} finally { await reader.close(); }
	const importOption = dialog.getByLabel('Translate supported scalar expressions on import', { exact: true }); await expect(importOption).not.toBeChecked();
	await dialog.getByLabel('AE exchange manifest', { exact: true }).setInputFiles({ name: 'motionae.json', mimeType: 'application/json', buffer: Buffer.from(manifest) });
	await importOption.check(); await dialog.getByRole('button', { name: 'Review Import', exact: true }).click();
	const imported = dialog.getByRole('region', { name: 'Conversion report', exact: true }); await imported.getByRole('checkbox').check();
	await dialog.getByRole('button', { name: 'Import New Project', exact: true }).click(); await expect(dialog).toHaveCount(0); expect(await alpha(page)).toBe(96);
	await menu(page, 'View', 'Composition Settings'); await page.getByLabel('Project title', { exact: true }).fill('Imported scalar expression');
	await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device');
	await page.reload(); await menu(page, 'File', 'Project Library');
	await page.getByRole('button', { name: 'Imported scalar expression', exact: true }).click();
	expect(await alpha(page)).toBe(96);
});
