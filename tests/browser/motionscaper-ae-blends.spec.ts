/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { BlobReader, BlobWriter, TextWriter, ZipReader } from '@zip.js/zip.js';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { ordinaryBrowserProductSitePlan } from '../../scripts/lib/browser-product-site-plan.mjs';
import { motionAeShapeProjectFixture } from '../helpers/motionscaper-ae-shape-fixture.ts';
import { prepareMotionscaperAeExport } from '../../src/motionscaper/editor-ae-export-conversion.ts';
import { prepareMotionAeHostImport } from '../../src/common/editor/motion-ae-host-import-plan.ts';
import { importMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
test.use({ baseURL: ordinaryBrowserProductSitePlan().sites[2]!.origin });
async function menu(page: Page, command: string) { await page.getByRole('menuitem', { name: 'File', exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click(); }
test('Motion File AE bridge retains reviewed layer blends and original switches through Save, reopen and editable exchange download', async ({ page }) => {
	const project = motionAeShapeProjectFixture(), comp = project.compositions[0]!, base = comp.layers[0]!;
	const source = prepareMotionscaperAeExport({ ...project, title: 'Blend custody', compositions: [{ ...comp, layers: [
		{ ...base, blendMode: 'multiply' }, { ...base, id: 'screen-layer', blendMode: 'screen' }, { ...base, id: 'overlay-layer', blendMode: 'overlay' },
	] }] }).exchange;
	await page.goto('/embed/en/'); await menu(page, 'After Effects Bridge'); const dialog = page.getByRole('dialog');
	await dialog.getByLabel('AE exchange manifest', { exact: true }).setInputFiles({ name: 'motionae.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
	await dialog.getByRole('button', { name: 'Review Import', exact: true }).click(); const report = dialog.getByRole('region', { name: 'Conversion report', exact: true });
	await expect(report).toContainText('Named blend mode is structurally mapped'); await expect(report).toContainText('unqualified');
	await report.getByRole('checkbox').check(); await report.getByRole('button', { name: 'Import New Project', exact: true }).click(); await expect(dialog).toHaveCount(0);
	await menu(page, 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload();
	await menu(page, 'Project Library'); await page.getByRole('button', { name: 'Blend custody', exact: true }).click(); await menu(page, 'After Effects Bridge');
	await dialog.getByRole('button', { name: 'Review Export', exact: true }).click(); const reverse = dialog.getByRole('region', { name: 'Export conversion report', exact: true });
	await expect(reverse).toContainText('Named SDK blend mode'); await reverse.getByRole('checkbox').check();
	const pending = page.waitForEvent('download'); await reverse.getByRole('button', { name: 'Download AE Exchange Package', exact: true }).click();
	const downloaded = await pending, reader = new ZipReader(new BlobReader(new Blob([new Uint8Array(await readFile((await downloaded.path())!))])));
	try {
		const entries = await reader.getEntries(), manifest = entries.find(entry => entry.filename === 'motionae.json'), original = entries.find(entry => entry.filename === 'original.mscape');
		if (!manifest || manifest.directory || !original || original.directory) throw new Error('Expected editable exchange and retained original.');
		const plan = prepareMotionAeHostImport(await manifest.getData!(new TextWriter())); expect(plan.compositions[0]!.layers.map(layer => layer.blendMode)).toEqual(['multiply', 'screen', 'overlay']);
		const retained = await importMotionscaperArchive(await original.getData!(new BlobWriter()), () => ({ async writeAssetChunk() {}, async finishAsset() {}, async commit() {}, async rollback() {} }));
		if (retained.kind !== 'current') throw new Error('Expected Motion custody.');
		expect(retained.project.interchangeCustody?.exchange).toEqual(source); expect(retained.project.compositions[0]!.layers.map(layer => layer.blendMode)).toEqual(['multiply', 'screen', 'overlay']);
	} finally { await reader.close(); }
});
