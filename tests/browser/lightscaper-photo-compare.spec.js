/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { build } from 'esbuild';
import { expect, test } from './helpers/browser-coverage-fixture.js';

// Observation is bundled from source; all authoring and pixels use the built App.
test.use({ browserCoverage: false });
const OBSERVER = '/__lightscaper_compare_observation.js';
const WIDTH = 2, HEIGHT = 3;
const PIXELS = [
	[255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0, 255, 0, 0, 128, 255, 255, 255, 255],
	[0, 255, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 128, 255, 255, 0, 255],
	[0, 0, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0, 0, 0, 255, 128, 255, 0, 255, 255],
	[255, 255, 0, 255, 255, 0, 255, 255, 0, 255, 255, 255, 0, 0, 0, 0, 255, 0, 0, 128, 17, 31, 47, 255],
];
const SOURCES = PIXELS.map((pixels, index) => ({ name: `Compare-${index + 1}.png`, pixels, png: encodePng(pixels) }));

for (const locale of ['en', 'de']) {
	test(`${locale}: menu Compare qualifies real paired pixels, selected-subset culling and eviction regeneration`, async ({ page, browserName }) => {
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
		await expect(app.locator('canvas')).toHaveCount(0); await expect(page.getByRole('dialog', { name: copy.photoCompareTitle ?? 'Compare photos', exact: true })).toHaveCount(0);
		await menu(copy.photoFileMenu, copy.photoImportPhotos);
		const importer = page.getByRole('dialog', { name: copy.photoImportPhotos, exact: true });
		await importer.getByLabel(copy.photoChooseFiles).setInputFiles(SOURCES.map(source => ({ name: source.name, mimeType: 'image/png', buffer: source.png })));
		await keyboard(importer.getByRole('button', { name: copy.photoImportAction, exact: true }));
		const library = app.locator('[data-photo-library]'), cards = library.locator('[data-photo-id]');
		await expect(cards).toHaveCount(4); await expect(library).toHaveAttribute('aria-busy', 'false');
		const visible = await cards.evaluateAll(elements => elements.map(element => ({ id: element.dataset.photoId, name: element.querySelector('strong').textContent })));
		const ids = visible.map(row => row.id), selected = [visible[0], visible[1], visible[3]];
		const before = await observe(page, 'observeCompareLibraryV1', ids);
		assertOriginals(before);
		await keyboard(cards.nth(0)); await cards.nth(1).focus(); await page.keyboard.press('Control+Space');
		await cards.nth(3).focus(); await page.keyboard.press('Control+Space');
		await expect(library.locator('[aria-pressed="true"]')).toHaveCount(3);
		await menu(copy.photoViewMenu, copy.photoShowThumbnails); await expect(app.locator('canvas')).toHaveCount(4);
		for (const canvas of await cards.locator('canvas').all()) await expect(canvas).toHaveAttribute('width', '2');
		await menu(copy.photoViewMenu, copy.photoCompareTitle ?? (locale === 'de' ? 'Fotos vergleichen' : 'Compare photos'));
		const dialog = page.getByRole('dialog', { name: copy.photoCompareTitle, exact: true }); await expect(dialog).toBeVisible();
		const candidate = dialog.getByRole('group', { name: `${copy.photoCompareCandidate}: ${selected[1].name}`, exact: true });
		await expect(candidate).toBeFocused();
		const firstHashes = await pair(selected[0], selected[1]);
		await candidate.press('ArrowRight'); await pair(selected[0], selected[2]);
		await dialog.getByRole('group', { name: `${copy.photoCompareCandidate}: ${selected[2].name}`, exact: true }).press('ArrowLeft');
		await pair(selected[0], selected[1]);
		await candidate.press('s'); await pair(selected[1], selected[0]);
		await dialog.getByRole('group', { name: `${copy.photoCompareCandidate}: ${selected[0].name}`, exact: true }).press('Enter');
		await pair(selected[0], selected[1]);
		await candidate.press('5'); await expect(candidate.getByLabel(copy.photoRating, { exact: true })).toHaveValue('5');
		await expect(candidate.getByLabel(copy.photoRating, { exact: true })).toBeEnabled();
		await pair(selected[0], selected[1]);
		await candidate.press('p'); await expect(candidate.getByLabel(copy.photoFlag, { exact: true })).toHaveValue('pick');
		await expect(candidate.getByLabel(copy.photoFlag, { exact: true })).toBeEnabled();
		await pair(selected[0], selected[1]);
		await candidate.getByLabel(copy.photoColorLabel, { exact: true }).selectOption('blue');
		await expect(candidate.getByLabel(copy.photoColorLabel, { exact: true })).toHaveValue('blue');
		await expect(candidate.getByLabel(copy.photoColorLabel, { exact: true })).toBeEnabled();
		await pair(selected[0], selected[1]);
		const after = await observe(page, 'observeCompareLibraryV1', ids);
		assertImmutable(before, after);
		const edited = after.photos.find(photo => photo.id === selected[1].id);
		expect(edited).toMatchObject({ rating: 5, flag: 'pick', colorLabel: 'blue', revision: 3 });
		for (const photo of after.photos.filter(photo => photo.id !== selected[1].id)) expect(photo).toMatchObject({ rating: 0, flag: 'unflagged', colorLabel: 'none', revision: 0 });
		const oldCanvases = await dialog.locator('canvas').elementHandles(); await candidate.press('Escape');
		await expect(dialog).toHaveCount(0); await expect(app.locator('canvas')).toHaveCount(4);
		for (const old of oldCanvases) expect(await old.evaluate(canvas => [canvas.width, canvas.height])).toEqual([0, 0]);
		await expect(library.locator('[aria-pressed="true"]')).toHaveCount(3);
		expect(await library.locator('[aria-pressed="true"]').evaluateAll(elements => elements.map(element => element.dataset.photoId))).toEqual(selected.map(row => row.id));
		await menu(copy.photoViewMenu, copy.photoHideThumbnails); await expect(app.locator('canvas')).toHaveCount(0);
		const eviction = await observe(page, 'evictComparePreviewsV1'); expect(eviction.removedEntries).toBeGreaterThanOrEqual(4); expect(eviction.removedBytes).toBeGreaterThan(0);
		const emptyCache = await observe(page, 'observeCompareLibraryV1', ids); expect(emptyCache.previews).toEqual([]); assertImmutable(after, emptyCache);
		await menu(copy.photoViewMenu, copy.photoCompareTitle); await expect(dialog).toBeVisible();
		expect(await pair(selected[0], selected[1])).toEqual(firstHashes);
		const regenerated = await observe(page, 'observeCompareLibraryV1', ids); expect(regenerated.previews).toHaveLength(2); assertImmutable(after, regenerated);
		await dialog.getByRole('group', { name: `${copy.photoCompareCandidate}: ${selected[1].name}`, exact: true }).press('Escape');
		await expect(dialog).toHaveCount(0); await expect(app.locator('canvas')).toHaveCount(0);
		await page.reload(); await expect(app).toBeVisible(); await expect(app.locator('[data-photo-library],canvas')).toHaveCount(0);
		await menu(copy.photoViewMenu, copy.photoShowLibrary); await expect(cards).toHaveCount(4);
		const reopened = await observe(page, 'observeCompareLibraryV1', ids); assertImmutable(after, reopened); expect(reopened.photos).toEqual(regenerated.photos);
		expect(errors).toEqual([]);

		async function keyboard(target) { await expect(target).toBeEnabled(); await target.focus(); await target.press('Enter'); }
		async function menu(name, action) {
			const summary = app.locator('summary').filter({ hasText: name }); await summary.focus(); await summary.press('Enter');
			await keyboard(app.getByRole('button', { name: action, exact: true }));
		}
		async function pair(reference, next) {
			await expect(app.locator('canvas')).toHaveCount(2); await expect(dialog.locator('canvas')).toHaveCount(2);
			const hashes = [];
			for (const [label, row] of [[copy.photoCompareReference, reference], [copy.photoCompareCandidate, next]]) {
				const group = dialog.getByRole('group', { name: `${label}: ${row.name}`, exact: true }), canvas = group.getByRole('img');
				await expect(canvas).toHaveAttribute('width', '2'); await expect(canvas).toHaveAttribute('height', '3'); await expect(canvas).toHaveAttribute('aria-busy', 'false');
				const bytes = await canvas.evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data));
				const source = SOURCES.find(source => source.name === row.name); expect(bytes).toEqual(source.pixels);
				const hash = createHash('sha256').update(Buffer.from(bytes)).digest('hex'); expect(hash).toBe(createHash('sha256').update(Buffer.from(source.pixels)).digest('hex')); hashes.push(hash);
			}
			expect(hashes[0]).not.toBe(hashes[1]); return hashes;
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
