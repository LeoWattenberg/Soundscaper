/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoFramescaperCollectionHandoffCopy } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { photoFramescaperCollectionHandoffMenuLabel } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts';
import { photoDevelopBrushMaskCopy } from '../../src/common/i18n/lightscaper-develop-brush-mask-copy.ts';
import { photoDevelopMaskManagementCopy } from '../../src/common/i18n/lightscaper-develop-mask-management-copy.ts';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { expect, test, compileNativeImageHandoffScript, installNativeImageHandoffRuntime } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { repairSettingsUiFixtureV1, active, named, keyboard, check, uncheck } from './helpers/lightscaper-repair-settings-ui-fixture.js';
import { repairOriginalReferencePixelsV1 } from './helpers/lightscaper-repair-spots-reference.ts';

const PROGRAM = '/__repair_sequence_current_native.js', PIXELS = [255, 255, 255, 255, 137, 137, 137, 255];
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${'0.25 0.25 0.25\n'.repeat(8)}`);
const UNBOUND_BODY = [83, 67, 77, 65, 83, 75, 48, 49, 3, 0, 0, 0, 1, 0, 0, 0, 0, 255, 0];
const SAVED_QUERY = { schemaVersion: 2, kind: 'photo-catalog-query', text: '', filter: null,
	sort: { field: 'file-name', direction: 'descending' }, predicate: { kind: 'number', column: 'width', minimum: 10, maximum: 10 } };

for (const locale of ['en', 'de']) for (const scope of ['manual', 'saved-filter']) {
	test(`${locale}: ${scope} repaired collection crosses actual Frame menus with editable native sources, unused bodies and sender custody`, async ({ page, context, browserName }) => {
		shape(browserName); test.setTimeout(240000);
		const f = await fixture(page, locale), variant = await f.collection(scope), before = await f.sender(f.ids), archive = await f.download(variant);
		expect(before.photos[0].photo.schemaVersion).toBe(3); expect(before.photos[1].photo.schemaVersion).toBe(1);
		const recipe = active(before.photos[0].photo).develop, unusedBody = before.bodies.find(row => row.reference.width === 3); expect(unusedBody).toBeTruthy();
		const unused = recipe.masks.find(mask => mask.inputs[0].sourceRef === unusedBody.reference.storageKey); expect(unused).toBeTruthy();
		expect(recipe.repairs.spots[0].mode).toBe('heal'); expect(recipe.masks).toHaveLength(2);
		expect(recipe.maskBindings.some(binding => binding.maskId === unused.id)).toBe(false);
		expect(unusedBody.bytes).toEqual(UNBOUND_BODY);
		expect(before.luts).toHaveLength(1); expect(before.luts[0].bytes).toEqual([...CUBE]);
		expect(recipe.effects.find(effect => effect.type === 'cube-lut-profile-v1').enabled).toBe(false);
		verifyArchive(archive.buffer); expect(await f.sender(f.ids)).toEqual(before);
		const framePage = await context.newPage();
		try {
			await installNativeImageHandoffRuntime(framePage); await f.install(framePage);
			await observeNativeSaveWorker(framePage);
			await framePage.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
			const frameErrors = []; framePage.on('pageerror', error => { frameErrors.push(error.message); });
			const words = locale === 'de' ? EDITOR_GERMAN_COPY : EDITOR_ENGLISH_COPY;
			const editor = await bootEditor(framePage, `/framescaper/embed/${locale}/`), initialId = await editor.getAttribute('data-project-id');
			await framePage.bringToFront(); const picker = framePage.waitForEvent('filechooser');
			await chooseCommandAction(framePage, editor, words.fileMenu, words.open); await (await picker).setFiles(archive);
			await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(initialId); await waitForProjectActivation(editor);
			const projectId = await editor.getAttribute('data-project-id'); expect(projectId).toBeTruthy();
			const imported = await f.frame(framePage, projectId); verifySequence(imported, before, variant.ids);
			await framePage.evaluate(() => globalThis.__repairSequenceWorkerTrace.begin());
			const repaired = imported.images.find(image => image.source.provenance.origin.photoId === f.ids[0]);
			const source = repaired.source, clipRow = imported.project.clips.find(clip => clip.sourceId === source.id);
			const clip = editor.locator(`[data-track-lane] [data-clip-id="${clipRow.id}"][role="group"]`);
			await expect(clip).toBeVisible(); await clip.press('Enter'); await clip.click({ button: 'right' });
			await named(framePage, 'menuitem', words.moveToProjectBin).click(); await expect(clip).toHaveCount(0);
			if (!await editor.locator('[data-workspace-panel="project-bin"]').isVisible()) await chooseNestedCommandAction(framePage, editor, words.windowMenu, [words.panelProjectBin]);
			const editedName = 'Native repaired sequence source', rename = named(editor, 'textbox', `${words.projectBinRename}: ${source.name}`);
			await rename.click(); await rename.fill(editedName); await rename.press('Enter');
			await expect(named(editor, 'textbox', `${words.projectBinRename}: ${editedName}`)).toBeVisible();
			try {
				await chooseCommandAction(framePage, editor, words.fileMenu, words.saveProject);
				await expect.poll(async () => (await f.frameScalar(framePage, projectId)).sources.find(value => value.id === source.id).name).toBe(editedName);
				await expect.poll(async () => (await f.frameScalar(framePage, projectId)).revision).toBeGreaterThan(imported.project.revision);
				const trace = await framePage.evaluate(() => globalThis.__repairSequenceWorkerTrace.read());
				expect(trace.observedWorkers).toBeGreaterThan(0); expect(trace.events.some(event => event.direction === 'request' && event.type === 'snapshot')).toBe(true);
			} catch (failure) {
				const observed = await Promise.allSettled([
					framePage.evaluate(() => ({ worker: globalThis.__repairSequenceWorkerTrace.read(), saveState: document.querySelector('[data-save-state]')?.getAttribute('data-state'),
						toasts: [...document.querySelectorAll('[data-editor-toast]')].slice(0, 8).map(node => node.textContent.slice(0, 4096)) })),
					framePage.evaluate(async ({ pathname, projectId }) => (await import(new URL(pathname, location.href).href)).readRepairSequenceFrameFilesNativeV1(projectId), { pathname: PROGRAM, projectId })
				]);
				await test.info().attach('native-sequence-save-failure', { body: Buffer.from(JSON.stringify(observed.map(value => value.status === 'fulfilled'
					? { value: value.value } : { failure: { name: value.reason?.name, message: value.reason?.message } }))), contentType: 'application/json' });
				throw failure;
			} finally { await framePage.evaluate(() => globalThis.__repairSequenceWorkerTrace.end()); }
			const thumbnail = editor.locator('[data-project-bin-visual-canvas]'); await paintedThumbnail(thumbnail);
			const edited = await f.frame(framePage, projectId), changed = edited.images.find(image => image.source.id === source.id);
			expect(changed.source).toEqual({ ...source, name: editedName }); expect(changed.pixels).toEqual(PIXELS);
			expect(edited.resources).toEqual(imported.resources); expect(edited.luts).toEqual(imported.luts); expect(edited.bodies).toEqual(imported.bodies); expect(edited.tokens).toEqual(imported.tokens);
			for (const image of edited.images) expect({ ...image, source: imported.images.find(row => row.source.id === image.source.id).source }).toEqual(imported.images.find(row => row.source.id === image.source.id));
			await framePage.reload(); await expect(editor).toHaveAttribute('data-project-id', projectId); await waitForProjectActivation(editor); await paintedThumbnail(thumbnail);
			expect(await f.frame(framePage, projectId)).toEqual(edited);
			const pending = framePage.waitForEvent('download'); await chooseCommandAction(framePage, editor, words.fileMenu, words.saveScape.replace('{projectExtension}', '.fscape'));
			const saved = await pending, exported = verifyArchive(await readFile(await saved.path()));
			expect(exported.project.sources).toEqual(edited.project.sources); expect(exported.project.clips).toEqual(edited.project.clips);
			for (const row of [...edited.bodies, ...edited.luts]) { const asset = exported.manifest.assets.find(asset => asset.sha256 === row.reference.sha256);
				expect(asset).toBeTruthy(); expect([...exported.entries[asset.entry]]).toEqual(row.bytes); }
			expect(await f.frame(framePage, projectId)).toEqual(edited); expect(await f.sender(f.ids)).toEqual(before);
			await page.bringToFront(); await page.reload(); await expect(f.app).toBeVisible(); await f.showLibrary(); expect(await f.sender(f.ids)).toEqual(before);
			expect(f.errors).toEqual([]); expect(frameErrors).toEqual([]);
		} finally { await framePage.close(); }
	});
}

async function fixture(page, locale) {
	const f = await repairSettingsUiFixtureV1(page, locale), copy = bundledLightscaperEditorCopyForLocale(locale);
	const program = await compileNativeImageHandoffScript('repair-sequence-current-native.js', fileURLToPath(new URL('./helpers/lightscaper-repair-sequence-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]); await install(page);
	await f.openDevelop(); await f.repair('heal'); await f.geometry(); await f.brush(); await f.painted(PIXELS);
	await named(f.develop(), 'combobox', f.words.choose).selectOption('cube-lut-profile-v1'); await keyboard(page, named(f.develop(), 'button', f.words.add));
	await f.develop().getByLabel(f.words.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Sequence disabled.cube', mimeType: 'text/plain', buffer: CUBE });
	await f.painted([137, 137, 137, 255, 137, 137, 137, 255]);
	await uncheck(page, f.develop().locator('[data-photo-develop-effect="cube-lut-profile-v1"] input[type="checkbox"]')); await f.painted(PIXELS);
	await unusedBrush(); await f.painted(PIXELS); await f.save(); await f.closeDevelop(); await showLibrary();
	return { ...f, install, collection, download, showLibrary,
		sender: ids => page.evaluate(async ({ pathname, ids }) => (await import(new URL(pathname, location.href).href))
			.readRepairSequenceSenderNativeV1(ids, () => globalThis.__assertNativeOpfsWorkerExecution()), { pathname: PROGRAM, ids }),
		frame: (recipient, projectId) => recipient.evaluate(async ({ pathname, projectId }) => (await import(new URL(pathname, location.href).href))
			.readRepairSequenceFrameNativeV1(projectId), { pathname: PROGRAM, projectId }),
		frameScalar: (recipient, projectId) => recipient.evaluate(async ({ pathname, projectId }) => (await import(new URL(pathname, location.href).href))
			.readRepairSequenceFrameScalarNativeV1(projectId), { pathname: PROGRAM, projectId }) };
	async function install(recipient) { await recipient.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source })); }
	async function openMenu(label) { await page.bringToFront(); const summary = f.app.getByRole('navigation').getByText(label, { exact: true });
		if (!await summary.locator('..').evaluate(details => details.open)) await summary.click(); await expect(summary.locator('..')).toHaveAttribute('open', ''); }
	async function action(label, menu = copy.photoFileMenu, photo = false) { await openMenu(menu); if (photo) await openMenu(copy.photoPhotoMenu); await keyboard(page, named(f.app, 'button', label)); }
	async function showLibrary() { const library = f.app.locator('[data-photo-library]'); if (!await library.isVisible()) await action(copy.photoShowLibrary, copy.photoViewMenu);
		await expect(library).toHaveAttribute('aria-busy', 'false'); await expect(library.locator('[data-photo-id]')).toHaveCount(2); }
	async function sender() { return page.evaluate(async ({ pathname, ids }) => (await import(new URL(pathname, location.href).href))
		.readRepairSequenceSenderNativeV1(ids, () => globalThis.__assertNativeOpfsWorkerExecution()), { pathname: PROGRAM, ids: f.ids }); }
	async function unusedBrush() {
		const brush = photoDevelopBrushMaskCopy(locale), management = photoDevelopMaskManagementCopy(locale);
		await f.settingsMenu(); await keyboard(page, named(f.develop(), 'button', management.menu)); const previousManager = named(page, 'dialog', management.title);
		await expect(previousManager).toBeVisible(); const previousChooser = named(previousManager, 'combobox', management.mask); await expect(previousChooser.locator('option')).toHaveCount(1);
		const previousIds = await previousChooser.locator('option').evaluateAll(options => options.map(option => option.value)); expect(previousIds).toHaveLength(1);
		await keyboard(page, named(previousManager, 'button', management.close).last()); await expect(previousManager).toHaveCount(0);
		await f.settingsMenu(); await keyboard(page, named(f.develop(), 'button', brush.menu)); const author = named(page, 'dialog', brush.title), grid = named(author, 'img', brush.grid);
		await expect(grid).toHaveAttribute('data-state', 'ready'); await named(author, 'combobox', brush.mask).selectOption('');
		for (const [key, value] of [['width', '3'], ['height', '1']]) await named(author, 'spinbutton', brush[key]).fill(value);
		await keyboard(page, named(author, 'button', brush.create)); await expect(grid).toHaveAttribute('data-state', 'ready');
		for (const [key, value] of [['radius', '.25'], ['hardness', '1'], ['opacity', '1'], ['x', '.5'], ['y', '.5']]) await named(author, 'spinbutton', brush[key]).fill(value);
		await keyboard(page, named(author, 'button', brush.stamp)); await expect(grid).toHaveAttribute('data-state', 'ready');
		expect(await grid.evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 3, 1).data).filter((_byte, index) => index % 4 === 3))).toEqual([0, 255, 0]);
		await check(page, named(author, 'checkbox', `${brush.bind}: ${f.words.shared.videoEffectCubeLutProfile} (2)`));
		await keyboard(page, named(author, 'button', brush.apply)); await expect(author).toHaveCount(0); await f.painted(PIXELS);
		await f.settingsMenu(); await keyboard(page, named(f.develop(), 'button', management.menu)); const manager = named(page, 'dialog', management.title);
		await expect(manager).toBeVisible(); const mask = named(manager, 'combobox', management.mask); await expect(mask.locator('option')).toHaveCount(2);
		const newIds = await mask.locator('option').evaluateAll((options, previous) => options.map(option => option.value).filter(id => !previous.includes(id)), previousIds);
		expect(newIds).toHaveLength(1); await mask.selectOption(newIds[0]); await expect(mask).toHaveValue(newIds[0]);
		await expect(named(manager, 'checkbox', `${management.bind}: ${f.words.shared.videoEffectToneLadder} (1)`)).not.toBeChecked();
		await uncheck(page, named(manager, 'checkbox', `${management.bind}: ${f.words.shared.videoEffectCubeLutProfile} (2)`));
		await keyboard(page, named(manager, 'button', management.apply)); await expect(manager).toHaveCount(0);
	}
	async function collection(scope) {
		const name = scope === 'manual' ? 'Native repaired collection' : 'Native reverse width filter';
		if (scope === 'manual') {
			await action(copy.photoOrganizerTitle); const organizer = named(page, 'dialog', copy.photoOrganizerTitle);
			await named(organizer, 'combobox', copy.photoOrganizerKind).filter({ has: named(page, 'option', copy.photoOrganizerCollection) }).selectOption('collection');
			await keyboard(page, named(organizer, 'button', copy.photoOrganizerCreate).and(organizer.locator('button:not(form button)')));
			await named(organizer, 'textbox', copy.photoOrganizerName).fill(name); await keyboard(page, named(organizer.locator('form'), 'button', copy.photoOrganizerCreate));
			await expect(organizer.locator('[data-organizer-selected]')).toContainText(name); await expect(organizer.getByRole('alert')).toHaveCount(0);
			await keyboard(page, named(organizer.locator('form'), 'button', copy.photoCloseMetadata)); await expect(organizer).toHaveCount(0);
			const definition = (await sender()).root.collections.find(row => row.name === name); expect(definition).toBeTruthy();
			for (let index = 0; index < f.ids.length; index++) {
				await f.select(index); const revision = (await f.photos()).photos[index].photo.revision;
				await action(copy.photoMembershipTitle, copy.photoFileMenu, true); const membership = named(page, 'dialog', copy.photoMembershipTitle);
				await named(membership, 'combobox', copy.photoMembershipTitle).selectOption('collection');
				await keyboard(page, named(membership, 'button', `${copy.photoDefinitionChoose}: ${name}`)); await keyboard(page, named(membership, 'button', copy.photoMembershipAdd));
				await keyboard(page, named(membership, 'button', copy.photoMembershipApply));
				await expect.poll(async () => (await f.photos()).photos[index].photo.revision).toBe(revision + 1);
				await expect(named(membership, 'button', copy.photoMembershipApply)).toBeEnabled(); await expect(membership.getByRole('alert')).toHaveCount(0);
				await keyboard(page, named(membership.locator('form'), 'button', copy.photoCloseMetadata)); await expect(membership).toHaveCount(0);
			}
			await action(copy.photoClearSelection, copy.photoFileMenu, true); return { scope: 'catalog', id: definition.id, name, ids: [...f.ids].sort() };
		}
		await action(copy.photoSaveCurrentFilter, copy.photoViewMenu); const saved = named(page, 'dialog', copy.photoSavedFiltersTitle);
		await named(saved, 'textbox', copy.photoSavedFilterName).fill(name); await keyboard(page, named(saved, 'button', copy.photoOrganizerQueryJson));
		await named(saved, 'textbox', copy.photoOrganizerQueryJson).fill(JSON.stringify(SAVED_QUERY)); await keyboard(page, named(saved, 'button', copy.photoOrganizerQueryJson));
		await keyboard(page, named(saved, 'button', copy.photoSavedFilterSave)); await expect(saved.locator('[data-saved-receipt]')).toContainText(copy.photoSavedFilterSaved);
		await keyboard(page, named(saved, 'button', copy.photoSavedFilterRefreshList)); const id = await named(saved, 'radio', name).inputValue();
		await keyboard(page, named(saved.locator('form'), 'button', copy.photoCloseMetadata)); await expect(saved).toHaveCount(0);
		expect((await sender()).saved.find(row => row.id === id).query).toEqual(SAVED_QUERY);
		await action(copy.photoClearSelection, copy.photoFileMenu, true); return { scope: 'saved-query', id, name, ids: [f.ids[1], f.ids[0]] };
	}
	async function download(variant) {
		const words = photoFramescaperCollectionHandoffCopy(locale); await action(photoFramescaperCollectionHandoffMenuLabel(locale), copy.photoFileMenu, true); const dialog = named(page, 'dialog', words.title);
		await expect(named(dialog, 'button', words.download)).toBeDisabled(); await named(dialog, 'combobox', words.scope).selectOption(variant.scope);
		if (variant.scope === 'catalog') await keyboard(page, named(dialog, 'button', `${copy.photoDefinitionChoose}: ${variant.name} — ${words.manual}`));
		else await named(dialog, 'combobox', words.savedCollection).selectOption(variant.id);
		await expect(named(dialog, 'button', words.download)).toBeEnabled(); const pending = page.waitForEvent('download'); await keyboard(page, named(dialog, 'button', words.download)); const download = await pending;
		expect(download.suggestedFilename()).toBe(`${variant.name}.fscape`); const buffer = await readFile(await download.path());
		await expect(dialog.locator('[data-photo-framescaper-collection-handoff-receipt]')).toHaveAttribute('data-photo-framescaper-collection-handoff-receipt', 'download-started');
		await expect(dialog.getByRole('alert')).toHaveCount(0); await keyboard(page, named(dialog.locator('.lightscaper-catalog-backup-actions'), 'button', words.close)); await expect(dialog).toHaveCount(0);
		return { name: download.suggestedFilename(), mimeType: 'application/vnd.soundscaper.scape+zip', buffer };
	}
}

function verifySequence(value, sender, ids) {
	expect(value.project.sources.map(source => source.provenance.origin.photoId)).toEqual(ids); expect(value.images).toHaveLength(2);
	expect(new Set(value.project.sources.map(source => source.id)).size).toBe(2);
	expect(value.project.clips.map(clip => [clip.sequenceStartFrame, clip.sequenceFrameCount])).toEqual([[0, 150], [150, 150]]);
	expect(value.project.tracks[0].clipIds).toEqual(value.project.clips.map(clip => clip.id));
	for (const [index, image] of value.images.entries()) {
		const row = sender.photos.find(row => row.photo.id === ids[index]), recipe = active(row.photo).develop, repaired = row.photo.schemaVersion === 3;
		expect(image.source.schemaVersion).toBe(repaired ? 3 : 2); expect(image.source.provenance.schemaVersion).toBe(repaired ? 2 : 1);
		expect(image.source.provenance.origin).toEqual({ schemaFamily: 'lightscaper', schemaVersion: row.photo.schemaVersion, catalogId: row.photo.catalogId,
			photoId: row.photo.id, revision: row.photo.revision, versionId: active(row.photo).id, versionKind: active(row.photo).kind, versionName: active(row.photo).name, versionCreatedAt: active(row.photo).createdAt });
		expect(image.source.provenance.developSha256).toBe(sha(JSON.stringify(recipe))); expect(image.source.develop).toEqual(recipe);
		expect(image.source.provenance.origin.versionId).toBe(active(row.photo).id); expect(image.source.original.sha256).toBe(row.original.sha256); expect(image.original.bytes).toEqual(row.bytes);
		const original = repairOriginalReferencePixelsV1(); original.fill(10, 0, 3);
		expect([image.width, image.height]).toEqual(repaired ? [2, 1] : [10, 5]); expect(image.pixels).toEqual(repaired ? PIXELS : original);
	}
	expect(value.resources).toEqual(sender.resources); expect(value.bodies).toEqual(sender.bodies); expect(value.luts).toEqual(sender.luts); expect(value.tokens).toHaveLength(5);
}
function verifyArchive(bytes) {
	const entries = unzipSync(bytes), manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json'])), project = JSON.parse(new TextDecoder().decode(entries['project.json']));
	expect(manifest.format).toBe('scape-project'); expect(manifest.project.schemaFamily).toBe('framescaper');
	for (const asset of manifest.assets) { expect(entries[asset.entry].length).toBe(asset.size); expect(sha(entries[asset.entry])).toBe(asset.sha256); }
	return { entries, manifest, project };
}
async function paintedThumbnail(thumbnail) { await expect(thumbnail).toBeVisible(); await expect.poll(() => thumbnail.evaluate(canvas => {
	const context = canvas.getContext('2d'), y = Math.floor(canvas.height / 2); return [...context.getImageData(Math.floor(canvas.width / 4), y, 1, 1).data,
		...context.getImageData(Math.floor(canvas.width * .75), y, 1, 1).data]; })).toEqual(PIXELS); }
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function shape(browserName) { expect(['chromium', 'firefox']).toContain(browserName); expect(test.info().config.workers).toBe(1); expect(test.info().project.retries).toBe(0); }

async function observeNativeSaveWorker(page) {
	await page.addInitScript(() => {
		const NativeWorker = window.Worker, events = [], wanted = new Set(['snapshot', 'remove', 'abort-writer']); let active = false, dropped = 0, observedWorkers = 0;
		const scalar = value => typeof value === 'string' ? value.slice(0, 256) : null;
		const record = value => { if (!active) return; if (events.length === 256) { events.shift(); dropped++; } events.push(value); };
		globalThis.__repairSequenceWorkerTrace = { begin() { events.length = 0; dropped = 0; active = true; }, end() { active = false; }, read() { return { events: [...events], dropped, observedWorkers }; } };
		const ObservedWorker = new Proxy(NativeWorker, { construct(target, args, newTarget) {
			const worker = Reflect.construct(target, args, newTarget === ObservedWorker ? target : newTarget);
			const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : '';
			if (!/\/opfs-sync-worker(?:\.ts|-[A-Za-z0-9_-]+\.js)$/u.test(new URL(url, location.href).pathname)) return worker;
			observedWorkers++;
			const post = worker.postMessage, requests = new Map(), name = scalar(args[1]?.name), instance = observedWorkers;
			worker.postMessage = function (...params) {
				const message = params[0];
				if (active && message && typeof message === 'object') {
					const row = { worker: name, instance, id: scalar(message.id), type: scalar(message.type), path: scalar(message.path), operationId: scalar(message.operationId) };
					if (requests.size === 256) requests.delete(requests.keys().next().value); requests.set(message.id, row);
					if (wanted.has(message.type)) record({ direction: 'request', ...row });
				}
				return Reflect.apply(post, this, params);
			};
			worker.addEventListener('message', event => {
				const message = event.data, request = requests.get(message?.id); requests.delete(message?.id);
				if (message?.type !== 'error' && !wanted.has(request?.type)) return;
				record({ direction: 'response', worker: name, instance, ...request, id: scalar(message?.id), responseType: scalar(message?.type),
					result: message?.type === 'result' ? { size: message.result?.size, removed: message.result?.removed, operationId: scalar(message.result?.operationId) } : undefined,
					error: message?.type === 'error' ? { name: scalar(message.error?.name), message: scalar(message.error?.message), code: scalar(message.error?.code) } : undefined });
			}); return worker;
		} });
		Object.defineProperty(window, 'Worker', { configurable: true, writable: true, value: ObservedWorker });
	});
}
