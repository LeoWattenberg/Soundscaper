/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopRepairSpotsCopy } from '../../src/common/i18n/lightscaper-develop-repair-spots-copy.ts';
import { PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2 } from '../../src/lightscaper/storage/photo-library-location-v2.ts';
import { PHOTO_CATALOG_DATABASE_VERSION } from '../../src/lightscaper/catalog/repository-types.ts';
import { expect, test, installNativeImageHandoffRuntime, compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { repairOriginalReferencePixelsV1, repairOutputReferencePixelsV1, repairEdgeReferencePixelsV1 } from './helpers/lightscaper-repair-spots-reference.ts';

const NAME = 'Repair Original.png', ORIGINAL = repairOriginalReferencePixelsV1();
const CLONE = repairOutputReferencePixelsV1('clone'), HEAL = repairOutputReferencePixelsV1('heal');
const PROGRAM_PATH = '/__repair_photo_custody.js';

for (const locale of ['en', 'de']) test(`${locale}: menu Clone and genuine Heal survive native Save, history, copy and reopen with unchanged Original`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'Native WebKit storage qualification remains deferred.');
	test.setTimeout(120000); checkRunShape();
	const f = await openFixture(page, locale, NAME, ORIGINAL, 10, 5), { app, develop, after, words, repairs, settings } = f;
	await expect(named(page, 'dialog', repairs.title)).toHaveCount(0);
	await expect.poll(() => canvasPixels(named(develop, 'img', words.before))).toEqual(ORIGINAL);
	await f.settingsMenu(); await expect(named(develop, 'button', settings.copy)).toBeEnabled();
	await keyboard(page, named(develop, 'button', settings.copy));
	const picker = named(page, 'dialog', settings.copy); await expect(picker).toBeVisible();
	await expect(named(picker, 'group', settings.picker)).toBeVisible();
	await keyboard(page, named(picker, 'button', settings.close).last()); await expect(picker).toHaveCount(0);
	let dialog = await f.openRepairs();
	await expect(named(dialog, 'checkbox', repairs.visualize)).not.toBeChecked();
	await expect.poll(() => canvasPixels(named(dialog, 'img', repairs.original))).toEqual(ORIGINAL);
	await authorSpot(page, dialog, repairs, 'clone', { targetX: .7, targetY: .5, sourceX: .2, sourceY: .5, radius: .15, feather: 0, opacity: 1 });
	await keyboard(page, named(dialog, 'button', repairs.apply)); await expect(dialog).toHaveCount(0);
	await f.painted(CLONE); expect(await f.readPhoto()).toEqual(f.initial.photo);
	await f.settingsMenu(); await expect(named(develop, 'button', settings.copy)).toHaveCount(0);
	const cloned = await f.save(); expect(active(cloned).develop.processVersion).toBe(3);
	const spot = active(cloned).develop.repairs.spots[0];
	expect(spot).toMatchObject({ mode: 'clone', enabled: true, target: { x: .7, y: .5 }, source: { x: .2, y: .5 }, radius: .15, feather: 0, opacity: 1 });
	expect(active(cloned).workspace.cursor).toBe(1); await f.immutable(cloned);
	dialog = await f.openRepairs(); await expect(named(dialog, 'combobox', repairs.spot)).toHaveValue(spot.id);
	await named(dialog, 'combobox', repairs.mode).selectOption('heal');
	await keyboard(page, named(dialog, 'button', repairs.apply)); await expect(dialog).toHaveCount(0);
	await f.painted(HEAL); expect(await f.readPhoto()).toEqual(cloned);
	const healed = await f.save(); expect(active(healed).develop.repairs.spots).toEqual([{ ...spot, mode: 'heal' }]);
	expect(active(healed).workspace.cursor).toBe(2); expect(HEAL.slice(104, 112)).toEqual([137, 137, 137, 255, 225, 225, 225, 255]);
	expect(HEAL.slice(104, 112)).not.toEqual([188, 188, 188, 255, 188, 188, 188, 255]); await f.immutable(healed);
	dialog = await f.openRepairs(); const originalCanvas = named(dialog, 'img', repairs.original);
	await expect(named(dialog, 'checkbox', repairs.visualize)).not.toBeChecked();
	await checkbox(page, named(dialog, 'checkbox', repairs.visualize));
	await expect.poll(() => canvasPixels(originalCanvas)).toEqual(repairEdgeReferencePixelsV1());
	await named(dialog, 'spinbutton', repairs.threshold).fill('1');
	await expect.poll(() => canvasPixels(originalCanvas)).toEqual(Array.from({ length: 50 }, () => [0, 0, 0, 255]).flat());
	expect(await f.readPhoto()).toEqual(healed);
	await keyboard(page, named(dialog, 'button', repairs.close).last()); await expect(dialog).toHaveCount(0); await f.painted(HEAL);
	expect(await f.readPhoto()).toEqual(healed);
	dialog = await f.openRepairs(); await expect(named(dialog, 'checkbox', repairs.visualize)).not.toBeChecked();
	await expect.poll(() => canvasPixels(named(dialog, 'img', repairs.original))).toEqual(ORIGINAL);
	await keyboard(page, named(dialog, 'button', repairs.close).last()); await expect(dialog).toHaveCount(0);
	await f.settingsMenu(); await keyboard(page, named(develop, 'button', words.fullResolution)); await f.painted(HEAL);
	await named(develop, 'combobox', words.history).selectOption('0'); await f.painted(ORIGINAL);
	await expect.poll(async () => active(await f.readPhoto()).workspace.cursor).toBe(0);
	const legacyActive = await f.readPhoto(); expect(legacyActive.schemaVersion).toBe(3); expect(active(legacyActive).develop.processVersion).toBe(1);
	await f.settingsMenu(); await expect(named(develop, 'button', settings.copy)).toHaveCount(0);
	await expect(named(develop, 'button', repairs.menu)).toBeEnabled(); await f.immutable(legacyActive);
	await named(develop, 'combobox', words.history).selectOption('1'); await f.painted(CLONE);
	await named(develop, 'combobox', words.history).selectOption('2'); await f.painted(HEAL);
	await named(develop, 'textbox', words.copyName).fill(`${locale} repaired copy`);
	await keyboard(page, named(develop, 'button', words.createCopy));
	await expect.poll(async () => (await f.readPhoto()).versions.length).toBe(2);
	const copied = await f.readPhoto(); expect(active(copied).kind).toBe('virtual-copy');
	expect(active(copied).develop).toEqual(active(healed).develop); await f.painted(HEAL); await f.immutable(copied);
	await keyboard(page, named(develop, 'button', words.close).last()); await expect(develop).toHaveCount(0);
	await page.reload(); await expect(app).toBeVisible(); await f.showLibrary(); await keyboard(page, app.getByRole('button', { name: /^Repair Original\.png/u }));
	await f.openDevelop(); await f.painted(HEAL); expect(await f.readPhoto()).toEqual(copied);
	dialog = await f.openRepairs(); await expect(named(dialog, 'combobox', repairs.mode)).toHaveValue('heal');
	await expect(named(dialog, 'spinbutton', repairs.sourceX)).toHaveValue('0.2');
	await keyboard(page, named(dialog, 'button', repairs.close).last()); await expect(dialog).toHaveCount(0);
	await f.painted(HEAL); await f.immutable(copied); expect(f.errors).toEqual([]);
	await expect(after).toBeVisible();
});

for (const locale of ['en', 'de']) test(`${locale}: Original source pointer movement changes Heal guidance and pointer cancellation preserves the saved recipe`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'Native WebKit storage qualification remains deferred.');
	test.setTimeout(90000); checkRunShape();
	const source = movedSourcePixels(), f = await openFixture(page, locale, 'Moved donor.png', source, 11, 3), { repairs } = f;
	let dialog = await f.openRepairs();
	await authorSpot(page, dialog, repairs, 'heal', { targetX: 9.5 / 11, targetY: .5, sourceX: 1.5 / 11, sourceY: .5, radius: .2, feather: 0, opacity: 1 });
	await keyboard(page, named(dialog, 'button', repairs.apply)); await expect(dialog).toHaveCount(0);
	const expected = grayAt(source, 20, 138); await f.painted(expected); const saved = await f.save();
	dialog = await f.openRepairs(); const canvas = named(dialog, 'img', repairs.original);
	await named(dialog, 'combobox', repairs.tool).selectOption('source');
	await dragSource(page, canvas, 11, 3, 1.5 / 11, 5.5 / 11, true);
	await expect.poll(async () => Number(await named(dialog, 'spinbutton', repairs.sourceX).inputValue())).toBeCloseTo(1.5 / 11, 6);
	expect(await f.readPhoto()).toEqual(saved);
	await keyboard(page, named(dialog, 'button', repairs.close).last()); await expect(dialog).toHaveCount(0); await f.painted(expected);
	dialog = await f.openRepairs(); await named(dialog, 'combobox', repairs.tool).selectOption('source');
	await dragSource(page, named(dialog, 'img', repairs.original), 11, 3, 1.5 / 11, 5.5 / 11, false);
	await expect.poll(async () => Number(await named(dialog, 'spinbutton', repairs.sourceX).inputValue())).toBeCloseTo(.5, 6);
	await keyboard(page, named(dialog, 'button', repairs.apply)); await expect(dialog).toHaveCount(0);
	await f.painted(grayAt(source, 20, 217)); expect(await f.readPhoto()).toEqual(saved);
	const moved = await f.save(); expect(active(moved).develop.repairs.spots[0].source.x).toBeCloseTo(.5, 6);
	await f.immutable(moved); expect(f.errors).toEqual([]);
});

async function openFixture(page, locale, name, pixels, width, height) {
	const copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale), repairs = photoDevelopRepairSpotsCopy(locale);
	const errors = []; page.on('pageerror', error => { errors.push(error.message); });
	await installNativeImageHandoffRuntime(page);
	const program = await compileNativeImageHandoffScript('repair-photo-custody.js', fileURLToPath(new URL('./helpers/lightscaper-repair-spots-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]); await page.route(`**${PROGRAM_PATH}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible();
	await expect(named(page, 'dialog', repairs.title)).toHaveCount(0); await expect(named(app, 'button', repairs.menu)).toHaveCount(0);
	const input = pngFixture(pixels, width, height);
	await menu(copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name, mimeType: 'image/png', buffer: input });
	await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const card = app.getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u') });
	await keyboard(page, card); const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy();
	const initial = await observe(); expect(initial.namespace).toBeNull(); expect(initial.original.sha256).toBe(createHash('sha256').update(input).digest('hex'));
	await openDevelop(); const develop = named(page, 'dialog', `${words.title}: ${name}`), after = named(develop, 'img', words.after);
	await painted(pixels);
	return { app, develop, after, words, settings, repairs, initial, errors, openDevelop, settingsMenu, openRepairs, painted, save, immutable,
		readPhoto, showLibrary: async () => { await menu(copy.photoViewMenu); await keyboard(page, named(app, 'button', copy.photoShowLibrary)); } };
	async function menu(label) { await keyboard(page, app.getByRole('navigation').getByText(label, { exact: true })); }
	async function openDevelop() { await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale))); }
	async function settingsMenu() { const summary = develop.getByText(settings.menu, { exact: true }); if (!await summary.locator('..').evaluate(details => details.open)) await keyboard(page, summary); }
	async function openRepairs() { await settingsMenu(); await keyboard(page, named(develop, 'button', repairs.menu));
		const dialog = named(page, 'dialog', repairs.title); await expect(dialog).toBeVisible();
		await expect(dialog.locator('[data-photo-repair-original]')).toHaveAttribute('data-state', 'ready'); return dialog; }
	async function painted(expected) { await expect(develop.locator('[data-photo-develop-preview]')).toHaveAttribute('data-state', 'ready'); await expect.poll(() => canvasPixels(after)).toEqual(expected); }
	async function readPhoto() { return readNativePhoto(page, initial.photo.catalogId, photoId); }
	async function save() { const before = (await readPhoto()).revision;
		await keyboard(page, named(develop, 'button', words.save)); await expect.poll(async () => (await readPhoto()).revision).toBeGreaterThan(before);
		await expect(named(develop, 'button', words.save)).toBeDisabled(); await expect(develop.locator('[data-photo-develop-preview]')).toHaveAttribute('data-state', 'ready'); return readPhoto(); }
	async function immutable(photo) { const observed = await observe(); expect(observed.photo).toEqual(photo); expect(observed.namespace).toBe(initial.namespace);
		expect(observed.original).toEqual(initial.original); expect(photo.original).toEqual(initial.photo.original); }
	async function observe() { return page.evaluate(async ({ pathname, photoId }) => (await import(new URL(pathname, location.href).href))
		.readRepairPhotoCustodyNativeV1(photoId, () => globalThis.__assertNativeOpfsWorkerExecution()), { pathname: PROGRAM_PATH, photoId }); }
}
async function authorSpot(page, dialog, words, mode, values) {
	await named(dialog, 'combobox', words.mode).selectOption(mode);
	for (const [key, value] of Object.entries(values)) await named(dialog, 'spinbutton', words[key]).fill(String(value));
	await keyboard(page, named(dialog, 'button', words.add));
}
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function checkbox(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Space'); }
function canvasPixels(canvas) { return canvas.evaluate(canvas => canvas.width && canvas.height ? Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) : []); }
function active(photo) { const version = photo.versions.find(version => version.id === photo.activeVersionId); expect(version).toBeTruthy(); return version; }
function checkRunShape() { expect(test.info().config.workers).toBe(1); expect(test.info().retry).toBe(0); expect(test.info().project.retries).toBe(0); }
async function dragSource(page, canvas, width, height, fromX, toX, cancelled) {
	const box = await canvas.boundingBox(); expect(box).toBeTruthy(); const scale = Math.min(box.width / width, box.height / height);
	const left = box.x + (box.width - width * scale) / 2, top = box.y + (box.height - height * scale) / 2, offset = 2;
	await canvas.evaluate(canvas => canvas.addEventListener('pointerdown', event => {
		canvas.dataset.nativeRepairPointerId = String(event.pointerId); canvas.dataset.nativeRepairPointerType = event.pointerType;
	}, { once: true }));
	await page.mouse.move(left + fromX * width * scale + offset, top + height * scale / 2); await page.mouse.down();
	await expect(canvas).toHaveAttribute('data-native-repair-pointer-type', 'mouse');
	await expect(canvas).toHaveAttribute('data-native-repair-pointer-id', /^\d+$/u);
	const pointerId = Number(await canvas.getAttribute('data-native-repair-pointer-id')); expect(Number.isSafeInteger(pointerId)).toBe(true);
	test.info().annotations.push({ type: 'native-repair-pointer-id', description: String(pointerId) });
	await page.mouse.move(left + toX * width * scale + offset, top + height * scale / 2);
	if (cancelled) await canvas.dispatchEvent('pointercancel', { pointerId }); await page.mouse.up();
}
function movedSourcePixels() {
	const values = Array(33).fill(0); for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
		values[y * 11 + x] = 32; values[y * 11 + x + 4] = 64; values[y * 11 + x + 8] = 128;
	} values[12] = 64; values[16] = 192; values[20] = 0; return values.flatMap(value => [value, value, value, 255]);
}
function grayAt(input, index, value) { const output = input.slice(); output.fill(value, index * 4, index * 4 + 3); return output; }
function pngFixture(pixels, width, height) {
	const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
	const rows = Array.from({ length: height }, (_, row) => [0, ...pixels.slice(row * width * 4, (row + 1) * width * 4)]).flat();
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('sRGB', Buffer.from([0])), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
}
function chunk(kind, data) { const bytes = Buffer.concat([Buffer.from(kind), data]), prefix = Buffer.alloc(4), suffix = Buffer.alloc(4);
	prefix.writeUInt32BE(data.length); suffix.writeUInt32BE(crc32(bytes)); return Buffer.concat([prefix, bytes, suffix]); }
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
/** Save synchronization observes only the native Photo row and never opens an Original body. */
async function readNativePhoto(page, catalogId, photoId) { return page.evaluate(async ({ name, version, catalogId, photoId }) => {
	const opening = indexedDB.open(name, version), database = await new Promise((resolve, reject) => {
		opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
		opening.onupgradeneeded = () => { opening.transaction.abort(); reject(new Error('The read-only observer cannot create storage.')); };
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
