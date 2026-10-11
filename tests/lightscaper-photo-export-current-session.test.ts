/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { PhotoLibrarySessionCurrentV1 } from '../src/lightscaper/controller/photo-library-session-current-v1.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from '../src/lightscaper/controller/photo-library-session-ports-current-v1.ts';
import type { PhotoLibraryExportJournalPort, PhotoLibraryExportJournalSettings, ReadPhotoExportSidecar } from '../src/common/editor/photo-library-session-port-v2.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1, parsePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { createPhotoExportSidecarV2, normalizePhotoExportSidecarV2, parsePhotoExportSidecarV2, serializePhotoExportSidecarV2 } from '../src/lightscaper/catalog/photo-export-sidecar-v2.ts';
import { createPhotoExportSidecarCurrentV1, normalizePhotoExportSidecarCurrentV1, parsePhotoExportSidecarCurrentV1, serializePhotoExportSidecarCurrentV1 } from '../src/lightscaper/catalog/photo-export-sidecar-current-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { verifyPhotoResourcesCurrentV1 } from '../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { capturePhotoRasterExportBatchV1 } from '../src/lightscaper/controller/photo-raster-export-batch-v1.ts';
import { createPhotoRasterExportJournalV1, photoRasterExportJournalKeyV1 } from '../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
import { PhotoRasterExportJournalOwnerV1 } from '../src/lightscaper/storage/photo-raster-export-journal-owner-v1.ts';
import { request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

// Initial RED exercised the unchanged public Current Session, without future
// value imports. Direct reader controls were added after those owners qualified.
type CurrentExportSession = PhotoLibrarySessionCurrentV1 & {
	readonly readExportSidecarCurrent: ReadPhotoExportSidecar;
	readonly exportJournalCurrent: Readonly<PhotoLibraryExportJournalPort>;
};
const priorRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (priorRange) Object.defineProperty(globalThis, 'IDBKeyRange', priorRange); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const TIME = '2026-10-12T00:00:00.000Z';
const observe = <Value>(work: Promise<Value>) => work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
function current(session: PhotoLibrarySessionCurrentV1): CurrentExportSession {
	assert.equal(typeof (session as Partial<CurrentExportSession>).readExportSidecarCurrent, 'function');
	assert.ok((session as Partial<CurrentExportSession>).exportJournalCurrent);
	return session as CurrentExportSession;
}

async function fixture(active: 'repair' | 'legacy1' | 'legacy2' = 'legacy1', legacy = false) {
	const native = mediaRestoreFixture(), mediaName = `lightscaper-current-export-${crypto.randomUUID()}`;
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, databaseName: mediaName, preferOpfs: false, locks: null });
	const cleanup: { catalog?: PhotoCatalogRepositoryCurrentV1 } = {};
	try {
		await media.ready();
		const brushes = await media.getMaskRasterResources(), luts = await media.getCubeLutResources();
		const brush = await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(64, 192) }, value => ({ reference: value.reference, bytes: value.bytes.slice() }));
		const unused = await withPreparedBrushMaskResourceV1({ width: 1, height: 1, alpha: Uint8Array.of(137) }, value => ({ reference: value.reference, bytes: value.bytes.slice() }));
		await brushes.put(brush.reference, brush.bytes); await brushes.put(unused.reference, unused.bytes);
		const lut = (await luts.importFile(new Blob(['LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1\n']))).reference;
		const input = photoArchiveFixture(), original = input.original, base = input.photo.versions[0]!;
		const legacy2 = normalizePhotoDocumentV2({ ...input.photo, schemaVersion: 2, versions: [{ ...base, develop: { ...base.develop, processVersion: 2 } }] }).versions[0]!.develop;
		const repair = replaceImageDevelopRepairSpotsV1({ ...base.develop, processVersion: 2,
			effects: [{ id: 'retained-profile', type: 'cube-lut-profile-v1', enabled: false, params: { lut } }],
			masks: [{ schemaVersion: 2, id: 'brush', name: 'Retained matte', kind: 'matte', inputs: [
				{ name: 'Paint', sourceRef: brush.reference.storageKey, kind: 'raster' }, { name: 'Unused', sourceRef: unused.reference.storageKey, kind: 'raster' }],
				nodes: [{ id: 'out', kind: 'raster', inputName: 'Paint', channel: 'alpha' }], outputNodeId: 'out' }], maskBindings: [] },
		{ schemaVersion: 1, spots: [{ id: 'clone', mode: 'clone', enabled: true, target: { x: 0.75, y: 0.5 }, source: { x: 0.25, y: 0.5 }, radius: 0.1, feather: 0.5, opacity: 1 },
			{ id: 'heal', mode: 'heal', enabled: false, target: { x: 0.5, y: 0.5 }, source: { x: 0, y: 0 }, radius: 0.2, feather: 0, opacity: 0.5 }] });
		const selected = active === 'repair' ? repair : active === 'legacy2' ? legacy2 : base.develop;
		const photo = normalizePhotoDocumentCurrentV1(legacy ? active === 'legacy2' ? { ...input.photo, schemaVersion: 2, versions: [{ ...base, develop: legacy2 }] } : input.photo : {
			...input.photo, schemaVersion: 3, metadata: { ...input.photo.metadata, title: 'Complete repaired source' }, versions: [{ ...base, develop: selected,
				workspace: { schemaVersion: 3, kind: 'photo-develop-workspace', entries: [{ label: 'Selected', createdAt: TIME, develop: selected },
					{ label: 'Retained redo', createdAt: TIME, develop: repair }], cursor: 0, snapshots: [{ id: 'retained', name: 'Retained repair', createdAt: TIME, develop: repair }] } },
			{ ...base, id: 'inactive', kind: 'virtual-copy', name: 'Inactive repaired copy', develop: repair }] });
		const hooks = { initialize: async (): Promise<void> => undefined, original: async (): Promise<Blob | undefined> => undefined,
			verified: async (): Promise<void> => undefined, insert: async (): Promise<void> => undefined };
		const calls = { initialized: 0, originals: 0, verified: 0, closed: false };
		const resourceHost = { cubeLutResources: () => media.getCubeLutResources(), maskRasterResources: () => media.getMaskRasterResources() };
		const verify = async (value: unknown, signal?: AbortSignal) => {
			await verifyPhotoResourcesCurrentV1(value, resourceHost, signal); calls.verified++; await hooks.verified();
		};
		const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, databaseName: `current-export-${crypto.randomUUID()}`,
			verifyOriginal: media.verifyOriginal, verifyResources: verify });
		cleanup.catalog = catalog;
		await catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: photo.catalogId, name: 'Current export', revision: 0,
			photoCount: 0, folders: [], keywords: [], collections: [] });
		const metadata = await media.mediaRepository.writeAsset(photo.original.storageKey, original);
		await media.mediaRepository.catalogOriginals.stage(photo.catalogId, 'seed', [{ photoId: photo.id, sourceId: photo.original.id, assetId: metadata.sourceId, sha256: metadata.sha256, size: metadata.size }]);
		await catalog.publishPhotos(photo.catalogId, 0, [photo]); await media.mediaRepository.catalogOriginals.promote(photo.catalogId, 'seed', [photo.id]);
		const nativeSettings = media.settingsRepository;
		const settings: PhotoLibraryExportJournalSettings = { get: nativeSettings.get.bind(nativeSettings),
			async putIfAbsent(key, value) { assert.equal(this, settings); const ack = await nativeSettings.putIfAbsent(key, value); await hooks.insert(); return ack; },
			replaceIfCurrent: nativeSettings.replaceIfCurrent.bind(nativeSettings), deleteIfCurrent: nativeSettings.deleteIfCurrent.bind(nativeSettings) };
		const backup: NonNullable<PhotoLibrarySessionPortsCurrentV1['backup']> = { readSnapshot: catalog.readSnapshot.bind(catalog),
			captureSmartCollectionArchiveV1: catalog.captureSmartCollectionArchiveV1.bind(catalog), async loadOriginal(value) {
				assert.equal(this, backup); calls.originals++; return await hooks.original() ?? media.mediaRepository.loadAsset(value.storageKey);
			} };
		const ports: PhotoLibrarySessionPortsCurrentV1 = { catalog, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
			journal: nativeSettings, exportJournalSettings: settings, backup, verifyResources: verify,
			cubeLutResources: () => media.getCubeLutResources(), maskRasterResources: () => media.getMaskRasterResources(),
			exclusive: async (_id, run, signal) => run(signal),
			async initialize() { assert.equal(this, ports); calls.initialized++; await hooks.initialize(); const root = await catalog.loadCatalog(photo.catalogId); assert.ok(root); return root; },
			async closeResources() { calls.closed = true; await Promise.all([catalog.close(), media.close()]); } };
		const binding = { catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision };
		const session = new PhotoLibrarySessionCurrentV1(ports);
		async function removeBody(key: string) { const db = await request(native.factory.open(mediaName));
			try { await transact(db, 'analysis', 'readwrite', stores => request(stores.analysis!.delete(key))); } finally { db.close(); } }
		return { native, media, catalog, photo, repair, legacy2, brush, unused, lut, hooks, calls, settings, nativeSettings, ports, session, binding, removeBody };
	} catch (error) { await Promise.allSettled([media.close(), ...(cleanup.catalog ? [cleanup.catalog.close()] : [])]); throw error; }
}

for (const active of ['repair', 'legacy1', 'legacy2'] as const) test(`Current Session emits Sidecar2 from complete Photo3 with ${active} selected`, async () => {
	const f = await fixture(active);
	try { const before = await f.catalog.loadPhoto(f.photo.catalogId, f.photo.id), text = await current(f.session).readExportSidecarCurrent(f.binding, { signal: new AbortController().signal });
		const expected = { schemaFamily: 'lightscaper', schemaVersion: 2, kind: 'photo-export-sidecar', photoSchemaVersion: 3,
			binding: { catalogId: f.photo.catalogId, photoId: f.photo.id, revision: f.photo.revision, activeVersionId: f.photo.activeVersionId },
			original: { fileName: f.photo.original.name, contentSha256: f.photo.original.contentSha256, byteLength: f.photo.original.byteLength },
			version: { id: f.photo.versions[0]!.id, kind: f.photo.versions[0]!.kind, name: f.photo.versions[0]!.name,
				createdAt: f.photo.versions[0]!.createdAt, develop: f.photo.versions[0]!.develop }, metadata: f.photo.metadata, extractedMetadata: f.photo.extractedMetadata };
		assert.deepEqual(JSON.parse(text), expected); assert.throws(() => parsePhotoExportSidecarV1(text));
		assert.deepEqual(await f.catalog.loadPhoto(f.photo.catalogId, f.photo.id), before); assert.equal(f.calls.originals, 0);
	} finally { await f.session.close(); }
});

for (const active of ['legacy1', 'legacy2'] as const) test(`Current sidecar preserves exact permanent Sidecar1 bytes for genuine ${active}`, async () => {
	const f = await fixture(active, true);
	try { const expected = serializePhotoExportSidecarV1(createPhotoExportSidecarV1(f.photo, f.binding));
		assert.equal(await current(f.session).readExportSidecarCurrent(f.binding, { signal: new AbortController().signal }), expected);
		assert.equal(await f.session.readExportSidecar(f.binding), expected);
	} finally { await f.session.close(); }
});

test('permanent legacy sidecar and journal refuse full Photo3 even when its selected recipe is legacy', async () => {
	const f = await fixture();
	try { await assert.rejects(f.session.readExportSidecar(f.binding)); assert.throws(() => createPhotoExportSidecarV1(f.photo, f.binding));
		assert.ok(f.session.exportJournal); const access = await f.session.exportJournal.open(); await assert.rejects(access.verifyResources(f.binding));
		assert.equal(f.calls.originals, 0);
	} finally { await f.session.close(); }
});

test('Current sidecar admits closed identity before readiness and native preabort wins hostile request reflection', async () => {
	const f = await fixture(), signal = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); signal.abort(reason.proxy); let reflected = 0;
	try { const read = current(f.session).readExportSidecarCurrent.bind(f.session);
		const requestValue = new Proxy({ ...f.binding }, { ownKeys() { reflected++; throw Error('Late caller reflection'); } });
		const result = await observe(read(requestValue, { signal: signal.signal })); assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.error === reason.proxy, true); assert.equal(reflected, 0); assert.equal(f.calls.initialized, 0);
		for (const value of [{ ...f.binding, extra: true }, { ...f.binding, expectedRevision: -1 }, Object.defineProperty({ ...f.binding }, 'photoId', { get() { reflected++; return f.photo.id; } })]) {
			await assert.rejects(read(value, { signal: new AbortController().signal }));
		} assert.equal(reflected, 0); assert.equal(f.calls.initialized, 0);
	} finally { await f.session.close(); }
});

test('Current sidecar snapshots request and native catalog receiver before held readiness', async () => {
	const f = await fixture('repair'), entered = deferred<void>(), release = deferred<void>(), cell: { work?: Promise<unknown> } = {};
	f.hooks.initialize = async () => { entered.resolve(); await release.promise; };
	try { const port = current(f.session), binding = { ...f.binding }, work = observe(port.readExportSidecarCurrent(binding, { signal: new AbortController().signal })); cell.work = work;
		binding.versionId = 'caller-mutated'; assert.equal(await Promise.race([entered.promise.then(() => true), work.then(() => false)]), true);
		Object.defineProperty(f.catalog, 'loadPhoto', { configurable: true, get() { assert.fail('Replaced native method reflected'); } });
		release.resolve(); const result = await work; assert.equal(result.ok, true);
		if (result.ok) assert.deepEqual((JSON.parse(result.value) as { version: { develop: unknown } }).version.develop, f.repair);
	} finally { release.resolve(); await cell.work; await f.session.close(); }
});

test('Current sidecar Close joins a held admitted load before resource cleanup and rejects its late result', async context => {
	const next = await fixture('repair'), entered = deferred<void>(), release = deferred<void>();
	// Construct after the held native method is installed so actual Session capture owns it.
	const originalLoad = next.catalog.loadPhoto;
	context.mock.method(next.catalog, 'loadPhoto', async function (this: typeof next.catalog, ...args: Parameters<typeof originalLoad>) {
		entered.resolve(); await release.promise; return Reflect.apply(originalLoad, this, args);
	});
	const session = new PhotoLibrarySessionCurrentV1(next.ports), cell: { work?: Promise<unknown> } = {};
	try { const work = observe(current(session).readExportSidecarCurrent(next.binding, { signal: new AbortController().signal })); cell.work = work;
		assert.equal(await Promise.race([entered.promise.then(() => true), work.then(() => false)]), true);
		const close = session.close(); assert.equal(session.close(), close); assert.equal(await remainsPending(close), true); assert.equal(next.calls.closed, false);
		release.resolve(); const result = await work; assert.equal(result.ok, false); await close; assert.equal(next.calls.closed, true);
	} finally { release.resolve(); await cell.work; await session.close(); await next.session.close(); }
});

test('Current journal authenticates complete retained LUT and unused brush bodies through independent selected slots', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), cell: { borrow?: Promise<unknown> } = {};
	try { const access = await current(f.session).exportJournalCurrent.open(), before = await f.catalog.loadPhoto(f.photo.catalogId, f.photo.id);
		const resources = await f.media.getMaskRasterResources(), borrow = observe(resources.source.withBytes(f.brush.reference, async bytes => {
			assert.deepEqual(bytes, f.brush.bytes); entered.resolve(); await release.promise;
		})); cell.borrow = borrow;
		assert.equal(await Promise.race([entered.promise.then(() => true), borrow.then(() => false)]), true);
		const verifiedBefore = f.calls.verified; await access.verifyResources(f.binding); assert.equal(f.calls.verified, verifiedBefore + 1);
		assert.equal(f.calls.originals, 1); assert.equal(await remainsPending(borrow), true);
		assert.deepEqual(await f.catalog.loadPhoto(f.photo.catalogId, f.photo.id), before);
	} finally { release.resolve(); await cell.borrow; await f.session.close(); }
});

test('Current journal rejects a missing unused retained brush and mismatched Original bytes', async () => {
	const f = await fixture();
	try { const access = await current(f.session).exportJournalCurrent.open();
		await f.removeBody(f.unused.reference.storageKey); await assert.rejects(access.verifyResources(f.binding));
		await (await f.media.getMaskRasterResources()).put(f.unused.reference, f.unused.bytes);
		// The captured original capability cannot be substituted after opening.
		Object.defineProperty(f.ports.backup!, 'loadOriginal', { configurable: true, get() { assert.fail('Replaced original owner reflected'); } });
		await access.verifyResources(f.binding); f.hooks.original = async () => new Blob([Uint8Array.of(3, 2, 1)]);
		await assert.rejects(access.verifyResources(f.binding), /hash/iu);
	} finally { await f.session.close(); }
});

test('Current journal rejects stale catalog/photo/version/revision and a change during complete resource verification', async () => {
	const f = await fixture('repair');
	try { const access = await current(f.session).exportJournalCurrent.open();
		for (const delta of [{ catalogId: 'other' }, { photoId: 'missing' }, { versionId: 'missing' }, { expectedRevision: 1 }]) await assert.rejects(access.verifyResources({ ...f.binding, ...delta }));
		const before = await f.catalog.loadPhoto(f.photo.catalogId, f.photo.id); assert.ok(before);
		f.hooks.verified = async () => { f.hooks.verified = async () => undefined; await f.catalog.savePhoto({ ...before, metadata: { ...before.metadata, title: 'Changed during export' } }, before.revision); };
		await assert.rejects(access.verifyResources(f.binding));
	} finally { await f.session.close(); }
});

function journal(f: Awaited<ReturnType<typeof fixture>>) {
	const plan = capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId: 'current-batch', format: 'png', filenameTemplate: '{name}',
		members: [{ photoId: f.photo.id, versionId: f.photo.activeVersionId, expectedRevision: f.photo.revision, sourceFileName: f.photo.original.name }] });
	return createPhotoRasterExportJournalV1(plan, { catalogId: f.photo.catalogId, filenameTemplate: '{name}',
		bindings: [{ originalSha256: f.photo.original.contentSha256, recipeSha256: 'a'.repeat(64), lutSha256: [f.lut.sha256] }] });
}
test('Current journal keeps scalar V1 wire, selected-key CAS, exact readback and durable reopen', async () => {
	const f = await fixture(), owners: PhotoRasterExportJournalOwnerV1[] = [];
	try { const access = await current(f.session).exportJournalCurrent.open(), key = photoRasterExportJournalKeyV1(f.photo.catalogId), value = journal(f);
		await assert.rejects(access.settings.putIfAbsent('foreign-key', value)); await assert.rejects(access.settings.putIfAbsent(key, { ...value, catalogId: 'foreign' }));
		const owner = new PhotoRasterExportJournalOwnerV1(access.settings, f.photo.catalogId); owners.push(owner); await owner.create(value); await owner.started('current-batch:1');
		const second = new PhotoRasterExportJournalOwnerV1((await current(f.session).exportJournalCurrent.open()).settings, f.photo.catalogId); owners.push(second);
		assert.deepEqual((await second.load())?.members.map(member => member.state), ['started']);
		await owner.committed('current-batch:1', { status: 'download-started', method: 'download', fileName: f.photo.original.name, size: 5 });
		await assert.rejects(second.started('current-batch:1', true)); assert.equal((await f.nativeSettings.get(key) as { schemaVersion: number }).schemaVersion, 1);
	} finally { await Promise.all(owners.map(owner => owner.closeAndJoin())); await f.session.close(); }
});

test('Current journal native CAS acknowledgement survives late cancellation while Close joins the actual store', async () => {
	const f = await fixture(), stop = new AbortController(), reason = Symbol('after-native-ACK'), entered = deferred<void>(), release = deferred<void>(), cell: { work?: Promise<unknown> } = {};
	try { const access = await current(f.session).exportJournalCurrent.open({ signal: stop.signal }), key = photoRasterExportJournalKeyV1(f.photo.catalogId), value = journal(f);
		f.hooks.insert = async () => { stop.abort(reason); entered.resolve(); await release.promise; };
		const work = observe(access.settings.putIfAbsent(key, value)); cell.work = work;
		assert.equal(await Promise.race([entered.promise.then(() => true), work.then(() => false)]), true);
		assert.deepEqual(await f.nativeSettings.get(key), value); const close = f.session.close(); assert.equal(await remainsPending(close), true); assert.equal(f.calls.closed, false);
		release.resolve(); const result = await work; assert.equal(result.ok, true); if (result.ok) assert.equal(result.value, true); await close;
	} finally { release.resolve(); await cell.work; await f.session.close(); }
});

test('Current journal held verifier joins native cancellation and Close without replacing the first opaque reason', async () => {
	const f = await fixture(), stop = new AbortController(), reason = Proxy.revocable({}, {}), entered = deferred<void>(), release = deferred<void>(), cell: { work?: Promise<unknown> } = {};
	reason.revoke();
	try { const access = await current(f.session).exportJournalCurrent.open(); f.hooks.verified = async () => { entered.resolve(); await release.promise; };
		const work = observe(access.verifyResources(f.binding, { signal: stop.signal })); cell.work = work;
		assert.equal(await Promise.race([entered.promise.then(() => true), work.then(() => false)]), true); stop.abort(reason.proxy);
		const close = f.session.close(); assert.equal(await remainsPending(close), true); assert.equal(f.calls.closed, false);
		release.resolve(); const result = await work; assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error === reason.proxy, true); await close;
	} finally { release.resolve(); await cell.work; await f.session.close(); }
});

for (const active of ['repair', 'legacy1', 'legacy2'] as const) test(`strict Sidecar2 readers detach and canonically retain full Photo3 provenance with ${active} selected`, async () => {
	const f = await fixture(active);
	try {
		const expected = createPhotoExportSidecarV2(f.photo, f.binding), input = structuredClone(expected), admitted = normalizePhotoExportSidecarV2(input);
		assert.equal(admitted.schemaVersion, 2); assert.equal(admitted.photoSchemaVersion, 3);
		assert.deepEqual(admitted.version.develop, f.photo.versions[0]!.develop);
		assert.ok(Object.isFrozen(admitted)); assert.ok(Object.isFrozen(admitted.binding)); assert.ok(Object.isFrozen(admitted.version.develop));
		Reflect.set(input.version, 'name', 'Caller changed');
		if (input.version.develop.processVersion === 3) Reflect.set(input.version.develop.repairs.spots[0]!.target, 'x', 0.9);
		assert.deepEqual(admitted, expected);
		const text = serializePhotoExportSidecarV2(admitted);
		assert.deepEqual(parsePhotoExportSidecarV2(text), expected); assert.equal(serializePhotoExportSidecarV2(parsePhotoExportSidecarV2(text)), text);
		assert.deepEqual(createPhotoExportSidecarCurrentV1(f.photo, f.binding), expected);
		assert.equal(serializePhotoExportSidecarCurrentV1(parsePhotoExportSidecarCurrentV1(text)), text);
		assert.throws(() => createPhotoExportSidecarV2(photoArchiveFixture().photo, f.binding));
	} finally { await f.session.close(); }
});

test('Sidecar2 and Current readers enforce paired wire/photo/process versions and strict retained repair admission', async () => {
	const f = await fixture('repair');
	try {
		const packet = createPhotoExportSidecarV2(f.photo, f.binding), missing = { ...packet.version.develop }; Reflect.deleteProperty(missing, 'repairs');
		const malformed: unknown[] = [
			{ ...packet, photoSchemaVersion: 1 }, { ...packet, photoSchemaVersion: 2 }, { ...packet, schemaVersion: 1 }, { ...packet, schemaVersion: 3 },
			{ ...packet, schemaFamily: 'framescaper' }, { ...packet, photoSchemaVersion: 4 },
			{ ...packet, version: { ...packet.version, develop: missing } },
			{ ...packet, version: { ...packet.version, develop: { ...packet.version.develop, processVersion: 4 } } },
			{ ...packet, version: { ...packet.version, develop: { ...packet.version.develop, repairs: { schemaVersion: 1, spots: [{ id: 'bad', mode: 'smudge' }] } } } },
			{ ...packet, version: { ...packet.version, develop: { ...packet.version.develop, repairs: { schemaVersion: 1, spots: [{ id: 'bad', mode: 'clone', enabled: false,
				target: { x: 0, y: 0 }, source: { x: 0, y: 0 }, radius: 0.1, feather: 0, opacity: 2 }] } } } },
		];
		for (const value of malformed) { assert.throws(() => normalizePhotoExportSidecarV2(value)); assert.throws(() => parsePhotoExportSidecarCurrentV1(JSON.stringify(value))); }
		const legacy = photoArchiveFixture(), binding = { ...f.binding, photoId: legacy.photo.id, versionId: legacy.photo.activeVersionId, expectedRevision: legacy.photo.revision };
		const old = createPhotoExportSidecarV1(legacy.photo, binding), oldText = serializePhotoExportSidecarV1(old);
		assert.throws(() => normalizePhotoExportSidecarV2(old)); assert.throws(() => parsePhotoExportSidecarV2(oldText));
		assert.equal(serializePhotoExportSidecarCurrentV1(normalizePhotoExportSidecarCurrentV1(old)), oldText);
		assert.equal(parsePhotoExportSidecarCurrentV1(oldText).schemaVersion, 1);
		assert.throws(() => parsePhotoExportSidecarCurrentV1(JSON.stringify({ ...old, photoSchemaVersion: 2, version: { ...old.version, develop: f.repair } })));
	} finally { await f.session.close(); }
});

test('Sidecar2 closed scalar readers reject getters, symbols, inherited records and output/body authority without invoking hooks', async () => {
	const f = await fixture('repair'); let reads = 0;
	try {
		const packet = createPhotoExportSidecarV2(f.photo, f.binding), accessor = (value: object, key: string) => Object.defineProperty({ ...value }, key,
			{ enumerable: true, get() { reads++; throw Error('Getter must remain inert'); } });
		const inherited: unknown = Object.assign(Object.create({ inherited: true }) as object, packet);
		for (const value of [accessor(packet, 'schemaVersion'), accessor(packet, 'metadata'), { ...packet, [Symbol('foreign')]: true }, inherited,
			{ ...packet, output: { sizing: { kind: 'original' } } }, { ...packet, original: { ...packet.original, storageKey: 'original-body-authority' } },
			{ ...packet, version: accessor(packet.version, 'id') }, { ...packet, version: { ...packet.version, develop: accessor(packet.version.develop, 'processVersion') } }]) {
			assert.throws(() => normalizePhotoExportSidecarV2(value)); assert.throws(() => normalizePhotoExportSidecarCurrentV1(value));
		}
		assert.equal(reads, 0);
	} finally { await f.session.close(); }
});

test('Sidecar2 JSON readers admit the exact 2 MiB boundary and refuse larger UTF8 or coercion before parsing', async () => {
	const f = await fixture('repair'); let coerced = 0;
	try {
		const packet = createPhotoExportSidecarV2(f.photo, f.binding), text = serializePhotoExportSidecarV2(packet);
		const padded = text + ' '.repeat(2_097_152 - new TextEncoder().encode(text).byteLength);
		assert.deepEqual(parsePhotoExportSidecarV2(padded), packet);
		for (const parse of [parsePhotoExportSidecarV2, parsePhotoExportSidecarCurrentV1]) {
			assert.throws(() => parse(`${padded} `), /byte budget/u);
			assert.throws(() => parse(`"${'é'.repeat(1_048_576)}"`), /byte budget/u);
			assert.throws(() => parse({ toString() { coerced++; return text; } } as unknown as string));
			assert.throws(() => parse('{'));
		}
		assert.equal(coerced, 0);
	} finally { await f.session.close(); }
});
