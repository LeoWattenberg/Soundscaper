/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { BlobReader, BlobWriter, TextWriter, ZipReader } from '@zip.js/zip.js';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { ordinaryBrowserProductSitePlan } from '../../scripts/lib/browser-product-site-plan.mjs';
import { motionAeSceneProjectFixture } from '../helpers/motionscaper-ae-scene-fixture.ts';
import { prepareMotionscaperAeExport } from '../../src/motionscaper/editor-ae-export-conversion.ts';
import { prepareMotionAeHostImport } from '../../src/common/editor/motion-ae-host-import-plan.ts';
import { importMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
test.use({ baseURL: ordinaryBrowserProductSitePlan().sites[2]!.origin });
async function menu(page: Page, command: string): Promise<void> { await page.getByRole('menuitem', { name: 'File', exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click(); }
test('Motion AE camera/light review is opt-in and survives actual import, Save, reopen and reverse native scene plan', async ({ page }) => {
	const source = prepareMotionscaperAeExport(motionAeSceneProjectFixture(), { scene: { colorSpace: 'linear-rec709-d65' } }).exchange;
	await page.goto('/embed/en/'); await menu(page, 'After Effects Bridge'); const dialog = page.getByRole('dialog');
	await dialog.getByLabel('AE exchange manifest', { exact: true }).setInputFiles({ name: 'motionae.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
	const selected = dialog.getByLabel('Review camera and ambient light import', { exact: true }); await expect(selected).not.toBeChecked();
	await selected.check(); await dialog.getByRole('combobox', { name: 'Import light color interpretation', exact: true }).selectOption('linear-rec709-d65');
	await dialog.getByRole('button', { name: 'Review Import', exact: true }).click(); const report = dialog.getByRole('region', { name: 'Conversion report', exact: true });
	await expect(report).toContainText('camera or ambient-light parameters'); await expect(report).toContainText('not qualified');
	await selected.uncheck(); await expect(report).toHaveCount(0); await selected.check(); await dialog.getByRole('button', { name: 'Review Import', exact: true }).click();
	await report.getByRole('checkbox').check(); await report.getByRole('button', { name: 'Import New Project', exact: true }).click(); await expect(dialog).toHaveCount(0);
	await menu(page, 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload();
	await menu(page, 'Project Library'); await page.getByRole('button', { name: 'Camera and ambient', exact: true }).click(); await menu(page, 'After Effects Bridge');
	const reverseOption = dialog.getByLabel('Review camera and ambient light export', { exact: true }); await expect(reverseOption).not.toBeChecked(); await reverseOption.check();
	await dialog.getByRole('button', { name: 'Review Export', exact: true }).click(); const reverse = dialog.getByRole('region', { name: 'Export conversion report', exact: true });
	await reverse.getByRole('checkbox').check(); const pending = page.waitForEvent('download'); await reverse.getByRole('button', { name: 'Download AE Exchange Package', exact: true }).click();
	const downloaded = await pending, reader = new ZipReader(new BlobReader(new Blob([new Uint8Array(await readFile((await downloaded.path())!))])));
	try {
		const entries = await reader.getEntries(), manifest = entries.find(entry => entry.filename === 'motionae.json'), original = entries.find(entry => entry.filename === 'original.mscape');
		if (!manifest || manifest.directory || !original || original.directory) throw new Error('Expected editable exchange and retained archive.');
		const plan = prepareMotionAeHostImport(await manifest.getData!(new TextWriter())); expect(plan.compositions[0]!.layers.map(layer => layer.scene?.kind)).toEqual(['camera', 'ambient']);
		const retained = await importMotionscaperArchive(await original.getData!(new BlobWriter()), () => ({ async writeAssetChunk() {}, async finishAsset() {}, async commit() {}, async rollback() {} }));
		if (retained.kind !== 'current') throw new Error('Expected current Motion custody.');
		expect(retained.project.interchangeCustody?.exchange).toEqual(source); expect(retained.project.compositions[0]!.layers.map(layer => layer.kind)).toEqual(['camera', 'light']);
		expect(retained.project.compositions[0]!.layers[0]!.transform.position.value).toEqual([32, 24, -100]);
	} finally { await reader.close(); }
});
