/* SPDX-License-Identifier: AGPL-3.0-only */

import { unzipSync, zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoFramescaperHandoffCopy, photoFramescaperReceiveCopy } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { photoFramescaperHandoffMenuLabel, photoFramescaperReceiveMenuLabel } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { imageDevelopHandoffRecipeSha256V1 } from '../../src/common/editor/image-develop-handoff-provenance-v1.ts';
import { normalizeFramescaperImageSourceV2 } from '../../src/common/editor/timeline-image-model-v2.ts';
import { pngChunk } from '../helpers/image-metadata-fixtures.ts';
import { expect, test, installNativeImageHandoffRuntime, observeNativeImageHandoffLibrary as observe,
	createOrdinaryFramescaperStillArchive, observeOrdinaryFramescaperStillProject as observeFrame } from './helpers/lightscaper-image-handoff-native-fixture.js';

const NAME = 'Returned original.png', WHITE = Array(4).fill([255, 255, 255, 255]).flat();
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
	pngChunk('IHDR', Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0])), pngChunk('sRGB', Buffer.from([0])),
	pngChunk('IDAT', deflateSync(Buffer.from([0, ...WHITE.slice(0, 8), 0, ...WHITE.slice(8)]))), pngChunk('IEND', Buffer.alloc(0))]);
const RED = Buffer.from(`LUT_3D_SIZE 2\n${'0.25 0 0\n'.repeat(8)}`), DISABLED = Buffer.from(`LUT_3D_SIZE 2\n${'0 0 0.5\n'.repeat(8)}`);
const CORNERS = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255];
const ORDINARY_PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
	pngChunk('IHDR', Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0])), pngChunk('sRGB', Buffer.from([0])),
	pngChunk('IDAT', deflateSync(Buffer.from([0, ...CORNERS.slice(0, 8), 0, ...CORNERS.slice(8)]))), pngChunk('IEND', Buffer.alloc(0))]);

for (const locale of ['en', 'de']) {
	test(`${locale}: editable-photo receive stays cold in File without a selected photo`, async ({ page }) => {
		const requested = []; page.on('request', request => { requested.push(request.url()); });
		const { app, copy } = await open(page, locale); await menu(page, app, copy.photoFileMenu);
		// The production library factory is available, so the entry is enabled
		// without requiring an existing photo. Merely opening File stays cold.
		await expect(named(app, 'button', photoFramescaperReceiveMenuLabel(locale))).toBeEnabled();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		expect(requested.filter(url => /(?:PhotoFramescaperReceiveDialog|photo-framescaper-handoff|lightscaper-photo-framescaper-handoff-copy)/u.test(url))).toEqual([]);
	});
	test(`${locale}: ordinary Frame importer archive requires real bin selection and receives neutral original pixels after reopen`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Native WebKit Blob/OPFS receive remains deferred.'); test.setTimeout(90_000);
		const errors = []; page.on('pageerror', error => { errors.push(error.message); });
		await installNativeImageHandoffRuntime(page);
		const { app, copy } = await open(page, locale), words = photoFramescaperReceiveCopy(locale), develop = photoDevelopCopy(locale);
		const library = app.locator('[data-photo-library]'), cards = library.locator('[data-photo-id]'); await expect(cards).toHaveCount(0);
		// These are the real Frame controller/import/storage/archive owners in
		// this fresh Light origin, not a separate-origin Frame application test.
		const sender = await createOrdinaryFramescaperStillArchive(page, { name: 'Cafe\u0301.png', mimeType: locale === 'en' ? 'image/jpeg' : 'not-a-mime', buffer: ORDINARY_PNG });
		expect(sender.originalName).toBe('Café.png'); expect(sender.storedMimeHint).toBe(locale === 'en' ? 'image/jpeg' : null);
		expect(sender.originalSha256).toBe(sha(ORDINARY_PNG)); expect(sender.timelineClipId).not.toBe(sender.binClipId);
		const archiveDigest = sha(sender.archive), archived = JSON.parse(new TextDecoder().decode(unzipSync(sender.archive)['project.json']));
		expect(archived.id).toBe(sender.projectId); expect(archived.revision).toBe(sender.projectRevision);
		const source = archived.sources.find(value => value.id === sender.sourceId); expect(source.schemaVersion).toBe(1);
		expect(source.original.fileName).toBe('Café.png'); expect(source.original.mimeType).toBe(sender.storedMimeHint); expect(source.original.recognizedFormat).toBe('png');
		expect(source.original.sha256).toBe(sha(ORDINARY_PNG)); expect(source.canonical.frameCount).toBe(1);
		expect(archived.clips.find(value => value.id === sender.timelineClipId)).toMatchObject({ kind: 'image', sourceId: sender.sourceId, sequenceId: sender.sequenceId });
		expect(archived.projectBin.clips.find(value => value.id === sender.binClipId)).toMatchObject({ kind: 'image', sourceId: sender.sourceId, sequenceId: sender.sequenceId });
		const frameBefore = await observeFrame(page, sender.projectId);
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', photoFramescaperReceiveMenuLabel(locale)));
		const dialog = named(page, 'dialog', words.title), chooser = named(dialog, 'combobox', words.source);
		await dialog.getByLabel(words.file, { exact: true }).setInputFiles({ name: 'Actual Frame still.fscape', mimeType: 'application/zip', buffer: sender.archive });
		await expect(chooser.locator('option')).toHaveCount(2); await expect(chooser).toHaveValue(''); await choose(page, chooser, sender.sourceId);
		const clip = named(dialog, 'combobox', words.imageClip); await expect(clip.locator('option')).toHaveCount(3); await expect(clip).toHaveValue('');
		await expect(clip).toContainText(`${sender.sequenceName} — ${words.timeline}`); await expect(clip).toContainText(`${sender.sequenceName} — ${words.projectBin}`);
		await expect(dialog).toContainText(words.ordinaryStill); await expect(named(dialog, 'button', words.importPhoto)).toBeDisabled();
		await choose(page, clip, sender.binClipId); await keyboard(page, named(dialog, 'button', words.importPhoto));
		await expect(dialog.locator('[data-photo-framescaper-receive-receipt]')).toHaveText(words.imported); await expect(cards).toHaveCount(1);
		await keyboard(page, named(dialog.locator('.lightscaper-catalog-backup-actions'), 'button', words.close)); await expect(dialog).toHaveCount(0);
		const photoId = await cards.getAttribute('data-photo-id'), received = await observe(page, [photoId]), photo = received.photos[0].photo;
		expect(received.photos[0].bytes).toEqual([...ORDINARY_PNG]); expect(photo.original.name).toBe('Café.png'); expect(photo.original.mimeType).toBe('image/png');
		expect(photo.original.contentSha256).toBe(sha(ORDINARY_PNG)); expect(photo.original.width).toBe(2); expect(photo.original.height).toBe(2); expect(photo.revision).toBe(0);
		expect(photo.id).not.toBe(sender.sourceId); expect(photo.id).not.toBe(sender.binClipId); expect(photo.versions).toHaveLength(1);
		expect(photo.versions[0]).toMatchObject({ kind: 'master', id: photo.activeVersionId });
		expect(photo.versions[0].develop).toEqual({ processVersion: 1, effects: [], masks: [], maskBindings: [], geometry: { crop: null, rotationDegrees: 0, flipHorizontal: false, flipVertical: false } });
		await keyboard(page, cards); await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu); await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale)));
		const workspace = named(page, 'dialog', `${develop.title}: Café.png`); await expect(named(workspace, 'region', develop.preview)).toHaveAttribute('data-state', 'ready');
		await expect.poll(() => pixels(named(workspace, 'img', develop.after), 2, 2)).toEqual(CORNERS);
		await keyboard(page, named(workspace.locator('.lightscaper-develop-actions'), 'button', develop.close)); await expect(workspace).toHaveCount(0);
		expect(sha(sender.archive)).toBe(archiveDigest); expect(await observeFrame(page, sender.projectId)).toEqual(frameBefore);
		await page.reload(); await expect(app).toBeVisible(); expect(await observe(page, [photoId])).toEqual(received);
		expect(await observeFrame(page, sender.projectId)).toEqual(frameBefore); expect(errors).toEqual([]);
	});
	test(`${locale}: keyboard editable archive return preserves selected saved recipe, original and disabled LUT custody after Session reopen`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Native WebKit Blob/OPFS receive remains deferred.'); test.setTimeout(90_000);
		const errors = []; page.on('pageerror', error => { errors.push(error.message); });
		await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		await installNativeImageHandoffRuntime(page);
		const { app, copy } = await open(page, locale), words = photoFramescaperReceiveCopy(locale), forward = photoFramescaperHandoffCopy(locale), develop = photoDevelopCopy(locale);
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
		const importer = named(page, 'dialog', copy.photoImportPhotos);
		await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: PNG });
		await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
		const library = app.locator('[data-photo-library]'), cards = library.locator('[data-photo-id]');
		await expect(cards).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); const originalId = await cards.getAttribute('data-photo-id');
		await keyboard(page, cards); await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu); await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale)));
		let workspace = named(page, 'dialog', `${develop.title}: ${NAME}`);
		await expect(named(workspace, 'region', develop.preview)).toHaveAttribute('data-state', 'ready');
		if (locale === 'de') {
			await choose(page, named(workspace, 'combobox', develop.choose), 'cube-lut-profile-v1'); await keyboard(page, named(workspace, 'button', develop.add));
			const groups = named(workspace, 'group', develop.shared.videoEffectCubeLutProfile);
			await groups.nth(0).getByLabel(develop.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Quarter red.cube', mimeType: 'text/plain', buffer: RED });
			await expect.poll(() => pixels(named(workspace, 'img', develop.after), 2, 2)).toEqual(Array(4).fill([137, 0, 0, 255]).flat());
			await keyboard(page, named(workspace, 'button', develop.add));
			await groups.nth(1).getByLabel(develop.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Disabled blue.cube', mimeType: 'text/plain', buffer: DISABLED });
			await expect(groups.nth(1).getByRole('status')).toHaveText(develop.shared.videoEffectCubeLutAttached);
			await toggle(page, named(groups.nth(1), 'checkbox', develop.shared.videoEffectCubeLutProfile), false);
			await choose(page, named(workspace, 'combobox', develop.choose), 'develop-geometry-v1'); await keyboard(page, named(workspace, 'button', develop.add));
			const crop = named(workspace, 'spinbutton', `${develop.shared.videoEffectExactValue}: ${develop.shared.videoEffectParamCropWidth}`); await crop.fill('0.5'); await crop.press('Enter');
			await expect.poll(() => pixels(named(workspace, 'img', develop.after), 1, 2)).toEqual(Array(2).fill([137, 0, 0, 255]).flat());
		} else await keyboard(page, named(workspace, 'button', develop.add));
		await keyboard(page, named(workspace, 'button', develop.save)); await expect(workspace.locator('[data-photo-develop-ack]')).toBeVisible();
		await expect(named(workspace, 'button', develop.cancel)).toBeDisabled(); await keyboard(page, named(workspace.locator('.lightscaper-develop-actions'), 'button', develop.close)); await expect(workspace).toHaveCount(0);
		const before = await observe(page, [originalId]), original = before.photos[0], saved = original.photo.versions.find(version => version.id === original.photo.activeVersionId);
		expect(saved.develop.processVersion).toBe(locale === 'de' ? 2 : 1); expect(original.bytes).toEqual([...PNG]); expect(original.photo.original.contentSha256).toBe(sha(PNG));
		await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu); await keyboard(page, named(app, 'button', photoFramescaperHandoffMenuLabel(locale)));
		const downloadDialog = named(page, 'dialog', forward.title), downloaded = page.waitForEvent('download');
		await keyboard(page, named(downloadDialog, 'button', forward.download)); const download = await downloaded;
		await expect(downloadDialog.locator('[data-photo-framescaper-handoff-receipt]')).toHaveAttribute('data-photo-framescaper-handoff-receipt', 'download-started');
		const path = await download.path(); expect(path).not.toBeNull(); const archive = await readFile(path), files = unzipSync(archive), project = JSON.parse(new TextDecoder().decode(files['project.json']));
		expect(project.sources).toHaveLength(1); const source = project.sources[0]; expect(source.develop).toEqual(saved.develop);
		await keyboard(page, named(downloadDialog.locator('.lightscaper-catalog-backup-actions'), 'button', forward.close)); await expect(downloadDialog).toHaveCount(0);
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', photoFramescaperReceiveMenuLabel(locale)));
		const dialog = named(page, 'dialog', words.title); await expect(dialog).toContainText(words.description);
		const input = dialog.getByLabel(words.file, { exact: true }), chooser = named(dialog, 'combobox', words.source);
		const corrupt = rewriteArchive(archive, (files, _project, manifest) => {
			const pack = manifest.assets.find(asset => asset.kind === 'framescaper-image-asset'); expect(pack).toBeTruthy();
			const bytes = files[pack.entry]; bytes[bytes.length - 1] ^= 1;
		});
		// Project digest and declared inventory are intact. Listing this choice
		// grants no selected body authenticity or library publication authority.
		await input.setInputFiles({ name: 'Corrupt selected body.fscape', mimeType: 'application/zip', buffer: corrupt });
		await expect(chooser.locator('option')).toHaveCount(2); await choose(page, chooser, source.id); await keyboard(page, named(dialog, 'button', words.importPhoto));
		await expect(dialog.getByRole('alert')).toHaveText(words.failed); await expect(cards).toHaveCount(1);
		await expect(dialog.locator('[data-photo-framescaper-receive-receipt]')).toHaveCount(0); expect(await observe(page, [originalId])).toEqual(before);
		const unsupported = rewriteArchive(archive, (_files, project, manifest) => {
			const selected = project.sources[0], effectId = selected.develop.effects[0].id;
			selected.develop.masks = [{ schemaVersion: 1, id: 'unsupported-mask', kind: 'mask', inputs: [], outputNodeId: 'rectangle',
				nodes: [{ id: 'rectangle', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }] }];
			selected.develop.maskBindings = [{ effectId, maskId: 'unsupported-mask' }]; selected.provenance.developSha256 = imageDevelopHandoffRecipeSha256V1(selected.develop);
			project.sources[0] = normalizeFramescaperImageSourceV2(selected);
			updateProject(_files, project, manifest);
		});
		await input.setInputFiles({ name: 'Unsupported editable mask.fscape', mimeType: 'application/zip', buffer: unsupported });
		await expect(dialog).toContainText(words.empty); await expect(dialog).toContainText(words.unavailable.replace('{count}', '1'));
		await expect(chooser.locator('option')).toHaveCount(1); await expect(chooser).toHaveValue(''); await expect(named(dialog, 'button', words.importPhoto)).toBeDisabled();
		await expect(cards).toHaveCount(1); expect(await observe(page, [originalId])).toEqual(before);
		await input.setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/zip', buffer: archive });
		await expect(chooser.locator('option')).toHaveCount(2); await expect(chooser).toHaveValue(''); await expect(named(dialog, 'button', words.importPhoto)).toBeDisabled();
		await choose(page, chooser, source.id); await keyboard(page, named(dialog, 'button', words.importPhoto));
		await expect(dialog.locator('[data-photo-framescaper-receive-receipt]')).toHaveText(words.imported); await expect(cards).toHaveCount(2); await expect(library).toHaveAttribute('aria-busy', 'false');
		await keyboard(page, named(dialog.locator('.lightscaper-catalog-backup-actions'), 'button', words.close)); await expect(dialog).toHaveCount(0);
		const ids = await cards.evaluateAll(values => values.map(value => value.getAttribute('data-photo-id'))), receivedId = ids.find(id => id !== originalId), after = await observe(page, ids);
		expect(after.namespace).toBe(before.namespace); expect(after.photos.find(value => value.photo.id === originalId)).toEqual(original);
		const received = after.photos.find(value => value.photo.id === receivedId), version = received.photo.versions.find(value => value.id === received.photo.activeVersionId);
		expect(received.bytes).toEqual([...PNG]); expect(received.photo.revision).toBe(0); expect(received.photo.original.name).toBe(NAME); expect(received.photo.original.contentSha256).toBe(sha(PNG));
		expect(received.photo.original.id).not.toBe(original.photo.original.id); expect(received.photo.original.storageKey).toBe(original.photo.original.storageKey);
		expect(version.id).not.toBe(saved.id); expect(version.develop).toEqual(saved.develop); expect(version.name).toBe(saved.name); expect(version.createdAt).toBe(saved.createdAt);
		await keyboard(page, library.locator(`[data-photo-id="${receivedId}"]`)); await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu); await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale)));
		workspace = named(page, 'dialog', `${develop.title}: ${NAME}`); await expect(named(workspace, 'region', develop.preview)).toHaveAttribute('data-state', 'ready');
		await expect.poll(() => pixels(named(workspace, 'img', develop.after), locale === 'de' ? 1 : 2, 2)).toEqual(locale === 'de' ? Array(2).fill([137, 0, 0, 255]).flat() : WHITE);
		await keyboard(page, named(workspace.locator('.lightscaper-develop-actions'), 'button', develop.close)); await expect(workspace).toHaveCount(0);
		const settled = await observe(page, ids); expect(settled).toEqual(after);
		await page.reload(); await expect(app).toBeVisible(); expect(await observe(page, ids)).toEqual(settled); expect(errors).toEqual([]);
	});
}
function rewriteArchive(bytes, edit) {
	const files = unzipSync(bytes), project = JSON.parse(new TextDecoder().decode(files['project.json'])), manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
	edit(files, project, manifest); return Buffer.from(zipSync(files, { level: 0 }));
}
function updateProject(files, project, manifest) {
	const bytes = new TextEncoder().encode(JSON.stringify(project)); files['project.json'] = bytes;
	manifest.project.size = bytes.length; manifest.project.sha256 = sha(bytes); files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
}
async function open(page, locale) {
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible(); return { app, copy: bundledLightscaperEditorCopyForLocale(locale) };
}
function pixels(canvas, width, height) { return canvas.evaluate((value, dimensions) => value.width === dimensions[0] && value.height === dimensions[1]
	? Array.from(value.getContext('2d').getImageData(0, 0, dimensions[0], dimensions[1]).data) : null, [width, height]); }
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function menu(page, app, label) { await keyboard(page, app.locator('summary').filter({ hasText: new RegExp(`^${label}$`, 'u') })); }
async function toggle(page, input, value) { if (await input.isChecked() === value) return; await input.focus(); await expect(input).toBeFocused(); await page.keyboard.press('Space'); await expect(input).toBeChecked({ checked: value }); }
async function choose(page, combo, value) {
	await expect(combo).toBeVisible(); await expect(combo).toBeEnabled();
	await expect.poll(() => combo.locator('option').evaluateAll((options, value) => options.some(option => option.value === value), value)).toBe(true);
	const index = await combo.locator('option').evaluateAll((options, value) => options.findIndex(option => option.value === value), value);
	expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(64); await combo.focus(); await expect(combo).toBeFocused(); await page.keyboard.press('Home');
	for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown'); await expect(combo).toHaveValue(value);
}
