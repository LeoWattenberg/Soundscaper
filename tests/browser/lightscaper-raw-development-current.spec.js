/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { bundledSiteCopyForLocale } from '../../src/common/i18n/site-copy.js';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopRepairSpotsCopy } from '../../src/common/i18n/lightscaper-develop-repair-spots-copy.ts';
import { photoDevelopRawDevelopmentCopy } from '../../src/common/i18n/lightscaper-raw-development-copy.ts';
import { rawRecoveryDngFixtureV1 } from '../helpers/lightscaper-raw-recovery-dng-current-fixture.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';

test.use({ browserCoverage: false });
const PROGRAM = '/__lightscaper_raw_development_custody.js', NAME = 'Recover highlights.dng';
let program;
const binaries = [];
test.beforeAll(async () => {
	for (const name of ['lightscaper-libraw-runtime-manifest.json', 'lightscaper-libraw-recovery-runtime-manifest.json']) {
		const manifest = JSON.parse(await readFile(new URL(`../../config/${name}`, import.meta.url), 'utf8'));
		const bytes = await readFile(new URL(`../../${manifest.runtime.path}`, import.meta.url));
		expect(bytes.length).toBe(manifest.runtime.byteLength); expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.runtime.sha256);
		binaries.push({ url: manifest.runtime.url, bytes });
	}
	program = await compileNativeImageHandoffScript('raw-development-custody.js', fileURLToPath(new URL('./helpers/lightscaper-raw-development-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: real RAW source processing, canonical Before, recovery Clone, native Save and sticky canonical4 survive reload`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'This bounded native RAW workflow qualifies Chromium and Firefox.'); test.setTimeout(240_000);
	const copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale, 'current3');
	const raw = photoDevelopRawDevelopmentCopy(locale), repairs = photoDevelopRepairSpotsCopy(locale), errors = [], workers = [];
	const file = rawRecoveryDngFixtureV1({ orientation: 6 }), originalBytes = Buffer.from(file.bytes), digest = createHash('sha256').update(originalBytes).digest('hex');
	page.on('pageerror', error => { errors.push(error.message); });
	page.on('worker', worker => { if (new URL(worker.url()).pathname.includes('libraw-worker-v')) workers.push(worker.url()); });
	for (const binary of binaries) await page.route(binary.url, route => route.fulfill({ status: 200, headers: {
		'content-type': 'application/wasm', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin',
	}, body: binary.bytes }));
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	await page.goto(resolveBrowserProductTestUrl(`/lightscaper/${locale}/`));
	const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(copy.photoFileMenu); await keyboard(named(app, 'button', copy.photoImportPhotos));
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	// Real owned DNG bytes select RAW despite this incorrect raster MIME hint.
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: originalBytes });
	await keyboard(named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const library = named(app, 'region', bundledSiteCopyForLocale(locale).workspacePhoto), card = app.getByRole('button', { name: /^Recover highlights\.dng/u });
	await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(card);
	const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy();
	const initial = await observe(); immutable(initial);
	expect(initial.native.canonical.descriptor).toEqual({ schemaVersion: 1, width: 96, height: 128, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' });
	for (const profile of ['headroom', 'recovery']) {
		expect(initial.native[profile].descriptor).toEqual({ schemaVersion: 1, width: 96, height: 128, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' });
		expect(initial.native[profile].rawFlip).toBe(6); expect(initial.native[profile].samples.some(value => value > 1)).toBe(true);
	}
	expect(initial.native.recovery.exposureScale).toBe(initial.native.headroom.exposureScale);
	const canonical = Float32Array.from(initial.native.canonical.words, value => value / 65535);
	const beforePixels = encode(initial.native.canonical.words.map(value => value / 65535));
	const headroomPixels = encode(initial.native.headroom.samples), headroomTone = encode(exposure(initial.native.headroom.samples));
	const recoveredTone = encode(exposure(initial.native.recovery.samples)), repairedRecovery = encode(exposure(clone(initial.native.recovery.samples)));
	const repairedCanonical = encode(exposure(clone(canonical)));
	expect(headroomTone).not.toEqual(recoveredTone); expect(repairedRecovery).not.toEqual(recoveredTone); expect(repairedCanonical).not.toEqual(repairedRecovery);

	await openDevelop(); const editing = named(page, 'dialog', `${words.title}: ${NAME}`), preview = editing.locator('[data-photo-develop-preview]');
	const before = named(editing, 'img', words.before), after = named(editing, 'img', words.after);
	await ready(encode(canonical)); await expect(named(editing, 'combobox', raw.mode)).toHaveCount(0);
	// The feature is reached only through the existing opted-in Settings menu.
	let processing = await openProcessing(); await expect(named(processing, 'combobox', raw.mode)).toHaveValue('canonical');
	await select(processing, 'headroom'); await close(processing, raw);
	await ready(encode(canonical)); await expect(named(editing, 'button', words.save)).toBeDisabled(); expect(await observe()).toEqual(initial);

	processing = await openProcessing(); await select(processing, 'headroom'); await apply(processing);
	await ready(headroomPixels); expect(await observe()).toEqual(initial);
	await named(editing, 'combobox', words.choose).selectOption('tone-ladder-v1'); await keyboard(named(editing, 'button', words.add));
	const exposureControl = named(editing, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectParamExposure}`);
	await exposureControl.fill('-1'); await exposureControl.press('Enter'); await expect(exposureControl).toHaveValue('-1');
	await ready(headroomTone);
	const headroom = await save(initial.photo.revision + 1, 'headroom', 0); unchanged(headroom, initial);

	processing = await openProcessing(); await expect(named(processing, 'combobox', raw.mode)).toHaveValue('headroom');
	await select(processing, 'recovery'); await apply(processing); await ready(recoveredTone);
	await settingsMenu(); await keyboard(named(editing, 'button', repairs.menu)); const repair = named(page, 'dialog', repairs.title);
	await expect(named(repair, 'img', repairs.original)).toHaveAttribute('data-state', 'ready');
	await named(repair, 'combobox', repairs.mode).selectOption('clone');
	// Orientation6 maps unrotated sensor target(72,40) to(55,72), and
	// donor(12,40) to(55,12). A radius0.24 covers exactly the target center.
	for (const [field, value] of Object.entries({ targetX: 55.5 / 96, targetY: 72.5 / 128, sourceX: 55.5 / 96, sourceY: 12.5 / 128,
		radius: .0025, feather: 0, opacity: 1 })) await named(repair, 'spinbutton', repairs[field]).fill(String(value));
	await keyboard(named(repair, 'button', repairs.add)); await keyboard(named(repair, 'button', repairs.apply)); await expect(repair).toHaveCount(0);
	await ready(repairedRecovery); expect(await observe()).toEqual(headroom);
	const recovered = await save(headroom.photo.revision + 1, 'recovery', 1); unchanged(recovered, initial);
	const recoveredRecipe = active(recovered.photo).develop;
	expect(recoveredRecipe.repairs.spots[0]).toMatchObject({ mode: 'clone', enabled: true,
		target: { x: 55.5 / 96, y: 72.5 / 128 }, source: { x: 55.5 / 96, y: 12.5 / 128 }, radius: .0025, feather: 0, opacity: 1 });
	expect(recoveredRecipe.effects.map(effect => [effect.type, effect.params.exposure])).toEqual([['tone-ladder-v1', -1]]);
	await close(editing, words); await reload(); await openDevelop(); await ready(repairedRecovery); expect(await observe()).toEqual(recovered);
	await expect(exposureControl).toHaveValue('-1');

	processing = await openProcessing(); await expect(named(processing, 'combobox', raw.mode)).toHaveValue('recovery');
	await select(processing, 'canonical'); await apply(processing); await ready(repairedCanonical);
	const restored = await save(recovered.photo.revision + 1, 'canonical', 1); unchanged(restored, initial);
	expect(active(restored.photo).develop).toEqual({ ...recoveredRecipe, rawDevelopment: { schemaVersion: 1, mode: 'canonical' } });
	processing = await openProcessing(); await expect(named(processing, 'combobox', raw.mode)).toHaveValue('canonical');
	await select(processing, 'canonical'); await apply(processing); await ready(repairedCanonical);
	await expect(named(editing, 'button', words.save)).toBeDisabled(); expect(await observe()).toEqual(restored);
	await close(editing, words); await reload(); await openDevelop(); await ready(repairedCanonical); expect(await observe()).toEqual(restored);
	processing = await openProcessing(); await expect(named(processing, 'combobox', raw.mode)).toHaveValue('canonical'); await close(processing, raw); await close(editing, words);
	for (const version of [1, 2]) expect(workers.some(url => new URL(url).pathname.includes(`libraw-worker-v${version}-`))).toBe(true);
	for (const url of workers) {
		expect(new URL(url).origin).toBe(new URL(page.url()).origin); expect(new URL(url).pathname).toMatch(/\/assets\/libraw-worker-v[12]-[^/]+\.js$/u);
	}
	expect(errors).toEqual([]);

	async function keyboard(control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
	async function menu(label) { await keyboard(app.getByRole('navigation').getByText(label, { exact: true })); }
	async function openDevelop() { await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(named(app, 'button', photoDevelopMenuLabel(locale))); }
	async function settingsMenu() {
		const summary = editing.locator('summary').filter({ hasText: settings.menu }); await expect(summary).toHaveCount(1);
		if (!await summary.locator('..').evaluate(details => details.open)) await keyboard(summary);
	}
	async function openProcessing() {
		await settingsMenu(); await keyboard(named(editing, 'button', raw.menu)); const dialog = named(page, 'dialog', raw.title);
		await expect(named(dialog, 'combobox', raw.mode)).toBeVisible(); return dialog;
	}
	async function select(dialog, mode) {
		await named(dialog, 'combobox', raw.mode).selectOption(mode); await expect(named(dialog, 'combobox', raw.mode)).toHaveValue(mode);
		await expect(named(dialog, 'button', raw.apply)).toBeEnabled(); await expect(dialog.getByRole('alert')).toHaveCount(0);
	}
	async function apply(dialog) { await keyboard(named(dialog, 'button', raw.apply)); await expect(dialog).toHaveCount(0); }
	async function close(dialog, text) { await keyboard(named(dialog, 'button', text.close).last()); await expect(dialog).toHaveCount(0); }
	async function ready(expected) {
		await expect(preview).toHaveAttribute('data-state', 'ready');
		await expect.poll(() => plane(before)).toEqual([96, 128, ...beforePixels]); await expect.poll(() => plane(after)).toEqual([96, 128, ...expected]);
	}
	async function save(revision, mode, spots) {
		await keyboard(named(editing, 'button', words.save)); await expect(editing.locator('[data-photo-develop-ack]')).toBeVisible();
		await expect(named(editing, 'button', words.reload)).toBeEnabled(); await expect(named(editing, 'button', words.save)).toBeDisabled();
		const saved = await observe(); immutable(saved); expect(saved.photo.revision).toBe(revision); expect(saved.photo.schemaVersion).toBe(3);
		const develop = active(saved.photo).develop; expect(develop.processVersion).toBe(4); expect(develop.rawDevelopment).toEqual({ schemaVersion: 1, mode });
		expect(develop.repairs.spots).toHaveLength(spots); return saved;
	}
	async function reload() { await page.reload(); await expect(app).toBeVisible(); await menu(copy.photoViewMenu); await keyboard(named(app, 'button', copy.photoShowLibrary));
		await expect(card).toHaveCount(1); await keyboard(card); }
	function observe() { return page.evaluate(async ({ pathname, photoId }) => (await import(new URL(pathname, location.href).href)).readRawDevelopmentCustodyCurrentV1(photoId), { pathname: PROGRAM, photoId }); }
	function immutable(value) {
		expect(value.bytes).toEqual([...originalBytes]); expect(value.original.sha256).toBe(digest); expect(value.original.byteLength).toBe(originalBytes.length);
		expect(value.photo.original.contentSha256).toBe(digest); expect(value.photo.original.mimeType).toBe('image/x-adobe-dng');
		expect([value.photo.original.width, value.photo.original.height]).toEqual([96, 128]);
	}
});

function unchanged(value, baseline) {
	expect(value.original).toEqual(baseline.original); expect(value.photo.original).toEqual(baseline.photo.original);
	expect(value.native).toEqual(baseline.native); expect(value.bytes).toEqual(baseline.bytes); expect(value.namespace).toBe(baseline.namespace);
}
function active(photo) { return photo.versions.find(version => version.id === photo.activeVersionId); }

/** Independent exact operations, after actual native reconstruction has already
 * applied its scale. Original-space Clone uses one literal pixel; exposure−1
 * writes Float32 once. Only this final SDR boundary clips and quantizes. */
function clone(samples) {
	const pixels = Float32Array.from(samples), donor = (12 * 96 + 55) * 4, target = (72 * 96 + 55) * 4;
	for (let channel = 0; channel < 3; channel++) pixels[target + channel] = samples[donor + channel]; return pixels;
}
function exposure(samples) { return Float32Array.from(samples, (value, index) => index % 4 === 3 ? value : Math.fround(value * .5)); }
function encode(samples) {
	return Array.from(samples, (value, index) => {
		if (index % 4 === 3) return 255;
		const linear = Math.max(0, Math.min(1, value)); return Math.round(255 * (linear <= .0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - .055));
	});
}
function plane(canvas) { return canvas.evaluate(node => [node.width, node.height, ...(node.width && node.height ? node.getContext('2d').getImageData(0, 0, node.width, node.height).data : [])]); }
function named(root, role, name) { return root.getByRole(role, { name, exact: true }); }
