/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoBatchExportMenuCopy } from '../../src/common/i18n/lightscaper-photo-batch-export-menu-copy.ts';
import { photoBatchExportCopy } from '../../src/common/i18n/lightscaper-photo-batch-export-copy.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { assertNativeOpfsWorkerExecution, installNativeOpfsWorkerCompanion } from './helpers/native-opfs-worker-companion.ts';

const observedTest = test.extend({ browserCoverage: false });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==', 'base64');
for (const locale of ['en', 'de']) {
	test(`${locale}: selected photo downloads and queue remain opt-in cold File entries`, async ({ page }) => {
		const requested = []; page.on('request', request => { if (request.resourceType() === 'script') requested.push(request.url()); });
		const { app, copy } = await open(page, locale); await menu(page, app, copy.photoFileMenu);
		await expect(app.locator('[data-photo-batch-export-menu]')).toBeDisabled(); await expect(app.locator('[data-photo-queue-export-menu]')).toBeEnabled();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		expect(requested.filter(url => /(?:PhotoRasterBatchExportDialog|photo-raster-export-batch-queue|lightscaper-photo-batch-export-copy|editor-png-bytes)/u.test(url))).toEqual([]);
	});
	for (const format of ['png', 'jpeg']) observedTest(`${locale}: selected ${format} downloads preserve order, current originals and the hidden queue`, async ({ page, browserName }) => {
		observedTest.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.'); observedTest.setTimeout(90_000);
		const errors = [], downloads = []; page.on('pageerror', error => { errors.push(error.message); }); page.on('download', download => { downloads.push(download); });
		await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: () => { throw new Error('Batch cannot open a deferred picker'); } }); });
		await installNativeOpfsWorkerCompanion(page);
		const { app, copy } = await open(page, locale), words = photoBatchExportCopy(locale), labels = photoBatchExportMenuCopy(locale);
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
		const importer = named(page, 'dialog', copy.photoImportPhotos);
		await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles([
			{ name: 'First.png', mimeType: 'image/png', buffer: PNG }, { name: 'Second.png', mimeType: 'image/png', buffer: PNG },
		]);
		await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
		const library = app.locator('[data-photo-library]'), cards = library.locator('[data-photo-id]');
		await expect(cards).toHaveCount(2); await expect(library).toHaveAttribute('aria-busy', 'false');
		const ids = await cards.evaluateAll(elements => elements.map(element => element.getAttribute('data-photo-id')));
		const before = await observe(page, ids); expect(before.photos.map(item => item.bytes)).toEqual([[...PNG], [...PNG]]);
		expect(before.photos.map(item => item.photo.original.contentSha256)).toEqual(Array(2).fill(createHash('sha256').update(PNG).digest('hex')));
		await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu); await keyboard(page, named(app, 'button', copy.photoSelectAll));
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', labels.downloadSelected));
		let dialog = named(page, 'dialog', words.title); await expect(dialog.locator('[data-photo-batch-export-start]')).toBeEnabled();
		await keyboard(page, dialog.locator('[data-photo-batch-export-hide]')); await expect(dialog).toHaveCount(0);
		// A later selection change cannot replace the menu-captured page order.
		await keyboard(page, cards.first());
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', labels.queue));
		dialog = named(page, 'dialog', words.title);
		await choose(page, dialog.locator('[data-photo-batch-export-format]'), format);
		await keyboard(page, dialog.locator('[data-photo-batch-export-start]'));
		await keyboard(page, dialog.locator('[data-photo-batch-export-hide]')); await expect(dialog).toHaveCount(0);
		await expect.poll(() => downloads.length).toBe(2);
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', labels.queue));
		// A settled queue reopens from its durable journal with a fresh selection
		// for explicit replacement, rather than retaining the old live receipt.
		dialog = named(page, 'dialog', words.title);
		const history = dialog.getByRole('listitem'); await expect(history).toHaveCount(2);
		await expect(named(dialog, 'button', words.continue)).toBeDisabled(); await expect(dialog.getByRole('alert')).toHaveCount(0);
		const names = before.photos.map((item, index) => `${String(index + 1).padStart(2, '0')}-${item.photo.metadata.fileName.replace(/\.[^.]*$/u, '')}.${format === 'png' ? 'png' : 'jpg'}`);
		expect(downloads.map(download => download.suggestedFilename())).toEqual(names);
		for (const [index, download] of downloads.entries()) {
			await expect(history.nth(index)).toContainText(words.downloaded.replace('{name}', names[index]));
			const bytes = await readFile(await download.path());
			if (format === 'png') assertPng(bytes);
			const decoded = await page.evaluate(async input => {
				const bitmap = await createImageBitmap(new Blob([Uint8Array.from(input.bytes)], { type: input.mimeType }));
				try { const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
					return { width: bitmap.width, height: bitmap.height, pixels: [...context.getImageData(0, 0, bitmap.width, bitmap.height).data] }; }
				finally { bitmap.close(); }
			}, { bytes: [...bytes], mimeType: format === 'png' ? 'image/png' : 'image/jpeg' });
			expect([decoded.width, decoded.height]).toEqual([2, 2]);
			for (let offset = 0; offset < decoded.pixels.length; offset += 4) {
				for (const [channel, value] of [255, 32, 0, 255].entries()) expect(Math.abs(decoded.pixels[offset + channel] - value)).toBeLessThanOrEqual(format === 'png' ? 0 : 3);
			}
		}
		expect(await observe(page, ids)).toEqual(before); expect(errors).toEqual([]);
		await page.reload(); await expect(app).toBeVisible(); expect(await observe(page, ids)).toEqual(before);
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', labels.queue));
		dialog = named(page, 'dialog', words.title); await expect(dialog.locator('[data-journal-state="already-committed"]')).toHaveCount(2);
		await expect(dialog.locator('[data-photo-batch-export-start]')).toBeDisabled(); expect(downloads).toHaveLength(2);
		const committed = await observeJournal(page); expect(committed.members.map(member => member.delivery.status)).toEqual(['download-started', 'download-started']);
		// A real native CAS conditions the interrupted scalar state. This tests
		// reopen/review, not a fabricated physical crash or durable download ACK.
		await observeJournal(page, format === 'png' ? 'pending' : 'started');
		await page.reload(); await expect(app).toBeVisible(); await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', labels.queue));
		dialog = named(page, 'dialog', words.title); await expect(dialog.locator('[data-journal-state="already-committed"]')).toHaveCount(1); expect(downloads).toHaveLength(2);
		if (format === 'jpeg') {
			await expect(dialog.locator('[data-journal-state="needs-review"]')).toHaveCount(1); await expect(dialog.locator('[data-photo-batch-export-start]')).toBeDisabled();
			const review = dialog.getByRole('checkbox', { name: words.review.replace('{name}', names[1]), exact: true });
			await review.focus(); await expect(review).toBeFocused(); await page.keyboard.press('Space'); await expect(review).toBeChecked();
		}
		await expect(dialog.locator('[data-photo-batch-export-start]')).toBeEnabled(); await keyboard(page, dialog.locator('[data-photo-batch-export-start]'));
		await expect.poll(() => downloads.length).toBe(3); await expect(dialog.locator('[data-photo-batch-export-receipt]')).toHaveAttribute('data-phase', 'settled');
		expect(downloads[2].suggestedFilename()).toBe(names[1]); await expect(dialog.locator('[data-photo-batch-job]')).toHaveCount(1);
		expect((await observeJournal(page)).members.map(member => member.state)).toEqual(['committed', 'committed']);
		expect(await observe(page, ids)).toEqual(before); expect(errors).toEqual([]);
		await observeJournal(page, format === 'png' ? 'pending' : 'started');
		await page.reload(); await expect(app).toBeVisible(); await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', labels.queue));
		dialog = named(page, 'dialog', words.title);
		const forget = named(dialog, 'button', words.discard), reviewForget = named(dialog, 'checkbox', words.discardReview);
		await expect(forget).toBeDisabled(); await expect(dialog).toContainText(words.discardWarning);
		await reviewForget.focus(); await expect(reviewForget).toBeFocused(); await page.keyboard.press('Space'); await expect(reviewForget).toBeChecked();
		await keyboard(page, forget); await expect(dialog.getByRole('status')).toHaveText(words.empty);
		expect(await observeJournal(page)).toBeNull(); expect(downloads).toHaveLength(3); expect(await observe(page, ids)).toEqual(before);
		await keyboard(page, named(dialog, 'button', words.hide));
		await menu(page, app, copy.photoViewMenu); await keyboard(page, named(app, 'button', copy.photoShowLibrary)); await expect(library).toBeVisible();
		await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu); await keyboard(page, named(app, 'button', copy.photoSelectAll));
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', labels.downloadSelected));
		dialog = named(page, 'dialog', words.title); await choose(page, named(dialog, 'combobox', words.format), format);
		await keyboard(page, named(dialog, 'button', words.start)); await expect.poll(() => downloads.length).toBe(5);
		await expect(dialog.locator('[data-photo-batch-export-receipt]')).toHaveAttribute('data-phase', 'settled');
		expect(downloads.slice(3).map(download => download.suggestedFilename())).toEqual(names);
		expect((await observeJournal(page)).members.map(member => member.state)).toEqual(['committed', 'committed']);
		expect(await observe(page, ids)).toEqual(before); expect(errors).toEqual([]);
	});
}
function assertPng(bytes) {
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]); const compressed = []; let offset = 8;
	while (offset < bytes.length) {
		const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, offset + 8 + size);
		if (type === 'IHDR') expect([...data]).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
		else if (type === 'IDAT') compressed.push(data); else expect(['sRGB', 'IEND']).toContain(type);
		offset += size + 12;
	}
	expect(offset).toBe(bytes.length); expect([...inflateSync(Buffer.concat(compressed))]).toEqual([0, 255, 32, 0, 255, 255, 32, 0, 255, 0, 255, 32, 0, 255, 255, 32, 0, 255]);
}
async function open(page, locale) {
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	return { app, copy: bundledLightscaperEditorCopyForLocale(locale) };
}
async function observe(page, ids) {
	const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../helpers/', import.meta.url)), contents: `export { readResidentPhotoLibraryCurrent } from './lightscaper-current-app-fixture.tsx';` }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.woff2': 'dataurl' } });
	await page.route('**/__batch_export_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const result = await page.evaluate(async photoIds => (await import(new URL('/__batch_export_observer.js', location.href).href)).readResidentPhotoLibraryCurrent(photoIds, indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution()), ids);
	await assertNativeOpfsWorkerExecution(page); return result;
}
async function observeJournal(page, state = null) {
	const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../../', import.meta.url)), contents: `
		import { createPhotoLibrarySessionV3 } from './src/lightscaper/photo-library-session-runtime-v3.ts';
		import { normalizePhotoRasterExportJournalV1, photoRasterExportJournalKeyV1 } from './src/lightscaper/storage/photo-raster-export-journal-v1.ts';
		export async function observeJournal(state) {
			const session = await createPhotoLibrarySessionV3({ name: 'Observed existing photo library' });
			try {
				const access = await session.exportJournal.open(), key = photoRasterExportJournalKeyV1(access.catalogId), raw = await access.settings.get(key);
				if (raw === undefined) { if (state !== null) throw new Error('No retained fixture journal'); await globalThis.__assertNativeOpfsWorkerExecution(); return null; }
				const journal = normalizePhotoRasterExportJournalV1(raw); let result = journal;
				if (state !== null) {
					if (state !== 'pending' && state !== 'started') throw new Error('Unsupported fixture interruption');
					const next = normalizePhotoRasterExportJournalV1({ ...journal, revision: journal.revision + 1, members: journal.members.map((member,index) => index ? { ...member,state,delivery:null } : member) });
					if (await access.settings.replaceIfCurrent(key,raw,next) !== true) throw new Error('Native fixture journal CAS changed');
					result = next;
				}
				await globalThis.__assertNativeOpfsWorkerExecution();
				return result;
			} finally { await session.close(); }
		}` }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.woff2': 'dataurl' } });
	await page.route('**/__batch_journal_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const result = await page.evaluate(async state => (await import(new URL('/__batch_journal_observer.js', location.href).href)).observeJournal(state), state);
	await assertNativeOpfsWorkerExecution(page); return result;
}
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function menu(page, app, name) { await keyboard(page, app.locator('summary').filter({ hasText: new RegExp(`^${name}$`, 'u') })); }
async function choose(page, combo, value) {
	await expect(combo).toBeVisible(); await expect(combo).toBeEnabled();
	await expect.poll(() => combo.locator('option').evaluateAll((options, value) => options.some(option => option.value === value), value)).toBe(true);
	const index = await combo.locator('option').evaluateAll((options, value) => options.findIndex(option => option.value === value), value);
	expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(64); await combo.focus(); await expect(combo).toBeFocused(); await page.keyboard.press('Home');
	for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown'); await expect(combo).toHaveValue(value);
}
