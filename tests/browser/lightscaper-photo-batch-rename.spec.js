/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });

// Actual menu actions own every publication. The routed helper only reads two
// photos and their <1KiB exact originals; no fake command replaces the session.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAALZlWElmSUkqAAgAAAAGAA4BAgAPAAAAaAAAAA8BAgAOAAAAdwAAABIBAwABAAAAAQAAADsBAgAPAAAAhQAAAJiCAgAOAAAAlAAAAGmHBAABAAAAVgAAAAAAAAABAAOQAgAUAAAAogAAAAAAAABTb3VyY2UgY2FwdGlvbgBOYXRpdmUgY2FtZXJhAFNvdXJjZSBjcmVhdG9yAFNvdXJjZSByaWdodHMAMjAyNjoxMDowOCAxMToxMjoxMwDS1J8kAAAADElEQVQI12NgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC', 'base64');
const SHA256 = createHash('sha256').update(PNG).digest('hex');
const SOURCE_NAMES = ['東京 é.PNG', 'Second.JPG'];
const ROOT = '/__photo_batch_rename_observer.js';

for (const locale of ['en', 'de']) {
	test(`${locale}: File Photo batch preview/rename/undo preserves exact originals and refuses a peer's stale revision`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Full WebKit catalog Blob/OPFS custody qualification remains deferred.');
		test.setTimeout(120_000);
		const errors = [], requests = []; page.on('pageerror', error => { errors.push(error.message); });
		page.on('request', request => { requests.push(request.url()); });
		const { app, copy, url } = await setup(page, locale);
		await expect(app.locator('[data-photo-library]')).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0);
		await topAction(page, app, copy.photoFileMenu, copy.photoImportPhotos);
		const importer = page.getByRole('dialog', { name: copy.photoImportPhotos, exact: true });
		await importer.locator('input[type=file]').setInputFiles(SOURCE_NAMES.map(name => ({ name, mimeType: 'image/png', buffer: PNG })));
		await keyboard(page, importer.locator('button[type=submit]')); await expect(importer).toHaveCount(0);
		const library = app.locator('[data-photo-library]');
		await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '2');
		await expect(library).toHaveAttribute('aria-busy', 'false');
		const ids = await library.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => node.dataset.photoId));
		const before = await observe(page, ids);
		expect(new Set(before.photos.map(photo => photo.originalId)).size).toBe(2);
		expect(new Set(before.photos.map(photo => photo.storageKey)).size).toBe(1);
		for (const photo of before.photos) {
			expect(photo.bytes).toEqual([...PNG]); expect(photo.sha256).toBe(SHA256); expect(photo.byteLength).toBe(PNG.length);
			expect(SOURCE_NAMES).toContain(photo.originalName);
			expect(photo.extractedMetadata.exif.artist).toBe('Source creator');
		}
		await library.locator(`[data-photo-id="${ids[1]}"]`).click();
		await library.locator(`[data-photo-id="${ids[0]}"]`).click({ modifiers: ['Control'] });
		await expect(library.locator('[data-photo-id][aria-pressed=true]')).toHaveCount(2);
		await photoAction(page, app, copy, copy.photoBatchRenameTitle);
		let dialog = page.getByRole('dialog', { name: copy.photoBatchRenameTitle, exact: true });
		await expect(dialog.locator('[data-batch-rename-template]')).toBeFocused();
		await expect(dialog.locator('[data-batch-rename-plan-row]')).toHaveCount(0);
		await expect(dialog.locator('[data-batch-rename-apply]')).toBeDisabled();
		await dialog.locator('[data-batch-rename-template]').fill('{stem}-撮影-{sequence}.{extension}');
		await dialog.locator('[data-batch-rename-sequence-start]').fill('7');
		await dialog.locator('[data-batch-rename-sequence-padding]').fill('3');
		await keyboard(page, dialog.locator('[data-batch-rename-preview]'));
		await expect(dialog.locator('[data-batch-rename-plan-row]')).toHaveCount(2);
		const planned = before.photos.map((photo, index) => photo.fileName.replace(/\.([^.]+)$/u, `-撮影-00${index + 7}.$1`));
		for (let index = 0; index < 2; index++) await expect(dialog.locator('[data-batch-rename-plan-row]').nth(index)).toContainText(planned[index]);
		expect(await observe(page, ids)).toEqual(before);
		await keyboard(page, dialog.locator('[data-batch-rename-apply]'));
		await expect(dialog.locator('[data-batch-rename-status="renamed"]')).toHaveCount(2);
		await expect(dialog.locator('[data-batch-rename-preview]')).toBeDisabled();
		await keyboard(page, dialog.locator('[data-batch-rename-close]')); await expect(dialog).toHaveCount(0);
		const renamed = await observe(page, ids);
		for (let index = 0; index < 2; index++) {
			expect(renamed.photos[index].fileName).toBe(planned[index]);
			expect(renamed.photos[index].revision).toBe(before.photos[index].revision + 1);
			assertOriginal(renamed.photos[index], before.photos[index]);
		}
		await photoAction(page, app, copy, copy.photoBatchRenameUndo);
		await expect(app.locator('[data-batch-rename-status="restored"]')).toHaveCount(2);
		const restored = await observe(page, ids);
		for (let index = 0; index < 2; index++) {
			expect(restored.photos[index].fileName).toBe(before.photos[index].fileName);
			expect(restored.photos[index].revision).toBe(before.photos[index].revision + 2);
			assertOriginal(restored.photos[index], before.photos[index]);
		}
		await expect(app.getByRole('button', { name: copy.photoBatchRenameUndo, exact: true, includeHidden: true })).toBeDisabled();

		// A second real App modifies one selected photo after Preview. Apply keeps
		// that failed slot and its sequence position, while saving the other slot.
		await photoAction(page, app, copy, copy.photoBatchRenameTitle);
		dialog = page.getByRole('dialog', { name: copy.photoBatchRenameTitle, exact: true });
		await dialog.locator('[data-batch-rename-template]').fill('Conflict-{sequence}.{extension}');
		await keyboard(page, dialog.locator('[data-batch-rename-preview]'));
		const peer = await page.context().newPage(); peer.on('pageerror', error => { errors.push(error.message); });
		try {
			await peer.goto(url); const peerApp = peer.locator('[data-lightscaper-bound="true"]'); await expect(peerApp).toBeVisible();
			await topAction(peer, peerApp, copy.photoViewMenu, copy.photoShowLibrary);
			await peerApp.locator(`[data-photo-id="${ids[0]}"]`).click();
			await photoAction(peer, peerApp, copy, copy.photoEditMetadata);
			const metadata = peer.getByRole('dialog', { name: copy.photoEditMetadata, exact: true });
			await metadata.locator('input[name=title]').fill('Peer authored title');
			await keyboard(peer, metadata.locator('button[type=submit]'));
			await expect(metadata.locator('input[name=title]')).toHaveValue('Peer authored title');
			await expect(peerApp.locator('[data-photo-library]')).toHaveAttribute('aria-busy', 'false');
		} finally { await peer.close(); }
		await keyboard(page, dialog.locator('[data-batch-rename-apply]'));
		await expect(dialog.locator('[data-batch-rename-status="failed"]')).toHaveCount(1);
		await expect(dialog.locator('[data-batch-rename-status="renamed"]')).toHaveCount(1);
		await expect(dialog.locator('[data-batch-rename-results]')).toHaveAttribute('data-batch-rename-completion', 'finished');
		const conflict = await observe(page, ids);
		expect(conflict.photos[0].fileName).toBe(before.photos[0].fileName);
		expect(conflict.photos[0].metadata.title).toBe('Peer authored title');
		expect(conflict.photos[1].fileName).toBe(`Conflict-002.${before.photos[1].fileName.split('.').at(-1)}`);
		await keyboard(page, dialog.locator('[data-batch-rename-close]'));
		await photoAction(page, app, copy, copy.photoBatchRenameUndo);
		await expect(app.locator('[data-batch-rename-status="restored"]')).toHaveCount(1);
		await expect(app.getByRole('button', { name: copy.photoBatchRenameUndo, exact: true, includeHidden: true })).toBeDisabled();
		const final = await observe(page, ids);
		for (let index = 0; index < 2; index++) {
			expect(final.photos[index].fileName).toBe(before.photos[index].fileName);
			expect(final.photos[index].revision).toBe(before.photos[index].revision + (index === 0 ? 3 : 4));
			assertOriginal(final.photos[index], before.photos[index]);
		}
		expect(final.photos[0].metadata.title).toBe('Peer authored title');
		await page.reload(); await expect(app).toBeVisible(); await expect(app.locator('[data-photo-library]')).toHaveCount(0);
		await topAction(page, app, copy.photoViewMenu, copy.photoShowLibrary);
		for (let index = 0; index < 2; index++) await expect(app.locator(`[data-photo-id="${ids[index]}"]`)).toContainText(before.photos[index].fileName);
		expect(await observe(page, ids)).toEqual(final); expect(errors).toEqual([]);
		expect(requests.filter(url => /\/assets\/editor-copy-/u.test(url))).toEqual([]);
	});
}

function assertOriginal(actual, previous) {
	for (const key of ['originalId', 'originalName', 'storageKey', 'sha256', 'byteLength', 'bytes', 'extractedMetadata']) expect(actual[key]).toEqual(previous[key]);
	for (const key of ['caption', 'creator', 'copyright', 'orientation', 'cameraMake']) expect(actual.metadata[key]).toEqual(previous.metadata[key]);
}
async function keyboard(page, locator) { await expect(locator).toBeEnabled(); await locator.focus(); await expect(locator).toBeFocused(); await page.keyboard.press('Enter'); }
async function topAction(page, app, menu, action) {
	await keyboard(page, app.locator('nav > details > summary').filter({ hasText: new RegExp(`^${escape(menu)}$`, 'u') }));
	await keyboard(page, app.getByRole('button', { name: action, exact: true }));
}
async function photoAction(page, app, copy, action) {
	await keyboard(page, app.locator('nav > details > summary').filter({ hasText: new RegExp(`^${escape(copy.photoFileMenu)}$`, 'u') }));
	await keyboard(page, app.locator('.lightscaper-photo-submenu > summary'));
	await keyboard(page, app.getByRole('button', { name: action, exact: true }));
}
async function setup(page, locale) {
	const bundle = await build({ stdin: { contents: 'export { readResidentPhotoLibraryV1 as observe } from "./tests/helpers/lightscaper-photo-library-ui-fixture.ts"; export { bundledLightscaperEditorCopyForLocale as copyForLocale } from "./src/common/i18n/lightscaper-editor-copy.ts";',
		resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route(`**${ROOT}`, async route => { await route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }); });
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	const url = `${origin}/${locale}/`; await page.goto(url);
	const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	const copy = await page.evaluate(async ({ locale, root }) => (await import(new URL(root, location.href).href)).copyForLocale(locale), { locale, root: ROOT });
	return { app, copy, url };
}
async function observe(page, ids) {
	return page.evaluate(async ({ ids, root }) => {
		if (ids.length !== 2) throw new RangeError('Batch rename menu observation requires exactly two photos.');
		return (await import(new URL(root, location.href).href)).observe(ids);
	}, { ids, root: ROOT });
}
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
