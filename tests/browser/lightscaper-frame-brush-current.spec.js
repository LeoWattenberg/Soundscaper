/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { framescaperImageDevelopCopy } from '../../src/common/i18n/framescaper-image-develop-copy.ts';
import { photoDevelopBrushMaskCopy } from '../../src/common/i18n/lightscaper-develop-brush-mask-copy.ts';
import { photoDevelopMaskManagementCopy } from '../../src/common/i18n/lightscaper-develop-mask-management-copy.ts';
import { photoFramescaperHandoffCopy } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { photoFramescaperHandoffMenuLabel } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts';
import { bootEditor, chooseCommandAction, openNestedCommandMenu, getMenuItem, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { expect, test, compileNativeImageHandoffScript, installNativeImageHandoffRuntime } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { repairSettingsUiFixtureV1, active, named, keyboard, uncheck } from './helpers/lightscaper-repair-settings-ui-fixture.js';

const PROGRAM = '/__frame_brush_current_native.js';
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${'0.25 0.25 0.25\n'.repeat(8)}`);
const INITIAL = [255, 255, 255, 255, 137, 137, 137, 255];
const BOTH = [255, 255, 255, 255, 188, 188, 188, 255];
const SECOND = [225, 225, 225, 255, 188, 188, 188, 255];
const NONE = [225, 225, 225, 255, 137, 137, 137, 255];
// Independent exact endpoints: Heal followed by crop/flip leaves linear .75
// and .25. Bound exposure +1 changes only painted cells, yielding white/.5.
// Literal SCMASK01 bytes below use no production encoder or pixel oracle.
const ALL_BODY = body([255, 255]), SECOND_BODY = body([0, 255]);
const DISPLAY = {
	'255,255': { color: [255, 48, 48, 255, 255, 48, 48, 255], grayscale: [255, 255, 255, 255, 255, 255, 255, 255] },
	'0,255': { color: [0, 0, 0, 0, 255, 48, 48, 255], grayscale: [0, 0, 0, 255, 255, 255, 255, 255] },
	'0,0': { color: [0, 0, 0, 0, 0, 0, 0, 0], grayscale: [0, 0, 0, 255, 0, 0, 0, 255] },
};

for (const locale of ['en', 'de']) {
	test(`${locale}: Frame brush menus paint, erase and re-edit immutable bodies with real preview, history and native save/reopen`, async ({ page, context, browserName }) => {
		shape(browserName); test.setTimeout(300000);
		const f = await fixture(page, context, locale);
		try {
			const initial = await f.scalar(), imported = await f.frame(), baseBodies = await f.bodies([f.oldReference]);
			await historyAvailable(f, false);
			let author = await f.openBrush(); await overlayOff(author, f); await makeGrid(author, f);
			await stamp(author, f, 'paint', '.75'); await gridAlpha(author, f, [0, 255]);
			await setToneBinding(author, f, true); await afterPixels(author, SECOND);
			await overlayOn(author, f); await displayed(author, f, SECOND, [0, 255], 'color');
			await choose(f.framePage, named(author, 'combobox', f.mask.displayMode), 'grayscale');
			await displayed(author, f, SECOND, [0, 255], 'grayscale');
			await point(author, f, '.25'); await gridAlpha(author, f, [255, 255]); await displayed(author, f, BOTH, [255, 255], 'grayscale');
			await keyboard(f.framePage, named(author, 'button', f.brush.undo)); await gridAlpha(author, f, [0, 255]);
			await displayed(author, f, SECOND, [0, 255], 'grayscale');
			await keyboard(f.framePage, named(author, 'button', f.brush.redo)); await gridAlpha(author, f, [255, 255]);
			await choose(f.framePage, named(author, 'combobox', f.mask.displayMode), 'color'); await displayed(author, f, BOTH, [255, 255], 'color');
			expect(await f.scalar()).toEqual(initial); expect(await f.bodies([f.oldReference])).toEqual(baseBodies);
			await apply(author, f); await save(f, value => value.source.develop.masks.some(graph => graph.inputs.some(input => input.sourceRef === ALL_BODY.reference.storageKey)), initial.revision);
			const created = await f.frame(); expect(created.pixels).toEqual(BOTH); immutable(created, imported);
			const graph = brushFor(created, ALL_BODY.reference.storageKey), graphId = graph.id;
			expect(graph.inputs).toEqual([{ name: 'paint', kind: 'alpha', sourceRef: ALL_BODY.reference.storageKey }]);
			expect(graph.nodes).toEqual([{ id: graph.outputNodeId, kind: 'alpha', inputName: 'paint' }]);
			expect(created.source.develop.maskBindings).toEqual([{ maskId: graphId, effectId: f.toneId }]);
			const firstBodies = await f.bodies([f.oldReference, ALL_BODY.reference]); expectBody(firstBodies, ALL_BODY); retainedBodies(firstBodies, baseBodies);
			expect(firstBodies.keys).toEqual([f.oldReference.storageKey, ALL_BODY.reference.storageKey].sort());
			await historyAvailable(f, true);

			await chooseCommandAction(f.framePage, f.editor, f.copy.effectMenu, f.entries.masks);
			const manager = named(f.framePage, 'dialog', f.mask.title); await expect(manager).toBeVisible();
			await choose(f.framePage, named(manager, 'combobox', f.mask.mask), graphId);
			await named(manager, 'textbox', f.mask.name).fill('Native Frame brush'); await keyboard(f.framePage, named(manager, 'button', f.mask.rename));
			await keyboard(f.framePage, named(manager, 'button', f.mask.apply)); await expect(manager).toHaveCount(0); await resumed(f.editor);
			await save(f, value => value.source.develop.masks.find(mask => mask.id === graphId)?.name === 'Native Frame brush', created.project.revision);
			const namedFrame = await f.frame(), namedGraph = namedFrame.source.develop.masks.find(mask => mask.id === graphId);
			expect(namedGraph.schemaVersion).toBe(2); expect(namedGraph.name).toBe('Native Frame brush'); expect(namedFrame.pixels).toEqual(BOTH); immutable(namedFrame, imported);
			expect(await f.bodies([f.oldReference, ALL_BODY.reference])).toEqual(firstBodies);

			// Re-edit borrows the exact installed alpha; dimensions and graph/name
			// authority remain fixed. The first erase is explicitly discarded.
			author = await f.openBrush(); await reedit(author, f, graphId, [255, 255]); await overlayOff(author, f);
			await stamp(author, f, 'erase', '.25'); await gridAlpha(author, f, [0, 255]); await afterPixels(author, SECOND);
			const cancelBodies = await f.bodies([f.oldReference, ALL_BODY.reference]);
			await closeAuthor(author, f); expect(await f.frame()).toEqual(namedFrame); expect(await f.bodies([f.oldReference, ALL_BODY.reference])).toEqual(cancelBodies);
			author = await f.openBrush(); await reedit(author, f, graphId, [255, 255]);
			await stamp(author, f, 'erase', '.25'); await gridAlpha(author, f, [0, 255]); await overlayOn(author, f);
			await displayed(author, f, SECOND, [0, 255], 'color'); await apply(author, f);
			await save(f, value => value.source.develop.masks.find(mask => mask.id === graphId)?.inputs[0].sourceRef === SECOND_BODY.reference.storageKey, namedFrame.project.revision);
			const erased = await f.frame(); expect(erased.pixels).toEqual(SECOND); immutable(erased, imported);
			expect(erased.source.develop).toEqual({ ...namedFrame.source.develop,
				masks: namedFrame.source.develop.masks.map(mask => mask.id === graphId ? { ...mask, inputs: [{ ...mask.inputs[0], sourceRef: SECOND_BODY.reference.storageKey }] } : mask) });
			const allReferences = [f.oldReference, ALL_BODY.reference, SECOND_BODY.reference], finalBodies = await f.bodies(allReferences);
			expectBody(finalBodies, SECOND_BODY); retainedBodies(finalBodies, firstBodies); expect(finalBodies.keys).toEqual(allReferences.map(reference => reference.storageKey).sort());

			// No-op Apply reuses the acknowledged body. One subsequent global Undo
			// must reach the prior named recipe, rather than an extra no-op command.
			const beforeNoop = await f.scalar(); author = await f.openBrush(); await reedit(author, f, graphId, [0, 255]); await afterPixels(author, SECOND);
			await apply(author, f); expect(await f.scalar()).toEqual(beforeNoop); expect(await f.bodies(allReferences)).toEqual(finalBodies);
			await chooseCommandAction(f.framePage, f.editor, f.copy.editMenu, f.copy.undo); await resumed(f.editor);
			await save(f, value => JSON.stringify(value.source) === JSON.stringify(namedFrame.source), erased.project.revision);
			const undone = await f.frame(); expect(undone.source).toEqual(namedFrame.source); expect(undone.pixels).toEqual(BOTH); immutable(undone, imported);
			expect(await f.bodies(allReferences)).toEqual(finalBodies);
			const redo = await f.editor.locator('[data-edit="redo"] button').getAttribute('aria-label'); expect(redo).toBeTruthy();
			await chooseCommandAction(f.framePage, f.editor, f.copy.editMenu, redo); await resumed(f.editor);
			await save(f, value => JSON.stringify(value.source) === JSON.stringify(erased.source), undone.project.revision);
			const redone = await f.frame(); expect(redone.source).toEqual(erased.source); expect(redone.pixels).toEqual(SECOND); immutable(redone, imported);
			expect(await f.bodies(allReferences)).toEqual(finalBodies);
			await f.framePage.reload(); await expect(f.editor).toHaveAttribute('data-project-id', f.projectId); await waitForProjectActivation(f.editor);
			await f.clip.press('Enter'); await resumed(f.editor); expect(await f.frame()).toEqual(redone);
			const reopenedBodies = await f.bodies([f.oldReference, SECOND_BODY.reference]); retainedBodies(reopenedBodies, finalBodies, [f.oldReference.storageKey, SECOND_BODY.reference.storageKey]);
			author = await f.openBrush(); await reedit(author, f, graphId, [0, 255]); await overlayOff(author, f); await afterPixels(author, SECOND);
			await closeAuthor(author, f); expect(await f.frame()).toEqual(redone); expect(await f.custody()).toEqual(f.sender);
			expect(f.errors).toEqual([]); expect(f.photo.errors).toEqual([]);
		} finally { await f.framePage.close(); }
	});

	test(`${locale}: Frame brush local preview cancels without installation and joined Close survives a real peer lease takeover`, async ({ page, context, browserName }) => {
		shape(browserName); test.setTimeout(240000);
		const f = await fixture(page, context, locale); let peer;
		try {
			const initial = await f.scalar(), imported = await f.frame(), before = await f.bodies([f.oldReference]);
			let author = await f.openBrush(); await makeGrid(author, f); await stamp(author, f, 'paint', '.75');
			await setToneBinding(author, f, true); await overlayOn(author, f); await displayed(author, f, SECOND, [0, 255], 'color');
			expect(await f.scalar()).toEqual(initial); expect(await f.bodies([f.oldReference])).toEqual(before);
			await closeAuthor(author, f); await historyAvailable(f, false); expect(await f.frame()).toEqual(imported); expect(await f.bodies([f.oldReference])).toEqual(before);

			author = await f.openBrush(); await reedit(author, f, f.oldGraphId, [255, 0]);
			await stamp(author, f, 'erase', '.25'); await gridAlpha(author, f, [0, 0]); await overlayOn(author, f);
			await choose(f.framePage, named(author, 'combobox', f.mask.displayMode), 'grayscale'); await displayed(author, f, NONE, [0, 0], 'grayscale');
			expect(await f.bodies([f.oldReference])).toEqual(before); expect(await f.scalar()).toEqual(initial);
			const canvases = await author.evaluateHandle(node => Array.from(node.querySelectorAll('canvas')));
			try {
				peer = await context.newPage(); peer.on('pageerror', error => { f.errors.push(error.message); });
				await installNativeImageHandoffRuntime(peer); const peerEditor = await bootEditor(peer, `/framescaper/embed/${locale}/`);
				await expect(peerEditor).toHaveAttribute('data-project-id', f.projectId); await waitForProjectActivation(peerEditor);
				await expect(named(author, 'button', f.brush.apply)).toBeDisabled(); await expect(named(author, 'combobox', f.brush.mask)).toBeDisabled();
				await f.framePage.bringToFront(); await keyboard(f.framePage, named(author, 'button', f.brush.close).last()); await expect(author).toHaveCount(0);
				await expect.poll(() => canvases.evaluate(nodes => nodes.every(canvas => canvas.width === 0 && canvas.height === 0))).toBe(true);
			} finally { await canvases.dispose(); }
			await peer.close(); peer = undefined; await resumed(f.editor); await historyAvailable(f, false);
			expect(await f.frame()).toEqual(imported); expect(await f.bodies([f.oldReference])).toEqual(before);
			await f.framePage.reload(); await expect(f.editor).toHaveAttribute('data-project-id', f.projectId); await waitForProjectActivation(f.editor);
			await f.clip.press('Enter'); await resumed(f.editor); expect(await f.frame()).toEqual(imported); expect(await f.bodies([f.oldReference])).toEqual(before);
			expect(await f.custody()).toEqual(f.sender); expect(f.errors).toEqual([]); expect(f.photo.errors).toEqual([]);
		} finally { await peer?.close(); await f.framePage.close(); }
	});
}

async function fixture(page, context, locale) {
	const photo = await repairSettingsUiFixtureV1(page, locale), light = bundledLightscaperEditorCopyForLocale(locale);
	const brush = photoDevelopBrushMaskCopy(locale), mask = photoDevelopMaskManagementCopy(locale), entries = framescaperImageDevelopCopy(locale);
	const program = await compileNativeImageHandoffScript('frame-brush-current-native.js', fileURLToPath(new URL('./helpers/lightscaper-frame-brush-body-reference-current.ts', import.meta.url)));
	expect(program.assets).toEqual([]); await install(page);
	await photo.openDevelop(); await photo.repair('heal'); await photo.geometry(); await photo.brush(); await photo.painted(INITIAL);
	await choose(page, named(photo.develop(), 'combobox', photo.words.choose), 'cube-lut-profile-v1'); await keyboard(page, named(photo.develop(), 'button', photo.words.add));
	await photo.develop().getByLabel(photo.words.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Frame brush retained disabled.cube', mimeType: 'text/plain', buffer: CUBE });
	await photo.painted([137, 137, 137, 255, 137, 137, 137, 255]); await uncheck(page, photo.develop().locator('[data-photo-develop-effect="cube-lut-profile-v1"] input[type="checkbox"]'));
	await photo.painted(INITIAL); await photo.save(); await photo.closeDevelop();
	const sender = await custody(), recipe = active(sender.photos[0].photo).develop;
	expect(sender.photos[0].photo.schemaVersion).toBe(3); expect(recipe.processVersion).toBe(3); expect(recipe.repairs.spots[0].mode).toBe('heal');
	expect(recipe.effects.map(effect => effect.type)).toEqual(['develop-geometry-v1', 'tone-ladder-v1', 'cube-lut-profile-v1']);
	expect(recipe.effects[2].enabled).toBe(false); expect(sender.bodies).toHaveLength(1); expect(sender.luts[0].bytes).toEqual([...CUBE]);
	await menu(light.photoFileMenu); await menu(light.photoPhotoMenu); await keyboard(page, named(photo.app, 'button', photoFramescaperHandoffMenuLabel(locale)));
	const handoff = photoFramescaperHandoffCopy(locale), dialog = named(page, 'dialog', handoff.title), pending = page.waitForEvent('download');
	await keyboard(page, named(dialog, 'button', handoff.download)); const download = await pending;
	const archive = { name: download.suggestedFilename(), mimeType: 'application/vnd.soundscaper.scape+zip', buffer: await readFile(await download.path()) };
	await expect(dialog.locator('[data-photo-framescaper-handoff-receipt]')).toBeVisible(); await keyboard(page, named(dialog, 'button', handoff.close).last());
	const framePage = await context.newPage(), errors = []; framePage.on('pageerror', error => { errors.push(error.message); });
	try {
		await installNativeImageHandoffRuntime(framePage); await install(framePage);
		await framePage.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		const copy = locale === 'de' ? EDITOR_GERMAN_COPY : EDITOR_ENGLISH_COPY;
		const editor = await bootEditor(framePage, `/framescaper/embed/${locale}/`), initialId = await editor.getAttribute('data-project-id');
		await framePage.bringToFront(); const chooser = framePage.waitForEvent('filechooser'); await chooseCommandAction(framePage, editor, copy.fileMenu, copy.open); await (await chooser).setFiles(archive);
		await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(initialId); await waitForProjectActivation(editor);
		const projectId = await editor.getAttribute('data-project-id'); expect(projectId).toBeTruthy(); const first = await scalar(), clipId = first.project.clips[0].id;
		const clip = editor.locator(`[data-track-lane] [data-clip-id="${clipId}"][role="group"]`); await expect(clip).toBeVisible(); await clip.press('Enter'); await resumed(editor);
		const imported = await frame(), oldReference = sender.bodies[0].reference;
		expect(imported.source.develop).toEqual(recipe); expect(imported.pixels).toEqual(INITIAL); expect(imported.original.bytes).toEqual(sender.photos[0].bytes);
		expect(imported.bodies).toEqual(sender.bodies); expect(imported.luts).toEqual(sender.luts);
		const oldGraphId = brushFor(imported, oldReference.storageKey).id, toneId = recipe.effects.find(effect => effect.type === 'tone-ladder-v1').id;
		await expect(named(editor, 'button', entries.brush)).toHaveCount(0);
		return { locale, photo, sender, custody, framePage, editor, projectId, clip, copy, entries, brush, mask, errors, oldReference, oldGraphId, toneId, scalar, frame, bodies,
			async openBrush() { await framePage.bringToFront(); await chooseCommandAction(framePage, editor, copy.effectMenu, entries.brush);
				const author = named(framePage, 'dialog', brush.title); await expect(author).toBeVisible();
				await expect(named(author, 'img', brush.grid)).toHaveAttribute('data-state', 'ready'); return author; } };
		function scalar() { return framePage.evaluate(async ({ pathname, projectId }) => (await import(new URL(pathname, location.href).href)).readRepairFrameProjectScalarNativeV1(projectId), { pathname: PROGRAM, projectId }); }
		function frame() { return framePage.evaluate(async ({ pathname, projectId }) => (await import(new URL(pathname, location.href).href)).readRepairFrameProjectNativeV1(projectId), { pathname: PROGRAM, projectId }); }
		function bodies(references) { return framePage.evaluate(async ({ pathname, projectId, references }) => (await import(new URL(pathname, location.href).href)).readFramescaperBrushBodiesCurrentV1(projectId, references), { pathname: PROGRAM, projectId, references }); }
	} catch (error) { await framePage.close(); throw error; }
	async function install(recipient) { await recipient.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source })); }
	async function custody() { return page.evaluate(async ({ pathname, ids }) => (await import(new URL(pathname, location.href).href)).readRepairFramePhotoCustodyNativeV1(ids,
		() => globalThis.__assertNativeOpfsWorkerExecution()), { pathname: PROGRAM, ids: photo.ids }); }
	async function menu(label) { await page.bringToFront(); const summary = photo.app.getByRole('navigation').getByText(label, { exact: true });
		if (!await summary.locator('..').evaluate(details => details.open)) await keyboard(page, summary); await expect(summary.locator('..')).toHaveAttribute('open', ''); }
}
async function makeGrid(author, f) {
	await choose(f.framePage, named(author, 'combobox', f.brush.mask), '');
	for (const [key, value] of [['width', '2'], ['height', '1']]) await named(author, 'spinbutton', f.brush[key]).fill(value);
	await keyboard(f.framePage, named(author, 'button', f.brush.create)); await gridAlpha(author, f, [0, 0]);
}
async function stamp(author, f, mode, x) {
	await choose(f.framePage, named(author, 'combobox', f.brush.mode), mode);
	for (const [key, value] of [['radius', '.25'], ['hardness', '1'], ['opacity', '1'], ['x', x], ['y', '.5']]) await named(author, 'spinbutton', f.brush[key]).fill(value);
	await keyboard(f.framePage, named(author, 'button', f.brush.stamp));
}
async function point(author, f, x) {
	const grid = named(author, 'img', f.brush.grid); await expect(grid).toHaveAttribute('data-state', 'ready'); await grid.scrollIntoViewIfNeeded();
	const box = await grid.boundingBox(); expect(box).toBeTruthy();
	// Native pointer input uses locator actionability and the visible canvas,
	// including scrolling the dialog after keyboard overlay choices.
	await grid.click({ position: { x: box.width * Number(x), y: box.height * .5 } });
}
async function gridAlpha(author, f, alpha) {
	const grid = named(author, 'img', f.brush.grid); await expect(grid).toHaveAttribute('data-state', 'ready');
	await expect.poll(() => grid.evaluate(canvas => [canvas.width, canvas.height, ...canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.filter((_, index) => index % 4 === 3)])).toEqual([2, 1, ...alpha]);
}
async function setToneBinding(author, f, checked) {
	// Geometry is excluded. The first real binding row is the exact admitted
	// tone effect; its actual runtime aria-label is the keyboard authority.
	const input = author.locator('.lightscaper-brush-mask-bindings > div').first().locator('input[type="checkbox"]').first();
	const label = await input.getAttribute('aria-label'); expect(label).toBeTruthy(); await setChecked(f.framePage, named(author, 'checkbox', label), checked);
}
async function reedit(author, f, id, alpha) {
	await choose(f.framePage, named(author, 'combobox', f.brush.mask), id); await gridAlpha(author, f, alpha);
	for (const [key, value] of [['width', '2'], ['height', '1']]) { await expect(named(author, 'spinbutton', f.brush[key])).toHaveValue(value); await expect(named(author, 'spinbutton', f.brush[key])).toBeDisabled(); }
}
async function overlayOff(author, f) {
	await expect(named(author, 'checkbox', f.brush.showOverlay)).not.toBeChecked(); await expect(named(author, 'combobox', f.mask.displayMode)).toHaveCount(0);
	await expect(author.locator('[data-photo-develop-mask-overlay]')).toBeHidden();
}
async function overlayOn(author, f) {
	await setChecked(f.framePage, named(author, 'checkbox', f.brush.showOverlay), true);
	await expect(named(author, 'combobox', f.brush.overlayEffect)).toHaveValue(''); await choose(f.framePage, named(author, 'combobox', f.brush.overlayEffect), f.toneId);
	await expect(named(author, 'combobox', f.mask.displayMode)).toHaveValue('color');
}
async function afterPixels(author, expected) {
	await expect(author.locator('[data-frame-image-brush-preview]')).toHaveAttribute('data-state', 'ready');
	await expect.poll(() => plane(author.locator('[data-frame-image-brush-after]'))).toEqual([2, 1, ...expected]);
}
async function displayed(author, _f, expected, coverage, mode) {
	await afterPixels(author, expected); const overlay = author.locator('[data-photo-develop-mask-overlay]');
	await expect(overlay).toHaveAttribute('data-mode', mode); await expect(overlay).toHaveAttribute('data-state', 'ready'); await expect(overlay).toBeVisible();
	await expect.poll(() => plane(overlay)).toEqual([2, 1, ...DISPLAY[coverage.join(',')][mode]]);
	expect(await overlay.boundingBox()).toEqual(await author.locator('[data-frame-image-brush-after]').boundingBox());
}
function plane(canvas) { return canvas.evaluate(node => [node.width, node.height, ...(node.width && node.height ? node.getContext('2d').getImageData(0, 0, node.width, node.height).data : [])]); }
async function apply(author, f) { await keyboard(f.framePage, named(author, 'button', f.brush.apply)); await expect(author).toHaveCount(0); await resumed(f.editor); }
async function closeAuthor(author, f) {
	const canvases = await author.evaluateHandle(node => Array.from(node.querySelectorAll('canvas')));
	try { await keyboard(f.framePage, named(author, 'button', f.brush.close).last()); await expect(author).toHaveCount(0);
		await expect.poll(() => canvases.evaluate(nodes => nodes.every(canvas => canvas.width === 0 && canvas.height === 0))).toBe(true);
	} finally { await canvases.dispose(); } await resumed(f.editor);
}
async function choose(_page, control, value) {
	await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused();
	await control.selectOption(value); await expect(control).toHaveValue(value);
}
async function setChecked(page, control, checked) { await expect(control).toBeEnabled(); if (await control.isChecked() !== checked) { await control.focus(); await page.keyboard.press('Space'); }
	if (checked) await expect(control).toBeChecked(); else await expect(control).not.toBeChecked(); }
async function historyAvailable(f, enabled) {
	const menu = await openNestedCommandMenu(f.framePage, f.editor, f.copy.editMenu, []), undo = getMenuItem(menu, f.copy.undo);
	if (enabled) await expect(undo).toBeEnabled(); else await expect(undo).toBeDisabled(); await f.framePage.keyboard.press('Escape'); await expect(menu).toBeHidden();
}
async function save(f, predicate, revision) {
	await chooseCommandAction(f.framePage, f.editor, f.copy.fileMenu, f.copy.saveProject);
	await expect.poll(async () => { const value = await f.scalar(); return predicate(value) && value.revision > revision; }).toBe(true); await resumed(f.editor);
}
async function resumed(editor) {
	const preview = editor.locator('[data-video-preview]'); await expect(preview).toHaveAttribute('data-video-preview-visual-pending', 'false');
	await expect(preview).toHaveAttribute('data-video-preview-visual-error', ''); await expect(preview).toHaveAttribute('data-video-preview-visual-omitted-count', '0');
	await expect(preview).toHaveAttribute('data-active-track-count', '1'); await expect(preview).toHaveAttribute('data-renderable-clip-count', '1');
	await expect(preview).toHaveAttribute('data-video-preview-renderer', /^(?:ready|fallback)$/u);
	if (await preview.getAttribute('data-video-preview-renderer') === 'fallback') expect(await editor.evaluate(() => {
		const gl = document.createElement('canvas').getContext('webgl2'); if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext(); return gl !== null;
	})).toBe(false);
}
function body(alpha) {
	const bytes = Buffer.from([83, 67, 77, 65, 83, 75, 48, 49, 2, 0, 0, 0, 1, 0, 0, 0, ...alpha]);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	return { bytes: [...bytes], reference: { storageKey: `brush-mask-v1:2:1:${sha256}`, sha256, width: 2, height: 1, byteLength: 18 } };
}
function expectBody(value, expected) { const observed = value.bodies.find(body => body.reference.storageKey === expected.reference.storageKey); expect(observed).toBeTruthy();
	expect(observed.reference).toEqual(expected.reference); expect(observed.bytes).toEqual(expected.bytes); expect(observed.record.sha256).toBe(expected.reference.sha256); }
function retainedBodies(value, before, keys = before.bodies.map(body => body.reference.storageKey)) {
	for (const key of keys) expect(value.bodies.find(body => body.reference.storageKey === key)).toEqual(before.bodies.find(body => body.reference.storageKey === key));
}
function brushFor(value, key) { const graph = value.source.develop.masks.find(mask => mask.inputs.some(input => input.sourceRef === key)); expect(graph).toBeTruthy(); return graph; }
function immutable(value, original) {
	expect(value.original).toEqual(original.original); expect(value.luts).toEqual(original.luts);
	for (const row of original.bodies) expect(value.bodies.find(body => body.reference.storageKey === row.reference.storageKey)).toEqual(row);
	for (const token of original.tokens) expect(value.tokens.find(item => item.key === token.key)).toEqual(token);
	expect(value.source.develop.effects).toEqual(original.source.develop.effects); expect(value.source.develop.repairs).toEqual(original.source.develop.repairs);
	expect(value.source.develop.geometry).toEqual(original.source.develop.geometry); expect(value.project.clips).toEqual(original.project.clips); expect(value.project.tracks).toEqual(original.project.tracks);
	const { develop: _develop, developed: _developed, provenance: _provenance, ...pack } = value.source;
	const { develop: _oldDevelop, developed: _oldDeveloped, provenance: _oldProvenance, ...oldPack } = original.source; expect(pack).toEqual(oldPack);
}
function shape(browserName) { expect(['chromium', 'firefox']).toContain(browserName); expect(test.info().config.workers).toBe(1); expect(test.info().project.retries).toBe(0); expect(test.info().retry).toBe(0); }
