/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { expect, test } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { repairSettingsUiFixtureV1 as fixture, active, named, keyboard, uncheck } from './helpers/lightscaper-repair-settings-ui-fixture.js';

// Independent two-cell repair, crop/flip, and linear-light exposure goldens.
const CLONE = [90, 90, 90, 255, 90, 90, 90, 255], HEAL = [255, 255, 255, 255, 188, 188, 188, 255];
const BRUSH = [255, 255, 255, 255, 137, 137, 137, 255], QUICK = [125, 125, 125, 255, 125, 125, 125, 255];

for (const locale of ['en', 'de']) for (const brush of [false, true]) test(`${locale}: Current Copy preserves an unsaved ${brush ? 'brush and Heal' : 'Heal'} draft across Close and pastes into another Original`, async ({ page, browserName }) => {
	shape(browserName); test.setTimeout(150000);
	const f = await fixture(page, locale); await f.openDevelop(); await f.repair('clone'); await f.geometry(); await f.painted(CLONE); await f.save();
	await f.painted(CLONE); const saved = await f.observe(); await f.repair('heal'); if (brush) await f.brush(); await f.painted(brush ? BRUSH : HEAL);
	await expect(named(f.develop(), 'button', f.words.save)).toBeEnabled();
	let dialog = await f.settingsDialog('copy'); await expect(named(dialog, 'checkbox', f.settings.repairs)).toBeChecked();
	await keyboard(page, named(dialog, 'button', f.settings.confirmCopy)); await expect(dialog).toHaveCount(0);
	await expect(f.develop().getByText(f.settings.copied, { exact: true })).toBeVisible(); await f.closeDevelop();
	await f.select(1); await f.openDevelop(); await f.settingsMenu(); await keyboard(page, named(f.develop(), 'button', f.settings.paste));
	await expect(f.develop().getByRole('status').filter({ hasText: f.settings.finished })).toBeVisible(); await f.painted(brush ? BRUSH : HEAL);
	await expect(named(f.develop(), 'button', f.words.save)).toBeDisabled(); await f.closeDevelop();
	const pasted = await f.observe(), target = active(pasted.photos[1].photo);
	expect(pasted.photos[0].photo).toEqual(saved.photos[0].photo); expect(pasted.photos[1].photo.schemaVersion).toBe(3);
	expect(target.develop.processVersion).toBe(3); expect(target.develop.repairs.spots[0].mode).toBe('heal'); await f.immutable(pasted);
	if (brush) {
		expect(target.develop.masks).toHaveLength(1); expect(target.develop.maskBindings).toHaveLength(1); expect(pasted.bodies).toHaveLength(1);
		const body = pasted.bodies[0]; expect([body.reference.width, body.reference.height]).toEqual([2, 1]);
		expect(body.bytes.slice(0, 8)).toEqual([83, 67, 77, 65, 83, 75, 48, 49]); expect(body.bytes.slice(-2)).toEqual([255, 0]);
		expect(createHash('sha256').update(Buffer.from(body.bytes)).digest('hex')).toBe(body.reference.sha256);
		expect(target.develop.masks[0].inputs[0].sourceRef).toBe(body.reference.storageKey);
	} else { expect(target.develop.masks).toEqual([]); expect(pasted.bodies).toEqual([]); }
	await f.png(brush ? BRUSH : HEAL); expect(await f.observe()).toEqual(pasted);
	await page.reload(); await expect(f.app).toBeVisible(); await f.showLibrary(); await f.select(1); await f.openDevelop();
	await f.painted(brush ? BRUSH : HEAL); await f.closeDevelop(); expect(await f.observe()).toEqual(pasted); expect(f.errors).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: Current Sync and acknowledged Auto-sync preserve repairs through partial selection and relative Quick Develop`, async ({ page, browserName }) => {
	shape(browserName); test.setTimeout(150000);
	const f = await fixture(page, locale); await f.selectAll(); await f.openDevelop(); await f.repair('heal'); await f.geometry(); await f.save(); await f.painted(HEAL);
	let dialog = await f.settingsDialog('sync'); await keyboard(page, named(dialog, 'button', f.settings.confirmSync));
	await expect.poll(async () => active((await f.photos()).photos[1].photo).develop.processVersion).toBe(3);
	await keyboard(page, named(dialog, 'button', f.settings.close).last());
	await expect(f.develop().getByText(f.settings.finished, { exact: true })).toBeVisible();
	await f.painted(HEAL); let copied = await f.observe(); expect(active(copied.photos[1].photo).develop.repairs).toEqual(active(copied.photos[0].photo).develop.repairs);
	dialog = await f.settingsDialog('auto');
	for (const label of [f.settings.all, f.settings.geometry, f.settings.local]) await uncheck(page, named(dialog, 'checkbox', label));
	await expect(named(dialog, 'checkbox', f.settings.repairs)).toBeChecked(); await keyboard(page, named(dialog, 'button', f.settings.confirmAuto)); await expect(dialog).toHaveCount(0);
	await expect(f.develop().getByText(new RegExp(f.settings.autoActive.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))).toBeVisible();
	await f.repair('clone'); await f.painted(CLONE); expect(await f.observe()).toEqual(copied);
	await f.save(); await expect.poll(async () => active((await f.photos()).photos[1].photo).develop.repairs.spots[0].mode).toBe('clone');
	await f.painted(CLONE); copied = await f.observe(); const repairs = copied.photos.map(row => active(row.photo).develop.repairs);
	dialog = await f.settingsDialog('quick'); await named(dialog, 'spinbutton', f.settings.delta).fill('1');
	await keyboard(page, named(dialog, 'button', f.settings.applyQuick));
	await expect.poll(async () => (await f.photos()).photos.map(row => active(row.photo).develop.effects.find(effect => effect.type === 'tone-ladder-v1').params.exposure)).toEqual([2, 2]);
	await keyboard(page, named(dialog, 'button', f.settings.close).last()); await f.painted(QUICK); await f.closeDevelop();
	const quick = await f.observe(); expect(quick.photos.map(row => active(row.photo).develop.repairs)).toEqual(repairs); await f.immutable(quick);
	for (const row of quick.photos) expect(active(row.photo).develop.effects.find(effect => effect.type === 'tone-ladder-v1').params.exposure).toBe(2);
	await f.select(1); await f.png(QUICK); expect(await f.observe()).toEqual(quick);
	await page.reload(); await expect(f.app).toBeVisible(); await f.showLibrary(); await f.select(1); await f.openDevelop(); await f.painted(QUICK);
	await f.settingsMenu(); await expect(named(f.develop(), 'button', f.settings.stopAuto)).toHaveCount(0); await f.closeDevelop();
	expect(await f.observe()).toEqual(quick); expect(f.errors).toEqual([]);
});

function shape(browserName) { test.skip(browserName === 'webkit', 'Native WebKit storage qualification remains deferred.');
	expect(test.info().config.workers).toBe(1); expect(test.info().retry).toBe(0); expect(test.info().project.retries).toBe(0); }
