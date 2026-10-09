/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoImportDevelopPresetsV2, { type PhotoImportDevelopPresetsPropsV2 } from '../src/common/editor/ui/lightscaper/PhotoImportDevelopPresetsV2.tsx';
import type { PhotoLibraryDevelopPresetReadV2, PhotoLibraryDevelopPresetSnapshotV2 } from '../src/common/editor/photo-library-develop-presets-port-v2.ts';
import { photoDevelopSettingsCopy } from '../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { deferred, settle } from './helpers/async-test-control.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

const menu: PhotoLibraryDevelopPresetSnapshotV2 = { schemaVersion: 2, catalogId: 'catalog', revision: 7, presets: [
	{ id: 'full', name: 'Full LUT look', scope: 'full', authoredStateSha256: 'a'.repeat(64) },
	{ id: 'partial', name: 'Partial LUT look', scope: 'partial', authoredStateSha256: 'b'.repeat(64) },
] };
const base: PhotoImportDevelopPresetsPropsV2 = { readPresets: async () => menu, value: null, busy: false,
	onChange: () => undefined, onPending: () => undefined, copy: photoDevelopSettingsCopy('en') };
const select = '[data-import-develop-choice]', reload = '[data-import-develop-reload]';

for (const locale of ['en', 'de']) test(`${locale}: current preset menu emits only frozen scalar schema2 choices with the selected revision`, async () => {
	let reads = 0; const choices: (PhotoLibraryDevelopPresetReadV2 | null)[] = [];
	const props = { ...base, copy: photoDevelopSettingsCopy(locale), readPresets: async () => { reads++; return menu; },
		onChange: (value: PhotoLibraryDevelopPresetReadV2 | null) => { choices.push(value); } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDevelopPresetsV2 {...props} />);
	try {
		assert.equal(reads, 1); assert.equal(choices.length, 0);
		await mounted.event(select, 'onChange', { currentTarget: { value: 'partial' } });
		assert.deepEqual(choices, [{ schemaVersion: 2, catalogId: 'catalog', presetId: 'partial', expectedRevision: 7 }]);
		assert.ok(Object.isFrozen(choices[0])); assert.deepEqual(Object.keys(choices[0]!), ['schemaVersion', 'catalogId', 'presetId', 'expectedRevision']);
		assert.match(mounted.dom.container.textContent, /Full LUT look/u); assert.equal(reads, 1);
	} finally { await mounted.dispose(); }
});

test('current menu reload retains a previous choice and retired local handlers cannot select its replacement inventory', async () => {
	let reads = 0; const choices: (PhotoLibraryDevelopPresetReadV2 | null)[] = [];
	const value: PhotoLibraryDevelopPresetReadV2 = { schemaVersion: 2, catalogId: 'catalog', presetId: 'full', expectedRevision: 7 };
	const props = { ...base, value, readPresets: async () => ({ ...menu, revision: ++reads === 1 ? 7 : 9 }),
		onChange: (next: PhotoLibraryDevelopPresetReadV2 | null) => { choices.push(next); } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDevelopPresetsV2 {...props} />);
	try {
		const oldChoose = reactProps(mounted.dom.one(select)).onChange;
		await mounted.event(reload, 'onClick'); assert.equal(reads, 2); assert.deepEqual(choices, []);
		await act(async () => { oldChoose?.({ currentTarget: { value: 'partial' } }); }); assert.deepEqual(choices, []);
		await mounted.event(select, 'onChange', { currentTarget: { value: 'partial' } });
		assert.deepEqual(choices, [{ schemaVersion: 2, catalogId: 'catalog', presetId: 'partial', expectedRevision: 9 }]);
		assert.equal(props.value, value);
	} finally { await mounted.dispose(); }
});

test('replacement joins its cancelled old list and pins read and pending callback receivers to the original props', async () => {
	const held = deferred<PhotoLibraryDevelopPresetSnapshotV2>(), pending: boolean[] = [], receivers: unknown[] = [];
	let oldSignal: AbortSignal | undefined, nextReads = 0;
	const oldRead: typeof base.readPresets = function(this: PhotoImportDevelopPresetsPropsV2, options) { receivers.push(this); oldSignal = options?.signal; return held.promise; };
	let readPresets = oldRead;
	const notify: typeof base.onPending = function(this: PhotoImportDevelopPresetsPropsV2, value) { receivers.push(this); pending.push(value); };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDevelopPresetsV2 {...base} readPresets={readPresets} onPending={notify} />);
	try {
		readPresets = async () => { nextReads++; return menu; }; await mounted.render();
		assert.equal(oldSignal?.aborted, true); assert.equal(nextReads, 0); assert.deepEqual(pending, [true]);
		await act(async () => { held.resolve(menu); await settle(); }); assert.equal(nextReads, 1);
		assert.deepEqual(pending, [true, false, true, false]);
		const oldReceiver = receivers.find(value => (value as Partial<PhotoImportDevelopPresetsPropsV2>).readPresets === oldRead);
		assert.ok(oldReceiver); assert.equal(receivers[0], oldReceiver); assert.equal(receivers[1], oldReceiver); assert.equal(receivers[2], oldReceiver);
	} finally { held.resolve(menu); await mounted.dispose(); }
});

test('legacy or body-bearing menus refuse without inspecting embedded body accessors', async () => {
	let bodyReads = 0;
	const row = { ...menu.presets[0] }; Object.defineProperty(row, 'settings', { enumerable: true, get() { bodyReads++; assert.fail('No body capability'); } });
	for (const raw of [{ ...menu, schemaVersion: 1 }, { ...menu, presets: [row] }, { ...menu, revision: -0 }]) {
		const mounted = await mountPhotoImportUi(() => <PhotoImportDevelopPresetsV2 {...base} readPresets={async () => raw as PhotoLibraryDevelopPresetSnapshotV2} />);
		try { assert.equal(reactProps(mounted.dom.one(select)).disabled, true); assert.equal(mounted.dom.container.querySelectorAll('option').length, 1); }
		finally { await mounted.dispose(); }
	}
	assert.equal(bodyReads, 0);
});
