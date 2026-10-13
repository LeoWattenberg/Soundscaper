/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoPngExportCopy } from '../../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import { photoPngExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-png-export-menu-copy.ts';
import { pngChunk } from '../helpers/image-metadata-fixtures.ts';
import { expect, test, compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { repairSettingsUiFixtureV1, active, named, keyboard, check, uncheck } from './helpers/lightscaper-repair-settings-ui-fixture.js';
import { repairOriginalReferencePixelsV1, repairOutputReferencePixelsV1 } from './helpers/lightscaper-repair-spots-reference.ts';

const PROGRAM = '/__repair_import_current_native.js', FULL_PIXELS = [255, 255, 255, 255, 137, 137, 137, 255];
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${'0.25 0.25 0.25\n'.repeat(8)}`), ORIGINAL = originalPng();
const ORIGINAL_SHA = createHash('sha256').update(ORIGINAL).digest('hex');

for (const locale of ['en', 'de']) for (const scope of ['full', 'repair-only']) {
	test(`${locale}: File Import applies a native ${scope} repair preset with real pixels, per-file ACKs and unchanged Original custody`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Native WebKit storage qualification remains deferred.');
		expect(test.info().config.workers).toBe(1); expect(test.info().retry).toBe(0); expect(test.info().project.retries).toBe(0); test.setTimeout(180000);
		const f = await repairSettingsUiFixtureV1(page, locale), copy = bundledLightscaperEditorCopyForLocale(locale);
		const program = await compileNativeImageHandoffScript('repair-import-current-native.js', fileURLToPath(new URL('./helpers/lightscaper-repair-import-current-reference.ts', import.meta.url)));
		expect(program.assets).toEqual([]); await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
		await f.openDevelop(); await f.repair('heal'); await f.geometry(); await f.brush(); await f.painted(FULL_PIXELS);
		await named(f.develop(), 'combobox', f.words.choose).selectOption('cube-lut-profile-v1'); await keyboard(page, named(f.develop(), 'button', f.words.add));
		await f.develop().getByLabel(f.words.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Import disabled.cube', mimeType: 'text/plain', buffer: CUBE });
		await f.painted([137, 137, 137, 255, 137, 137, 137, 255]);
		await uncheck(page, f.develop().locator('[data-photo-develop-effect="cube-lut-profile-v1"] input[type="checkbox"]')); await f.painted(FULL_PIXELS); await f.save();
		const presets = await f.settingsDialog('presets');
		await named(presets, 'textbox', f.settings.presetName).fill('Full repair import'); await keyboard(page, named(presets, 'button', f.settings.savePreset));
		await expect.poll(async () => (await custody(f.ids)).row.revision).toBe(1);
		for (const key of ['all', 'geometry', 'local']) await uncheck(page, named(presets, 'checkbox', f.settings[key]));
		const repairChoice = named(presets, 'checkbox', f.settings.repairs); if (!await repairChoice.isChecked()) await check(page, repairChoice);
		await named(presets, 'textbox', f.settings.presetName).fill('Repair only import'); await keyboard(page, named(presets, 'button', f.settings.savePreset));
		await expect.poll(async () => (await custody(f.ids)).row.revision).toBe(2);
		await keyboard(page, named(presets, 'button', f.settings.close).last()); await expect(presets).toHaveCount(0); await f.closeDevelop(); await showLibrary();
		const before = await custody(f.ids), selectedName = scope === 'full' ? 'Full repair import' : 'Repair only import';
		const preset = before.row.presets.find(value => value.identity.name === selectedName); expect(preset).toBeTruthy(); expect(preset.schemaVersion).toBe(3);
		expect(before.bodies).toHaveLength(1); expect(before.luts).toHaveLength(1); expect(before.luts[0].bytes).toEqual([...CUBE]);
		await menu(copy.photoFileMenu); await keyboard(page, named(f.app, 'button', copy.photoImportPhotos)); const importer = named(page, 'dialog', copy.photoImportPhotos);
		await expect(importer).toBeVisible(); await expect(named(importer, 'combobox', f.settings.choosePreset)).toHaveCount(0);
		const names = ['Imported repair.png', 'Imported twin.png'];
		await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles([
			{ name: names[0], mimeType: 'image/png', buffer: ORIGINAL }, { name: 'Broken repair.png', mimeType: 'image/png', buffer: Buffer.from('Invalid PNG') },
			{ name: names[1], mimeType: 'image/png', buffer: ORIGINAL },
		]);
		const options = importer.locator('[data-photo-import-options] > summary'); await keyboard(page, options);
		const selector = named(importer, 'combobox', f.settings.choosePreset); await expect(selector).toBeEnabled(); await expect(selector).toHaveValue('');
		await selector.selectOption(preset.identity.id); await keyboard(page, options); await keyboard(page, options);
		await expect(selector).toBeEnabled(); await expect(selector).toHaveValue(preset.identity.id);
		await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
		const library = f.app.locator('[data-photo-library]'); await expect(library.locator('[data-photo-id]')).toHaveCount(4);
		await expect(library.locator('[data-photo-import-status="imported"]')).toHaveCount(2); await expect(library.locator('[data-photo-import-status="failed"]')).toHaveCount(1);
		const ids = [];
		for (const name of names) { const card = library.getByRole('button', { name: new RegExp(`^${name.replace('.', '\\.')}`, 'u') });
			const id = await card.getAttribute('data-photo-id'); expect(id).toBeTruthy(); ids.push(id); }
		const allIds = [...f.ids, ...ids], after = await custody(allIds);
		expect(after.root.revision).toBe(before.root.revision + 2); expect(after.root).toEqual({ ...before.root, revision: after.root.revision, photoCount: 4 });
		expect(after.namespace).toBe(before.namespace); expect(after.row).toEqual(before.row); expect(after.bodies).toEqual(before.bodies); expect(after.luts).toEqual(before.luts);
		// Two successful imports reuse the first physical Original. Its native
		// reference count must grow while every other retained fact stays exact.
		expect(after.photos.slice(0, 2)).toEqual(before.photos.map((retained, index) => {
			const record = JSON.parse(retained.original.recordJson);
			return { ...retained, original: { ...retained.original, recordJson: JSON.stringify({ ...record, catalogRootCount: record.catalogRootCount + (index === 0 ? 2 : 0) }) } };
		}));
		for (const [index, retained] of after.photos.slice(2).entries()) {
			const version = active(retained.photo); expect(retained.photo.schemaVersion).toBe(3); expect(version.workspace.schemaVersion).toBe(3);
			expect(version.workspace.entries).toHaveLength(2); expect(version.workspace.entries[0].develop.processVersion).toBe(1);
			expect(version.workspace.entries[1].develop).toEqual(version.develop); expect(version.workspace.entries[1].label).toBe(selectedName);
			expect(retained.photo.original.contentSha256).toBe(ORIGINAL_SHA); expect(retained.original.bytes).toEqual([...ORIGINAL]);
			expect(retained.photo.original.name).toBe(names[index]); expect(retained.photo.metadata.fileName).toBe(names[index]);
			if (scope === 'full') expect(version.develop).toEqual(preset.settings.develop);
			else { expect(version.develop.repairs).toEqual(preset.settings.develop.repairs); expect(version.develop.effects).toEqual([]);
				expect(version.develop.masks).toEqual([]); expect(version.develop.maskBindings).toEqual([]); }
		}
		await showImported(names[0]); const develop = named(page, 'dialog', `${f.words.title}: ${names[0]}`), expected = scope === 'full' ? FULL_PIXELS : repairOutputReferencePixelsV1('heal');
		const width = scope === 'full' ? 2 : 10, height = scope === 'full' ? 1 : 5;
		await painted(develop, width, height, expected); await keyboard(page, named(develop, 'button', f.words.close).last()); await expect(develop).toHaveCount(0);
		await png(width, height, expected); expect(await custody(allIds)).toEqual(after);
		await page.reload(); await expect(f.app).toBeVisible(); await showLibrary(); expect(await custody(allIds)).toEqual(after);
		await showImported(names[0]); await painted(develop, width, height, expected); await keyboard(page, named(develop, 'button', f.words.close).last()); await expect(develop).toHaveCount(0);
		expect(await custody(allIds)).toEqual(after); expect(f.errors).toEqual([]);

		function custody(photoIds) { return page.evaluate(async ({ pathname, photoIds }) => (await import(new URL(pathname, location.href).href))
			.readRepairImportCustodyNativeV1(photoIds, () => globalThis.__assertNativeOpfsWorkerExecution()), { pathname: PROGRAM, photoIds }); }
		async function menu(label) { const summary = f.app.getByRole('navigation').getByText(label, { exact: true });
			if (!await summary.locator('..').evaluate(details => details.open)) await summary.click(); await expect(summary.locator('..')).toHaveAttribute('open', ''); }
		async function showLibrary() { const library = f.app.locator('[data-photo-library]');
			if (!await library.isVisible()) { await menu(copy.photoViewMenu); await keyboard(page, named(f.app, 'button', copy.photoShowLibrary)); } await expect(library).toBeVisible(); }
		async function showImported(name) {
			await showLibrary();
			await keyboard(page, f.app.locator('[data-photo-library]').getByRole('button', { name: new RegExp(`^${name.replace('.', '\\.')}`, 'u') }));
			await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(page, named(f.app, 'button', photoDevelopMenuLabel(locale)));
			await expect(named(page, 'dialog', `${f.words.title}: ${name}`)).toBeVisible();
		}
		async function painted(dialog, width, height, pixels) {
			await expect(dialog.locator('[data-photo-develop-preview]')).toHaveAttribute('data-state', 'ready');
			await expect.poll(() => named(dialog, 'img', f.words.after).evaluate(canvas => [canvas.width, canvas.height,
				...canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data])).toEqual([width, height, ...pixels]);
		}
		async function png(width, height, pixels) {
			const words = photoPngExportCopy(locale); await menu(copy.photoFileMenu); await keyboard(page, named(f.app, 'button', photoPngExportMenuLabel(locale)));
			const dialog = named(page, 'dialog', words.title); await expect(named(dialog, 'button', words.save)).toBeEnabled();
			const pending = page.waitForEvent('download'); await keyboard(page, named(dialog, 'button', words.save)); const bytes = await readFile(await (await pending).path()), chunks = [];
			expect(bytes.readUInt32BE(16)).toBe(width); expect(bytes.readUInt32BE(20)).toBe(height);
			for (let offset = 8; offset < bytes.length;) { const length = bytes.readUInt32BE(offset), end = offset + length + 12; expect(end).toBeLessThanOrEqual(bytes.length);
				if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, end - 4)); offset = end; }
			const raw = Array.from({ length: height }, (_, y) => [0, ...pixels.slice(y * width * 4, (y + 1) * width * 4)]).flat();
			expect([...inflateSync(Buffer.concat(chunks))]).toEqual(raw); await expect(dialog.getByRole('status').filter({ hasText: '×' })).toBeVisible();
			await keyboard(page, named(dialog, 'button', words.close).last()); await expect(dialog).toHaveCount(0);
		}
	});
}
function originalPng() {
	const pixels = repairOriginalReferencePixelsV1();
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', Buffer.from([0, 0, 0, 10, 0, 0, 0, 5, 8, 6, 0, 0, 0])),
		pngChunk('sRGB', Buffer.from([0])), pngChunk('IDAT', deflateSync(Buffer.from(Array.from({ length: 5 }, (_, y) => [0, ...pixels.slice(y * 40, (y + 1) * 40)]).flat()))), pngChunk('IEND', Buffer.alloc(0))]);
}
