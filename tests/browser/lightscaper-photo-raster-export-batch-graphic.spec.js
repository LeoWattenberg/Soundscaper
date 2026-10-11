/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoBatchExportMenuCopy } from '../../src/common/i18n/lightscaper-photo-batch-export-menu-copy.ts';
import { photoBatchExportCopy } from '../../src/common/i18n/lightscaper-photo-batch-export-copy.ts';
import { imageExportGraphicCopy } from '../../src/common/i18n/image-export-graphic-copy.ts';
import { pngChunk } from '../helpers/image-metadata-fixtures.ts';
import { expect, test, installNativeImageHandoffRuntime, observeNativeImageHandoffLibrary,
	observeNativePhotoRasterBatchGraphicJournal } from './helpers/lightscaper-image-handoff-native-fixture.js';

const COLORS = [[20, 40, 60, 255], [80, 120, 160, 255]], ORIGINALS = COLORS.map(color => png(color, 2));
const MARK = png([255, 0, 0, 255], 1), WRONG = png([0, 0, 255, 255], 1);
for (const locale of ['en', 'de']) {
	test(`${locale}: batch graphics remain opt-in behind the File menu`, async ({ page }) => {
		const requested = []; page.on('request', request => { requested.push(request.url()); });
		const { app, copy } = await open(page, locale);
		await expect(app.locator('[data-photo-library]')).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0);
		await menu(page, app, copy.photoFileMenu);
		await expect(named(app, 'button', photoBatchExportMenuCopy(locale).downloadSelected)).toBeDisabled();
		await expect(app.locator('[data-image-export-graphic-fields]')).toHaveCount(0);
		expect(requested.filter(url => /(?:PhotoRasterBatchExportDialog|photo-raster-export-batch-graphic|image-export-graphic-source)/u.test(url))).toEqual([]);
	});

	test(`${locale}: marked batch survives an actual cancelled member and requires matching graphic reselection`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.'); test.setTimeout(180_000);
		const errors = [], downloads = []; page.on('pageerror', error => { errors.push(error.message); }); page.on('download', download => { downloads.push(download); });
		await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		await installNativeImageHandoffRuntime(page);
		const { app, copy } = await open(page, locale), words = photoBatchExportCopy(locale), graphic = imageExportGraphicCopy(locale), labels = photoBatchExportMenuCopy(locale);
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
		const importer = named(page, 'dialog', copy.photoImportPhotos);
		await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles(ORIGINALS.map((buffer, index) => ({ name: `Original ${index + 1}.png`, mimeType: 'image/png', buffer })));
		await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
		const library = app.locator('[data-photo-library]'), cards = library.locator('[data-photo-id]');
		await expect(cards).toHaveCount(2); await expect(library).toHaveAttribute('aria-busy', 'false');
		const ids = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-photo-id')));
		const before = await observeNativeImageHandoffLibrary(page, ids);
		await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu); await keyboard(page, named(app, 'button', copy.photoSelectAll));
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', labels.downloadSelected));
		let dialog = named(page, 'dialog', words.title); await expect(named(dialog, 'button', words.start)).toBeEnabled();
		await toggle(page, dialog.getByLabel(graphic.enabled, { exact: true }));
		await dialog.getByLabel(graphic.file, { exact: true }).setInputFiles({ name: 'Private mark.png', mimeType: 'image/png', buffer: MARK });
		await dialog.getByLabel(graphic.width, { exact: true }).fill('50'); await dialog.getByLabel(graphic.margin, { exact: true }).fill('0');
		await expect(named(dialog, 'button', words.start)).toBeEnabled();

		// Hold an actual cold renderer response unchanged. This keeps member one
		// running while the user pauses/cancels member two; no codec is replaced.
		let release; const gate = new Promise(resolve => { release = resolve; });
		let held; const entered = new Promise(resolve => { held = resolve; });
		const route = async intercepted => { const response = await intercepted.fetch(); held(); try { await gate; await intercepted.fulfill({ response }); } finally { await response.dispose(); } };
		await page.route('**/assets/photo-develop-render-runtime-v2-*.js', route);
		try {
			await keyboard(page, named(dialog, 'button', words.start)); await entered;
			await keyboard(page, named(dialog, 'button', words.pause));
			const jobs = dialog.locator('[data-photo-batch-job]'); await expect(jobs).toHaveCount(2);
			await keyboard(page, named(jobs.nth(1), 'button', words.cancelMember)); release();
			await expect.poll(() => downloads.length).toBe(1); await expect(dialog.locator('[data-photo-batch-export-receipt]')).toHaveAttribute('data-phase', 'settled');
		} finally { release(); await page.unroute('**/assets/photo-develop-render-runtime-v2-*.js', route); }
		const interrupted = await observeNativePhotoRasterBatchGraphicJournal(page);
		expect(interrupted.members.map(member => member.state)).toEqual(['committed', 'pending']);
		expect(interrupted.graphicWatermark).toEqual({ schemaVersion: 1, kind: 'photo-raster-batch-graphic', contentSha256: createHash('sha256').update(MARK).digest('hex'),
			byteLength: MARK.length, anchor: 'bottom-right', widthFraction: 0.5, marginFraction: 0, opacity: 1 });
		const firstAck = interrupted.members[0].delivery;
		await keyboard(page, named(dialog, 'button', words.hide)); await expect(dialog).toHaveCount(0); await page.reload(); await expect(app).toBeVisible();
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', labels.queue)); dialog = named(page, 'dialog', words.title);
		await expect(dialog.locator('[data-journal-state="already-committed"]')).toHaveCount(1);
		await expect(named(dialog, 'button', words.continue)).toBeDisabled();
		await dialog.getByLabel(words.graphicReselect, { exact: true }).setInputFiles({ name: 'Wrong.png', mimeType: 'image/png', buffer: WRONG });
		await expect(dialog.getByRole('alert')).toBeVisible(); await expect(named(dialog, 'button', words.continue)).toBeDisabled();
		expect(downloads).toHaveLength(1); expect(await observeNativePhotoRasterBatchGraphicJournal(page)).toEqual(interrupted);
		await dialog.getByLabel(words.graphicReselect, { exact: true }).setInputFiles({ name: 'Same bytes with another name.png', mimeType: 'image/png', buffer: MARK });
		await expect(named(dialog, 'button', words.continue)).toBeEnabled(); await keyboard(page, named(dialog, 'button', words.continue));
		await expect.poll(() => downloads.length).toBe(2); await expect(dialog.locator('[data-photo-batch-export-receipt]')).toHaveAttribute('data-phase', 'settled');
		const finished = await observeNativePhotoRasterBatchGraphicJournal(page);
		expect(finished.members.map(member => member.state)).toEqual(['committed', 'committed']); expect(finished.members[0].delivery).toEqual(firstAck);
		expect(finished.graphicWatermark).toEqual(interrupted.graphicWatermark);
		for (const [index, download] of downloads.entries()) {
			const member = interrupted.members[index], original = before.photos.find(item => item.photo.id === member.photoId);
			expect(download.suggestedFilename()).toBe(member.fileName); expect(await download.failure()).toBeNull();
			const bytes = await readFile(await download.path()), color = COLORS[Number(original.photo.metadata.fileName.match(/\d/u)[0]) - 1];
			assertMarkedPng(bytes, color); expect(finished.members[index].delivery.size).toBe(bytes.length);
		}
		expect(await observeNativeImageHandoffLibrary(page, ids)).toEqual(before); expect(errors).toEqual([]);
	});
}

function png(color, side) {
	const header = Buffer.alloc(13); header.writeUInt32BE(side, 0); header.writeUInt32BE(side, 4); header[8] = 8; header[9] = 6;
	const rows = Array(side).fill([0, ...Array(side).fill(color).flat()]).flat();
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('sRGB', Buffer.from([0])),
		pngChunk('IDAT', deflateSync(Buffer.from(rows))), pngChunk('IEND', Buffer.alloc(0))]);
}
function assertMarkedPng(bytes, color) {
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]); const compressed = []; let offset = 8;
	while (offset < bytes.length) {
		const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, offset + 8 + size);
		if (type === 'IHDR') expect([...data]).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
		else if (type === 'IDAT') compressed.push(data); else expect(['sRGB', 'IEND']).toContain(type);
		offset += size + 12;
	}
	expect(offset).toBe(bytes.length); expect([...inflateSync(Buffer.concat(compressed))]).toEqual([0, ...color, ...color, 0, ...color, 255, 0, 0, 255]);
}
async function open(page, locale) {
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	return { app, copy: bundledLightscaperEditorCopyForLocale(locale) };
}
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function toggle(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Space'); await expect(control).toBeChecked(); }
async function menu(page, app, name) { await keyboard(page, app.getByRole('navigation').getByText(name, { exact: true })); }
