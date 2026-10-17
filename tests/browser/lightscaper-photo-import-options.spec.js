/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });

// Existing backend witness's tiny native PNG/eXIf source. Only actual menu
// actions publish photos/presets/keywords; the routed helper is read-only.
// Budget: three selected files, two photos, one keyword/preset, <=1KiB/source.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAALZlWElmSUkqAAgAAAAGAA4BAgAPAAAAaAAAAA8BAgAOAAAAdwAAABIBAwABAAAAAQAAADsBAgAPAAAAhQAAAJiCAgAOAAAAlAAAAGmHBAABAAAAVgAAAAAAAAABAAOQAgAUAAAAogAAAAAAAABTb3VyY2UgY2FwdGlvbgBOYXRpdmUgY2FtZXJhAFNvdXJjZSBjcmVhdG9yAFNvdXJjZSByaWdodHMAMjAyNjoxMDowOCAxMToxMjoxMwDS1J8kAAAADElEQVQI12NgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC', 'base64');
const SHA256 = createHash('sha256').update(PNG).digest('hex');
const SOURCE_NAME = '原本 é ÉTÉ.PNG', TITLE = '撮影 é title', PRESET_NAME = '撮影 import preset';
const ROOT = '/__photo_import_options_observer.js';

for (const locale of ['en', 'de']) {
	test(`${locale}: File import options retain refused drafts, explicitly load named presets and preserve source facts across reopen`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Full WebKit catalog Blob/OPFS custody qualification remains deferred.');
		test.setTimeout(120_000);
		const errors = []; page.on('pageerror', error => { errors.push(error.message); });
		const { app, copy } = await setup(page, locale);
		await expect(page.getByRole('dialog')).toHaveCount(0); await expect(app.locator('[data-photo-library]')).toHaveCount(0);
		await fileAction(copy.photoOrganizerTitle);
		const organizer = page.getByRole('dialog', { name: copy.photoOrganizerTitle, exact: true });
		await organizer.locator('select[name=organizerKind]').selectOption('keyword');
		await keyboard(organizer.locator('[data-organizer-create]'));
		await organizer.locator('input[name=definitionName]').fill('撮影 keyword');
		await keyboard(organizer.locator('form button[type=submit]'));
		await expect(organizer.locator('[data-organizer-selected]')).toContainText('撮影 keyword');
		await keyboard(organizer.locator('form').getByRole('button', { name: copy.photoCloseMetadata, exact: true }));
		const keyword = (await observe(page)).root.keywords.find(row => row.name === '撮影 keyword'); expect(keyword).toBeDefined();

		let dialog = await importer();
		await expect(dialog.locator('[data-import-preset-controls]')).toHaveCount(0);
		await expect(dialog.locator('[data-import-keyword-options]')).toHaveCount(0);
		await dialog.locator('input[type=file]').setInputFiles([
			{ name: SOURCE_NAME, mimeType: 'image/png', buffer: PNG },
			{ name: 'Broken.PNG', mimeType: 'image/png', buffer: Buffer.from('Invalid photo') },
			{ name: SOURCE_NAME, mimeType: 'image/png', buffer: PNG },
		]);
		await keyboard(dialog.locator('[data-photo-import-options] > summary'));
		await expect(dialog.locator('[data-import-preset]')).toBeEnabled();
		await dialog.locator('[data-import-rename]').check();
		await dialog.locator('[data-import-template]').fill('{stem}-撮影-{sequence}.{extension}');
		await dialog.locator('[data-import-sequence-start]').fill('7'); await dialog.locator('[data-import-sequence-padding]').fill('4');
		await dialog.locator('[data-import-override="title"]').check(); await dialog.locator('[data-import-metadata="title"]').fill(TITLE);
		await dialog.locator('[data-import-override="creator"]').check(); await expect(dialog.locator('[data-import-metadata="creator"]')).toHaveValue('');
		await keyboard(dialog.locator(`[data-definition-choose="${keyword.id}"]`));
		await keyboard(dialog.locator('[data-import-keyword-add]'));
		await expect(dialog.locator(`[data-membership-name="${keyword.id}"]`)).toHaveText(keyword.name);
		await dialog.locator('[data-import-preset-name]').fill(PRESET_NAME); await keyboard(dialog.locator('[data-import-preset-save]'));
		await expect(dialog.locator('[data-import-preset-save]')).toBeEnabled();
		const presetId = await dialog.locator('[data-import-preset]').inputValue(); expect(presetId).not.toBe('');
		await dialog.locator('[data-import-metadata="title"]').fill('Working draft');
		await dialog.locator('[data-import-preset]').selectOption(''); await dialog.locator('[data-import-preset]').selectOption(presetId);
		await expect(dialog.locator('[data-import-metadata="title"]')).toHaveValue('Working draft');
		await keyboard(dialog.locator('[data-import-preset-load]')); await expect(dialog.locator('[data-import-metadata="title"]')).toHaveValue(TITLE);

		await dialog.locator('[data-import-template]').fill('{unsupported}'); await keyboard(dialog.locator('button[type=submit]'));
		await expect(dialog).toBeVisible(); await expect(dialog.getByRole('alert')).toHaveCount(1);
		await expect(dialog.locator('[data-import-template]')).toHaveValue('{unsupported}');
		expect(await dialog.locator('input[type=file]').evaluate(input => Array.from(input.files, file => file.name))).toEqual([SOURCE_NAME, 'Broken.PNG', SOURCE_NAME]);
		expect((await observe(page)).root.photoCount).toBe(0);
		await dialog.locator('[data-import-template]').fill('{stem}-撮影-{sequence}.{extension}');
		await keyboard(dialog.locator('button[type=submit]')); await expect(dialog).toHaveCount(0);
		const library = app.locator('[data-photo-library]');
		await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '2', { timeout: 20_000 });
		await expect(library.locator('[data-photo-import-status="imported"]')).toHaveCount(2);
		await expect(library.locator('[data-photo-import-status="failed"]')).toHaveCount(1);
		for (const receipt of await library.locator('[data-photo-import-status="imported"]').allTextContents()) expect(receipt).toContain(SOURCE_NAME);
		const ids = await library.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => node.dataset.photoId));
		const before = await observe(page, ids); expect(before.photos.map(photo => photo.fileName).sort()).toEqual([
			'原本 é ÉTÉ-撮影-0007.PNG', '原本 é ÉTÉ-撮影-0009.PNG',
		]);
		expect(new Set(before.photos.map(photo => photo.originalId)).size).toBe(2); expect(new Set(before.photos.map(photo => photo.storageKey)).size).toBe(1);
		for (const photo of before.photos) {
			expect(photo.originalName).toBe(SOURCE_NAME); expect(photo.sha256).toBe(SHA256); expect(photo.byteLength).toBe(PNG.length); expect(photo.bytes).toEqual([...PNG]);
			expect(photo.metadata).toMatchObject({ title: TITLE, creator: '', caption: 'Source caption', copyright: 'Source rights', orientation: 1, cameraMake: 'Native camera' });
			expect(photo.extractedMetadata.exif).toMatchObject({ artist: 'Source creator', description: 'Source caption', copyright: 'Source rights' });
		}
		for (const photo of before.details) {
			expect(photo.keywordIds).toEqual([keyword.id]); expect(photo.versions).toHaveLength(1); expect(photo.versions[0].kind).toBe('master');
			expect(photo.activeVersionId).toBe(photo.versions[0].id); expect(photo.original.contentSha256).toBe(SHA256); expect(photo.actualSha256).toBe(SHA256);
		}

		await page.reload(); await expect(app).toBeVisible(); await expect(app.locator('[data-photo-library]')).toHaveCount(0);
		dialog = await importer(); await keyboard(dialog.locator('[data-photo-import-options] > summary'));
		await expect(dialog.locator(`[data-import-preset] option[value="${presetId}"]`)).toHaveText(PRESET_NAME);
		await dialog.locator('[data-import-preset]').selectOption(presetId);
		await expect(dialog.locator('[data-import-rename]')).not.toBeChecked(); await expect(dialog.locator('[data-import-override="title"]')).not.toBeChecked();
		await keyboard(dialog.locator('[data-import-preset-load]')); await expect(dialog.locator('[data-import-metadata="title"]')).toHaveValue(TITLE);
		await expect(dialog.locator(`[data-membership-name="${keyword.id}"]`)).toHaveText(keyword.name);
		await keyboard(dialog.locator('[data-import-preset-reload]')); await expect(dialog.locator('[data-import-preset-reload]')).toBeEnabled();
		await expect(dialog.locator('[data-import-metadata="title"]')).toHaveValue(TITLE);
		await keyboard(dialog.locator('[data-import-preset-delete]')); await expect(dialog.locator('[data-import-preset-reload]')).toBeEnabled();
		await expect(dialog.locator(`[data-import-preset] option[value="${presetId}"]`)).toHaveCount(0);
		await expect(dialog.locator('[data-import-metadata="title"]')).toHaveValue(TITLE);
		await expect(dialog.locator('[data-import-template]')).toHaveValue('{stem}-撮影-{sequence}.{extension}');
		await keyboard(dialog.locator('[data-photo-import-cancel]')); await expect(dialog).toHaveCount(0);
		await page.reload(); await expect(app).toBeVisible(); dialog = await importer();
		await keyboard(dialog.locator('[data-photo-import-options] > summary')); await expect(dialog.locator('[data-import-preset]')).toBeEnabled();
		await expect(dialog.locator('[data-import-preset] option')).toHaveCount(1);
		await keyboard(dialog.locator('[data-photo-import-cancel]')); expect(await observe(page, ids)).toEqual(before); expect(errors).toEqual([]);

		async function keyboard(locator) { await expect(locator).toBeEnabled(); await locator.focus(); await expect(locator).toBeFocused(); await page.keyboard.press('Enter'); }
		async function fileAction(name) {
			await keyboard(app.locator('nav > details > summary').filter({ hasText: new RegExp(`^${escape(copy.photoFileMenu)}$`, 'u') }));
			await keyboard(app.getByRole('button', { name, exact: true }));
		}
		async function importer() { await fileAction(copy.photoImportPhotos); const modal = page.getByRole('dialog', { name: copy.photoImportPhotos, exact: true }); await expect(modal).toBeVisible(); return modal; }
	});
}

async function setup(page, locale) {
	const source = 'export { readResidentPhotoLibraryV1 as observe } from "./tests/helpers/lightscaper-photo-library-ui-fixture.ts"; export { readPhotoCatalogOrganizationNativeV1 as details } from "./tests/helpers/lightscaper-photo-organization-native-fixture.ts"; export { bundledLightscaperEditorCopyForLocale as copyForLocale } from "./src/common/i18n/lightscaper-editor-copy.ts";';
	const bundle = await build({ stdin: { contents: source, resolveDir: fileURLToPath(new URL('../../', import.meta.url)) },
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route(`**${ROOT}`, async route => { await route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }); });
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS
		? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`);
	const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	const copy = await page.evaluate(async ({ locale, root }) => (await import(new URL(root, location.href).href)).copyForLocale(locale), { locale, root: ROOT });
	return { app, copy };
}
async function observe(page, ids = []) {
	return page.evaluate(async ({ ids, root }) => {
		if (ids.length > 4) throw new RangeError('Import menu observation exceeds four photos.');
		const api = await import(new URL(root, location.href).href), resident = await api.observe(ids), detail = await api.details(ids);
		return { ...resident, details: detail.photos };
	}, { ids, root: ROOT });
}
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
