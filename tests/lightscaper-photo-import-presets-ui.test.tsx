/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoImportPresetControls, { type PhotoImportPresetControlsPropsV1 } from '../src/common/editor/ui/lightscaper/PhotoImportPresetControls.tsx';
import type { PhotoLibraryImportPresetCommandV1, PhotoLibraryImportPresetSnapshotV1, PhotoLibraryImportSettingsV1 } from '../src/common/editor/photo-library-import-settings-port-v1.ts';
import { deferred } from './helpers/async-test-control.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

const copy = { photoImportPreset: 'Preset', photoImportPresetNew: 'New preset', photoImportPresetName: 'Preset name',
	photoImportPresetLoad: 'Load', photoImportPresetSave: 'Save', photoImportPresetDelete: 'Delete', photoImportPresetReload: 'Reload',
	photoImportPresetFailed: 'Preset operation failed', photoWorking: 'Working' };
const plain: PhotoLibraryImportSettingsV1 = { rename: null, metadata: {}, keywordIds: [] };
const stored = { rename: { template: '{stem}-東京.{extension}', sequenceStart: 4, sequencePadding: 5 }, metadata: { creator: '', title: 'Stored' }, keywordIds: ['hidden'] };
const snapshot: PhotoLibraryImportPresetSnapshotV1 = { revision: 7, presets: [{ id: 'preset', name: '撮影 preset', settings: stored }] };
const base: PhotoImportPresetControlsPropsV1 = { copy, busy: false, value: plain, onChange: () => undefined,
	readPresets: async () => snapshot, applyPreset: async () => { throw new Error('Unexpected preset mutation'); }, createId: () => 'new-preset' };

test('choosing a named preset is inert; explicit Load detaches and freezes its exact recipe', async () => {
	const input = { ...stored, metadata: { ...stored.metadata }, keywordIds: [...stored.keywordIds], rename: { ...stored.rename } };
	const changes: PhotoLibraryImportSettingsV1[] = [];
	const mounted = await mountPhotoImportUi(() => <PhotoImportPresetControls {...base}
		readPresets={async () => ({ revision: 7, presets: [{ id: 'preset', name: '撮影 preset', settings: input }] })} onChange={next => { changes.push(next); }} />);
	try {
		await mounted.event('[data-import-preset]', 'onChange', { currentTarget: { value: 'preset' } }); assert.equal(changes.length, 0);
		await mounted.event('[data-import-preset-load]', 'onClick'); const value = changes[0]; assert.ok(value); assert.deepEqual(value, stored);
		input.metadata.title = 'Replaced'; input.keywordIds.push('other'); input.rename.template = 'Changed';
		assert.equal(value?.metadata.title, 'Stored'); assert.deepEqual(value?.keywordIds, ['hidden']); assert.equal(value?.rename?.template, stored.rename.template);
		assert.equal(Object.isFrozen(value), true); assert.equal(Object.isFrozen(value?.metadata), true); assert.equal(Object.isFrozen(value?.keywordIds), true);
	} finally { await mounted.dispose(); }
});

test('rapid Choose then Load and name then Save use the current authored preset identity and name', async () => {
	const second = { id: 'second', name: 'Second', settings: { ...plain, metadata: { title: 'Second recipe' } } };
	const inventory = { revision: 7, presets: [...snapshot.presets, second] };
	const changes: PhotoLibraryImportSettingsV1[] = [], commands: PhotoLibraryImportPresetCommandV1[] = [];
	const props = { ...base, readPresets: async () => inventory, onChange: (next: PhotoLibraryImportSettingsV1) => { changes.push(next); },
		applyPreset: async (command: PhotoLibraryImportPresetCommandV1) => { commands.push(command); return { ...inventory, revision: 8 }; } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportPresetControls {...props} />);
	try {
		await mounted.event('[data-import-preset]', 'onChange', { currentTarget: { value: 'preset' } });
		await act(async () => {
			reactProps(mounted.dom.one('[data-import-preset]')).onChange?.({ currentTarget: { value: 'second' } });
			reactProps(mounted.dom.one('[data-import-preset-load]')).onClick?.({});
		});
		assert.deepEqual(changes, [second.settings]);
		await act(async () => {
			reactProps(mounted.dom.one('[data-import-preset-name]')).onChange?.({ currentTarget: { value: 'Latest name' } });
			reactProps(mounted.dom.one('[data-import-preset-save]')).onClick?.({});
		});
		assert.ok(commands[0]?.type === 'save'); assert.equal(commands[0].id, 'second'); assert.equal(commands[0].name, 'Latest name');
	} finally { await mounted.dispose(); }
});

test('conflict preserves the name, selection and working recipe; Reload updates only the inventory and expected revision', async () => {
	let reads = 0, changes = 0; const calls: PhotoLibraryImportPresetCommandV1[] = [];
	const recipe: PhotoLibraryImportSettingsV1 = { ...plain, metadata: { caption: 'Unsaved\nCaption' } };
	const props = { ...base, value: recipe, onChange: () => { changes++; },
		readPresets: async () => ({ ...snapshot, revision: ++reads === 1 ? 7 : 9 }),
		applyPreset: async (command: PhotoLibraryImportPresetCommandV1) => { calls.push(command); if (calls.length === 1) throw new Error('Preset revision conflict'); return { ...snapshot, revision: 10 }; } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportPresetControls {...props} />);
	try {
		await mounted.event('[data-import-preset]', 'onChange', { currentTarget: { value: 'preset' } });
		await mounted.event('[data-import-preset-name]', 'onChange', { currentTarget: { value: 'Draft 名前' } });
		await mounted.event('[data-import-preset-save]', 'onClick');
		assert.match(mounted.dom.container.textContent, /Preset revision conflict/u); assert.equal(mounted.dom.one('[data-import-preset-name]').value, 'Draft 名前');
		assert.equal(reactProps(mounted.dom.one('[data-import-preset]')).value, 'preset'); assert.equal(changes, 0);
		await mounted.event('[data-import-preset-reload]', 'onClick'); assert.equal(mounted.dom.one('[data-import-preset-name]').value, 'Draft 名前');
		await mounted.event('[data-import-preset-save]', 'onClick'); assert.equal(changes, 0);
		assert.deepEqual(calls.map(command => [command.type, command.expectedRevision, command.id]), [['save', 7, 'preset'], ['save', 9, 'preset']]);
		assert.ok(calls[1]?.type === 'save'); assert.deepEqual(calls[1].settings, recipe); assert.equal(calls[1].name, 'Draft 名前');
	} finally { await mounted.dispose(); }
});

test('a new preset keeps one injected ID through a failed save and retry; Delete preserves the working recipe', async () => {
	let allocations = 0, changes = 0; const calls: PhotoLibraryImportPresetCommandV1[] = [];
	const props = { ...base, onChange: () => { changes++; }, createId: () => { allocations++; return 'allocated'; },
		applyPreset: async (command: PhotoLibraryImportPresetCommandV1) => {
			calls.push(command); if (calls.length === 1) throw new Error('Storage unavailable');
			return { revision: calls.length + 7, presets: command.type === 'save' ? [{ id: command.id, name: command.name, settings: command.settings }] : [] };
		} };
	const mounted = await mountPhotoImportUi(() => <PhotoImportPresetControls {...props} />);
	try {
		await mounted.event('[data-import-preset-name]', 'onChange', { currentTarget: { value: 'New title' } });
		await mounted.event('[data-import-preset-save]', 'onClick'); await mounted.event('[data-import-preset-save]', 'onClick');
		assert.equal(allocations, 1); assert.deepEqual(calls.map(command => command.id), ['allocated', 'allocated']);
		assert.equal(reactProps(mounted.dom.one('[data-import-preset]')).value, 'allocated');
		await mounted.event('[data-import-preset-delete]', 'onClick'); assert.equal(changes, 0);
		assert.deepEqual(calls[2], { type: 'delete', expectedRevision: 9, id: 'allocated' });
		assert.equal(reactProps(mounted.dom.one('[data-import-preset]')).value, '');
	} finally { await mounted.dispose(); }
});

test('one pending save snapshots the recipe and refuses duplicate or busy clicks without queueing', async () => {
	const held = deferred<PhotoLibraryImportPresetSnapshotV1>(), calls: PhotoLibraryImportPresetCommandV1[] = [];
	let value = { ...plain, metadata: { title: 'First' } }, busy = false;
	const mounted = await mountPhotoImportUi(() => <PhotoImportPresetControls {...base} value={value} busy={busy}
		applyPreset={async command => { calls.push(command); return held.promise; }} />);
	try {
		await mounted.event('[data-import-preset-name]', 'onChange', { currentTarget: { value: 'Name' } });
		await act(async () => { const click = reactProps(mounted.dom.one('[data-import-preset-save]')).onClick; click?.({}); click?.({}); });
		assert.equal(calls.length, 1); value = { ...value, metadata: { title: 'Later' } }; busy = true; await mounted.render();
		await mounted.event('[data-import-preset-save]', 'onClick'); assert.equal(calls.length, 1);
		assert.ok(calls[0]?.type === 'save'); assert.equal(calls[0].settings.metadata.title, 'First'); assert.equal(Object.isFrozen(calls[0].settings), true);
		await act(async () => { held.resolve({ revision: 8, presets: [] }); });
	} finally { held.resolve({ revision: 8, presets: [] }); await mounted.dispose(); }
});

test('replacement read callbacks abort and fence a held old inventory and unmount aborts current demand', async () => {
	const held = deferred<PhotoLibraryImportPresetSnapshotV1>(), currentHeld = deferred<PhotoLibraryImportPresetSnapshotV1>();
	let oldSignal: AbortSignal | undefined, nextSignal: AbortSignal | undefined, nextReads = 0;
	const oldRead: typeof base.readPresets = async options => { oldSignal = options?.signal; return held.promise; };
	const nextRead: typeof base.readPresets = async options => { nextSignal = options?.signal;
		return ++nextReads === 1 ? { revision: 2, presets: [{ ...snapshot.presets[0]!, id: 'current', name: 'Current' }] } : currentHeld.promise; };
	let readPresets = oldRead;
	const mounted = await mountPhotoImportUi(() => <PhotoImportPresetControls {...base} readPresets={readPresets} />);
	try {
		readPresets = nextRead; await mounted.render(); assert.equal(oldSignal?.aborted, true);
		await act(async () => { held.resolve(snapshot); });
		assert.equal(mounted.dom.container.textContent.includes('撮影 preset'), false); assert.match(mounted.dom.container.textContent, /Current/u);
		await mounted.event('[data-import-preset-reload]', 'onClick');
	} finally { held.resolve(snapshot); await mounted.dispose(); }
	assert.equal(nextSignal?.aborted, true);
	currentHeld.resolve(snapshot);
});

test('a refused oversized inventory is not rendered or replaced with an empty successful snapshot', async () => {
	const mounted = await mountPhotoImportUi(() => <PhotoImportPresetControls {...base} readPresets={async () => ({ revision: 0,
		presets: Array.from({ length: 17 }, (_, index) => ({ id: `preset-${index}`, name: `Name ${index}`, settings: plain })) })} />);
	try {
		assert.match(mounted.dom.container.textContent, /Preset operation failed|bound/u);
		assert.equal(mounted.dom.container.querySelectorAll('option').length, 1);
		assert.equal(reactProps(mounted.dom.one('[data-import-preset-save]')).disabled, true);
	} finally { await mounted.dispose(); }
});
