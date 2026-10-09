/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopSettingsMenuV2 from '../src/common/editor/ui/lightscaper/PhotoDevelopSettingsMenuV2.tsx';
import { PhotoLibraryDevelopSettingsWorkflowV2 } from '../src/common/editor/controller/shared/photo-library-develop-settings-workflow-v2.ts';
import { photoDevelopSettingsCopy } from '../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { currentDevelopFixture, currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { settle } from './helpers/async-test-control.ts';
import { photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { normalizePhotoDevelopPresetRowV2 } from '../src/lightscaper/storage/photo-develop-preset-row-v2.ts';

for (const locale of ['en', 'de']) test(`${locale}: current settings picker and preset menu retain selected LUT refs through actual current ports`, async () => {
	const fixture = await currentDevelopFixture(2), owner = new PhotoLibraryDevelopSettingsWorkflowV2({ execute: async (run, signal) => {
		await run({ signal: signal!, isCurrent: () => true, acquire: async () => fixture.develop, refresh: async () => undefined });
	} }), source = { schemaVersion: 2 as const, catalogId: 'catalog-1', photoId: fixture.photos[0]!.id, versionId: fixture.photos[0]!.activeVersionId,
		revision: fixture.photos[0]!.revision, develop: currentRecipe() }, messages = photoDevelopSettingsCopy(locale);
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopSettingsMenuV2 locale={locale} owner={owner} snapshot={owner.snapshot()} source={source}
		selectedIds={fixture.photos.map(photo => photo.id)} disabled={false} dirty={false} isCurrent={() => true} onChanged={async () => undefined} />);
	const click = async (name: string) => { const button = mounted.dom.container.querySelectorAll('button').find(element => element.textContent === name); assert.ok(button, name);
		await act(async () => { reactProps(button).onClick?.({}); await settle(); }); await mounted.render(); };
	try {
		await click(messages.copy); await click(messages.confirmCopy); assert.equal(owner.snapshot().clipboard?.schemaVersion, 2);
		assert.deepEqual(owner.snapshot().clipboard?.develop.effects[0]!.params.lut, currentRecipe().effects[0]!.params.lut);
		await click(messages.presets); const name = mounted.dom.container.querySelectorAll('input').find(element => element.getAttribute('aria-label') === messages.presetName); assert.ok(name);
		await act(async () => { reactProps(name).onChange?.({ currentTarget: { value: 'Resource preset' } }); }); await click(messages.savePreset);
		const menu = owner.snapshot().presets!; assert.equal(menu.presets.length, 1); assert.equal(menu.presets[0]!.scope, 'full');
		const body = await fixture.develop.presets!.read({ schemaVersion: 2, catalogId: source.catalogId, presetId: menu.presets[0]!.id, expectedRevision: menu.revision });
		assert.equal(body.preset.schemaVersion, 2); assert.deepEqual(body.preset.settings.develop.effects[0]!.params.lut, currentRecipe().effects[0]!.params.lut);
		const checkbox = (label: string) => { const input = mounted.dom.container.querySelectorAll('input').find(element => element.parentNode?.textContent === label); assert.ok(input, label); return input; };
		const check = async (label: string, checked: boolean) => { await act(async () => { reactProps(checkbox(label)).onChange?.({ currentTarget: { checked } }); }); };
		await check(messages.all, false); await check(messages.shared.videoEffectCubeLutProfile!, true); await check(messages.geometry, false); await check(messages.local, false);
		await act(async () => { reactProps(name).onChange?.({ currentTarget: { value: 'Partial resource' } }); }); await click(messages.savePreset);
		const partialMenu = owner.snapshot().presets!, partial = partialMenu.presets.find(value => value.name === 'Partial resource'); assert.ok(partial); assert.equal(partial.scope, 'partial');
		const partialBody = await fixture.develop.presets!.read({ schemaVersion: 2, catalogId: source.catalogId, presetId: partial.id, expectedRevision: partialMenu.revision });
		assert.deepEqual(partialBody.preset.settings.selection, { effectTypes: ['cube-lut-profile-v1'], geometry: false, localAdjustments: false });
		assert.deepEqual(partialBody.preset.settings.develop.effects[0]!.params.lut, currentRecipe().effects[0]!.params.lut);
		for (const id of [menu.presets[0]!.id, partial.id]) {
			const selector = mounted.dom.container.querySelectorAll('select').find(value => value.getAttribute('aria-label') === messages.choosePreset); assert.ok(selector);
			await act(async () => { reactProps(selector).onChange?.({ currentTarget: { value: id } }); }); await click(messages.deletePreset);
		}
		const row = await fixture.settings.readEntry(photoDevelopPresetsKeyV1(source.catalogId)); assert.equal(row.present, true);
		if (row.present) assert.equal(normalizePhotoDevelopPresetRowV2(row.value, source.catalogId).presets.length, 0);
	} finally { await mounted.dispose(); await owner.close(); await fixture.close(); }
});

test('retained preset choices cannot silently adopt a replacement scalar menu revision', async () => {
	const fixture = await currentDevelopFixture(1), owner = new PhotoLibraryDevelopSettingsWorkflowV2({ execute: async (run, signal) => {
		await run({ signal: signal!, isCurrent: () => true, acquire: async () => fixture.develop, refresh: async () => undefined });
	} }), source = { schemaVersion: 2 as const, catalogId: 'catalog-1', photoId: fixture.photos[0]!.id, versionId: fixture.photos[0]!.activeVersionId,
		revision: fixture.photos[0]!.revision, develop: currentRecipe() }, messages = photoDevelopSettingsCopy('en');
	await owner.listPresets(source.catalogId); await owner.savePreset(source, { effectTypes: 'all', geometry: true, localAdjustments: true }, 'Full');
	const selected = owner.snapshot().presets!.presets[0]!;
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopSettingsMenuV2 locale="en" owner={owner} snapshot={owner.snapshot()} source={source}
		selectedIds={[source.photoId]} disabled={false} dirty={false} isCurrent={() => true} onChanged={async () => undefined} />);
	try {
		const opener = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === messages.presets); assert.ok(opener);
		await act(async () => { reactProps(opener).onClick?.({}); await settle(); }); await mounted.render();
		const selector = () => { const value = mounted.dom.container.querySelectorAll('select').find(value => value.getAttribute('aria-label') === messages.choosePreset); assert.ok(value); return value; };
		const oldChoose = reactProps(selector()).onChange!; await owner.listPresets(source.catalogId); await mounted.render();
		await act(async () => { oldChoose({ currentTarget: { value: selected.id } }); }); assert.equal(reactProps(selector()).value, '');
		await act(async () => { reactProps(selector()).onChange?.({ currentTarget: { value: selected.id } }); }); assert.equal(reactProps(selector()).value, selected.id);
	} finally { await mounted.dispose(); await owner.close(); await fixture.close(); }
});
