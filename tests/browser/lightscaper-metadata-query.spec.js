/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { createPhotoMetadataQueryByteFixtureV1 } from '../helpers/lightscaper-metadata-query-byte-fixture.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';

// The routed esbuild observation helper is test-only executable code, excluded from portable coverage.
test.use({ browserCoverage: false });

const OBSERVER = '/__lightscaper_metadata_query_observation.js';
const FIXTURE = createPhotoMetadataQueryByteFixtureV1();
const sourceName = id => FIXTURE.cases.find(item => item.id === id).fileName;
const names = ids => ids.map(sourceName);
const CANON = ['complete-canon', 'exact-duplicate'];
const CAPTURED = ['complete-canon', 'complete-nikon', 'source-conflict', 'exact-duplicate'];
const ALL = FIXTURE.cases.map(item => item.id);
const canonConditions = [
	{ column: 'camera-make', operator: 'equals', value: 'Canon' },
	{ column: 'lens', operator: 'starts-with', value: 'RF' },
	{ column: 'iso', operator: 'range', minimum: '200', maximum: '200' },
];

for (const locale of ['en', 'de']) {
	test(`${locale}: native JPEG metadata queries, authored overrides and collapsed representatives preserve source facts and originals`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Full WebKit original storage qualification remains deferred.');
		test.setTimeout(240_000);
		const { app, copy, errors, requests } = await setup(page, locale);
		await expect(app.locator('[data-photo-library],canvas')).toHaveCount(0);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await menuAction(page, app, copy.photoFileMenu, copy.photoImportPhotos);
		const importer = page.getByRole('dialog', { name: copy.photoImportPhotos, exact: true });
		const selected = await page.evaluateHandle(async ({ path, fixture }) => {
			const helper = await import(new URL(path, location.href).href);
			return helper.createPhotoMetadataQuerySelectedFilesV1(fixture);
		}, { path: OBSERVER, fixture: FIXTURE });
		let sources;
		try {
			sources = await selected.evaluate(result => result.sources);
			// Genuine browser-encoded Files enter the same native FileList/change boundary as the chooser.
			await importer.getByLabel(copy.photoChooseFiles, { exact: true }).evaluate((input, selection) => {
				const transfer = new DataTransfer(); for (const file of selection.files) transfer.items.add(file);
				input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
			}, selected);
		} finally { await selected.dispose(); }
		await keyboard(page, importer.getByRole('button', { name: copy.photoImportAction, exact: true }));
		await expect(importer).toHaveCount(0);
		const library = app.locator('[data-photo-library]'), cards = library.locator('[data-photo-id]');
		await expect(cards).toHaveCount(7); await expect(library).toHaveAttribute('aria-busy', 'false');
		const rows = await cards.evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.photoId, name: node.querySelector('strong').textContent })));
		const ids = rows.map(row => row.id), idFor = caseId => rows.find(row => row.name === sourceName(caseId)).id;
		const photoButton = caseId => library.getByRole('button', { name: new RegExp(`^${escaped(sourceName(caseId))}\\s`, 'u') });
		const before = await observe(page, ids);
		assertSourceFacts(before, idFor); assertOriginals(before, sources);
		expect(before.photos.every(photo => photo.revision === 0)).toBe(true);
		expect(before.assets).toHaveLength(6); expect(before.roots).toHaveLength(7); expect(before.intent).toBeNull();
		const source = before.photos.find(photo => photo.id === idFor('complete-canon'));
		const duplicate = before.photos.find(photo => photo.id === idFor('exact-duplicate'));
		expect(duplicate.original.storageKey).toBe(source.original.storageKey);
		expect(duplicate.original.id).not.toBe(source.original.id);
		expect(before.assets.find(asset => asset.assetId === source.original.storageKey).catalogRootCount).toBe(2);

		// All three terms use effective EXIF fields and inclusive numeric endpoints.
		await query(canonConditions, CANON);
		await query([{ column: 'camera-make', operator: 'contains', value: 'Nikon' },
			{ column: 'iso', operator: 'range', minimum: '800', maximum: '800' }], ['complete-nikon']);
		await query([{ column: 'iso', operator: 'known' }], ['complete-canon', 'complete-nikon', 'exact-duplicate']);
		await query([{ column: 'iso', operator: 'unknown' }], ['source-conflict', 'partial-capture', 'oversized-camera', 'no-metadata']);
		// The oversize raw EXIF string remains immutable, but its effective camera field is unknown.
		await query([{ column: 'camera-make', operator: 'unknown' }], ['oversized-camera', 'no-metadata']);
		await query([{ column: 'creator', operator: 'known' }], ALL);
		await query([{ column: 'creator', operator: 'unknown' }], []);
		await query([{ column: 'creator', operator: 'equals', value: '' }], ALL.filter(id => id !== 'source-conflict'));
		await query([{ column: 'capture-time', operator: 'unknown' }], ['partial-capture', 'oversized-camera', 'no-metadata']);
		await query([{ column: 'capture-time', operator: 'range', from: '2026-10-07T12:34', to: '2026-10-07T12:35' }], CAPTURED);
		await query([{ column: 'capture-time', operator: 'range', from: '2026-10-07T12:34:56', to: '2026-10-07T12:34:56.125' }], ['source-conflict']);
		for (const direction of ['ascending', 'descending']) {
			await applyQuery(page, app, copy, [], { field: 'capture-time', direction });
			await expect(cards).toHaveCount(4); await expect(library).toHaveAttribute('aria-busy', 'false');
			await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '7');
			const known = await cardNames(cards);
			expect(known[direction === 'ascending' ? 0 : known.length - 1]).toBe(sourceName('source-conflict'));
			// Known clocks and the unknown bucket are separate bounded pages in both directions.
			await menuAction(page, app, copy.photoViewMenu, copy.photoNextPage);
			await expect(cards).toHaveCount(3); await expect(library).toHaveAttribute('aria-busy', 'false');
			await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '7');
			const visible = [...known, ...await cardNames(cards)];
			expect([...visible.slice(0, 4)].sort()).toEqual(names(CAPTURED).sort());
			expect([...visible.slice(4)].sort()).toEqual(names(['partial-capture', 'oversized-camera', 'no-metadata']).sort());
			await expect(app.getByRole('button', { name: copy.photoNextPage, exact: true, includeHidden: true })).toBeDisabled();
		}

		const conflictConditions = [{ column: 'camera-make', operator: 'equals', value: 'Canon' },
			{ column: 'copyright', operator: 'equals', value: 'IPTC copyright' }];
		await query(conflictConditions, ['source-conflict']);
		await photoButton('source-conflict').click(); await editCopyright('');
		await expect(cards).toHaveCount(0); await expect(library).toHaveAttribute('aria-busy', 'false');
		const overridden = await observe(page, ids); assertCustody(before, overridden, sources);
		const changed = overridden.photos.find(photo => photo.id === idFor('source-conflict'));
		expect(changed.revision).toBe(1); expect(changed.metadata.copyright).toBe('');
		await query([{ column: 'camera-make', operator: 'equals', value: 'Canon' },
			{ column: 'copyright', operator: 'equals', value: '' }], [...CANON, 'source-conflict']);
		await photoButton('source-conflict').click(); await editCopyright('IPTC copyright');
		await query(conflictConditions, ['source-conflict']);
		const restored = await observe(page, ids); assertCustody(before, restored, sources);
		for (const photo of restored.photos) {
			const previous = before.photos.find(row => row.id === photo.id);
			expect(photo.metadata).toEqual(previous.metadata);
			expect(photo.revision).toBe(photo.id === idFor('source-conflict') ? 2 : 0);
		}

		// A nonmatching Nikon cover must not hide its matching Canon member or enter the result itself.
		await query([], ALL);
		await photoButton('complete-canon').click(); await photoButton('complete-nikon').click({ modifiers: ['Control'] });
		await expect(library.locator('[data-photo-id][aria-pressed="true"]')).toHaveCount(2);
		await menuAction(page, app, copy.photoFileMenu, copy.photoStackCreate, true);
		const stack = page.getByRole('dialog', { name: copy.photoStackTitle, exact: true });
		await keyboard(page, stack.getByRole('listitem').filter({ hasText: sourceName('complete-nikon') })
			.getByRole('button', { name: copy.photoStackMakeCover, exact: true }));
		await keyboard(page, stack.getByRole('button', { name: copy.photoStackSave, exact: true }));
		await expect(stack.getByRole('status').filter({ hasText: new RegExp(`^${escaped(copy.photoStackCreated)}$`, 'u') })).toBeVisible();
		await keyboard(page, bodyClose(stack, copy.photoCloseMetadata)); await expect(stack).toHaveCount(0);
		await query(canonConditions, CANON); await menuAction(page, app, copy.photoViewMenu, copy.photoStackCollapseView);
		await assertNames(cards, names(CANON)); await expect(library).toHaveAttribute('aria-busy', 'false');
		await query([{ column: 'camera-make', operator: 'equals', value: 'Nikon' },
			{ column: 'iso', operator: 'range', minimum: '800', maximum: '800' }], ['complete-nikon']);
		await menuAction(page, app, copy.photoViewMenu, copy.photoStackExpandView);
		const grouped = await observe(page, ids); assertCustody(before, grouped, sources); expect(grouped.photos).toEqual(restored.photos);
		await page.reload(); await expect(app).toBeVisible(); await expect(app.locator('[data-photo-library],canvas')).toHaveCount(0);
		await menuAction(page, app, copy.photoViewMenu, copy.photoShowLibrary); await expect(cards).toHaveCount(7);
		await query(canonConditions, CANON); expect(await observe(page, ids)).toEqual(grouped);
		expect(errors).toEqual([]); expect(requests.filter(url => /\/assets\/editor-copy-/u.test(url))).toEqual([]);

		async function query(conditions, cases) {
			await applyQuery(page, app, copy, conditions);
			await assertNames(cards, names(cases)); await expect(library).toHaveAttribute('aria-busy', 'false');
			await expect(library.getByRole('alert')).toHaveCount(0);
		}
		async function editCopyright(value) {
			await menuAction(page, app, copy.photoFileMenu, copy.photoEditMetadata, true);
			const metadata = page.getByRole('dialog', { name: copy.photoEditMetadata, exact: true });
			await expect(metadata.getByLabel(copy.photoFileName, { exact: true })).toBeFocused();
			await metadata.getByRole('textbox', { name: copy.photoCopyright, exact: true }).fill(value);
			await keyboard(page, metadata.getByRole('button', { name: copy.photoSaveMetadata, exact: true }));
			await expect(metadata.getByRole('textbox', { name: copy.photoCopyright, exact: true })).toHaveValue(value);
			await expect(library).toHaveAttribute('aria-busy', 'false'); await expect(metadata.getByRole('alert')).toHaveCount(0);
			await keyboard(page, bodyClose(metadata, copy.photoCloseMetadata)); await expect(metadata).toHaveCount(0);
		}
	});
}

async function setup(page, locale) {
	const errors = [], requests = []; page.on('pageerror', error => { errors.push(error.message); }); page.on('request', request => { requests.push(request.url()); });
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-metadata-query-native-fixture.ts', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route(`**${OBSERVER}`, route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`);
	const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	return { app, copy: bundledLightscaperEditorCopyForLocale(locale), errors, requests };
}

async function applyQuery(page, app, copy, conditions, sort = { field: 'file-name', direction: 'ascending' }) {
	await menuAction(page, app, copy.photoViewMenu, copy.photoQueryTitle);
	const dialog = page.getByRole('dialog', { name: copy.photoQueryTitle, exact: true });
	await expect(dialog.getByLabel(copy.photoQueryText, { exact: true })).toBeFocused();
	await expect(dialog.getByRole('button', { name: copy.photoQueryApply, exact: true })).toBeEnabled();
	await dialog.getByLabel(copy.photoQueryText, { exact: true }).fill('');
	await dialog.getByRole('combobox', { name: copy.photoQueryFilter, exact: true }).selectOption('');
	await dialog.getByRole('combobox', { name: copy.photoQuerySort, exact: true }).selectOption(sort.field);
	await dialog.getByRole('combobox', { name: copy.photoQueryDirection, exact: true }).selectOption(sort.direction);
	const removes = dialog.getByRole('button', { name: copy.photoMetadataRemoveCondition, exact: true }), count = await removes.count();
	expect(count).toBeLessThanOrEqual(16); for (let index = 0; index < count; index++) await removes.first().click();
	for (let index = 0; index < conditions.length; index++) {
		const condition = conditions[index]; await keyboard(page, dialog.getByRole('button', { name: copy.photoMetadataAddCondition, exact: true }));
		const group = dialog.getByRole('group', { name: String(index + 1), exact: true });
		await group.getByRole('combobox', { name: copy.photoMetadataColumn, exact: true }).selectOption(condition.column);
		await group.getByRole('combobox', { name: copy.photoMetadataOperator, exact: true }).selectOption(condition.operator);
		if ('value' in condition) await group.getByRole('textbox', { name: copy.photoMetadataValue, exact: true }).fill(condition.value);
		if ('minimum' in condition) await group.getByRole('spinbutton', { name: copy.photoMetadataMinimum, exact: true }).fill(condition.minimum);
		if ('maximum' in condition) await group.getByRole('spinbutton', { name: copy.photoMetadataMaximum, exact: true }).fill(condition.maximum);
		if ('from' in condition) await group.getByLabel(copy.photoMetadataFrom, { exact: true }).fill(condition.from);
		if ('to' in condition) await group.getByLabel(copy.photoMetadataTo, { exact: true }).fill(condition.to);
	}
	await keyboard(page, dialog.getByRole('button', { name: copy.photoQueryApply, exact: true }));
	await expect(app.locator('[data-photo-library]')).toHaveAttribute('aria-busy', 'false');
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	await keyboard(page, bodyClose(dialog, copy.photoCloseMetadata)); await expect(dialog).toHaveCount(0);
}

async function observe(page, ids) { return page.evaluate(async ({ path, ids }) => (await import(new URL(path, location.href).href)).observePhotoMetadataQueryLibraryV1(ids), { path: OBSERVER, ids }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function menuAction(page, app, menu, action, photo = false) {
	await keyboard(page, app.locator('nav > details > summary').filter({ hasText: new RegExp(`^${escaped(menu)}$`, 'u') }));
	if (photo) await keyboard(page, app.locator('.lightscaper-photo-submenu > summary'));
	await keyboard(page, app.getByRole('button', { name: action, exact: true }));
}
function bodyClose(dialog, name) { return dialog.getByRole('button', { name, exact: true }).filter({ hasText: new RegExp(`^${escaped(name)}$`, 'u') }); }
async function cardNames(cards) { return cards.evaluateAll(nodes => nodes.map(node => node.querySelector('strong').textContent)); }
async function assertNames(cards, expected) { await expect.poll(async () => cardNames(cards)).toEqual([...expected].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1)); }
function escaped(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }

function assertSourceFacts(observation, idFor) {
	const photo = id => observation.photos.find(row => row.id === idFor(id));
	expect(photo('complete-canon').metadata).toMatchObject({ cameraMake: 'Canon', cameraModel: 'EOS R5', lens: 'RF 24-70mm F2.8',
		iso: 200, exposureSeconds: 1 / 125, aperture: 2.8, focalLengthMm: 50, captureTime: { local: '2026-10-07T12:34:56.125', offsetMinutes: 120 } });
	expect(photo('complete-nikon').metadata).toMatchObject({ cameraMake: 'Nikon', cameraModel: 'Z8', lens: 'NIKKOR Z 85mm F1.8',
		iso: 800, captureTime: { local: '2026-10-07T12:34:56.125', offsetMinutes: -270 } });
	expect(photo('source-conflict').metadata).toMatchObject({ title: 'IPTC title', caption: 'IPTC caption', creator: 'IPTC Alice; IPTC Bob',
		copyright: 'IPTC copyright', location: 'Englischer Garten, München, Germany', captureTime: { local: '2026-10-07T12:34:56.000', offsetMinutes: 120 } });
	expect(photo('source-conflict').extractedMetadata.exif).toMatchObject({ artist: 'Exif creator', description: 'Exif caption', copyright: 'Exif copyright' });
	expect(photo('source-conflict').extractedMetadata.iptc).toMatchObject({ creators: ['IPTC Alice', 'IPTC Bob'],
		keywords: ['Landscape', 'Portrait', 'Landscape'], captureDate: '20241007', captureTime: '010203-0430' });
	expect(photo('partial-capture').metadata.captureTime).toBeNull();
	expect(photo('partial-capture').extractedMetadata.exif.captureTimeRaw).toEqual({ dateTimeOriginal: '    :02:29 13:14:15', offsetTimeOriginal: '   :  ', subsecondOriginal: '123456' });
	expect(photo('oversized-camera').metadata).toMatchObject({ cameraMake: null, cameraModel: 'Valid model', lens: 'Valid lens' });
	expect(photo('oversized-camera').extractedMetadata.exif.cameraMake).toBe('A'.repeat(1025));
	expect(photo('no-metadata').metadata).toMatchObject({ cameraMake: null, iso: null, captureTime: null, title: '', creator: '', copyright: '' });
	expect(photo('no-metadata').extractedMetadata).toMatchObject({ exif: null, iptc: null, issues: [] });
}
function assertOriginals(observation, sources) {
	expect(observation.photoCount).toBe(7); expect(observation.intent).toBeNull();
	for (const photo of observation.photos) {
		const source = sources.find(item => item.fileName === photo.original.name);
		expect(photo.original).toMatchObject({ mimeType: 'image/jpeg', byteLength: source.byteLength, sha256: source.sha256 });
		expect(photo.actualBytes).toEqual(source.bytes); expect(photo.actualSha256).toBe(source.sha256);
		const root = observation.roots.find(item => item.photoId === photo.id), asset = observation.assets.find(item => item.assetId === photo.original.storageKey);
		expect(root).toMatchObject({ catalogId: observation.catalogId, importId: null, photoId: photo.id, sourceId: photo.original.id,
			assetId: photo.original.storageKey, sha256: source.sha256, size: source.byteLength, mediaContentToken: asset.mediaContentToken });
		expect(asset).toMatchObject({ sha256: source.sha256, size: source.byteLength,
			catalogRootCount: observation.photos.filter(item => item.original.storageKey === asset.assetId).length });
	}
}
function assertCustody(before, after, sources) {
	expect(after.catalogId).toBe(before.catalogId); expect(after.roots).toEqual(before.roots); expect(after.assets).toEqual(before.assets);
	for (const previous of before.photos) {
		const current = after.photos.find(row => row.id === previous.id);
		for (const key of ['original', 'extractedMetadata', 'actualBytes', 'actualSha256']) expect(current[key]).toEqual(previous[key]);
	}
	assertOriginals(after, sources);
}
