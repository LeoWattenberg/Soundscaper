/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import PhotoImportDevelopPresetsCurrentV1 from '../src/common/editor/ui/lightscaper/PhotoImportDevelopPresetsCurrentV1.tsx';
import PhotoImportDialogCurrentV1 from '../src/common/editor/ui/lightscaper/PhotoImportDialogCurrentV1.tsx';
import PhotoImportDevelopPresetsV2, { type PhotoImportDevelopPresetsPropsV2 } from '../src/common/editor/ui/lightscaper/PhotoImportDevelopPresetsV2.tsx';
import type { PhotoLibraryDevelopPresetReadV3, PhotoLibraryDevelopPresetSnapshotV3 } from '../src/common/editor/photo-library-develop-presets-port-v3.ts';
import { photoDevelopSettingsCopy } from '../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { currentPreset, repairPresetsFixture } from './helpers/lightscaper-repair-presets-current-fixture.ts';
import { importDialogProps } from './helpers/photo-import-dialog-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';

const SELECT = '[data-import-develop-choice]', file = new File(['retained original'], 'native source.png');
async function joinedMenu(mounted: Awaited<ReturnType<typeof mountPhotoImportUi>>, name?: string) {
	await waitFor(async () => {
		await act(async () => { await settle(); });
		const descriptor = Object.getOwnPropertyDescriptor(reactProps(mounted.dom.one('[data-import-develop-presets]')), 'aria-busy');
		assert.ok(descriptor && Object.hasOwn(descriptor, 'value'));
		const busy: unknown = descriptor.value; assert.equal(typeof busy, 'boolean');
		return busy === false
			&& (name === undefined || mounted.dom.container.querySelectorAll('option').some(option => option.textContent.includes(name)));
	}, name === undefined ? 'the actual native Current import preset list joins' : 'the actual renamed Current preset snapshot joins');
}
async function nativeMenu() {
	const f = await repairPresetsFixture(), cap = f.session.develop.presetsCurrent; assert.ok(cap);
	try {
		const packet = await f.selectedPacket(), preset = currentPreset(packet);
		await cap.write({ schemaVersion: 3, catalogId: f.root.id, command: { type: 'save', expectedRevision: 0, preset } });
		const snapshot = await cap.list({ schemaVersion: 3, catalogId: f.root.id });
		assert.equal(snapshot.schemaVersion, 3); assert.equal(snapshot.presets.length, 1);
		assert.equal((await f.row() as { schemaVersion: number }).schemaVersion, 3);
		return { f, snapshot, read: async () => cap.list({ schemaVersion: 3, catalogId: f.root.id }) };
	} catch (error) { await f.close(); throw error; }
}

for (const locale of ['en', 'de']) test(`${locale}: Current Import selector admits the genuine retained Preset3 menu and emits only its frozen scalar identity`, async () => {
	const native = await nativeMenu(), choices: unknown[] = [];
	const props = { readPresets: native.read, value: null, busy: false, copy: photoDevelopSettingsCopy(locale, 'current3'),
		onPending: () => undefined, onChange: (value: unknown) => { choices.push(value); } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDevelopPresetsCurrentV1 {...props} />);
	try {
		await joinedMenu(mounted);
		assert.equal(reactProps(mounted.dom.one(SELECT)).disabled, false, 'The actual Snapshot3 must be admitted by the Current selector.');
		assert.deepEqual(choices, []); assert.equal(reactProps(mounted.dom.one(SELECT)).value, '');
		await mounted.event(SELECT, 'onChange', { currentTarget: { value: native.snapshot.presets[0]!.id } });
		assert.deepEqual(choices, [{ schemaVersion: 3, catalogId: native.snapshot.catalogId, presetId: native.snapshot.presets[0]!.id, expectedRevision: native.snapshot.revision }]);
		assert.ok(Object.isFrozen(choices[0])); assert.deepEqual(Object.keys(choices[0] as object), ['schemaVersion', 'catalogId', 'presetId', 'expectedRevision']);
	} finally { await mounted.dispose(); await native.f.close(); }
});

test('Current Import dialog reads no preset by default and detaches the opted-in real Snapshot3 choice with its native File', async () => {
	const native = await nativeMenu(); let reads = 0, calls = 0, captured: PhotoLibraryDevelopPresetReadV3 | undefined;
	const props = { ...importDialogProps(), readDevelopPresets: async () => { reads++; return native.read(); },
		onImport: async (files: readonly File[], options?: { developPreset?: PhotoLibraryDevelopPresetReadV3 }) => {
			calls++; assert.equal(files[0], file); captured = options?.developPreset; return { outcome: 'failed' as const };
		} };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDialogCurrentV1 {...props} />);
	try {
		assert.equal(reads, 0); assert.equal(mounted.dom.container.querySelector(SELECT), null);
		Reflect.set(mounted.dom.one('input'), 'files', [file]); await mounted.event('input', 'onChange');
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: true } });
		await joinedMenu(mounted);
		assert.equal(reads, 1); assert.equal(reactProps(mounted.dom.one(SELECT)).disabled, false);
		await mounted.event(SELECT, 'onChange', { currentTarget: { value: native.snapshot.presets[0]!.id } });
		await mounted.event('form', 'onSubmit', { preventDefault() {} }); assert.equal(calls, 1);
		assert.deepEqual(captured, { schemaVersion: 3, catalogId: native.snapshot.catalogId, presetId: native.snapshot.presets[0]!.id, expectedRevision: native.snapshot.revision });
		assert.ok(Object.isFrozen(captured)); assert.equal(file.name, 'native source.png');
	} finally { await mounted.dispose(); await native.f.close(); }
});

test('permanent V2 Import selector refuses an actual native Snapshot3 without borrowing recipe bodies', async () => {
	const native = await nativeMenu(), props = { readPresets: native.read, value: null, busy: false, copy: photoDevelopSettingsCopy('en'),
		onPending: () => undefined, onChange: () => assert.fail('The permanent V2 selector must remain strict.') };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDevelopPresetsV2 {...props as unknown as PhotoImportDevelopPresetsPropsV2} />);
	try { await joinedMenu(mounted); assert.equal(reactProps(mounted.dom.one(SELECT)).disabled, true); assert.equal(mounted.dom.container.querySelectorAll('option').length, 1);
		assert.equal(mounted.dom.container.querySelectorAll('[role="alert"]').length, 1); }
	finally { await mounted.dispose(); await native.f.close(); }
});

test('Current selector retains a previous native revision after reload and refuses the retired inventory handler', async () => {
	const native = await nativeMenu(), choices: unknown[] = [], previous: PhotoLibraryDevelopPresetReadV3 = { schemaVersion: 3,
		catalogId: native.snapshot.catalogId, presetId: native.snapshot.presets[0]!.id, expectedRevision: native.snapshot.revision };
	const props = { readPresets: native.read, value: previous, busy: false, copy: photoDevelopSettingsCopy('en', 'current3'),
		onPending: () => undefined, onChange: (value: unknown) => { choices.push(value); } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDevelopPresetsCurrentV1 {...props} />);
	try {
		await joinedMenu(mounted);
		const retired = reactProps(mounted.dom.one(SELECT)).onChange, cap = native.f.session.develop.presetsCurrent; assert.ok(cap);
		await cap.write({ schemaVersion: 3, catalogId: previous.catalogId, command: { type: 'save', expectedRevision: previous.expectedRevision,
			preset: currentPreset(await native.f.selectedPacket(), previous.presetId, 'Renamed native repairs') } });
		await mounted.event('[data-import-develop-reload]', 'onClick');
		await joinedMenu(mounted, 'Renamed native repairs');
		assert.equal(reactProps(mounted.dom.one(SELECT)).value, '$retained'); assert.deepEqual(choices, []);
		await act(async () => { retired?.({ currentTarget: { value: previous.presetId } }); }); assert.deepEqual(choices, []);
		await mounted.event(SELECT, 'onChange', { currentTarget: { value: previous.presetId } });
		assert.deepEqual(choices, [{ ...previous, expectedRevision: previous.expectedRevision + 1 }]);
		await mounted.event(SELECT, 'onChange', { currentTarget: { value: '' } }); assert.equal(choices[1], null); assert.equal(props.value, previous);
	} finally { await mounted.dispose(); await native.f.close(); }
});

test('Current dialog collapse joins its cancelled native list before replacement demand or import can begin', async () => {
	const native = await nativeMenu(), held = deferred<PhotoLibraryDevelopPresetSnapshotV3>(); let reads = 0, imports = 0, signal: AbortSignal | undefined;
	const props = { ...importDialogProps(), readDevelopPresets: async (options?: Readonly<{ signal?: AbortSignal }>) => {
		reads++; if (reads === 1) { signal = options?.signal; return held.promise; } return native.read();
	}, onImport: async () => { imports++; return { outcome: 'failed' as const }; } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDialogCurrentV1 {...props} />);
	try {
		Reflect.set(mounted.dom.one('input'), 'files', [file]); await mounted.event('input', 'onChange');
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: true } }); assert.equal(reads, 1);
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: false } }); assert.equal(signal?.aborted, true);
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: true } }); assert.equal(reads, 1);
		await mounted.event('form', 'onSubmit', { preventDefault() {} }); assert.equal(imports, 0);
		await act(async () => { held.resolve(native.snapshot); await settle(); }); assert.equal(reads, 2);
		await joinedMenu(mounted);
		await mounted.event(SELECT, 'onChange', { currentTarget: { value: native.snapshot.presets[0]!.id } });
		await mounted.event('form', 'onSubmit', { preventDefault() {} }); assert.equal(imports, 1);
	} finally { held.resolve(native.snapshot); await mounted.dispose(); await native.f.close(); }
});

test('StrictMode Current list retirement pins the native reader and pending receivers and joins before publishing its replacement', async () => {
	const native = await nativeMenu(), held = deferred<PhotoLibraryDevelopPresetSnapshotV3>(), pending: boolean[] = [], receivers: unknown[] = [];
	let reads = 0, oldSignal: AbortSignal | undefined;
	const read = function(this: unknown, options?: Readonly<{ signal?: AbortSignal }>) {
		receivers.push(this); reads++; if (reads === 1) { oldSignal = options?.signal; return held.promise; } return native.read();
	};
	const notify = function(this: unknown, value: boolean) { receivers.push(this); pending.push(value); };
	const props = { readPresets: read, value: null, busy: false, copy: photoDevelopSettingsCopy('en', 'current3'), onChange: () => undefined, onPending: notify };
	const mounted = await mountPhotoImportUi(() => <StrictMode><PhotoImportDevelopPresetsCurrentV1 {...props} /></StrictMode>);
	try {
		assert.equal(oldSignal?.aborted, true); assert.equal(reads, 1); assert.deepEqual(pending, [true]);
		await act(async () => { held.resolve(native.snapshot); await settle(); }); assert.equal(reads, 2);
		await joinedMenu(mounted);
		assert.deepEqual(pending, [true, false, true, false]); assert.equal(receivers[0], receivers[1]); assert.equal(receivers[0], receivers[2]);
		assert.equal(reactProps(mounted.dom.one(SELECT)).disabled, false);
	} finally { held.resolve(native.snapshot); await mounted.dispose(); await native.f.close(); }
});

test('Current selector refuses future, oversized or body-bearing scalar menus without invoking embedded capabilities', async () => {
	const native = await nativeMenu(); let bodyReads = 0;
	const row = { ...native.snapshot.presets[0]! }; Object.defineProperty(row, 'settings', { enumerable: true, get() { bodyReads++; assert.fail('Import selector has no body authority.'); } });
	for (const value of [{ ...native.snapshot, schemaVersion: 4 }, { ...native.snapshot, revision: -0 }, { ...native.snapshot, presets: [row] },
		{ ...native.snapshot, presets: Array.from({ length: 17 }, (_value, index) => ({ ...native.snapshot.presets[0]!, id: `preset-${String(index)}` })) }]) {
		const props = { readPresets: async () => value as PhotoLibraryDevelopPresetSnapshotV3, value: null, busy: false,
			copy: photoDevelopSettingsCopy('en', 'current3'), onPending: () => undefined, onChange: () => assert.fail('Invalid menus cannot emit a choice.') };
		const mounted = await mountPhotoImportUi(() => <PhotoImportDevelopPresetsCurrentV1 {...props} />);
		try { assert.equal(reactProps(mounted.dom.one(SELECT)).disabled, true); assert.equal(mounted.dom.container.querySelectorAll('option').length, 1); }
		finally { await mounted.dispose(); }
	}
	assert.equal(bodyReads, 0); await native.f.close();
});

