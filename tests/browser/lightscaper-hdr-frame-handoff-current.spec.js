/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { framescaperImageDevelopCopy } from '../../src/common/i18n/framescaper-image-develop-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopMaskManagementCopy } from '../../src/common/i18n/lightscaper-develop-mask-management-copy.ts';
import { photoDevelopRepairSpotsCopy } from '../../src/common/i18n/lightscaper-develop-repair-spots-copy.ts';
import { photoFramescaperReceiveCopy } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { photoFramescaperReceiveMenuLabel } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts';
import { createHdrFrameArchiveCurrentV1 } from './helpers/lightscaper-hdr-frame-archive-current-fixture.ts';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';

test.use({ browserCoverage: false });
const PROGRAM = '/__hdr_frame_current_reference.js', ARCHIVE_MIME = 'application/vnd.soundscaper.scape+zip';
let program, fixture, originalDisplay, developed, cloned, brighter, originalBits;
test.beforeAll(async () => {
	fixture = await createHdrFrameArchiveCurrentV1();
	originalDisplay = display(fixture.samples); developed = display(expose(fixture.samples, -2));
	const repaired = [...fixture.samples]; for (let channel = 0; channel < 4; channel++) repaired[4 + channel] = repaired[channel];
	cloned = display(expose(repaired, -2)); brighter = display(expose(repaired, -1));
	expect(cloned).not.toEqual(developed); expect(brighter).not.toEqual(cloned); expect(originalDisplay).not.toEqual(fixture.cache);
	originalBits = rgbBits(fixture.samples);
	program = await compileNativeImageHandoffScript('hdr-frame-current-reference.js', fileURLToPath(new URL('./helpers/lightscaper-hdr-frame-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: actual Source5 Frame menus ignore poisoned byte cache, retain native HDR through Clone/save/reopen, and receive editable Photo3`, async ({ page, context, browserName }) => {
	expect(['chromium', 'firefox']).toContain(browserName); test.setTimeout(240_000);
	const frameCopy = locale === 'de' ? EDITOR_GERMAN_COPY : EDITOR_ENGLISH_COPY, frameMenu = framescaperImageDevelopCopy(locale);
	const words = photoDevelopCopy(locale), mask = photoDevelopMaskManagementCopy(locale), repair = photoDevelopRepairSpotsCopy(locale);
	const copy = bundledLightscaperEditorCopyForLocale(locale), errors = [];
	const framePage = await context.newPage();
	try {
		await install(framePage); const editor = await bootEditor(framePage, `/framescaper/embed/${locale}/`), initialId = await editor.getAttribute('data-project-id');
		const choosing = framePage.waitForEvent('filechooser'); await chooseCommandAction(framePage, editor, frameCopy.fileMenu, frameCopy.open);
		await (await choosing).setFiles({ name: 'Native HDR.fscape', mimeType: ARCHIVE_MIME, buffer: Buffer.from(fixture.archive) });
		await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(initialId); await waitForProjectActivation(editor);
		const projectId = await editor.getAttribute('data-project-id'); expect(projectId).toBeTruthy();
		const imported = await custody();
		expect(imported.source.schemaVersion).toBe(5); expect(imported.source.hdr).toEqual(fixture.source.hdr); expect(imported.source.develop.processVersion).toBe(2);
		expect(imported.original.bytes).toEqual([...fixture.original]); expect(imported.native.bits).toEqual(originalBits);
		expect(imported.native.values[0]).toBe(3); expect(imported.native.values[2]).toBe(-.25); expect(imported.native.bits[4]).toBe(0x80000000);
		expect(imported.cache).toEqual(fixture.cache);
		const clip = editor.locator(`[data-track-lane] [data-clip-id="${fixture.clipId}"][role="group"]`); await expect(clip).toBeVisible(); await clip.press('Enter'); await resumed(editor);
		// Actual Current Session rendering must use the signed Float32 Original;
		// the packed RGBA8 cache is deliberately unrelated to these literal pixels.
		await chooseCommandAction(framePage, editor, frameCopy.effectMenu, frameMenu.masks);
		let manager = named(framePage, 'dialog', mask.title); await managerReady(manager, developed);
		await keyboard(named(manager, 'button', mask.apply)); await expect(manager).toHaveCount(0); await resumed(editor);
		expect(await scalar()).toEqual({ project: imported.project, source: imported.source, revision: imported.revision });
		await chooseCommandAction(framePage, editor, frameCopy.effectMenu, frameMenu.repairs);
		const repairing = named(framePage, 'dialog', repair.title), original = named(repairing, 'img', repair.original);
		await expect(original).toHaveAttribute('data-state', 'ready'); await expect.poll(() => plane(original)).toEqual([2, 1, ...originalDisplay]);
		await named(repairing, 'combobox', repair.mode).selectOption('clone');
		for (const [key, value] of Object.entries({ targetX: .75, targetY: .5, sourceX: .25, sourceY: .5, radius: .1, feather: 0, opacity: 1 })) await named(repairing, 'spinbutton', repair[key]).fill(String(value));
		await keyboard(named(repairing, 'button', repair.add)); await keyboard(named(repairing, 'button', repair.apply)); await expect(repairing).toHaveCount(0); await resumed(editor);
		await chooseCommandAction(framePage, editor, frameCopy.effectMenu, frameMenu.masks);
		manager = named(framePage, 'dialog', mask.title); await managerReady(manager, cloned); await keyboard(named(manager, 'button', mask.apply)); await expect(manager).toHaveCount(0);
		await chooseCommandAction(framePage, editor, frameCopy.fileMenu, frameCopy.saveProject);
		await expect.poll(async () => (await scalar()).source.develop.processVersion).toBe(3); const edited = await custody();
		expect(edited.source.develop.repairs.spots).toHaveLength(1); expect(edited.source.develop.repairs.spots[0].mode).toBe('clone');
		expect(edited.source.develop.effects).toEqual(imported.source.develop.effects); unchangedBody(edited, imported);
		expect(edited.source.provenance.origin).toMatchObject({ schemaFamily: 'framescaper', projectId, sourceId: edited.source.id, clipId: fixture.clipId });
		// The ordinary Project bin thumbnail uses the saved Current reader rather
		// than the modal draft path, independently exercising final byte delivery.
		await clip.click({ button: 'right' }); await named(framePage, 'menuitem', frameCopy.moveToProjectBin).click(); await expect(clip).toHaveCount(0);
		if (!await editor.locator('[data-workspace-panel="project-bin"]').isVisible()) await chooseNestedCommandAction(framePage, editor, frameCopy.windowMenu, [frameCopy.panelProjectBin]);
		const thumbnail = editor.locator('[data-project-bin-visual-canvas]'); await expect(thumbnail).toBeVisible(); await expect.poll(() => thumbnailPlane(thumbnail)).toEqual([320, 180, ...cloned]);
		await chooseCommandAction(framePage, editor, frameCopy.fileMenu, frameCopy.saveProject);
		await expect.poll(async () => (await scalar()).project.projectBin.clips.length).toBe(1); const retained = await custody(); unchangedBody(retained, imported);
		await framePage.reload(); await expect(editor).toHaveAttribute('data-project-id', projectId); await waitForProjectActivation(editor);
		await expect.poll(() => thumbnailPlane(thumbnail)).toEqual([320, 180, ...cloned]); expect(await custody()).toEqual(retained);
		const exporting = framePage.waitForEvent('download'); await chooseCommandAction(framePage, editor, frameCopy.fileMenu, frameCopy.saveScape.replace('{projectExtension}', '.fscape'));
		const download = await exporting, archive = { name: download.suggestedFilename(), mimeType: ARCHIVE_MIME, buffer: await readFile(await download.path()) };
		const entries = unzipSync(archive.buffer), exportedSource = JSON.parse(new TextDecoder().decode(entries['project.json'])).sources[0];
		expect(exportedSource).toEqual(retained.source); expect(await custody()).toEqual(retained);
		await install(page); await page.goto(resolveBrowserProductTestUrl(`/lightscaper/${locale}/`)); const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible();
		await menu(copy.photoFileMenu); await keyboard(named(app, 'button', photoFramescaperReceiveMenuLabel(locale)));
		const receiveCopy = photoFramescaperReceiveCopy(locale), receive = named(page, 'dialog', receiveCopy.title);
		await receive.getByLabel(receiveCopy.file, { exact: true }).setInputFiles(archive); await named(receive, 'combobox', receiveCopy.source).selectOption(retained.source.id);
		const clipChoice = named(receive, 'combobox', receiveCopy.imageClip); if (await clipChoice.count()) await clipChoice.selectOption(fixture.clipId);
		await keyboard(named(receive, 'button', receiveCopy.importPhoto)); await expect(receive.locator('[data-photo-framescaper-receive-receipt]')).toBeVisible();
		await expect(receive.getByRole('alert')).toHaveCount(0); await keyboard(named(receive, 'button', receiveCopy.close).last()); await library();
		const card = app.locator('[data-photo-id]'); await expect(card).toHaveCount(1); const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy();
		const received = await photos(), photo = received.photos[0].photo;
		expect(photo.schemaVersion).toBe(3); expect(photo.original.mimeType).toBe('image/x-lightscaper-hdr'); expect(photo.original.contentSha256).toBe(sha(fixture.original));
		expect(received.photos[0].bytes).toEqual([...fixture.original]); expect(active(photo).develop).toEqual(retained.source.develop);
		await keyboard(card); await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(named(app, 'button', photoDevelopMenuLabel(locale)));
		let dialog = named(page, 'dialog', `${words.title}: ${photo.metadata.fileName}`);
		await developReady(dialog, cloned); await expect.poll(() => plane(named(dialog, 'img', words.before))).toEqual([2, 1, ...originalDisplay]);
		const exposure = named(dialog, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectParamExposure}`);
		await exposure.fill('-1'); await exposure.press('Enter'); await developReady(dialog, brighter);
		await keyboard(named(dialog, 'button', words.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toBeVisible();
		await keyboard(named(dialog, 'button', words.close).last()); await expect(dialog).toHaveCount(0);
		const saved = await photos(); expect(saved.photos[0].photo.revision).toBeGreaterThan(photo.revision);
		expect(saved.photos[0].bytes).toEqual(received.photos[0].bytes); expect(saved.photos[0].original).toEqual(received.photos[0].original);
		expect(active(saved.photos[0].photo).develop.effects[0].params.exposure).toBe(-1); expect(active(saved.photos[0].photo).develop.repairs).toEqual(active(photo).develop.repairs);
		await page.reload(); await expect(app).toBeVisible(); await library(); expect(await photos()).toEqual(saved);
		await keyboard(app.locator(`[data-photo-id="${photoId}"]`)); await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(named(app, 'button', photoDevelopMenuLabel(locale)));
		dialog = named(page, 'dialog', `${words.title}: ${photo.metadata.fileName}`); await developReady(dialog, brighter);
		await expect.poll(() => plane(named(dialog, 'img', words.before))).toEqual([2, 1, ...originalDisplay]); await keyboard(named(dialog, 'button', words.close).last());
		expect(await photos()).toEqual(saved); expect(errors).toEqual([]);

		function scalar() { return framePage.evaluate(async ({ path, id }) => (await import(new URL(path, location.href).href)).readHdrFrameScalarCurrentV1(id), { path: PROGRAM, id: projectId }); }
		function custody() { return framePage.evaluate(async ({ path, id }) => (await import(new URL(path, location.href).href)).readHdrFrameCustodyCurrentV1(id), { path: PROGRAM, id: projectId }); }
		function photos() { return page.evaluate(async ({ path, ids }) => (await import(new URL(path, location.href).href)).readHdrPhotoCustodyCurrentV1(ids), { path: PROGRAM, ids: [photoId] }); }
		async function menu(label) { const summary = app.getByRole('navigation').getByText(label, { exact: true }); if (!await summary.locator('..').evaluate(node => node.open)) await summary.click(); await expect(summary.locator('..')).toHaveJSProperty('open', true); }
		async function library() { const scope = app.locator('[data-photo-library]'); if (!await scope.isVisible()) { await menu(copy.photoViewMenu); await keyboard(named(app, 'button', copy.photoShowLibrary)); }
			await expect(scope).toHaveAttribute('aria-busy', 'false'); await expect(scope.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '1'); }
		async function managerReady(owner, expected) { await expect(owner.locator('[data-frame-image-develop-preview]')).toHaveAttribute('data-state', 'ready'); await expect.poll(() => plane(named(owner, 'img', words.after))).toEqual([2, 1, ...expected]); }
		async function developReady(owner, expected) { await expect(owner.locator('[data-photo-develop-preview]')).toHaveAttribute('data-state', 'ready'); await expect.poll(() => plane(named(owner, 'img', words.after))).toEqual([2, 1, ...expected]); }
	} finally { await framePage.close(); }

	async function install(recipient) { recipient.on('pageerror', error => { errors.push(error.message); });
		await recipient.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		await recipient.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source })); }
});

function unchangedBody(value, original) {
	expect(value.source.schemaVersion).toBe(5); expect(value.source.hdr).toEqual(original.source.hdr);
	expect(value.source.original).toEqual(original.source.original); expect(value.source.canonical).toEqual(original.source.canonical);
	expect(value.original).toEqual(original.original); expect(value.native).toEqual(original.native); expect(value.cache).toEqual(original.cache);
	expect(value.row).toEqual(original.row); expect(value.metadata).toEqual(original.metadata); expect(value.resources).toEqual(original.resources);
}
function expose(values, exposure) { return values.map((value, index) => index % 4 === 3 ? value : Math.fround(value * 2 ** exposure)); }
function display(values) { return values.map((value, index) => { if (index % 4 === 3) return 255; value = Math.max(0, Math.min(1, value)); return Math.round(255 * (value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055)); }); }
function rgbBits(values) { const buffer = new ArrayBuffer(4), view = new DataView(buffer), bits = []; for (let index = 0; index < values.length; index++) if (index % 4 !== 3) { view.setFloat32(0, values[index], true); bits.push(view.getUint32(0, true)); } return bits; }
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function active(photo) { return photo.versions.find(version => version.id === photo.activeVersionId); }
function named(root, role, name) { return root.getByRole(role, { name, exact: true }); }
async function keyboard(control) { await expect(control).toBeEnabled(); await control.press('Enter'); }
function plane(canvas) { return canvas.evaluate(node => [node.width, node.height, ...(node.width && node.height ? node.getContext('2d').getImageData(0, 0, node.width, node.height).data : [])]); }
function thumbnailPlane(canvas) { return canvas.evaluate(node => { const context = node.getContext('2d'), values = []; for (let x = 0; x < 2; x++) values.push(...context.getImageData(Math.floor((x + .5) * node.width / 2), Math.floor(node.height / 2), 1, 1).data); return [node.width, node.height, ...values]; }); }
async function resumed(editor) { const preview = editor.locator('[data-video-preview]'); await expect(preview).toHaveAttribute('data-video-preview-visual-pending', 'false'); await expect(preview).toHaveAttribute('data-video-preview-visual-error', '');
	await expect(preview).toHaveAttribute('data-video-preview-visual-omitted-count', '0'); await expect(preview).toHaveAttribute('data-renderable-clip-count', '1'); }
