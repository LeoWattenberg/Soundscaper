/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { expect, test } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { repairSettingsUiFixtureV1, active, named, keyboard, uncheck } from './helpers/lightscaper-repair-settings-ui-fixture.js';

test.use({ browserCoverage: false });

const PROGRAM = '/__repair_batch_rename_current_native.js';
const PIXELS = [255, 255, 255, 255, 137, 137, 137, 255];
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${'0.25 0.25 0.25\n'.repeat(8)}`);

// Every edit uses the actual product menus. The bounded observer reads complete
// Current rows, authenticated Original/LUT/brush bodies and physical resource
// records in the selected native namespace; it creates no command or writer.
for (const locale of ['en', 'de']) test(`${locale}: Current repaired batch rename previews, applies and guards undo without changing native recipes or resource custody`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'Native WebKit storage qualification remains deferred.');
	expect(test.info().config.workers).toBe(1); expect(test.info().retry).toBe(0); expect(test.info().project.retries).toBe(0);
	test.setTimeout(180000);
	const f = await repairSettingsUiFixtureV1(page, locale), copy = bundledLightscaperEditorCopyForLocale(locale);
	await installObserver(page);
	await f.openDevelop(); await f.repair('heal'); await f.geometry(); await f.brush(); await f.painted(PIXELS);
	await named(f.develop(), 'combobox', f.words.choose).selectOption('cube-lut-profile-v1');
	await keyboard(page, named(f.develop(), 'button', f.words.add));
	await f.develop().getByLabel(f.words.shared.videoEffectCubeLutImport, { exact: true })
		.setInputFiles({ name: 'Rename retained disabled.cube', mimeType: 'text/plain', buffer: CUBE });
	await f.painted([137, 137, 137, 255, 137, 137, 137, 255]);
	await uncheck(page, f.develop().locator('[data-photo-develop-effect="cube-lut-profile-v1"] input[type="checkbox"]'));
	await f.painted(PIXELS); await f.save(); await f.closeDevelop();
	await showLibrary(); await f.selectAll();
	const order = await f.app.locator('[data-photo-library] [data-photo-id]').evaluateAll(rows => rows.map(row => row.getAttribute('data-photo-id')));
	expect(new Set(order)).toEqual(new Set(f.ids));
	const slots = new Map(order.map((id, index) => [id, index]));
	const before = await observe(), repaired = before.photos[0].photo, version = active(repaired);
	expect(repaired.schemaVersion).toBe(3); expect(version.workspace.schemaVersion).toBe(3);
	expect(version.workspace.entries.length).toBeGreaterThan(1); expect(version.develop.processVersion).toBe(3);
	expect(version.develop.repairs.spots.map(spot => spot.mode)).toEqual(['heal']);
	expect(version.develop.masks).toHaveLength(1); expect(version.develop.maskBindings).toHaveLength(1);
	expect(version.develop.effects.find(effect => effect.type === 'cube-lut-profile-v1').enabled).toBe(false);
	expect(before.bodies).toHaveLength(1); expect(before.bodies[0].bytes.slice(-2)).toEqual([255, 0]);
	expect(before.luts).toHaveLength(1); expect(before.luts[0].bytes).toEqual([...CUBE]);
	expect(before.resourceRecords).toHaveLength(2);
	for (const row of before.photos) {
		expect(createHash('sha256').update(Buffer.from(row.bytes)).digest('hex')).toBe(row.photo.original.contentSha256);
		expect(JSON.parse(row.original.recordJson).mediaContentToken).toEqual(expect.any(String));
	}

	const firstNames = before.photos.map(row => row.photo.metadata.fileName.replace(/\.([^.]+)$/u, `-撮影-${String(slots.get(row.photo.id) + 7).padStart(3, '0')}.$1`));
	await rename('{stem}-撮影-{sequence}.{extension}', 7, firstNames);
	const renamed = await observe(); expectPhotos(renamed, before, firstNames, [1, 1]);
	await photoAction(copy.photoBatchRenameUndo);
	await expect(f.app.locator('[data-batch-rename-status="restored"]')).toHaveCount(2);
	const restored = await observe(); expectPhotos(restored, before, before.photos.map(row => row.photo.metadata.fileName), [2, 2]);
	await expect(f.app.getByRole('button', { name: copy.photoBatchRenameUndo, exact: true, includeHidden: true })).toBeDisabled();

	// A real metadata edit after the second rename advances only the first
	// Photo revision. Undo must refuse that stale slot and restore the other.
	const secondNames = before.photos.map(row => `Guard-${String(slots.get(row.photo.id) + 1).padStart(3, '0')}.${row.photo.metadata.fileName.split('.').at(-1)}`);
	await rename('Guard-{sequence}.{extension}', 1, secondNames);
	const second = await observe(); expectPhotos(second, before, secondNames, [3, 3]);
	await keyboard(page, f.app.locator(`[data-photo-id="${f.ids[0]}"]`));
	await photoAction(copy.photoEditMetadata);
	const metadata = named(page, 'dialog', copy.photoEditMetadata), title = 'Authored after Current rename';
	await named(metadata, 'textbox', copy.photoMetadataTitle).fill(title);
	await keyboard(page, named(metadata, 'button', copy.photoSaveMetadata));
	await expect.poll(async () => (await f.photos()).photos[0].photo.revision).toBe(before.photos[0].photo.revision + 4);
	await expect(named(metadata, 'textbox', copy.photoMetadataTitle)).toHaveValue(title);
	await keyboard(page, named(metadata, 'button', copy.photoCloseMetadata).last()); await expect(metadata).toHaveCount(0);
	const intervening = await observe(); expectPhotos(intervening, before, secondNames, [4, 3], title);
	await photoAction(copy.photoBatchRenameUndo);
	await expect(f.app.locator('[data-batch-rename-status="failed"]')).toHaveCount(1);
	await expect(f.app.locator('[data-batch-rename-status="restored"]')).toHaveCount(1);
	await expect(f.app.locator('[data-batch-rename-results]')).toHaveAttribute('data-batch-rename-completion', 'finished');
	await expect(f.app.getByRole('button', { name: copy.photoBatchRenameUndo, exact: true, includeHidden: true })).toBeEnabled();
	const final = await observe(); expectPhotos(final, before, [secondNames[0], before.photos[1].photo.metadata.fileName], [4, 4], title);
	expect(final.photos[0]).toEqual(intervening.photos[0]);
	// The refused inverse remains available. Retrying visits that stale slot
	// alone, never writing the already restored second Photo again.
	await photoAction(copy.photoBatchRenameUndo);
	await expect(f.app.locator('[data-batch-rename-status="failed"]')).toHaveCount(1);
	await expect(f.app.locator('[data-batch-rename-status="restored"]')).toHaveCount(0);
	await expect(f.app.locator('[data-batch-rename-results]')).toHaveAttribute('data-batch-rename-completion', 'finished');
	expect(await observe()).toEqual(final);
	await page.reload(); await expect(f.app).toBeVisible(); await showLibrary();
	for (const row of final.photos) await expect(f.app.locator(`[data-photo-id="${row.photo.id}"]`)).toContainText(row.photo.metadata.fileName);
	expect(await observe()).toEqual(final); expect(f.errors).toEqual([]);

	function observe() { return page.evaluate(async ({ pathname, ids }) => (await import(new URL(pathname, location.href).href)).observe(ids), { pathname: PROGRAM, ids: f.ids }); }
	async function menu(label) {
		const summary = f.app.getByRole('navigation').getByText(label, { exact: true });
		if (!await summary.locator('..').evaluate(details => details.open)) await summary.click();
		await expect(summary.locator('..')).toHaveAttribute('open', '');
	}
	async function showLibrary() {
		const library = f.app.locator('[data-photo-library]');
		if (!await library.isVisible()) { await menu(copy.photoViewMenu); await keyboard(page, named(f.app, 'button', copy.photoShowLibrary)); }
		await expect(library).toBeVisible(); await expect(library).toHaveAttribute('aria-busy', 'false');
	}
	async function photoAction(action) { await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(page, named(f.app, 'button', action)); }
	async function rename(template, start, expected) {
		const captured = await observe(); await photoAction(copy.photoBatchRenameTitle);
		const dialog = named(page, 'dialog', copy.photoBatchRenameTitle), input = named(dialog, 'textbox', copy.photoImportNameTemplate);
		await expect(input).toBeFocused(); await expect(named(dialog, 'button', copy.photoBatchRenameAction)).toBeDisabled();
		await expect(dialog.locator('[data-batch-rename-plan-row]')).toHaveCount(0);
		await input.fill(template); await named(dialog, 'spinbutton', copy.photoImportSequenceStart).fill(String(start));
		await named(dialog, 'spinbutton', copy.photoImportSequencePadding).fill('3');
		await keyboard(page, named(dialog, 'button', copy.photoBatchRenamePreview));
		await expect(dialog.locator('[data-batch-rename-plan-row]')).toHaveCount(2);
		const names = new Map(before.photos.map((row, index) => [row.photo.id, expected[index]]));
		for (const [index, id] of order.entries()) await expect(dialog.locator('[data-batch-rename-plan-row]').nth(index)).toContainText(names.get(id));
		expect(await observe()).toEqual(captured);
		await keyboard(page, named(dialog, 'button', copy.photoBatchRenameAction));
		await expect(dialog.locator('[data-batch-rename-status="renamed"]')).toHaveCount(2);
		await expect(dialog.locator('[data-batch-rename-results]')).toHaveAttribute('data-batch-rename-completion', 'finished');
		await expect(named(dialog, 'button', copy.photoBatchRenamePreview)).toBeDisabled();
		await keyboard(page, named(dialog, 'button', copy.photoBatchRenameClose).last()); await expect(dialog).toHaveCount(0);
	}
});

function expectPhotos(actual, before, names, revisions, title) {
	expect(actual).toEqual({ ...before, photos: before.photos.map((row, index) => ({ ...row, photo: { ...row.photo,
		revision: row.photo.revision + revisions[index], metadata: { ...row.photo.metadata, fileName: names[index],
			...(index === 0 && title !== undefined ? { title } : {}) },
	} })) });
}

// The existing Photo observer reads only the selected Photo namespace. Its
// bounded native contract authenticates complete recipes, Original custody,
// LUT/brush bytes and physical resource rows without requiring any presets.
async function installObserver(page) {
	const contents = `
import { readRepairFramePhotoCustodyNativeV1 } from './tests/browser/helpers/lightscaper-repair-frame-current-reference.ts';
export async function observe(ids) {
	return readRepairFramePhotoCustodyNativeV1(ids, () => globalThis.__assertNativeOpfsWorkerExecution());
}
`;
	const program = await build({ stdin: { contents, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), sourcefile: 'repair-batch-rename-current-native.js' },
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	expect(program.outputFiles).toHaveLength(1);
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.outputFiles[0].text }));
}
