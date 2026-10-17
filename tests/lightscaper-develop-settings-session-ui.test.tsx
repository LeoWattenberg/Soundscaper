/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import PhotoDevelopWorkspace from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspace.tsx';
import { usePhotoDevelopSettings } from '../src/common/editor/ui/lightscaper/use-photo-develop-settings.ts';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopSettingsCopy } from '../src/common/i18n/lightscaper-develop-settings-copy.ts';
import type { ExecutePhotoDevelopV1 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-v1.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { developBatchFixture } from './helpers/lightscaper-develop-batch-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';
import { settle, waitFor } from './helpers/async-test-control.ts';

for (const locale of ['en', 'de']) test(`${locale} mounted menus synchronize actual Session versions, Auto-sync each source ACK, quick-develop, and persist full/partial presets`, async () => {
	const f = await developBatchFixture(), messages = photoDevelopCopy(locale), text = photoDevelopSettingsCopy(locale);
	f.ports.settings = new KeyValueRepository({ memory: getMemoryDatabase(`settings-ui-${crypto.randomUUID()}`), database: async () => null }, 'settings');
	const session = new PhotoLibrarySessionV1(f.ports), photoId = f.photos[0]!.id;
	const execute: ExecutePhotoDevelopV1 = async (run, signal) => { await run({ signal: signal!, acquire: async () => session.develop, isCurrent: () => true, refresh: async () => undefined }); };
	let settings!: ReturnType<typeof usePhotoDevelopSettings>;
	function View() {
		settings = usePhotoDevelopSettings({ generation: session, execute });
		return <PhotoDevelopWorkspace locale={locale} photoId={photoId} catalogId="catalog" selectedIds={f.photos.map(photo => photo.id)} settings={settings}
			label="Source" generation={session} execute={execute} readPreview={async () => ({ outcome: 'missing' })} beforePresent={Promise.resolve()}
			registerRetirement={() => () => undefined} loadProxy={async () => { throw new Error('No pixel body in this storage witness'); }} onClose={() => undefined} />;
	}
	const mounted = await mountPhotoImportUi(() => <StrictMode><View /></StrictMode>);
	const button = (name: string) => { const found = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === name); assert.ok(found, name); return found; };
	const click = async (target: ReactTestElement) => {
		await act(async () => { reactProps(target).onClick?.({ currentTarget: target }); await settle(3); });
		await waitFor(async () => { await act(async () => { await settle(); }); return !settings.snapshot.busy
			&& mounted.dom.container.querySelectorAll('button').filter(value => value.textContent === messages.cancel).every(value => value.hasAttribute('disabled')); }, 'both borrowed Develop demands to settle');
	};
	const named = (tag: 'input' | 'select', label: string) => { const found = mounted.dom.container.querySelectorAll(tag).find(value => value.getAttribute('aria-label') === label); assert.ok(found, label); return found; };
	const change = async (target: ReactTestElement, value: string) => { await act(async () => { reactProps(target).onChange?.({ currentTarget: { value, valueAsNumber: Number(value) } }); await settle(3); }); };
	const temperature = () => named('input', `${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectParamTemperature}`);
	const read = (id = photoId) => session.develop.read({ schemaVersion: 1, photoId: id });
	try {
		assert.equal(Reflect.get(await read(), 'catalogId'), 'catalog', 'Settings commands bind the canonical Session catalog, independently of display names.');
		await act(async () => { await settle(3); }); await click(button(messages.add)); await change(temperature(), '0.2'); await click(button(messages.save));
		await click(button(text.copy)); await click(button(text.confirmCopy)); assert.ok(settings.snapshot.clipboard);
		await click(button(text.sync)); await click(button(text.confirmSync));
		assert.ok(button(text.confirmSync), 'The opted-in Sync dialog remains owned across the acknowledged page refresh.');
		for (const photo of f.photos) assert.equal((await read(photo.id)).develop.effects[0]?.params.temperature, 0.2);
		await click(button(text.close)); await click(button(text.auto)); await click(button(text.confirmAuto));
		assert.equal(settings.snapshot.autoSync, true); await change(temperature(), '0.4'); await click(button(messages.save));
		for (const photo of f.photos) { const actual = await read(photo.id); assert.equal(actual.revision, 2); assert.equal(actual.develop.effects[0]?.params.temperature, 0.4); }
		await click(button(text.stopAuto)); await click(button(text.quick)); await change(named('input', text.delta), '0.5'); await click(button(text.applyQuick));
		for (const photo of f.photos) assert.equal((await read(photo.id)).develop.effects.find(effect => effect.type === 'tone-ladder-v1')?.params.exposure, 0.5);
		await click(button(text.close)); await click(button(text.paste));
		assert.equal((await read()).develop.effects.find(effect => effect.type === 'tone-ladder-v1'), undefined, 'Full Paste restores the copied settings group.');
		await click(button(text.quick)); await change(named('input', text.delta), '0.5'); await click(button(text.applyQuick));
		await click(button(text.close)); await click(button(text.presets)); await change(named('input', text.presetName), 'Full'); await click(button(text.savePreset));
		const full = settings.snapshot.presets!.presets[0]!; assert.equal(full.scope, 'full');
		const checkbox = (label: string) => { const found = mounted.dom.container.querySelectorAll('input').find(value => value.parentNode?.textContent === label); assert.ok(found, label); return found; };
		await act(async () => { reactProps(checkbox(text.all)).onChange?.({ currentTarget: { checked: false } }); });
		await act(async () => { reactProps(checkbox(messages.shared.videoEffectWhiteBalance!)).onChange?.({ currentTarget: { checked: true } });
			reactProps(checkbox(text.geometry)).onChange?.({ currentTarget: { checked: false } }); });
		await act(async () => { reactProps(checkbox(text.local)).onChange?.({ currentTarget: { checked: false } }); });
		await change(named('input', text.presetName), 'WB'); await click(button(text.savePreset));
		const partial = settings.snapshot.presets!.presets.find(preset => preset.name === 'WB')!; assert.equal(partial.scope, 'partial');
		await change(named('select', text.choosePreset), partial.id); await change(named('input', text.presetName), 'WB renamed'); await click(button(text.renamePreset));
		await click(button(text.applyPreset)); const loaded = await read(); assert.equal(loaded.develop.effects.find(effect => effect.type === 'tone-ladder-v1')?.params.exposure, 0.5);
		await click(button(text.deletePreset)); assert.deepEqual(settings.snapshot.presets!.presets.map(preset => preset.name), ['Full']);
		const body = await session.develop.presets!.read({ schemaVersion: 1, catalogId: 'catalog', presetId: full.id, expectedRevision: 4 });
		assert.equal(body.preset.settings.develop.effects.length, 2);
		for (const original of f.photos) { const after = (await f.repository.loadPhoto('catalog', original.id))!;
			assert.deepEqual(after.original, original.original); assert.deepEqual(after.extractedMetadata, original.extractedMetadata); assert.deepEqual(after.metadata, original.metadata); }
	} finally { await mounted.dispose(); await session.close(); await f.close(); }
});
