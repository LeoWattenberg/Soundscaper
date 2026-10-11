/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { BlobReader, TextWriter, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { ordinaryBrowserProductSitePlan } from '../../scripts/lib/browser-product-site-plan.mjs';
import { motionAeShapeProjectFixture } from '../helpers/motionscaper-ae-shape-fixture.ts';
import { prepareMotionscaperAeExport } from '../../src/motionscaper/editor-ae-export-conversion.ts';
import { prepareMotionAeHostImport } from '../../src/common/editor/motion-ae-host-import-plan.ts';
import { importMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
import type { MotionscaperProject } from '../../src/motionscaper/editor-project-types.ts';
import type { MotionAeExchange } from '../../src/common/editor/motion-ae-exchange-types.ts';
test.use({ baseURL: ordinaryBrowserProductSitePlan().sites[2]!.origin });
async function menu(page: Page, command: string, top = 'File'): Promise<void> { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click(); }
test('Motion AE menu imports reviewed shape intent, paints actual pixels and retains editable paths through Save and reverse package', async ({ page }) => {
	const exported = prepareMotionscaperAeExport(motionAeShapeProjectFixture()).exchange;
	const source: MotionAeExchange = { ...exported, source: { name: 'Reviewed shapes.aep', revisionDigest: null }, producer: { application: 'after-effects', version: 'synthetic structural fixture, not installed AE', bridgeVersion: '0.1.0' } };
	await page.goto('/embed/en/'); await menu(page, 'After Effects Bridge'); const dialog = page.getByRole('dialog', { name: 'After Effects Bridge', exact: true });
	await dialog.getByLabel('AE exchange manifest', { exact: true }).setInputFiles({ name: 'motionae.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
	await dialog.getByRole('button', { name: 'Review Import', exact: true }).click(); const report = dialog.getByRole('region', { name: 'Conversion report', exact: true });
	await expect(report).toContainText('Ordered editable Bézier paths'); await report.getByRole('checkbox').check(); await report.getByRole('button', { name: 'Import New Project', exact: true }).click(); await expect(dialog).toHaveCount(0);
	await menu(page, 'Composition Preview', 'View'); const preview = page.getByRole('dialog', { name: 'Composition Preview', exact: true }), canvas = preview.locator('canvas');
	await expect(canvas).toHaveAttribute('data-motion-frame', '0');
	const alpha = await canvas.evaluate((element: HTMLCanvasElement) => element.getContext('2d')!.getImageData(32, 24, 1, 1).data[3]); expect(alpha).toBeGreaterThanOrEqual(127); expect(alpha).toBeLessThanOrEqual(129);
	await preview.getByRole('button', { name: 'Close', exact: true }).last().click(); await menu(page, 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device');
	await page.reload(); await menu(page, 'Project Library'); await page.getByRole('button', { name: 'Reviewed shapes.aep', exact: true }).click(); await menu(page, 'After Effects Bridge');
	await dialog.getByRole('button', { name: 'Review Export', exact: true }).click(); const reverse = dialog.getByRole('region', { name: 'Export conversion report', exact: true });
	await expect(reverse).toContainText('editable copy of the path'); await reverse.getByRole('checkbox').check(); const downloaded = page.waitForEvent('download'); await reverse.getByRole('button', { name: 'Download AE Exchange Package', exact: true }).click();
	const archive = await downloaded, reader = new ZipReader(new BlobReader(new Blob([new Uint8Array(await readFile((await archive.path())!))])));
	try {
		const entries = await reader.getEntries(), manifest = entries.find(entry => entry.filename === 'motionae.json')!, original = entries.find(entry => entry.filename === 'original.mscape')!;
		if (manifest.directory || original.directory) throw new Error('Expected retained package files.');
		const json = await manifest.getData!(new TextWriter()), plan = prepareMotionAeHostImport(json); expect(plan.compositions[0]!.layers[0]!.shapes).toHaveLength(2);
		let retained: MotionscaperProject | undefined;
		await importMotionscaperArchive(new Blob([await original.getData!(new Uint8ArrayWriter())]), _project => ({ writeAssetChunk: () => Promise.reject(new Error('Shape transfer has no assets.')), finishAsset: () => Promise.resolve(), commit: project => { retained = project; return Promise.resolve(); }, rollback: () => Promise.resolve() }));
		expect(retained?.interchangeCustody?.exchange).toEqual(source); const layer = retained?.compositions[0]?.layers[0]; expect(layer?.kind).toBe('shapes'); if (layer?.kind !== 'shapes') throw new Error('Expected editable shapes.');
		expect(layer.shapes).toHaveLength(2); expect(layer.shapes[0]?.path.value).toEqual(layer.shapes[1]?.path.value);
	} finally { await reader.close(); }
});
