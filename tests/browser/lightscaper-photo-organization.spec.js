/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });

for (const locale of ['en', 'de']) {
	test(`${locale}: actual organizer and membership menus publish full smart grammar and preserve original custody`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Full WebKit catalog storage workflows remain deferred until native Blob/OPFS custody is qualified.');
		test.setTimeout(120_000);
		const { app, fixture } = await setup(page, locale), copy = fixture.copy, errors = [];
		page.on('pageerror', error => { errors.push(error.message); });
		expect(typeof copy.photoOrganizerTitle).toBe('string'); expect(typeof copy.photoMembershipTitle).toBe('string');
		await expect(app.locator('[data-photo-library]')).toHaveCount(0);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		const before = await observe(page, [fixture.sparsePhotoId]);
		expect(before.photoCount).toBe(80); expect(before.photos[0].actualSha256).toBe(fixture.originalSha256);
		const organizer = page.getByRole('dialog', { name: copy.photoOrganizerTitle, exact: true });
		await fileAction(copy.photoOrganizerTitle);
		await expect(organizer.locator('input[name=definitionName]')).toBeFocused();
		await expect(organizer.locator('[data-definition-id]')).toHaveCount(64);
		await create('folder', 'Native temporary folder');
		let catalog = await observe(page); const temporary = named(catalog.folders, 'Native temporary folder');
		await organizer.locator('input[name=definitionName]').fill('Native renamed folder');
		await submitOrganizer();
		await expect(organizer.locator('[data-organizer-selected]')).toContainText('Native renamed folder');
		await keyboard(organizer.getByRole('button', { name: copy.photoOrganizerParent, exact: true }));
		await expect(organizer.locator('[data-definition-selector]')).toHaveAttribute('aria-busy', 'false');
		await keyboard(organizer.locator('[data-definition-next]'));
		await choose(organizer, 'folder-069');
		await keyboard(organizer.getByRole('button', { name: copy.photoOrganizerReparent, exact: true }));
		await expect.poll(async () => (await observe(page)).folders.find(row => row.id === temporary.id)?.parentId).toBe('folder-069');
		await expect(organizer.getByRole('button', { name: copy.photoOrganizerReparent, exact: true })).toBeEnabled();
		catalog = await observe(page); expect(catalog.folders.find(row => row.id === temporary.id).parentId).toBe('folder-069');
		await keyboard(organizer.getByRole('button', { name: copy.photoOrganizerDeleteEmpty, exact: true }));
		await expect(organizer.locator('[data-organizer-selected]')).toHaveCount(0);
		catalog = await observe(page); expect(catalog.folders.some(row => row.id === temporary.id)).toBe(false);
		await create('keyword', 'Native organization keyword');
		catalog = await observe(page); const keyword = named(catalog.keywords, 'Native organization keyword');
		await create('collection', 'Native manual collection');
		catalog = await observe(page); const manual = named(catalog.collections, 'Native manual collection');
		const fullQuery = { kind: 'all', terms: [
			{ kind: 'any', terms: [{ kind: 'rating', minimum: 1, maximum: 5 }, { kind: 'flag', value: 'pick' }] },
			{ kind: 'not', term: { kind: 'label', value: 'red' } }, { kind: 'keyword', id: keyword.id },
			{ kind: 'folder', id: 'folder-069' }, { kind: 'file-name', contains: 'Photo' },
			{ kind: 'capture-time', from: '2026-09-01T00:00:00.000', to: '2026-10-01T00:00:00.000' },
		] };
		await create('collection', 'Native smart collection', fullQuery);
		catalog = await observe(page); const smart = named(catalog.collections, 'Native smart collection');
		expect(smart.query).toEqual(fullQuery);
		await organizer.locator('input[name=definitionName]').fill('Native updated smart collection');
		await submitOrganizer();
		catalog = await observe(page); expect(named(catalog.collections, 'Native updated smart collection').query).toEqual(fullQuery);
		expect(catalog.photoCount).toBe(80);
		await close(organizer);

		await viewAction(copy.photoShowLibrary);
		const library = app.locator('[data-photo-library]');
		await expect(library.locator('[data-photo-id]')).toHaveCount(64);
		await viewAction(copy.photoNextPage); await expect(library.locator('[data-photo-id]')).toHaveCount(16);
		await keyboard(library.locator(`[data-photo-id="${fixture.sparsePhotoId}"]`));
		const memberships = page.getByRole('dialog', { name: copy.photoMembershipTitle, exact: true });
		await fileAction(copy.photoMembershipTitle, true);
		await expect(memberships.locator('select[name=membershipKind]')).toBeFocused();
		await keyboard(memberships.locator('[data-definition-next]')); await choose(memberships, 'folder-069');
		await memberships.locator('select[name=membershipKind]').selectOption('keyword');
		await choose(memberships, keyword.id); await keyboard(memberships.locator('[data-membership-add]'));
		await expect(memberships.locator(`[data-membership-id="${keyword.id}"]`)).toHaveCount(1);
		await expect(memberships.locator(`[data-membership-name="${keyword.id}"]`)).toHaveText(keyword.name);
		await keyboard(memberships.locator(`[data-membership-remove="${keyword.id}"]`));
		await expect(memberships.locator(`[data-membership-id="${keyword.id}"]`)).toHaveCount(0);
		await keyboard(memberships.locator('[data-membership-add]'));
		await memberships.locator('select[name=membershipKind]').selectOption('collection');
		await choose(memberships, smart.id); await expect(memberships.locator('[data-membership-add]')).toBeDisabled();
		await expect(memberships.getByText(copy.photoMembershipManualOnly, { exact: true })).toBeVisible();
		await choose(memberships, manual.id); await keyboard(memberships.locator('[data-membership-add]'));
		await expect(memberships.locator(`[data-membership-name="${manual.id}"]`)).toHaveText(manual.name);
		await applyMemberships(before.photos[0].revision + 1);
		let after = await observe(page, [fixture.sparsePhotoId]);
		expect(after.photos[0].revision).toBe(before.photos[0].revision + 1);
		expect(after.photos[0].folderId).toBe('folder-069'); expect(after.photos[0].keywordIds).toEqual([keyword.id]);
		expect(after.photos[0].collectionIds).toEqual([manual.id]); preserve(before.photos[0], after.photos[0]);
		await close(memberships);
		await applySmartQuery(); await expect(library.locator('[data-photo-id]')).toHaveCount(1);
		await expect(library.locator('[data-photo-id]')).toHaveAttribute('data-photo-id', fixture.sparsePhotoId);
		await keyboard(library.locator('[data-photo-id]')); await fileAction(copy.photoMembershipTitle, true);
		await memberships.locator('select[name=membershipKind]').selectOption('keyword');
		await keyboard(memberships.locator(`[data-membership-remove="${keyword.id}"]`)); await applyMemberships(before.photos[0].revision + 2);
		await expect(library.locator('[data-photo-id]')).toHaveCount(0);
		await close(memberships);
		after = await observe(page, [fixture.sparsePhotoId]);
		expect(after.photos[0].revision).toBe(before.photos[0].revision + 2);
		expect(after.photos[0].keywordIds).toEqual([]); expect(after.photos[0].collectionIds).toEqual([manual.id]);
		preserve(before.photos[0], after.photos[0]);
		await page.reload(); await expect(app).toBeVisible();
		await expect(app.locator('[data-photo-library]')).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0);
		const reloaded = await observe(page, [fixture.sparsePhotoId]);
		expect(reloaded.photos).toEqual(after.photos); expect(named(reloaded.collections, 'Native updated smart collection').query).toEqual(fullQuery);
		await applySmartQuery(); await expect(app.locator('[data-photo-library]')).toHaveAttribute('aria-busy', 'false');
		await expect(app.locator('[data-photo-id]')).toHaveCount(0); expect(errors).toEqual([]);

		async function keyboard(locator) {
			await expect(locator).toBeEnabled(); await locator.focus(); await expect(locator).toBeFocused(); await page.keyboard.press('Enter');
		}
		async function menu(name) { await keyboard(app.locator('nav > details > summary').filter({ hasText: name })); }
		async function fileAction(name, photo = false) {
			await menu(copy.photoFileMenu);
			if (photo) await keyboard(app.locator('.lightscaper-photo-submenu > summary'));
			await keyboard(app.getByRole('button', { name, exact: true }));
		}
		async function viewAction(name) { await menu(copy.photoViewMenu); await keyboard(app.getByRole('button', { name, exact: true })); }
		async function choose(dialog, id) {
			const choice = dialog.locator(`[data-definition-choose="${id}"]`);
			await keyboard(choice); await expect(dialog.locator('[data-definition-selector]')).toHaveAttribute('aria-busy', 'false');
		}
		async function create(kind, name, query) {
			await organizer.locator('select[name=organizerKind]').selectOption(kind);
			await keyboard(organizer.locator('[data-organizer-create]'));
			await organizer.locator('input[name=definitionName]').fill(name);
			if (query) {
				await organizer.locator('select[name=collectionKind]').selectOption('smart');
				const examples = organizer.locator('code[data-photo-smart-query-example]');
				await expect(examples).toHaveCount(10);
				const displayed = await examples.evaluateAll(nodes => nodes.map(node => ({ kind: node.getAttribute('data-photo-smart-query-example'),
					query: JSON.parse(node.textContent) })));
				expect(displayed.map(example => example.kind).sort()).toEqual(['all', 'any', 'capture-time', 'file-name', 'flag', 'folder', 'keyword', 'label', 'not', 'rating']);
				for (const example of displayed) expect(example.query.kind).toBe(example.kind);
				await expect(organizer.locator('code[data-photo-smart-query-interval="true"]')).toHaveText('[from, to)');
				await organizer.locator('textarea[name=queryJson]').fill(JSON.stringify(query));
			}
			await submitOrganizer(); await expect(organizer.locator('[data-organizer-selected]')).toContainText(name);
		}
		async function submitOrganizer() {
			const submit = organizer.locator('form button[type=submit]');
			await keyboard(submit); await expect(submit).toBeEnabled(); await expect(organizer.getByRole('alert')).toHaveCount(0);
		}
		async function applyMemberships(expectedRevision) {
			const submit = memberships.getByRole('button', { name: copy.photoMembershipApply, exact: true });
			await keyboard(submit);
			await expect.poll(async () => (await observe(page, [fixture.sparsePhotoId])).photos[0].revision).toBe(expectedRevision);
			await expect(submit).toBeEnabled(); await expect(memberships.getByRole('alert')).toHaveCount(0);
		}
		async function close(dialog) {
			await keyboard(dialog.locator('form').getByRole('button', { name: copy.photoCloseMetadata, exact: true }));
			await expect(dialog).toHaveCount(0);
		}
		async function applySmartQuery() {
			await viewAction(copy.photoQueryTitle);
			const query = page.getByRole('dialog', { name: copy.photoQueryTitle, exact: true });
			await query.getByRole('combobox', { name: copy.photoQueryFilter, exact: true }).selectOption('collection');
			await choose(query, smart.id);
			const selected = query.locator(`[data-definition-choose="${smart.id}"]`); await expect(selected).toHaveAttribute('aria-pressed', 'true');
			await keyboard(query.getByRole('button', { name: copy.photoQueryApply, exact: true }));
			await expect(query.getByRole('alert')).toHaveCount(0);
			await expect(app.locator('[data-photo-library]')).toHaveAttribute('aria-busy', 'false');
			await keyboard(query.locator('[data-query-close]')); await expect(query).toHaveCount(0);
		}
	});
}

function named(rows, name) { const row = rows.find(candidate => candidate.name === name); expect(row, `Published definition ${name}`).toBeDefined(); return row; }
function preserve(before, after) {
	for (const key of ['original', 'metadata', 'extractedMetadata', 'versions', 'activeVersionId', 'rating', 'flag', 'colorLabel', 'byteLength', 'actualSha256']) expect(after[key], key).toEqual(before[key]);
	expect(after.actualSha256).toBe(after.original.contentSha256); expect(after.byteLength).toBe(after.original.byteLength);
}
async function setup(page, locale) {
	const result = await build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-photo-organization-native-fixture.ts', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route('**/__lightscaper_photo_organization_fixture.js', async route => {
		await route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text });
	});
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS
		? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`);
	const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	const fixture = await page.evaluate(async language => {
		const api = await import(new URL('/__lightscaper_photo_organization_fixture.js', location.href).href);
		return api.seedPhotoCatalogOrganizationNativeV1(language);
	}, locale);
	return { app, fixture };
}
async function observe(page, ids = []) {
	return page.evaluate(async photoIds => {
		const api = await import(new URL('/__lightscaper_photo_organization_fixture.js', location.href).href);
		return api.readPhotoCatalogOrganizationNativeV1(photoIds);
	}, ids);
}
