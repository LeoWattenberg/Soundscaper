/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useEffect, useState } from 'react';
import PhotoDevelopSettingsMenu from '../src/common/editor/ui/lightscaper/PhotoDevelopSettingsMenu.tsx';
import { photoDevelopSettingsCopy } from '../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { PhotoLibraryDevelopSettingsWorkflowV1 } from '../src/common/editor/controller/shared/photo-library-develop-settings-workflow-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { copyImageDevelopSettingsV1, mergeImageDevelopSettingsV1, adjustImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { createImageDevelopPresetV1, parseImageDevelopPresetV1, serializeImageDevelopPresetV1 } from '../src/common/editor/imaging/image-develop-preset-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';
import { deferred, settle } from './helpers/async-test-control.ts';
import type { PhotoLibraryDevelopPresetSnapshotV1 } from '../src/common/editor/photo-library-develop-presets-port-v1.ts';

for (const locale of ['en', 'de']) test(`${locale} settings are menu-owned; Copy picker, full/partial preset create/rename/delete and selected Quick develop use borrowed ports`, async () => {
	const messages = photoDevelopSettingsCopy(locale), requests: string[] = [];
	let preset = createImageDevelopPresetV1({ schemaVersion: 1, id: 'initial', name: 'Original', settings: copyImageDevelopSettingsV1({ schemaVersion: 1, develop: defaultImageDevelopStateV1(), selection: { effectTypes: 'all', geometry: true, localAdjustments: true } }) });
	let revision = 0;
	const menu = () => ({ schemaVersion: 1 as const, catalogId: 'catalog', revision, presets: [{ ...preset.identity, scope: 'full' as const }] });
	const owner = new PhotoLibraryDevelopSettingsWorkflowV1({ createId: () => 'created', execute: async (run, signal) => {
		await run({ signal: signal!, isCurrent: () => true, refresh: async () => undefined, acquire: async () => ({
			read: async request => ({ schemaVersion: 1, photoId: request.photoId, versionId: 'master', activeVersionId: 'master', revision: 1, develop: defaultImageDevelopStateV1(), versions: [], history: { cursor: 0, entries: [] }, snapshots: [] }),
			apply: async () => { throw new Error('No unrelated mutation'); },
			settings: { copy: value => { requests.push('copy'); return copyImageDevelopSettingsV1(value); }, merge: mergeImageDevelopSettingsV1, adjust: adjustImageDevelopSettingsV1,
				applyBatch: async value => { requests.push(value.action.kind); return { schemaVersion: 1, catalogId: value.catalogId, completion: 'finished', outcomes: value.targets.map((target, index) => ({ ...target, index, status: 'unchanged', revision: target.expectedRevision, historyCursor: 0, code: null })), notices: [] }; } },
			presets: { create: createImageDevelopPresetV1, parse: parseImageDevelopPresetV1, serialize: serializeImageDevelopPresetV1, list: async () => menu(),
				read: async () => ({ schemaVersion: 1, catalogId: 'catalog', revision, preset }), write: async value => {
					requests.push(value.command.type); if (value.command.type === 'save') preset = value.command.preset;
					revision++; return { snapshot: value.command.type === 'delete' ? { ...menu(), presets: [] } : menu(), notices: [] }; } },
		}) });
	} });
	const source = { catalogId: 'catalog', photoId: 'photo', versionId: 'master', revision: 1, develop: defaultImageDevelopStateV1() };
	function View() {
		const [snapshot, setSnapshot] = useState(owner.snapshot());
		useEffect(() => owner.subscribe(setSnapshot), []);
		return <PhotoDevelopSettingsMenu locale={locale} owner={owner} snapshot={snapshot} source={source}
			selectedIds={['photo', 'other']} disabled={false} dirty={false} isCurrent={() => true} onChanged={async () => undefined} />;
	}
	const mounted = await mountPhotoImportUi(() => <View />);
	const button = (name: string) => { const found = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === name); assert.ok(found, name); return found; };
	const click = async (target: ReactTestElement) => { await act(async () => { reactProps(target).onClick?.({ currentTarget: target }); await settle(); }); };
	const named = (tag: 'input' | 'select', name: string) => { const found = mounted.dom.container.querySelectorAll(tag).find(value => value.getAttribute('aria-label') === name); assert.ok(found, name); return found; };
	const change = async (target: ReactTestElement, value: string) => { await act(async () => { reactProps(target).onChange?.({ currentTarget: { value } }); await settle(); }); };
	try {
		assert.equal(requests.length, 0); assert.equal(mounted.dom.container.querySelectorAll('dialog').length, 0);
		await click(button(messages.copy)); await click(button(messages.confirmCopy)); assert.ok(owner.snapshot().clipboard);
		await click(button(messages.presets)); await settle(); await change(named('input', messages.presetName), 'Warm'); await click(button(messages.savePreset));
		assert.equal(preset.identity.name, 'Warm'); await change(named('select', messages.choosePreset), 'created');
		await change(named('input', messages.presetName), 'Cool'); await click(button(messages.renamePreset)); assert.equal(preset.identity.name, 'Cool');
		await click(button(messages.deletePreset)); assert.equal(owner.snapshot().presets?.presets.length, 0);
		await click(button(messages.close)); await click(button(messages.quick)); await change(named('input', messages.delta), '0.5'); await click(button(messages.applyQuick));
		assert.ok(requests.includes('relative'));
	} finally { await mounted.dispose(); await owner.close(); }
});

test('retained picker Close/Copy and pending Cancel cannot act on a replacement presentation or later demand', async () => {
	let acquired = 0, held = deferred<PhotoLibraryDevelopPresetSnapshotV1>(), activeSignal!: AbortSignal;
	const owner = new PhotoLibraryDevelopSettingsWorkflowV1({ execute: async (run, signal) => {
		await run({ signal: signal!, isCurrent: () => true, refresh: async () => undefined, acquire: async () => { acquired++; return {
			read: async () => { throw new Error('No photo read'); }, apply: async () => { throw new Error('No photo write'); },
			settings: { copy: copyImageDevelopSettingsV1, merge: mergeImageDevelopSettingsV1, adjust: adjustImageDevelopSettingsV1, applyBatch: async () => { throw new Error('No batch'); } },
			presets: { create: createImageDevelopPresetV1, parse: parseImageDevelopPresetV1, serialize: serializeImageDevelopPresetV1,
				list: (_request, options) => { activeSignal = options!.signal!; return held.promise; }, read: async () => { throw new Error('No body'); }, write: async () => { throw new Error('No write'); } },
		}; } });
	} });
	const messages = photoDevelopSettingsCopy('en');
	function View() { const [snapshot, setSnapshot] = useState(owner.snapshot()); useEffect(() => owner.subscribe(setSnapshot), []);
		return <PhotoDevelopSettingsMenu locale="en" owner={owner} snapshot={snapshot} source={{ catalogId: 'catalog', photoId: 'photo', versionId: 'master', revision: 0, develop: defaultImageDevelopStateV1() }}
			selectedIds={['photo']} disabled={false} dirty={false} isCurrent={() => true} onChanged={async () => undefined} />; }
	const mounted = await mountPhotoImportUi(() => <View />);
	const button = (name: string) => { const found = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === name); assert.ok(found, name); return found; };
	const click = async (name: string) => { await act(async () => { reactProps(button(name)).onClick?.({}); await settle(); }); };
	try {
		await click(messages.copy); const retiredCopy = reactProps(button(messages.confirmCopy)).onClick!, retiredClose = reactProps(button(messages.close)).onClick!;
		await click(messages.close); await act(async () => { retiredCopy({}); }); assert.equal(acquired, 0);
		await click(messages.copy); await act(async () => { retiredClose({}); }); assert.ok(button(messages.confirmCopy)); await click(messages.close);
		await click(messages.presets); const retiredCancel = reactProps(button(messages.cancel)).onClick!;
		held.resolve({ schemaVersion: 1, catalogId: 'catalog', revision: 0, presets: [] }); await act(async () => { await settle(); });
		held = deferred<PhotoLibraryDevelopPresetSnapshotV1>(); await click(messages.reloadPresets);
		await act(async () => { retiredCancel({}); }); assert.equal(activeSignal.aborted, false);
		held.resolve({ schemaVersion: 1, catalogId: 'catalog', revision: 0, presets: [] }); await act(async () => { await settle(); });
	} finally { await mounted.dispose(); await owner.close(); }
});
