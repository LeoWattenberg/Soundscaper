/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { importPhotoCatalogArchiveV5 } from '../../src/lightscaper/archive/catalog-archive-import-v5.ts';
import { normalizePhotoCatalogArchiveV5 } from '../../src/lightscaper/archive/catalog-archive-contract-v5.ts';
import { readScapeArchiveEnvelope } from '../../src/common/editor/scape-archive-envelope.ts';
import { withScapeArchiveReader } from '../../src/common/editor/scape-archive-reader.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { installNativeOpfsWorkerCompanion, assertNativeOpfsWorkerExecution } from './helpers/native-opfs-worker-companion.ts';

test.use({ browserCoverage: false });
const OBSERVER = '/__lightscaper_stack_observation.js';
const SOURCES = Array.from({ length: 4 }, (_, index) => ({ name: `Stack-${index + 1}.png`, bytes: createPngFixture(index + 1) }));

for (const locale of ['en', 'de']) {
	test(`${locale}: menus create, reorder, cover, collapse, cull and dissolve a durable stack with authenticated archive5 backup`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Full WebKit original storage qualification remains deferred.');
		test.setTimeout(180_000);
		await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		const { app, copy, errors, requests } = await setup(page, locale);
		await expect(app.locator('[data-photo-library],canvas')).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0);
		await action(page, app, copy.photoFileMenu, copy.photoImportPhotos);
		const importer = page.getByRole('dialog', { name: copy.photoImportPhotos, exact: true });
		await importer.getByLabel(copy.photoChooseFiles).setInputFiles(SOURCES.map(source => ({ name: source.name, mimeType: 'image/png', buffer: source.bytes })));
		await keyboard(page, importer.getByRole('button', { name: copy.photoImportAction, exact: true }));
		await expect(importer).toHaveCount(0);
		const library = app.locator('[data-photo-library]'), cards = library.locator('[data-photo-id]');
		await expect(cards).toHaveCount(4); await expect(library).toHaveAttribute('aria-busy', 'false');
		const rows = await cards.evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.photoId, name: node.querySelector('strong').textContent })));
		const ids = rows.map(row => row.id), selected = ids.slice(0, 3), before = await observe(page, ids);
		const photoButton = id => library.getByRole('button', { name: new RegExp(`^${escaped(rows.find(row => row.id === id).name)}\\s`, 'u') });
		assertOriginals(before); expect(before.stacks).toEqual([]); expect(before.photos.every(item => item.photo.revision === 0)).toBe(true);
		await keyboard(page, photoButton(selected[0]));
		for (const id of selected.slice(1)) { const card = photoButton(id); await card.focus(); await expect(card).toBeFocused(); await page.keyboard.press('Control+Space'); }
		await expect(library.locator('[data-photo-id][aria-pressed="true"]')).toHaveCount(3);
		await action(page, app, copy.photoFileMenu, copy.photoStackCreate, true);
		const dialog = page.getByRole('dialog', { name: copy.photoStackTitle, exact: true });
		const stackButton = name => dialog.getByRole('button', { name, exact: true }).filter({ hasText: new RegExp(`^${escaped(name)}$`, 'u') });
		const memberButton = (id, name) => dialog.getByRole('listitem').filter({ hasText: rows.find(row => row.id === id).name })
			.getByRole('button', { name, exact: true });
		await expect(dialog).toBeVisible(); await expect(stackButton(copy.photoStackSave)).toBeEnabled();
		await expect(memberButton(selected[0], copy.photoStackMakeCover)).toBeFocused();
		expect(await memberIds(dialog)).toEqual(selected);
		await keyboard(page, memberButton(selected[0], copy.photoStackMoveLater));
		const createdOrder = [selected[1], selected[0], selected[2]]; expect(await memberIds(dialog)).toEqual(createdOrder);
		await keyboard(page, memberButton(selected[2], copy.photoStackMakeCover));
		await keyboard(page, stackButton(copy.photoStackSave));
		await expect(dialog.locator('[data-stack-ack]')).toHaveText(copy.photoStackCreated); await expect(library).toHaveAttribute('aria-busy', 'false');
		const created = await observe(page, ids); expect(created.stacks).toHaveLength(1);
		expect(created.stacks[0]).toMatchObject({ revision: 0, photoIds: createdOrder, coverPhotoId: selected[2] });
		expect(created.stackState).toMatchObject({ revision: 1, stackCount: 1 }); expect(created.photos).toEqual(before.photos);
		await keyboard(page, stackButton(copy.photoCloseMetadata)); await expect(dialog).toHaveCount(0);

		// The actual File backup path must preserve the separately versioned stack payload and original bytes.
		await action(page, app, copy.photoFileMenu, copy.photoBackupTitle);
		const backup = page.getByRole('dialog', { name: copy.photoBackupTitle, exact: true }), downloaded = page.waitForEvent('download');
		await keyboard(page, backup.getByRole('button', { name: copy.photoBackupSave, exact: true }));
		const download = await downloaded; expect(download.suggestedFilename()).toMatch(/\.liscape$/u);
		await authenticate(await readFile(await download.path()), created);
		await expect(backup.locator('[data-photo-backup-receipt]')).toContainText(copy.photoBackupDownloadStarted.replace('{name}', download.suggestedFilename()));
		await keyboard(page, backup.getByRole('button', { name: copy.photoBackupClose, exact: true })
			.filter({ hasText: new RegExp(`^${escaped(copy.photoBackupClose)}$`, 'u') })); expect(await observe(page, ids)).toEqual(created);

		await action(page, app, copy.photoViewMenu, copy.photoStackCollapseView);
		await expect(cards).toHaveCount(2); await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '4');
		expect(await visibleIds(cards)).toEqual(ids.filter(id => id === selected[2] || !selected.includes(id)));
		const cover = photoButton(selected[2]); await cover.focus(); await cover.press('4');
		await expect(cover).toContainText(`${copy.photoRating}: 4`); await expect(library).toHaveAttribute('aria-busy', 'false');
		await expect(cards).toHaveCount(2);
		const culled = await observe(page, ids); assertCustody(before, culled);
		expect(culled.stacks).toEqual(created.stacks); expect(culled.stackState).toEqual(created.stackState);
		for (const item of culled.photos) expect(item.photo).toMatchObject({ revision: item.photo.id === selected[2] ? 1 : 0, rating: item.photo.id === selected[2] ? 4 : 0 });
		await action(page, app, copy.photoViewMenu, copy.photoStackExpandView); await expect(cards).toHaveCount(4);
		await action(page, app, copy.photoViewMenu, copy.photoStackCollapseView); await expect(cards).toHaveCount(2);
		await page.reload(); await expect(app).toBeVisible(); await expect(app.locator('[data-photo-library],canvas')).toHaveCount(0);
		await action(page, app, copy.photoViewMenu, copy.photoShowLibrary); await expect(cards).toHaveCount(4);
		expect(await observe(page, ids)).toEqual(culled);
		await keyboard(page, photoButton(selected[2]));
		await action(page, app, copy.photoFileMenu, copy.photoStackEdit, true);
		await expect(stackButton(copy.photoStackSave)).toBeEnabled(); expect(await memberIds(dialog)).toEqual(createdOrder);
		await keyboard(page, memberButton(selected[2], copy.photoStackMoveEarlier));
		await keyboard(page, memberButton(selected[1], copy.photoStackMakeCover));
		await keyboard(page, stackButton(copy.photoStackSave)); await expect(dialog.locator('[data-stack-ack]')).toHaveText(copy.photoStackSaved);
		await expect(library).toHaveAttribute('aria-busy', 'false');
		const edited = await observe(page, ids); expect(edited.photos).toEqual(culled.photos);
		expect(edited.stacks[0]).toMatchObject({ revision: 1, photoIds: [selected[1], selected[2], selected[0]], coverPhotoId: selected[1] });
		await keyboard(page, stackButton(copy.photoStackReload)); await expect(stackButton(copy.photoStackSave)).toBeEnabled();
		expect(await memberIds(dialog)).toEqual(edited.stacks[0].photoIds);
		await keyboard(page, stackButton(copy.photoStackDissolve)); await expect(dialog.locator('[data-stack-ack]')).toHaveText(copy.photoStackDissolved);
		await keyboard(page, stackButton(copy.photoCloseMetadata)); await expect(dialog).toHaveCount(0); await expect(cards).toHaveCount(4);
		const dissolved = await observe(page, ids); expect(dissolved.stacks).toEqual([]);
		expect(dissolved.stackState).toMatchObject({ stackCount: 0, revision: 3 }); expect(dissolved.photos).toEqual(culled.photos); assertCustody(before, dissolved);
		expect(errors).toEqual([]); expect(requests.filter(url => /\/assets\/editor-copy-/u.test(url))).toEqual([]);
	});
}

test('native65-stack audit and130-member stack qualify continuations, cross-page cover and independent multiEntry corruption refusal', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'Full WebKit original storage qualification remains deferred.'); test.setTimeout(180_000);
	const { errors } = await setup(page, 'en');
	const result = await page.evaluate(async path => (await import(new URL(path, location.href).href)).qualifyPhotoStackStorageNativeV1(), OBSERVER);
	expect(result).toMatchObject({ photoCount: 130, maximumPublishedBatch: 16, duplicateRefused: true,
		missingReverseRefused: true, missingStackRefused: true, crossConnectionRefused: true, sourceByteLength: 163, originalRootCount: 130,
		actualSha256: '53da2d7acaff4a63fe169b1c8c76ab63f4cfa8d5182868d2ba9f356a97586e6c',
		indexOptions: { keyPath: 'memberKeys', unique: true, multiEntry: true } });
	for (const report of [result.eligible, result.sparse, result.crossPage]) {
		expect(report.ids).toHaveLength(1); expect(report.maximumScanned).toBeLessThanOrEqual(64); expect(report.maximumNativeReadRequests).toBeLessThanOrEqual(65);
	}
	expect(result.stackAudit.firstStep).toEqual({ itemCount: 0, scanned: 64, auditCount: 64 });
	expect(result.stackAudit.ids).toEqual(Array.from({ length: 65 }, (_, index) => `native-stack-photo-${String(index * 2).padStart(3, '0')}`));
	expect(result.stackAudit.maximumScanned).toBeLessThanOrEqual(64); expect(result.stackAudit.maximumNativeAuditKeys).toBe(64);
	expect(result.stackAudit.maximumNativeReadRequests).toBeLessThanOrEqual(65); expect(result.stackAudit.emptyAuditSteps).toBeGreaterThanOrEqual(1);
	expect(result.eligible.ids).toEqual(['native-stack-photo-000']); expect(result.eligible.emptyPendingSteps).toBeGreaterThanOrEqual(2);
	expect(result.sparse.ids).toEqual(['native-stack-photo-129']); expect(result.sparse.emptyPendingSteps).toBeGreaterThanOrEqual(2);
	expect(result.crossPage.ids).toEqual(['native-stack-photo-129']); expect(errors).toEqual([]);
});

async function setup(page, locale) {
	await installNativeOpfsWorkerCompanion(page);
	const errors = [], requests = []; page.on('pageerror', error => { errors.push(error.message); }); page.on('request', request => { requests.push(request.url()); });
	const bundle = await build({ stdin: { contents: `export { qualifyPhotoStackStorageNativeV1, stackCopyForLocaleV1 } from './tests/helpers/lightscaper-photo-stack-native-fixture.ts';
		export { readCurrentCatalogCompanionsV1 as observe } from './tests/helpers/lightscaper-current-catalog-companions-fixture.ts';`,
		resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route(`**${OBSERVER}`, route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`);
	const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	const copy = await page.evaluate(async ({ locale, path }) => (await import(new URL(path, location.href).href)).stackCopyForLocaleV1(locale), { locale, path: OBSERVER });
	return { app, copy, errors, requests };
}
async function observe(page, ids) {
	const result = await page.evaluate(async ({ ids, path }) => (await import(new URL(path, location.href).href))
		.observe(ids, indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution()), { ids, path: OBSERVER });
	await assertNativeOpfsWorkerExecution(page);
	expect(result.namespace).toBeNull(); for (const item of result.photos) assertNumericPhoto(item.photo); return result;
}
async function keyboard(page, target) { await expect(target).toBeEnabled(); await target.focus(); await expect(target).toBeFocused(); await page.keyboard.press('Enter'); }
async function action(page, app, name, actionName, photo = false) {
	await keyboard(page, app.locator('nav > details > summary').filter({ hasText: new RegExp(`^${name}$`, 'u') }));
	if (photo) await keyboard(page, app.locator('.lightscaper-photo-submenu > summary'));
	await keyboard(page, app.getByRole('button', { name: actionName, exact: true }));
}
async function memberIds(dialog) { return dialog.locator('[data-stack-member]').evaluateAll(nodes => nodes.map(node => node.dataset.stackMember)); }
async function visibleIds(cards) { return cards.evaluateAll(nodes => nodes.map(node => node.dataset.photoId)); }
function escaped(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
function assertNumericPhoto(photo) {
	expect(photo.schemaVersion).toBe(1);
	for (const version of photo.versions) {
		expect(version.develop.processVersion).toBe(1);
		if (version.workspace) { expect(version.workspace.schemaVersion).toBe(1);
			for (const item of [...version.workspace.entries, ...version.workspace.snapshots]) expect(item.develop.processVersion).toBe(1); }
	}
}
function assertOriginals(observation) {
	for (const item of observation.photos) {
		const photo = item.photo, source = SOURCES.find(source => source.name === photo.original.name), digest = createHash('sha256').update(source.bytes).digest('hex');
		expect(item.bytes).toEqual(Array.from(source.bytes)); expect(item.actualSha256).toBe(digest); expect(photo.original.contentSha256).toBe(digest);
		expect(item.authority.catalogRootCount).toBe(1); expect(item.authority.roots).toHaveLength(1); expect(item.authority.roots[0].importId).toBeNull();
		expect(item.authority.roots[0].mediaContentToken).toBe(item.authority.mediaContentToken);
	}
}
function assertCustody(before, after) {
	expect(after.root.id).toBe(before.root.id); expect(after.root.photoCount).toBe(4); expect(after.namespace).toBe(before.namespace);
	for (const previous of before.photos) {
		const current = after.photos.find(item => item.photo.id === previous.photo.id);
		expect(current.photo.original).toEqual(previous.photo.original);
		for (const key of ['authority', 'bytes', 'actualSha256']) expect(current[key]).toEqual(previous[key]);
	}
	assertOriginals(after);
}
async function authenticate(bytes, previous) {
	const blob = new Blob([bytes]);
	const document = await withScapeArchiveReader(blob, undefined, async entries =>
		normalizePhotoCatalogArchiveV5(JSON.parse((await readScapeArchiveEnvelope(entries)).projectText)));
	expect(document.schemaVersion).toBe(5); expect(document.lutResources).toEqual([]); expect(document.developPresetPack).toBeNull(); expect(document.savedCollectionState).toBeNull(); expect(document.savedCollectionPacks).toEqual([]);
	const photos = [], stacks = []; let published = false;
	const root = await importPhotoCatalogArchiveV5(blob, async (catalog, state, presets, declaredLuts) => {
		expect(catalog).toEqual(previous.root); expect(state).toBeNull(); expect(presets).toBeNull(); expect(declaredLuts).toEqual([]); return {
		async writePhoto(photo, original) {
			const chunks = []; for await (const chunk of original) chunks.push(Buffer.from(chunk));
			photos.push({ photo, bytes: Buffer.concat(chunks) });
		}, async writeStack(stack) { stacks.push(stack); }, async writeSavedCollection() { throw new Error('This catalog has no saved definitions.'); },
		async writeDevelopPresets() { throw new Error('Expected absent Develop preset state.'); },
		async writeLut() { throw new Error('Numeric-only stack backup must not contain LUT resources.'); },
		async publish() { published = true; }, async rollback() { photos.length = 0; stacks.length = 0; },
	}; });
	expect(published).toBe(true); expect(root).toEqual(previous.root); expect(root.photoCount).toBe(4);
	expect(stacks).toEqual(previous.stacks); expect(photos).toHaveLength(4);
	for (const { photo, bytes: body } of photos) {
		const current = previous.photos.find(row => row.photo.id === photo.id), source = SOURCES.find(source => source.name === photo.original.name);
		expect(photo).toEqual(current.photo); assertNumericPhoto(photo); expect(photo.revision).toBe(current.photo.revision); expect(photo.original).toEqual(current.photo.original);
		expect(body.equals(source.bytes)).toBe(true); expect(createHash('sha256').update(body).digest('hex')).toBe(current.actualSha256);
	}
}
