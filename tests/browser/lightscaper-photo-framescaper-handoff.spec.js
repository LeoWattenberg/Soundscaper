/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoFramescaperHandoffCopy } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { photoFramescaperHandoffMenuLabel } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { openFramescaperImageFramePackV1 } from '../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { pngChunk } from '../helpers/image-metadata-fixtures.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { installNativeOpfsWorkerCompanion, assertNativeOpfsWorkerExecution } from './helpers/native-opfs-worker-companion.ts';

const NAME = 'Editable original.png', PIXELS = Array(4).fill([255, 255, 255, 255]).flat();
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
	pngChunk('IHDR', Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0])), pngChunk('sRGB', Buffer.from([0])),
	pngChunk('IDAT', deflateSync(Buffer.from([0, ...PIXELS.slice(0, 8), 0, ...PIXELS.slice(8)]))), pngChunk('IEND', Buffer.alloc(0))]);
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${'0.25 0 0\n'.repeat(8)}`);

for (const locale of ['en', 'de']) {
	test(`${locale}: editable-copy action is disabled without one photo and keeps the archive cold`, async ({ page }) => {
		const requested = []; page.on('request', request => { requested.push(request.url()); });
		const { app, copy } = await open(page, locale);
		await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu);
		await expect(named(app, 'button', photoFramescaperHandoffMenuLabel(locale))).toBeDisabled();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		expect(requested.filter(url => /(?:photo-framescaper-handoff|lightscaper-photo-framescaper-handoff-copy)/u.test(url))).toEqual([]);
	});
	test(`${locale}: editable copy downloads its saved recipe, exact original and LUT while sender stays unchanged`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.'); test.setTimeout(90_000);
		const errors = []; page.on('pageerror', error => { errors.push(error.message); });
		await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		await installNativeOpfsWorkerCompanion(page);
		const { app, copy } = await open(page, locale), words = photoFramescaperHandoffCopy(locale), develop = photoDevelopCopy(locale);
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
		const importer = named(page, 'dialog', copy.photoImportPhotos);
		await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: PNG });
		await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
		const library = app.locator('[data-photo-library]'), card = library.locator('[data-photo-id]');
		await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); const id = await card.getAttribute('data-photo-id');
		await keyboard(page, card); await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu); await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale)));
		const workspace = named(page, 'dialog', `${develop.title}: ${NAME}`);
		await expect(named(workspace, 'region', develop.preview)).toHaveAttribute('data-state', 'ready');
		await choose(page, named(workspace, 'combobox', develop.choose), 'cube-lut-profile-v1'); await keyboard(page, named(workspace, 'button', develop.add));
		await workspace.getByLabel(develop.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Quarter red.cube', mimeType: 'text/plain', buffer: CUBE });
		const after = named(workspace, 'img', develop.after);
		await expect.poll(() => after.evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 2, 2).data))).toEqual(Array(4).fill([137, 0, 0, 255]).flat());
		await keyboard(page, named(workspace, 'button', develop.save)); await expect(workspace.locator('[data-photo-develop-ack]')).toBeVisible();
		await expect(named(workspace, 'button', develop.cancel).last()).toBeDisabled(); await keyboard(page, named(workspace, 'button', develop.close).last()); await expect(workspace).toHaveCount(0);
		const before = await observe(page, [id]), photo = before.photos[0].photo, version = photo.versions.find(value => value.id === photo.activeVersionId);
		expect(before.photos[0].bytes).toEqual([...PNG]); expect(photo.original.contentSha256).toBe(sha(PNG)); expect(version.develop.effects[0].params.lut.sha256).toBe(sha(CUBE));
		await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu); await keyboard(page, named(app, 'button', photoFramescaperHandoffMenuLabel(locale)));
		const dialog = named(page, 'dialog', words.title); await expect(dialog).toBeVisible(); await expect(dialog).toContainText(words.description); await expect(dialog).toContainText(words.next);
		const downloadReady = page.waitForEvent('download'); await keyboard(page, named(dialog, 'button', words.download)); const download = await downloadReady;
		await expect(dialog.locator('[data-photo-framescaper-handoff-receipt]')).toHaveAttribute('data-photo-framescaper-handoff-receipt', 'download-started');
		await expect(dialog).toContainText(words.downloadStarted.replace('{name}', 'Editable original.fscape'));
		expect(download.suggestedFilename()).toBe('Editable original.fscape');
		const path = await download.path(); expect(path).not.toBeNull(); const bytes = await readFile(path); const entries = unzipSync(bytes);
		const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json'])), project = JSON.parse(new TextDecoder().decode(entries['project.json']));
		expect(manifest.format).toBe('scape-project'); expect(manifest.project.schemaFamily).toBe('framescaper');
		expect(project.sources).toHaveLength(1); expect(project.clips).toHaveLength(1);
		const image = project.sources[0]; expect(image.schemaVersion).toBe(2); expect(image.develop).toEqual(version.develop);
		expect(image.provenance.original).toEqual({ exactName: NAME, sha256: sha(PNG), byteLength: PNG.length });
		for (const asset of manifest.assets) { expect(entries[asset.entry].length).toBe(asset.size); expect(sha(entries[asset.entry])).toBe(asset.sha256); }
		const packed = manifest.assets.find(asset => asset.sourceId === `framescaper:image:${image.id}`); expect(packed).toBeDefined();
		const body = entries[packed.entry], { develop: _recipe, developed: _geometry, provenance: _origin, ...base } = image;
		const reader = await openFramescaperImageFramePackV1({ source: { ...base, schemaVersion: 1 }, read: (offset, length) => body.slice(offset, offset + length) });
		expect([...await reader.readOriginal()]).toEqual([...PNG]); expect([...await reader.readFrame(0)]).toEqual(PIXELS);
		const lut = manifest.assets.find(asset => asset.sourceId === `framescaper:lut:${version.develop.effects[0].params.lut.sha256}`); expect(lut).toBeDefined(); expect([...entries[lut.entry]]).toEqual([...CUBE]);
		await keyboard(page, named(dialog, 'button', words.close).last()); await expect(dialog).toHaveCount(0);
		expect(await observe(page, [id])).toEqual(before); await page.reload(); await expect(app).toBeVisible(); expect(await observe(page, [id])).toEqual(before); expect(errors).toEqual([]);
	});
}
async function open(page, locale) {
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible(); return { app, copy: bundledLightscaperEditorCopyForLocale(locale) };
}
async function observe(page, ids) {
	const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../helpers/', import.meta.url)), contents: `export { readResidentPhotoLibraryCurrent } from './lightscaper-current-app-fixture.tsx';` }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.woff2': 'dataurl' } });
	await page.route('**/__editable_copy_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const result = await page.evaluate(async ids => (await import(new URL('/__editable_copy_observer.js', location.href).href)).readResidentPhotoLibraryCurrent(ids, indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution()), ids);
	await assertNativeOpfsWorkerExecution(page); return result;
}
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function menu(page, app, label) { await keyboard(page, app.locator('summary').filter({ hasText: new RegExp(`^${label}$`, 'u') })); }
async function choose(page, combo, value) {
	await expect(combo).toBeVisible(); await expect(combo).toBeEnabled();
	await expect.poll(() => combo.locator('option').evaluateAll((options, value) => options.some(option => option.value === value), value)).toBe(true);
	const index = await combo.locator('option').evaluateAll((options, value) => options.findIndex(option => option.value === value), value);
	expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(64); await combo.focus(); await expect(combo).toBeFocused(); await page.keyboard.press('Home');
	for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown'); await expect(combo).toHaveValue(value);
}
