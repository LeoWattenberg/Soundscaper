/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { ordinaryBrowserProductSitePlan } from '../../scripts/lib/browser-product-site-plan.mjs';
import { createMotionscaperProject, createMotionLayer } from '../../src/motionscaper/editor-project.ts';
import { prepareMotionscaperAeExport } from '../../src/motionscaper/editor-ae-export-conversion.ts';
import { motionPropertyOfKind, motionScalar, motionVector } from '../../src/common/editor/motion-property.ts';
import type { MotionAeExchange } from '../../src/common/editor/motion-ae-exchange-types.ts';
test.use({ baseURL: ordinaryBrowserProductSitePlan().sites[2]!.origin });
async function menu(page: Page, command: string, top = 'File'): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: command, exact: true }).click();
}
test('AE menu imports hard-edge masks and a disabled matte source, renders their pixels, and exports retained geometry', async ({ page }: { page: Page }) => {
	await page.goto('/embed/en/');
	const bytes = Buffer.from(await page.evaluate(async () => {
		const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64; const context = canvas.getContext('2d')!;
		context.fillStyle = '#ff0000'; context.fillRect(0, 0, 64, 64);
		const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG encoding failed.')), 'image/png'));
		return Array.from(new Uint8Array(await blob.arrayBuffer()));
	}));
	const sha256 = createHash('sha256').update(bytes).digest('hex'), asset = { kind: 'image' as const, id: 'image', name: 'Red.png', mimeType: 'image/png', width: 64, height: 64,
		byteLength: bytes.length, sha256, storageKey: `motion-sha256:${sha256}`, hasAlpha: true };
	const project = createMotionscaperProject({ id: 'source', title: 'Editable AE masks', compositionId: 'comp', width: 64, height: 64, frameRate: { num: 24, den: 1 }, durationFrames: 24 });
	const layer = createMotionLayer({ id: 'layer', name: 'Masked red', durationFrames: 24, content: { kind: 'image', assetId: asset.id } });
	const path = motionPropertyOfKind({ kind: 'path', value: { closed: true, vertices: [[0, 0], [32, 0], [32, 64], [0, 64]].map(point => ({ point, inTangent: [0, 0], outTangent: [0, 0] })) }, keyframes: [], segments: [], expression: null }, 'path');
	const prepared = prepareMotionscaperAeExport({ ...project, assets: [asset], compositions: [{ ...project.compositions[0]!, layers: [{ ...layer,
		masks: [{ id: 'half', path, opacity: motionScalar(1), feather: motionVector([0, 0]), expansion: motionScalar(0), inverted: false, operation: 'add' }],
	}] }] });
	const composition = prepared.exchange.compositions[0]!, source = composition.layers[0]!;
	const exchangeInput: MotionAeExchange = { ...prepared.exchange, compositions: [{ ...composition, layers: [{ ...source, enabled: false }, { ...source,
		id: 'matte-consumer', name: 'Matte consumer', matte: { layerId: source.id, type: 'alpha' }, properties: source.properties.filter(property => property.matchName !== 'ADBE Mask Parade'),
	}] }] };
	await menu(page, 'After Effects Bridge'); const dialog = page.getByRole('dialog', { name: 'After Effects Bridge', exact: true });
	await dialog.getByLabel('AE exchange manifest', { exact: true }).setInputFiles({ name: 'motionae.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exchangeInput)) });
	await dialog.getByLabel('Package media files', { exact: true }).setInputFiles({ name: 'media-0.png', mimeType: 'image/png', buffer: bytes });
	await dialog.getByRole('button', { name: 'Review Import', exact: true }).click();
	await expect(dialog.getByRole('region', { name: 'Conversion report', exact: true })).toContainText('Mask path, opacity, inversion and operation remain editable');
	await expect(dialog.getByRole('region', { name: 'Conversion report', exact: true })).toContainText('original source visibility is retained');
	await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Import New Project', exact: true }).click(); await expect(dialog).toHaveCount(0);
	await menu(page, 'Composition Preview', 'View'); const preview = page.getByRole('dialog', { name: 'Composition Preview', exact: true }), canvas = preview.locator('canvas');
	await expect(canvas).toHaveAttribute('data-motion-frame', '0');
	expect(await canvas.evaluate((element: HTMLCanvasElement) => { const context = element.getContext('2d')!; return [Array.from(context.getImageData(8, 8, 1, 1).data), Array.from(context.getImageData(48, 8, 1, 1).data)]; })).toEqual([[255, 0, 0, 255], [0, 0, 0, 0]]);
	await preview.getByRole('button', { name: 'Close', exact: true }).last().click(); await menu(page, 'Save');
	await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await menu(page, 'After Effects Bridge');
	await dialog.getByRole('button', { name: 'Review Export', exact: true }).click();
	const report = dialog.getByRole('region', { name: 'Export conversion report', exact: true }); await expect(report).toContainText('Mask geometry, opacity, inversion and operation');
	await report.getByRole('checkbox').check(); const pending = page.waitForEvent('download'); await report.getByRole('button', { name: 'Download AE Exchange Package', exact: true }).click();
	const download = await pending, reader = new ZipReader(new BlobReader(new Blob([new Uint8Array(await readFile((await download.path())!))])));
	try {
		const entry = (await reader.getEntries()).find(item => item.filename === 'motionae.json')!; if (entry.directory) throw new Error('Expected manifest');
		const exchange = JSON.parse(await entry.getData!(new TextWriter())) as MotionAeExchange;
		const consumer = exchange.compositions[0]!.layers.find(item => item.name === 'Matte consumer')!;
		expect(consumer.matte?.type).toBe('alpha'); expect(exchange.compositions[0]!.layers.find(item => item.id === consumer.matte?.layerId)?.enabled).toBe(false);
		const masks = exchange.compositions[0]!.layers[0]!.properties.find(property => property.matchName === 'ADBE Mask Parade')!;
		expect(masks.kind).toBe('group'); if (masks.kind !== 'group') throw new Error('Expected mask group');
		expect(masks.children[0]!.kind).toBe('group'); const mask = masks.children[0]!; if (mask.kind !== 'group') throw new Error('Expected mask');
		expect(mask.mask?.mode).toBe('add'); expect(mask.children.find(property => property.kind === 'shape')?.kind).toBe('shape');
	} finally { await reader.close(); }
});
