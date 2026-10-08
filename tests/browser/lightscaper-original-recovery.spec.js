/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });
const ROOT = '/__photo_original_recovery_observer.js';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAALZlWElmSUkqAAgAAAAGAA4BAgAPAAAAaAAAAA8BAgAOAAAAdwAAABIBAwABAAAAAQAAADsBAgAPAAAAhQAAAJiCAgAOAAAAlAAAAGmHBAABAAAAVgAAAAAAAAABAAOQAgAUAAAAogAAAAAAAABTb3VyY2UgY2FwdGlvbgBOYXRpdmUgY2FtZXJhAFNvdXJjZSBjcmVhdG9yAFNvdXJjZSByaWdodHMAMjAyNjoxMDowOCAxMToxMjoxMwDS1J8kAAAADElEQVQI12NgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC', 'base64');
const SHA256 = createHash('sha256').update(PNG).digest('hex');
const AUTHORED_TITLE = 'Recovery UI authored title';
const AUTHORED_CAPTION = 'Authored first line\nAuthored second line';

for (const locale of ['en', 'de']) {
	test(`${locale}: File original recovery refuses wrong bytes and restores shared source without changing photos`, async ({ page, browserName }) => {
		qualify(browserName);
		const context = await setup(page, locale);
		const { app, copy, ids, before } = context;
		await observer(page, 'seedOriginalRecoveryFaultV1', ids, 'corrupt-body');
		const damaged = await observe(page, ids);
		expect(damaged.photos).toEqual(before.photos); expect(damaged.root).toEqual(before.root);
		expect(damaged.actualSha256).not.toBe(SHA256);
		expect(damaged.authority.row).toMatchObject({ storage: 'indexeddb-blob', catalogRootCount: 2,
			mediaContentToken: before.authority.row.mediaContentToken });
		const dialog = await openRecovery(page, app, copy);
		await expect(dialog.locator('[data-original-row]')).toHaveCount(2);
		for (const row of await dialog.locator('[data-original-row]').all()) await expect(row).toContainText(copy.photoOriginalCorrupt);
		await chooseTarget(page, dialog, before.photos[0].metadata.fileName);
		const wrong = Buffer.from(PNG); wrong[wrong.length - 1] ^= 1;
		await chooseFile(page, dialog, wrong, 'Retry-source.bin');
		await keyboard(page, dialog.getByRole('button', { name: copy.photoOriginalRestore, exact: true }));
		await expect(dialog.getByRole('alert')).toBeVisible();
		await expect(dialog.getByRole('button', { name: copy.photoOriginalInspect, exact: true })).toBeEnabled();
		await expect(dialog.locator('[data-original-selected-file]')).toHaveCount(0);
		expect(await observe(page, ids)).toEqual(damaged);
		// The original selected name is irrelevant to exact-body restoration.
		await chooseFile(page, dialog, PNG, 'Retry-source.bin');
		await keyboard(page, dialog.getByRole('button', { name: copy.photoOriginalRestore, exact: true }));
		await expect(dialog.locator('[data-original-receipt]')).toContainText(copy.photoOriginalRestored);
		await settled(app, dialog, copy);
		await keyboard(page, dialog.getByRole('button', { name: copy.photoOriginalInspect, exact: true }));
		await verified(dialog, copy, 2);
		assertRestored(await observe(page, ids), before);
		await keyboard(page, dialog.locator('[data-original-close]'));
		await reopenLibrary(page, app, copy); assertRestored(await observe(page, ids), before);
		assertClean(context);
	});

	test(`${locale}: recovery remains reachable after failed startup and ACK precedes provisional promotion`, async ({ page, browserName }) => {
		qualify(browserName);
		const context = await setup(page, locale);
		const { app, copy, ids, before } = context;
		const fault = await observer(page, 'seedOriginalRecoveryFaultV1', ids, 'provisional-missing-row');
		const missing = await observe(page, ids);
		expect(missing.authority.row).toBeNull(); expect(missing.bytes).toBeNull();
		expect(missing.photos).toEqual(before.photos); expect(missing.root).toEqual(before.root);
		expect(missing.authority.roots.filter(root => root.importId === fault.importId)).toHaveLength(1);
		expect(missing.authority.intent).toEqual({ schemaVersion: 1, kind: 'photo-import', catalogId: before.root.id, importId: fault.importId });
		await page.reload(); await expect(app).toBeVisible();
		await action(page, app, copy.photoViewMenu, copy.photoShowLibrary);
		await expect(app.getByRole('alert')).toBeVisible();
		const dialog = await openRecovery(page, app, copy);
		await expect(dialog.locator('[data-original-row]')).toHaveCount(1);
		await expect(dialog.locator('[data-original-row]')).toContainText(copy.photoOriginalMissing);
		await expect(dialog.locator('[data-original-next]')).toBeEnabled();
		await expect(dialog).toContainText(copy.photoOriginalStartupFailure.split('{message}')[0]);
		expect(await observe(page, ids)).toEqual(missing);
		await keyboard(page, dialog.getByRole('button', { name: copy.photoNextPage, exact: true }));
		await expect(dialog.locator('[data-original-row]')).toHaveCount(1);
		const target = before.photos.find(photo => photo.id === fault.provisionalPhotoId);
		await expect(dialog.locator('[data-original-row]')).toContainText(target.metadata.fileName);
		await expect(dialog.locator('[data-original-next]')).toBeDisabled();
		await chooseTarget(page, dialog, target.metadata.fileName);
		await chooseFile(page, dialog, PNG, 'Same-body-different-name.dat');
		await observer(page, 'holdOriginalRecoveryRetryV1', fault.assetId);
		try {
			await keyboard(page, dialog.getByRole('button', { name: copy.photoOriginalRestore, exact: true }));
			await expect.poll(() => observer(page, 'originalRecoveryRetryStateV1')).toEqual({ publicationCompleted: true, entered: true, released: false });
			await expect(dialog.locator('[data-original-receipt]')).toContainText(copy.photoOriginalRestored);
			const acknowledged = await observe(page, ids);
			assertDocumentsAndSource(acknowledged, before);
			expect(acknowledged.authority.roots).toEqual(missing.authority.roots);
			expect(acknowledged.authority.intent).toEqual(missing.authority.intent);
			await keyboard(page, dialog.locator('[data-original-close]'));
			await action(page, app, copy.photoFileMenu, copy.photoOriginalRecoveryTitle);
			const reopened = recoveryDialog(page, copy);
			await expect(reopened.locator('[data-original-restore]')).toBeDisabled();
			await expect(reopened.locator('[data-original-receipt]')).toContainText(copy.photoOriginalRestored);
		} finally { await observer(page, 'releaseOriginalRecoveryRetryV1'); }
		const reopened = recoveryDialog(page, copy);
		await settled(app, reopened, copy);
		assertRestored(await observe(page, ids), before);
		await keyboard(page, reopened.locator('[data-original-close]'));
		await reopenLibrary(page, app, copy); assertRestored(await observe(page, ids), before);
		assertClean(context);
	});

	test(`${locale}: held native selected-file read stays owned across Close, reopen and Cancel`, async ({ page, browserName }) => {
		qualify(browserName);
		const context = await setup(page, locale);
		const { app, copy, ids, before } = context;
		await observer(page, 'seedOriginalRecoveryFaultV1', ids, 'corrupt-body');
		const damaged = await observe(page, ids);
		let dialog = await openRecovery(page, app, copy);
		await chooseTarget(page, dialog, before.photos[0].metadata.fileName);
		await chooseFile(page, dialog, PNG, 'Same-file-retry.bin');
		await observer(page, 'holdNextOriginalRecoveryReadV1');
		try {
			await keyboard(page, dialog.getByRole('button', { name: copy.photoOriginalRestore, exact: true }));
			await expect.poll(() => observer(page, 'originalRecoveryReadStateV1')).toEqual({ calls: 1, entered: true, released: false, byteLength: PNG.length });
			await keyboard(page, dialog.locator('[data-original-close]')); await expect(dialog).toHaveCount(0);
			await action(page, app, copy.photoFileMenu, copy.photoOriginalRecoveryTitle);
			dialog = recoveryDialog(page, copy);
			await expect(dialog.locator('[data-original-file]')).toBeDisabled();
			await expect(dialog.locator('[data-original-inspect]')).toBeDisabled();
			await expect(dialog.locator('[data-original-restore]')).toBeDisabled();
			await expect(app.getByRole('button', { name: copy.photoImportPhotos, exact: true })).toBeDisabled();
			await keyboard(page, dialog.getByRole('button', { name: copy.photoCancelAction, exact: true }));
			await expect(dialog.locator('[data-original-inspect]')).toBeDisabled();
			expect(await observer(page, 'originalRecoveryReadStateV1')).toEqual({ calls: 1, entered: true, released: false, byteLength: PNG.length });
		} finally { await observer(page, 'releaseOriginalRecoveryReadV1'); }
		await expect(dialog).toContainText(copy.photoOriginalCancelled);
		await expect(dialog.getByRole('button', { name: copy.photoOriginalInspect, exact: true })).toBeEnabled();
		expect(await observe(page, ids)).toEqual(damaged);
		await chooseTarget(page, dialog, before.photos[0].metadata.fileName);
		await chooseFile(page, dialog, PNG, 'Same-file-retry.bin');
		await keyboard(page, dialog.getByRole('button', { name: copy.photoOriginalRestore, exact: true }));
		await expect(dialog.locator('[data-original-receipt]')).toContainText(copy.photoOriginalRestored);
		await settled(app, dialog, copy);
		await keyboard(page, dialog.getByRole('button', { name: copy.photoOriginalInspect, exact: true }));
		await verified(dialog, copy, 2); assertRestored(await observe(page, ids), before);
		assertClean(context);
	});
}

function qualify(browserName) {
	test.skip(browserName === 'webkit', 'Full WebKit catalog Blob/OPFS custody qualification remains deferred.');
	test.setTimeout(120_000);
}
async function setup(page, locale) {
	const requests = [], errors = [];
	page.on('request', request => { requests.push(request.url()); }); page.on('pageerror', error => { errors.push(error.message); });
	const bundle = await build({ stdin: {
		contents: 'export * from "./tests/helpers/lightscaper-original-recovery-ui-fixture.ts"; export { bundledLightscaperEditorCopyForLocale as copyForLocale } from "./src/common/i18n/lightscaper-editor-copy.ts";',
		resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
	}, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route(`**${ROOT}`, async route => { await route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }); });
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`);
	const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	const copy = await observer(page, 'copyForLocale', locale);
	await expect(page.getByRole('dialog')).toHaveCount(0); await expect(app.locator('[data-photo-library]')).toHaveCount(0);
	await action(page, app, copy.photoFileMenu, copy.photoImportPhotos);
	const importer = page.getByRole('dialog', { name: copy.photoImportPhotos, exact: true });
	await importer.locator('input[type=file]').setInputFiles(['東京 é.PNG', 'Second.png'].map(name => ({ name, mimeType: 'image/png', buffer: PNG })));
	await keyboard(page, importer.locator('[data-photo-import-options] > summary'));
	for (const [field, value, label] of [['title', AUTHORED_TITLE, copy.photoMetadataTitle], ['caption', AUTHORED_CAPTION, copy.photoCaption], ['creator', '', copy.photoCreator]]) {
		await importer.getByRole('checkbox', { name: copy.photoImportOverride.replace('{field}', label), exact: true }).check();
		await importer.locator(`[data-import-metadata="${field}"]`).fill(value);
	}
	await keyboard(page, importer.locator('button[type=submit]')); await expect(importer).toHaveCount(0);
	const library = app.locator('[data-photo-library]');
	await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '2');
	await expect(library).toHaveAttribute('aria-busy', 'false');
	const first = library.locator('[data-photo-id]').first();
	await first.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('5');
	await expect(first).toContainText(`${copy.photoRating}: 5`); await expect(library).toHaveAttribute('aria-busy', 'false');
	const ids = await library.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => node.dataset.photoId));
	const before = await observe(page, ids);
	expect(before.photos).toHaveLength(2); expect(before.photos[0].rating).toBe(5);
	for (const photo of before.photos) {
		expect(photo.metadata).toMatchObject({ title: AUTHORED_TITLE, caption: AUTHORED_CAPTION, creator: '' });
		expect(photo.original.contentSha256).toBe(SHA256); expect(photo.original.byteLength).toBe(PNG.length);
		expect(photo.extractedMetadata.exif).toMatchObject({ artist: 'Source creator', description: 'Source caption', copyright: 'Source rights' });
	}
	expect(before.authority.roots).toHaveLength(2); expect(before.authority.row.catalogRootCount).toBe(2);
	expect(before.authority.intent).toBeNull(); expect(before.authority.stagingLeases).toBe(0);
	expect(before.actualSha256).toBe(SHA256); expect(before.bytes).toEqual(Array.from(PNG));
	return { app, copy, ids, before, requests, errors };
}
async function observer(page, method, ...args) {
	return page.evaluate(async ({ method, args, root }) => (await import(new URL(root, location.href).href))[method](...args), { method, args, root: ROOT });
}
async function observe(page, ids) { return observer(page, 'observeOriginalRecoveryLibraryV1', ids); }
function recoveryDialog(page, copy) { return page.getByRole('dialog', { name: copy.photoOriginalRecoveryTitle, exact: true }); }
async function openRecovery(page, app, copy) {
	await action(page, app, copy.photoFileMenu, copy.photoOriginalRecoveryTitle);
	const dialog = recoveryDialog(page, copy); await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('button', { name: copy.photoOriginalInspect, exact: true })).toBeEnabled(); return dialog;
}
async function chooseTarget(_page, dialog, name) { await dialog.getByRole('radio', { name: new RegExp(escape(name), 'u') }).check(); }
async function chooseFile(page, dialog, bytes, name) {
	const chooserPending = page.waitForEvent('filechooser'); await dialog.locator('[data-original-file]').click();
	const chooser = await chooserPending; await chooser.setFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
	await expect(dialog.locator('[data-original-file]')).toHaveValue('');
	await expect(dialog.locator('[data-original-selected-file]')).toHaveText(name);
}
async function settled(app, dialog, copy) {
	await expect(app.locator('[data-photo-library]')).toHaveAttribute('aria-busy', 'false');
	await expect(app.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '2');
	await expect(dialog.getByRole('button', { name: copy.photoOriginalInspect, exact: true })).toBeEnabled();
}
async function verified(dialog, copy, count) {
	await expect(dialog.locator('[data-original-row]')).toHaveCount(count);
	for (const row of await dialog.locator('[data-original-row]').all()) {
		await expect(row).toContainText(copy.photoOriginalVerified); await expect(row.getByRole('radio')).toBeDisabled();
	}
}
function assertDocumentsAndSource(current, previous) {
	expect(current.root).toEqual(previous.root); expect(current.photos).toEqual(previous.photos);
	expect(current.bytes).toEqual(Array.from(PNG)); expect(current.actualSha256).toBe(SHA256);
	expect(current.authority.row).toMatchObject({ sourceId: previous.authority.row.sourceId, sha256: SHA256, size: PNG.length,
		mediaContentDigestVersion: previous.authority.row.mediaContentDigestVersion,
		mediaContentToken: previous.authority.row.mediaContentToken, catalogRootCount: 2 });
	expect(current.authority.roots).toHaveLength(2); expect(current.authority.stagingLeases).toBe(0);
}
function assertRestored(current, previous) {
	assertDocumentsAndSource(current, previous);
	expect(current.authority.roots).toEqual(previous.authority.roots); expect(current.authority.intent).toBeNull();
}
function assertClean({ errors, requests }) {
	expect(errors).toEqual([]); expect(requests.filter(url => /\/assets\/editor-copy-/u.test(url))).toEqual([]);
}
async function reopenLibrary(page, app, copy) {
	await page.reload(); await expect(app).toBeVisible(); await action(page, app, copy.photoViewMenu, copy.photoShowLibrary);
	await expect(app.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '2');
	await expect(app.locator('[data-photo-library]')).toHaveAttribute('aria-busy', 'false');
}
async function keyboard(page, locator) { await expect(locator).toBeEnabled(); await locator.focus(); await expect(locator).toBeFocused(); await page.keyboard.press('Enter'); }
function escape(text) { return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
async function action(page, app, menu, name) {
	await keyboard(page, app.locator('nav > details > summary').filter({ hasText: new RegExp(`^${escape(menu)}$`, 'u') }));
	await keyboard(page, app.getByRole('button', { name, exact: true }));
}
