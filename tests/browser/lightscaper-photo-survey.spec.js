/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { build } from 'esbuild';
import { expect, test } from './helpers/browser-coverage-fixture.js';

// Authoring and pixels use the built App; the bundled shared fixture only observes storage and evicts previews.
test.use({ browserCoverage: false });
const OBSERVER = '/__lightscaper_survey_observation.js';
const WIDTH = 2, HEIGHT = 3;
const PIXELS = [
	[255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0, 255, 0, 0, 128, 255, 255, 255, 255],
	[0, 255, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 128, 255, 255, 0, 255],
	[0, 0, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0, 0, 0, 255, 128, 255, 0, 255, 255],
	[255, 255, 0, 255, 255, 0, 255, 255, 0, 255, 255, 255, 0, 0, 0, 0, 255, 0, 0, 128, 17, 31, 47, 255],
];
const SOURCES = PIXELS.map((pixels, index) => ({ name: `Survey-${index + 1}.png`, pixels, png: encodePng(pixels) }));

for (const locale of ['en', 'de']) {
	test(`${locale}: menu Survey qualifies real mosaic pixels, temporary removal and durable culling without original mutation`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Full WebKit original-storage workflows remain deferred; this qualifies Chromium and Firefox.');
		test.setTimeout(120_000);
		const errors = []; page.on('pageerror', error => { errors.push(error.message); });
		const bundle = await build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-compare-native-fixture.tsx', import.meta.url))],
			bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
		await page.route(`**${OBSERVER}`, route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
		const origin = JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper;
		await page.goto(`${origin}/${locale}/`);
		const copy = await observe(page, 'compareCopyForLocaleV1', locale);
		const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
		await expect(app.locator('canvas')).toHaveCount(0); await expect(page.getByRole('dialog', { name: copy.photoSurveyTitle, exact: true })).toHaveCount(0);
		await menu(copy.photoFileMenu, copy.photoImportPhotos);
		const importer = page.getByRole('dialog', { name: copy.photoImportPhotos, exact: true });
		await importer.getByLabel(copy.photoChooseFiles).setInputFiles(SOURCES.map(source => ({ name: source.name, mimeType: 'image/png', buffer: source.png })));
		await keyboard(importer.getByRole('button', { name: copy.photoImportAction, exact: true }));
		const library = app.locator('[data-photo-library]'), cards = library.locator('[data-photo-id]');
		await expect(cards).toHaveCount(4); await expect(library).toHaveAttribute('aria-busy', 'false');
		const visible = await cards.evaluateAll(elements => elements.map(element => ({ id: element.dataset.photoId, name: element.querySelector('strong').textContent })));
		const ids = visible.map(row => row.id), selected = [visible[0], visible[1], visible[3]];
		const before = await observe(page, 'observeCompareLibraryV1', ids); assertOriginals(before);
		await keyboard(cards.nth(0)); await cards.nth(1).focus(); await page.keyboard.press('Control+Space');
		await cards.nth(3).focus(); await page.keyboard.press('Control+Space'); await expect(library.locator('[aria-pressed="true"]')).toHaveCount(3);
		await menu(copy.photoViewMenu, copy.photoShowThumbnails); await expect(app.locator('canvas')).toHaveCount(4);
		for (const canvas of await cards.locator('canvas').all()) await expect(canvas).toHaveAttribute('width', '2');
		const ordinaryCanvases = await cards.locator('canvas').elementHandles();
		await menu(copy.photoViewMenu, copy.photoSurveyTitle);
		const dialog = page.getByRole('dialog', { name: copy.photoSurveyTitle, exact: true }); await expect(dialog).toBeVisible();
		await expect(focusedTile(selected[0])).toBeFocused(); await mosaic(selected, selected[0]);
		for (const old of ordinaryCanvases) expect(await old.evaluate(canvas => [canvas.width, canvas.height])).toEqual([0, 0]);
		await focusedTile(selected[0]).press('ArrowRight'); await mosaic(selected, selected[1]); await expect(focusedTile(selected[1])).toBeFocused();
		await focusedTile(selected[1]).press('ArrowLeft'); await mosaic(selected, selected[0]);
		await focusedTile(selected[0]).press('ArrowRight'); await mosaic(selected, selected[1]);
		await focusedTile(selected[1]).press('5'); await expect(control(copy.photoRating)).toHaveValue('5'); await expect(control(copy.photoRating)).toBeEnabled(); await mosaic(selected, selected[1]);
		await focusedTile(selected[1]).press('p'); await expect(control(copy.photoFlag)).toHaveValue('pick'); await expect(control(copy.photoFlag)).toBeEnabled(); await mosaic(selected, selected[1]);
		await control(copy.photoColorLabel).selectOption('blue'); await expect(control(copy.photoColorLabel)).toHaveValue('blue'); await expect(control(copy.photoColorLabel)).toBeEnabled(); await mosaic(selected, selected[1]);
		const after = await observe(page, 'observeCompareLibraryV1', ids); assertImmutable(before, after);
		expect(after.photos.find(photo => photo.id === selected[1].id)).toMatchObject({ rating: 5, flag: 'pick', colorLabel: 'blue', revision: 3 });
		for (const photo of after.photos.filter(photo => photo.id !== selected[1].id)) expect(photo).toMatchObject({ rating: 0, flag: 'unflagged', colorLabel: 'none', revision: 0 });
		await focusedTile(selected[1]).press('Delete'); await mosaic([selected[0], selected[2]], selected[2]);
		expect((await observe(page, 'observeCompareLibraryV1', ids)).photos).toEqual(after.photos);
		await focusedTile(selected[2]).press('Delete'); await mosaic([selected[0]], selected[0]);
		await expect(dialog).toBeVisible(); await focusedTile(selected[0]).press('Delete'); await mosaic([], null);
		await expect(dialog).toBeVisible(); await expect(dialog.getByText(copy.photoSurveyEmpty, { exact: true })).toBeVisible();
		const removed = await observe(page, 'observeCompareLibraryV1', ids); assertImmutable(after, removed); expect(removed.photos).toEqual(after.photos);
		await keyboard(dialog.getByRole('button', { name: copy.photoSurveyRestore, exact: true }));
		const restoredHashes = await mosaic(selected, selected[0]);
		expect((await observe(page, 'observeCompareLibraryV1', ids)).photos).toEqual(after.photos);
		const oldSurveyCanvases = await dialog.locator('canvas').elementHandles(); await focusedTile(selected[0]).press('Escape');
		await expect(dialog).toHaveCount(0); await expect(app.locator('canvas')).toHaveCount(4);
		for (const old of oldSurveyCanvases) expect(await old.evaluate(canvas => [canvas.width, canvas.height])).toEqual([0, 0]);
		expect(await library.locator('[aria-pressed="true"]').evaluateAll(elements => elements.map(element => element.dataset.photoId))).toEqual(selected.map(row => row.id));
		await menu(copy.photoViewMenu, copy.photoHideThumbnails); await expect(app.locator('canvas')).toHaveCount(0);
		const eviction = await observe(page, 'evictComparePreviewsV1'); expect(eviction.removedEntries).toBeGreaterThanOrEqual(4); expect(eviction.removedBytes).toBeGreaterThan(0);
		const empty = await observe(page, 'observeCompareLibraryV1', ids); expect(empty.previews).toEqual([]); assertImmutable(after, empty);
		await menu(copy.photoViewMenu, copy.photoSurveyTitle); await expect(dialog).toBeVisible();
		expect(await mosaic(selected, selected[0])).toEqual(restoredHashes);
		const regenerated = await observe(page, 'observeCompareLibraryV1', ids); expect(regenerated.previews).toHaveLength(3); assertImmutable(after, regenerated);
		await focusedTile(selected[0]).press('Escape'); await expect(dialog).toHaveCount(0); await expect(app.locator('canvas')).toHaveCount(0);
		await page.reload(); await expect(app).toBeVisible(); await expect(app.locator('[data-photo-library],canvas')).toHaveCount(0);
		await menu(copy.photoViewMenu, copy.photoShowLibrary); await expect(cards).toHaveCount(4);
		const reopened = await observe(page, 'observeCompareLibraryV1', ids); assertImmutable(after, reopened); expect(reopened.photos).toEqual(after.photos);
		expect(errors).toEqual([]);

		function focusedTile(row) { return dialog.getByRole('group', { name: `${copy.photoSurveyFocused}: ${row.name}`, exact: true }); }
		function control(name) { return focusedTile(selected[1]).getByRole('combobox', { name, exact: true }); }
		async function keyboard(target) { await expect(target).toBeEnabled(); await target.focus(); await target.press('Enter'); }
		async function menu(name, action) {
			const summary = app.locator('summary').filter({ hasText: name }); await summary.focus(); await summary.press('Enter');
			await keyboard(app.getByRole('button', { name: action, exact: true }));
		}
		async function mosaic(rows, focused) {
			await expect(app.locator('canvas')).toHaveCount(rows.length); await expect(dialog.getByRole('group')).toHaveCount(rows.length);
			const labels = rows.map(row => `${row.id === focused?.id ? copy.photoSurveyFocused : copy.photoSurveyPhoto}: ${row.name}`);
			expect(await dialog.getByRole('group').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).toEqual(labels);
			const hashes = [];
			for (const [index, row] of rows.entries()) {
				const surface = dialog.getByRole('group', { name: labels[index], exact: true }).getByRole('img');
				await expect(surface).toHaveAttribute('class', row.id === focused?.id ? /lightscaper-preview-fit-screen/u : /lightscaper-preview-thumbnail/u);
				await expect(surface).toHaveAttribute('width', '2'); await expect(surface).toHaveAttribute('height', '3'); await expect(surface).toHaveAttribute('aria-busy', 'false');
				const bytes = await surface.evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data));
				const source = SOURCES.find(source => source.name === row.name); expect(bytes).toEqual(source.pixels);
				const hash = createHash('sha256').update(Buffer.from(bytes)).digest('hex'); expect(hash).toBe(createHash('sha256').update(Buffer.from(source.pixels)).digest('hex')); hashes.push(hash);
			}
			expect(new Set(hashes).size).toBe(rows.length); return hashes;
		}
	});
}

async function observe(page, method, argument) {
	return page.evaluate(async ({ method, argument, path }) => {
		const fixture = await import(new URL(path, location.href).href); return fixture[method](argument);
	}, { method, argument, path: OBSERVER });
}
function assertOriginals(observation) {
	for (const photo of observation.photos) {
		const source = SOURCES.find(source => source.name === photo.fileName), digest = createHash('sha256').update(source.png).digest('hex');
		expect(photo.bytes).toEqual(Array.from(source.png)); expect(photo.actualSha256).toBe(digest); expect(photo.original.contentSha256).toBe(digest);
		expect(photo.authority.catalogRootCount).toBe(1); expect(photo.authority.roots).toHaveLength(1); expect(photo.authority.roots[0].importId).toBeNull();
		expect(photo.authority.roots[0].mediaContentToken).toBe(photo.authority.mediaContentToken);
	}
}
function assertImmutable(before, after) {
	expect(after.catalogId).toBe(before.catalogId); expect(after.rootRevision).toBe(before.rootRevision); expect(after.totalCount).toBe(4);
	for (const photo of before.photos) {
		const current = after.photos.find(candidate => candidate.id === photo.id);
		for (const key of ['original', 'authority', 'bytes', 'actualSha256']) expect(current[key]).toEqual(photo[key]);
	}
	assertOriginals(after);
}
function encodePng(pixels) {
	const header = Buffer.alloc(13); header.writeUInt32BE(WIDTH, 0); header.writeUInt32BE(HEIGHT, 4); header[8] = 8; header[9] = 6;
	const scanlines = Buffer.alloc(HEIGHT * (WIDTH * 4 + 1));
	for (let row = 0; row < HEIGHT; row++) Buffer.from(pixels.slice(row * WIDTH * 4, (row + 1) * WIDTH * 4)).copy(scanlines, row * (WIDTH * 4 + 1) + 1);
	const chunk = (name, body) => {
		const type = Buffer.from(name), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(body.length); crc.writeUInt32BE(crc32(Buffer.concat([type, body])));
		return Buffer.concat([length, type, body, crc]);
	};
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}
