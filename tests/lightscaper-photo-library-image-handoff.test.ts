/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from '../src/lightscaper/controller/photo-library-session-ports-v2.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import type { PhotoLibraryImageHandoffViewV1 } from '../src/common/editor/photo-library-image-handoff-port-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV2, normalizePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { parsePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { lutArchiveFixture, LUT_BODY, LUT_REFERENCE } from './helpers/lightscaper-lut-archive-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

async function fixture() {
	const native = mediaRestoreFixture(), source = lutArchiveFixture(), name = `lightscaper-handoff-${crypto.randomUUID()}`;
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, databaseName: `${name}-media`, locks: null, preferOpfs: false });
	const resources = await media.getCubeLutResources();
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, databaseName: `${name}-catalog`, verifyOriginal: media.verifyOriginal,
		verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal) });
	const root = normalizePhotoCatalogRootV1({ ...source.root, revision: 0, photoCount: 0 });
	await catalog.createCatalog(root); await media.mediaRepository.writeAsset(source.record.photo.original.storageKey, source.record.original);
	await resources.put(LUT_REFERENCE, LUT_BODY); await catalog.publishPhotos(root.id, 0, [source.record.photo]);
	await media.mediaRepository.catalogOriginals.retain(root.id, [{ photoId: source.record.photo.id, assetId: source.record.photo.original.storageKey,
		sourceId: source.record.photo.original.id, sha256: source.record.photo.original.contentSha256, size: source.record.original.size }]);
	const calls = { originals: 0, resources: 0, closed: 0 };
	const backup = { readSnapshot: catalog.readSnapshot.bind(catalog), captureSmartCollectionArchiveV1: catalog.captureSmartCollectionArchiveV1.bind(catalog),
		async loadOriginal(original: typeof source.record.photo.original, signal?: AbortSignal) {
			calls.originals++; return media.mediaRepository.loadAsset(original.storageKey, { signal, expectedSize: original.byteLength });
		} };
	const bodySource: CubeLutSourcePortV1 = { withBytes(reference, consume, options) {
		calls.resources++; return resources.source.withBytes(reference, consume, options);
	} };
	const ports: PhotoLibrarySessionPortsV2 = { catalog, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
		journal: media.settingsRepository, backup, cubeLutResources: async () => ({ ...resources, source: bodySource }),
		initialize: async () => (await catalog.loadCatalog(root.id))!, exclusive: async (_id, run, signal) => run(signal),
		async closeResources() { calls.closed++; await Promise.all([catalog.close(), media.close()]); } };
	const request = { catalogId: root.id, photoId: source.record.photo.id, versionId: source.record.photo.activeVersionId, expectedRevision: 0 };
	return { native, source, catalog, media, resources, calls, backup, bodySource, ports, request, name,
		open: () => new PhotoLibrarySessionV2(ports),
		change(photo: unknown) { native.raw(`${name}-catalog`).seedRecord(`${name}-catalog`, 'photos', { key: `${root.id}|${source.record.photo.id}`, document: photo }); } };
}
function capture(session: PhotoLibrarySessionV2) { assert.ok(session.imageHandoff, 'Selected Session must expose the image handoff borrower.'); return session.imageHandoff; }

test('selected actual Session captures unchanged complete saved facts, encoded original and disabled LUT custody', async () => {
	const f = await fixture(), session = f.open(), before = JSON.stringify(await f.catalog.loadPhoto(f.request.catalogId, f.request.photoId));
	try {
		const result = await capture(session).withCapture(f.request, async view => {
			assert.equal(view.schemaVersion, 1); assert.ok(Object.isFrozen(view));
			const facts = parsePhotoExportSidecarV1(view.factsJson);
			assert.equal(facts.photoSchemaVersion, 2); assert.equal(facts.version.develop.processVersion, 2);
			assert.equal(facts.version.develop.effects[0]!.enabled, false); assert.deepEqual(view.lutReferences, [LUT_REFERENCE]);
			assert.deepEqual(view.original, { exactName: f.source.record.photo.original.name, contentSha256: f.source.record.photo.original.contentSha256,
				byteLength: 3, mimeType: 'image/png', width: 1, height: 1, hasAlpha: false });
			assert.deepEqual([...new Uint8Array(await view.originalBlob.arrayBuffer())], [1, 2, 3]);
			await view.withLutBytes(LUT_REFERENCE, bytes => { assert.deepEqual(bytes, LUT_BODY); }); return 'captured';
		});
		assert.equal(result, 'captured'); assert.equal(f.calls.originals, 1); assert.equal(f.calls.resources, 2);
		assert.equal(JSON.stringify(await f.catalog.loadPhoto(f.request.catalogId, f.request.photoId)), before);
	} finally { await session.close(); }
});

test('capture owns caller binding and native capabilities before held reads can mutate them', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), load = f.backup.loadOriginal;
	f.backup.loadOriginal = async function (...args) { assert.equal(this, f.backup); entered.resolve(); await release.promise; return Reflect.apply(load, f.backup, args); };
	const session = f.open(), port = capture(session), request = { ...f.request };
	try {
		const work = port.withCapture(request, async view => { await view.withLutBytes(LUT_REFERENCE, bytes => { assert.deepEqual(bytes, LUT_BODY); }); });
		request.photoId = 'other'; await entered.promise;
		f.backup.loadOriginal = async () => { throw new Error('Replaced original method must not run.'); };
		f.bodySource.withBytes = async () => { throw new Error('Replaced LUT method must not run.'); };
		release.resolve(); await work;
	} finally { release.resolve(); await session.close(); }
});

test('Close joins a held original read and refuses the consumer after generation retirement', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), load = f.backup.loadOriginal;
	f.backup.loadOriginal = async (...args) => { entered.resolve(); await release.promise; return Reflect.apply(load, f.backup, args); };
	const session = f.open(), port = capture(session); let consumers = 0;
	const work = port.withCapture(f.request, () => { consumers++; }); const refusal = assert.rejects(work);
	await entered.promise; const closing = session.close(); await remainsPending(closing); assert.equal(f.calls.closed, 0);
	release.resolve(); await refusal; await closing; assert.equal(consumers, 0); assert.equal(f.calls.closed, 1);
	await assert.rejects(port.withCapture(f.request, () => undefined), /closed/u);
});

test('cancellation joins a held consumer and its native LUT borrower before cleanup', async () => {
	const f = await fixture(), session = f.open(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Object.freeze({ stop: 'capture' });
	let borrowed: Uint8Array | null = null;
	const work = capture(session).withCapture(f.request, async view => {
		await view.withLutBytes(LUT_REFERENCE, async bytes => { borrowed = bytes; entered.resolve(); await release.promise; });
	}, { signal: stop.signal });
	const refusal = assert.rejects(work, value => value === reason);
	try { await entered.promise; stop.abort(reason); await remainsPending(work); const closing = session.close(); await remainsPending(closing);
		release.resolve(); await refusal; await closing; assert.equal(f.calls.closed, 1); assert.ok(borrowed); assert.ok([...borrowed].every(byte => byte === 0));
	} finally { release.resolve(); await session.close(); }
});

test('same revision recipe or metadata mutation during a held body read refuses before delivery', async () => {
	for (const kind of ['recipe', 'metadata'] as const) {
		const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), load = f.backup.loadOriginal;
		f.backup.loadOriginal = async (...args) => { entered.resolve(); await release.promise; return Reflect.apply(load, f.backup, args); };
		const session = f.open(); let consumers = 0;
		try { const work = capture(session).withCapture(f.request, () => { consumers++; }); const refused = assert.rejects(work, /changed/u);
			await entered.promise; const photo = f.source.record.photo, version = photo.versions[0]!;
			f.change(normalizePhotoDocumentV2(kind === 'recipe' ? { ...photo, versions: [{ ...version, develop: { ...version.develop, effects: [] } }] }
				: { ...photo, metadata: { ...photo.metadata, title: 'changed' } }));
			release.resolve(); await refused; assert.equal(consumers, 0);
		} finally { release.resolve(); await session.close(); }
	}
});

test('original and disabled LUT tampering refuse before the scoped consumer', async () => {
	for (const kind of ['original', 'lut'] as const) {
		const f = await fixture();
		if (kind === 'original') f.backup.loadOriginal = async () => new Blob([new Uint8Array([9, 2, 3])], { type: 'image/png' });
		else f.bodySource.withBytes = async (_reference, consume) => consume(new Uint8Array(LUT_BODY.length));
		const session = f.open(); let consumers = 0;
		try { await assert.rejects(capture(session).withCapture(f.request, () => { consumers++; })); assert.equal(consumers, 0); }
		finally { await session.close(); }
	}
});

test('getter, foreign catalog/version, stale revision and native-signal shadows refuse without body reads', async () => {
	const f = await fixture(), session = f.open(); let getters = 0;
	try { const port = capture(session), accessor = Object.defineProperty({ ...f.request }, 'photoId', { enumerable: true, get() { getters++; return f.request.photoId; } });
		for (const bad of [accessor, Object.create(f.request) as typeof f.request, { ...f.request, catalogId: 'other' },
			{ ...f.request, versionId: 'missing' }, { ...f.request, expectedRevision: 1 }, { ...f.request, body: new Blob() }]) await assert.rejects(port.withCapture(bad, () => undefined));
		const signal = Object.defineProperty(new AbortController().signal, 'aborted', { get() { getters++; return false; } });
		await assert.rejects(port.withCapture(f.request, () => undefined, { signal }));
		assert.equal(getters, 0); assert.equal(f.calls.originals, 0); assert.equal(f.calls.resources, 0);
	} finally { await session.close(); }
});

test('retained resource capability is sealed and refuses undeclared references before native IO', async () => {
	const f = await fixture(), session = f.open(); let retained: Readonly<PhotoLibraryImageHandoffViewV1> | undefined;
	try { await capture(session).withCapture(f.request, async view => { retained = view;
		await assert.rejects(view.withLutBytes({ ...LUT_REFERENCE, storageKey: 'foreign' }, () => undefined));
	}); assert.equal(f.calls.resources, 1); await assert.rejects(retained!.withLutBytes(LUT_REFERENCE, () => undefined), /closed/u); }
	finally { await session.close(); }
});

test('a consumer rejection keeps its opaque primary while joining an unawaited held resource read', async () => {
	const f = await fixture(), session = f.open(), entered = deferred<void>(), release = deferred<void>();
	const primary = new Proxy({}, { ownKeys() { throw new Error('Do not inspect the opaque primary.'); } });
	try { const work = capture(session).withCapture(f.request, view => {
		void view.withLutBytes(LUT_REFERENCE, async () => { entered.resolve(); await release.promise; }); throw primary;
	}); const refusal = assert.rejects(work, value => value === primary); await entered.promise; await remainsPending(work);
		release.resolve(); await refusal;
	} finally { release.resolve(); await session.close(); }
});

test('legacy process1 and an inactive saved version retain exact names without acquiring unused LUT authority', async () => {
	const f = await fixture(), photo = f.source.record.photo, version = photo.versions[0]!, exactName = 'Cafe\u0301 original.PNG';
	const develop = { ...version.develop, processVersion: 1, effects: [] };
	f.change(normalizePhotoDocumentV1OrV2({ ...photo, schemaVersion: 1, original: { ...photo.original, name: exactName },
		versions: [{ ...version, develop }, { ...version, id: 'saved-copy', kind: 'virtual-copy', develop }] }));
	const session = f.open();
	try { await capture(session).withCapture({ ...f.request, versionId: 'saved-copy' }, async view => {
		const facts = parsePhotoExportSidecarV1(view.factsJson);
		assert.equal(facts.photoSchemaVersion, 1); assert.equal(facts.version.develop.processVersion, 1);
		assert.equal(facts.version.id, 'saved-copy'); assert.equal(facts.binding.activeVersionId, f.request.versionId);
		assert.equal(view.original.exactName, exactName); assert.equal(facts.original.fileName, exactName);
		assert.deepEqual(view.lutReferences, []); assert.deepEqual([...new Uint8Array(await view.originalBlob.arrayBuffer())], [1, 2, 3]);
	}); assert.equal(f.calls.resources, 0); }
	finally { await session.close(); }
});

test('declared original and aggregate disabled-resource capacity refuses before any body acquisition', async () => {
	for (const kind of ['original', 'resources'] as const) {
		const f = await fixture(), photo = f.source.record.photo, version = photo.versions[0]!;
		const effects = Array.from({ length: 33 }, (_, index) => {
			const sha256 = index.toString(16).padStart(64, '0');
			return { id: `lut-${String(index)}`, type: 'cube-lut-profile-v1', enabled: false,
				params: { lut: { ...LUT_REFERENCE, sha256, storageKey: `lut-sha256:${sha256}`, byteLength: 16_777_216 } } };
		});
		f.change(normalizePhotoDocumentV2(kind === 'original' ? { ...photo, original: { ...photo.original, byteLength: 67_108_865 } }
			: { ...photo, versions: [{ ...version, develop: { ...version.develop, effects } }] }));
		const session = f.open();
		try { await assert.rejects(capture(session).withCapture(f.request, () => undefined), /capacity/u);
			assert.equal(f.calls.originals, 0); assert.equal(f.calls.resources, 0);
		} finally { await session.close(); }
	}
});

test('complete facts are rechecked after a held consumer, including inactive history and revision', async () => {
	for (const kind of ['inactive-version', 'revision'] as const) {
		const f = await fixture(), session = f.open(), entered = deferred<void>(), release = deferred<void>();
		try { const work = capture(session).withCapture(f.request, async view => { assert.ok(view.signal instanceof AbortSignal); entered.resolve(); await release.promise; });
			const refusal = assert.rejects(work, /changed/u); await entered.promise; const photo = f.source.record.photo;
			f.change(normalizePhotoDocumentV2(kind === 'revision' ? { ...photo, revision: 1 }
				: { ...photo, versions: [...photo.versions, { ...photo.versions[0]!, id: 'new-saved-copy', kind: 'virtual-copy' }] }));
			release.resolve(); await refusal;
		} finally { release.resolve(); await session.close(); }
	}
});

test('opaque consumer and borrowed resource failures remain distinct after both joined lifetimes', async () => {
	const f = await fixture(), session = f.open(), entered = deferred<void>(), release = deferred<void>();
	const primary = new Proxy({}, { ownKeys() { throw new Error('Do not reflect primary.'); } });
	const resource = new Proxy({}, { ownKeys() { throw new Error('Do not reflect resource failure.'); } });
	try { const work = capture(session).withCapture(f.request, view => {
		void view.withLutBytes(LUT_REFERENCE, async () => { entered.resolve(); await release.promise; throw resource; }); throw primary;
	}); const refusal = assert.rejects(work, error => error instanceof AggregateError && error.cause === primary
		&& error.errors.length === 2 && error.errors[0] === primary && error.errors[1] === resource);
		await entered.promise; await remainsPending(work); release.resolve(); await refusal;
	} finally { release.resolve(); await session.close(); }
});

test('genuine original Blob subclasses cannot override intrinsic bytes or invoke media getters', async () => {
	const f = await fixture(); let getters = 0;
	class EncodedOriginal extends Blob {
		override get size() { getters++; return 0; }
		override get type() { getters++; return 'invalid'; }
		override slice(): Blob { throw new Error('Do not invoke overridden media slicing.'); }
		override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Do not invoke overridden media reading.'); }
	}
	f.backup.loadOriginal = async () => new EncodedOriginal([new Uint8Array([1, 2, 3])], { type: 'image/png' });
	const session = f.open();
	try { await capture(session).withCapture(f.request, async view => {
		assert.equal(Object.getPrototypeOf(view.originalBlob), Blob.prototype);
		assert.deepEqual([...new Uint8Array(await view.originalBlob.arrayBuffer())], [1, 2, 3]);
	}); assert.equal(getters, 0); }
	finally { await session.close(); }
});

test('the final complete-facts read preserves an opaque native repository refusal', async () => {
	const f = await fixture(), load = f.catalog.loadPhoto;
	const primary = new Proxy({}, { ownKeys() { throw new Error('Do not inspect a repository refusal.'); } });
	let reads = 0, consumers = 0;
	f.catalog.loadPhoto = async (...args) => { if (++reads === 3) throw primary; return Reflect.apply(load, f.catalog, args); };
	const session = f.open();
	try { await assert.rejects(capture(session).withCapture(f.request, () => { consumers++; }), error => error === primary);
		assert.equal(reads, 3); assert.equal(consumers, 1);
	} finally { await session.close(); }
});

test('overlapping LUT borrowers refuse before native acquisition while the admitted read remains joined', async () => {
	const f = await fixture(), session = f.open(), entered = deferred<void>(), release = deferred<void>();
	try { await capture(session).withCapture(f.request, async view => {
		const first = view.withLutBytes(LUT_REFERENCE, async () => { entered.resolve(); await release.promise; });
		await entered.promise;
		try { await assert.rejects(view.withLutBytes(LUT_REFERENCE, () => undefined)); assert.equal(f.calls.resources, 2); }
		finally { release.resolve(); await first; }
		await view.withLutBytes(LUT_REFERENCE, bytes => { assert.deepEqual(bytes, LUT_BODY); }); assert.equal(f.calls.resources, 3);
	}); } finally { release.resolve(); await session.close(); }
});

test('a LUT source that omits delivery cannot authenticate a disabled recipe resource', async () => {
	const f = await fixture(); let consumers = 0;
	f.bodySource.withBytes = async () => undefined as never;
	const session = f.open();
	try { await assert.rejects(capture(session).withCapture(f.request, () => { consumers++; }), /deliver/u); assert.equal(consumers, 0); }
	finally { await session.close(); }
});

test('selected LUT method admission refuses an accessor without invoking it or reading the original', async () => {
	const f = await fixture(); let getters = 0;
	Object.defineProperty(f.bodySource, 'withBytes', { enumerable: true, get() { getters++; return f.resources.source.withBytes; } });
	const session = f.open();
	try { await assert.rejects(capture(session).withCapture(f.request, () => undefined));
		assert.equal(getters, 0); assert.equal(f.calls.originals, 0);
	} finally { await session.close(); }
});

test('a transport that ignores its callback result still joins the held authenticated borrower', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	f.bodySource.withBytes = async (_reference, consume) => { void Promise.resolve(consume(LUT_BODY)); return undefined as never; };
	const session = f.open();
	try { const work = capture(session).withCapture(f.request, view => {
		void view.withLutBytes(LUT_REFERENCE, async bytes => { assert.deepEqual(bytes, LUT_BODY); entered.resolve(); await release.promise; }); return 'joined';
	}); await entered.promise; await remainsPending(work); release.resolve(); assert.equal(await work, 'joined');
		assert.ok(LUT_BODY.some(byte => byte !== 0));
	} finally { release.resolve(); await session.close(); }
});

test('a second body delivery refuses before invoking the captured view consumer', async () => {
	const f = await fixture(); let consumers = 0;
	f.bodySource.withBytes = async (_reference, consume) => { await consume(LUT_BODY); return consume(LUT_BODY); };
	const session = f.open();
	try { await assert.rejects(capture(session).withCapture(f.request, () => { consumers++; }), /exactly one/u); assert.equal(consumers, 0); }
	finally { await session.close(); }
});

test('transport failure joins a held borrower and retains both distinct opaque refusals', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); let reads = 0;
	const transport = new Proxy({}, { ownKeys() { throw new Error('Do not reflect transport refusal.'); } });
	const borrower = new Proxy({}, { ownKeys() { throw new Error('Do not reflect borrower refusal.'); } });
	f.bodySource.withBytes = async (_reference, consume) => {
		const work = consume(LUT_BODY); if (++reads === 1) return work; void Promise.resolve(work); throw transport;
	};
	const session = f.open();
	try { const work = capture(session).withCapture(f.request, view => view.withLutBytes(LUT_REFERENCE, async () => {
		entered.resolve(); await release.promise; throw borrower;
	})); const refusal = assert.rejects(work, error => error instanceof AggregateError && error.cause === transport
		&& error.errors[0] === transport && error.errors[1] === borrower);
		await entered.promise; await remainsPending(work); release.resolve(); await refusal;
	} finally { release.resolve(); await session.close(); }
});

test('a source-retained callback cannot reenter body admission from the authenticated borrower', async () => {
	const f = await fixture(), retained: { invoke: ((bytes: Uint8Array<ArrayBuffer>) => unknown) | null } = { invoke: null };
	f.bodySource.withBytes = async (_reference, consume) => { retained.invoke = consume; return consume(LUT_BODY); };
	const session = f.open(); let deliveries = 0;
	try { const result = await capture(session).withCapture(f.request, view => view.withLutBytes(LUT_REFERENCE, bytes => {
		assert.deepEqual(bytes, LUT_BODY); deliveries++;
		if (deliveries === 1) { assert.ok(retained.invoke); assert.throws(() => retained.invoke!(LUT_BODY), /exactly one/u); }
		return 'kept';
	})); assert.equal(result, 'kept'); assert.equal(deliveries, 1); assert.ok(LUT_BODY.some(byte => byte !== 0)); }
	finally { await session.close(); }
});
