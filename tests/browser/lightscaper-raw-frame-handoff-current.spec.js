/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { EDITOR_ENGLISH_COPY as FRAME } from '../../src/common/i18n/editor-copy-inventory.ts';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopLocalAdjustmentsCopy } from '../../src/common/i18n/lightscaper-develop-local-adjustments-copy.ts';
import { photoDevelopRepairSpotsCopy } from '../../src/common/i18n/lightscaper-develop-repair-spots-copy.ts';
import { photoDevelopMaskManagementCopy } from '../../src/common/i18n/lightscaper-develop-mask-management-copy.ts';
import { framescaperImageDevelopCopy } from '../../src/common/i18n/framescaper-image-develop-copy.ts';
import { photoFramescaperHandoffCopy, photoFramescaperReceiveCopy } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { photoFramescaperHandoffMenuLabel, photoFramescaperReceiveMenuLabel } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts';
import { decodeLibRawOriginalWasmV1 } from '../../src/common/editor/raw/libraw-wasm-instance-v1.ts';
import { rawDngFixtureV1 } from '../helpers/lightscaper-raw-dng-current-fixture.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';

test.use({ browserCoverage: false });
const PROGRAM = '/__raw_frame_handoff_current_reference.js', NAME = 'Oriented native sensor.dng', LOCALE = 'en';
const ORIGINAL = Buffer.from(rawDngFixtureV1(6).bytes), ORIGINAL_SHA = sha(ORIGINAL);
let program, wasm, manifest, native, originalDisplay, developed, cloned;
test.beforeAll(async () => {
	manifest = JSON.parse(await readFile(new URL('../../config/lightscaper-libraw-runtime-manifest.json', import.meta.url), 'utf8'));
	wasm = await readFile(new URL(`../../${manifest.runtime.path}`, import.meta.url));
	expect(wasm.length).toBe(manifest.runtime.byteLength); expect(sha(wasm)).toBe(manifest.runtime.sha256);
	const moduleInput = new Uint8Array(wasm), nativeInput = new Uint8Array(ORIGINAL);
	let decoded;
	try { decoded = decodeLibRawOriginalWasmV1(await WebAssembly.compile(moduleInput), nativeInput); }
	finally { moduleInput.fill(0); nativeInput.fill(0); }
	try { native = { descriptor: decoded.frame.descriptor, rawFlip: decoded.rawFlip, words: [...decoded.frame.pixels] }; }
	finally { decoded.frame.pixels.fill(0); }
	expect(native.rawFlip).toBe(6); originalDisplay = display(native.words.map(word => word / 65535));
	developed = oracle(native.words, false); cloned = oracle(native.words, true); expect(cloned).not.toEqual(developed);
	program = await compileNativeImageHandoffScript('raw-frame-handoff-current-reference.js', fileURLToPath(new URL('./helpers/lightscaper-raw-frame-handoff-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

test('actual RAW menus preserve Source4 through native Frame Clone, save/reopen and reverse Photo3 Original custody', async ({ page, context, browserName }) => {
	test.skip(browserName === 'webkit', 'This native RAW handoff qualifies Chromium and Firefox.'); test.setTimeout(240_000);
	const copy = bundledLightscaperEditorCopyForLocale(LOCALE), words = photoDevelopCopy(LOCALE), repair = photoDevelopRepairSpotsCopy(LOCALE);
	const settings = photoDevelopSettingsCopy(LOCALE, 'current3'), gradient = photoDevelopLocalAdjustmentsCopy(LOCALE), errors = [], workers = [], activeWorkers = new Set();
	await install(page); await page.goto(resolveBrowserProductTestUrl('/lightscaper/en/'));
	const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos)); const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: ORIGINAL });
	await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const card = app.locator('[data-photo-id]'); await expect(card).toHaveCount(1); await library(1); await keyboard(page, card);
	const senderId = await card.getAttribute('data-photo-id'); expect(senderId).toBeTruthy(); const initial = await photos([senderId]);
	expect(initial.photos[0].bytes).toEqual([...ORIGINAL]); expect(initial.photos[0].photo.original.mimeType).toBe('image/x-adobe-dng');
	await photoAction(photoDevelopMenuLabel(LOCALE), true); const dialog = named(page, 'dialog', `${words.title}: ${NAME}`);
	const before = named(dialog, 'img', words.before), after = named(dialog, 'img', words.after), preview = dialog.locator('[data-photo-develop-preview]');
	await expect(preview).toHaveAttribute('data-state', 'ready'); await expect.poll(() => plane(before)).toEqual([32, 32, ...originalDisplay]);
	await named(dialog, 'combobox', words.choose).selectOption('white-balance-v1'); await keyboard(page, named(dialog, 'button', words.add));
	await number('videoEffectParamTemperature', '100');
	await named(dialog, 'combobox', words.choose).selectOption('tone-ladder-v1'); await keyboard(page, named(dialog, 'button', words.add));
	await number('videoEffectParamExposure', '-1'); await expect.poll(() => plane(after)).toEqual([32, 32, ...developed]);
	// The mask has full coverage at every pixel centre; explicitly naming it
	// through Manage masks promotes the recipe to Process2 before saving.
	// Its binding remains in Source4 and in the later explicit repair promotion.
	await keyboard(page, dialog.getByText(settings.menu, { exact: true })); await keyboard(page, named(dialog, 'button', gradient.menu));
	const local = named(page, 'dialog', gradient.title);
	for (const [field, value] of [['startX', '0'], ['startY', '.5'], ['endX', '.01'], ['endY', '.5']]) await named(local, 'spinbutton', gradient[field]).fill(value);
	const bind = named(local, 'checkbox', `${gradient.bind}: ${words.shared.videoEffectToneLadder} (2)`);
	await bind.focus(); await page.keyboard.press('Space'); await expect(bind).toBeChecked(); await keyboard(page, named(local, 'button', gradient.apply)); await expect(local).toHaveCount(0);
	const maskCopy = photoDevelopMaskManagementCopy(LOCALE), settingsControl = dialog.getByText(settings.menu, { exact: true });
	if (!await settingsControl.locator('..').evaluate(node => node.open)) await keyboard(page, settingsControl);
	await keyboard(page, named(dialog, 'button', maskCopy.menu)); const naming = named(page, 'dialog', maskCopy.title);
	await named(naming, 'textbox', maskCopy.name).fill('Native tone coverage'); await keyboard(page, named(naming, 'button', maskCopy.rename));
	await keyboard(page, named(naming, 'button', maskCopy.apply)); await expect(naming).toHaveCount(0);
	await expect.poll(() => plane(after)).toEqual([32, 32, ...developed]); expect(await photos([senderId])).toEqual(initial);
	await keyboard(page, named(dialog, 'button', words.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toBeVisible();
	await keyboard(page, named(dialog, 'button', words.close).last()); await expect(dialog).toHaveCount(0);
	const saved = await photos([senderId]), savedRecipe = active(saved.photos[0].photo).develop;
	expect(savedRecipe.processVersion).toBe(2); expect(savedRecipe.masks[0].name).toBe('Native tone coverage');
	expect(savedRecipe.maskBindings).toHaveLength(1); expect(saved.photos[0].bytes).toEqual([...ORIGINAL]);
	await photoAction(photoFramescaperHandoffMenuLabel(LOCALE), true); const handoffCopy = photoFramescaperHandoffCopy(LOCALE), handoff = named(page, 'dialog', handoffCopy.title);
	const waiting = page.waitForEvent('download'); await keyboard(page, named(handoff, 'button', handoffCopy.download)); const download = await waiting;
	const archive = { name: download.suggestedFilename(), mimeType: 'application/vnd.soundscaper.scape+zip', buffer: await readFile(await download.path()) };
	await expect(handoff.locator('[data-photo-framescaper-handoff-receipt]')).toBeVisible(); await keyboard(page, named(handoff, 'button', handoffCopy.close).last());
	expect(await photos([senderId])).toEqual(saved);
	const entries = unzipSync(archive.buffer), source = JSON.parse(new TextDecoder().decode(entries['project.json'])).sources[0];
	expect(source.schemaVersion).toBe(4); expect(source.develop).toEqual(savedRecipe); expect(source.raw.rawFlip).toBe(6);
	expect(source.raw.descriptor).toEqual(native.descriptor); expect(source.raw.pixelsSha256).toBe(nativeDigest(native.words));
	expect(source.provenance.original).toEqual({ exactName: NAME, sha256: ORIGINAL_SHA, byteLength: ORIGINAL.length });
	const framePage = await context.newPage();
	try {
		await install(framePage); const editor = await bootEditor(framePage, '/framescaper/embed/en/'), initialId = await editor.getAttribute('data-project-id');
		const picker = framePage.waitForEvent('filechooser'); await chooseCommandAction(framePage, editor, FRAME.fileMenu, FRAME.open); await (await picker).setFiles(archive);
		await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(initialId); await waitForProjectActivation(editor);
		const projectId = await editor.getAttribute('data-project-id'); expect(projectId).toBeTruthy(); const imported = await frameCustody();
		expect(imported.source).toEqual(source); expect(imported.original.bytes).toEqual([...ORIGINAL]); expect(imported.native.words).toEqual(native.words);
		expect(imported.native.descriptor).toEqual(native.descriptor); expect(imported.native.rawFlip).toBe(6); expect(imported.cache).toEqual(originalDisplay);
		const clipId = imported.project.clips[0].id, clip = editor.locator(`[data-track-lane] [data-clip-id="${clipId}"][role="group"]`);
		await expect(clip).toBeVisible(); await clip.press('Enter'); await resumed(editor);
		const masks = photoDevelopMaskManagementCopy(LOCALE);
		await chooseCommandAction(framePage, editor, FRAME.effectMenu, framescaperImageDevelopCopy(LOCALE).masks);
		const manager = named(framePage, 'dialog', masks.title); await expect(manager).toBeVisible();
		await expect(manager.locator('[data-frame-image-develop-preview]')).toHaveAttribute('data-state', 'ready');
		await expect.poll(() => plane(named(manager, 'img', words.after))).toEqual([32, 32, ...developed]);
		await keyboard(framePage, named(manager, 'button', masks.apply)); await expect(manager).toHaveCount(0); await resumed(editor);
		expect(await frameScalar()).toEqual({ project: imported.project, source: imported.source, revision: imported.revision });
		await openRepair(); const repairing = named(framePage, 'dialog', repair.title); await originalCanvas(repairing);
		await named(repairing, 'combobox', repair.mode).selectOption('clone');
		for (const [field, value] of Object.entries({ targetX: .765625, targetY: .640625, sourceX: .265625, sourceY: .640625, radius: .01, feather: 0, opacity: 1 })) {
			await named(repairing, 'spinbutton', repair[field]).fill(String(value));
		}
		await keyboard(framePage, named(repairing, 'button', repair.add)); await keyboard(framePage, named(repairing, 'button', repair.apply));
		await expect(repairing).toHaveCount(0); await resumed(editor); await chooseCommandAction(framePage, editor, FRAME.fileMenu, FRAME.saveProject);
		await expect.poll(async () => (await frameScalar()).source.develop.processVersion).toBe(3); const edited = await frameCustody();
		expect(edited.source.schemaVersion).toBe(4); expect(edited.source.develop.repairs.spots).toHaveLength(1);
		expect(edited.source.develop.effects).toEqual(savedRecipe.effects); expect(edited.source.develop.masks).toEqual(savedRecipe.masks);
		expect(edited.source.develop.maskBindings).toEqual(savedRecipe.maskBindings); expect(edited.source.raw).toEqual(source.raw);
		expect(edited.source.provenance.origin).toMatchObject({ schemaFamily: 'framescaper', projectId, sourceId: source.id, clipId });
		expect(edited.original).toEqual(imported.original); expect(edited.native).toEqual(imported.native); expect(edited.row).toEqual(imported.row); expect(edited.token).toEqual(imported.token);
		// The real Project bin thumbnail resolves the native saved Develop path.
		await clip.click({ button: 'right' }); await named(framePage, 'menuitem', FRAME.moveToProjectBin).click(); await expect(clip).toHaveCount(0);
		if (!await editor.locator('[data-workspace-panel="project-bin"]').isVisible()) await chooseNestedCommandAction(framePage, editor, FRAME.windowMenu, [FRAME.panelProjectBin]);
		const thumbnail = editor.locator('[data-project-bin-visual-canvas]'); await expect(thumbnail).toBeVisible(); await expect.poll(() => thumbnailPlane(thumbnail)).toEqual([320, 180, ...cloned]);
		await chooseCommandAction(framePage, editor, FRAME.fileMenu, FRAME.saveProject);
		await expect.poll(async () => (await frameScalar()).project.projectBin.clips.length).toBe(1); const retained = await frameCustody();
		await framePage.reload(); await expect(editor).toHaveAttribute('data-project-id', projectId); await waitForProjectActivation(editor);
		await expect.poll(() => thumbnailPlane(thumbnail)).toEqual([320, 180, ...cloned]); expect(await frameCustody()).toEqual(retained);
		const exporting = framePage.waitForEvent('download'); await chooseCommandAction(framePage, editor, FRAME.fileMenu, FRAME.saveScape.replace('{projectExtension}', '.fscape'));
		const exported = await exporting, reverse = { name: exported.suggestedFilename(), mimeType: archive.mimeType, buffer: await readFile(await exported.path()) };
		expect(await frameCustody()).toEqual(retained); await page.bringToFront(); expect(await photos([senderId])).toEqual(saved);
		await photoAction(photoFramescaperReceiveMenuLabel(LOCALE)); const receiveCopy = photoFramescaperReceiveCopy(LOCALE), receive = named(page, 'dialog', receiveCopy.title);
		await receive.getByLabel(receiveCopy.file, { exact: true }).setInputFiles(reverse); await named(receive, 'combobox', receiveCopy.source).selectOption(source.id);
		await keyboard(page, named(receive, 'button', receiveCopy.importPhoto)); await expect(receive.locator('[data-photo-framescaper-receive-receipt]')).toBeVisible();
		await expect(receive.getByRole('alert')).toHaveCount(0); await keyboard(page, named(receive, 'button', receiveCopy.close).last()); await library(2);
		const ids = await app.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-photo-id'))), receivedId = ids.find(id => id !== senderId);
		expect(receivedId).toBeTruthy(); const received = await photos([senderId, receivedId]), returned = received.photos[1];
		expect(returned.photo.schemaVersion).toBe(3); expect(returned.photo.revision).toBe(0); expect(active(returned.photo).develop).toEqual(retained.source.develop);
		expect(returned.photo.original.contentSha256).toBe(ORIGINAL_SHA); expect(returned.photo.original.mimeType).toBe('image/x-adobe-dng'); expect(returned.bytes).toEqual([...ORIGINAL]);
		expect(received.photos[0].photo).toEqual(saved.photos[0].photo); expect(received.photos[0].bytes).toEqual(saved.photos[0].bytes);
		const beforeRow = JSON.parse(saved.photos[0].original.recordJson), afterRow = JSON.parse(received.photos[0].original.recordJson);
		expect(afterRow.catalogRootCount).toBe(beforeRow.catalogRootCount + (returned.photo.original.storageKey === saved.photos[0].photo.original.storageKey ? 1 : 0));
		expect({ ...afterRow, catalogRootCount: beforeRow.catalogRootCount }).toEqual(beforeRow);
		await keyboard(page, app.locator(`[data-photo-id="${receivedId}"]`)); await photoAction(photoDevelopMenuLabel(LOCALE), true);
		const returnedDialog = named(page, 'dialog', `${words.title}: ${returned.photo.metadata.fileName}`);
		await expect(returnedDialog.locator('[data-photo-develop-preview]')).toHaveAttribute('data-state', 'ready');
		await expect.poll(() => plane(named(returnedDialog, 'img', words.before))).toEqual([32, 32, ...originalDisplay]);
		await expect.poll(() => plane(named(returnedDialog, 'img', words.after))).toEqual([32, 32, ...cloned]);
		await keyboard(page, named(returnedDialog, 'button', words.close).last()); await page.reload(); await expect(app).toBeVisible(); await library(2);
		expect(await photos([senderId, receivedId])).toEqual(received); await expect.poll(() => activeWorkers.size).toBe(0);
		expect(workers.length).toBeGreaterThan(3); for (const worker of workers) { expect(worker.origin).toBe(worker.pageOrigin); expect(worker.path).toMatch(/\/assets\/libraw-worker-v1-[^/]+\.js$/u); }
		expect(errors).toEqual([]);

		function frameScalar() { return framePage.evaluate(async ({ path, id }) => (await import(new URL(path, location.href).href)).readRawFrameScalarCurrentV1(id), { path: PROGRAM, id: projectId }); }
		function frameCustody() { return framePage.evaluate(async ({ path, id }) => (await import(new URL(path, location.href).href)).readRawFrameCustodyCurrentV1(id), { path: PROGRAM, id: projectId }); }
		async function openRepair() { await chooseCommandAction(framePage, editor, FRAME.effectMenu, framescaperImageDevelopCopy(LOCALE).repairs); }
		async function originalCanvas(owner) { const canvas = named(owner, 'img', repair.original); await expect(canvas).toHaveAttribute('data-state', 'ready'); await expect.poll(() => plane(canvas)).toEqual([32, 32, ...originalDisplay]); }
	} finally { await framePage.close(); }

	async function install(recipient) {
		recipient.on('pageerror', error => { errors.push(error.message); });
		recipient.on('worker', worker => { const url = new URL(worker.url()); if (!url.pathname.includes('libraw-worker-v1')) return;
			activeWorkers.add(worker); workers.push({ origin: url.origin, path: url.pathname, pageOrigin: new URL(recipient.url()).origin }); worker.on('close', () => { activeWorkers.delete(worker); }); });
		await recipient.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		await recipient.route(manifest.runtime.url, route => route.fulfill({ status: 200, headers: { 'content-type': 'application/wasm', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' }, body: wasm }));
		await recipient.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	}
	async function menu(label) { const summary = app.getByRole('navigation').getByText(label, { exact: true });
		if (!await summary.locator('..').evaluate(node => node.open)) await summary.click(); await expect(summary.locator('..')).toHaveJSProperty('open', true); }
	async function photoAction(label, photo = false) { await page.bringToFront(); await menu(copy.photoFileMenu); if (photo) await menu(copy.photoPhotoMenu); await keyboard(page, named(app, 'button', label)); }
	async function library(count) { const scope = app.locator('[data-photo-library]'); if (!await scope.isVisible()) { await menu(copy.photoViewMenu); await keyboard(page, named(app, 'button', copy.photoShowLibrary)); }
		await expect(scope).toHaveAttribute('aria-busy', 'false'); await expect(scope.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', String(count)); }
	async function number(key, value) { const field = named(dialog, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared[key]}`); await field.fill(value); await field.press('Enter'); await expect(field).toHaveValue(value); }
	function photos(ids) { return page.evaluate(async ({ path, ids }) => (await import(new URL(path, location.href).href)).readRawFramePhotoCustodyCurrentV1(ids), { path: PROGRAM, ids }); }
});

function oracle(words, clone) {
	const values = words.map(word => Math.fround(word / 65535));
	if (clone) for (let channel = 0; channel < 4; channel++) values[(20 * 32 + 24) * 4 + channel] = values[(20 * 32 + 8) * 4 + channel];
	return display(values.map((value, index) => index % 4 === 3 ? value : Math.fround(Math.fround(value * [2, 1, .5][index % 4]) * .5)));
}
function display(values) { return values.map((value, index) => { if (index % 4 === 3) return 255; value = Math.max(0, Math.min(1, value)); return Math.round(255 * (value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055)); }); }
function nativeDigest(words) { const bytes = Buffer.alloc(words.length * 2); for (let index = 0; index < words.length; index++) bytes.writeUInt16BE(words[index], index * 2); try { return sha(bytes); } finally { bytes.fill(0); } }
function active(photo) { return photo.versions.find(version => version.id === photo.activeVersionId); }
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function named(root, role, name) { return root.getByRole(role, { name, exact: true }); }
async function keyboard(_page, control) { await expect(control).toBeEnabled(); await control.press('Enter'); }
function plane(canvas) { return canvas.evaluate(node => [node.width, node.height, ...(node.width && node.height ? node.getContext('2d').getImageData(0, 0, node.width, node.height).data : [])]); }
function thumbnailPlane(canvas) { return canvas.evaluate(node => { const context = node.getContext('2d'), values = []; for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
	values.push(...context.getImageData(Math.floor((x + .5) * node.width / 32), Math.floor((y + .5) * node.height / 32), 1, 1).data); } return [node.width, node.height, ...values]; }); }
async function resumed(editor) { const preview = editor.locator('[data-video-preview]'); await expect(preview).toHaveAttribute('data-video-preview-visual-pending', 'false'); await expect(preview).toHaveAttribute('data-video-preview-visual-error', '');
	await expect(preview).toHaveAttribute('data-video-preview-visual-omitted-count', '0'); await expect(preview).toHaveAttribute('data-renderable-clip-count', '1'); }
