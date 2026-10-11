/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopBrushMaskCopy } from '../../src/common/i18n/lightscaper-develop-brush-mask-copy.ts';
import { photoDevelopMaskManagementCopy } from '../../src/common/i18n/lightscaper-develop-mask-management-copy.ts';
import { photoDevelopLocalAdjustmentsCopy } from '../../src/common/i18n/lightscaper-develop-local-adjustments-copy.ts';
import { photoPngExportCopy } from '../../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import { photoPngExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-png-export-menu-copy.ts';
import { PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2, PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2 } from '../../src/lightscaper/storage/photo-library-location-v2.ts';
import { PHOTO_CATALOG_DATABASE_VERSION } from '../../src/lightscaper/catalog/repository-types.ts';
import { expect, test, installNativeImageHandoffRuntime, observeNativePhotoDevelopProxyCustody } from './helpers/lightscaper-image-handoff-native-fixture.js';

const NAME = 'Composed mask original.png';
const A = [0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0];
const B = [0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0];
// Literal results of A Add B, then Subtract B, then Intersect B. These
// expected planes do not call the command, evaluator or production renderer.
const UNION = [0, 255, 255, 0, 255, 255, 255, 255, 0, 255, 255, 0, 0, 0, 0, 0];
const DIFFERENCE = [0, 255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0];
const INTERSECTION = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const ORIGINAL = Array.from({ length: 16 }, () => [255, 255, 255, 255]).flat();
const pixels = coverage => coverage.flatMap(alpha => [alpha ? 188 : 255, alpha ? 188 : 255, alpha ? 188 : 255, 255]);
const BODIES = [A, B].map(alpha => { const bytes = Buffer.from([83, 67, 77, 65, 83, 75, 48, 49, 4, 0, 0, 0, 4, 0, 0, 0, ...alpha]);
	const sha256 = createHash('sha256').update(bytes).digest('hex'); return { bytes, reference: { storageKey: `brush-mask-v1:4:4:${sha256}`, sha256, width: 4, height: 4, byteLength: 32 } }; });

for (const locale of ['en', 'de']) test(`${locale}: keyboard mask Add, Subtract and Intersect preserve named native bodies through Save, history, reopen and PNG`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'Native WebKit storage qualification remains deferred.');
	expect(test.info().config.workers).toBe(1); expect(test.info().retry).toBe(0); expect(test.info().project.retries).toBe(0);
	const copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale);
	const brush = photoDevelopBrushMaskCopy(locale), management = photoDevelopMaskManagementCopy(locale), input = pngFixture();
	const labels = locale === 'de' ? ['Primäre Maske', 'Operandenmaske'] : ['Primary mask', 'Operand mask'];
	const errors = []; page.on('pageerror', error => { errors.push(error.message); });
	await installNativeImageHandoffRuntime(page);
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible();
	await expect(named(page, 'dialog', management.title)).toHaveCount(0); await expect(app.locator('[data-photo-develop-mask-operand]')).toHaveCount(0);
	await menu(copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: input });
	await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const card = app.getByRole('button', { name: /^Composed mask original\.png/u }); await keyboard(page, card);
	const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy();
	const original = await observeNativePhotoDevelopProxyCustody(page, photoId), catalogId = original.photo.catalogId;
	expect(original.namespace).toBeNull(); expect(original.original.sha256).toBe(createHash('sha256').update(input).digest('hex'));
	await openDevelop(); const develop = named(page, 'dialog', `${words.title}: ${NAME}`), after = named(develop, 'img', words.after);
	const preview = develop.locator('[data-photo-develop-preview]');
	await expect.poll(() => canvasPixels(named(develop, 'img', words.before))).toEqual(ORIGINAL);
	await expect(develop.locator('[data-photo-develop-mask-operand]')).toHaveCount(0);
	await named(develop, 'combobox', words.choose).selectOption('tone-ladder-v1'); await keyboard(page, named(develop, 'button', words.add));
	const exposure = named(develop, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectParamExposure}`);
	await exposure.fill('-1'); await exposure.press('Enter'); await painted(Array(16).fill(255));
	await authorBrush('.375', A, true); await painted(A); await save();
	await authorBrush('.625', B, true); await painted(B); const beforeNames = await save();
	const initial = active(beforeNames).develop, selected = initial.masks.find(mask => mask.inputs[0].sourceRef === BODIES[0].reference.storageKey);
	const donor = initial.masks.find(mask => mask.inputs[0].sourceRef === BODIES[1].reference.storageKey); expect(selected).toBeTruthy(); expect(donor).toBeTruthy();
	const effect = initial.effects[0]; expect(initial.maskBindings).toEqual([{ effectId: effect.id, maskId: donor.id }]);
	let manager = await openManager();
	for (const [id, label] of [[selected.id, labels[0]], [donor.id, labels[1]]]) {
		await choose(page, named(manager, 'combobox', management.mask), id); await named(manager, 'textbox', management.name).fill(label);
		await keyboard(page, named(manager, 'button', management.rename));
	}
	await choose(page, named(manager, 'combobox', management.mask), selected.id);
	await toggle(page, named(manager, 'checkbox', `${management.bind}: ${words.shared.videoEffectToneLadder} (1)`));
	await keyboard(page, named(manager, 'button', management.apply)); await expect(manager).toHaveCount(0); await painted(A);
	const seed = await save(), seedRecipe = active(seed).develop, namedDonor = seedRecipe.masks.find(mask => mask.id === donor.id);
	expect(seedRecipe.maskBindings).toEqual([{ effectId: effect.id, maskId: selected.id }]);
	expect(namedDonor).toEqual({ ...donor, schemaVersion: 2, name: labels[1] }); await immutable(seed);
	const saved = [];
	for (const [operation, caption, coverage] of [['union', management.add, UNION], ['subtract', management.subtract, DIFFERENCE], ['intersect', management.intersect, INTERSECTION]]) {
		manager = await openManager(); await choose(page, named(manager, 'combobox', management.mask), selected.id);
		const operand = named(manager, 'combobox', management.operand); await expect(operand).toHaveValue('');
		expect(await operand.locator('option').evaluateAll(options => options.map(option => option.value))).not.toContain(selected.id);
		await choose(page, operand, donor.id); await expect(named(manager, 'checkbox', management.showOverlay)).not.toBeChecked();
		const before = await readPhoto(page, catalogId, photoId); await keyboard(page, named(manager, 'button', caption));
		await expect(named(manager, 'combobox', management.mask)).toHaveValue(selected.id);
		await expect(named(manager, 'textbox', management.name)).toHaveValue(labels[0]);
		expect(await readPhoto(page, catalogId, photoId)).toEqual(before);
		await toggle(page, named(manager, 'checkbox', management.showOverlay)); await choose(page, named(manager, 'combobox', management.overlayEffect), effect.id);
		await keyboard(page, named(manager, 'button', management.apply)); await expect(manager).toHaveCount(0); await painted(coverage);
		const overlay = named(develop, 'img', photoDevelopLocalAdjustmentsCopy(locale).maskOverlay);
		await expect.poll(async () => (await canvasPixels(overlay)).filter((_, index) => index % 4 === 3)).toEqual(coverage);
		expect(await overlay.boundingBox()).toEqual(await after.boundingBox());
		const photo = await save(), recipe = active(photo).develop, composed = recipe.masks.find(mask => mask.id === selected.id);
		expect(composed.schemaVersion).toBe(2); expect(composed.name).toBe(labels[0]); expect(composed.kind).toBe(selected.kind);
		expect(composed.nodes.find(node => node.id === composed.outputNodeId)).toMatchObject({ kind: 'boolean', operation });
		expect(recipe.masks.find(mask => mask.id === donor.id)).toEqual(namedDonor);
		expect(recipe.maskBindings).toEqual(seedRecipe.maskBindings); expect(recipe.effects).toEqual(seedRecipe.effects);
		expect([...new Set(composed.inputs.map(input => input.sourceRef))].sort()).toEqual(BODIES.map(body => body.reference.storageKey).sort());
		await immutable(photo); saved.push(photo);
	}
	await keyboard(page, named(develop, 'button', words.close).last()); await page.reload(); await expect(app).toBeVisible();
	await menu(copy.photoViewMenu); await keyboard(page, named(app, 'button', copy.photoShowLibrary)); await keyboard(page, app.getByRole('button', { name: /^Composed mask original\.png/u }));
	await openDevelop(); await painted(INTERSECTION); expect(await readPhoto(page, catalogId, photoId)).toEqual(saved[2]);
	await settingsMenu(); await keyboard(page, named(develop, 'button', words.fullResolution)); await painted(INTERSECTION); await immutable(saved[2]);
	const history = named(develop, 'combobox', words.history); await history.focus(); await expect(history).toBeFocused(); await history.press('ArrowUp');
	await expect.poll(async () => active(await readPhoto(page, catalogId, photoId)).workspace.cursor).toBe(active(saved[1]).workspace.cursor);
	await painted(DIFFERENCE); const restored = await readPhoto(page, catalogId, photoId);
	expect(active(restored).develop).toEqual(active(saved[1]).develop); expect(active(restored).workspace.entries).toEqual(active(saved[2]).workspace.entries); await immutable(restored);
	manager = await openManager(); await choose(page, named(manager, 'combobox', management.mask), selected.id);
	await expect(named(manager, 'textbox', management.name)).toHaveValue(labels[0]); await expect(named(manager, 'combobox', management.operand)).toHaveValue('');
	await expect(named(manager, 'checkbox', management.showOverlay)).not.toBeChecked();
	await keyboard(page, named(manager, 'button', management.close).last()); await expect(manager).toHaveCount(0);
	await keyboard(page, named(develop, 'button', words.close).last()); await installDestination(page);
	try {
		await menu(copy.photoFileMenu); await keyboard(page, named(app, 'button', photoPngExportMenuLabel(locale)));
		const exportWords = photoPngExportCopy(locale), exporter = named(page, 'dialog', exportWords.title);
		await keyboard(page, named(exporter, 'button', exportWords.save)); await expect(exporter.locator('[data-photo-png-export-receipt]')).toHaveAttribute('data-photo-png-export-status', 'saved');
		const bytes = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await (await globalThis.__composedMaskDestination.file()).arrayBuffer()))));
		expect(decodedPng(bytes)).toEqual(pixels(DIFFERENCE)); await keyboard(page, named(exporter, 'button', exportWords.close).last());
		expect(await readPhoto(page, catalogId, photoId)).toEqual(restored); await immutable(restored); expect(errors).toEqual([]);
	} finally { await page.evaluate(() => globalThis.__composedMaskDestination.retire()); }

	async function openDevelop() { await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale))); }
	async function menu(label) { await keyboard(page, app.getByRole('navigation').getByText(label, { exact: true })); }
	async function settingsMenu() { const summary = develop.getByText(settings.menu, { exact: true }); if (!await summary.locator('..').evaluate(details => details.open)) await keyboard(page, summary); }
	async function openManager() { await settingsMenu(); await keyboard(page, named(develop, 'button', management.menu)); const dialog = named(page, 'dialog', management.title); await expect(dialog).toBeVisible(); return dialog; }
	async function painted(coverage) { await expect(preview).toHaveAttribute('data-state', 'ready'); await expect.poll(() => canvasPixels(after)).toEqual(pixels(coverage)); }
	async function save() { const before = (await readPhoto(page, catalogId, photoId)).revision;
		await keyboard(page, named(develop, 'button', words.save)); await expect.poll(async () => (await readPhoto(page, catalogId, photoId)).revision).toBeGreaterThan(before);
		await expect(named(develop, 'button', words.save)).toBeDisabled(); await expect(preview).toHaveAttribute('data-state', 'ready'); return readPhoto(page, catalogId, photoId); }
	async function immutable(photo) { const observed = await observeNativePhotoDevelopProxyCustody(page, photoId); expect(observed.photo).toEqual(photo); expect(observed.namespace).toBeNull();
		expect(observed.original).toEqual(original.original); expect(photo.original).toEqual(original.photo.original);
		expect(await nativeBodies(page)).toEqual(BODIES.map(body => ({ reference: body.reference, bytes: [...body.bytes] })).sort((a, b) => a.reference.storageKey.localeCompare(b.reference.storageKey))); }
	async function authorBrush(x, coverage, bind) {
		await settingsMenu(); await keyboard(page, named(develop, 'button', brush.menu)); const author = named(page, 'dialog', brush.title), grid = named(author, 'img', brush.grid);
		await expect(grid).toHaveAttribute('data-state', 'ready');
		for (const [caption, value] of [[brush.width, '4'], [brush.height, '4']]) await named(author, 'spinbutton', caption).fill(value);
		await keyboard(page, named(author, 'button', brush.create)); await expect(grid).toHaveAttribute('data-state', 'ready');
		for (const [caption, value] of [[brush.radius, '.25'], [brush.hardness, '1'], [brush.opacity, '1'], [brush.x, x], [brush.y, '.375']]) await named(author, 'spinbutton', caption).fill(value);
		await keyboard(page, named(author, 'button', brush.stamp)); await expect(grid).toHaveAttribute('data-state', 'ready');
		expect((await canvasPixels(grid)).filter((_, index) => index % 4 === 3)).toEqual(coverage);
		if (bind) await toggle(page, named(author, 'checkbox', `${brush.bind}: ${words.shared.videoEffectToneLadder} (1)`));
		await keyboard(page, named(author, 'button', brush.apply)); await expect(author).toHaveCount(0);
	}
});

function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function choose(page, control, value) { await expect(control).toBeEnabled();
	const index = await control.locator('option').evaluateAll((options, value) => options.findIndex(option => option.value === value), value); expect(index).toBeGreaterThanOrEqual(0);
	await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Home');
	for (let offset = 0; offset < index; offset++) await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await expect(control).toHaveValue(value); }
async function toggle(page, control) { await expect(control).not.toBeChecked(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Space'); await expect(control).toBeChecked(); }
function canvasPixels(canvas) { return canvas.evaluate(canvas => canvas.width && canvas.height ? Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) : []); }
function active(photo) { const version = photo.versions.find(version => version.id === photo.activeVersionId); expect(version).toBeTruthy(); return version; }
/** Save synchronization reads only the native Photo row. It cannot acquire
 * an original worker handle while a current presentation is still retiring. */
async function readPhoto(page, catalogId, photoId) { return page.evaluate(async ({ name, version, catalogId, photoId }) => {
	const opening = indexedDB.open(name, version), database = await new Promise((resolve, reject) => {
		opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
		opening.onupgradeneeded = () => { opening.transaction.abort(); reject(new Error('The readonly observer cannot create or upgrade storage.')); };
	});
	try {
		const transaction = database.transaction('photos', 'readonly'), terminal = new Promise((resolve, reject) => {
			transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
		});
		const key = `${catalogId}|${photoId}`, request = transaction.objectStore('photos').get(key);
		const reading = new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
		const [read, ended] = await Promise.allSettled([reading, terminal]), failures = [read, ended].filter(result => result.status === 'rejected').map(result => result.reason);
		if (failures.length) throw new AggregateError(failures, 'Native Photo read or transaction failed.', { cause: failures[0] });
		const row = read.value;
		if (row?.key !== key || row.document?.id !== photoId || row.document.catalogId !== catalogId || !Number.isSafeInteger(row.document.revision)) throw new Error('Actual saved Photo row missing.');
		return row.document;
	} finally { database.close(); }
}, { name: PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2, version: PHOTO_CATALOG_DATABASE_VERSION, catalogId, photoId }); }
async function nativeBodies(page) { return page.evaluate(async name => {
	const opening = indexedDB.open(name, 2), database = await new Promise((resolve, reject) => {
		opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
		opening.onupgradeneeded = () => { opening.transaction.abort(); reject(new Error('The readonly observer cannot create storage.')); };
	});
	try {
		const transaction = database.transaction('analysis', 'readonly'), terminal = new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); });
		const request = transaction.objectStore('analysis').getAll(IDBKeyRange.bound('brush-mask-', 'brush-mask-\uffff'), 3);
		const reading = new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
		const [read, ended] = await Promise.allSettled([reading, terminal]), failures = [read, ended].filter(result => result.status === 'rejected').map(result => result.reason);
		if (failures.length) throw new AggregateError(failures, 'Native mask body read or transaction failed.', { cause: failures[0] });
		if (read.value.length !== 2) throw new Error('Expected exactly two immutable native mask bodies.');
		return read.value.map(row => { if (row.key !== row.value?.reference?.storageKey || row.value.schemaVersion !== 1 || row.value.kind !== 'photo-mask-raster-body' || row.value.bytes.byteLength !== 32) throw new Error('Actual immutable brush row missing.');
			return { reference: row.value.reference, bytes: Array.from(row.value.bytes) }; }).sort((a, b) => a.reference.storageKey.localeCompare(b.reference.storageKey));
	} finally { database.close(); }
}, PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2); }
function pngFixture() { const header = Buffer.alloc(13); header.writeUInt32BE(4); header.writeUInt32BE(4, 4); header[8] = 8; header[9] = 6;
	const rows = Array.from({ length: 4 }, (_, row) => [0, ...ORIGINAL.slice(row * 16, (row + 1) * 16)]).flat();
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('sRGB', Buffer.from([0])), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]); }
function chunk(kind, data) { const bytes = Buffer.concat([Buffer.from(kind), data]), prefix = Buffer.alloc(4), suffix = Buffer.alloc(4);
	prefix.writeUInt32BE(data.length); suffix.writeUInt32BE(crc32(bytes)); return Buffer.concat([prefix, bytes, suffix]); }
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
function decodedPng(bytes) {
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]); const compressed = []; let ended = false;
	for (let offset = 8; offset < bytes.length;) {
		const length = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8), end = offset + length + 12;
		expect(end).toBeLessThanOrEqual(bytes.length); expect(bytes.readUInt32BE(end - 4)).toBe(crc32(bytes.subarray(offset + 4, end - 4)));
		if (kind === 'IHDR') expect([...bytes.subarray(offset + 8, end - 4)]).toEqual([0, 0, 0, 4, 0, 0, 0, 4, 8, 6, 0, 0, 0]);
		if (kind === 'IDAT') compressed.push(bytes.subarray(offset + 8, end - 4)); if (kind === 'IEND') { expect(end).toBe(bytes.length); ended = true; } offset = end;
	}
	expect(ended).toBe(true); const raw = inflateSync(Buffer.concat(compressed)); expect(raw.length).toBe(68);
	return Array.from({ length: 4 }, (_, row) => { expect(raw[row * 17]).toBe(0); return [...raw.subarray(row * 17 + 1, (row + 1) * 17)]; }).flat();
}
async function installDestination(page) { await page.evaluate(async () => {
	const root = await navigator.storage.getDirectory(), name = `composed-mask-export-${crypto.randomUUID()}`, directory = await root.getDirectoryHandle(name, { create: true });
	const handle = await directory.getFileHandle('Composed mask.png', { create: true }), previous = globalThis.showSaveFilePicker;
	globalThis.showSaveFilePicker = async () => handle;
	globalThis.__composedMaskDestination = { file: () => handle.getFile(), async retire() { globalThis.showSaveFilePicker = previous; await root.removeEntry(name, { recursive: true }); } };
}); }
