/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { framescaperImageDevelopCopy } from '../../src/common/i18n/framescaper-image-develop-copy.ts';
import { photoDevelopRepairSpotsCopy } from '../../src/common/i18n/lightscaper-develop-repair-spots-copy.ts';
import { photoDevelopMaskManagementCopy } from '../../src/common/i18n/lightscaper-develop-mask-management-copy.ts';
import { photoFramescaperHandoffCopy } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { photoFramescaperHandoffMenuLabel } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts';
import { bootEditor, chooseCommandAction, openNestedCommandMenu, getMenuItem, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { expect, test, compileNativeImageHandoffScript, installNativeImageHandoffRuntime } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { repairSettingsUiFixtureV1, active, named, keyboard, uncheck } from './helpers/lightscaper-repair-settings-ui-fixture.js';
import { repairOriginalReferencePixelsV1 } from './helpers/lightscaper-repair-spots-reference.ts';

const PROGRAM = '/__frame_image_develop_current_native.js';
const HEAL = [255, 255, 255, 255, 137, 137, 137, 255], CLONE = [90, 90, 90, 255, 64, 64, 64, 255];
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${'0.25 0.25 0.25\n'.repeat(8)}`);

for (const locale of ['en', 'de']) test(`${locale}: Frame image menus author real Clone and mask names with native history, save/reopen and immutable sender custody`, async ({ page, context, browserName }) => {
	shape(browserName); test.setTimeout(240000);
	const f = await fixture(page, locale), before = await f.custody(), archive = await f.download();
	expect(before.photos[0].photo.schemaVersion).toBe(3); expect(active(before.photos[0].photo).develop.repairs.spots[0].mode).toBe('heal');
	expect(active(before.photos[0].photo).develop.effects.find(effect => effect.type === 'cube-lut-profile-v1').enabled).toBe(false);
	expect(before.luts[0].bytes).toEqual([...CUBE]); expect(before.bodies).toHaveLength(1); expect(await f.custody()).toEqual(before);
	const framePage = await context.newPage();
	try {
		await installNativeImageHandoffRuntime(framePage); await f.install(framePage);
		await framePage.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		const errors = []; framePage.on('pageerror', error => { errors.push(error.message); });
		const copy = locale === 'de' ? EDITOR_GERMAN_COPY : EDITOR_ENGLISH_COPY, entries = framescaperImageDevelopCopy(locale);
		const repair = photoDevelopRepairSpotsCopy(locale), mask = photoDevelopMaskManagementCopy(locale);
		const editor = await bootEditor(framePage, `/framescaper/embed/${locale}/`), initialId = await editor.getAttribute('data-project-id');
		await framePage.bringToFront(); const picker = framePage.waitForEvent('filechooser');
		await chooseCommandAction(framePage, editor, copy.fileMenu, copy.open); await (await picker).setFiles(archive);
		await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(initialId); await waitForProjectActivation(editor);
		const projectId = await editor.getAttribute('data-project-id'); expect(projectId).toBeTruthy();
		const first = await f.scalar(framePage, projectId), clipId = first.project.clips[0].id;
		const clip = editor.locator(`[data-track-lane] [data-clip-id="${clipId}"][role="group"]`); await expect(clip).toBeVisible(); await clip.press('Enter');
		await resumed(editor); const imported = await f.frame(framePage, projectId), source = imported.source;
		expect(imported.pixels).toEqual(HEAL); expect(source.develop).toEqual(active(before.photos[0].photo).develop);
		expect(imported.original.bytes).toEqual(before.photos[0].bytes); expect(imported.bodies).toEqual(before.bodies); expect(imported.luts).toEqual(before.luts);
		await historyAvailable(framePage, editor, copy, false);
		await chooseCommandAction(framePage, editor, copy.effectMenu, entries.repairs);
		let dialog = named(framePage, 'dialog', repair.title); await expect(dialog).toBeVisible(); await originalCanvas(dialog, repair);
		await expect(named(dialog, 'checkbox', repair.visualize)).not.toBeChecked();
		await keyboard(framePage, named(dialog, 'button', repair.apply)); await expect(dialog).toHaveCount(0); await resumed(editor);
		await historyAvailable(framePage, editor, copy, false); expect(await f.scalar(framePage, projectId)).toEqual(first);
		expect(await f.frame(framePage, projectId)).toEqual(imported);
		await chooseCommandAction(framePage, editor, copy.effectMenu, entries.repairs);
		dialog = named(framePage, 'dialog', repair.title); await expect(dialog).toBeVisible(); await originalCanvas(dialog, repair);
		await named(dialog, 'combobox', repair.mode).selectOption('clone');
		for (const [key, value] of [['targetX', '.7'], ['targetY', '.5'], ['sourceX', '.2'], ['sourceY', '.5'], ['radius', '.15'], ['feather', '0'], ['opacity', '1']]) {
			await named(dialog, 'spinbutton', repair[key]).fill(value);
		}
		await keyboard(framePage, named(dialog, 'button', repair.apply)); await expect(dialog).toHaveCount(0); await resumed(editor);
		await historyAvailable(framePage, editor, copy, true);
		await save(framePage, editor, copy, f, projectId, value => value.source.develop.repairs.spots[0].mode === 'clone', first.revision);
		let cloned = await f.frame(framePage, projectId); expect(cloned.pixels).toEqual(CLONE);
		expect(cloned.source.develop).toEqual({ ...source.develop, repairs: { ...source.develop.repairs, spots: source.develop.repairs.spots.map(spot => ({ ...spot, mode: 'clone' })) } });
		frameOrigin(cloned, imported.project.revision, clipId); unchangedBodies(cloned, imported);
		await chooseCommandAction(framePage, editor, copy.editMenu, copy.undo); await resumed(editor);
		await save(framePage, editor, copy, f, projectId, value => value.source.develop.repairs.spots[0].mode === 'heal', cloned.project.revision);
		const undone = await f.frame(framePage, projectId); expect(undone.source).toEqual(source); expect(undone.pixels).toEqual(HEAL); unchangedBodies(undone, imported);
		// The runtime's reviewed Qt catalog can supersede the inventory fallback
		// (German Redo is Wiederherstellen). Read its existing control label and
		// still invoke the actual Edit menu command.
		const redoLabel = await editor.locator('[data-edit="redo"] button').getAttribute('aria-label'); expect(redoLabel).toBeTruthy();
		await chooseCommandAction(framePage, editor, copy.editMenu, redoLabel); await resumed(editor);
		await save(framePage, editor, copy, f, projectId, value => value.source.develop.repairs.spots[0].mode === 'clone', undone.project.revision);
		cloned = await f.frame(framePage, projectId); expect(cloned.pixels).toEqual(CLONE); unchangedBodies(cloned, imported);
		await chooseCommandAction(framePage, editor, copy.effectMenu, entries.masks);
		const manager = named(framePage, 'dialog', mask.title); await expect(manager).toBeVisible();
		await expect(named(manager, 'checkbox', mask.showOverlay)).toHaveCount(1);
		await expect(named(manager, 'checkbox', mask.showOverlay)).not.toBeChecked();
		await expect(named(manager, 'combobox', mask.displayMode)).toHaveCount(0);
		const maskId = cloned.source.develop.masks[0].id, editedName = 'Native Frame painted mask';
		await named(manager, 'combobox', mask.mask).selectOption(maskId); await named(manager, 'textbox', mask.name).fill(editedName);
		await keyboard(framePage, named(manager, 'button', mask.rename)); await expect(named(manager, 'combobox', mask.mask)).toHaveValue(maskId);
		expect((await f.scalar(framePage, projectId)).source).toEqual(cloned.source);
		await keyboard(framePage, named(manager, 'button', mask.apply)); await expect(manager).toHaveCount(0); await resumed(editor);
		await save(framePage, editor, copy, f, projectId, value => value.source.develop.masks.find(graph => graph.id === maskId).name === editedName, cloned.project.revision);
		const edited = await f.frame(framePage, projectId); expect(edited.pixels).toEqual(CLONE); unchangedBodies(edited, imported);
		expect(edited.source.develop).toEqual({ ...cloned.source.develop, masks: cloned.source.develop.masks.map(graph => graph.id === maskId ? { ...graph, schemaVersion: 2, name: editedName } : graph) });
		frameOrigin(edited, cloned.project.revision, clipId); expect(edited.project.clips).toEqual(imported.project.clips); expect(edited.project.tracks).toEqual(imported.project.tracks);
		await framePage.reload(); await expect(editor).toHaveAttribute('data-project-id', projectId); await waitForProjectActivation(editor); await clip.press('Enter'); await resumed(editor);
		expect(await f.frame(framePage, projectId)).toEqual(edited);
		const pending = framePage.waitForEvent('download'); await chooseCommandAction(framePage, editor, copy.fileMenu, copy.saveScape.replace('{projectExtension}', '.fscape'));
		const exported = await pending, entriesByName = unzipSync(await readFile(await exported.path()));
		const manifest = JSON.parse(new TextDecoder().decode(entriesByName['manifest.json'])), project = JSON.parse(new TextDecoder().decode(entriesByName['project.json']));
		expect(manifest.project.schemaFamily).toBe('framescaper'); expect(project.sources).toEqual(edited.project.sources); expect(project.clips).toEqual(edited.project.clips);
		for (const asset of manifest.assets) { expect(entriesByName[asset.entry].length).toBe(asset.size); expect(sha(entriesByName[asset.entry])).toBe(asset.sha256); }
		for (const row of [...edited.bodies, ...edited.luts]) { const asset = manifest.assets.find(asset => asset.sha256 === row.reference.sha256); expect(asset).toBeTruthy(); expect([...entriesByName[asset.entry]]).toEqual(row.bytes); }
		await resumed(editor); expect(await f.frame(framePage, projectId)).toEqual(edited);
		await page.bringToFront(); expect(await f.custody()).toEqual(before); await page.reload(); await expect(f.app).toBeVisible(); await f.showLibrary(); expect(await f.custody()).toEqual(before);
		expect(errors).toEqual([]); expect(f.errors).toEqual([]);
	} finally { await framePage.close(); }
});

async function fixture(page, locale) {
	const f = await repairSettingsUiFixtureV1(page, locale), copy = bundledLightscaperEditorCopyForLocale(locale);
	const program = await compileNativeImageHandoffScript('frame-image-develop-current-native.js', fileURLToPath(new URL('./helpers/lightscaper-repair-frame-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]); await install(page);
	await f.openDevelop(); await f.repair('heal'); await f.geometry(); await f.brush(); await f.painted(HEAL);
	await named(f.develop(), 'combobox', f.words.choose).selectOption('cube-lut-profile-v1'); await keyboard(page, named(f.develop(), 'button', f.words.add));
	await f.develop().getByLabel(f.words.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Frame authoring disabled.cube', mimeType: 'text/plain', buffer: CUBE });
	await f.painted([137, 137, 137, 255, 137, 137, 137, 255]); await uncheck(page, f.develop().locator('[data-photo-develop-effect="cube-lut-profile-v1"] input[type="checkbox"]'));
	await f.painted(HEAL); await f.save(); await f.closeDevelop(); await showLibrary();
	return { ...f, install, showLibrary, download,
		custody: () => page.evaluate(async ({ pathname, ids }) => (await import(new URL(pathname, location.href).href)).readRepairFramePhotoCustodyNativeV1(ids,
			() => globalThis.__assertNativeOpfsWorkerExecution()), { pathname: PROGRAM, ids: f.ids }),
		frame: (recipient, projectId) => recipient.evaluate(async ({ pathname, projectId }) => (await import(new URL(pathname, location.href).href)).readRepairFrameProjectNativeV1(projectId), { pathname: PROGRAM, projectId }),
		scalar: (recipient, projectId) => recipient.evaluate(async ({ pathname, projectId }) => (await import(new URL(pathname, location.href).href)).readRepairFrameProjectScalarNativeV1(projectId), { pathname: PROGRAM, projectId }) };
	async function install(recipient) { await recipient.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source })); }
	async function menu(label) { await page.bringToFront(); const summary = f.app.getByRole('navigation').getByText(label, { exact: true });
		if (!await summary.locator('..').evaluate(details => details.open)) await summary.click(); await expect(summary.locator('..')).toHaveAttribute('open', ''); }
	async function showLibrary() { const library = f.app.locator('[data-photo-library]'); if (!await library.isVisible()) { await menu(copy.photoViewMenu); await keyboard(page, named(f.app, 'button', copy.photoShowLibrary)); }
		await expect(library).toHaveAttribute('aria-busy', 'false'); await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '2'); }
	async function download() {
		const text = photoFramescaperHandoffCopy(locale); await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu);
		await keyboard(page, named(f.app, 'button', photoFramescaperHandoffMenuLabel(locale))); const dialog = named(page, 'dialog', text.title), pending = page.waitForEvent('download');
		await keyboard(page, named(dialog, 'button', text.download)); const download = await pending;
		const archive = { name: download.suggestedFilename(), mimeType: 'application/vnd.soundscaper.scape+zip', buffer: await readFile(await download.path()) };
		await expect(dialog.locator('[data-photo-framescaper-handoff-receipt]')).toBeVisible(); await expect(dialog.getByRole('alert')).toHaveCount(0);
		await keyboard(page, named(dialog, 'button', text.close).last()); return archive;
	}
}
async function originalCanvas(dialog, copy) {
	const canvas = named(dialog, 'img', copy.original); await expect(canvas).toHaveAttribute('data-state', 'ready');
	expect(await canvas.evaluate(node => [node.width, node.height, ...node.getContext('2d').getImageData(0, 0, node.width, node.height).data])).toEqual([10, 5, ...repairOriginalReferencePixelsV1()]);
}
async function resumed(editor) {
	const preview = editor.locator('[data-video-preview]');
	await expect(preview).toHaveAttribute('data-video-preview-visual-pending', 'false'); await expect(preview).toHaveAttribute('data-video-preview-visual-error', '');
	await expect(preview).toHaveAttribute('data-video-preview-visual-omitted-count', '0');
	await expect(preview).toHaveAttribute('data-active-track-count', '1'); await expect(preview).toHaveAttribute('data-renderable-clip-count', '1');
	await expect(preview).toHaveAttribute('data-video-preview-renderer', /^(?:ready|fallback)$/u);
	if (await preview.getAttribute('data-video-preview-renderer') === 'fallback') {
		// Firefox's headless platform can lack WebGL2. Its real visual Session
		// still resolves and joins; literal recipe pixels are verified through
		// the native Frame reader. A working native GL context forbids fallback.
		expect(await editor.evaluate(() => {
			const gl = document.createElement('canvas').getContext('webgl2');
			if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext();
			return gl !== null;
		})).toBe(false);
	}
}
async function historyAvailable(page, editor, copy, expected) {
	const menu = await openNestedCommandMenu(page, editor, copy.editMenu, []), undo = getMenuItem(menu, copy.undo);
	if (expected) await expect(undo).toBeEnabled(); else await expect(undo).toBeDisabled(); await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
}
async function save(page, editor, copy, fixture, projectId, predicate, revision) {
	await chooseCommandAction(page, editor, copy.fileMenu, copy.saveProject);
	await expect.poll(async () => { const value = await fixture.scalar(page, projectId); return predicate(value) && value.revision > revision; }).toBe(true);
	await resumed(editor);
}
function unchangedBodies(value, original) {
	expect(value.original).toEqual(original.original); expect(value.resources).toEqual(original.resources); expect(value.bodies).toEqual(original.bodies);
	expect(value.luts).toEqual(original.luts); expect(value.tokens).toEqual(original.tokens);
	const { develop: _develop, developed: _developed, provenance: _provenance, ...pack } = value.source;
	const { develop: _oldDevelop, developed: _oldDeveloped, provenance: _oldProvenance, ...oldPack } = original.source; expect(pack).toEqual(oldPack);
}
function frameOrigin(value, previousSavedRevision, clipId) {
	// The persisted import row can precede the activated live document. The
	// source records the exact pre-command revision, independently checked
	// against the native saved result of this one-command edit.
	const revision = value.source.provenance.origin.revision;
	expect(revision).toBeGreaterThanOrEqual(previousSavedRevision);
	expect(revision + 1).toBe(value.project.revision);
	expect(value.source.schemaVersion).toBe(3); expect(value.source.provenance.schemaVersion).toBe(2);
	expect(value.source.provenance.origin).toEqual({ schemaFamily: 'framescaper', schemaVersion: 1, projectId: value.project.id,
		revision, sourceId: value.source.id, sequenceId: value.project.clips.find(clip => clip.id === clipId).sequenceId, clipId });
	expect(value.source.provenance.developSha256).toBe(sha(JSON.stringify(value.source.develop)));
}
function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function shape(browserName) { expect(['chromium', 'firefox']).toContain(browserName); expect(test.info().config.workers).toBe(1); expect(test.info().project.retries).toBe(0); }
