/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { imageHdrMergeCopy } from '../../src/common/i18n/image-hdr-merge-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoFramescaperCollectionHandoffCopy } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { photoFramescaperCollectionHandoffMenuLabel } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts';
import { hdrMergeBrowserFixtureCurrentV1 } from './helpers/lightscaper-hdr-merge-current-fixture.ts';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { expect, test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });
const PROGRAM = '/__hdr_merge_current_reference.js', COLLECTION = 'HDR source brackets', PHOTO_RESULT = 'Photo HDR result.lshdr', FRAME_RESULT = 'Frame HDR result.lshdr';
let fixture, program;
test.beforeAll(async () => {
	fixture = await hdrMergeBrowserFixtureCurrentV1(); expect(fixture.maximum).toBeGreaterThan(1); expect(fixture.nonWordSamples).toBeGreaterThan(100);
	program = await compileNativeImageHandoffScript('hdr-merge-current-reference.js', fileURLToPath(new URL('./helpers/lightscaper-hdr-merge-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: actual Photo and Frame HDR menus preview canonical brackets, publish Float32 Originals and retain headroom after reload`, async ({ page, context, browserName }) => {
	expect(['chromium', 'firefox']).toContain(browserName); test.setTimeout(300_000);
	const copy = bundledLightscaperEditorCopyForLocale(locale), hdr = imageHdrMergeCopy(locale), words = photoDevelopCopy(locale);
	const frameCopy = locale === 'de' ? EDITOR_GERMAN_COPY : EDITOR_ENGLISH_COPY, errors = [], workers = new Set();
	const framePage = await context.newPage();
	try {
		await install(page); await page.goto(resolveBrowserProductTestUrl(`/lightscaper/${locale}/`));
		const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
		await photoAction(copy.photoImportPhotos);
		const importer = named(page, 'dialog', copy.photoImportPhotos);
		await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles(fixture.sources.map(source => ({ name: source.name, mimeType: 'image/png', buffer: Buffer.from(source.bytes) })));
		await keyboard(named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0); await library(2);
		const inputIds = await app.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-photo-id')));
		expect(inputIds).toHaveLength(2); let originals = await photos(inputIds);
		for (const source of fixture.sources) {
			const item = originals.photos.find(item => item.photo.metadata.fileName === source.name); expect(item).toBeTruthy();
			expect(item.original.bytes).toEqual([...source.bytes]); expect(item.original.sha256).toBe(source.sha256); expect(item.photo.original.mimeType).toBe('image/x-adobe-dng');
		}
		// A real saved creative edit is deliberately unrelated to Original-space
		// merging. Both Photo and the later Frame merge must ignore this recipe.
		const shortPhoto = originals.photos.find(item => item.photo.metadata.fileName === fixture.sources[0].name).photo;
		await keyboard(app.locator(`[data-photo-id="${shortPhoto.id}"]`)); await photoAction(photoDevelopMenuLabel(locale), true);
		let develop = named(page, 'dialog', `${words.title}: ${shortPhoto.metadata.fileName}`);
		await expect(develop.locator('[data-photo-develop-preview]')).toHaveAttribute('data-state', 'ready');
		await named(develop, 'combobox', words.choose).selectOption('tone-ladder-v1'); await keyboard(named(develop, 'button', words.add));
		const exposure = named(develop, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectParamExposure}`);
		await exposure.fill('1'); await exposure.press('Enter'); await keyboard(named(develop, 'button', words.save));
		await expect(develop.locator('[data-photo-develop-ack]')).toBeVisible(); await keyboard(named(develop, 'button', words.close).last()); await expect(develop).toHaveCount(0);
		originals = await photos(inputIds); expect(active(originals.photos.find(item => item.photo.id === shortPhoto.id).photo).develop.effects[0].params.exposure).toBe(1);
		const archive = await collectionArchive(); expect((await photos(inputIds)).photos).toEqual(originals.photos);
		// Actual Current Photo multi-selection and menu entry, never a direct
		// Session import/publish call from the test page.
		await photoAction(copy.photoSelectAll, true); await photoAction(hdr.menu, true);
		let dialog = named(page, 'dialog', hdr.title); await configure(dialog, PHOTO_RESULT); await preview(dialog);
		const previewOnlyPhotos = await photos(inputIds); expect(previewOnlyPhotos.photos).toEqual(originals.photos); expect(previewOnlyPhotos.root.photoCount).toBe(2);
		await keyboard(named(dialog, 'button', hdr.close).last()); await expect(dialog).toHaveCount(0);
		await photoAction(hdr.menu, true); dialog = named(page, 'dialog', hdr.title); await configure(dialog, PHOTO_RESULT); await preview(dialog);
		await keyboard(named(dialog, 'button', hdr.merge)); await expect(dialog.getByRole('status').filter({ hasText: hdr.created })).toBeVisible();
		await expect(dialog.getByRole('alert')).toHaveCount(0); await keyboard(named(dialog, 'button', hdr.close).last()); await expect(dialog).toHaveCount(0); await library(3);
		const allIds = await app.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-photo-id'))), mergedId = allIds.find(id => !inputIds.includes(id));
		expect(mergedId).toBeTruthy(); const merged = await photos([...inputIds, mergedId]), result = merged.photos.find(item => item.photo.id === mergedId);
		expect(merged.photos.filter(item => inputIds.includes(item.photo.id))).toEqual(originals.photos); assertNative(result.native, 'lightscaper');
		expect(result.photo.original.mimeType).toBe('image/x-lightscaper-hdr'); expect(result.photo.original.name).toBe(PHOTO_RESULT);
		expect(active(result.photo).develop.effects).toEqual([]);
		for (const input of result.native.provenance.inputs) {
			const source = originals.photos.find(item => item.photo.id === input.sourceId); expect(source).toBeTruthy();
			expect(input.ownerId).toBe(source.photo.catalogId); expect(input.revision).toBe(source.photo.revision);
			expect(input.original).toEqual({ fileName: source.photo.original.name, mimeType: source.photo.original.mimeType,
				sha256: source.photo.original.contentSha256, byteLength: source.photo.original.byteLength, width: source.photo.original.width, height: source.photo.original.height });
		}
		await page.reload(); await expect(app).toBeVisible(); await library(3); expect(await photos([...inputIds, mergedId])).toEqual(merged);
		await keyboard(app.locator(`[data-photo-id="${mergedId}"]`)); await photoAction(photoDevelopMenuLabel(locale), true);
		develop = named(page, 'dialog', `${words.title}: ${PHOTO_RESULT}`); await expect(develop.locator('[data-photo-develop-preview]')).toHaveAttribute('data-state', 'ready');
		await expect.poll(() => plane(named(develop, 'img', words.before))).toEqual([32, 32, ...fixture.preview]);
		await named(develop, 'combobox', words.choose).selectOption('tone-ladder-v1'); await keyboard(named(develop, 'button', words.add));
		const hdrExposure = named(develop, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectParamExposure}`);
		await hdrExposure.fill('-2'); await hdrExposure.press('Enter'); await expect.poll(() => plane(named(develop, 'img', words.after))).toEqual([32, 32, ...fixture.developed]);
		await keyboard(named(develop, 'button', words.save)); await expect(develop.locator('[data-photo-develop-ack]')).toBeVisible();
		await keyboard(named(develop, 'button', words.close).last()); const saved = await photos([...inputIds, mergedId]);
		expect(saved.photos.find(item => item.photo.id === mergedId).original).toEqual(result.original); expect(saved.photos.find(item => item.photo.id === mergedId).native).toEqual(result.native);
		await page.reload(); await expect(app).toBeVisible(); await library(3); expect(await photos([...inputIds, mergedId])).toEqual(saved);

		await install(framePage); const editor = await bootEditor(framePage, `/framescaper/embed/${locale}/`), initialProject = await editor.getAttribute('data-project-id');
		const choosing = framePage.waitForEvent('filechooser'); await chooseCommandAction(framePage, editor, frameCopy.fileMenu, frameCopy.open);
		await (await choosing).setFiles({ name: `${COLLECTION}.fscape`, mimeType: 'application/vnd.soundscaper.scape+zip', buffer: archive });
		await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(initialProject); await waitForProjectActivation(editor);
		const projectId = await editor.getAttribute('data-project-id'); expect(projectId).toBeTruthy(); let frameBefore = await frames(projectId);
		expect(frameBefore.images).toHaveLength(2); expect(frameBefore.images.every(item => item.source.schemaVersion === 4)).toBe(true);
		for (const source of fixture.sources) { const image = frameBefore.images.find(item => item.original.sha256 === source.sha256); expect(image).toBeTruthy(); expect(image.original.bytes).toEqual([...source.bytes]); }
		// Collection handoff currently creates a timeline sequence. The fallback
		// placement branch also follows real UI if a future reader puts it in bin.
		for (const image of frameBefore.images) if (!frameBefore.project.clips.some(clip => clip.sourceId === image.source.id)) {
			if (!await editor.locator('[data-workspace-panel="project-bin"]').isVisible()) await chooseNestedCommandAction(framePage, editor, frameCopy.windowMenu, [frameCopy.panelProjectBin]);
			const bin = editor.locator(`[data-project-bin-item][data-source-id="${image.source.id}"]`);
			await named(bin, 'button', `${frameCopy.projectBinAddToTimeline}: ${image.source.name}`).click();
		}
		frameBefore = await frames(projectId); const inputClips = frameBefore.project.clips.filter(clip => frameBefore.images.some(item => item.source.id === clip.sourceId));
		expect(inputClips).toHaveLength(2);
		// Clip-body pointer presses select time; the existing keyboard path
		// selects clips. The HDR owner captures these live selected IDs.
		await editor.locator(`[data-track-lane] [data-clip-id="${inputClips[0].id}"][role="group"]`).press('Enter');
		await editor.locator(`[data-track-lane] [data-clip-id="${inputClips[1].id}"][role="group"]`).press('Shift+Enter');
		await expect.poll(() => editor.locator('[data-track-lane] [data-clip-id][role="group"] > .clip-display--selected')
			.evaluateAll(nodes => nodes.map(node => node.parentElement.getAttribute('data-clip-id')).sort())).toEqual(inputClips.map(clip => clip.id).sort());
		frameBefore = await frames(projectId);
		await chooseCommandAction(framePage, editor, frameCopy.effectMenu, hdr.menu);
		dialog = named(framePage, 'dialog', hdr.title);
		await expect(named(dialog, 'button', hdr.preview)).toHaveCSS('pointer-events', 'auto');
		await configure(dialog, FRAME_RESULT); await preview(dialog);
		const previewOnly = await frames(projectId); expect(previewOnly.images).toEqual(frameBefore.images); expect(previewOnly.project.sources).toHaveLength(2); expect(previewOnly.project.projectBin.clips).toHaveLength(frameBefore.project.projectBin.clips.length);
		await keyboard(named(dialog, 'button', hdr.merge)); await expect(dialog.getByRole('status').filter({ hasText: hdr.created })).toBeVisible();
		await expect(dialog.getByRole('alert')).toHaveCount(0); await keyboard(named(dialog, 'button', hdr.close).last()); await expect(dialog).toHaveCount(0);
		await chooseCommandAction(framePage, editor, frameCopy.fileMenu, frameCopy.saveProject);
		await expect.poll(async () => (await frames(projectId)).images.filter(item => item.source.schemaVersion === 5).length).toBe(1);
		const published = await frames(projectId), native = published.images.find(item => item.source.schemaVersion === 5); assertNative(native.native, 'framescaper');
		expect(native.source.original.fileName).toBe(FRAME_RESULT); expect(native.source.develop.effects).toEqual([]); expect(native.source.hdr.pixelsSha256).toBe(fixture.pixelsSha256);
		expect(published.images.filter(item => item.source.schemaVersion === 4)).toEqual(frameBefore.images);
		const resultClip = published.project.projectBin.clips.find(clip => clip.sourceId === native.source.id); expect(resultClip).toBeTruthy();
		if (!await editor.locator('[data-workspace-panel="project-bin"]').isVisible()) await chooseNestedCommandAction(framePage, editor, frameCopy.windowMenu, [frameCopy.panelProjectBin]);
		const thumbnail = editor.locator(`[data-project-bin-item][data-source-id="${native.source.id}"] [data-project-bin-visual-canvas]`);
		await expect(thumbnail).toBeVisible(); await expect.poll(() => thumbnailPlane(thumbnail)).toEqual([320, 180, ...fixture.preview]);
		await framePage.reload(); await expect(editor).toHaveAttribute('data-project-id', projectId); await waitForProjectActivation(editor);
		expect(await frames(projectId)).toEqual(published); await expect.poll(() => thumbnailPlane(thumbnail)).toEqual([320, 180, ...fixture.preview]);
		await expect.poll(() => workers.size).toBe(0); expect(errors).toEqual([]);

		function photos(ids) { return page.evaluate(async ({ path, ids }) => (await import(new URL(path, location.href).href)).readHdrMergePhotosCurrentV1(ids), { path: PROGRAM, ids }); }
		function frames(id) { return framePage.evaluate(async ({ path, id }) => (await import(new URL(path, location.href).href)).readHdrMergeFrameCurrentV1(id), { path: PROGRAM, id }); }
		async function photoMenu(label) { const summary = app.getByRole('navigation').getByText(label, { exact: true }); if (!await summary.locator('..').evaluate(node => node.open)) await summary.click(); await expect(summary.locator('..')).toHaveJSProperty('open', true); }
		async function photoAction(label, nested = false) { await photoMenu(copy.photoFileMenu); if (nested) await photoMenu(copy.photoPhotoMenu); await keyboard(named(app, 'button', label)); }
		async function library(count) { const library = app.locator('[data-photo-library]'); if (!await library.isVisible()) { await photoMenu(copy.photoViewMenu); await keyboard(named(app, 'button', copy.photoShowLibrary)); }
			await expect(library).toHaveAttribute('aria-busy', 'false'); await expect(library.locator('[data-photo-id]')).toHaveCount(count); }
		async function collectionArchive() {
			await photoAction(copy.photoOrganizerTitle); const organizer = named(page, 'dialog', copy.photoOrganizerTitle);
			await named(organizer, 'combobox', copy.photoOrganizerKind).filter({ has: named(page, 'option', copy.photoOrganizerCollection) }).selectOption('collection');
			await keyboard(named(organizer, 'button', copy.photoOrganizerCreate).and(organizer.locator('button:not(form button)')));
			await named(organizer, 'textbox', copy.photoOrganizerName).fill(COLLECTION); await named(organizer.locator('form'), 'combobox', copy.photoOrganizerKind).selectOption('smart');
			await named(organizer, 'textbox', copy.photoOrganizerQueryJson).fill(JSON.stringify({ kind: 'rating', minimum: 0, maximum: 5 }));
			await keyboard(named(organizer.locator('form'), 'button', copy.photoOrganizerCreate)); await expect(organizer.locator('[data-organizer-selected]')).toContainText(COLLECTION);
			await keyboard(named(organizer.locator('form'), 'button', copy.photoCloseMetadata));
			await photoAction(photoFramescaperCollectionHandoffMenuLabel(locale), true);
			const collectionCopy = photoFramescaperCollectionHandoffCopy(locale), owner = named(page, 'dialog', collectionCopy.title);
			await named(owner, 'combobox', collectionCopy.scope).selectOption('catalog');
			await keyboard(named(owner, 'button', `${copy.photoDefinitionChoose}: ${COLLECTION} — ${collectionCopy.smart}`));
			const waiting = page.waitForEvent('download'); await keyboard(named(owner, 'button', collectionCopy.download)); const download = await waiting;
			await expect(owner.locator('[data-photo-framescaper-collection-handoff-receipt]')).toHaveAttribute('data-photo-framescaper-collection-handoff-receipt', 'download-started');
			const bytes = await readFile(await download.path()), project = JSON.parse(new TextDecoder().decode(unzipSync(bytes)['project.json']));
			expect(project.sources).toHaveLength(2); expect(project.sources.every(source => source.schemaVersion === 4)).toBe(true);
			await keyboard(named(owner.locator('.lightscaper-catalog-backup-actions'), 'button', collectionCopy.close)); await expect(owner).toHaveCount(0); return bytes;
		}
		async function configure(owner, fileName) {
			await expect(named(owner, 'button', hdr.preview)).toBeEnabled(); await named(owner, 'combobox', hdr.reference).selectOption({ label: fixture.sources[1].name });
			await named(owner, 'spinbutton', `${fixture.sources[0].name} — ${hdr.exposure}`).fill('-2');
			await named(owner, 'combobox', hdr.alignment).selectOption('none'); await named(owner, 'combobox', hdr.deghost).selectOption('off');
			await named(owner, 'textbox', hdr.fileName).fill(fileName); await expect(named(owner, 'button', hdr.preview)).toBeEnabled();
		}
		async function preview(owner) { await named(owner, 'button', hdr.preview).click(); await expect(owner.locator('[data-image-hdr-preview]')).toHaveAttribute('data-state', 'ready');
			await expect.poll(() => plane(named(owner, 'img', hdr.preview))).toEqual([32, 32, ...fixture.preview]); await expect(owner.getByRole('alert')).toHaveCount(0); }
		function assertNative(native, product) {
			expect(native.width).toBe(32); expect(native.height).toBe(32); expect(native.bits).toEqual(fixture.bits); expect(native.pixelsSha256).toBe(fixture.pixelsSha256); expect(native.maximum).toBeGreaterThan(1);
			expect(native.provenance.operation).toBe('hdr-merge-v1'); expect(native.provenance.alignment).toBe('none'); expect(native.provenance.output).toEqual({ x: 0, y: 0, width: 32, height: 32 });
			expect(native.provenance.inputs).toHaveLength(2); expect(native.provenance.inputs.every(input => input.product === product)).toBe(true);
			const short = native.provenance.inputs.find(input => input.original.fileName === fixture.sources[0].name), long = native.provenance.inputs.find(input => input.original.fileName === fixture.sources[1].name);
			expect(short.exposureMultiplier).toBe(.25); expect(long.exposureMultiplier).toBe(1); expect(native.provenance.inputs[native.provenance.referenceIndex]).toEqual(long);
			expect(short.original.sha256).toBe(fixture.sources[0].sha256); expect(long.original.sha256).toBe(fixture.sources[1].sha256); expect(native.provenance.inputs.every(input => input.offset.x === 0 && input.offset.y === 0)).toBe(true);
		}
	} finally { await framePage.close(); }
	async function install(recipient) {
		recipient.on('pageerror', error => { errors.push(error.message); }); recipient.on('worker', worker => {
			if (!new URL(worker.url()).pathname.includes('libraw-worker-v1')) return;
			workers.add(worker); worker.on('close', () => { workers.delete(worker); });
		});
		await recipient.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		await recipient.route('https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm', route => route.fulfill({ contentType: 'application/wasm', headers: { 'access-control-allow-origin': '*' }, body: Buffer.from(fixture.wasm) }));
		await recipient.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	}
});

function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(control) { await expect(control).toBeEnabled(); await control.press('Enter'); }
function active(photo) { return photo.versions.find(version => version.id === photo.activeVersionId); }
function plane(canvas) { return canvas.evaluate(node => [node.width, node.height, ...(node.width && node.height ? node.getContext('2d').getImageData(0, 0, node.width, node.height).data : [])]); }
function thumbnailPlane(canvas) { return canvas.evaluate(node => {
	const context = node.getContext('2d'), values = []; for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) values.push(...context.getImageData(Math.floor((x + .5) * node.width / 32), Math.floor((y + .5) * node.height / 32), 1, 1).data);
	return [node.width, node.height, ...values];
}); }
