/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { BlobReader, BlobWriter, TextWriter, ZipReader } from '@zip.js/zip.js';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { ordinaryBrowserProductSitePlan } from '../../scripts/lib/browser-product-site-plan.mjs';
import { importMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
import type { MotionAeExchange, MotionAeLayer } from '../../src/common/editor/motion-ae-exchange-types.ts';
test.use({ baseURL: ordinaryBrowserProductSitePlan().sites[2]!.origin });
async function menu(page: Page, command: string, top = 'File'): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click();
	await page.getByRole('menuitem', { name: command, exact: true }).click();
}
async function fixture(page: Page) {
	const encoded = await page.evaluate(async () => {
		const images: number[][] = [];
		for (const color of ['rgba(255,0,0,0.5)', 'blue']) {
			const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
			const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, 32, 32);
			const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG encoding failed.')), 'image/png'));
			images.push(Array.from(new Uint8Array(await blob.arrayBuffer())));
		}
		return images;
	});
	const files = encoded.map((bytes, index) => ({ name: index === 0 ? 'used.png' : 'unused.png', mimeType: 'image/png', buffer: Buffer.from(bytes) }));
	const base: MotionAeLayer = { id: 'picture-layer', name: 'Original picture', kind: 'footage', sourceId: 'picture-0', parentId: null, matte: null,
		startTime: 0, inPoint: 0, outPoint: 1, stretch: 100, enabled: true, threeD: false, adjustment: false, blendMode: 'normal', properties: [] };
	const exchange: MotionAeExchange = { format: 'org.motionscaper.ae-exchange', version: 1, transferId: 'browser-transfer',
		producer: { application: 'after-effects', version: 'unqualified synthetic fixture', bridgeVersion: '0.1.0' }, source: { name: 'Original Cafe\u0301.aep', revisionDigest: null },
		color: { workingSpace: '', linearBlending: false, bitsPerChannel: 8 },
		footage: files.map((file, index) => ({ id: `picture-${index}`, name: index === 0 ? 'Original Cafe\u0301.png' : 'Original unused picture.png', path: `media/${file.name}`,
			byteLength: file.buffer.length, sha256: createHash('sha256').update(file.buffer).digest('hex'), width: 64, height: 64, pixelAspect: 1, frameRate: 1, duration: 0, hasVideo: true, hasAudio: false, still: true })),
		compositions: [{ id: 'original-composition', name: 'Original composition', width: 64, height: 64, pixelAspect: 1, frameRate: 24, duration: 1, displayStartTime: 0, background: [0, 0, 0],
			layers: [base, { ...base, id: 'unsupported-text', name: 'Original title', kind: 'text', sourceId: null, properties: [
				{ kind: 'unsupported', name: 'Original text intent', matchName: 'ADBE Text Properties', reason: 'Retain original text intent' },
			] }] }],
		report: [{ scopeId: 'unsupported-text', propertyPath: '0:ADBE Text Properties', code: 'property', status: 'unsupported', message: 'Retain original text intent' }] };
	return { files, exchange, manifest: { name: 'motionae.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exchange)) } };
}

test('AE bridge stays opt-in, downloads readable scripts and routes Adobe project files to installed AE', async ({ page }: { page: Page }) => {
	await page.goto('/embed/en/'); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'After Effects Bridge'); const dialog = page.getByRole('dialog', { name: 'After Effects Bridge', exact: true });
	await expect(dialog).toContainText('No installed After Effects version is qualified');
	const downloaded = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Download Bridge Scripts', exact: true }).click();
	const scripts = await downloaded; expect(scripts.suggestedFilename()).toBe('Motionscaper-AE-Bridge-0.1.0.zip');
	const reader = new ZipReader(new BlobReader(new Blob([new Uint8Array(await readFile((await scripts.path())!))])));
	try {
		const entries = await reader.getEntries(); expect(entries.map(entry => entry.filename)).toEqual(expect.arrayContaining(['Motionscaper-Export.jsx', 'Motionscaper-Export-Sampled.jsx', 'Motionscaper-Import.jsx', 'LICENSE.txt']));
		const exporter = entries.find(entry => entry.filename === 'Motionscaper-Export.jsx')!;
		if (exporter.directory) throw new Error('Expected readable script.');
		expect(await exporter.getData!(new TextWriter())).toContain('#include');
	} finally { await reader.close(); }
	await dialog.getByLabel('AE exchange manifest', { exact: true }).setInputFiles({ name: 'Original.aep', mimeType: 'application/octet-stream', buffer: Buffer.from('untouched binary project') });
	await expect(dialog).toContainText('Open this project in installed After Effects');
	await expect(dialog.getByRole('button', { name: 'Review Import', exact: true })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click(); await expect(dialog).toHaveCount(0);
	await menu(page, 'Open'); await page.getByLabel('Scape project (.mscape, .fscape, .sscape)', { exact: true }).setInputFiles({ name: 'Original.aepx', mimeType: 'application/xml', buffer: Buffer.from('<AfterEffectsProject/>') });
	await expect(dialog).toContainText('Original.aepx'); await expect(dialog).toContainText('Open this project in installed After Effects');
});

test('AE import reviews unsupported intent, paints retained PNG pixels and preserves original custody through save/reopen/.mscape', async ({ page }: { page: Page }) => {
	await page.goto('/embed/en/'); const source = await fixture(page); await menu(page, 'After Effects Bridge');
	const dialog = page.getByRole('dialog', { name: 'After Effects Bridge', exact: true });
	await dialog.getByLabel('AE exchange manifest', { exact: true }).setInputFiles(source.manifest);
	await dialog.getByLabel('Package media files', { exact: true }).setInputFiles(source.files);
	await dialog.getByRole('button', { name: 'Review Import', exact: true }).click();
	await expect(dialog.getByRole('region', { name: 'Conversion report', exact: true })).toContainText('Retain original text intent');
	const commit = dialog.getByRole('button', { name: 'Import New Project', exact: true }); await expect(commit).toBeDisabled();
	await expect(page.locator('[data-motion-project-title]')).toHaveCount(0);
	const downloaded = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Download Report and Original Exchange', exact: true }).click();
	const reportDownload = await downloaded;
	const report = JSON.parse(await readFile((await reportDownload.path())!, 'utf8')) as { sourceExchange: MotionAeExchange; report: unknown };
	expect(report.sourceExchange).toEqual(source.exchange);
	await dialog.getByRole('checkbox').check(); await commit.click(); await expect(dialog).toHaveCount(0);
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Original Café.aep');
	await menu(page, 'Composition Preview', 'View'); const preview = page.getByRole('dialog', { name: 'Composition Preview', exact: true }), canvas = preview.locator('canvas');
	await expect(canvas).toHaveAttribute('data-motion-frame', '0');
	expect(await canvas.evaluate((element: HTMLCanvasElement) => { const context = element.getContext('2d')!; return [Array.from(context.getImageData(8, 8, 1, 1).data), Array.from(context.getImageData(48, 48, 1, 1).data)]; })).toEqual([[255, 0, 0, 128], [0, 0, 0, 0]]);
	await preview.getByRole('button', { name: 'Close', exact: true }).last().click(); await menu(page, 'Save');
	await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload();
	await menu(page, 'Project Library'); await page.getByRole('button', { name: 'Original Café.aep', exact: true }).click();
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Original Café.aep');
	const saved = page.waitForEvent('download'); await menu(page, 'Save Copy'); const archive = await saved;
	const retained = new Map<string, Uint8Array[]>();
	const result = await importMotionscaperArchive(new Blob([new Uint8Array(await readFile((await archive.path())!))]), () => ({
		writeAssetChunk: (asset, bytes) => { const chunks = retained.get(asset.id) ?? []; chunks.push(bytes.slice()); retained.set(asset.id, chunks); return Promise.resolve(); },
		finishAsset: () => Promise.resolve(), commit: () => Promise.resolve(), rollback: () => Promise.resolve(),
	}));
	expect(result.kind).toBe('current'); if (result.kind !== 'current') throw new Error('Expected current archive.');
	expect(result.project.interchangeCustody?.exchange).toEqual(source.exchange); expect(result.project.interchangeCustody?.report).toEqual(report.report);
	expect(result.project.compositions[0]!.layers.find(layer => layer.name === 'Original title')?.kind).toBe('null');
	for (const [index, original] of source.exchange.footage.entries()) {
		const binding = result.project.interchangeCustody!.media.find(item => item.sourceId === original.id)!;
		expect(Buffer.concat(retained.get(binding.assetId)!)).toEqual(source.files[index]!.buffer);
		expect(result.project.assets.find(asset => asset.id === binding.assetId)!.name).toBe(original.name.normalize('NFC'));
	}
});

test('missing originals and digest mismatches refuse AE publication while closing a review preserves the open project', async ({ page }: { page: Page }) => {
	await page.goto('/embed/en/'); const source = await fixture(page); await menu(page, 'New Composition');
	await page.getByLabel('Project title', { exact: true }).fill('Prior project'); await page.getByRole('button', { name: 'Create', exact: true }).click();
	await menu(page, 'After Effects Bridge'); const dialog = page.getByRole('dialog', { name: 'After Effects Bridge', exact: true });
	await dialog.getByLabel('AE exchange manifest', { exact: true }).setInputFiles(source.manifest);
	await dialog.getByLabel('Package media files', { exact: true }).setInputFiles([source.files[0]!]); await dialog.getByRole('button', { name: 'Review Import', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText('Every original AE media file must be selected');
	await expect(dialog.getByRole('button', { name: 'Import New Project', exact: true })).toHaveCount(0);
	const corrupt = { ...source.exchange, footage: source.exchange.footage.map((item, index) => index === 0 ? { ...item, sha256: '0'.repeat(64) } : item) };
	await dialog.getByLabel('AE exchange manifest', { exact: true }).setInputFiles({ ...source.manifest, buffer: Buffer.from(JSON.stringify(corrupt)) });
	await dialog.getByLabel('Package media files', { exact: true }).setInputFiles(source.files); await dialog.getByRole('button', { name: 'Review Import', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText('does not match retained source metadata');
	await dialog.getByLabel('AE exchange manifest', { exact: true }).setInputFiles(source.manifest); await dialog.getByRole('button', { name: 'Review Import', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Import New Project', exact: true })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click(); await expect(page.locator('[data-motion-project-title]')).toHaveText('Prior project');
	await menu(page, 'Project Library'); await expect(page.getByRole('button', { name: 'Original Café.aep', exact: true })).toHaveCount(0);
});

test('AE rendered fallback imports and seeks every retained PNG frame without flattening the sequence', async ({ page }: { page: Page }) => {
	await page.goto('/embed/en/'); const source = await fixture(page);
	const exchange: MotionAeExchange = { ...source.exchange, footage: source.exchange.footage.map(item => ({ ...item, frameRate: 24 })),
		compositions: source.exchange.compositions.map(item => ({ ...item, duration: 2 / 24 })), report: [
			...source.exchange.report, ...source.exchange.footage.map((item, index) => ({ scopeId: 'original-composition', propertyPath: `frame/${index}`, status: 'rendered' as const, code: 'composition-render-frame', mediaId: item.id, message: 'Whole composition reference, unqualified AE host.' })),
		] };
	await menu(page, 'After Effects Bridge'); const dialog = page.getByRole('dialog', { name: 'After Effects Bridge', exact: true });
	await dialog.getByLabel('AE exchange manifest', { exact: true }).setInputFiles({ ...source.manifest, buffer: Buffer.from(JSON.stringify(exchange)) });
	await dialog.getByLabel('Package media files', { exact: true }).setInputFiles(source.files); await dialog.getByRole('button', { name: 'Review Import', exact: true }).click();
	await expect(dialog.getByRole('region', { name: 'Conversion report', exact: true })).toContainText('Rendered: 2');
	await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Import New Project', exact: true }).click(); await expect(dialog).toHaveCount(0);
	await menu(page, 'Composition Preview', 'View'); const preview = page.getByRole('dialog', { name: 'Composition Preview', exact: true }), canvas = preview.locator('canvas');
	await expect(canvas).toHaveAttribute('data-motion-frame', '0');
	const pixel = () => canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(8, 8, 1, 1).data));
	expect(await pixel()).toEqual([255, 0, 0, 128]); await preview.getByLabel('Frame', { exact: true }).fill('1');
	await expect(canvas).toHaveAttribute('data-motion-frame', '1'); expect(await pixel()).toEqual([0, 0, 255, 255]);
});

test('Motion-authored AE export reviews omissions and downloads exact source custody without saving the document', async ({ page }: { page: Page }) => {
	await page.goto('/embed/en/'); await menu(page, 'After Effects Bridge');
	const dialog = page.getByRole('dialog', { name: 'After Effects Bridge', exact: true });
	await expect(dialog.getByRole('button', { name: 'Review Export', exact: true })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await menu(page, 'New Composition'); await page.getByLabel('Project title', { exact: true }).fill('Motion original');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(dialog).toHaveCount(0);
	const source = await fixture(page); await menu(page, 'Import Media');
	await page.getByLabel('Media file', { exact: true }).setInputFiles(source.files[0]!); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'New Rectangle', 'Layer'); await page.getByLabel('Layer name', { exact: true }).fill('Original shape intent');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	const before = await page.locator('[data-motion-save-status]').textContent();
	await menu(page, 'After Effects Bridge'); await dialog.getByRole('button', { name: 'Review Export', exact: true }).click();
	const report = dialog.getByRole('region', { name: 'Export conversion report', exact: true });
	await expect(report).toContainText('Motion original'); await expect(report).toContainText('disabled named null');
	await expect(report).toContainText('video-only'); await expect(report).toContainText('original.mscape');
	const button = report.getByRole('button', { name: 'Download AE Exchange Package', exact: true }); await expect(button).toBeDisabled();
	await report.getByRole('checkbox').check(); const pending = page.waitForEvent('download'); await button.click(); const result = await pending;
	expect(result.suggestedFilename()).toBe('Motionscaper-AE-Export.zip'); await expect(report.getByRole('status')).toContainText('not changed or saved');
	const reader = new ZipReader(new BlobReader(new Blob([new Uint8Array(await readFile((await result.path())!))])));
	try {
		const entries = await reader.getEntries(), manifest = entries.find(entry => entry.filename === 'motionae.json')!, original = entries.find(entry => entry.filename === 'original.mscape')!;
		if (manifest.directory || original.directory) throw new Error('Expected preserved files');
		const exchange = JSON.parse(await manifest.getData!(new TextWriter())) as MotionAeExchange;
		expect(exchange.producer.application).toBe('motionscaper'); expect(exchange.report.some(entry => entry.code === 'layer-kind')).toBe(true);
		const retained: Uint8Array[] = [], opened = await importMotionscaperArchive(await original.getData!(new BlobWriter()), () => ({
			async writeAssetChunk(_asset, bytes) { retained.push(bytes.slice()); }, async finishAsset() {}, async commit() {}, async rollback() {},
		}));
		expect(opened.kind).toBe('current'); if (opened.kind !== 'current') throw new Error('Expected Motion source');
		expect(opened.project.title).toBe('Motion original'); expect(opened.project.compositions[0]!.layers.some(layer => layer.kind === 'shapes' && layer.name === 'Original shape intent')).toBe(true);
		expect(Buffer.concat(retained)).toEqual(source.files[0]!.buffer);
	} finally { await reader.close(); }
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Motion original'); await expect(page.locator('[data-motion-save-status]')).toHaveText(before!);
});
