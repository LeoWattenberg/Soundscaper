/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BlobReader, BlobWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoFramescaperHandoffCopy, photoFramescaperReceiveCopy } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { photoFramescaperHandoffMenuLabel, photoFramescaperReceiveMenuLabel } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoPngExportCopy } from '../../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import { photoPngExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-png-export-menu-copy.ts';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { expect, test, compileNativeImageHandoffScript, installNativeImageHandoffRuntime } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { repairSettingsUiFixtureV1, active, named, keyboard, uncheck } from './helpers/lightscaper-repair-settings-ui-fixture.js';
import { inflateSync } from 'node:zlib';

const PROGRAM = '/__repair_frame_current_native.js', PIXELS = [255, 255, 255, 255, 137, 137, 137, 255];
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '0.25 0.25 0.25\n').join('')}`);

for (const locale of ['en', 'de']) test(`${locale}: repaired editable Photo3 crosses actual Frame menus, native save/reopen and reverse Current Photo3 publication`, async ({ page, context, browserName }) => {
	shape(browserName); test.setTimeout(180000);
	const f = await fixture(page, locale), before = await f.custody(f.ids), archive = await f.download();
	expect(await f.custody(f.ids)).toEqual(before);
	const framePage = await context.newPage();
	try {
		await installNativeImageHandoffRuntime(framePage); await f.install(framePage);
		await framePage.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		const frameErrors = []; framePage.on('pageerror', error => { frameErrors.push(error.message); });
		const frameCopy = locale === 'de' ? EDITOR_GERMAN_COPY : EDITOR_ENGLISH_COPY;
		const editor = await bootEditor(framePage, `/framescaper/embed/${locale}/`), initialFrameId = await editor.getAttribute('data-project-id'), picker = framePage.waitForEvent('filechooser');
		await chooseCommandAction(framePage, editor, frameCopy.fileMenu, frameCopy.open); await (await picker).setFiles(archive);
		await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(initialFrameId);
		await waitForProjectActivation(editor); const projectId = await editor.getAttribute('data-project-id'); expect(projectId).toBeTruthy();
		const imported = await f.frame(framePage, projectId), source = imported.source;
		expect(source.schemaVersion).toBe(3); expect(source.develop).toEqual(active(before.photos[0].photo).develop);
		expect(source.provenance.schemaVersion).toBe(2); expect(source.provenance.origin.schemaVersion).toBe(3);
		expect(source.provenance.developSha256).toBe(sha(JSON.stringify(source.develop)));
		expect(source.original.sha256).toBe(before.photos[0].original.sha256); expect(imported.original.bytes).toEqual(before.photos[0].bytes);
		expect(imported.pixels).toEqual(PIXELS); expect(imported.bodies).toEqual(before.bodies); expect(imported.luts).toEqual(before.luts);
		// Existing clip and Project bin menus perform a real whole-source edit.
		const clip = editor.getByRole('group', { name: new RegExp(`^[^:]+: ${escape(source.name)}$`, 'u') });
		await expect(clip).toBeVisible(); await clip.press('Enter'); await clip.click({ button: 'right' });
		await named(framePage, 'menuitem', frameCopy.moveToProjectBin).click(); await expect(clip).toHaveCount(0);
		if (!await editor.locator('[data-workspace-panel="project-bin"]').isVisible()) await chooseNestedCommandAction(framePage, editor, frameCopy.windowMenu, [frameCopy.panelProjectBin]);
		const rename = named(editor, 'textbox', `${frameCopy.projectBinRename}: ${source.name}`), editedName = 'Returned repaired photo';
		await rename.fill(editedName); await rename.press('Enter');
		await chooseCommandAction(framePage, editor, frameCopy.fileMenu, frameCopy.saveProject);
		await expect.poll(async () => (await f.frameScalar(framePage, projectId)).source.name).toBe(editedName);
		const thumbnail = editor.locator('[data-project-bin-visual-canvas]'); await paintedFrameThumbnail(thumbnail);
		const edited = await f.frame(framePage, projectId); expect(edited.project.revision).toBeGreaterThan(imported.project.revision);
		expect(edited.source.develop).toEqual(source.develop); expect(edited.source.storageKey).toBe(source.storageKey);
		await framePage.reload(); await expect(editor).toHaveAttribute('data-project-id', projectId); await waitForProjectActivation(editor);
		await paintedFrameThumbnail(thumbnail);
		expect(await f.frame(framePage, projectId)).toEqual(edited);
		const pending = framePage.waitForEvent('download');
		await chooseCommandAction(framePage, editor, frameCopy.fileMenu, frameCopy.saveScape.replace('{projectExtension}', '.fscape'));
		const saved = await pending, reverse = { name: saved.suggestedFilename(), mimeType: archive.mimeType, buffer: await readFile(await saved.path()) };
		expect(await f.frame(framePage, projectId)).toEqual(edited);
		await f.receive(reverse, source.id); await f.showLibrary(3);
		const cards = f.app.locator('[data-photo-id]'), importedIds = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-photo-id')));
		const receivedId = importedIds.find(id => !f.ids.includes(id)); expect(receivedId).toBeTruthy();
		const allIds = [...f.ids, receivedId], received = await f.custody(allIds), photo = received.photos[2].photo;
		expect(photo.schemaVersion).toBe(3); expect(photo.revision).toBe(0); expect(photo.id).not.toBe(f.ids[0]);
		expect(active(photo).develop).toEqual(edited.source.develop); expect(active(photo).name).toBe(source.provenance.origin.versionName);
		expect(photo.original.contentSha256).toBe(source.original.sha256); expect(received.photos[2].bytes).toEqual(before.photos[0].bytes);
		for (const [index, row] of received.photos.slice(0, 2).entries()) {
			const previous = before.photos[index], record = JSON.parse(row.original.recordJson), prior = JSON.parse(previous.original.recordJson);
			expect(record.catalogRootCount).toBe(prior.catalogRootCount + (row.photo.original.storageKey === photo.original.storageKey ? 1 : 0));
			expect({ ...record, catalogRootCount: prior.catalogRootCount }).toEqual(prior);
			expect({ ...row, original: { ...row.original, recordJson: previous.original.recordJson } }).toEqual(previous);
		}
		expect(received.bodies).toEqual(before.bodies); expect(received.luts).toEqual(before.luts);
		await page.reload(); await expect(f.app).toBeVisible(); await f.showLibrary(3); expect(await f.custody(allIds)).toEqual(received);
		await keyboard(page, f.app.locator(`[data-photo-id="${receivedId}"]`));
		await f.returnedPreview(photo.metadata.fileName); await f.returnedPng();
		expect(await f.custody(allIds)).toEqual(received); expect(frameErrors).toEqual([]); expect(f.errors).toEqual([]);
	} finally { await framePage.close(); }
});

for (const locale of ['en', 'de']) test(`${locale}: physically corrupted disabled handoff LUT refuses Current receive and retains native Photos and Originals`, async ({ page, browserName }) => {
	shape(browserName); test.setTimeout(120000); const f = await fixture(page, locale), before = await f.custody(f.ids), archive = await f.download();
	const corrupt = { ...archive, buffer: await corruptLut(archive.buffer) }, copy = photoFramescaperReceiveCopy(locale);
	await f.action(photoFramescaperReceiveMenuLabel(locale)); const dialog = named(page, 'dialog', copy.title);
	await dialog.getByLabel(copy.file, { exact: true }).setInputFiles(corrupt);
	const sources = named(dialog, 'combobox', copy.source); await expect(sources.locator('option')).toHaveCount(2); await sources.selectOption({ index: 1 });
	await keyboard(page, named(dialog, 'button', copy.importPhoto)); await expect(dialog.getByRole('alert')).toBeVisible();
	await expect(dialog.locator('[data-photo-framescaper-receive-receipt]')).toHaveCount(0);
	await keyboard(page, named(dialog, 'button', copy.close).last()); expect(await f.custody(f.ids)).toEqual(before);
	await page.reload(); await expect(f.app).toBeVisible(); await f.showLibrary(2); expect(await f.custody(f.ids)).toEqual(before); expect(f.errors).toEqual([]);
});

async function fixture(page, locale) {
	const f = await repairSettingsUiFixtureV1(page, locale), copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale);
	const program = await compileNativeImageHandoffScript('repair-frame-current-native.js', fileURLToPath(new URL('./helpers/lightscaper-repair-frame-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]); await install(page);
	await f.openDevelop(); await f.repair('heal'); await f.geometry(); await f.brush(); await f.painted(PIXELS);
	await named(f.develop(), 'combobox', f.words.choose).selectOption('cube-lut-profile-v1'); await keyboard(page, named(f.develop(), 'button', f.words.add));
	await f.develop().getByLabel(f.words.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Handoff disabled.cube', mimeType: 'text/plain', buffer: CUBE });
	await f.painted([137, 137, 137, 255, 137, 137, 137, 255]);
	await uncheck(page, f.develop().locator('[data-photo-develop-effect="cube-lut-profile-v1"] input[type="checkbox"]')); await f.painted(PIXELS); await f.save(); await f.closeDevelop();
	await showLibrary(2);
	return { ...f, install, action, showLibrary, download, receive, returnedPreview, returnedPng,
		custody: ids => page.evaluate(async ({ pathname, ids }) => (await import(new URL(pathname, location.href).href))
			.readRepairFramePhotoCustodyNativeV1(ids, () => globalThis.__assertNativeOpfsWorkerExecution()), { pathname: PROGRAM, ids }),
		frame: (recipient, projectId) => recipient.evaluate(async ({ pathname, projectId }) => (await import(new URL(pathname, location.href).href))
			.readRepairFrameProjectNativeV1(projectId), { pathname: PROGRAM, projectId }),
		frameScalar: (recipient, projectId) => recipient.evaluate(async ({ pathname, projectId }) => (await import(new URL(pathname, location.href).href))
			.readRepairFrameProjectScalarNativeV1(projectId), { pathname: PROGRAM, projectId }) };
	async function install(recipient) { await recipient.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source })); }
	async function action(label, photo = false) { await page.bringToFront(); await openMenu(copy.photoFileMenu); if (photo) await openMenu(copy.photoPhotoMenu); await keyboard(page, named(f.app, 'button', label)); }
	async function openMenu(label) { const summary = f.app.getByRole('navigation').getByText(label, { exact: true });
		if (!await summary.locator('..').evaluate(details => details.open)) await summary.click();
		await expect(summary.locator('..')).toHaveAttribute('open', ''); }
	async function showLibrary(count) { const library = f.app.locator('[data-photo-library]'); if (!await library.isVisible()) await f.showLibrary();
		await expect(library).toHaveAttribute('aria-busy', 'false'); await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', String(count)); }
	async function download() {
		const text = photoFramescaperHandoffCopy(locale); await action(photoFramescaperHandoffMenuLabel(locale), true); const dialog = named(page, 'dialog', text.title);
		await expect(named(dialog, 'button', text.download)).toBeEnabled(); const pending = page.waitForEvent('download'); await keyboard(page, named(dialog, 'button', text.download));
		const download = await pending, result = { name: download.suggestedFilename(), mimeType: 'application/vnd.soundscaper.scape+zip', buffer: await readFile(await download.path()) };
		await expect(dialog.locator('[data-photo-framescaper-handoff-receipt]')).toBeVisible(); await keyboard(page, named(dialog, 'button', text.close).last()); return result;
	}
	async function receive(archive, sourceId) {
		const text = photoFramescaperReceiveCopy(locale); await action(photoFramescaperReceiveMenuLabel(locale)); const dialog = named(page, 'dialog', text.title);
		await dialog.getByLabel(text.file, { exact: true }).setInputFiles(archive); await named(dialog, 'combobox', text.source).selectOption(sourceId);
		await keyboard(page, named(dialog, 'button', text.importPhoto)); await expect(dialog.locator('[data-photo-framescaper-receive-receipt]')).toBeVisible();
		await expect(dialog.getByRole('alert')).toHaveCount(0); await keyboard(page, named(dialog, 'button', text.close).last());
	}
	async function returnedPreview(fileName) {
		await action(photoDevelopMenuLabel(locale), true);
		const dialog = named(page, 'dialog', `${words.title}: ${fileName}`);
		await expect.poll(() => named(dialog, 'img', words.after).evaluate(canvas => [canvas.width, canvas.height,
			...(canvas.width ? canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data : [])])).toEqual([2, 1, ...PIXELS]);
		await keyboard(page, named(dialog, 'button', words.close).last());
	}
	async function returnedPng() {
		const text = photoPngExportCopy(locale); await action(photoPngExportMenuLabel(locale)); const dialog = named(page, 'dialog', text.title), pending = page.waitForEvent('download');
		await keyboard(page, named(dialog, 'button', text.save)); const download = await pending, bytes = await readFile(await download.path()), parts = [];
		expect([...bytes.subarray(16, 26)]).toEqual([0, 0, 0, 2, 0, 0, 0, 1, 8, 6]);
		for (let offset = 8; offset < bytes.length;) { const length = bytes.readUInt32BE(offset), end = offset + length + 12; expect(end).toBeLessThanOrEqual(bytes.length);
			if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') parts.push(bytes.subarray(offset + 8, end - 4)); offset = end; }
		expect([...inflateSync(Buffer.concat(parts))]).toEqual([0, ...PIXELS]); await expect(dialog.getByRole('status').filter({ hasText: '×' })).toBeVisible();
		await keyboard(page, named(dialog, 'button', text.close).last());
	}
}

async function corruptLut(bytes) {
	const reader = new ZipReader(new BlobReader(new Blob([bytes])), { useWebWorkers: false }), entries = new Map();
	try { for (const entry of await reader.getEntries()) { if (!entry.directory) entries.set(entry.filename, await entry.getData(new Uint8ArrayWriter())); } }
	finally { await reader.close(); }
	const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))), lut = manifest.assets.find(asset => asset.entry.endsWith('.cube'));
	expect(lut).toBeTruthy(); const body = entries.get(lut.entry); body[0] ^= 1;
	const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false, level: 0 });
	try { for (const [name, body] of entries) await writer.add(name, new Uint8ArrayReader(body)); return Buffer.from(await (await writer.close()).arrayBuffer()); }
	catch (failure) { try { await writer.close(); } catch {} throw failure; }
}
function sha(value) { return createHash('sha256').update(value).digest('hex'); }
async function paintedFrameThumbnail(thumbnail) {
	await expect(thumbnail).toBeVisible();
	await expect.poll(() => thumbnail.evaluate(canvas => {
		const context = canvas.getContext('2d'), y = Math.floor(canvas.height / 2);
		return [...context.getImageData(Math.floor(canvas.width / 4), y, 1, 1).data, ...context.getImageData(Math.floor(canvas.width * .75), y, 1, 1).data];
	})).toEqual(PIXELS);
}
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
function shape(browserName) { expect(['chromium', 'firefox']).toContain(browserName); expect(test.info().config.workers).toBe(1); expect(test.info().project.retries).toBe(0); }
