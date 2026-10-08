/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './helpers/browser-coverage-fixture.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==', 'base64');
const FILE_NAMES = ['Needle A.png', 'Needle B.png', 'Other.png'];
const DEFAULT_QUERY = { schemaVersion: 2, kind: 'photo-catalog-query', text: '', filter: null,
	sort: { field: 'photo-id', direction: 'ascending' }, predicate: null };
const FULL_QUERY = { schemaVersion: 2, kind: 'photo-catalog-query', text: 'needle', filter: { kind: 'rating', value: 3 },
	sort: { field: 'capture-time', direction: 'descending' }, predicate: { kind: 'all', terms: [
		{ kind: 'text', column: 'file-name', operator: 'contains', value: 'needle' },
		{ kind: 'number', column: 'width', minimum: 2, maximum: 2 },
	] } };

for (const [locale, copy] of [
	['en', { file: 'File', view: 'View', importer: 'Import photos', choose: 'Choose photos', import: 'Import', rating: 'Rating',
		query: 'Search, filter and sort', apply: 'Apply query', saved: 'Saved filters', saveCurrent: 'Save current filter',
		name: 'Filter name', newFilter: 'New filter', load: 'Load for editing', use: 'Use filter', save: 'Save filter',
		remove: 'Delete filter', reload: 'Reload saved filter', list: 'Refresh list', all: 'Show all photos', close: 'Close',
		text: 'Search text', filter: 'Filter', sort: 'Sort by', direction: 'Sort direction', add: 'Add condition',
		column: 'Metadata field', value: 'Value', minimum: 'Minimum (inclusive)', maximum: 'Maximum (inclusive)',
		json: 'Smart collection rules (JSON)', build: /^(?:Prepare search index|Resume search index preparation)$/u,
		savedReceipt: 'Filter saved.', deletedReceipt: 'Filter deleted.', empty: 'No saved filters.',
		activeDelete: 'Switch to another filter or show all photos before deleting the active filter.' }],
	['de', { file: 'Datei', view: 'Ansicht', importer: 'Fotos importieren', choose: 'Fotos auswählen', import: 'Importieren', rating: 'Bewertung',
		query: 'Suchen, filtern und sortieren', apply: 'Suche anwenden', saved: 'Gespeicherte Filter', saveCurrent: 'Aktuellen Filter speichern',
		name: 'Filtername', newFilter: 'Neuer Filter', load: 'Zum Bearbeiten laden', use: 'Filter verwenden', save: 'Filter speichern',
		remove: 'Filter löschen', reload: 'Gespeicherten Filter neu laden', list: 'Liste aktualisieren', all: 'Alle Fotos anzeigen', close: 'Schließen',
		text: 'Suchtext', filter: 'Filter', sort: 'Sortieren nach', direction: 'Sortierrichtung', add: 'Bedingung hinzufügen',
		column: 'Metadatenfeld', value: 'Wert', minimum: 'Minimum (einschließlich)', maximum: 'Maximum (einschließlich)',
		json: 'Regeln der intelligenten Sammlung (JSON)', build: /^(?:Suchindex vorbereiten|Vorbereitung des Suchindex fortsetzen)$/u,
		savedReceipt: 'Filter gespeichert.', deletedReceipt: 'Filter gelöscht.', empty: 'Keine gespeicherten Filter.',
		activeDelete: 'Wechsle zu einem anderen Filter oder zeige alle Fotos an, bevor du den aktiven Filter löschst.' }],
]) {
	test(`${locale}: saved filters load through the View menu and persist without revealing default controls`, async ({ page }) => {
		test.setTimeout(60_000);
		const ui = await openProduct(page, locale, copy), scripts = new Set();
		page.on('request', request => { if (request.resourceType() === 'script') scripts.add(request.url()); });
		await expectDefaultEmpty(ui.app);
		const name = `${locale} empty catalog filter`, dialog = await ui.saved();
		await expect(dialog.getByText(copy.empty, { exact: true })).toBeVisible();
		// Opening the first optional surface must request JavaScript from the actual built site.
		expect(scripts.size).toBeGreaterThan(0);
		await expect(dialog.locator('input[name=savedFilterSelection]')).toHaveCount(0);
		await named(dialog, 'button', copy.newFilter).click();
		await expect(named(dialog, 'textbox', copy.name)).toBeEnabled();
		await named(dialog, 'textbox', copy.name).fill(name);
		await ui.save(dialog); await ui.expectRecipe(dialog, DEFAULT_QUERY);
		await expect(named(dialog, 'button', copy.remove)).toBeEnabled();
		await expect(ui.app.locator('[data-photo-library],canvas')).toHaveCount(0);
		await ui.closeSaved(dialog); await page.reload(); await expectDefaultEmpty(ui.app);
		const restored = await ui.saved(); await ui.load(restored, name); await ui.expectRecipe(restored, DEFAULT_QUERY);
		await named(restored, 'button', copy.use).click();
		await expect(ui.library).toBeVisible(); await expect(ui.cards).toHaveCount(0);
		await expect(named(restored, 'button', copy.remove)).toBeDisabled();
		await ui.closeSaved(restored); await page.reload(); await expectDefaultEmpty(ui.app);
		expect(ui.errors).toEqual([]);
	});

	test(`${locale}: full saved filters require explicit Use and refresh after culls and active edits before deletion`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Full WebKit original storage is deferred; the selection/presenter fixture is qualified separately.');
		test.setTimeout(60_000);
		const ui = await openProduct(page, locale, copy); await ui.importPhotos(); await ui.prepareSearch();
		const name = `${locale} authored filter`, dialog = await ui.saved(true);
		await named(dialog, 'textbox', copy.name).fill(name); await authorFullQuery(dialog, copy);
		await ui.save(dialog); await ui.expectRecipe(dialog, FULL_QUERY);
		await expect(named(dialog, 'button', copy.remove)).toBeEnabled(); await ui.expectFiles(FILE_NAMES);
		await named(dialog, 'button', copy.use).click(); await ui.expectFiles(FILE_NAMES.slice(0, 2));
		await expect(named(dialog, 'button', copy.remove)).toBeDisabled();
		await expect(dialog.getByText(copy.activeDelete, { exact: true })).toBeVisible();
		await ui.closeSaved(dialog); await ui.rate('Needle A.png', 0); await ui.expectFiles(['Needle B.png']);
		const editing = await ui.saved(); await ui.load(editing, name);
		await named(editing, 'textbox', copy.text).fill('other');
		await named(editing, 'combobox', copy.filter).selectOption('');
		await named(named(editing, 'group', '1'), 'textbox', copy.value).fill('other');
		await ui.save(editing); await ui.expectFiles(['Other.png']);
		await ui.expectRecipe(editing, { ...FULL_QUERY, text: 'other', filter: null, predicate: { ...FULL_QUERY.predicate,
			terms: [{ ...FULL_QUERY.predicate.terms[0], value: 'other' }, FULL_QUERY.predicate.terms[1]] } });
		await expect(named(editing, 'button', copy.remove)).toBeDisabled();
		await named(editing, 'button', copy.all).click(); await ui.expectFiles(FILE_NAMES);
		await expect(named(editing, 'button', copy.remove)).toBeEnabled(); await named(editing, 'button', copy.remove).click();
		await expect(editing.locator('[data-saved-receipt]')).toHaveText(copy.deletedReceipt);
		await expect(named(editing, 'button', copy.list)).toBeEnabled(); await named(editing, 'button', copy.list).click();
		await expect(editing.locator('input[name=savedFilterSelection]')).toHaveCount(0);
		await expect(editing.getByText(copy.empty, { exact: true })).toBeVisible();
		await ui.closeSaved(editing); await page.reload(); await expectDefaultEmpty(ui.app);
		const empty = await ui.saved(); await expect(empty.getByText(copy.empty, { exact: true })).toBeVisible();
		await named(empty, 'button', copy.all).click(); await ui.expectFiles(FILE_NAMES); await ui.closeSaved(empty);
		expect(ui.errors).toEqual([]);
	});

	test(`${locale}: Save current copies the complete transient and saved recipe and Reload preserves an unsaved draft`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Full WebKit original storage is deferred; the selection/presenter fixture is qualified separately.');
		test.setTimeout(60_000);
		const ui = await openProduct(page, locale, copy); await ui.importPhotos();
		const search = await ui.prepareSearch(false); await authorFullQuery(search, copy);
		await search.getByRole('button', { name: copy.apply, exact: true }).click(); await ui.expectFiles(FILE_NAMES.slice(0, 2));
		await named(search, 'button', copy.close).filter({ hasText: copy.close }).click();
		const sourceName = `${locale} transient copy`, source = await ui.saved(true);
		await ui.expectRecipe(source, FULL_QUERY); await named(source, 'textbox', copy.name).fill(sourceName);
		await ui.save(source); await expect(named(source, 'button', copy.remove)).toBeEnabled();
		await named(source, 'button', copy.use).click(); await ui.expectFiles(FILE_NAMES.slice(0, 2));
		await expect(named(source, 'button', copy.remove)).toBeDisabled(); await ui.closeSaved(source);
		const copyName = `${locale} saved source copy`, copied = await ui.saved(true);
		await ui.expectRecipe(copied, FULL_QUERY); await named(copied, 'textbox', copy.name).fill(copyName);
		await ui.save(copied); await expect(named(copied, 'button', copy.remove)).toBeEnabled();
		await ui.expectFiles(FILE_NAMES.slice(0, 2)); await ui.closeSaved(copied);
		const editing = await ui.saved(); await expect(editing.locator('input[name=savedFilterSelection]')).toHaveCount(2);
		await ui.load(editing, copyName); await ui.expectRecipe(editing, FULL_QUERY);
		await named(editing, 'textbox', copy.name).fill('Unsaved name');
		await named(editing, 'textbox', copy.text).fill('unsaved text');
		await named(editing, 'button', copy.reload).click(); await expect(named(editing, 'button', copy.save)).toBeEnabled();
		await expect(named(editing, 'textbox', copy.name)).toHaveValue('Unsaved name');
		await expect(named(editing, 'textbox', copy.text)).toHaveValue('unsaved text');
		await named(editing, 'button', copy.load).click(); await expect(named(editing, 'textbox', copy.name)).toHaveValue(copyName);
		await ui.expectRecipe(editing, FULL_QUERY); await ui.closeSaved(editing); await page.reload(); await expectDefaultEmpty(ui.app);
		const restored = await ui.saved(); await expect(restored.locator('input[name=savedFilterSelection]')).toHaveCount(2);
		await ui.load(restored, sourceName); await ui.expectRecipe(restored, FULL_QUERY);
		await ui.load(restored, copyName); await ui.expectRecipe(restored, FULL_QUERY);
		await named(restored, 'button', copy.use).click(); await ui.expectFiles(FILE_NAMES.slice(0, 2));
		await expect(named(restored, 'button', copy.remove)).toBeDisabled(); await ui.closeSaved(restored);
		expect(ui.errors).toEqual([]);
	});
}

function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }

async function expectDefaultEmpty(app) {
	await expect(app).toBeVisible();
	await expect(app.locator('[data-photo-library],canvas,[data-photo-saved-filters]')).toHaveCount(0);
	await expect(app.locator('[data-photo-save-filter-menu]')).toBeHidden();
	await expect(app.locator('[data-photo-saved-filters-menu]')).toBeHidden();
}

async function authorFullQuery(dialog, copy) {
	await named(dialog, 'textbox', copy.text).fill('needle');
	await named(dialog, 'combobox', copy.filter).selectOption('rating');
	await named(dialog, 'combobox', copy.rating).selectOption('3');
	await named(dialog, 'combobox', copy.sort).selectOption('capture-time');
	await named(dialog, 'combobox', copy.direction).selectOption('descending');
	await named(dialog, 'button', copy.add).click();
	await named(named(dialog, 'group', '1'), 'textbox', copy.value).fill('needle');
	await named(dialog, 'button', copy.add).click();
	await named(named(dialog, 'group', '2'), 'combobox', copy.column).selectOption('width');
	await named(named(dialog, 'group', '2'), 'spinbutton', copy.minimum).fill('2');
	await named(named(dialog, 'group', '2'), 'spinbutton', copy.maximum).fill('2');
}

async function expectRecipe(dialog, query, copy) {
	const advanced = named(dialog, 'button', copy.json);
	await expect(advanced).toBeEnabled(); await expect(advanced).toHaveAttribute('aria-expanded', 'false');
	await advanced.click(); const json = named(dialog, 'textbox', copy.json);
	await expect(json).toBeVisible(); await expect(json).toHaveValue(/^\{/u);
	expect(JSON.parse(await json.inputValue())).toEqual(query);
	await advanced.click(); await expect(json).toHaveCount(0);
}

async function openProduct(page, locale, copy) {
	const origin = JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper, errors = [];
	page.on('pageerror', error => { errors.push(error.message); }); await page.goto(`${origin}/${locale}/`);
	const app = page.locator('[data-lightscaper-bound="true"]'), library = app.locator('[data-photo-library]'), cards = library.locator('[data-photo-id]');
	await expect(app).toBeVisible();
	async function menu(label, parent = copy.view) {
		const summary = app.getByText(parent, { exact: true });
		await summary.focus(); await page.keyboard.press('Enter');
		const button = app.getByRole('button', { name: label, exact: true }); await expect(button).toBeEnabled();
		await button.focus(); await page.keyboard.press('Enter');
	}
	async function expectFiles(names) {
		await expect(library).toHaveAttribute('aria-busy', 'false'); await expect(cards).toHaveCount(names.length);
		await expect.poll(async () => (await cards.locator('strong').allTextContents()).sort()).toEqual([...names].sort());
		await expect(app.locator('canvas')).toHaveCount(0);
	}
	async function rate(name, value) {
		const card = library.getByRole('button').filter({ has: page.getByText(name, { exact: true }) });
		await card.focus(); await card.press(String(value));
		if (value === 3) await expect(card.getByText(`${copy.rating}: ${value}`, { exact: true })).toBeVisible();
		await expect(library).toHaveAttribute('aria-busy', 'false');
	}
	return { app, library, cards, errors, expectFiles, rate,
		expectRecipe: (dialog, query) => expectRecipe(dialog, query, copy),
		async saved(create = false) {
			await menu(create ? copy.saveCurrent : copy.saved);
			const dialog = page.getByRole('dialog', { name: copy.saved, exact: true });
			await expect(dialog).toBeVisible(); await expect(named(dialog, 'button', copy.newFilter)).toBeEnabled(); return dialog;
		},
		async save(dialog) {
			await expect(named(dialog, 'button', copy.save)).toBeEnabled(); await named(dialog, 'button', copy.save).click();
			await expect(dialog.locator('[data-saved-receipt]')).toHaveText(copy.savedReceipt);
			await expect(named(dialog, 'button', copy.use)).toBeEnabled(); await expect(named(dialog, 'button', copy.save)).toBeEnabled();
		},
		async load(dialog, name) {
			await expect(named(dialog, 'button', copy.list)).toBeEnabled(); await dialog.getByRole('radio', { name, exact: true }).check();
			await named(dialog, 'button', copy.load).click(); await expect(named(dialog, 'textbox', copy.name)).toHaveValue(name);
			await expect(named(dialog, 'button', copy.save)).toBeEnabled();
		},
		async closeSaved(dialog) { await named(dialog, 'button', copy.close).filter({ hasText: copy.close }).click(); await expect(dialog).toHaveCount(0); },
		async importPhotos() {
			await expectDefaultEmpty(app); await menu(copy.importer, copy.file);
			const importer = page.getByRole('dialog', { name: copy.importer, exact: true });
			await importer.getByLabel(copy.choose).setInputFiles(FILE_NAMES.map(name => ({ name, mimeType: 'image/png', buffer: PNG })));
			await importer.getByRole('button', { name: copy.import, exact: true }).click(); await expectFiles(FILE_NAMES);
			await rate('Needle A.png', 3); await rate('Needle B.png', 3);
		},
		async prepareSearch(close = true) {
			await menu(copy.query); const dialog = page.getByRole('dialog', { name: copy.query, exact: true });
			await expect(dialog).toBeVisible(); await expect(library).toHaveAttribute('aria-busy', 'false');
			const build = dialog.getByRole('button', { name: copy.build });
			// Probe the real index first; current imports may already maintain a ready index.
			if (await build.count()) { await build.click(); await expect(build).toHaveCount(0); }
			await expect(dialog.getByRole('button', { name: copy.apply, exact: true })).toBeEnabled();
			if (close) await named(dialog, 'button', copy.close).filter({ hasText: copy.close }).click(); return dialog;
		},
	};
}
