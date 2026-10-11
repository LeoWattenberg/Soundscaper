/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { BlobReader, BlobWriter, TextWriter, ZipReader } from '@zip.js/zip.js';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { ordinaryBrowserProductSitePlan } from '../../scripts/lib/browser-product-site-plan.mjs';
import { motionAeShapeProjectFixture } from '../helpers/motionscaper-ae-shape-fixture.ts';
import { motionAeGaussianProfileFixture } from '../helpers/motionscaper-ae-gaussian-fixture.ts';
import { prepareMotionscaperAeExport } from '../../src/motionscaper/editor-ae-export-conversion.ts';
import { parseMotionAeExchange } from '../../src/common/editor/motion-ae-exchange.ts';
import { motionScalar } from '../../src/common/editor/motion-property.ts';
import { compileInterpolationCurve } from '../../src/common/editor/interpolation-curve.ts';
import { importMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
test.use({ baseURL: ordinaryBrowserProductSitePlan().sites[2]!.origin });
async function menu(page: Page, command: string) { await page.getByRole('menuitem', { name: 'File', exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click(); }
function profileFile(value: unknown) { return { name: 'reviewed-gaussian.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) }; }
test('Motion File Gaussian profile opt-in rejects mismatches, survives Save/reopen as inert custody and maps only a reviewed reverse export', async ({ page }) => {
	const project = motionAeShapeProjectFixture(), comp = project.compositions[0]!, base = comp.layers[0]!, gaussianProfile = motionAeGaussianProfileFixture();
	const sigma = { ...motionScalar(2), curve: compileInterpolationCurve({ anchors: [{ position: { num: 0, den: 1 }, value: 2 }, { position: { num: 12, den: 1 }, value: 6 }], segments: [{ kind: 'linear' }] }) };
	const source = prepareMotionscaperAeExport({ ...project, title: 'Gaussian custody', compositions: [{ ...comp, layers: [{ ...base, effects: [{ id: 'blur', type: 'gaussian-blur', enabled: true, parameters: [{ id: 'sigma', value: sigma }] }] }] }] }, { gaussianProfile }).exchange;
	await page.goto('/embed/en/'); await menu(page, 'After Effects Bridge'); const dialog = page.getByRole('dialog');
	await dialog.getByLabel('AE exchange manifest', { exact: true }).setInputFiles({ name: 'motionae.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
	await dialog.getByRole('button', { name: 'Review Import', exact: true }).click(); const report = dialog.getByRole('region', { name: 'Conversion report', exact: true });
	await expect(report).toContainText('Choose an explicitly reviewed Gaussian profile');
	const selected = dialog.getByLabel('Reviewed Gaussian profile for import', { exact: true });
	await selected.setInputFiles(profileFile({ ...gaussianProfile, blurrinessPerSigma: 3 })); await expect(report).toHaveCount(0);
	await expect(dialog).toContainText('Declared blurriness per sigma: 3');
	await dialog.getByRole('button', { name: 'Review Import', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('must match the exact profile'); await expect(report).toHaveCount(0);
	await selected.setInputFiles(profileFile(gaussianProfile)); await expect(dialog).toContainText('Declared blurriness per sigma: 2');
	await dialog.getByRole('button', { name: 'Review Import', exact: true }).click(); await expect(report).toContainText('Editable Gaussian controls'); await expect(report).toContainText('unqualified');
	await report.getByRole('checkbox').check(); await report.getByRole('button', { name: 'Import New Project', exact: true }).click(); await expect(dialog).toHaveCount(0);
	await menu(page, 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload();
	await menu(page, 'Project Library'); await page.getByRole('button', { name: 'Gaussian custody', exact: true }).click(); await menu(page, 'After Effects Bridge');
	await dialog.getByRole('button', { name: 'Review Export', exact: true }).click(); const reverse = dialog.getByRole('region', { name: 'Export conversion report', exact: true });
	await expect(reverse).toContainText('Choose an explicitly reviewed Gaussian profile'); await reverse.getByRole('checkbox').check();
	await dialog.getByLabel('Reviewed Gaussian profile for export', { exact: true }).setInputFiles(profileFile(gaussianProfile)); await expect(reverse).toHaveCount(0);
	await expect(dialog).toContainText('Declared blurriness per sigma: 2'); await dialog.getByRole('button', { name: 'Review Export', exact: true }).click();
	await expect(reverse).toContainText('Editable Gaussian controls'); await expect(reverse.getByRole('checkbox')).not.toBeChecked(); await reverse.getByRole('checkbox').check();
	const pending = page.waitForEvent('download'); await reverse.getByRole('button', { name: 'Download AE Exchange Package', exact: true }).click();
	const downloaded = await pending, reader = new ZipReader(new BlobReader(new Blob([new Uint8Array(await readFile((await downloaded.path())!))])));
	try {
		const entries = await reader.getEntries(), manifest = entries.find(entry => entry.filename === 'motionae.json'), original = entries.find(entry => entry.filename === 'original.mscape');
		if (!manifest || manifest.directory || !original || original.directory) throw new Error('Expected editable exchange and retained original.');
		const exchange = parseMotionAeExchange(await manifest.getData!(new TextWriter())); expect(exchange.gaussianProfile).toEqual(gaussianProfile);
		const parade = exchange.compositions[0]!.layers[0]!.properties.find(property => property.matchName === 'ADBE Effect Parade');
		if (parade?.kind !== 'group' || parade.children[0]?.kind !== 'group') throw new Error('Expected reviewed Gaussian effect group.');
		const blur = parade.children[0].children.find(property => property.matchName === gaussianProfile.blurrinessPath[0]);
		if (blur?.kind !== 'numeric') throw new Error('Expected reviewed blur scalar.');
		expect(blur.keys.map(key => key.value)).toEqual([[4], [12]]); expect(blur.keys.map(key => key.time)).toEqual([0, 0.5]);
		const retained = await importMotionscaperArchive(await original.getData!(new BlobWriter()), () => ({ async writeAssetChunk() {}, async finishAsset() {}, async commit() {}, async rollback() {} }));
		if (retained.kind !== 'current') throw new Error('Expected Motion custody.');
		expect(retained.project.interchangeCustody?.exchange).toEqual(source);
		expect(retained.project.compositions[0]!.layers[0]!.effects[0]!.parameters[0]!.value).toEqual(sigma);
	} finally { await reader.close(); }
	await dialog.getByRole('button', { name: 'Remove Gaussian Profile', exact: true }).click(); await expect(reverse).toHaveCount(0);
	await expect(dialog.getByLabel('Reviewed Gaussian profile for export', { exact: true })).toHaveValue('');
});
