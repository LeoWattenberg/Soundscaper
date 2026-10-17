/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import PhotoImportDevelopPresets, { type PhotoImportDevelopPresetsPropsV1 } from '../src/common/editor/ui/lightscaper/PhotoImportDevelopPresets.tsx';
import type { PhotoLibraryDevelopPresetReadV1, PhotoLibraryDevelopPresetSnapshotV1 } from '../src/common/editor/photo-library-develop-presets-port-v1.ts';
import { photoDevelopSettingsCopy } from '../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { deferred, settle } from './helpers/async-test-control.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

const snapshot: PhotoLibraryDevelopPresetSnapshotV1 = { schemaVersion: 1, catalogId: 'catalog', revision: 7, presets: [
	{ id: 'full', name: 'Full look', scope: 'full', authoredStateSha256: 'a'.repeat(64) },
	{ id: 'partial', name: 'WB only', scope: 'partial', authoredStateSha256: 'b'.repeat(64) },
] };
const choice: PhotoLibraryDevelopPresetReadV1 = { schemaVersion: 1, catalogId: 'catalog', expectedRevision: 7, presetId: 'full' };
const copy = photoDevelopSettingsCopy('en');
const base: PhotoImportDevelopPresetsPropsV1 = { readPresets: async () => snapshot, value: null,
	onChange: () => undefined, busy: false, copy, onPending: () => undefined };
const select = '[data-import-develop-choice]', reload = '[data-import-develop-reload]';

for (const locale of ['en', 'de']) test(`${locale}: mounted Import options list only scalar full/partial choices and explicit selection captures its revision`, async () => {
	let reads = 0; const changes: (PhotoLibraryDevelopPresetReadV1 | null)[] = [], pending: boolean[] = [];
	const messages = photoDevelopSettingsCopy(locale), props = { ...base, copy: messages,
		readPresets: async () => { reads++; return snapshot; }, onChange: (value: PhotoLibraryDevelopPresetReadV1 | null) => { changes.push(value); },
		onPending: (value: boolean) => { pending.push(value); } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDevelopPresets {...props} />);
	try {
		assert.equal(reads, 1); assert.deepEqual(pending, [true, false]); assert.equal(changes.length, 0);
		assert.match(mounted.dom.container.textContent, new RegExp(messages.presets, 'u'));
		assert.deepEqual(Array.from(mounted.dom.container.querySelectorAll('option'), option => option.textContent),
			[messages.noPreset, `Full look (${messages.full})`, `WB only (${messages.partial})`]);
		await mounted.event(select, 'onChange', { currentTarget: { value: 'full' } });
		await mounted.event(select, 'onChange', { currentTarget: { value: 'partial' } });
		await mounted.event(select, 'onChange', { currentTarget: { value: '' } });
		assert.deepEqual(changes, [choice, { ...choice, presetId: 'partial' }, null]);
		assert.equal(Object.isFrozen(changes[0]), true); assert.deepEqual(Object.keys(changes[0]!), ['schemaVersion', 'catalogId', 'presetId', 'expectedRevision']);
		assert.equal(reads, 1); // No selected body/read/apply capability is exposed to this component.
	} finally { await mounted.dispose(); }
});

test('Reload does not silently upgrade or clear a retained scalar choice; explicit selection captures the fresh revision', async () => {
	let reads = 0, value: PhotoLibraryDevelopPresetReadV1 | null = choice;
	const changes: (PhotoLibraryDevelopPresetReadV1 | null)[] = [];
	const props = { ...base, readPresets: async () => ({ ...snapshot, revision: ++reads === 1 ? 7 : 9 }),
		onChange: (next: PhotoLibraryDevelopPresetReadV1 | null) => { changes.push(next); value = next; } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDevelopPresets {...props} value={value} />);
	try {
		await mounted.event(reload, 'onClick'); assert.equal(reads, 2); assert.equal(value, choice); assert.deepEqual(changes, []);
		await mounted.event(select, 'onChange', { currentTarget: { value: 'partial' } });
		assert.deepEqual(value, { ...choice, presetId: 'partial', expectedRevision: 9 });
	} finally { await mounted.dispose(); }
});

test('a foreign fresh catalog or deleted preset preserves the archived selected choice instead of substituting another recipe', async () => {
	let changes = 0;
	const mounted = await mountPhotoImportUi(() => <PhotoImportDevelopPresets {...base} value={choice}
		readPresets={async () => ({ ...snapshot, catalogId: 'other', revision: 12, presets: [snapshot.presets[1]!] })}
		onChange={() => { changes++; }} />);
	try {
		assert.equal(changes, 0); assert.match(mounted.dom.container.textContent, /full/u);
		assert.notEqual(reactProps(mounted.dom.one(select)).value, 'partial');
		await mounted.event(select, 'onChange', { currentTarget: { value: 'partial' } }); assert.equal(changes, 1);
	} finally { await mounted.dispose(); }
});

test('retained local Choose and Reload cannot borrow the refreshed list authority with unchanged parent props', async () => {
	let reads = 0; const changes: (PhotoLibraryDevelopPresetReadV1 | null)[] = [];
	const props = { ...base, readPresets: async () => ({ ...snapshot, revision: ++reads === 1 ? 7 : 9 }),
		onChange: (value: PhotoLibraryDevelopPresetReadV1 | null) => { changes.push(value); } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDevelopPresets {...props} />);
	try {
		const oldChoose = reactProps(mounted.dom.one(select)).onChange, oldReload = reactProps(mounted.dom.one(reload)).onClick;
		await mounted.event(reload, 'onClick'); assert.equal(reads, 2);
		await act(async () => { oldChoose?.({ currentTarget: { value: 'full' } }); oldReload?.({}); });
		assert.deepEqual(changes, []); assert.equal(reads, 2);
		await mounted.event(select, 'onChange', { currentTarget: { value: 'partial' } });
		assert.deepEqual(changes, [{ ...choice, presetId: 'partial', expectedRevision: 9 }]);
	} finally { await mounted.dispose(); }
});

test('busy admission defers the initial list and refuses retained Choose/Reload without queuing', async () => {
	let busy = true, reads = 0, changes = 0; const readPresets = async () => { reads++; return snapshot; };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDevelopPresets {...base} busy={busy} readPresets={readPresets} onChange={() => { changes++; }} />);
	try {
		assert.equal(reads, 0); await mounted.event(reload, 'onClick'); await mounted.event(select, 'onChange', { currentTarget: { value: 'full' } });
		assert.equal(reads, 0); assert.equal(changes, 0); assert.equal(reactProps(mounted.dom.one(select)).disabled, true);
		busy = false; await mounted.render(); assert.equal(reads, 1);
		const oldChoose = reactProps(mounted.dom.one(select)).onChange, oldReload = reactProps(mounted.dom.one(reload)).onClick;
		busy = true; await mounted.render(); await act(async () => { oldChoose?.({ currentTarget: { value: 'full' } }); oldReload?.({}); });
		assert.equal(reads, 1); assert.equal(changes, 0);
	} finally { await mounted.dispose(); }
});

test('callback replacement aborts and joins the held old list before the replacement callback runs', async () => {
	const held = deferred<PhotoLibraryDevelopPresetSnapshotV1>(); let oldSignal: AbortSignal | undefined, nextReads = 0, changes = 0;
	const pending: boolean[] = [], next = { ...snapshot, revision: 12, presets: [{ ...snapshot.presets[0]!, name: 'Current' }] };
	const oldRead: typeof base.readPresets = async options => { oldSignal = options?.signal; return held.promise; };
	const nextRead: typeof base.readPresets = async () => { nextReads++; return next; }; let readPresets = oldRead;
	const mounted = await mountPhotoImportUi(() => <PhotoImportDevelopPresets {...base} readPresets={readPresets}
		onPending={value => { pending.push(value); }} onChange={() => { changes++; }} />);
	try {
		const oldReload = reactProps(mounted.dom.one(reload)).onClick, oldChoose = reactProps(mounted.dom.one(select)).onChange;
		readPresets = nextRead; await mounted.render(); assert.equal(oldSignal?.aborted, true); assert.equal(nextReads, 0); assert.deepEqual(pending, [true]);
		await act(async () => { oldReload?.({}); oldChoose?.({ currentTarget: { value: 'full' } }); }); assert.equal(changes, 0);
		await act(async () => { held.resolve(snapshot); await settle(); });
		assert.equal(nextReads, 1); assert.deepEqual(pending, [true, false, true, false]);
		assert.match(mounted.dom.container.textContent, /Current/u); assert.equal(mounted.dom.container.textContent.includes('Full look'), false);
	} finally { held.resolve(snapshot); await mounted.dispose(); }
});

test('unmount cancels the list but pending stays owned until a late opaque rejection actually joins', async () => {
	const held = deferred<PhotoLibraryDevelopPresetSnapshotV1>(), pending: boolean[] = []; let signal: AbortSignal | undefined, changes = 0, traps = 0;
	const failure = new Proxy({}, { get() { traps++; throw new Error('Unexpected error inspection'); },
		getPrototypeOf() { traps++; throw new Error('Unexpected error brand'); }, getOwnPropertyDescriptor() { traps++; throw new Error('Unexpected error descriptor'); } });
	const mounted = await mountPhotoImportUi(() => <PhotoImportDevelopPresets {...base}
		readPresets={async options => { signal = options?.signal; return held.promise; }} onPending={value => { pending.push(value); }} onChange={() => { changes++; }} />);
	const oldChoose = reactProps(mounted.dom.one(select)).onChange, oldReload = reactProps(mounted.dom.one(reload)).onClick;
	await mounted.dispose(); assert.equal(signal?.aborted, true); assert.deepEqual(pending, [true]);
	oldChoose?.({ currentTarget: { value: 'full' } }); oldReload?.({}); held.reject(failure); await settle();
	assert.deepEqual(pending, [true, false]); assert.equal(changes, 0); assert.equal(traps, 0);
});

test('collapsing and reopening options preserves the controlled choice and joins the retired list before another mount reads', async () => {
	const held = deferred<PhotoLibraryDevelopPresetSnapshotV1>(); let shown = true, reads = 0, signal: AbortSignal | undefined;
	const readPresets: typeof base.readPresets = async options => { if (++reads === 1) { signal = options?.signal; return held.promise; } return { ...snapshot, revision: 9 }; };
	function Parent() {
		const [pending, setPending] = useState(false), [value, setValue] = useState<PhotoLibraryDevelopPresetReadV1 | null>(choice);
		return shown ? <PhotoImportDevelopPresets {...base} readPresets={readPresets} value={value} onChange={setValue} busy={pending} onPending={setPending} /> : null;
	}
	const mounted = await mountPhotoImportUi(() => <Parent />);
	try {
		shown = false; await mounted.render(); assert.equal(signal?.aborted, true); shown = true; await mounted.render(); assert.equal(reads, 1);
		await act(async () => { held.resolve(snapshot); await settle(); }); assert.equal(reads, 2);
		assert.match(mounted.dom.container.textContent, /full/u);
		await mounted.event(select, 'onChange', { currentTarget: { value: 'partial' } });
		assert.equal(reactProps(mounted.dom.one(select)).value, 'partial');
	} finally { held.resolve(snapshot); await mounted.dispose(); }
});

test('list callback and receiver are captured, source scalars detach and private signal overrides never run', async () => {
	const input = { ...snapshot, presets: snapshot.presets.map(preset => ({ ...preset })) }; let overrides = 0;
	const receivers: unknown[] = [];
	const changes: (PhotoLibraryDevelopPresetReadV1 | null)[] = [];
	const props: PhotoImportDevelopPresetsPropsV1 = { ...base, readPresets: function(options) {
		receivers.push(this); Object.defineProperty(options!.signal!, 'throwIfAborted', { get() { overrides++; throw new Error('Caller shadow'); } });
		return Promise.resolve(input);
	}, onChange: value => { changes.push(value); } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDevelopPresets {...props} />);
	try {
		assert.equal((receivers[0] as PhotoImportDevelopPresetsPropsV1).readPresets, props.readPresets); assert.equal(overrides, 0);
		input.presets[0]!.name = 'Mutated'; input.revision = 22;
		assert.match(mounted.dom.container.textContent, /Full look/u); assert.equal(mounted.dom.container.textContent.includes('Mutated'), false);
		await mounted.event(select, 'onChange', { currentTarget: { value: 'full' } }); assert.deepEqual(changes, [choice]);
	} finally { await mounted.dispose(); }
});

test('failed Reload preserves the last valid list and selected revision without inspecting the opaque failure', async () => {
	let reads = 0, changes = 0, traps = 0;
	const failure = new Proxy({}, { get() { traps++; throw new Error('Opaque failure'); },
		getOwnPropertyDescriptor() { traps++; throw new Error('Opaque descriptor'); } });
	const props = { ...base, value: choice, readPresets: async () => { if (++reads === 2) throw failure; return snapshot; },
		onChange: () => { changes++; } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDevelopPresets {...props} />);
	try {
		await mounted.event(reload, 'onClick'); assert.equal(reads, 2); assert.equal(changes, 0); assert.equal(traps, 0);
		assert.equal(reactProps(mounted.dom.one(select)).value, 'full'); assert.equal(mounted.dom.container.querySelectorAll('option').length, 3);
		assert.equal(reactProps(mounted.dom.one(select)).disabled, false); assert.ok(mounted.dom.container.textContent.includes(copy.actionFailed));
		await mounted.event(select, 'onChange', { currentTarget: { value: 'partial' } }); assert.equal(changes, 1);
	} finally { await mounted.dispose(); }
});

test('oversized, accessor or body-bearing inventories refuse without publishing a successful empty list or reflecting bodies', async () => {
	let getters = 0;
	const accessor = { ...snapshot.presets[0] }; Object.defineProperty(accessor, 'name', { enumerable: true, get() { getters++; throw new Error('Unexpected source getter'); } });
	const body = { ...snapshot.presets[0] }; Object.defineProperty(body, 'settings', { enumerable: true, get() { getters++; throw new Error('Unexpected body read'); } });
	for (const raw of [{ ...snapshot, presets: Array.from({ length: 17 }, (_, index) => ({ ...snapshot.presets[0], id: `preset-${index}` })) },
		{ ...snapshot, presets: [accessor] }, { ...snapshot, presets: [body] }, { ...snapshot, revision: -0 }]) {
		const mounted = await mountPhotoImportUi(() => <PhotoImportDevelopPresets {...base} readPresets={async () => raw as PhotoLibraryDevelopPresetSnapshotV1} />);
		try {
			assert.match(mounted.dom.container.textContent, new RegExp(copy.actionFailed.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
			assert.equal(mounted.dom.container.querySelectorAll('option').length, 1); assert.equal(reactProps(mounted.dom.one(select)).disabled, true);
		} finally { await mounted.dispose(); }
	}
	assert.equal(getters, 0);
});
