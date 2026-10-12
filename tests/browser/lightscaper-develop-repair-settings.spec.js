/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopRepairSpotsCopy } from '../../src/common/i18n/lightscaper-develop-repair-spots-copy.ts';
import { photoDevelopBrushMaskCopy } from '../../src/common/i18n/lightscaper-develop-brush-mask-copy.ts';
import { photoPngExportCopy } from '../../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import { photoPngExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-png-export-menu-copy.ts';
import { pngChunk } from '../helpers/image-metadata-fixtures.ts';
import { repairOriginalReferencePixelsV1 } from './helpers/lightscaper-repair-spots-reference.ts';
import { expect, test, installNativeImageHandoffRuntime, compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';

const NAMES = ['Settings source.png', 'Settings target.png'], PROGRAM = '/__repair_settings_custody.js';
// Independent two-cell repair, crop/flip, and linear-light exposure goldens.
const CLONE = [90, 90, 90, 255, 90, 90, 90, 255], HEAL = [255, 255, 255, 255, 188, 188, 188, 255];
const BRUSH = [255, 255, 255, 255, 137, 137, 137, 255], QUICK = [125, 125, 125, 255, 125, 125, 125, 255];

for (const locale of ['en', 'de']) for (const brush of [false, true]) test(`${locale}: Current Copy preserves an unsaved ${brush ? 'brush and Heal' : 'Heal'} draft across Close and pastes into another Original`, async ({ page, browserName }) => {
	shape(browserName); test.setTimeout(150000);
	const f = await fixture(page, locale); await f.openDevelop(); await f.repair('clone'); await f.geometry(); await f.painted(CLONE); await f.save();
	await f.painted(CLONE); const saved = await f.observe(); await f.repair('heal'); if (brush) await f.brush(); await f.painted(brush ? BRUSH : HEAL);
	await expect(named(f.develop(), 'button', f.words.save)).toBeEnabled();
	let dialog = await f.settingsDialog('copy'); await expect(named(dialog, 'checkbox', f.settings.repairs)).toBeChecked();
	await keyboard(page, named(dialog, 'button', f.settings.confirmCopy)); await expect(dialog).toHaveCount(0);
	await expect(f.develop().getByText(f.settings.copied, { exact: true })).toBeVisible(); await f.closeDevelop();
	await f.select(1); await f.openDevelop(); await f.settingsMenu(); await keyboard(page, named(f.develop(), 'button', f.settings.paste));
	await expect(f.develop().getByRole('status').filter({ hasText: f.settings.finished })).toBeVisible(); await f.painted(brush ? BRUSH : HEAL);
	await expect(named(f.develop(), 'button', f.words.save)).toBeDisabled(); await f.closeDevelop();
	const pasted = await f.observe(), target = active(pasted.photos[1].photo);
	expect(pasted.photos[0].photo).toEqual(saved.photos[0].photo); expect(pasted.photos[1].photo.schemaVersion).toBe(3);
	expect(target.develop.processVersion).toBe(3); expect(target.develop.repairs.spots[0].mode).toBe('heal'); await f.immutable(pasted);
	if (brush) {
		expect(target.develop.masks).toHaveLength(1); expect(target.develop.maskBindings).toHaveLength(1); expect(pasted.bodies).toHaveLength(1);
		const body = pasted.bodies[0]; expect([body.reference.width, body.reference.height]).toEqual([2, 1]);
		expect(body.bytes.slice(0, 8)).toEqual([83, 67, 77, 65, 83, 75, 48, 49]); expect(body.bytes.slice(-2)).toEqual([255, 0]);
		expect(createHash('sha256').update(Buffer.from(body.bytes)).digest('hex')).toBe(body.reference.sha256);
		expect(target.develop.masks[0].inputs[0].sourceRef).toBe(body.reference.storageKey);
	} else { expect(target.develop.masks).toEqual([]); expect(pasted.bodies).toEqual([]); }
	await f.png(brush ? BRUSH : HEAL); expect(await f.observe()).toEqual(pasted);
	await page.reload(); await expect(f.app).toBeVisible(); await f.showLibrary(); await f.select(1); await f.openDevelop();
	await f.painted(brush ? BRUSH : HEAL); await f.closeDevelop(); expect(await f.observe()).toEqual(pasted); expect(f.errors).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: Current Sync and acknowledged Auto-sync preserve repairs through partial selection and relative Quick Develop`, async ({ page, browserName }) => {
	shape(browserName); test.setTimeout(150000);
	const f = await fixture(page, locale); await f.selectAll(); await f.openDevelop(); await f.repair('heal'); await f.geometry(); await f.save(); await f.painted(HEAL);
	let dialog = await f.settingsDialog('sync'); await keyboard(page, named(dialog, 'button', f.settings.confirmSync));
	await expect.poll(async () => active((await f.photos()).photos[1].photo).develop.processVersion).toBe(3);
	await keyboard(page, named(dialog, 'button', f.settings.close).last());
	await expect(f.develop().getByText(f.settings.finished, { exact: true })).toBeVisible();
	await f.painted(HEAL); let copied = await f.observe(); expect(active(copied.photos[1].photo).develop.repairs).toEqual(active(copied.photos[0].photo).develop.repairs);
	dialog = await f.settingsDialog('auto');
	for (const label of [f.settings.all, f.settings.geometry, f.settings.local]) await uncheck(page, named(dialog, 'checkbox', label));
	await expect(named(dialog, 'checkbox', f.settings.repairs)).toBeChecked(); await keyboard(page, named(dialog, 'button', f.settings.confirmAuto)); await expect(dialog).toHaveCount(0);
	await expect(f.develop().getByText(new RegExp(f.settings.autoActive.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))).toBeVisible();
	await f.repair('clone'); await f.painted(CLONE); expect(await f.observe()).toEqual(copied);
	await f.save(); await expect.poll(async () => active((await f.photos()).photos[1].photo).develop.repairs.spots[0].mode).toBe('clone');
	await f.painted(CLONE); copied = await f.observe(); const repairs = copied.photos.map(row => active(row.photo).develop.repairs);
	dialog = await f.settingsDialog('quick'); await named(dialog, 'spinbutton', f.settings.delta).fill('1');
	await keyboard(page, named(dialog, 'button', f.settings.applyQuick));
	await expect.poll(async () => (await f.photos()).photos.map(row => active(row.photo).develop.effects.find(effect => effect.type === 'tone-ladder-v1').params.exposure)).toEqual([2, 2]);
	await keyboard(page, named(dialog, 'button', f.settings.close).last()); await f.painted(QUICK); await f.closeDevelop();
	const quick = await f.observe(); expect(quick.photos.map(row => active(row.photo).develop.repairs)).toEqual(repairs); await f.immutable(quick);
	for (const row of quick.photos) expect(active(row.photo).develop.effects.find(effect => effect.type === 'tone-ladder-v1').params.exposure).toBe(2);
	await f.select(1); await f.png(QUICK); expect(await f.observe()).toEqual(quick);
	await page.reload(); await expect(f.app).toBeVisible(); await f.showLibrary(); await f.select(1); await f.openDevelop(); await f.painted(QUICK);
	await f.settingsMenu(); await expect(named(f.develop(), 'button', f.settings.stopAuto)).toHaveCount(0); await f.closeDevelop();
	expect(await f.observe()).toEqual(quick); expect(f.errors).toEqual([]);
});

async function fixture(page, locale) {
	await installNativeImageHandoffRuntime(page); await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
	const program = await compileNativeImageHandoffScript('repair-settings-custody.js', fileURLToPath(new URL('./helpers/lightscaper-repair-settings-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]); await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	const copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale, 'current3'), repairs = photoDevelopRepairSpotsCopy(locale), brushCopy = photoDevelopBrushMaskCopy(locale);
	const errors = []; page.on('pageerror', error => { errors.push(error.message); });
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos)); const importer = named(page, 'dialog', copy.photoImportPhotos);
	const pngs = [originalPng(0), originalPng(1)]; await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles(NAMES.map((name, index) => ({ name, mimeType: 'image/png', buffer: pngs[index] })));
	await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const cards = NAMES.map(name => app.getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u') }));
	const ids = []; for (const card of cards) { const id = await card.getAttribute('data-photo-id'); expect(id).toBeTruthy(); ids.push(id); }
	let selected = 0; await keyboard(page, cards[0]); const initial = await observe();
	for (const [index, row] of initial.photos.entries()) expect(row.original.sha256).toBe(createHash('sha256').update(pngs[index]).digest('hex'));
	return { app, words, settings, repairs, initial, errors, observe, photos, develop, openDevelop, closeDevelop, settingsMenu, settingsDialog, repair, geometry, brush, painted, save, immutable, png,
		select: async index => { selected = index; await keyboard(page, cards[index]); },
		showLibrary: async () => { await menu(copy.photoViewMenu); await keyboard(page, named(app, 'button', copy.photoShowLibrary)); },
		selectAll: async () => { await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(page, named(app, 'button', copy.photoSelectAll)); } };
	function develop() { return named(page, 'dialog', `${words.title}: ${NAMES[selected]}`); }
	async function menu(label) { await keyboard(page, app.getByRole('navigation').getByText(label, { exact: true })); }
	async function openDevelop() { await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale))); await expect(develop()).toBeVisible(); await paintedReady(); }
	async function closeDevelop() { await keyboard(page, named(develop(), 'button', words.close).last()); await expect(develop()).toHaveCount(0); }
	async function settingsMenu() { const summary = develop().getByText(locale === 'de' ? 'Einstellungen' : 'Settings', { exact: true });
		if (!await summary.locator('..').evaluate(details => details.open)) await keyboard(page, summary); }
	async function settingsDialog(mode) { await settingsMenu(); await keyboard(page, named(develop(), 'button', settings[mode])); const dialog = named(page, 'dialog', settings[mode]); await expect(dialog).toBeVisible(); return dialog; }
	async function repair(mode) {
		await settingsMenu(); await keyboard(page, named(develop(), 'button', repairs.menu)); const dialog = named(page, 'dialog', repairs.title); await expect(dialog).toBeVisible();
		await expect(dialog.locator('[data-photo-repair-original]')).toHaveAttribute('data-state', 'ready'); await named(dialog, 'combobox', repairs.mode).selectOption(mode);
		if (await named(dialog, 'combobox', repairs.spot).inputValue() === '') {
			for (const [key, value] of Object.entries({ targetX: .7, targetY: .5, sourceX: .2, sourceY: .5, radius: .15, feather: 0, opacity: 1 })) await named(dialog, 'spinbutton', repairs[key]).fill(String(value));
			await keyboard(page, named(dialog, 'button', repairs.add));
		}
		await keyboard(page, named(dialog, 'button', repairs.apply)); await expect(dialog).toHaveCount(0);
	}
	async function geometry() {
		await named(develop(), 'combobox', words.choose).selectOption('develop-geometry-v1'); await keyboard(page, named(develop(), 'button', words.add));
		for (const [key, value] of [['CropWidth', '.2'], ['CropHeight', '.2'], ['CropX', '.6'], ['CropY', '.4']]) {
			const input = named(develop(), 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared[`videoEffectParam${key}`]}`); await input.fill(value); await input.press('Enter');
		}
		await named(develop(), 'combobox', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectParamFlipHorizontal}`).selectOption('1');
		await named(develop(), 'combobox', words.choose).selectOption('tone-ladder-v1'); await keyboard(page, named(develop(), 'button', words.add));
		const exposure = named(develop(), 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectParamExposure}`); await exposure.fill('1'); await exposure.press('Enter');
	}
	async function brush() {
		await settingsMenu(); await keyboard(page, named(develop(), 'button', brushCopy.menu)); const dialog = named(page, 'dialog', brushCopy.title), grid = named(dialog, 'img', brushCopy.grid);
		await expect(grid).toHaveAttribute('data-state', 'ready');
		for (const [key, value] of [['width', '2'], ['height', '1']]) await named(dialog, 'spinbutton', brushCopy[key]).fill(value);
		await keyboard(page, named(dialog, 'button', brushCopy.create)); await expect(grid).toHaveAttribute('data-state', 'ready');
		for (const [key, value] of [['radius', '.25'], ['hardness', '1'], ['opacity', '1'], ['x', '.25'], ['y', '.5']]) await named(dialog, 'spinbutton', brushCopy[key]).fill(value);
		await keyboard(page, named(dialog, 'button', brushCopy.stamp)); await expect(grid).toHaveAttribute('data-state', 'ready');
		await check(page, named(dialog, 'checkbox', `${brushCopy.bind}: ${words.shared.videoEffectToneLadder} (1)`));
		await keyboard(page, named(dialog, 'button', brushCopy.apply)); await expect(dialog).toHaveCount(0);
	}
	async function paintedReady() { await expect(develop().locator('[data-photo-develop-preview]')).toHaveAttribute('data-state', 'ready'); }
	async function painted(pixels) { await paintedReady(); await expect.poll(() => named(develop(), 'img', words.after).evaluate(canvas => [canvas.width, canvas.height,
		...(canvas.width && canvas.height ? canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data : [])])).toEqual([2, 1, ...pixels]); }
	async function save() {
		const revision = (await photos()).photos[selected].photo.revision;
		await keyboard(page, named(develop(), 'button', words.save));
		await expect.poll(async () => (await photos()).photos[selected].photo.revision).toBe(revision + 1);
		await expect(develop().locator('[data-photo-develop-ack]')).toBeVisible();
		await expect(named(develop(), 'button', words.cancel)).toBeDisabled(); await expect(named(develop(), 'button', words.save)).toBeDisabled();
	}
	function observe() { return page.evaluate(async ({ pathname, ids }) => (await import(new URL(pathname, location.href).href))
		.readRepairSettingsCustodyNativeV1(ids, () => globalThis.__assertNativeOpfsWorkerExecution()), { pathname: PROGRAM, ids }); }
	function photos() { return page.evaluate(async ({ pathname, ids }) => (await import(new URL(pathname, location.href).href))
		.readRepairSettingsPhotosNativeV1(ids), { pathname: PROGRAM, ids }); }
	async function immutable(value) { expect(value.namespace).toBe(initial.namespace); for (const [index, row] of value.photos.entries()) {
		expect(row.original).toEqual(initial.photos[index].original); expect(row.photo.original).toEqual(initial.photos[index].photo.original); } }
	async function png(expected) {
		const text = photoPngExportCopy(locale); await menu(copy.photoFileMenu); await keyboard(page, named(app, 'button', photoPngExportMenuLabel(locale)));
		const dialog = named(page, 'dialog', text.title); await expect(named(dialog, 'button', text.save)).toBeEnabled(); const pending = page.waitForEvent('download');
		await keyboard(page, named(dialog, 'button', text.save)); const download = await pending, bytes = await readFile(await download.path()), chunks = [];
		expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]); expect([...bytes.subarray(16, 26)]).toEqual([0, 0, 0, 2, 0, 0, 0, 1, 8, 6]);
		for (let offset = 8; offset < bytes.length;) { const length = bytes.readUInt32BE(offset), end = offset + length + 12; expect(end).toBeLessThanOrEqual(bytes.length);
			if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, end - 4)); offset = end; }
		expect([...inflateSync(Buffer.concat(chunks))]).toEqual([0, ...expected]); await expect(dialog.getByRole('status').filter({ hasText: '×' })).toBeVisible();
		await keyboard(page, named(dialog, 'button', text.close).last()); await expect(dialog).toHaveCount(0);
	}
}

function originalPng(index) {
	const pixels = repairOriginalReferencePixelsV1(); if (index) pixels.fill(10, 0, 3);
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', Buffer.from([0, 0, 0, 10, 0, 0, 0, 5, 8, 6, 0, 0, 0])),
		pngChunk('sRGB', Buffer.from([0])), pngChunk('IDAT', deflateSync(Buffer.from(Array.from({ length: 5 }, (_, y) => [0, ...pixels.slice(y * 40, (y + 1) * 40)]).flat()))), pngChunk('IEND', Buffer.alloc(0))]);
}
function active(photo) { const version = photo.versions.find(version => version.id === photo.activeVersionId); expect(version).toBeTruthy(); return version; }
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function check(page, control) { await expect(control).not.toBeChecked(); await control.focus(); await page.keyboard.press('Space'); await expect(control).toBeChecked(); }
async function uncheck(page, control) { await expect(control).toBeChecked(); await control.focus(); await page.keyboard.press('Space'); await expect(control).not.toBeChecked(); }
function shape(browserName) { test.skip(browserName === 'webkit', 'Native WebKit storage qualification remains deferred.');
	expect(test.info().config.workers).toBe(1); expect(test.info().retry).toBe(0); expect(test.info().project.retries).toBe(0); }
