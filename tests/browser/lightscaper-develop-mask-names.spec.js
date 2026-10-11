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
import { PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2 } from '../../src/lightscaper/storage/photo-library-location-v2.ts';
import { expect, test, installNativeImageHandoffRuntime, observeNativePhotoDevelopProxyCustody } from './helpers/lightscaper-image-handoff-native-fixture.js';

const NAME = 'Named mask original.png';
const CROSS = [0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0];
const ORIGINAL = Array.from({ length: 16 }, () => [255, 255, 255, 255]).flat();
// One exposure -1 operation on sRGB white is 188. Exact coverage endpoints
// preserve white outside the independently stamped cross.
const PIXELS = CROSS.flatMap(alpha => [alpha ? 188 : 255, alpha ? 188 : 255, alpha ? 188 : 255, 255]);
const BODY = Buffer.from([83, 67, 77, 65, 83, 75, 48, 49, 4, 0, 0, 0, 4, 0, 0, 0, ...CROSS]);
const SHA = createHash('sha256').update(BODY).digest('hex'), KEY = `brush-mask-v1:4:4:${SHA}`;

for (const locale of ['en', 'de']) test(`${locale}: keyboard mask rename, clear and history preserve native brush pixels, body and original through reopen and PNG`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'Native WebKit storage qualification remains deferred.');
	expect(test.info().config.workers).toBe(1); expect(test.info().retry).toBe(0); expect(test.info().project.retries).toBe(0);
	const copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale);
	const brush = photoDevelopBrushMaskCopy(locale), management = photoDevelopMaskManagementCopy(locale), input = pngFixture();
	const displayName = locale === 'de' ? 'Vordergrund é' : 'Foreground é', rawName = `  ${displayName.replace('é', 'e\u0301')}  `;
	const errors = []; page.on('pageerror', error => { errors.push(error.message); });
	await installNativeImageHandoffRuntime(page);
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible();
	await expect(named(page, 'dialog', management.title)).toHaveCount(0); await expect(app.locator('[data-photo-develop-mask-name]')).toHaveCount(0);
	await menu(copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: input });
	await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const card = app.getByRole('button', { name: /^Named mask original\.png/u }); await keyboard(page, card);
	const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy();
	const original = await observeNativePhotoDevelopProxyCustody(page, photoId);
	expect(original.namespace).toBeNull(); expect(original.original.sha256).toBe(createHash('sha256').update(input).digest('hex'));
	await openDevelop(); const develop = named(page, 'dialog', `${words.title}: ${NAME}`), after = named(develop, 'img', words.after);
	await expect.poll(() => canvasPixels(named(develop, 'img', words.before))).toEqual(ORIGINAL);
	await expect(develop.locator('[data-photo-develop-mask-name]')).toHaveCount(0);
	await named(develop, 'combobox', words.choose).selectOption('tone-ladder-v1'); await keyboard(page, named(develop, 'button', words.add));
	const exposure = named(develop, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectParamExposure}`);
	await exposure.fill('-1'); await exposure.press('Enter');
	await expect.poll(() => canvasPixels(after)).toEqual(Array.from({ length: 16 }, () => [188, 188, 188, 255]).flat());
	await settingsMenu(); await keyboard(page, named(develop, 'button', brush.menu));
	let author = named(page, 'dialog', brush.title), grid = named(author, 'img', brush.grid);
	await expect(grid).toHaveAttribute('data-state', 'ready');
	for (const [caption, value] of [[brush.width, '4'], [brush.height, '4']]) await named(author, 'spinbutton', caption).fill(value);
	await keyboard(page, named(author, 'button', brush.create)); await expect(grid).toHaveAttribute('data-state', 'ready');
	for (const [caption, value] of [[brush.radius, '.25'], [brush.hardness, '1'], [brush.opacity, '1'], [brush.x, '.375'], [brush.y, '.375']]) await named(author, 'spinbutton', caption).fill(value);
	await keyboard(page, named(author, 'button', brush.stamp)); await expect(grid).toHaveAttribute('data-state', 'ready');
	expect((await canvasPixels(grid)).filter((_, index) => index % 4 === 3)).toEqual(CROSS);
	await toggle(page, named(author, 'checkbox', `${brush.bind}: ${words.shared.videoEffectToneLadder} (1)`));
	await keyboard(page, named(author, 'button', brush.apply)); await expect(author).toHaveCount(0); await expect.poll(() => canvasPixels(after)).toEqual(PIXELS);
	const seed = await save(), seedVersion = active(seed.photo), graph = seedVersion.develop.masks[0], effect = seedVersion.develop.effects[0];
	expect(seedVersion.develop.processVersion).toBe(1); expect(graph.schemaVersion).toBe(1); expect(graph).not.toHaveProperty('name');
	expect(graph.inputs).toEqual([{ name: 'paint', kind: 'alpha', sourceRef: KEY }]);
	expect(seedVersion.develop.maskBindings).toEqual([{ effectId: effect.id, maskId: graph.id }]); await immutable(seed);

	let manager = await openManager(); const mask = named(manager, 'combobox', management.mask), name = named(manager, 'textbox', management.name);
	await expect(mask).toHaveValue(graph.id); await expect(name).toHaveValue('');
	await name.fill(rawName); expect(await observeNativePhotoDevelopProxyCustody(page, photoId)).toEqual(seed);
	await keyboard(page, named(manager, 'button', management.rename));
	await expect(name).toHaveValue(displayName); await expect(mask.locator('option:checked')).toHaveText(`${displayName} (${graph.id})`);
	expect(await observeNativePhotoDevelopProxyCustody(page, photoId)).toEqual(seed);
	await toggle(page, named(manager, 'checkbox', management.showOverlay));
	await choose(page, named(manager, 'combobox', management.overlayEffect), effect.id);
	await keyboard(page, named(manager, 'button', management.apply)); await expect(manager).toHaveCount(0);
	await expect.poll(() => canvasPixels(after)).toEqual(PIXELS);
	const overlay = named(develop, 'img', photoDevelopLocalAdjustmentsCopy(locale).maskOverlay);
	await expect.poll(async () => (await canvasPixels(overlay)).filter((_, index) => index % 4 === 3)).toEqual(CROSS);
	expect(await overlay.boundingBox()).toEqual(await after.boundingBox());
	const namedSaved = await save(), namedRecipe = active(namedSaved.photo).develop;
	expect(namedRecipe.masks).toEqual([{ ...graph, schemaVersion: 2, name: displayName }]);
	expect(namedRecipe.effects).toEqual(seedVersion.develop.effects); expect(namedRecipe.maskBindings).toEqual(seedVersion.develop.maskBindings); await immutable(namedSaved);
	await named(develop, 'textbox', words.snapshotName).fill('Named brush'); await keyboard(page, named(develop, 'button', words.saveSnapshot));
	await expect.poll(async () => active((await observeNativePhotoDevelopProxyCustody(page, photoId)).photo).workspace.snapshots.map(snapshot => snapshot.name)).toEqual(['Named brush']);
	const withSnapshot = await observeNativePhotoDevelopProxyCustody(page, photoId);
	expect(active(withSnapshot.photo).workspace.snapshots[0].develop).toEqual(namedRecipe); await immutable(withSnapshot);
	await keyboard(page, named(develop, 'button', words.close).last()); await page.reload(); await expect(app).toBeVisible();
	await menu(copy.photoViewMenu); await keyboard(page, named(app, 'button', copy.photoShowLibrary)); await keyboard(page, app.getByRole('button', { name: /^Named mask original\.png/u }));
	await openDevelop(); await expect.poll(() => canvasPixels(after)).toEqual(PIXELS); await expect(overlay).toHaveCount(0);
	expect(await observeNativePhotoDevelopProxyCustody(page, photoId)).toEqual(withSnapshot);
	await settingsMenu(); await keyboard(page, named(develop, 'button', words.fullResolution)); await expect.poll(() => canvasPixels(after)).toEqual(PIXELS);
	await settingsMenu(); await keyboard(page, named(develop, 'button', brush.menu)); author = named(page, 'dialog', brush.title); grid = named(author, 'img', brush.grid);
	await choose(page, named(author, 'combobox', brush.mask), graph.id); await expect(grid).toHaveAttribute('data-state', 'ready');
	expect((await canvasPixels(grid)).filter((_, index) => index % 4 === 3)).toEqual(CROSS);
	await keyboard(page, named(author, 'button', brush.apply)); await expect(author).toHaveCount(0); await expect.poll(() => canvasPixels(after)).toEqual(PIXELS);
	await expect(named(develop, 'button', words.save)).toBeDisabled(); expect(await observeNativePhotoDevelopProxyCustody(page, photoId)).toEqual(withSnapshot);

	manager = await openManager(); await expect(named(manager, 'textbox', management.name)).toHaveValue(displayName);
	await named(manager, 'textbox', management.name).fill(' \t '); await keyboard(page, named(manager, 'button', management.rename));
	await expect(named(manager, 'textbox', management.name)).toHaveValue('');
	await expect(named(manager, 'combobox', management.mask).locator('option:checked')).toHaveText(graph.id);
	await keyboard(page, named(manager, 'button', management.apply)); await expect(manager).toHaveCount(0); await expect.poll(() => canvasPixels(after)).toEqual(PIXELS);
	const cleared = await save(), clearedVersion = active(cleared.photo);
	expect(clearedVersion.develop).toEqual({ ...seedVersion.develop, processVersion: 2 }); expect(clearedVersion.develop.processVersion).toBe(2);
	expect(clearedVersion.workspace.snapshots).toEqual(active(withSnapshot.photo).workspace.snapshots); await immutable(cleared);
	const history = named(develop, 'combobox', words.history); await history.focus(); await expect(history).toBeFocused(); await history.press('ArrowUp');
	await expect.poll(async () => active((await observeNativePhotoDevelopProxyCustody(page, photoId)).photo).workspace.cursor).toBe(clearedVersion.workspace.cursor - 1);
	await expect.poll(() => canvasPixels(after)).toEqual(PIXELS); const restored = await observeNativePhotoDevelopProxyCustody(page, photoId);
	expect(active(restored.photo).develop).toEqual(namedRecipe); expect(active(restored.photo).workspace.entries).toEqual(clearedVersion.workspace.entries); await immutable(restored);
	manager = await openManager(); await expect(named(manager, 'textbox', management.name)).toHaveValue(displayName);
	await named(manager, 'textbox', management.name).fill('Not applied'); await keyboard(page, named(manager, 'button', management.rename));
	await keyboard(page, named(manager, 'button', management.close).last()); await expect(manager).toHaveCount(0);
	await expect(named(develop, 'button', words.save)).toBeDisabled(); expect(await observeNativePhotoDevelopProxyCustody(page, photoId)).toEqual(restored);
	await keyboard(page, named(develop, 'button', words.close).last()); await installDestination(page);
	try {
		await menu(copy.photoFileMenu); await keyboard(page, named(app, 'button', photoPngExportMenuLabel(locale)));
		const exportWords = photoPngExportCopy(locale), exporter = named(page, 'dialog', exportWords.title);
		await keyboard(page, named(exporter, 'button', exportWords.save)); await expect(exporter.locator('[data-photo-png-export-receipt]')).toHaveAttribute('data-photo-png-export-status', 'saved');
		const bytes = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await (await globalThis.__namedMaskDestination.file()).arrayBuffer()))));
		expect(decodedPng(bytes)).toEqual(PIXELS); await keyboard(page, named(exporter, 'button', exportWords.close).last());
		expect(await observeNativePhotoDevelopProxyCustody(page, photoId)).toEqual(restored); await immutable(restored); expect(errors).toEqual([]);
	} finally { await page.evaluate(() => globalThis.__namedMaskDestination.retire()); }

	async function openDevelop() { await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale))); }
	async function menu(label) { await keyboard(page, app.getByRole('navigation').getByText(label, { exact: true })); }
	async function settingsMenu() { const summary = develop.getByText(settings.menu, { exact: true }); if (!await summary.locator('..').evaluate(details => details.open)) await keyboard(page, summary); }
	async function openManager() { await settingsMenu(); await keyboard(page, named(develop, 'button', management.menu)); const dialog = named(page, 'dialog', management.title);
		await expect(dialog).toBeVisible(); return dialog; }
	async function save() { const before = (await observeNativePhotoDevelopProxyCustody(page, photoId)).photo.revision;
		await keyboard(page, named(develop, 'button', words.save)); await expect.poll(async () => (await observeNativePhotoDevelopProxyCustody(page, photoId)).photo.revision).toBeGreaterThan(before);
		await expect(named(develop, 'button', words.save)).toBeDisabled(); return observeNativePhotoDevelopProxyCustody(page, photoId); }
	async function immutable(observed) { expect(observed.original).toEqual(original.original); expect(observed.photo.original).toEqual(original.photo.original);
		expect(await nativeBody(page)).toEqual({ count: 1, reference: { storageKey: KEY, sha256: SHA, width: 4, height: 4, byteLength: 32 }, bytes: [...BODY] }); }
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
async function nativeBody(page) { return page.evaluate(async ({ name, key }) => {
	const opening = indexedDB.open(name, 2), database = await new Promise((resolve, reject) => {
		opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
		opening.onupgradeneeded = () => { opening.transaction.abort(); reject(new Error('The readonly observer cannot create storage.')); };
	});
	try {
		const transaction = database.transaction('analysis', 'readonly'), terminal = new Promise((resolve, reject) => {
			transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
		});
		const store = transaction.objectStore('analysis'), requests = [store.get(key), store.count(IDBKeyRange.bound('brush-mask-', 'brush-mask-\uffff'))];
		const reading = Promise.all(requests.map(request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); })));
		const [read, ended] = await Promise.allSettled([reading, terminal]), failures = [read, ended].filter(result => result.status === 'rejected').map(result => result.reason);
		if (failures.length) throw new AggregateError(failures, 'Native mask body read or transaction failed.', { cause: failures[0] });
		const [row, count] = read.value;
		if (row?.key !== key || row.value?.schemaVersion !== 1 || row.value.kind !== 'photo-mask-raster-body' || row.value.bytes.byteLength !== 32) throw new Error('Actual immutable brush row missing.');
		return { count, reference: row.value.reference, bytes: Array.from(row.value.bytes) };
	} finally { database.close(); }
}, { name: PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2, key: KEY }); }
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
	const root = await navigator.storage.getDirectory(), name = `named-mask-export-${crypto.randomUUID()}`, directory = await root.getDirectoryHandle(name, { create: true });
	const handle = await directory.getFileHandle('Named mask.png', { create: true }), previous = globalThis.showSaveFilePicker;
	globalThis.showSaveFilePicker = async () => handle;
	globalThis.__namedMaskDestination = { file: () => handle.getFile(), async retire() { globalThis.showSaveFilePicker = previous; await root.removeEntry(name, { recursive: true }); } };
}); }
