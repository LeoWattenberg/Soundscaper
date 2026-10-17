/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { deflateSync, inflateSync } from 'node:zlib';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopBrushMaskCopy } from '../../src/common/i18n/lightscaper-develop-brush-mask-copy.ts';
import { photoDevelopLocalAdjustmentsCopy } from '../../src/common/i18n/lightscaper-develop-local-adjustments-copy.ts';
import { photoPngExportCopy } from '../../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import { photoPngExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-png-export-menu-copy.ts';
import { photoJpegExportCopy } from '../../src/common/i18n/lightscaper-photo-jpeg-export-copy.ts';
import { photoJpegExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-jpeg-export-menu-copy.ts';
import { lightscaperRestoreCopy } from '../../src/common/i18n/lightscaper-restore-copy.ts';
import { importPhotoCatalogArchiveV6 } from '../../src/lightscaper/archive/catalog-archive-import-v6.ts';
import { PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2 } from '../../src/lightscaper/storage/photo-library-location-v2.ts';
import { expect, test, installNativeImageHandoffRuntime, observeNativePhotoDevelopProxyCustody } from './helpers/lightscaper-image-handoff-native-fixture.js';

const NAME = 'Brush original.png', CROSS = [0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0];
const FIRST = [...CROSS.slice(0, 15), 255], ORIGINAL = Array.from({ length: 16 }, () => [255, 255, 255, 255]).flat();
// Literal full/zero brush endpoints: exposure -1 turns linear white into
// linear .5, which IEC sRGB encodes as188. No production mask/pixel oracle.
const pixels = alpha => alpha.flatMap(value => [value ? 188 : 255, value ? 188 : 255, value ? 188 : 255, 255]);

for (const locale of ['en', 'de']) test(`${locale}: menu brush edits persist through PNG, JPEG, archive restore and two reopens`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'The roadmap defers native WebKit storage qualification.');
	test.setTimeout(120_000); expect(test.info().config.workers).toBe(1); expect(test.info().retry).toBe(0); expect(test.info().project.retries).toBe(0);
	const copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale);
	const brush = photoDevelopBrushMaskCopy(locale), input = pngFixture(), failures = []; page.on('pageerror', error => { failures.push(error.message); });
	await installNativeImageHandoffRuntime(page);
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible();
	await expect(named(app, 'button', brush.menu)).toHaveCount(0);
	await menu(copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: input });
	await keyboard(page, named(importer, 'button', copy.photoImportAction)); await importer.waitFor({ state: 'detached', timeout: 0 });
	const library = app.locator('[data-photo-library]'); await expect(library).toHaveAttribute('aria-busy', 'false');
	const card = app.getByRole('button', { name: /^Brush original\.png/u }); await keyboard(page, card);
	const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy();
	const original = await observeNativePhotoDevelopProxyCustody(page, photoId); expect(original.namespace).toBeNull();
	expect(original.original.sha256).toBe(createHash('sha256').update(input).digest('hex'));
	await openDevelop(); const develop = named(page, 'dialog', `${words.title}: ${NAME}`), after = named(develop, 'img', words.after);
	await expect.poll(() => canvasPixels(named(develop, 'img', words.before))).toEqual(ORIGINAL);
	await named(develop, 'combobox', words.choose).selectOption('tone-ladder-v1'); await keyboard(page, named(develop, 'button', words.add));
	const exposure = named(develop, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectParamExposure}`);
	await exposure.fill('-1'); await exposure.press('Enter'); await expect.poll(() => canvasPixels(after)).toEqual(Array.from({ length: 16 }, () => [188, 188, 188, 255]).flat());
	await openBrush(); let dialog = named(page, 'dialog', brush.title); const grid = named(dialog, 'img', brush.grid);
	await expect(grid).toHaveAttribute('data-state', 'ready'); await expect(named(dialog, 'checkbox', brush.showOverlay)).not.toBeChecked();
	await number(brush.width, '4'); await number(brush.height, '4'); await keyboard(page, named(dialog, 'button', brush.create)); await expect(grid).toHaveAttribute('data-state', 'ready');
	await number(brush.radius, '0.25'); await number(brush.hardness, '1'); await number(brush.opacity, '1'); await number(brush.x, '0.375'); await number(brush.y, '0.375');
	await keyboard(page, named(dialog, 'button', brush.stamp)); await expect(grid).toHaveAttribute('data-state', 'ready');
	await keyboard(page, named(dialog, 'button', brush.undo)); await keyboard(page, named(dialog, 'button', brush.redo)); await expect(grid).toHaveAttribute('data-state', 'ready');
	await number(brush.radius, '0.125'); const box = await grid.boundingBox(); expect(box).not.toBeNull();
	await page.mouse.move(box.x + box.width * .875, box.y + box.height * .875); await page.mouse.down(); await page.mouse.up();
	await expect(grid).toHaveAttribute('data-state', 'ready');
	await check(named(dialog, 'checkbox', `${brush.bind}: ${words.shared.videoEffectToneLadder} (1)`)); await check(named(dialog, 'checkbox', brush.showOverlay));
	const overlayEffect = named(dialog, 'combobox', brush.overlayEffect); await expect(overlayEffect).toHaveValue('');
	const effectId = await overlayEffect.locator('option').evaluateAll(options => options.find(option => option.value)?.value); expect(effectId).toBeTruthy(); await overlayEffect.selectOption(effectId);
	await keyboard(page, named(dialog, 'button', brush.apply)); await expect(dialog).toHaveCount(0); await expect.poll(() => canvasPixels(after)).toEqual(pixels(FIRST));
	const overlay = named(develop, 'img', photoDevelopLocalAdjustmentsCopy(locale).maskOverlay);
	await expect(overlay).toBeVisible(); expect((await canvasPixels(overlay)).filter((_, index) => index % 4 === 3)).toEqual(FIRST);
	const firstBody = body(FIRST);
	expect(await overlay.boundingBox()).toEqual(await after.boundingBox()); await keyboard(page, named(develop, 'button', words.save)); await expect(named(develop, 'button', words.save)).toBeDisabled();
	await savedKey(firstBody.key);
	const first = await observeNativePhotoDevelopProxyCustody(page, photoId), firstRecipe = active(first.photo).develop, graph = firstRecipe.masks[0];
	expect(firstRecipe.maskBindings).toEqual([{ effectId, maskId: graph.id }]); expect(graph.nodes).toEqual([{ id: graph.outputNodeId, kind: 'alpha', inputName: 'paint' }]);
	expect(graph.inputs).toEqual([{ name: 'paint', kind: 'alpha', sourceRef: firstBody.key }]);
	expect(await nativeBody(page, firstBody.key)).toEqual([...firstBody.bytes]); expect(first.original).toEqual(original.original);
	await named(develop, 'textbox', words.snapshotName).fill('Brush first'); await keyboard(page, named(develop, 'button', words.saveSnapshot));
	await expect.poll(async () => active((await observeNativePhotoDevelopProxyCustody(page, photoId)).photo).workspace.snapshots.map(snapshot => snapshot.name)).toEqual(['Brush first']);
	await openBrush(); dialog = named(page, 'dialog', brush.title); await expect(named(dialog, 'img', brush.grid)).toHaveAttribute('data-state', 'ready');
	await named(dialog, 'combobox', brush.mask).selectOption(graph.id); await expect(named(dialog, 'spinbutton', brush.width)).toHaveValue('4');
	await expect(named(dialog, 'spinbutton', brush.width)).toBeDisabled(); await expect(named(dialog, 'img', brush.grid)).toHaveAttribute('data-state', 'ready');
	await named(dialog, 'combobox', brush.mode).selectOption('erase'); await number(brush.radius, '0.125'); await number(brush.hardness, '1'); await number(brush.opacity, '1');
	await number(brush.x, '0.875'); await number(brush.y, '0.875'); await keyboard(page, named(dialog, 'button', brush.stamp)); await keyboard(page, named(dialog, 'button', brush.apply));
	await expect(dialog).toHaveCount(0); await expect.poll(() => canvasPixels(after)).toEqual(pixels(CROSS));
	const finalBody = body(CROSS); await keyboard(page, named(develop, 'button', words.save)); await expect(named(develop, 'button', words.save)).toBeDisabled();
	await savedKey(finalBody.key);
	const saved = await observeNativePhotoDevelopProxyCustody(page, photoId), savedGraph = active(saved.photo).develop.masks[0];
	expect(savedGraph.id).toBe(graph.id); expect(savedGraph.outputNodeId).toBe(graph.outputNodeId); expect(savedGraph.kind).toBe(graph.kind);
	expect(savedGraph.inputs[0].sourceRef).toBe(finalBody.key); expect(await nativeBody(page, finalBody.key)).toEqual([...finalBody.bytes]);
	expect(await nativeBody(page, firstBody.key)).toEqual([...firstBody.bytes]); expect(saved.original).toEqual(original.original);
	expect(saved.photo.versions.some(version => version.workspace?.snapshots.some(snapshot => snapshot.name === 'Brush first'))).toBe(true);
	await keyboard(page, named(develop, 'button', words.close).last()); await page.reload(); await expect(app).toBeVisible();
	await menu(copy.photoViewMenu); await keyboard(page, named(app, 'button', copy.photoShowLibrary)); await keyboard(page, app.getByRole('button', { name: /^Brush original\.png/u }));
	await openDevelop(); await expect.poll(() => canvasPixels(after)).toEqual(pixels(CROSS));
	await settingsMenu(); await keyboard(page, named(develop, 'button', words.fullResolution));
	await expect.poll(() => canvasPixels(after)).toEqual(pixels(CROSS)); expect(await observeNativePhotoDevelopProxyCustody(page, photoId)).toEqual(saved);
	await keyboard(page, named(develop, 'button', words.close).last()); await installDestination(page);
	try {
		for (const format of ['png', 'jpeg']) {
			const label = format === 'png' ? photoPngExportMenuLabel(locale) : photoJpegExportMenuLabel(locale), exportWords = format === 'png' ? photoPngExportCopy(locale) : photoJpegExportCopy(locale);
			await menu(copy.photoFileMenu); await keyboard(page, named(app, 'button', label)); const exporter = named(page, 'dialog', exportWords.title);
			await keyboard(page, named(exporter, 'button', exportWords.save));
			await expect(exporter.locator(`[data-photo-${format}-export-receipt]`)).toHaveAttribute(`data-photo-${format}-export-status`, 'saved');
			const bytes = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await (await globalThis.__brushDestination.file()).arrayBuffer()))));
			if (format === 'png') expect(decodedPng(bytes)).toEqual(pixels(CROSS));
			else {
				expect([...bytes.subarray(0, 2)]).toEqual([255, 216]); const decoded = await page.evaluate(async () => {
					const bitmap = await createImageBitmap(await globalThis.__brushDestination.file()); try { const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d');
						context.drawImage(bitmap, 0, 0); return { width: bitmap.width, height: bitmap.height, pixels: Array.from(context.getImageData(0, 0, bitmap.width, bitmap.height).data) }; } finally { bitmap.close(); }
				}); expect([decoded.width, decoded.height]).toEqual([4, 4]);
				expect(Math.max(...decoded.pixels.map((value, index) => Math.abs(value - pixels(CROSS)[index])))).toBeLessThanOrEqual(30);
			}
			await keyboard(page, named(exporter, 'button', exportWords.close).last()); expect(await observeNativePhotoDevelopProxyCustody(page, photoId)).toEqual(saved);
		}
		expect(failures).toEqual([]);
	} finally { await page.evaluate(() => globalThis.__brushDestination.retire()); }
	const donor = await restoredState(page, photoId), firstArchive = await catalogBackup();
	const expectedArchive = await inspectArchive(firstArchive.buffer);
	expect(expectedArchive.photos).toEqual([saved.photo]); expect(expectedArchive.originals).toEqual([[...input]]);
	expect(expectedArchive.bodies).toEqual([firstBody, finalBody].sort((a, b) => a.key.localeCompare(b.key)).map(value => ({ key: value.key, bytes: [...value.bytes] })));
	const restoreWords = lightscaperRestoreCopy(locale); await menu(copy.photoFileMenu); await keyboard(page, named(app, 'button', restoreWords.title));
	const restoreDialog = named(page, 'dialog', restoreWords.title);
	await restoreDialog.locator('[data-photo-restore-file]').setInputFiles(firstArchive);
	await keyboard(page, named(restoreDialog, 'button', restoreWords.restore)); await expect(restoreDialog.locator('[data-photo-restore-receipt]')).toBeVisible();
	await keyboard(page, named(restoreDialog, 'button', restoreWords.close).last()); await expect(restoreDialog).toHaveCount(0);
	const restored = await restoredState(page, photoId);
	expect(restored.pointer.schemaVersion).toBe(2); expect(restored.names.mediaDatabaseName).not.toBe(donor.names.mediaDatabaseName);
	expect(restored.photo).toEqual(donor.photo); expect(restored.originalSha256).toBe(donor.originalSha256); expect(restored.originalSize).toBe(input.length);
	expect(restored.metadata.storage).toBe('indexeddb-media-chunks-v1'); expect(restored.bodies).toEqual(donor.bodies);
	for (let reopen = 0; reopen < 2; reopen++) {
		await page.reload(); await expect(app).toBeVisible(); await menu(copy.photoViewMenu); await keyboard(page, named(app, 'button', copy.photoShowLibrary));
		await keyboard(page, app.getByRole('button', { name: /^Brush original\.png/u })); await openDevelop();
		await expect.poll(() => canvasPixels(after)).toEqual(pixels(CROSS)); await settingsMenu(); await keyboard(page, named(develop, 'button', words.fullResolution));
		await expect.poll(() => canvasPixels(after)).toEqual(pixels(CROSS)); await openBrush();
		const reopenedBrush = named(page, 'dialog', brush.title); await expect(named(reopenedBrush, 'img', brush.grid)).toHaveAttribute('data-state', 'ready');
		await named(reopenedBrush, 'combobox', brush.mask).selectOption(graph.id); await expect(named(reopenedBrush, 'spinbutton', brush.width)).toHaveValue('4');
		await keyboard(page, named(reopenedBrush, 'button', brush.close).last()); await keyboard(page, named(develop, 'button', words.close).last());
		expect(await restoredState(page, photoId)).toEqual(restored); expect(await inspectArchive((await catalogBackup()).buffer)).toEqual(expectedArchive);
	}
	expect(await nativeBody(page, firstBody.key)).toEqual([...firstBody.bytes]); expect(await nativeBody(page, finalBody.key)).toEqual([...finalBody.bytes]);
	expect(failures).toEqual([]);

	async function catalogBackup() {
		await page.evaluate(() => { Object.defineProperty(globalThis, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		await menu(copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoBackupTitle));
		const backup = named(page, 'dialog', copy.photoBackupTitle), pending = page.waitForEvent('download');
		await keyboard(page, backup.locator('[data-photo-backup-save]')); const download = await pending, path = await download.path();
		expect(path).toBeTruthy(); const buffer = await readFile(path); await expect(backup.locator('[data-photo-backup-receipt]')).toBeVisible();
		await keyboard(page, backup.locator('[data-photo-backup-close]')); await expect(backup).toHaveCount(0);
		return { name: download.suggestedFilename(), mimeType: 'application/octet-stream', buffer };
	}

	async function openDevelop() { await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale))); }
	async function settingsMenu() { const summary = develop.getByText(settings.menu, { exact: true }); if (!await summary.locator('..').evaluate(details => details.open)) await keyboard(page, summary); }
	async function openBrush() { await settingsMenu(); await keyboard(page, named(develop, 'button', brush.menu)); }
	async function menu(label) { await keyboard(page, app.getByRole('navigation').getByText(label, { exact: true })); }
	async function number(label, value) { await named(dialog, 'spinbutton', label).fill(value); }
	async function check(control) { await control.focus(); await page.keyboard.press('Space'); await expect(control).toBeChecked(); }
	async function savedKey(key) { await expect.poll(async () => active((await observeNativePhotoDevelopProxyCustody(page, photoId)).photo).develop.masks.flatMap(mask => mask.inputs.map(input => input.sourceRef))).toEqual([key]); }
});

let observer;
async function restoredState(page, photoId) {
	observer ??= build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-brush-restore-native-observer.ts', import.meta.url))],
		bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' });
	const result = await observer; expect(result.outputFiles).toHaveLength(1);
	await page.route('**/__brush_restore_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text }));
	return page.evaluate(async photoId => (await import(new URL('/__brush_restore_observer.js', location.href).href))
		.observeBrushRestoreNative(photoId, () => globalThis.__assertNativeOpfsWorkerExecution()), photoId);
}
async function inspectArchive(buffer) {
	const photos = [], originals = [], bodies = [];
	await importPhotoCatalogArchiveV6(new Blob([buffer]), async (_root, _saved, _presets, _luts, declarations) => ({
		async writePhoto(photo, source) { const bytes = []; for await (const chunk of source) bytes.push(...chunk); photos.push(photo); originals.push(bytes); },
		async writeStack() {}, async writeSavedCollection() {}, async writeDevelopPresets() {}, async writeLut() {},
		async writeMaskRaster(reference, bytes) { expect(createHash('sha256').update(bytes).digest('hex')).toBe(reference.sha256); bodies.push({ key: reference.storageKey, bytes: [...bytes] }); },
		async publish() { expect(bodies.map(value => value.key)).toEqual(declarations.map(value => value.id)); },
		async rollback() { throw new Error('Valid native brush archive rolled back.'); },
	}));
	return { photos, originals, bodies };
}

function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
function canvasPixels(canvas) { return canvas.evaluate(canvas => canvas.width && canvas.height ? Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) : []); }
function active(photo) { const version = photo.versions.find(version => version.id === photo.activeVersionId); expect(version).toBeTruthy(); return version; }
function body(alpha) { const bytes = Buffer.from([83, 67, 77, 65, 83, 75, 48, 49, 4, 0, 0, 0, 4, 0, 0, 0, ...alpha]);
	return { bytes, key: `brush-mask-v1:4:4:${createHash('sha256').update(bytes).digest('hex')}` }; }
async function nativeBody(page, key) {
	return page.evaluate(async ({ name, key }) => {
		const opening = indexedDB.open(name, 2), database = await new Promise((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
			opening.onupgradeneeded = () => { opening.transaction.abort(); reject(new Error('Read-only body observer cannot create storage.')); }; });
		try { const transaction = database.transaction('analysis', 'readonly'), terminal = new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); });
			const reading = transaction.objectStore('analysis').get(key), row = await new Promise((resolve, reject) => { reading.onsuccess = () => resolve(reading.result); reading.onerror = () => reject(reading.error); });
			await terminal; if (row?.key !== key || row.value?.kind !== 'photo-mask-raster-body' || row.value.bytes.byteLength !== 32) throw new Error('Actual immutable brush row missing.'); return Array.from(row.value.bytes);
		} finally { database.close(); }
	}, { name: PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2, key });
}
function pngFixture() { const header = Buffer.alloc(13); header.writeUInt32BE(4); header.writeUInt32BE(4, 4); header[8] = 8; header[9] = 6;
	const rows = Array.from({ length: 4 }, (_, row) => [0, ...ORIGINAL.slice(row * 16, (row + 1) * 16)]).flat();
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('sRGB', Buffer.from([0])), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]); }
function chunk(kind, data) { const bytes = Buffer.concat([Buffer.from(kind), data]), prefix = Buffer.alloc(4), suffix = Buffer.alloc(4); prefix.writeUInt32BE(data.length); suffix.writeUInt32BE(crc32(bytes)); return Buffer.concat([prefix, bytes, suffix]); }
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
function decodedPng(bytes) {
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]); const compressed = []; let ended = false;
	for (let offset = 8; offset < bytes.length;) { const length = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8), end = offset + length + 12;
		expect(end).toBeLessThanOrEqual(bytes.length); expect(bytes.readUInt32BE(end - 4)).toBe(crc32(bytes.subarray(offset + 4, end - 4)));
		if (kind === 'IHDR') expect([...bytes.subarray(offset + 8, end - 4)]).toEqual([0, 0, 0, 4, 0, 0, 0, 4, 8, 6, 0, 0, 0]);
		if (kind === 'IDAT') compressed.push(bytes.subarray(offset + 8, end - 4)); if (kind === 'IEND') { expect(end).toBe(bytes.length); ended = true; } offset = end;
	}
	expect(ended).toBe(true); const raw = inflateSync(Buffer.concat(compressed)); expect(raw.length).toBe(68);
	return Array.from({ length: 4 }, (_, row) => { expect(raw[row * 17]).toBe(0); return [...raw.subarray(row * 17 + 1, (row + 1) * 17)]; }).flat();
}
async function installDestination(page) { await page.evaluate(async () => {
	const root = await navigator.storage.getDirectory(), name = `brush-export-${crypto.randomUUID()}`, directory = await root.getDirectoryHandle(name, { create: true });
	const handle = await directory.getFileHandle('Brush output', { create: true }), previous = globalThis.showSaveFilePicker; globalThis.showSaveFilePicker = async () => handle;
	globalThis.__brushDestination = { file: () => handle.getFile(), async retire() { globalThis.showSaveFilePicker = previous; await root.removeEntry(name, { recursive: true }); } };
}); }
