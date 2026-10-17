/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoLibraryDevelopSessionV3, normalizePhotoLibraryDevelopCommandV3, type PhotoLibraryDevelopSessionHostV3 } from '../src/lightscaper/controller/photo-library-develop-session-v3.ts';
import { readPhotoLibraryDevelopSnapshotV2, normalizePhotoLibraryDevelopCommandV2 } from '../src/lightscaper/controller/photo-library-develop-session-v2.ts';
import { createPhotoLibraryDevelopSessionForProfileV1, readPhotoLibraryDevelopSnapshotForProfileV1, normalizePhotoLibraryDevelopCommandForProfileV1 } from '../src/lightscaper/controller/photo-library-develop-session-kernel.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoCommandOwnerCurrentV1 } from '../src/lightscaper/controller/photo-command-owner-current-v1.ts';
import { PhotoLibrarySessionLifetime } from '../src/lightscaper/controller/photo-library-session-lifetime.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { withPhotoOriginalFrameV1 } from '../src/lightscaper/preview/photo-original-frame-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const TIME = '2026-10-11T00:00:00.000Z';
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
function repaired() {
	return replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV2(), { schemaVersion: 1, spots: [{ id: 'repair', mode: 'clone', enabled: false,
		target: { x: 0.5, y: 0.5 }, source: { x: 0.5, y: 0.5 }, radius: 0.1, feather: 0, opacity: 1 }] });
}
const record = () => ({ type: 'record-develop' as const, versionId: 'version-1', develop: repaired(), label: 'Repair', createdAt: TIME });
async function enteredBeforeSettlement(work: Promise<unknown>, entered: Promise<void>): Promise<void> {
	await Promise.race([entered, work.then(() => { assert.fail('The held owner settled before entering its real operation.'); }, (error: unknown) => { throw error; })]);
}
async function fixture() {
	const raw = createInstrumentedIndexedDB(), databaseName = `develop3-${crypto.randomUUID()}`;
	const repository = new PhotoCatalogRepositoryCurrentV1({ indexedDB: raw as unknown as IDBFactory, databaseName, verifyOriginal: async () => undefined });
	const seed = photoArchiveFixture(1, PNG), lifetime = new PhotoLibrarySessionLifetime();
	await repository.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1', name: 'Develop3',
		revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	await repository.publishPhotos('catalog-1', 0, [seed.photo]);
	const calls = { ready: 0, bodies: 0, opens: 0, decodedCloses: 0, resourcesClosed: 0 };
	const hooks = { ready: async () => 'catalog-1', afterWriter: async (): Promise<void> => undefined, body: seed.original };
	const host: PhotoLibraryDevelopSessionHostV3 = { repository,
		async ready() { calls.ready++; return hooks.ready(); },
		operation: (run, signal) => lifetime.operation(run, signal),
		edit: (photoId, run, signal) => lifetime.mutation(async admitted => {
			const catalogId = await host.ready(); admitted.throwIfAborted();
			const owner = await PhotoCommandOwnerCurrentV1.open(repository, catalogId, photoId);
			try { admitted.throwIfAborted(); const value = await run(owner, admitted); await hooks.afterWriter(); return value; }
			finally { await owner.close(); }
		}, signal),
		originalSource: {
			async loadOriginal(original) { calls.bodies++; assert.deepEqual(original, seed.photo.original); return hooks.body; },
			withFrame: (value, consume) => withPhotoOriginalFrameV1(value, consume, { openImage: async () => {
				calls.opens++; return { metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'develop3-native-port' },
					decodeFrame: async () => ({ rgba: Uint8Array.of(7, 19, 233, 255), durationMicroseconds: null }), close() { calls.decodedCloses++; } };
			} }),
		},
	};
	const close = () => lifetime.close(async () => { calls.resourcesClosed++; await repository.close(); });
	return { raw, databaseName, repository, seed, lifetime, host, hooks, calls, close };
}

test('Develop3 records complete repair history, snapshot and virtual copy through actual native ACK and reopen', async () => {
	const f = await fixture();
	try {
		const port = createPhotoLibraryDevelopSessionV3(f.host);
		assert.equal(port.schemaVersion, 3); assert.equal(Object.hasOwn(port, 'settings'), false); assert.equal(Object.hasOwn(port, 'presets'), false);
		let view = await port.read({ schemaVersion: 3, photoId: 'photo-1' }); assert.equal(view.develop.processVersion, 1);
		let ack = await port.apply({ schemaVersion: 3, photoId: 'photo-1', expectedRevision: 0, command: record() });
		assert.equal(ack.schemaVersion, 3); assert.equal(ack.snapshot.revision, 1); assert.deepEqual(ack.snapshot.develop, repaired());
		ack = await port.apply({ schemaVersion: 3, photoId: 'photo-1', expectedRevision: 1, command: {
			type: 'save-develop-snapshot', versionId: 'version-1', id: 'saved', name: 'Repair', createdAt: TIME } });
		ack = await port.apply({ schemaVersion: 3, photoId: 'photo-1', expectedRevision: ack.snapshot.revision, command: {
			type: 'create-virtual-copy', id: 'copy', name: 'Copy', sourceVersionId: 'version-1', createdAt: TIME } });
		assert.equal(ack.snapshot.versionId, 'copy'); assert.deepEqual(ack.snapshot.develop, repaired());
		view = (await port.apply({ schemaVersion: 3, photoId: 'photo-1', expectedRevision: ack.snapshot.revision,
			command: { type: 'select-develop-history', versionId: 'version-1', cursor: 0 } })).snapshot;
		assert.equal(view.develop.processVersion, 1); assert.equal(view.history.entries.length, 2);
		const saved = await f.repository.loadPhoto('catalog-1', 'photo-1'); assert.ok(saved); assert.equal(saved.schemaVersion, 3);
		assert.deepEqual(saved.versions[0]?.workspace?.snapshots[0]?.develop, repaired()); assert.deepEqual(saved.original, f.seed.photo.original);
		assert.throws(() => readPhotoLibraryDevelopSnapshotV2(saved));
		assert.deepEqual(await createPhotoLibraryDevelopSessionV3(f.host).read({ schemaVersion: 3, photoId: 'photo-1', versionId: 'version-1' }), view);
		const restored = await port.apply({ schemaVersion: 3, photoId: 'photo-1', expectedRevision: view.revision, command: {
			type: 'restore-develop-snapshot', versionId: 'version-1', snapshotId: 'saved', label: 'Restored', createdAt: TIME } });
		assert.deepEqual(restored.snapshot.develop, repaired()); assert.equal(f.calls.bodies, 0);
	} finally { await f.close(); }
});

test('Develop3 closed commands refuse old/future/accessor packets before acquisition while old command admission stays strict', async () => {
	const f = await fixture(); let getters = 0;
	try {
		assert.deepEqual(normalizePhotoLibraryDevelopCommandV3(record()), record());
		assert.throws(() => normalizePhotoLibraryDevelopCommandV2(record()));
		const port = createPhotoLibraryDevelopSessionV3(f.host);
		for (const schemaVersion of [1, 2, 4]) await assert.rejects(Reflect.apply(port.read, port, [{ schemaVersion, photoId: 'photo-1' }]));
		const command = Object.defineProperty(record(), 'develop', { enumerable: true, get() { getters++; return repaired(); } });
		await assert.rejects(port.apply({ schemaVersion: 3, photoId: 'photo-1', expectedRevision: 0, command }));
		assert.throws(() => normalizePhotoLibraryDevelopCommandV3({ ...record(), body: PNG }));
		let policyReads = 0; const unread = new Proxy({}, { get() { policyReads++; throw Error('Invalid profile reflected authority'); }, ownKeys() { policyReads++; throw Error('Invalid profile reflected values'); } });
		for (const operation of [createPhotoLibraryDevelopSessionForProfileV1, readPhotoLibraryDevelopSnapshotForProfileV1, normalizePhotoLibraryDevelopCommandForProfileV1]) {
			assert.throws(() => Reflect.apply(operation, undefined, ['future', unread]), /profile/iu);
		}
		assert.equal(policyReads, 0);
		assert.equal(getters, 0); assert.equal(f.calls.ready, 0); assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.revision, 0);
	} finally { await f.close(); }
});

test('Develop3 captures mutable commands and exact host/repository receivers before held readiness', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); let metadataReads = 0;
	const originalRead = f.repository.loadPhoto, originalReady = f.host.ready, originalEdit = f.host.edit;
	Reflect.set(f.repository, 'loadPhoto', new Proxy(originalRead, { get() { metadataReads++; throw Error('Callable metadata inspected'); },
		apply(target, receiver, args) { assert.equal(receiver, f.repository); return Reflect.apply(target, receiver, args); } }));
	Reflect.set(f.host, 'ready', function (this: unknown) { assert.equal(this, f.host); return originalReady(); });
	Reflect.set(f.host, 'edit', function (this: unknown, ...args: Parameters<typeof originalEdit>) {
		assert.equal(this, f.host); return Reflect.apply(originalEdit, f.host, args);
	});
	f.hooks.ready = async () => { entered.resolve(); await release.promise; return 'catalog-1'; };
	const work: { value?: Promise<unknown> } = {};
	try {
		const port = createPhotoLibraryDevelopSessionV3(f.host), command = structuredClone(record());
		work.value = port.apply({ schemaVersion: 3, photoId: 'photo-1', expectedRevision: 0, command });
		await enteredBeforeSettlement(work.value, entered.promise);
		command.label = 'Mutated'; Reflect.set(command.develop.repairs.spots[0]!.source, 'x', 0.1);
		Reflect.set(f.host, 'edit', async () => { assert.fail('A replacement writer was acquired.'); });
		release.resolve(); await work.value;
		const saved = await f.repository.loadPhoto('catalog-1', 'photo-1'); assert.ok(saved);
		assert.equal(saved.versions[0]?.workspace?.entries[1]?.label, 'Repair'); assert.deepEqual(saved.versions[0]?.develop, repaired());
		Reflect.set(f.repository, 'loadPhoto', async () => { assert.fail('A replacement reader was acquired.'); });
		assert.equal((await port.read({ schemaVersion: 3, photoId: 'photo-1' })).revision, 1); assert.equal(metadataReads, 0);
	} finally { release.resolve(); await Promise.allSettled(work.value ? [work.value] : []); await f.close(); }
});

test('Develop3 held readiness cancellation and Close join the actual lifetime with the exact opaque reason', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(); let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('Opaque getter'); }, getPrototypeOf() { traps++; throw Error('Opaque prototype'); } });
	f.hooks.ready = async () => { entered.resolve(); await release.promise; return 'catalog-1'; };
	const work: { value?: Promise<unknown> } = {};
	try {
		const port = createPhotoLibraryDevelopSessionV3(f.host); work.value = port.read({ schemaVersion: 3, photoId: 'photo-1' }, { signal: stop.signal });
		const outcome = work.value.then(() => ({ error: undefined }), (error: unknown) => ({ error }));
		await enteredBeforeSettlement(work.value, entered.promise); stop.abort(reason);
		const closing = f.close(); assert.equal(f.close(), closing); assert.equal(await remainsPending(closing), true);
		assert.equal(f.calls.resourcesClosed, 0); release.resolve(); assert.equal((await outcome).error, reason);
		await closing; assert.equal(f.calls.resourcesClosed, 1); assert.equal(traps, 0);
	} finally { release.resolve(); await Promise.allSettled(work.value ? [work.value] : []); await f.close(); }
});

test('Develop3 original child authenticates the complete retained Photo3 body and fences consumer revision', async () => {
	const f = await fixture(), borrowed: PixelFrameV1[] = [];
	try {
		const port = createPhotoLibraryDevelopSessionV3(f.host);
		const ack = await port.apply({ schemaVersion: 3, photoId: 'photo-1', expectedRevision: 0, command: record() }); assert.ok(port.original);
		const request = { schemaVersion: 1 as const, photoId: 'photo-1', expectedRevision: ack.snapshot.revision };
		const pixels = await port.original.withFrame(request, view => { borrowed.push(view.frame); assert.equal(f.calls.decodedCloses, 1); return [...view.frame.pixels]; });
		assert.deepEqual(pixels, [7, 19, 233, 255]); assert.ok(borrowed[0]?.pixels.every(value => value === 0));
		f.hooks.body = new Blob([PNG.slice(1)]); await assert.rejects(port.original.withFrame(request, () => undefined), /length/iu);
		assert.equal(f.calls.opens, 1); f.hooks.body = f.seed.original;
		await assert.rejects(port.original.withFrame(request, async view => {
			borrowed.push(view.frame); const photo = await f.repository.loadPhoto('catalog-1', 'photo-1'); assert.ok(photo);
			await f.repository.savePhoto({ ...photo, metadata: { ...photo.metadata, title: 'Changed while borrowed' } }, photo.revision);
		}), { code: 'PHOTO_REVISION_CONFLICT' });
		assert.ok(borrowed[1]?.pixels.every(value => value === 0)); assert.deepEqual(new Uint8Array(await f.seed.original.arrayBuffer()), PNG);
	} finally { await f.close(); }
});

test('Develop3 original child pins both source methods and their real receiver before held readiness', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), work: { value?: Promise<unknown> } = {}; let metadata = 0, loads = 0, decodes = 0;
	try {
		const ack = await createPhotoLibraryDevelopSessionV3(f.host).apply({ schemaVersion: 3, photoId: 'photo-1', expectedRevision: 0, command: record() });
		const source = f.host.originalSource; assert.ok(source); const load = source.loadOriginal, decode = source.withFrame; assert.ok(decode);
		Reflect.set(source, 'loadOriginal', new Proxy(load, { get() { metadata++; throw Error('Original callable metadata inspected'); },
			apply(target, receiver, args) { assert.equal(receiver, source); loads++; return Reflect.apply(target, receiver, args); } }));
		Reflect.set(source, 'withFrame', new Proxy(decode, { get() { metadata++; throw Error('Decoder callable metadata inspected'); },
			apply(target, receiver, args) { assert.equal(receiver, source); decodes++; return Reflect.apply(target, receiver, args); } }));
		f.hooks.ready = async () => { entered.resolve(); await release.promise; return 'catalog-1'; };
		const port = createPhotoLibraryDevelopSessionV3(f.host); assert.ok(port.original);
		const request = { schemaVersion: 1 as const, photoId: 'photo-1', expectedRevision: ack.snapshot.revision };
		work.value = port.original.withFrame(request, view => [...view.frame.pixels]); await enteredBeforeSettlement(work.value, entered.promise);
		request.photoId = 'other'; request.expectedRevision = 999;
		Reflect.set(source, 'loadOriginal', () => { assert.fail('Replacement original reader acquired'); });
		Reflect.set(source, 'withFrame', () => { assert.fail('Replacement decoder acquired'); });
		Reflect.set(f.host, 'originalSource', { loadOriginal() { assert.fail('Replacement original child acquired'); } });
		release.resolve(); assert.deepEqual(await work.value, [7, 19, 233, 255]); assert.equal(loads, 1); assert.equal(decodes, 1); assert.equal(metadata, 0);
		assert.deepEqual(new Uint8Array(await f.seed.original.arrayBuffer()), PNG);
	} finally { release.resolve(); await Promise.allSettled(work.value ? [work.value] : []); await f.close(); }
});

test('Develop3 retains the true native save ACK through late Close and separate lease cleanup failure', async () => {
	for (const lateClose of [false, true]) {
		const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), save = f.repository.savePhoto;
		f.repository.savePhoto = async function (...args) { const saved = await Reflect.apply(save, f.repository, args); entered.resolve(); await release.promise; return saved; };
		if (!lateClose) f.hooks.afterWriter = async () => { throw Object.freeze({ cleanup: true }); };
		const work: { value?: Promise<unknown> } = {};
		try {
			const port = createPhotoLibraryDevelopSessionV3(f.host), pending = port.apply({ schemaVersion: 3, photoId: 'photo-1', expectedRevision: 0, command: record() });
			work.value = pending; await enteredBeforeSettlement(pending, entered.promise);
			const closing = lateClose ? f.close() : null; if (closing) assert.equal(await remainsPending(closing), true);
			release.resolve(); const ack = await pending; assert.equal(ack.schemaVersion, 3); assert.equal(ack.snapshot.revision, 1);
			assert.deepEqual(ack.snapshot.develop, repaired()); assert.deepEqual(ack.notices, lateClose ? [] : ['cleanup-failed']);
			assert.equal(f.raw.records(f.databaseName, 'photos')[0]?.document.revision, 1); if (closing) await closing;
		} finally { release.resolve(); await Promise.allSettled(work.value ? [work.value] : []); await f.close(); }
	}
});
