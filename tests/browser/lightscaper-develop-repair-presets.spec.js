/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, test, compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { repairSettingsUiFixtureV1, active, named, keyboard, uncheck } from './helpers/lightscaper-repair-settings-ui-fixture.js';
import { repairOriginalReferencePixelsV1 } from './helpers/lightscaper-repair-spots-reference.ts';

const PROGRAM = '/__repair_presets_custody.js';
const CLONE = [90, 90, 90, 255, 90, 90, 90, 255], HEAL = [255, 255, 255, 255, 188, 188, 188, 255];
const BRUSH = [255, 255, 255, 255, 137, 137, 137, 255], CLONE_BRUSH = [90, 90, 90, 255, 64, 64, 64, 255];
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '0.25 0.25 0.25\n').join('')}`);
const LUT_SHA = createHash('sha256').update(CUBE).digest('hex');

for (const locale of ['en', 'de']) for (const brush of [false, true]) test(`${locale}: native preset saves an unsaved Heal${brush ? ', brush and disabled LUT' : ''}, survives reopen and rename, then applies and deletes without changing Originals`, async ({ page, browserName }) => {
	shape(browserName); test.setTimeout(150000);
	const f = await fixture(page, locale), expected = brush ? BRUSH : HEAL;
	await f.openDevelop(); await f.repair('clone'); await f.geometry(); await f.painted(CLONE); await f.save(); await f.painted(CLONE);
	const original = await f.observe(); await f.repair('heal'); if (brush) { await f.brush(); await disabledLut(page, f); } await f.painted(expected);
	let dialog = await f.settingsDialog('presets'); await named(dialog, 'textbox', f.settings.presetName).fill('Dirty repair');
	await keyboard(page, named(dialog, 'button', f.settings.savePreset)); await f.rowRevision(1);
	await expect(named(dialog, 'combobox', f.settings.choosePreset)).toContainText(`Dirty repair (${f.settings.full})`);
	await f.closeSettings(dialog); await f.painted(expected); const saved = await f.custody();
	expect(saved.photos).toEqual(original.photos); expect(saved.row.schemaVersion).toBe(3); expect(saved.row.presets).toHaveLength(1);
	const preset = saved.row.presets[0]; expect(preset.schemaVersion).toBe(3); expect(preset.settings.develop.processVersion).toBe(3);
	expect(preset.settings.develop.repairs.spots[0].mode).toBe('heal'); expect(preset.settings.selection.repairs).toBe(true);
	expect(preset.identity.authoredStateSha256).toBe(createHash('sha256').update(JSON.stringify(preset.settings)).digest('hex'));
	if (brush) {
		expect(saved.bodies).toHaveLength(1); expect(saved.bodies[0].bytes.slice(-2)).toEqual([255, 0]);
		expect(createHash('sha256').update(Buffer.from(saved.bodies[0].bytes)).digest('hex')).toBe(saved.bodies[0].reference.sha256);
		expect(saved.luts).toHaveLength(1); expect(saved.luts[0].bytes).toEqual([...CUBE]); expect(saved.luts[0].reference.sha256).toBe(LUT_SHA);
		expect(preset.settings.develop.effects.find(effect => effect.type === 'cube-lut-profile-v1').enabled).toBe(false);
	} else { expect(saved.bodies).toEqual([]); expect(saved.luts).toEqual([]); }
	await f.closeDevelop(); await page.reload(); await expect(f.app).toBeVisible(); await f.showLibrary(); await f.select(1); await f.openDevelop();
	dialog = await f.settingsDialog('presets'); await named(dialog, 'combobox', f.settings.choosePreset).selectOption(preset.identity.id);
	await named(dialog, 'textbox', f.settings.presetName).fill('Renamed repair'); await keyboard(page, named(dialog, 'button', f.settings.renamePreset)); await f.rowRevision(2);
	const renamed = (await f.scalarRow()).presets[0]; expect(renamed.settings).toEqual(preset.settings);
	expect(renamed.identity).toEqual({ ...preset.identity, name: 'Renamed repair' });
	const race = await f.compete(preset.identity.id, 2, 'Concurrent repair'); expect(race.acknowledgments.sort()).toEqual([false, true]);
	expect(race.outcomes.filter(outcome => outcome.status === 'fulfilled')).toEqual([{ status: 'fulfilled', revision: 3 }]);
	expect(race.outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1); await f.rowRevision(3);
	await keyboard(page, named(dialog, 'button', f.settings.reloadPresets));
	await expect(named(dialog, 'combobox', f.settings.choosePreset)).toContainText(`Concurrent repair (${f.settings.full})`);
	const targetRevision = original.photos[1].photo.revision;
	await keyboard(page, named(dialog, 'button', f.settings.applyPreset));
	await expect.poll(async () => (await f.photos()).photos[1].photo.revision).toBe(targetRevision + 1);
	await f.closeSettings(dialog); await f.painted(expected); await f.closeDevelop();
	let applied = await f.custody(); expect(applied.photos[0]).toEqual(original.photos[0]);
	expect(active(applied.photos[1].photo).develop).toEqual(preset.settings.develop); await f.immutable(applied);
	await f.png(expected); expect(await f.custody()).toEqual(applied);
	await f.openDevelop(); await f.painted(expected); await named(f.develop(), 'combobox', f.words.history).selectOption('0');
	const originalPixels = repairOriginalReferencePixelsV1(); originalPixels.fill(10, 0, 3);
	await expect(f.develop().locator('[data-photo-develop-preview]')).toHaveAttribute('data-state', 'ready');
	await expect.poll(() => named(f.develop(), 'img', f.words.after).evaluate(canvas => [canvas.width, canvas.height,
		...(canvas.width && canvas.height ? canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data : [])])).toEqual([10, 5, ...originalPixels]);
	await f.closeDevelop(); const restored = await f.custody(); expect(restored.photos[1].photo.schemaVersion).toBe(3);
	expect(active(restored.photos[1].photo).develop.processVersion).toBe(1); expect(restored.bodies).toEqual(applied.bodies); expect(restored.luts).toEqual(applied.luts);
	await f.openDevelop(); await named(f.develop(), 'combobox', f.words.history).selectOption('1'); await f.painted(expected); await f.closeDevelop();
	applied = await f.custody(); expect(active(applied.photos[1].photo).develop).toEqual(preset.settings.develop); await f.immutable(applied);
	await f.openDevelop(); await f.painted(expected); dialog = await f.settingsDialog('presets');
	await named(dialog, 'combobox', f.settings.choosePreset).selectOption(preset.identity.id); await keyboard(page, named(dialog, 'button', f.settings.deletePreset)); await f.rowRevision(4);
	await expect(named(dialog, 'combobox', f.settings.choosePreset).getByRole('option')).toHaveText([f.settings.noPreset]);
	await f.closeSettings(dialog); await f.painted(expected); await f.closeDevelop(); const deleted = await f.custody();
	expect(deleted.row).toEqual({ schemaVersion: 3, kind: 'photo-develop-presets', catalogId: saved.row.catalogId, revision: 4, presets: [] });
	expect(deleted.photos).toEqual(applied.photos); expect(deleted.bodies).toEqual(applied.bodies); expect(deleted.luts).toEqual(applied.luts);
	await page.reload(); await expect(f.app).toBeVisible(); await f.showLibrary(); await f.select(1); await f.openDevelop(); await f.painted(expected);
	await f.closeDevelop(); expect(await f.custody()).toEqual(deleted); expect(f.errors).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: a native repair-only preset keeps Target geometry, local brush and Original while replacing its saved Clone with Heal`, async ({ page, browserName }) => {
	shape(browserName); test.setTimeout(150000);
	const f = await fixture(page, locale); await f.select(1); await f.openDevelop(); await f.repair('clone'); await f.geometry(); await f.brush();
	await f.painted(CLONE_BRUSH); await f.save(); await f.painted(CLONE_BRUSH); await f.closeDevelop(); const before = await f.observe();
	await f.select(0); await f.openDevelop(); await f.repair('heal'); await f.geometry(); await f.painted(HEAL);
	let dialog = await f.settingsDialog('presets');
	for (const label of [f.settings.all, f.settings.geometry, f.settings.local]) await uncheck(page, named(dialog, 'checkbox', label));
	await expect(named(dialog, 'checkbox', f.settings.repairs)).toBeChecked(); await named(dialog, 'textbox', f.settings.presetName).fill('Repair only');
	await keyboard(page, named(dialog, 'button', f.settings.savePreset)); await f.rowRevision(1); await f.closeSettings(dialog); await f.painted(HEAL);
	const saved = await f.custody(), preset = saved.row.presets[0]; expect(saved.photos).toEqual(before.photos);
	expect(preset.settings.selection).toEqual({ effectTypes: [], geometry: false, localAdjustments: false, repairs: true });
	expect(preset.settings.develop.effects).toEqual([]); expect(preset.settings.develop.masks).toEqual([]);
	await f.closeDevelop(); await f.select(1); await f.openDevelop(); await f.painted(CLONE_BRUSH);
	dialog = await f.settingsDialog('presets'); await named(dialog, 'combobox', f.settings.choosePreset).selectOption(preset.identity.id);
	await keyboard(page, named(dialog, 'button', f.settings.applyPreset));
	await expect.poll(async () => (await f.photos()).photos[1].photo.revision).toBe(before.photos[1].photo.revision + 1);
	await f.closeSettings(dialog); await f.painted(BRUSH); await f.closeDevelop();
	const after = await f.custody(), target = active(after.photos[1].photo).develop, previous = active(before.photos[1].photo).develop;
	expect(target.repairs).toEqual(preset.settings.develop.repairs); expect(target.effects).toEqual(previous.effects);
	expect(target.geometry).toEqual(previous.geometry); expect(target.masks).toEqual(previous.masks); expect(target.maskBindings).toEqual(previous.maskBindings);
	expect(after.photos[0]).toEqual(before.photos[0]); expect(after.bodies).toEqual(saved.bodies); await f.immutable(after);
	await f.png(BRUSH); expect(await f.custody()).toEqual(after); expect(f.errors).toEqual([]);
});

async function fixture(page, locale) {
	const f = await repairSettingsUiFixtureV1(page, locale);
	const program = await compileNativeImageHandoffScript('repair-presets-custody.js', fileURLToPath(new URL('./helpers/lightscaper-repair-presets-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]); await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	const read = method => page.evaluate(async ({ pathname, method, ids }) => {
		const owner = await import(new URL(pathname, location.href).href);
		return method === 'readRepairPresetRowNativeV1' ? owner[method]() : owner[method](ids, () => globalThis.__assertNativeOpfsWorkerExecution());
	}, { pathname: PROGRAM, method, ids: f.ids });
	return { ...f, scalarRow: () => read('readRepairPresetRowNativeV1'), custody: () => read('readRepairPresetsCustodyNativeV1'),
		compete: (presetId, expectedRevision, name) => page.evaluate(async ({ pathname, presetId, expectedRevision, name }) =>
			(await import(new URL(pathname, location.href).href)).competeRepairPresetRenameNativeV1(presetId, expectedRevision, name), { pathname: PROGRAM, presetId, expectedRevision, name }),
		rowRevision: revision => expect.poll(async () => (await read('readRepairPresetRowNativeV1'))?.revision).toBe(revision),
		closeSettings: async dialog => { await keyboard(page, named(dialog, 'button', f.settings.close).last()); await expect(dialog).toHaveCount(0); } };
}
async function disabledLut(page, f) {
	await named(f.develop(), 'combobox', f.words.choose).selectOption('cube-lut-profile-v1'); await keyboard(page, named(f.develop(), 'button', f.words.add));
	await f.develop().getByLabel(f.words.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Retained preset.cube', mimeType: 'text/plain', buffer: CUBE });
	await f.painted([137, 137, 137, 255, 137, 137, 137, 255]);
	await uncheck(page, f.develop().locator('[data-photo-develop-effect="cube-lut-profile-v1"] input[type="checkbox"]'));
}
function shape(browserName) { test.skip(browserName === 'webkit', 'Native WebKit storage qualification remains deferred.');
	expect(test.info().config.workers).toBe(1); expect(test.info().retry).toBe(0); expect(test.info().project.retries).toBe(0); }
