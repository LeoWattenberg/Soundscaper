/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { BlobReader, TextWriter, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { ordinaryBrowserProductSitePlan } from '../../scripts/lib/browser-product-site-plan.mjs';
import { motionAeTextFixture } from '../helpers/motionscaper-ae-text-fixture.ts';
import type { MotionAeExchange } from '../../src/common/editor/motion-ae-exchange-types.ts';
import { importMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
import type { MotionscaperProject } from '../../src/motionscaper/editor-project-types.ts';
test.use({ baseURL: ordinaryBrowserProductSitePlan().sites[2]!.origin });
async function menu(page: Page, command: string, top = 'File'): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click();
}
test('AE menu retains reviewed editable text and actual font bytes through rendering, Save and reverse exchange', async ({ page }: { page: Page }) => {
	const fontPath = resolve('node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2'), fontBytes = await readFile(fontPath), fontSha256 = createHash('sha256').update(fontBytes).digest('hex');
	await page.goto('/embed/en/'); await menu(page, 'After Effects Bridge'); const dialog = page.getByRole('dialog', { name: 'After Effects Bridge', exact: true });
	await dialog.getByLabel('AE exchange manifest', { exact: true }).setInputFiles({ name: 'motionae.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(motionAeTextFixture('Inter-Regular'))) });
	await dialog.getByText('Editable Text Import Options', { exact: true }).click();
	await dialog.getByLabel('Enable reviewed editable text import', { exact: true }).check();
	await dialog.getByLabel('Exact PostScript font name', { exact: true }).fill('Inter-Regular');
	await dialog.getByLabel('Original font face file', { exact: true }).setInputFiles(fontPath);
	await dialog.getByRole('button', { name: 'Add Font Binding', exact: true }).click();
	await dialog.getByRole('button', { name: 'Review Import', exact: true }).click();
	const report = dialog.getByRole('region', { name: 'Conversion report', exact: true });
	await expect(report).toContainText('Text is reflowed'); await expect(report).toContainText('explicit PostScript-name binding');
	await report.getByRole('checkbox').check(); await report.getByRole('button', { name: 'Import New Project', exact: true }).click(); await expect(dialog).toHaveCount(0);
	await menu(page, 'Composition Preview', 'View'); const preview = page.getByRole('dialog', { name: 'Composition Preview', exact: true }), canvas = preview.locator('canvas');
	await expect(canvas).toHaveAttribute('data-motion-frame', '0');
	expect(await canvas.evaluate((element: HTMLCanvasElement) => { const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data; let visible = 0; for (let index = 3; index < pixels.length; index += 4) if (pixels[index]! > 0) visible++; return visible; })).toBeGreaterThan(100);
	await preview.getByRole('button', { name: 'Close', exact: true }).last().click(); await menu(page, 'Save');
	await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload(); await menu(page, 'Project Library'); await page.getByRole('button', { name: 'Original text.aep', exact: true }).click(); await menu(page, 'After Effects Bridge');
	await dialog.getByText('Editable Text Export Options', { exact: true }).click();
	await dialog.getByLabel('Enable reviewed editable text export', { exact: true }).check();
	await expect(dialog.getByLabel('Exact PostScript font name — inter-latin-400-normal.woff2', { exact: true })).toHaveValue('Inter-Regular');
	await dialog.getByRole('button', { name: 'Review Export', exact: true }).click();
	const exported = dialog.getByRole('region', { name: 'Export conversion report', exact: true }); await expect(exported).toContainText('Text is reflowed');
	await exported.getByRole('checkbox').check(); const pending = page.waitForEvent('download'); await exported.getByRole('button', { name: 'Download AE Exchange Package', exact: true }).click();
	const download = await pending, reader = new ZipReader(new BlobReader(new Blob([new Uint8Array(await readFile((await download.path())!))])));
	try {
		const entries = await reader.getEntries(), manifest = entries.find(entry => entry.filename === 'motionae.json')!, original = entries.find(entry => entry.filename === 'original.mscape')!;
		if (manifest.directory || original.directory) throw new Error('Expected package files.');
		const exchange = JSON.parse(await manifest.getData!(new TextWriter())) as MotionAeExchange, layer = exchange.compositions[0]!.layers[0]!;
		expect(layer.kind).toBe('text'); const group = layer.properties.find(property => property.matchName === 'ADBE Text Properties');
		if (group?.kind !== 'group' || group.children[0]?.kind !== 'text') throw new Error('Expected editable Source Text.');
		expect(group.children[0].value.font).toBe('Inter-Regular'); expect(group.children[0].value.text).toBe('Retained\rtext');
		let retained: MotionscaperProject | undefined; const chunks: Uint8Array[] = [];
		await importMotionscaperArchive(new Blob([await original.getData!(new Uint8ArrayWriter())]), _project => ({ writeAssetChunk: (_asset, bytes) => { chunks.push(bytes); return Promise.resolve(); }, finishAsset: () => Promise.resolve(), commit: value => { retained = value; return Promise.resolve(); }, rollback: () => Promise.resolve() }));
		expect(retained?.interchangeCustody?.fonts?.[0]?.sha256).toBe(fontSha256);
		expect(createHash('sha256').update(Buffer.concat(chunks)).digest('hex')).toBe(fontSha256);
	} finally { await reader.close(); }
});
