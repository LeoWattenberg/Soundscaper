/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { framescaperImageDevelopCopy } from '../../src/common/i18n/framescaper-image-develop-copy.ts';
import { photoDevelopMaskManagementCopy } from '../../src/common/i18n/lightscaper-develop-mask-management-copy.ts';
import { photoDevelopLocalAdjustmentsCopy } from '../../src/common/i18n/lightscaper-develop-local-adjustments-copy.ts';
import { photoFramescaperHandoffCopy } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { photoFramescaperHandoffMenuLabel } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts';
import { bootEditor, chooseCommandAction, openNestedCommandMenu, getMenuItem, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { expect, test, compileNativeImageHandoffScript, installNativeImageHandoffRuntime } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { repairSettingsUiFixtureV1, active, named, keyboard, uncheck } from './helpers/lightscaper-repair-settings-ui-fixture.js';

const PROGRAM = '/__frame_mask_overlay_current_native.js';
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${'0.25 0.25 0.25\n'.repeat(8)}`);
const HEAL = [255, 255, 255, 255, 137, 137, 137, 255];
const UNEXPOSED = [225, 225, 225, 255, 137, 137, 137, 255];
const UNBOUND = [255, 255, 255, 255, 188, 188, 188, 255];
const DISPLAY = {
	'255,0': { grayscale: [255, 255, 255, 255, 0, 0, 0, 255], color: [255, 48, 48, 255, 0, 0, 0, 0] },
	'0,0': { grayscale: [0, 0, 0, 255, 0, 0, 0, 255], color: [0, 0, 0, 0, 0, 0, 0, 0] },
	'0,255': { grayscale: [0, 0, 0, 255, 255, 255, 255, 255], color: [0, 0, 0, 0, 255, 48, 48, 255] },
};
// Independent endpoint oracle. Heal creates target linear luminances .25/.75.
// Tone runs on 10x5 before the real crop/flip to 2x1; range [.5,.9] selects
// the .75 target, while the 2x1 brush's zero half covers both target positions.
// The disabled LUT sees the cropped, already exposed result; its brush maps
// directly to [255,0]. These literals do not invoke the implementation oracle.
const COMPOSITION = [
	{ operation: 'union', tone: [255, 0], lut: [255, 0], pixels: HEAL },
	{ operation: 'subtract', tone: [255, 0], lut: [0, 0], pixels: HEAL },
	{ operation: 'intersect', tone: [0, 0], lut: [255, 0], pixels: UNEXPOSED },
];

for (const locale of ['en', 'de']) {
	test(`${locale}: Frame mask preview shows real repaired effect-stage coverage through suffix geometry and keyboard composition`, async ({ page, context, browserName }) => {
		shape(browserName); test.setTimeout(300000);
		const f = await fixture(page, context, locale);
		try {
			const initial = await f.scalar(), imported = await f.frame(); await historyAvailable(f, false);
			let manager = await f.openManager(); await baseReady(manager, f, HEAL); await overlayOff(manager, f);
			await choose(f.framePage, named(manager, 'combobox', f.mask.mask), f.rangeId);
			await setChecked(f.framePage, named(manager, 'checkbox', f.mask.showOverlay), true);
			await expect(named(manager, 'combobox', f.mask.overlayEffect)).toHaveValue('');
			await expect(named(manager, 'combobox', f.mask.displayMode)).toHaveValue('color');
			await choose(f.framePage, named(manager, 'combobox', f.mask.overlayEffect), f.toneId);
			await displayed(manager, f, HEAL, [255, 0], 'color');
			await choose(f.framePage, named(manager, 'combobox', f.mask.displayMode), 'grayscale');
			await displayed(manager, f, HEAL, [255, 0], 'grayscale');
			await choose(f.framePage, named(manager, 'combobox', f.mask.overlayEffect), f.lutId);
			await displayed(manager, f, HEAL, [0, 0], 'grayscale');
			await choose(f.framePage, named(manager, 'combobox', f.mask.displayMode), 'color');
			await displayed(manager, f, HEAL, [0, 0], 'color'); expect(await f.scalar()).toEqual(initial);

			// Binding edits remain local. Removing tone's mask exposes its global
			// adjustment; the LUT-stage range now selects the second (.5) cell.
			await setChecked(f.framePage, await binding(manager, f.toneId), false);
			await displayed(manager, f, UNBOUND, [0, 255], 'color');
			await setChecked(f.framePage, await binding(manager, f.toneId), true);
			await displayed(manager, f, HEAL, [0, 0], 'color'); expect(await f.scalar()).toEqual(initial);
			await choose(f.framePage, named(manager, 'combobox', f.mask.mask), f.brushId); await overlayOff(manager, f);
			await baseReady(manager, f, HEAL);
			await keyboard(f.framePage, named(manager, 'button', f.mask.apply)); await expect(manager).toHaveCount(0); await resumed(f.editor);
			await historyAvailable(f, false); expect(await f.scalar()).toEqual(initial); expect(await f.frame()).toEqual(imported);

			let last;
			for (const [index, oracle] of COMPOSITION.entries()) {
				manager = await f.openManager(); await choose(f.framePage, named(manager, 'combobox', f.mask.mask), f.rangeId);
				await choose(f.framePage, named(manager, 'combobox', f.mask.operand), f.brushId);
				await keyboard(f.framePage, named(manager, 'button', f.mask[oracle.operation === 'union' ? 'add' : oracle.operation]));
				await setChecked(f.framePage, named(manager, 'checkbox', f.mask.showOverlay), true);
				await choose(f.framePage, named(manager, 'combobox', f.mask.overlayEffect), f.toneId);
				await choose(f.framePage, named(manager, 'combobox', f.mask.displayMode), 'grayscale');
				await displayed(manager, f, oracle.pixels, oracle.tone, 'grayscale');
				await choose(f.framePage, named(manager, 'combobox', f.mask.overlayEffect), f.lutId);
				await displayed(manager, f, oracle.pixels, oracle.lut, 'grayscale');
				await choose(f.framePage, named(manager, 'combobox', f.mask.displayMode), 'color');
				await displayed(manager, f, oracle.pixels, oracle.lut, 'color');
				const unchanged = await f.scalar(); expect(unchanged.source).toEqual(imported.source);
				await keyboard(f.framePage, named(manager, 'button', f.mask.apply)); await expect(manager).toHaveCount(0); await resumed(f.editor);
				await save(f, value => outputOperation(value.source.develop, f.rangeId) === oracle.operation, unchanged.revision);
				last = await f.frame(); expect(last.pixels).toEqual(oracle.pixels); unchangedBodies(last, imported);
				expect(last.source.develop.effects).toEqual(imported.source.develop.effects);
				expect(last.source.develop.repairs).toEqual(imported.source.develop.repairs);
				expect(last.source.develop.maskBindings).toEqual(imported.source.develop.maskBindings);
				expect(last.source.develop.masks.find(graph => graph.id === f.brushId)).toEqual(imported.source.develop.masks.find(graph => graph.id === f.brushId));
				expect(last.source.provenance.origin.schemaFamily).toBe('framescaper');
				await historyAvailable(f, true);
				await chooseCommandAction(f.framePage, f.editor, f.copy.editMenu, f.copy.undo); await resumed(f.editor);
				await save(f, value => JSON.stringify(value.source) === JSON.stringify(imported.source), last.project.revision);
				const undone = await f.frame(); expect(undone.source).toEqual(imported.source); expect(undone.pixels).toEqual(HEAL); unchangedBodies(undone, imported);
				if (index === COMPOSITION.length - 1) {
					const label = await f.editor.locator('[data-edit="redo"] button').getAttribute('aria-label'); expect(label).toBeTruthy();
					await chooseCommandAction(f.framePage, f.editor, f.copy.editMenu, label); await resumed(f.editor);
					await save(f, value => outputOperation(value.source.develop, f.rangeId) === oracle.operation, undone.project.revision);
					last = await f.frame(); expect(last.pixels).toEqual(UNEXPOSED); unchangedBodies(last, imported);
				}
			}
			expect(last).toBeTruthy();
			await f.framePage.reload(); await expect(f.editor).toHaveAttribute('data-project-id', f.projectId);
			await waitForProjectActivation(f.editor); await f.clip.press('Enter'); await resumed(f.editor); expect(await f.frame()).toEqual(last);
			manager = await f.openManager(); await overlayOff(manager, f); await baseReady(manager, f, UNEXPOSED);
			await choose(f.framePage, named(manager, 'combobox', f.mask.mask), f.rangeId);
			await setChecked(f.framePage, named(manager, 'checkbox', f.mask.showOverlay), true);
			await choose(f.framePage, named(manager, 'combobox', f.mask.overlayEffect), f.lutId);
			await choose(f.framePage, named(manager, 'combobox', f.mask.displayMode), 'grayscale');
			await displayed(manager, f, UNEXPOSED, [255, 0], 'grayscale');
			await closeManager(manager, f); expect(await f.frame()).toEqual(last);
			expect(await f.custody()).toEqual(f.sender); expect(f.errors).toEqual([]); expect(f.photo.errors).toEqual([]);
		} finally { await f.framePage.close(); }
	});

	test(`${locale}: Frame temporary mask display cancels, applies without history and retires on actual peer lease takeover`, async ({ page, context, browserName }) => {
		shape(browserName); test.setTimeout(240000);
		const f = await fixture(page, context, locale); let peer;
		try {
			const initial = await f.scalar(), imported = await f.frame();
			let manager = await f.openManager(); await choose(f.framePage, named(manager, 'combobox', f.mask.mask), f.rangeId);
			await choose(f.framePage, named(manager, 'combobox', f.mask.operand), f.brushId); await keyboard(f.framePage, named(manager, 'button', f.mask.intersect));
			await setChecked(f.framePage, named(manager, 'checkbox', f.mask.showOverlay), true);
			await choose(f.framePage, named(manager, 'combobox', f.mask.overlayEffect), f.toneId);
			await displayed(manager, f, UNEXPOSED, [0, 0], 'color'); expect(await f.scalar()).toEqual(initial);
			await closeManager(manager, f); await historyAvailable(f, false); expect(await f.frame()).toEqual(imported);
			manager = await f.openManager(); await overlayOff(manager, f); await baseReady(manager, f, HEAL);
			await choose(f.framePage, named(manager, 'combobox', f.mask.mask), f.rangeId);
			await setChecked(f.framePage, named(manager, 'checkbox', f.mask.showOverlay), true);
			await choose(f.framePage, named(manager, 'combobox', f.mask.overlayEffect), f.toneId);
			await choose(f.framePage, named(manager, 'combobox', f.mask.displayMode), 'grayscale');
			await displayed(manager, f, HEAL, [255, 0], 'grayscale');
			await keyboard(f.framePage, named(manager, 'button', f.mask.apply)); await expect(manager).toHaveCount(0); await resumed(f.editor);
			await historyAvailable(f, false); expect(await f.scalar()).toEqual(initial); expect(await f.frame()).toEqual(imported);

			manager = await f.openManager(); await choose(f.framePage, named(manager, 'combobox', f.mask.mask), f.rangeId);
			await setChecked(f.framePage, named(manager, 'checkbox', f.mask.showOverlay), true);
			await choose(f.framePage, named(manager, 'combobox', f.mask.overlayEffect), f.toneId);
			await displayed(manager, f, HEAL, [255, 0], 'color');
			peer = await context.newPage(); peer.on('pageerror', error => { f.errors.push(error.message); });
			await installNativeImageHandoffRuntime(peer); const peerEditor = await bootEditor(peer, `/framescaper/embed/${locale}/`);
			await expect(peerEditor).toHaveAttribute('data-project-id', f.projectId); await waitForProjectActivation(peerEditor);
			await expect(named(manager, 'button', f.mask.apply)).toBeDisabled();
			await expect(named(manager, 'combobox', f.mask.mask)).toBeDisabled();
			await expect.poll(async () => manager.locator('[data-frame-image-develop-after], [data-photo-develop-mask-overlay]')
				.evaluateAll(canvases => canvases.every(canvas => canvas.width === 0 && canvas.height === 0))).toBe(true);
			expect(await f.scalar()).toEqual(initial);
			await f.framePage.bringToFront(); await keyboard(f.framePage, named(manager, 'button', f.mask.close).last()); await expect(manager).toHaveCount(0);
			await peer.close(); peer = undefined; await resumed(f.editor); await historyAvailable(f, false);
			expect(await f.frame()).toEqual(imported);
			await f.framePage.reload(); await expect(f.editor).toHaveAttribute('data-project-id', f.projectId);
			await waitForProjectActivation(f.editor); await f.clip.press('Enter'); await resumed(f.editor); expect(await f.frame()).toEqual(imported);
			expect(await f.custody()).toEqual(f.sender); expect(f.errors).toEqual([]); expect(f.photo.errors).toEqual([]);
		} finally { await peer?.close(); await f.framePage.close(); }
	});
}

async function fixture(page, context, locale) {
	const photo = await repairSettingsUiFixtureV1(page, locale), lightCopy = bundledLightscaperEditorCopyForLocale(locale);
	const mask = photoDevelopMaskManagementCopy(locale), range = photoDevelopLocalAdjustmentsCopy(locale, 'luminance-range');
	const program = await compileNativeImageHandoffScript('frame-mask-overlay-current-native.js', fileURLToPath(new URL('./helpers/lightscaper-repair-frame-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]); await install(page);
	await photo.openDevelop(); await photo.repair('heal'); await photo.geometry(); await photo.brush(); await photo.painted(HEAL);
	await photo.settingsMenu(); await keyboard(page, named(photo.develop(), 'button', range.menu)); const donor = named(page, 'dialog', range.title);
	for (const [caption, value] of [[range.lower, '.5'], [range.upper, '.9'], [range.falloff, '0']]) await named(donor, 'spinbutton', caption).fill(value);
	await setChecked(page, named(donor, 'checkbox', `${range.bind}: ${photo.words.shared.videoEffectToneLadder} (1)`), true);
	await keyboard(page, named(donor, 'button', range.apply)); await expect(donor).toHaveCount(0);
	const geometryRow = photo.develop().locator('[data-photo-develop-effect="develop-geometry-v1"]'); await expect(geometryRow).toHaveCount(1);
	const geometryDownLabel = await geometryRow.getByRole('button').filter({ hasText: '↓' }).getAttribute('aria-label'); expect(geometryDownLabel).toBeTruthy();
	await keyboard(page, named(geometryRow, 'button', geometryDownLabel)); await photo.painted(HEAL);
	await choose(page, named(photo.develop(), 'combobox', photo.words.choose), 'cube-lut-profile-v1'); await keyboard(page, named(photo.develop(), 'button', photo.words.add));
	await photo.develop().getByLabel(photo.words.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Overlay retained disabled.cube', mimeType: 'text/plain', buffer: CUBE });
	await photo.painted([137, 137, 137, 255, 137, 137, 137, 255]); await uncheck(page, photo.develop().locator('[data-photo-develop-effect="cube-lut-profile-v1"] input[type="checkbox"]'));
	await photo.painted(HEAL); await photo.save();
	const version = active((await photo.photos()).photos[0].photo), rangeId = version.develop.masks.find(graph => graph.nodes.some(node => node.kind === 'luminance-range')).id;
	const brushId = version.develop.masks.find(graph => graph.inputs.length !== 0).id;
	const toneId = version.develop.effects.find(effect => effect.type === 'tone-ladder-v1').id, lutId = version.develop.effects.find(effect => effect.type === 'cube-lut-profile-v1').id;
	await photo.settingsMenu(); await keyboard(page, named(photo.develop(), 'button', mask.menu)); const manager = named(page, 'dialog', mask.title);
	await choose(page, named(manager, 'combobox', mask.mask), rangeId); await setChecked(page, await binding(manager, lutId), true);
	await keyboard(page, named(manager, 'button', mask.apply)); await expect(manager).toHaveCount(0); await photo.painted(HEAL); await photo.save(); await photo.closeDevelop();
	const sender = await custody(), recipe = active(sender.photos[0].photo).develop;
	expect(sender.photos[0].photo.schemaVersion).toBe(3); expect(recipe.processVersion).toBe(3); expect(recipe.repairs.spots[0].mode).toBe('heal');
	expect(recipe.effects.map(effect => effect.type)).toEqual(['tone-ladder-v1', 'develop-geometry-v1', 'cube-lut-profile-v1']);
	expect(recipe.effects[2].enabled).toBe(false); expect(sender.luts[0].bytes).toEqual([...CUBE]); expect(sender.bodies).toHaveLength(1);
	await menu(lightCopy.photoFileMenu); await menu(lightCopy.photoPhotoMenu); await keyboard(page, named(photo.app, 'button', photoFramescaperHandoffMenuLabel(locale)));
	const handoff = photoFramescaperHandoffCopy(locale), dialog = named(page, 'dialog', handoff.title), waiting = page.waitForEvent('download');
	await keyboard(page, named(dialog, 'button', handoff.download)); const download = await waiting;
	const archive = { name: download.suggestedFilename(), mimeType: 'application/vnd.soundscaper.scape+zip', buffer: await readFile(await download.path()) };
	await expect(dialog.locator('[data-photo-framescaper-handoff-receipt]')).toBeVisible(); await keyboard(page, named(dialog, 'button', handoff.close).last());
	const framePage = await context.newPage(), errors = []; framePage.on('pageerror', error => { errors.push(error.message); });
	await installNativeImageHandoffRuntime(framePage); await install(framePage);
	await framePage.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
	const copy = locale === 'de' ? EDITOR_GERMAN_COPY : EDITOR_ENGLISH_COPY, entries = framescaperImageDevelopCopy(locale);
	const editor = await bootEditor(framePage, `/framescaper/embed/${locale}/`), initialId = await editor.getAttribute('data-project-id');
	await framePage.bringToFront(); const picker = framePage.waitForEvent('filechooser');
	await chooseCommandAction(framePage, editor, copy.fileMenu, copy.open); await (await picker).setFiles(archive);
	await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(initialId); await waitForProjectActivation(editor);
	const projectId = await editor.getAttribute('data-project-id'); expect(projectId).toBeTruthy(); const first = await scalar(), clipId = first.project.clips[0].id;
	const clip = editor.locator(`[data-track-lane] [data-clip-id="${clipId}"][role="group"]`); await expect(clip).toBeVisible(); await clip.press('Enter'); await resumed(editor);
	const imported = await frame(); expect(imported.source.develop).toEqual(recipe); expect(imported.pixels).toEqual(HEAL);
	expect(imported.original.bytes).toEqual(sender.photos[0].bytes); expect(imported.bodies).toEqual(sender.bodies); expect(imported.luts).toEqual(sender.luts);
	return { locale, photo, sender, custody, framePage, editor, projectId, clip, copy, mask, rangeId, brushId, toneId, lutId, errors, scalar, frame,
		async openManager() { await framePage.bringToFront(); await chooseCommandAction(framePage, editor, copy.effectMenu, entries.masks);
			const manager = named(framePage, 'dialog', mask.title); await expect(manager).toBeVisible(); return manager; } };
	async function install(recipient) { await recipient.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source })); }
	async function menu(label) { await page.bringToFront(); const summary = photo.app.getByRole('navigation').getByText(label, { exact: true });
		if (!await summary.locator('..').evaluate(details => details.open)) await summary.click(); await expect(summary.locator('..')).toHaveAttribute('open', ''); }
	function custody() { return page.evaluate(async ({ pathname, ids }) => (await import(new URL(pathname, location.href).href)).readRepairFramePhotoCustodyNativeV1(ids,
		() => globalThis.__assertNativeOpfsWorkerExecution()), { pathname: PROGRAM, ids: photo.ids }); }
	function scalar() { return framePage.evaluate(async ({ pathname, projectId }) => (await import(new URL(pathname, location.href).href)).readRepairFrameProjectScalarNativeV1(projectId), { pathname: PROGRAM, projectId }); }
	function frame() { return framePage.evaluate(async ({ pathname, projectId }) => (await import(new URL(pathname, location.href).href)).readRepairFrameProjectNativeV1(projectId), { pathname: PROGRAM, projectId }); }
}

async function binding(manager, effectId) {
	const label = await manager.locator(`[data-photo-develop-mask-binding="${effectId}"]`).getAttribute('aria-label'); expect(label).toBeTruthy();
	return named(manager, 'checkbox', label);
}
async function choose(page, control, value) {
	await expect(control).toBeEnabled(); const index = await control.locator('option').evaluateAll((options, value) => options.findIndex(option => option.value === value), value);
	expect(index).toBeGreaterThanOrEqual(0); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Home');
	for (let position = 0; position < index; position++) await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await expect(control).toHaveValue(value);
}
async function setChecked(page, control, expected) {
	await expect(control).toBeEnabled(); if (await control.isChecked() !== expected) { await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Space'); }
	if (expected) await expect(control).toBeChecked(); else await expect(control).not.toBeChecked();
}
async function overlayOff(manager, f) {
	await expect(named(manager, 'checkbox', f.mask.showOverlay)).not.toBeChecked(); await expect(named(manager, 'combobox', f.mask.displayMode)).toHaveCount(0);
	await expect(manager.locator('[data-photo-develop-mask-overlay]:visible')).toHaveCount(0);
}
async function baseReady(manager, f, pixels) {
	await expect(manager.locator('[data-frame-image-develop-preview]')).toHaveAttribute('data-state', 'ready');
	await expect.poll(() => canvasPixels(named(manager, 'img', f.photo.words.after))).toEqual([2, 1, ...pixels]);
}
async function displayed(manager, f, pixels, coverage, mode) {
	await baseReady(manager, f, pixels);
	const label = mode === 'grayscale' ? f.mask.grayscale : photoDevelopLocalAdjustmentsCopy(f.locale).maskOverlay;
	const overlay = named(manager, 'img', label); await expect(overlay).toBeVisible(); await expect(overlay).toHaveAttribute('data-state', 'ready'); await expect(overlay).toHaveAttribute('data-mode', mode);
	await expect.poll(() => canvasPixels(overlay)).toEqual([2, 1, ...DISPLAY[coverage.join(',')][mode]]);
	expect(await overlay.boundingBox()).toEqual(await named(manager, 'img', f.photo.words.after).boundingBox());
	expect(await overlay.evaluate(canvas => getComputedStyle(canvas).opacity)).toBe(mode === 'grayscale' ? '1' : '0.45');
}
function canvasPixels(canvas) { return canvas.evaluate(node => [node.width, node.height, ...(node.width && node.height ? node.getContext('2d').getImageData(0, 0, node.width, node.height).data : [])]); }
async function closeManager(manager, f) { await keyboard(f.framePage, named(manager, 'button', f.mask.close).last()); await expect(manager).toHaveCount(0); await resumed(f.editor); }
async function historyAvailable(f, expected) {
	const menu = await openNestedCommandMenu(f.framePage, f.editor, f.copy.editMenu, []), undo = getMenuItem(menu, f.copy.undo);
	if (expected) await expect(undo).toBeEnabled(); else await expect(undo).toBeDisabled(); await f.framePage.keyboard.press('Escape'); await expect(menu).toBeHidden();
}
async function save(f, predicate, revision) {
	await chooseCommandAction(f.framePage, f.editor, f.copy.fileMenu, f.copy.saveProject);
	await expect.poll(async () => { const value = await f.scalar(); return predicate(value) && value.revision > revision; }).toBe(true); await resumed(f.editor);
}
function outputOperation(develop, maskId) { const graph = develop.masks.find(graph => graph.id === maskId); return graph.nodes.find(node => node.id === graph.outputNodeId).operation ?? null; }
function unchangedBodies(value, original) {
	for (const key of ['original', 'resources', 'bodies', 'luts', 'tokens']) expect(value[key]).toEqual(original[key]);
	const { develop: _develop, developed: _developed, provenance: _provenance, ...pack } = value.source;
	const { develop: _old, developed: _oldSize, provenance: _oldOrigin, ...previous } = original.source; expect(pack).toEqual(previous);
	expect(value.project.clips).toEqual(original.project.clips); expect(value.project.tracks).toEqual(original.project.tracks);
	expect(value.source.provenance.developSha256).toBe(createHash('sha256').update(JSON.stringify(value.source.develop)).digest('hex'));
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
function shape(browserName) { expect(['chromium', 'firefox']).toContain(browserName); expect(test.info().config.workers).toBe(1);
	expect(test.info().retry).toBe(0); expect(test.info().project.retries).toBe(0); }
