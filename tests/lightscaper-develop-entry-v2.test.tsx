/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import { usePhotoDevelopEntryV2 } from '../src/common/editor/ui/lightscaper/use-photo-develop-entry-v2.ts';
import { PhotoLibraryRestoreV1 } from '../src/common/editor/controller/shared/photo-library-restore-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';

function currentEntry(view: ReturnType<typeof usePhotoDevelopEntryV2>) { return view.entry; }

for (const generation of [null, Number.NaN]) test(`current opaque ${String(generation)} generation admits one opted-in Develop entry`, async () => {
	let actual!: ReturnType<typeof usePhotoDevelopEntryV2>, starts = 0;
	function Harness() { actual = usePhotoDevelopEntryV2(generation); return null; }
	const mounted = await mountPhotoImportUi(() => <StrictMode><Harness /></StrictMode>);
	try {
		assert.equal(actual.entry, null); assert.equal(actual.isAdmitted(), false);
		await act(async () => { actual.begin('photo', 'Photo', () => { starts++; return Promise.resolve(); }); });
		assert.equal(actual.isCurrent(), true); assert.equal(actual.isAdmitted(), true); assert.equal(currentEntry(actual)?.photoId, 'photo');
		await act(async () => { actual.begin('other', 'Other', () => { starts++; return Promise.resolve(); }); }); assert.equal(starts, 1);
		await act(async () => { await actual.retireAndJoin(); }); assert.equal(actual.entry, null); assert.equal(actual.isAdmitted(), false);
	} finally { await mounted.dispose(); }
});

test('Restore captures the cached whole registered retirement synchronously before any deferred backend work', async () => {
	let actual!: ReturnType<typeof usePhotoDevelopEntryV2>, retireCalls = 0, loads = 0, reentered: Promise<void> | undefined;
	const held = deferred<void>(), pixels = deferred<void>(), originalProps = { id: 'workspace' }, receivers: unknown[] = [];
	function Harness() { actual = usePhotoDevelopEntryV2('generation'); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	try {
		await act(async () => { actual.begin('photo', 'Photo', () => pixels.promise); });
		const retire = new Proxy(function(this: unknown) { receivers.push(this); retireCalls++; reentered = actual.retireAndJoin(); return held.promise; },
			{ get() { assert.fail('Retirement callable metadata is not authority'); } });
		Reflect.apply(actual.register, originalProps, [retire]);
		let joined!: Promise<void>;
		await act(async () => { joined = actual.retireAndJoin(pixels.promise); void joined.then(() => { loads++; }); await settle(); });
		assert.equal(retireCalls, 1); assert.equal(receivers[0], originalProps); assert.equal(joined, reentered); assert.equal(actual.retireAndJoin(), joined);
		assert.equal(loads, 0); assert.equal(actual.entry, null); assert.equal(actual.closing, true);
		await act(async () => { held.resolve(); await settle(); }); assert.equal(loads, 0);
		await act(async () => { pixels.resolve(); await joined; }); assert.equal(loads, 1); assert.equal(actual.isAdmitted(), false);
	} finally { held.resolve(); pixels.resolve(); await mounted.dispose(); }
});

test('same-component generation replacement automatically retires old whole demand before a fresh open', async () => {
	let generation = 0, actual!: ReturnType<typeof usePhotoDevelopEntryV2>, starts = 0, retireCalls = 0;
	const held = deferred<void>(); function Harness() { actual = usePhotoDevelopEntryV2(generation); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	try {
		await act(async () => { actual.begin('photo', 'Old', () => Promise.resolve()); });
		actual.register(() => { retireCalls++; return held.promise; }); const oldBegin = actual.begin, oldRetire = actual.retireAndJoin;
		generation = -0; await mounted.render(); assert.equal(retireCalls, 1); assert.equal(actual.entry, null);
		await act(async () => { oldBegin('old', 'Old', () => { starts++; return Promise.resolve(); }); actual.begin('new', 'New', () => { starts++; return Promise.resolve(); }); });
		assert.equal(starts, 0); await act(async () => { held.resolve(); await settle(); });
		await act(async () => { actual.begin('new', 'New', () => { starts++; return Promise.resolve(); }); }); assert.equal(starts, 1);
		let nextRetires = 0; actual.register(() => { nextRetires++; return Promise.resolve(); });
		await act(async () => { await oldRetire(); }); assert.equal(nextRetires, 0); assert.equal(currentEntry(actual)?.label, 'New');
	} finally { held.resolve(); await mounted.dispose(); }
});

test('generation replacement also joins the admitted presentation before its lazy Workspace has registered', async () => {
	let generation = {}, actual!: ReturnType<typeof usePhotoDevelopEntryV2>, starts = 0;
	const held = deferred<void>(); function Harness() { actual = usePhotoDevelopEntryV2(generation); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	try {
		await act(async () => { actual.begin('photo', 'Old', () => held.promise); }); generation = {}; await mounted.render();
		assert.equal(actual.entry, null); assert.equal(actual.isAdmitted(), true);
		await act(async () => { actual.begin('new', 'New', () => { starts++; return Promise.resolve(); }); }); assert.equal(starts, 0);
		await act(async () => { held.resolve(); await settle(); });
		await act(async () => { actual.begin('new', 'New', () => { starts++; return Promise.resolve(); }); }); assert.equal(starts, 1);
	} finally { held.resolve(); await mounted.dispose(); }
});

test('the actual Restore controller waits for the whole menu entry join and refuses failed cleanup before loading', async () => {
	for (const failCleanup of [false, true]) {
		let actual!: ReturnType<typeof usePhotoDevelopEntryV2>, loads = 0, retireCalls = 0;
		const held = deferred<void>(), opaque = Object.freeze({ failed: 'workspace cleanup' }), restore = new PhotoLibraryRestoreV1();
		function Harness() { actual = usePhotoDevelopEntryV2('generation'); return null; }
		const mounted = await mountPhotoImportUi(() => <Harness />); let restoring: Promise<unknown> | undefined;
		try {
			await act(async () => { actual.begin('photo', 'Photo', () => Promise.resolve()); });
			actual.register(() => { retireCalls++; return held.promise.then(() => { if (failCleanup) throw opaque; }); });
			await act(async () => { restoring = restore.start({ blob: new Blob(['archive']), retireAndJoin: () => actual.retireAndJoin(),
				loadRuntime: async () => { loads++; return { restoreArchive: async () => ({ catalogId: 'catalog', catalogName: 'Restored', photoCount: 0,
					stackCount: 0, savedCollectionCount: 0, originalCount: 0, originalByteLength: 0, notices: [] }), close: async () => undefined }; } });
				void restoring.catch(() => undefined); assert.equal(retireCalls, 1); await settle(); });
			assert.equal(loads, 0); await act(async () => { held.resolve();
				if (failCleanup) await assert.rejects(restoring!, error => error === opaque); else await restoring; });
			assert.equal(loads, failCleanup ? 0 : 1); assert.equal(actual.isAdmitted(), failCleanup);
		} finally { held.resolve(); await restoring?.catch(() => undefined); await restore.close(); await mounted.dispose(); }
	}
});

test('the cached Restore retirement also joins a late lazy Workspace registration and its exact cleanup failure', async () => {
	for (const failCleanup of [false, true]) {
		let actual!: ReturnType<typeof usePhotoDevelopEntryV2>, loads = 0, lateRetires = 0, settled = false;
		const presentation = deferred<void>(), lateWorkspace = deferred<void>(), opaque = Object.freeze({ failed: 'late Workspace cleanup' }), restore = new PhotoLibraryRestoreV1();
		function Harness() { actual = usePhotoDevelopEntryV2('generation'); return null; }
		const mounted = await mountPhotoImportUi(() => <Harness />); let restoring: Promise<unknown> | undefined, originalJoin!: Promise<void>;
		try {
			await act(async () => { actual.begin('photo', 'Photo', () => presentation.promise); });
			await act(async () => { restoring = restore.start({ blob: new Blob(['archive']), retireAndJoin: () => { originalJoin = actual.retireAndJoin();
				void originalJoin.then(() => { settled = true; }, () => { settled = true; }); return originalJoin; },
				loadRuntime: async () => { loads++; return { restoreArchive: async () => ({ catalogId: 'catalog', catalogName: 'Restored', photoCount: 0,
					stackCount: 0, savedCollectionCount: 0, originalCount: 0, originalByteLength: 0, notices: [] }), close: async () => undefined }; } });
				void restoring.catch(() => undefined); actual.register(() => { lateRetires++; return lateWorkspace.promise.then(() => { if (failCleanup) throw opaque; }); });
				assert.equal(actual.retireAndJoin(), originalJoin); presentation.resolve(); await settle(); });
			assert.equal(lateRetires, 1); assert.equal(loads, 0); assert.equal(settled, false);
			await act(async () => { lateWorkspace.resolve(); if (failCleanup) await assert.rejects(restoring!, error => error === opaque); else await restoring; });
			assert.equal(loads, failCleanup ? 0 : 1); assert.equal(actual.isAdmitted(), failCleanup);
		} finally { presentation.resolve(); lateWorkspace.resolve(); await restoring?.catch(() => undefined); await restore.close(); await mounted.dispose(); }
	}
});

test('whole cleanup failure joins every held demand and remains sticky across replacement generations', async () => {
	let generation = {}, actual!: ReturnType<typeof usePhotoDevelopEntryV2>, starts = 0;
	const held = deferred<void>(), opaque = Object.freeze({ cleanup: 'exact opaque identity' });
	function Harness() { actual = usePhotoDevelopEntryV2(generation); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	try {
		await act(async () => { actual.begin('photo', 'Photo', () => Promise.resolve()); }); actual.register(() => held.promise);
		let result!: Promise<void>, settled = false;
		await act(async () => { result = actual.retireAndJoin(Promise.reject(opaque)); void result.catch(() => { settled = true; }); await settle(); });
		assert.equal(settled, false); assert.equal(actual.isAdmitted(), true);
		await act(async () => { held.resolve(); await assert.rejects(result, error => error === opaque); await settle(); });
		generation = {}; await mounted.render(); await act(async () => { actual.begin('new', 'New', () => { starts++; return Promise.resolve(); }); });
		assert.equal(starts, 0); assert.equal(actual.closing, true); await assert.rejects(actual.retireAndJoin(), error => error === opaque);
	} finally { held.resolve(); await mounted.dispose(); }
});

test('additional pixel retirement passed to Close or Restore joins the existing exact cached epoch', async () => {
	for (const throughClose of [true, false]) {
		let actual!: ReturnType<typeof usePhotoDevelopEntryV2>, settled = false;
		const presentation = deferred<void>(), pixels = deferred<void>(); function Harness() { actual = usePhotoDevelopEntryV2('generation'); return null; }
		const mounted = await mountPhotoImportUi(() => <Harness />); let retiring: Promise<void> | undefined;
		try {
			await act(async () => { actual.begin('photo', 'Photo', () => presentation.promise); retiring = actual.retireAndJoin();
				void retiring.then(() => { settled = true; });
				if (throughClose) actual.close(pixels.promise); else assert.equal(actual.retireAndJoin(pixels.promise), retiring);
				presentation.resolve(); await settle(); });
			assert.equal(settled, false); assert.equal(actual.retireAndJoin(), retiring);
			await act(async () => { pixels.resolve(); await retiring; }); assert.equal(settled, true);
		} finally { presentation.resolve(); pixels.resolve(); await retiring; await mounted.dispose(); }
	}
});

test('begin registers presentation ownership before its borrowed preparation can synchronously retire the entry', async () => {
	let actual!: ReturnType<typeof usePhotoDevelopEntryV2>, retiring!: Promise<void>, settled = false;
	const held = deferred<void>(); function Harness() { actual = usePhotoDevelopEntryV2('generation'); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	try {
		await act(async () => { actual.begin('photo', 'Photo', () => { retiring = actual.retireAndJoin(); void retiring.then(() => { settled = true; }); return held.promise; }); await settle(); });
		assert.equal(actual.entry, null); assert.equal(actual.closing, true); assert.equal(settled, false);
		await act(async () => { held.resolve(); await retiring; }); assert.equal(settled, true); assert.equal(actual.isAdmitted(), false);
	} finally { held.resolve(); await mounted.dispose(); }
});

test('a stale unregister joins only its own cached owner and cannot retire the replacement registration', async () => {
	let actual!: ReturnType<typeof usePhotoDevelopEntryV2>, oldCalls = 0, nextCalls = 0;
	function Harness() { actual = usePhotoDevelopEntryV2('generation'); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	try {
		await act(async () => { actual.begin('photo', 'Photo', () => Promise.resolve()); });
		const oldUnregister = actual.register(() => { oldCalls++; return Promise.resolve(); });
		await act(async () => { await actual.retireAndJoin(); });
		await act(async () => { actual.begin('photo', 'Next', () => Promise.resolve()); }); actual.register(() => { nextCalls++; return Promise.resolve(); });
		await act(async () => { oldUnregister(); await settle(); }); assert.equal(oldCalls, 1); assert.equal(nextCalls, 0);
		await act(async () => { await actual.retireAndJoin(); }); assert.equal(nextCalls, 1);
	} finally { await mounted.dispose(); }
});
