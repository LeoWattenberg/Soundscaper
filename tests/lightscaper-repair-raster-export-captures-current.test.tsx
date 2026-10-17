/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act, StrictMode } from 'react';
import { usePhotoLibraryWorkflowCurrentV1 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow-current-v1.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { seedCurrentAppPhoto, currentAppLocks } from './helpers/lightscaper-current-app-fixture.tsx';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const TIME = '2026-10-12T00:00:00.000Z';
type Workflow = ReturnType<typeof usePhotoLibraryWorkflowCurrentV1>;
function outcome<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }

async function fixture(retainedLegacy = false) {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks());
	const session = await createPhotoLibrarySessionCurrentV1(seeded.options);
	const initial = await session.develop.read({ schemaVersion: 3, photoId: seeded.photo.id });
	const repairs = { schemaVersion: 1 as const, spots: [{ id: 'repair', mode: 'clone' as const, enabled: true,
		target: { x: .75, y: .5 }, source: { x: .25, y: .5 }, radius: .1, feather: 0, opacity: 1 }] };
	await session.develop.apply({ schemaVersion: 3, photoId: seeded.photo.id, expectedRevision: initial.revision,
		command: { type: 'record-develop', versionId: initial.versionId, develop: replaceImageDevelopRepairSpotsV1(initial.develop, repairs), label: 'Repair', createdAt: TIME } });
	if (retainedLegacy) {
		const selected = await session.develop.read({ schemaVersion: 3, photoId: seeded.photo.id });
		await session.develop.apply({ schemaVersion: 3, photoId: seeded.photo.id, expectedRevision: selected.revision,
			command: { type: 'select-develop-history', versionId: selected.versionId, cursor: 0 } });
	}
	const selected = await session.develop.read({ schemaVersion: 3, photoId: seeded.photo.id });
	let view: Workflow | undefined, opens = 0;
	const renderer = async () => createPhotoDevelopRenderRuntimeV3({ source: session.cubeLuts.source, maskSource: session.maskRasterSource });
	let factory = async () => { opens++; return session; };
	function Harness() { view = usePhotoLibraryWorkflowCurrentV1(factory, undefined, renderer); return null; }
	const mounted = await mountPhotoImportUi(() => <StrictMode><Harness /></StrictMode>);
	return { ...mounted, native, seeded, session, selected, repairs,
		current() { assert.ok(view); return view; }, opens: () => opens,
		async replace() { factory = async () => { opens++; return createPhotoLibrarySessionCurrentV1(seeded.options); }; await mounted.render(); },
		async dispose() { try { await mounted.dispose(); } finally { await session.close(); } } };
}

for (const retainedLegacy of [false, true]) test(`Current export metadata admits a complete Photo3 with ${retainedLegacy ? 'retained repair and selected legacy' : 'selected repair'} recipe without legacy demotion`, async () => {
	const f = await fixture(retainedLegacy), read = f.session.readMetadata; let calls = 0;
	Object.defineProperty(f.session, 'readMetadata', { configurable: true, value: function (this: unknown, ...args: Parameters<typeof read>) {
		assert.equal(this, f.session); calls++; return Reflect.apply(read, f.session, args) as ReturnType<typeof read>;
	} });
	try {
		assert.equal(f.opens(), 0); assert.equal(f.selected.develop.processVersion, retainedLegacy ? 1 : 3);
		const expected = await Reflect.apply(read, f.session, [f.seeded.photo.id]) as Awaited<ReturnType<typeof read>>;
		const actual = await f.current().readExportMetadata(f.seeded.photo.id, f.selected.revision, { signal: new AbortController().signal });
		assert.deepEqual(actual, { catalogId: f.selected.catalogId, snapshot: expected }); assert.equal(calls, 1); assert.equal(f.opens(), 1);
		await assert.rejects(f.session.legacyDevelop!.read({ schemaVersion: 2, photoId: f.seeded.photo.id }));
		assert.deepEqual(await f.session.develop.read({ schemaVersion: 3, photoId: f.seeded.photo.id }), f.selected);
	} finally { await f.dispose(); }
});

test('Current export metadata joins a held real native read and rejects a revision changed during delivery', async () => {
	const f = await fixture(), read = f.session.readMetadata, entered = deferred<void>(), release = deferred<void>();
	Object.defineProperty(f.session, 'readMetadata', { configurable: true, value: async function (this: unknown, ...args: Parameters<typeof read>) {
		assert.equal(this, f.session); const value = await Reflect.apply(read, f.session, args) as Awaited<ReturnType<typeof read>>;
		entered.resolve(); await release.promise; return value;
	} });
	const reading = outcome(f.current().readExportMetadata(f.seeded.photo.id, f.selected.revision, { signal: new AbortController().signal }));
	try {
		assert.equal(await Promise.race([entered.promise.then(() => true), reading.then(() => false)]), true);
		assert.equal(await remainsPending(reading), true);
		await f.session.setRating(f.seeded.photo.id, 1);
		release.resolve(); const result = await reading; assert.equal(result.ok, false);
		const saved = await f.session.develop.read({ schemaVersion: 3, photoId: f.seeded.photo.id });
		assert.equal(saved.revision, f.selected.revision + 1); assert.deepEqual(saved.develop, f.selected.develop);
	} finally { release.resolve(); await reading; await f.dispose(); }
});

test('a captured Current metadata callback stays retired after renderer/session generation replacement', async () => {
	const f = await fixture();
	try {
		await act(async () => { await f.current().readPage(); }); const stale = f.current().readExportMetadata;
		await f.replace(); await act(async () => { await settle(); });
		await assert.rejects(stale(f.seeded.photo.id, f.selected.revision, { signal: new AbortController().signal }), { name: 'AbortError' });
		assert.equal(f.opens(), 1, 'A retired reader cannot acquire the next selected namespace.');
	} finally { await f.dispose(); }
});


test('Current sidecar and journal captures use named native capabilities with pinned receivers and no legacy or callable metadata reads', async () => {
	const f = await fixture(true), read = f.session.readExportSidecarCurrent, journal = f.session.exportJournalCurrent;
	assert.ok(read); assert.ok(journal); const open = journal.open; let metadata = 0, reads = 0, opens = 0;
	const wrappedRead = new Proxy(read, { get() { metadata++; assert.fail('Callable metadata is not resource authority.'); },
		apply(target, receiver, args) { assert.equal(receiver, f.session); reads++; return Reflect.apply(target, f.session, args); } });
	const wrappedJournal = Object.freeze({ open: new Proxy(open, { get() { metadata++; assert.fail('Journal callable metadata inspected.'); },
		apply(target, receiver, args) { assert.equal(receiver, wrappedJournal); opens++; return Reflect.apply(target, journal, args); } }) });
	Object.defineProperty(f.session, 'readExportSidecarCurrent', { configurable: true, value: wrappedRead });
	Object.defineProperty(f.session, 'exportJournalCurrent', { configurable: true, value: wrappedJournal });
	Object.defineProperty(f.session, 'readExportSidecar', { configurable: true, get() { assert.fail('Full Photo3 cannot borrow the legacy sidecar.'); } });
	Object.defineProperty(f.session, 'exportJournal', { configurable: true, get() { assert.fail('Full Photo3 cannot borrow the legacy journal.'); } });
	try {
		await act(async () => { await f.current().readPage(); }); const saved = f.selected;
		const request = { catalogId: saved.catalogId, photoId: saved.photoId, versionId: saved.versionId, expectedRevision: saved.revision };
		const readSidecar = f.current().captureExportSidecarReader(), openJournal = f.current().captureExportJournalOpener();
		const signal = new AbortController().signal, text = await readSidecar(request, { signal });
		const sidecar: unknown = JSON.parse(text); assert.ok(sidecar && typeof sidecar === 'object');
		assert.equal(Reflect.get(sidecar, 'schemaVersion'), 2); assert.equal(Reflect.get(sidecar, 'photoSchemaVersion'), 3);
		const version: unknown = Reflect.get(sidecar, 'version'); assert.ok(version && typeof version === 'object');
		assert.equal(Reflect.get(version, 'id'), saved.versionId); assert.deepEqual(Reflect.get(version, 'develop'), saved.develop);
		Object.defineProperty(f.session, 'readExportSidecarCurrent', { configurable: true, value: () => { assert.fail('Captured sidecar was replaced.'); } });
		assert.equal(await readSidecar(request, { signal }), text);
		const access = await openJournal({ signal }); assert.equal(access.catalogId, saved.catalogId); await access.verifyResources(request, { signal });
		assert.equal(reads, 2); assert.equal(opens, 1); assert.equal(metadata, 0);
		assert.deepEqual(await f.session.develop.read({ schemaVersion: 3, photoId: saved.photoId }), saved);
		await f.replace(); await assert.rejects(readSidecar(request, { signal }), { name: 'AbortError' });
		await assert.rejects(openJournal({ signal }), { name: 'AbortError' }); assert.equal(f.opens(), 1);
	} finally { await f.dispose(); }
});
