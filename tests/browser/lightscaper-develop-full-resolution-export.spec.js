/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { collectsBrowserCoverage } from '../../scripts/lib/browser-coverage-profile.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoPngExportCopy } from '../../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import { photoPngExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-png-export-menu-copy.ts';
import { photoFramescaperHandoffCopy } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { photoFramescaperHandoffMenuLabel } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts';
import { imageExportGraphicCopy } from '../../src/common/i18n/image-export-graphic-copy.ts';
import { imageExportTextCopy } from '../../src/common/i18n/image-export-text-copy.ts';
import { createDevelopProxyPngV1, developProxyReferenceFactsV1, developProxyReferenceWitnessesV1 } from './helpers/lightscaper-develop-proxy-reference.ts';
import { developFullResolutionReferenceFactsV1, developFullResolutionReferenceWitnessesV1 } from './helpers/lightscaper-develop-full-resolution-reference.ts';
import { expect, test, installNativeImageHandoffRuntime, observeNativePhotoDevelopProxyCustody, validateNativePhotoDevelopProxyCanvas,
	validateNativePhotoDevelopFullResolutionCanvas, inspectNativePhotoDevelopFullResolutionPng,
	inspectNativePhotoDevelopFullResolutionFramescaper } from './helpers/lightscaper-image-handoff-native-fixture.js';

const BEFORE = '[data-photo-develop-before]', AFTER = '[data-photo-develop-after]';
const PHASES = Object.freeze(['import', 'proxy-edit-save', 'full-preview', 'png-export', 'png-validation', 'editable-export', 'frame-validation', 'reopen-custody']);
// Eight bounded sequential phases receive one native decode-deadline unit each.
// This is a finite harness envelope, not a per-phase performance guarantee.
const CASE_DEADLINE_MS = PHASES.length * 60_000, COVERED_CASE_DEADLINE_MS = CASE_DEADLINE_MS * 2;

for (const locale of ['en', 'de']) test(`${locale}: saved spatial Develop matches full preview, native PNG and editable Frame natural pixels without changing sender custody`, async ({ page, browser, browserName }) => {
	test.skip(browserName === 'webkit', 'The roadmap defers the full native WebKit storage workflow.');
	const instrumentation = collectsBrowserCoverage(browserName) ? 'v8-browser' : 'none';
	const caseDeadlineMs = instrumentation === 'v8-browser' ? COVERED_CASE_DEADLINE_MS : CASE_DEADLINE_MS;
	test.setTimeout(caseDeadlineMs);
	expect(test.info().config.workers).toBe(1); expect(test.info().project.retries).toBe(0); expect(test.info().retry).toBe(0);
	const fixture = await createDevelopProxyPngV1(), copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale);
	const settings = photoDevelopSettingsCopy(locale), pngCopy = photoPngExportCopy(locale), handoffCopy = photoFramescaperHandoffCopy(locale);
	const proxyFacts = Object.fromEntries(['before', 'dehaze', 50].map(stage => [stage, developProxyReferenceFactsV1(stage)]));
	const proxyWitnesses = Object.fromEntries(['before', 'dehaze', 50].map(stage => [stage, developProxyReferenceWitnessesV1(stage)]));
	const fullFacts = Object.fromEntries(['before', 'dehaze', 'sharpen50'].map(stage => [stage, developFullResolutionReferenceFactsV1(stage)]));
	const fullWitnesses = developFullResolutionReferenceWitnessesV1('sharpen50');
	const errors = [], downloads = [], checks = [];
	page.on('pageerror', error => { errors.push(error.message); });
	page.on('download', download => { downloads.push(download.suggestedFilename()); });
	const observation = { schemaVersion: 1, workload: 'lightscaper-develop-full-resolution-export-v1', locale,
		browser: { name: browserName, version: browser.version() }, instrumentation,
		protocol: { workers: 1, retries: 0, caseDeadlineMs, phaseAllowanceBasisMs: 60_000,
			phaseAllowanceKind: 'whole-case-harness-only', phases: PHASES },
		fixture: { fileName: fixture.fileName, width: fixture.width, height: fixture.height, byteLength: fixture.byteLength,
			encodedSha256: fixture.contentSha256, sourceRgbaSha256: fixture.rgbaSha256 },
		completedPhases: [], checks, png: null, frame: null, custody: null, errors };
	let completed = false;
	try {
		expect([fixture.width, fixture.height, fixture.bytes.byteLength]).toEqual([4096, 3072, fixture.byteLength]);
		expect(fixture.contentSha256).toBe('79345b64d7a00ab8b24934b46876631885d87dcab6e7c2e0a9a0d2097b761934');
		expect(fixture.rgbaSha256).toBe('41db31fb6114cdd03b0cb3fbba0b6a6ab5c4a0d3718f633c891b2001ffab4833');
		expect(sha(fixture.bytes)).toBe(fixture.contentSha256); expect(fullFacts.before.rgbaSha256).toBe(fixture.rgbaSha256);
		expect(fullFacts.sharpen50.rgbaSha256).not.toBe(proxyFacts[50].rgbaSha256);
		await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); });
		await installNativeImageHandoffRuntime(page);
		const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
		await page.goto(`${origin}/${locale}/`); const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
		await action(page, app, copy.photoFileMenu, copy.photoImportPhotos);
		const importer = named(page, 'dialog', copy.photoImportPhotos);
		await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: fixture.fileName, mimeType: fixture.mimeType, buffer: Buffer.from(fixture.bytes) });
		await keyboard(page, named(importer, 'button', copy.photoImportAction)); await importer.waitFor({ state: 'detached', timeout: 0 });
		const library = app.locator('[data-photo-library]'), card = library.locator('[data-photo-id]');
		await expect(card).toHaveCount(1, { timeout: caseDeadlineMs }); await expect(library).toHaveAttribute('aria-busy', 'false', { timeout: caseDeadlineMs });
		const photoId = await card.getAttribute('data-photo-id'); expect(photoId).not.toBeNull();
		const initial = await observeNativePhotoDevelopProxyCustody(page, photoId); assertOriginal(initial, fixture);
		observation.completedPhases.push('import'); await keyboard(page, card); await openDevelop();
		const dialog = named(page, 'dialog', `${words.title}: ${fixture.fileName}`), history = named(dialog, 'combobox', words.history), version = named(dialog, 'combobox', words.version);
		await readyProxy('before'); await validateProxy('before', BEFORE); await validateProxy('before');
		await expect(history).toHaveValue('0'); const versionId = await version.inputValue(); expect(versionId).toBe(initial.photo.activeVersionId);
		await choose(page, named(dialog, 'combobox', words.choose), 'dehaze-v1'); await keyboard(page, named(dialog, 'button', words.add));
		const dehaze = parameter(dialog, words, 'videoEffectDehazeAmount'); await dehaze.fill('37.125'); await dehaze.press('Enter');
		await readyProxy('dehaze'); await validateProxy('dehaze');
		await choose(page, named(dialog, 'combobox', words.choose), 'detail-sharpen-v1'); await keyboard(page, named(dialog, 'button', words.add));
		const sharpen = parameter(dialog, words, 'videoEffectDetailSharpenAmount'); await sharpen.fill('50'); await sharpen.press('Enter');
		await readyProxy(50); await validateProxy(50); await expect(parameter(dialog, words, 'videoEffectDetailSharpenThreshold')).toHaveValue('0');
		await expect(history).toHaveValue('0'); await expect(dialog.getByRole('alert')).toHaveCount(0);
		await keyboard(page, named(dialog, 'button', words.save));
		await expect(dialog.locator('[data-photo-develop-ack]')).toContainText(words.acknowledged, { timeout: caseDeadlineMs });
		await expect(named(dialog, 'button', words.cancel)).toBeDisabled(); await expect(history).toHaveValue('1'); await expect(version).toHaveValue(versionId);
		await readyProxy(50); const saved = await observeNativePhotoDevelopProxyCustody(page, photoId);
		assertSaved(initial.photo, saved.photo, versionId); assertOriginal(saved, fixture);
		expect(saved.original).toEqual(initial.original); expect(saved.namespace).toBe(initial.namespace);
		observation.completedPhases.push('proxy-edit-save');
		const settingsMenu = dialog.getByText(settings.menu, { exact: true }); await keyboard(page, settingsMenu);
		await expect(named(dialog, 'button', words.fitResolution)).toHaveAttribute('aria-pressed', 'true');
		await keyboard(page, named(dialog, 'button', words.fullResolution)); await readyFull();
		await expect(named(dialog, 'region', words.imageViewport)).toBeVisible();
		await validateFull('before', BEFORE); const full = await validateFull('sharpen50');
		await expect(history).toHaveValue('1'); await expect(named(dialog, 'button', words.save)).toBeDisabled();
		expect(await observeNativePhotoDevelopProxyCustody(page, photoId)).toEqual(saved);
		await closeDevelop(); observation.completedPhases.push('full-preview');

		await action(page, app, copy.photoFileMenu, photoPngExportMenuLabel(locale), copy.photoPhotoMenu);
		const exporter = named(page, 'dialog', pngCopy.title), savePng = named(exporter, 'button', pngCopy.save);
		await expect(savePng).toBeEnabled({ timeout: caseDeadlineMs }); await choose(page, named(exporter, 'combobox', pngCopy.outputSize), 'original');
		await expect(named(exporter, 'combobox', pngCopy.metadata)).toHaveValue('strip'); await expect(named(exporter, 'textbox', pngCopy.filenameTemplate)).toHaveValue('{name}');
		for (const label of [pngCopy.outputSharpen, pngCopy.sidecar, imageExportGraphicCopy(locale).enabled, imageExportTextCopy(locale).enabled]) {
			const checkbox = named(exporter, 'checkbox', label); await expect(checkbox).not.toBeChecked(); await checkbox.setChecked(false);
		}
		await expect(exporter.getByRole('alert')).toHaveCount(0);
		const pngWaiting = page.waitForEvent('download', { timeout: 0 }); await keyboard(page, savePng); const pngDownload = await pngWaiting;
		await expect(exporter.locator('[data-photo-png-export-receipt]')).toHaveAttribute('data-photo-png-export-status', 'download-started', { timeout: caseDeadlineMs });
		await expect(exporter.locator('[data-photo-png-export-receipt]')).toContainText(pngCopy.downloadStarted.replace('{name}', fixture.fileName));
		expect(pngDownload.suggestedFilename()).toBe(fixture.fileName); expect(await pngDownload.failure()).toBeNull();
		await expect(savePng).toBeEnabled({ timeout: caseDeadlineMs }); await expect(exporter.getByRole('alert')).toHaveCount(0);
		await keyboard(page, named(exporter.locator('.lightscaper-catalog-backup-actions'), 'button', pngCopy.close)); await exporter.waitFor({ state: 'detached', timeout: 0 });
		observation.completedPhases.push('png-export');
		const pngBytes = await downloadedBytes(pngDownload, 256 * 1024 * 1024);
		try {
			observation.png = await inspectNativePhotoDevelopFullResolutionPng(page, pngBytes, 'sharpen50');
			expect(observation.png.encodedByteLength).toBe(pngBytes.byteLength); expect(observation.png.encodedSha256).toBe(sha(pngBytes));
		}
		finally { pngBytes.fill(0); }
		expect(observation.png.container).toEqual({ width: 4096, height: 3072, bitDepth: 8, colorType: 6, srgbIntent: 0, iccProfileCount: 0 });
		assertValidation(observation.png.validation, fullFacts.sharpen50); expect(observation.png.validation.actualRgbaSha256).toBe(full.actualRgbaSha256);
		expect(await observeNativePhotoDevelopProxyCustody(page, photoId)).toEqual(saved); observation.completedPhases.push('png-validation');

		await action(page, app, copy.photoFileMenu, photoFramescaperHandoffMenuLabel(locale), copy.photoPhotoMenu);
		const handoff = named(page, 'dialog', handoffCopy.title), downloadCopy = named(handoff, 'button', handoffCopy.download);
		await expect(handoff.getByText(handoffCopy.description, { exact: true })).toBeVisible(); await expect(downloadCopy).toBeEnabled({ timeout: caseDeadlineMs });
		const archiveWaiting = page.waitForEvent('download', { timeout: 0 }); await keyboard(page, downloadCopy); const archiveDownload = await archiveWaiting;
		const archiveName = fixture.fileName.replace(/\.[^.]+$/u, '') + '.fscape'; expect(archiveDownload.suggestedFilename()).toBe(archiveName);
		await expect(handoff.locator('[data-photo-framescaper-handoff-receipt]')).toHaveAttribute('data-photo-framescaper-handoff-receipt', 'download-started', { timeout: caseDeadlineMs });
		await expect(handoff.locator('[data-photo-framescaper-handoff-receipt]')).toHaveText(handoffCopy.downloadStarted.replace('{name}', archiveName));
		expect(await archiveDownload.failure()).toBeNull(); await expect(downloadCopy).toBeEnabled({ timeout: caseDeadlineMs }); await expect(handoff.getByRole('alert')).toHaveCount(0);
		await keyboard(page, named(handoff.locator('.lightscaper-catalog-backup-actions'), 'button', handoffCopy.close)); await handoff.waitFor({ state: 'detached', timeout: 0 });
		observation.completedPhases.push('editable-export');
		const archiveBytes = await downloadedBytes(archiveDownload, 256 * 1024 * 1024);
		try { observation.frame = await inspectNativePhotoDevelopFullResolutionFramescaper(page, archiveBytes, 'sharpen50'); }
		finally { archiveBytes.fill(0); }
		assertFrame(observation.frame, saved, fixture); assertValidation(observation.frame.validation, fullFacts.sharpen50);
		expect(observation.frame.validation.actualRgbaSha256).toBe(observation.png.validation.actualRgbaSha256);
		expect(await observeNativePhotoDevelopProxyCustody(page, photoId)).toEqual(saved); observation.completedPhases.push('frame-validation');

		await openDevelop(); await readyProxy(50); await validateProxy(50); await expect(history).toHaveValue('1'); await expect(version).toHaveValue(versionId);
		await expect(dehaze).toHaveValue('37.125'); await expect(sharpen).toHaveValue('50'); await expect(named(dialog, 'region', words.imageViewport)).toHaveCount(0);
		await expect(named(dialog, 'button', words.save)).toBeDisabled(); await closeDevelop(); expect(await observeNativePhotoDevelopProxyCustody(page, photoId)).toEqual(saved);
		await page.reload(); await expect(app).toBeVisible(); await expect(library).toHaveCount(0);
		await action(page, app, copy.photoViewMenu, copy.photoShowLibrary); await expect(card).toHaveCount(1, { timeout: caseDeadlineMs });
		await expect(library).toHaveAttribute('aria-busy', 'false', { timeout: caseDeadlineMs }); await keyboard(page, card); await openDevelop();
		await readyProxy(50); await validateProxy('before', BEFORE); await validateProxy(50);
		await expect(history).toHaveValue('1'); await expect(version).toHaveValue(versionId); await expect(dehaze).toHaveValue('37.125'); await expect(sharpen).toHaveValue('50');
		await expect(parameter(dialog, words, 'videoEffectDetailSharpenThreshold')).toHaveValue('0'); await expect(named(dialog, 'button', words.save)).toBeDisabled();
		const reloaded = await observeNativePhotoDevelopProxyCustody(page, photoId); expect(reloaded).toEqual(saved); await expect(dialog.getByRole('alert')).toHaveCount(0); await closeDevelop();
		observation.custody = { initial, saved, reloaded }; observation.completedPhases.push('reopen-custody');
		expect(downloads).toEqual([fixture.fileName, archiveName]); expect(errors).toEqual([]); expect(observation.completedPhases).toEqual(PHASES); completed = true;

		async function openDevelop() { await action(page, app, copy.photoFileMenu, photoDevelopMenuLabel(locale), copy.photoPhotoMenu); await expect(named(page, 'dialog', `${words.title}: ${fixture.fileName}`)).toBeVisible(); }
		async function closeDevelop() { await keyboard(page, named(dialog.locator('.lightscaper-develop-actions'), 'button', words.close)); await dialog.waitFor({ state: 'detached', timeout: 0 }); }
		async function readyProxy(stage) { await page.waitForFunction(({ label, pixels }) => {
			const region = document.querySelector('[data-photo-develop-preview]'), canvas = document.querySelector('[data-photo-develop-after]');
			if (region?.getAttribute('aria-label') !== label || region.getAttribute('data-state') !== 'ready' || canvas?.width !== 2048 || canvas.height !== 1536) return false;
			const context = canvas.getContext('2d'); return pixels.every(({ x, y, rgba }) => context.getImageData(x, y, 1, 1).data.every((value, index) => value === rgba[index]));
		}, { label: words.preview, pixels: proxyWitnesses[stage] }, { timeout: 0 }); await paint(page); }
		async function readyFull() { await page.waitForFunction(({ label, pixels }) => {
			const region = document.querySelector('[data-photo-develop-preview]'), before = document.querySelector('[data-photo-develop-before]'), after = document.querySelector('[data-photo-develop-after]');
			if (region?.getAttribute('aria-label') !== label || region.getAttribute('data-state') !== 'ready' || before?.width !== 4096 || before.height !== 3072 || after?.width !== 4096 || after.height !== 3072) return false;
			const context = after.getContext('2d'); return pixels.every(({ x, y, rgba }) => context.getImageData(x, y, 1, 1).data.every((value, index) => value === rgba[index]));
		}, { label: words.fullPreview, pixels: fullWitnesses }, { timeout: 0 }); await paint(page); }
		async function validateProxy(stage, selector = AFTER) {
			const checked = await validateNativePhotoDevelopProxyCanvas(page, selector, stage); checks.push({ resolution: 'proxy', selector, stage, ...checked });
			assertValidation(checked, proxyFacts[stage]); await histogram(dialog, words, locale, selector === BEFORE ? words.before : words.after, proxyFacts[stage].histogram); return checked;
		}
		async function validateFull(stage, selector = AFTER) {
			const checked = await validateNativePhotoDevelopFullResolutionCanvas(page, selector, stage); checks.push({ resolution: 'full', selector, stage, ...checked });
			assertValidation(checked, fullFacts[stage]); await histogram(dialog, words, locale, selector === BEFORE ? words.before : words.after, fullFacts[stage].histogram); return checked;
		}
		async function keyboard(page, control) { await expect(control).toBeEnabled({ timeout: caseDeadlineMs }); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
		async function action(page, app, menu, label, submenu) {
			await keyboard(page, app.getByRole('navigation').getByText(menu, { exact: true }));
			if (submenu) await keyboard(page, app.getByRole('navigation').getByText(submenu, { exact: true })); await keyboard(page, named(app, 'button', label));
		}
		async function choose(page, control, value) {
			await expect(control).toBeEnabled({ timeout: caseDeadlineMs }); const values = await control.locator('option').evaluateAll(options => options.map(option => option.value)), target = values.indexOf(value);
			expect(target).toBeGreaterThanOrEqual(0); expect(values.length).toBeLessThanOrEqual(64); await control.focus(); await expect(control).toBeFocused();
			await page.keyboard.press('Home'); for (let index = 0; index < target; index++) await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab'); await expect(control).toHaveValue(value);
		}
	} finally {
		fixture.bytes.fill(0);
		await test.info().attach(completed ? 'full-resolution-export-observation' : 'full-resolution-export-partial', { body: JSON.stringify(observation), contentType: 'application/json' });
	}
});

function assertValidation(checked, expected) {
	expect(checked.mismatchCount).toBe(0); expect(checked.maximumChannelError).toBe(0); expect(checked.firstMismatch).toBeNull();
	expect([checked.width, checked.height, checked.byteLength]).toEqual([expected.width, expected.height, expected.byteLength]);
	expect(checked.actualRgbaSha256).toBe(expected.rgbaSha256); expect(checked.expectedRgbaSha256).toBe(expected.rgbaSha256); expect(checked.histogram).toEqual(expected.histogram);
}
function assertOriginal(snapshot, fixture) {
	expect(snapshot.original.sha256).toBe(fixture.contentSha256); expect(snapshot.original.byteLength).toBe(fixture.byteLength);
	expect(snapshot.photo.original.contentSha256).toBe(fixture.contentSha256); expect(snapshot.photo.original.byteLength).toBe(fixture.byteLength);
	expect([snapshot.photo.original.width, snapshot.photo.original.height]).toEqual([4096, 3072]);
}
function assertSaved(initial, saved, versionId) {
	expect({ ...saved, revision: initial.revision, versions: initial.versions }).toEqual(initial); expect(saved.revision).toBe(initial.revision + 1);
	const previous = initial.versions.find(version => version.id === versionId), current = saved.versions.find(version => version.id === versionId);
	expect(current.develop.effects.map(effect => ({ type: effect.type, enabled: effect.enabled, params: effect.params })))
		.toEqual([{ type: 'dehaze-v1', enabled: true, params: { amount: 37.125 } }, { type: 'detail-sharpen-v1', enabled: true, params: { amount: 50, threshold: 0 } }]);
	expect(current.develop.processVersion).toBe(1); expect(current.develop.geometry).toEqual(previous.develop.geometry);
	expect(current.develop.masks).toEqual([]); expect(current.develop.maskBindings).toEqual([]);
	expect(current.workspace.cursor).toBe(1); expect(current.workspace.entries).toHaveLength(2);
	expect(current.workspace.entries[0].develop).toEqual(previous.develop); expect(current.workspace.entries[1].develop).toEqual(current.develop); expect(current.workspace.snapshots).toEqual([]);
}
function assertFrame(frame, sender, fixture) {
	const source = frame.source, version = sender.photo.versions.find(value => value.id === sender.photo.activeVersionId);
	expect(source.schemaVersion).toBe(2); expect(source.kind).toBe('image'); expect(source.develop).toEqual(version.develop);
	expect([source.canonical.width, source.canonical.height, source.canonical.frameCount, source.canonical.hasAlpha]).toEqual([4096, 3072, 1, false]);
	expect(source.developed).toEqual({ width: 4096, height: 3072 });
	expect(source.original).toEqual({ fileName: sender.photo.original.name, mimeType: 'image/png', recognizedFormat: 'png', byteLength: fixture.byteLength, sha256: fixture.contentSha256 });
	expect(source.provenance.original).toEqual({ exactName: sender.photo.original.name, sha256: fixture.contentSha256, byteLength: fixture.byteLength });
	expect(source.provenance.origin).toEqual({ schemaFamily: 'lightscaper', schemaVersion: sender.photo.schemaVersion, catalogId: sender.photo.catalogId,
		photoId: sender.photo.id, revision: sender.photo.revision, versionId: version.id, versionKind: version.kind, versionName: version.name, versionCreatedAt: version.createdAt });
	expect(frame.original).toEqual({ sha256: fixture.contentSha256, byteLength: fixture.byteLength, exactName: sender.photo.original.name });
	expect(frame.pack.byteLength).toBe(source.assetByteLength); expect(frame.pack.sha256).toBe(source.contentSha256);
	expect(frame.pack.byteLength).toBeLessThanOrEqual(128 * 1024 * 1024);
	expect(frame.clip.sourceId).toBe(source.id); expect(frame.clip.sequenceId).toBe(frame.sequence.id);
	expect([frame.clip.sequenceStartFrame, frame.clip.sequenceFrameCount, frame.clip.sourceStartTicks]).toEqual([0, 150, '0']);
	expect(frame.sequence.rate).toEqual({ num: 30, den: 1 }); expect(frame.project.id).toBeTruthy();
	expect(frame.project.savedRevision).toBe(frame.project.revision); expect(frame.project.primarySequenceId).toBe(frame.sequence.id);
}
async function histogram(dialog, words, locale, label, expected) {
	const value = named(dialog, 'img', `${words.histogram}: ${label}`), maximum = Math.max(1, ...expected.bins.red, ...expected.bins.green, ...expected.bins.blue);
	expect(await value.evaluate(svg => [...svg.querySelectorAll('polyline')].map(line => ({ channel: line.getAttribute('stroke'), points: line.getAttribute('points') }))))
		.toEqual(['red', 'green', 'blue'].map(channel => ({ channel, points: expected.bins[channel].map((count, index) => `${index},${100 - count / maximum * 100}`).join(' ') })));
	const number = new Intl.NumberFormat(locale);
	expect(await value.evaluate(svg => [...svg.parentElement.querySelectorAll('dl > *')].map(node => node.textContent)))
		.toEqual([words.samples, number.format(expected.sampledPixels), words.low, number.format(expected.lowClippedPixels), words.high, number.format(expected.highClippedPixels)]);
}
async function downloadedBytes(download, maximumBytes) {
	const path = await download.path(); expect(typeof path).toBe('string'); const bytes = await readFile(path);
	expect(bytes.byteLength).toBeGreaterThan(0); expect(bytes.byteLength).toBeLessThanOrEqual(maximumBytes); return bytes;
}
async function paint(page) { await page.evaluate(() => new Promise(resolve => { requestAnimationFrame(() => resolve()); })); }
function parameter(dialog, words, key) {
	const adjustment = key === 'videoEffectDehazeAmount' ? words.shared.videoEffectDehaze : words.shared.videoEffectDetailSharpen;
	return named(named(dialog, 'group', adjustment), 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared[key]}`);
}
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
