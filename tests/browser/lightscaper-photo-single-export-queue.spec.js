/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoBatchExportCopy } from '../../src/common/i18n/lightscaper-photo-batch-export-copy.ts';
import { photoBatchExportMenuCopy } from '../../src/common/i18n/lightscaper-photo-batch-export-menu-copy.ts';
import { photoPngExportCopy } from '../../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import { photoPngExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-png-export-menu-copy.ts';
import { photoJpegExportCopy } from '../../src/common/i18n/lightscaper-photo-jpeg-export-copy.ts';
import { photoJpegExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-jpeg-export-menu-copy.ts';
import { decodePinnedJpegRgbFrame, readRgbPixel } from './helpers/pinned-video-frame-decoder.mjs';
import { expect, test, installNativeImageHandoffRuntime, observeNativeImageHandoffLibrary } from './helpers/lightscaper-image-handoff-native-fixture.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==', 'base64');
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${'0.25 0 0\n'.repeat(8)}`);
const PIXELS = [137, 0, 0, 255, 137, 0, 0, 255];
const FILE_NAME = 'Single queue original.png';

for (const locale of ['en', 'de']) for (const format of ['png', 'jpeg']) {
	test(`${locale}: keyboard single ${format} save survives Hide and Export queue reopen with one native write and unchanged receipt`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.');
		test.setTimeout(90_000);
		const errors = [], downloads = [];
		page.on('pageerror', error => { errors.push(error.message); });
		page.on('download', download => { downloads.push(download.suggestedFilename()); });
		await installNativeImageHandoffRuntime(page);
		const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
		await page.goto(`${origin}/${locale}/`);
		const copy = bundledLightscaperEditorCopyForLocale(locale), batch = photoBatchExportCopy(locale), menus = photoBatchExportMenuCopy(locale);
		const words = format === 'png' ? photoPngExportCopy(locale) : photoJpegExportCopy(locale);
		const app = named(page, 'region', 'Lightscaper');
		await expect(app).toBeVisible();
		await importAndDevelop(page, app, copy, locale);
		const card = app.getByRole('button', { name: new RegExp(`^${FILE_NAME.replaceAll('.', '\\.')}`, 'u') });
		await expect(card).toHaveCount(1);
		const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy();
		const before = await observeNativeImageHandoffLibrary(page, [photoId]);
		expect(before.photos[0].bytes).toEqual([...PNG]);
		expect(before.photos[0].photo.original.contentSha256).toBe(createHash('sha256').update(PNG).digest('hex'));
		const fileName = `Single queue original.${format === 'png' ? 'png' : 'jpg'}`;
		await installDestination(page, fileName);
		const dialog = named(page, 'dialog', words.title);
		const failures = [];
		try {
			await menu(page, app, copy.photoFileMenu);
			await keyboard(page, named(app, 'button', format === 'png' ? photoPngExportMenuLabel(locale) : photoJpegExportMenuLabel(locale)));
			await expect(dialog).toBeVisible();
			const save = named(dialog, 'button', words.save);
			await expect(save).toBeEnabled(); await expect(save).toBeFocused();
			await keyboard(page, save);
			await expect.poll(() => destinationStats(page)).toMatchObject({ pickers: 1, writableOpens: 1, writeAcks: 1, closeCalls: 0, closeAcks: 0,
				abortCalls: 0, abortAcks: 0, rasterReads: 1, held: true, released: false, activePickerGesture: true, requestedName: fileName });
			await expect(save).toBeDisabled();
			await expect(dialog.getByRole('status').filter({ hasText: words.working })).toHaveText(words.working);
			await expect(dialog.locator(`[data-photo-${format}-export-receipt]`)).toHaveCount(0);
			const pending = await destinationStats(page);
			await keyboard(page, named(dialog, 'button', batch.hide)); await expect(dialog).toHaveCount(0);
			await reopen();
			await expect(named(dialog, 'button', words.save)).toBeDisabled();
			await expect(dialog.getByRole('status').filter({ hasText: words.working })).toHaveText(words.working);
			await expect(dialog.locator(`[data-photo-${format}-export-receipt]`)).toHaveCount(0);
			expect(await destinationStats(page)).toEqual(pending);
			await page.evaluate(() => globalThis.__singleExportDestination.release());
			const receipt = dialog.locator(`[data-photo-${format}-export-receipt]`);
			await expect(receipt).toBeVisible(); await expect(receipt).toHaveAttribute(`data-photo-${format}-export-status`, 'saved');
			await expect(receipt).toContainText(words.saved.replace('{name}', fileName));
			await expect(dialog.getByRole('alert')).toHaveCount(0);
			const savedReceipt = await receipt.innerText(), terminal = await destinationStats(page);
			expect(terminal).toEqual({ ...pending, closeCalls: 1, closeAcks: 1, held: false, released: true });
			const saved = await page.evaluate(async () => {
				const body = await globalThis.__singleExportDestination.file();
				if (body.size < 1 || body.size > 1024 * 1024) throw new RangeError('Native exported fixture exceeds its one MiB bound.');
				return { name: body.name, bytes: Array.from(new Uint8Array(await body.arrayBuffer())) };
			});
			expect(saved.name).toBe(fileName);
			await assertPixels(Buffer.from(saved.bytes), format);
			await expect(receipt).toContainText(words.summary.replace('{width}', '1').replace('{height}', '2')
				.replace('{bytes}', new Intl.NumberFormat(locale).format(saved.bytes.length)));
			await keyboard(page, named(dialog, 'button', batch.hide)); await expect(dialog).toHaveCount(0);
			await reopen();
			await expect(receipt).toHaveAttribute(`data-photo-${format}-export-status`, 'saved');
			await expect(receipt).toHaveText(savedReceipt, { useInnerText: true });
			expect(await destinationStats(page)).toEqual(terminal);
			await keyboard(page, named(dialog, 'button', words.close).last()); await expect(dialog).toHaveCount(0);
			expect(await observeNativeImageHandoffLibrary(page, [photoId])).toEqual(before);
			expect(downloads).toEqual([]); expect(errors).toEqual([]);
		} catch (error) { failures.push(error); }
		// Release the real native write before attempting UI retirement. Each
		// independent cleanup is joined even when a missing menu assertion fails.
		try { await page.evaluate(() => globalThis.__singleExportDestination.release()); } catch (error) { failures.push(error); }
		try {
			if (await dialog.count()) {
				const close = named(dialog, 'button', words.close).last(), cancel = named(dialog, 'button', batch.cancel);
				if (await cancel.count()) await keyboard(page, cancel); else if (await close.count()) await keyboard(page, close);
				await expect(dialog).toHaveCount(0);
			}
		} catch (error) { failures.push(error); }
		try { await page.evaluate(() => globalThis.__singleExportDestination.retire()); } catch (error) { failures.push(error); }
		if (failures.length === 1) throw failures[0];
		if (failures.length) throw new AggregateError(failures, 'Single export qualification and joined cleanup failed.', { cause: failures[0] });

		async function reopen() {
			await menu(page, app, copy.photoFileMenu);
			const queue = named(app, 'button', menus.queue); await expect(queue).toBeEnabled(); await keyboard(page, queue);
			await expect(dialog).toBeVisible();
		}
	});
}

async function importAndDevelop(page, app, copy, locale) {
	await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: FILE_NAME, mimeType: 'image/png', buffer: PNG });
	await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	await expect(app.locator('[data-photo-library]')).toHaveAttribute('aria-busy', 'false');
	await keyboard(page, app.getByRole('button', { name: /^Single queue original\.png/u }));
	await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu);
	await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale)));
	const messages = photoDevelopCopy(locale), develop = named(page, 'dialog', `${messages.title}: ${FILE_NAME}`);
	await expect(named(develop, 'region', messages.preview)).toHaveAttribute('data-state', 'ready');
	await choose(page, named(develop, 'combobox', messages.choose), 'cube-lut-profile-v1');
	await keyboard(page, named(develop, 'button', messages.add));
	await develop.getByLabel(messages.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Quarter red.cube', mimeType: 'text/plain', buffer: CUBE });
	await choose(page, named(develop, 'combobox', messages.choose), 'develop-geometry-v1');
	await keyboard(page, named(develop, 'button', messages.add));
	const width = named(develop, 'spinbutton', `${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectParamCropWidth}`);
	await width.fill('0.5'); await width.press('Enter');
	const after = named(develop, 'img', messages.after);
	await expect.poll(() => after.evaluate(canvas => [canvas.width, canvas.height])).toEqual([1, 2]);
	await expect.poll(() => after.evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 1, 2).data))).toEqual(PIXELS);
	await keyboard(page, named(develop, 'button', messages.save));
	await expect(named(develop, 'button', messages.cancel).last()).toBeDisabled();
	await keyboard(page, named(develop, 'button', messages.close).last()); await expect(develop).toHaveCount(0);
}

/** A synthetic picker returns a genuine native OPFS handle. It does not qualify
 * the browser's file-picker UI. Writers/decoders/encoders remain actual owners;
 * only delivery of a fulfilled native write is held, with no fabricated ACK. */
async function installDestination(page, fileName) {
	await page.evaluate(async fileName => {
		const root = await navigator.storage.getDirectory(), directoryName = `single-export-${crypto.randomUUID()}`;
		const directory = await root.getDirectoryHandle(directoryName, { create: true });
		const target = await directory.getFileHandle(fileName, { create: true });
		const pickerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'showSaveFilePicker');
		const targetDescriptor = Object.getOwnPropertyDescriptor(target, 'createWritable'), createWritable = target.createWritable;
		const restored = [], nativeFailures = [];
		let releaseHold, terminal, writer = null, active = true;
		const hold = new Promise(resolve => { releaseHold = resolve; });
		const drained = new Promise(resolve => { terminal = resolve; });
		const state = { pickers: 0, writableOpens: 0, writeAcks: 0, closeCalls: 0, closeAcks: 0, abortCalls: 0, abortAcks: 0,
			rasterReads: 0, held: false, released: false, activePickerGesture: false, requestedName: null };
		const replace = (object, key, value) => {
			const descriptor = Object.getOwnPropertyDescriptor(object, key);
			Object.defineProperty(object, key, { configurable: true, writable: true, value });
			restored.push(() => { if (descriptor) Object.defineProperty(object, key, descriptor); else Reflect.deleteProperty(object, key); });
		};
		for (const constructor of [globalThis.CanvasRenderingContext2D, globalThis.OffscreenCanvasRenderingContext2D]) {
			if (!constructor) continue;
			const prototype = constructor.prototype, getImageData = prototype.getImageData;
			replace(prototype, 'getImageData', function (...args) {
				const output = Reflect.apply(getImageData, this, args);
				if (active && this.canvas.width === 2 && this.canvas.height === 2 && args[0] === 0 && args[1] === 0 && args[2] === 2 && args[3] === 2) state.rasterReads++;
				return output;
			});
		}
		Object.defineProperty(target, 'createWritable', { configurable: true, value: async function (...args) {
			state.writableOpens++;
			writer = await Reflect.apply(createWritable, this, args);
			const write = writer.write, close = writer.close, abort = writer.abort;
			replace(writer, 'write', async function (...args) {
				const result = await Reflect.apply(write, this, args); state.writeAcks++;
				if (state.writeAcks !== 1) throw new Error('Single export unexpectedly wrote a second native chunk.');
				state.held = true; await hold; state.held = false; return result;
			});
			replace(writer, 'close', async function (...args) {
				state.closeCalls++;
				try { const result = await Reflect.apply(close, this, args); state.closeAcks++; return result; }
				catch (error) { nativeFailures.push(error); throw error; } finally { terminal(); }
			});
			replace(writer, 'abort', async function (...args) {
				state.abortCalls++;
				try { const result = await Reflect.apply(abort, this, args); state.abortAcks++; return result; }
				catch (error) { nativeFailures.push(error); throw error; } finally { terminal(); }
			});
			return writer;
		} });
		Object.defineProperty(globalThis, 'showSaveFilePicker', { configurable: true, value: request => {
			state.pickers++; state.requestedName = request.suggestedName; state.activePickerGesture = navigator.userActivation.isActive;
			return Promise.resolve(target);
		} });
		globalThis.__singleExportDestination = {
			stats: () => ({ ...state }), file: () => target.getFile(),
			release() { state.released = true; releaseHold(); },
			async retire() {
				state.released = true; releaseHold();
				if (writer) await drained;
				active = false;
				for (const restore of restored.reverse()) restore();
				if (targetDescriptor) Object.defineProperty(target, 'createWritable', targetDescriptor); else Reflect.deleteProperty(target, 'createWritable');
				if (pickerDescriptor) Object.defineProperty(globalThis, 'showSaveFilePicker', pickerDescriptor); else Reflect.deleteProperty(globalThis, 'showSaveFilePicker');
				await root.removeEntry(directoryName, { recursive: true });
				if (nativeFailures.length === 1) throw nativeFailures[0];
				if (nativeFailures.length) throw new AggregateError(nativeFailures, 'Native single-export cleanup failed.');
			},
		};
	}, fileName);
}

function destinationStats(page) { return page.evaluate(() => globalThis.__singleExportDestination.stats()); }

async function assertPixels(bytes, format) {
	expect(bytes.length).toBeGreaterThan(4); expect(bytes.length).toBeLessThanOrEqual(1024 * 1024);
	if (format === 'jpeg') {
		expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]); expect([...bytes.subarray(-2)]).toEqual([0xff, 0xd9]);
		const decoded = await decodePinnedJpegRgbFrame(bytes);
		expect([decoded.width, decoded.height, decoded.rgb.length]).toEqual([1, 2, 6]);
		for (const y of [0, 1]) {
			const rgb = readRgbPixel(decoded, { x: 0, y });
			for (let channel = 0; channel < 3; channel++) expect(Math.abs(rgb[channel] - PIXELS[y * 4 + channel])).toBeLessThanOrEqual(8);
		}
		return;
	}
	// Independent CRC + zlib oracle, never production PNG or Develop kernels.
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	const compressed = [], kinds = [];
	let offset = 8;
	while (offset < bytes.length) {
		expect(offset + 12).toBeLessThanOrEqual(bytes.length);
		const size = bytes.readUInt32BE(offset), end = offset + 12 + size;
		expect(end).toBeLessThanOrEqual(bytes.length);
		const kind = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, end - 4);
		expect(bytes.readUInt32BE(end - 4)).toBe(crc32(bytes.subarray(offset + 4, end - 4))); kinds.push(kind);
		if (kind === 'IHDR') expect([...data]).toEqual([0, 0, 0, 1, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
		else if (kind === 'sRGB') expect([...data]).toEqual([0]);
		else if (kind === 'IDAT') compressed.push(data);
		else { expect(kind).toBe('IEND'); expect(size).toBe(0); }
		offset = end;
	}
	expect(kinds.slice(0, 2)).toEqual(['IHDR', 'sRGB']); expect(kinds.at(-1)).toBe('IEND');
	expect(kinds.slice(2, -1).every(kind => kind === 'IDAT')).toBe(true);
	expect([...inflateSync(Buffer.concat(compressed))]).toEqual([0, ...PIXELS.slice(0, 4), 0, ...PIXELS.slice(4)]);
}
function crc32(bytes) {
	let value = 0xffffffff;
	for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
	return (value ^ 0xffffffff) >>> 0;
}
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function menu(page, app, label) { await keyboard(page, app.getByRole('navigation').getByText(label, { exact: true })); }
async function choose(page, combo, value) {
	await expect(combo).toBeVisible(); await expect(combo).toBeEnabled();
	const index = await combo.locator('option').evaluateAll((options, value) => options.findIndex(option => option.value === value), value);
	expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(64);
	await combo.focus(); await expect(combo).toBeFocused(); await page.keyboard.press('Home');
	for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown');
	await expect(combo).toHaveValue(value);
}
