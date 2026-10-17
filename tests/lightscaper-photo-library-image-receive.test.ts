/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createHash } from 'node:crypto';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from '../src/lightscaper/controller/photo-library-session-ports-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1OrV2, serializePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { resolvePhotoImportKeywordsV1 } from '../src/lightscaper/controller/photo-library-import-keywords-v1.ts';
import { exportPhotoFramescaperHandoffArchiveV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-archive-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { LUT_BODY, LUT_REFERENCE, rewriteLutArchiveFixture } from './helpers/lightscaper-lut-archive-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { iptcText, jpegFixture, jpegSegment, joinBytes, photoshopIptc } from './helpers/image-metadata-fixtures.ts';
import { LIGHTSCAPER_CATALOG_LIMITS } from '../src/lightscaper/catalog/types.ts';

const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const PIXELS = Uint8Array.of(23, 71, 149, 255), TIME = '2026-10-10T00:00:00.000Z';
const prior = new Map(['IDBKeyRange', 'ImageDecoder', 'createImageBitmap', 'OffscreenCanvas'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
Object.defineProperty(globalThis, 'ImageDecoder', { configurable: true, value: undefined });
let nativePixels = PIXELS, nativeGate: (() => Promise<void>) | null = null, nativeCloses = 0;
Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => {
	await nativeGate?.(); return { width: 1, height: 1, close() { nativeCloses++; } };
} });
Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class {
	constructor(readonly width: number, readonly height: number) {}
	getContext() { return { clearRect() {}, drawImage() {}, getImageData() { return { data: new Uint8ClampedArray(nativePixels) }; } }; }
} });
after(() => { for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });

async function database(label: string) {
	const native = mediaRestoreFixture(), name = `lightscaper-receive-${label}-${crypto.randomUUID()}`;
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, databaseName: `${name}-media`, preferOpfs: false, locks: null });
	const resources = await media.getCubeLutResources();
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, databaseName: `${name}-catalog`, verifyOriginal: media.verifyOriginal,
		verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal) });
	const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: `catalog-${label}`, name: label,
		revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] }); await catalog.createCatalog(root);
	let identities = 0, leases = 0, closed = 0;
	const ports: PhotoLibrarySessionPortsV2 = { catalog, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
		journal: media.settingsRepository, cubeLutResources: async () => resources, verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal),
		initialize: async () => (await catalog.loadCatalog(root.id))!, createId: () => `${label}-${String(++identities)}`, now: () => TIME,
		async exclusive(_catalog, operation, signal) { leases++; return operation(signal); },
		backup: { readSnapshot: catalog.readSnapshot.bind(catalog), captureSmartCollectionArchiveV1: catalog.captureSmartCollectionArchiveV1.bind(catalog),
			loadOriginal: (original, signal) => media.mediaRepository.loadAsset(original.storageKey, { signal, expectedSize: original.byteLength }) },
		async closeResources() { closed++; await catalog.close(); await media.close(); } };
	return { native, name, root, media, catalog, resources, ports, get leases() { return leases; }, get closed() { return closed; },
		change(photo: unknown) { native.raw(`${name}-catalog`).seedRecord(`${name}-catalog`, 'photos', { key: `${root.id}|received-1`, document: photo }); } };
}
async function fixture(processVersion: 1 | 2 = 2, virtual = false, configure?: (recipient: Awaited<ReturnType<typeof database>>) => void, encoded = PNG) {
	nativePixels = PIXELS; nativeGate = null; nativeCloses = 0;
	const sender = await database('sender'), recipient = await database('received'), base = photoArchiveFixture(1, encoded), saved = base.photo.versions[0]!;
	const develop = { ...saved.develop, processVersion, effects: processVersion === 2 ? [{ id: 'disabled-lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: LUT_REFERENCE } }] : [] };
	const versions = [{ ...saved, develop }, ...(virtual ? [{ ...saved, id: 'saved-copy', kind: 'virtual-copy' as const, name: 'Selected copy', develop }] : [])];
	const photo = normalizePhotoDocumentV1OrV2({ ...base.photo, catalogId: sender.root.id, schemaVersion: processVersion, versions,
		activeVersionId: virtual ? 'saved-copy' : saved.id, original: { ...base.photo.original, ...(encoded[0] === 255 ? { name: 'Photo 1.jpg', mimeType: 'image/jpeg' } : {}) } });
	const original = new Blob([new Uint8Array(encoded)], { type: photo.original.mimeType ?? '' });
	await sender.media.mediaRepository.writeAsset(photo.original.storageKey, original); await sender.resources.put(LUT_REFERENCE, LUT_BODY);
	await sender.catalog.publishPhotos(sender.root.id, 0, [photo]);
	const session = new PhotoLibrarySessionV2(sender.ports); assert.ok(session.imageHandoff);
	let ids = 0;
	const archive = await exportPhotoFramescaperHandoffArchiveV1({ capture: session.imageHandoff,
		binding: { catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: 0 } }, {
		createId: () => `archive-${String(++ids)}`, now: () => TIME,
		openImage: async () => ({ metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'injected-native-fixture' },
			decodeFrame: async () => ({ rgba: new Uint8Array(PIXELS), durationMicroseconds: null }), close() {} }) });
	const before = serializePhotoDocumentV1OrV2(photo); await session.close();
	configure?.(recipient); const receiver = new PhotoLibrarySessionV2(recipient.ports);
	return { sender, recipient, receiver, photo, before, request: { archive: archive.blob, sourceId: 'archive-2' },
		async close() { nativeGate = null; await receiver.close(); } };
}
function receive(session: PhotoLibrarySessionV2) {
	assert.ok('imageReceive' in session && session.imageReceive, 'Actual selected Session must expose the receive publication port.');
	return session.imageReceive;
}

async function ordinaryArchive(archive: Blob, scope: 'timeline' | 'bin' = 'timeline', edit?: (project: Record<string, unknown>) => void) {
	let imageClipId = '';
	const body = await rewriteLutArchiveFixture(archive, files => {
		const project = JSON.parse(new TextDecoder().decode(files.get('project.json'))) as Record<string, unknown>;
		const source = (project.sources as Record<string, unknown>[])[0]!, clip = (project.clips as Record<string, unknown>[])[0]!;
		source.schemaVersion = 1; delete source.develop; delete source.developed; delete source.provenance;
		(source.original as Record<string, unknown>).mimeType = null; imageClipId = clip.id as string;
		if (scope === 'bin') { (project.projectBin as { clips: unknown[] }).clips.push(clip); project.clips = [];
			for (const track of project.tracks as { clipIds: string[] }[]) track.clipIds = []; }
		edit?.(project);
		const bytes = new TextEncoder().encode(JSON.stringify(project)); files.set('project.json', bytes);
		const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json'))) as { project: { size: number; sha256: string } };
		manifest.project.size = bytes.length; manifest.project.sha256 = createHash('sha256').update(bytes).digest('hex');
		files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
	});
	return { archive: body, imageClipId };
}

for (const scope of ['timeline', 'bin'] as const) test(`Light ordinary receive publishes one neutral Photo from an explicit real ${scope} clip`, async () => {
	const f = await fixture(1), selected = await ordinaryArchive(f.request.archive, scope), before = new Uint8Array(await selected.archive.arrayBuffer());
	try {
		const result = await receive(f.receiver).receive({ ...f.request, ...selected });
		assert.equal(result.status, 'imported'); assert.equal(result.settlement, 'complete'); assert.equal(result.revision, 0);
		const photo = normalizePhotoDocumentV1OrV2(await f.recipient.catalog.loadPhoto(result.catalogId, result.photoId));
		assert.equal(photo.versions.length, 1); assert.equal(photo.versions[0]!.kind, 'master'); assert.equal(photo.activeVersionId, result.activeVersionId);
		assert.deepEqual(photo.versions[0]!.develop, { processVersion: 1, effects: [], masks: [], maskBindings: [],
			geometry: { crop: null, rotationDegrees: 0, flipHorizontal: false, flipVertical: false } });
		assert.equal(photo.original.contentSha256, f.photo.original.contentSha256); assert.equal(photo.original.name, f.photo.original.name.normalize('NFC'));
		assert.equal(photo.original.mimeType, 'image/png'); assert.equal(photo.original.width, 1); assert.equal(photo.original.height, 1);
		assert.deepEqual(new Uint8Array(await (await f.recipient.media.mediaRepository.loadAsset(photo.original.storageKey))!.arrayBuffer()), PNG);
		assert.deepEqual(new Uint8Array(await selected.archive.arrayBuffer()), before);
		const sender = new PhotoCatalogRepositoryV2({ indexedDB: f.sender.native.factory, databaseName: `${f.sender.name}-catalog`, verifyOriginal: f.sender.media.verifyOriginal });
		try { assert.equal(serializePhotoDocumentV1OrV2(await sender.loadPhoto(f.photo.catalogId, f.photo.id)), f.before); } finally { await sender.close(); }
		assert.equal(nativeCloses, 1); assert.equal(f.recipient.leases, 2, 'Startup recovery and one selected receive, without a nested import lease.');
	} finally { await f.close(); }
});

test('Light ordinary receive requires explicit matching clip context and leaves invalid selections unpublished', async () => {
	const f = await fixture(1), selected = await ordinaryArchive(f.request.archive);
	try {
		await assert.rejects(receive(f.receiver).receive({ archive: selected.archive, sourceId: f.request.sourceId }), /explicit.*clip/iu);
		await assert.rejects(receive(f.receiver).receive({ ...f.request, ...selected, imageClipId: 'stale-clip' }), /clip/iu);
		for (const field of ['sourceId', 'sequenceId'] as const) {
			const invalid = await ordinaryArchive(f.request.archive, 'timeline', project => { (project.clips as Record<string, unknown>[])[0]![field] = 'missing-owner'; });
			await assert.rejects(receive(f.receiver).receive({ ...f.request, ...invalid }));
		}
		assert.equal(nativeCloses, 0); assert.equal((await f.recipient.catalog.loadCatalog(f.recipient.root.id))!.photoCount, 0);
		assert.equal(await f.recipient.media.mediaRepository.loadAsset('received-3'), null);
	} finally { await f.close(); }
});

test('Light ordinary receive refuses malformed clip selection before selected startup without getter invocation', async () => {
	const f = await fixture(1); let getters = 0;
	try {
		const accessor = Object.defineProperty({ ...f.request }, 'imageClipId', { enumerable: true, get() { getters++; return 'archive-5'; } });
		for (const request of [accessor, { ...f.request, imageClipId: undefined }, { ...f.request, imageClipId: '' }, Object.create({ ...f.request, imageClipId: 'archive-5' }) as typeof f.request]) {
			await assert.rejects(receive(f.receiver).receive(request));
		}
		assert.equal(getters, 0); assert.equal(f.recipient.leases, 0); assert.equal(nativeCloses, 0);
	} finally { await f.close(); }
});

test('Light ordinary receive never accepts clip selection for an editable Source2', async () => {
	const f = await fixture(2), selected = await ordinaryArchive(f.request.archive);
	try { await assert.rejects(receive(f.receiver).receive({ ...f.request, imageClipId: selected.imageClipId }), /Source2/iu);
		assert.equal(nativeCloses, 0); assert.equal((await f.recipient.catalog.loadCatalog(f.recipient.root.id))!.photoCount, 0);
		await assert.rejects(f.recipient.resources.source.withBytes(LUT_REFERENCE, () => undefined), /missing/iu);
	} finally { await f.close(); }
});

test('Light ordinary receive verifies canonical native pixels before any original publication', async () => {
	const f = await fixture(1), selected = await ordinaryArchive(f.request.archive); nativePixels = Uint8Array.of(24, 71, 149, 255);
	try { await assert.rejects(receive(f.receiver).receive({ ...f.request, ...selected }), /canonical|pixel|digest/iu);
		assert.equal(nativeCloses, 1); assert.equal((await f.recipient.catalog.loadCatalog(f.recipient.root.id))!.photoCount, 0);
		assert.equal(await f.recipient.media.mediaRepository.loadAsset('received-3'), null);
	} finally { await f.close(); }
});

for (const cancel of [false, true]) test(`Light ordinary receive pins clip before yield and joins held native work${cancel ? ' on Close' : ''}`, async () => {
	const f = await fixture(1), selected = await ordinaryArchive(f.request.archive), entered = deferred<void>(), release = deferred<void>();
	nativeGate = async () => { entered.resolve(); await release.promise; };
	const request = { ...f.request, ...selected }, work = receive(f.receiver).receive(request); request.imageClipId = 'late-selection';
	const observed = work.then(() => { entered.reject(new Error('Native verification was not held.')); }, (error: unknown) => { entered.reject(error); });
	try {
		await entered.promise;
		if (cancel) { const refusal = assert.rejects(work), closing = f.receiver.close();
			assert.equal(await remainsPending(closing), true); assert.equal(f.recipient.closed, 0); release.resolve(); await refusal; await closing;
			const reopened = new PhotoCatalogRepositoryV2({ indexedDB: f.recipient.native.factory, databaseName: `${f.recipient.name}-catalog`, verifyOriginal: f.recipient.media.verifyOriginal });
			try { assert.equal((await reopened.loadCatalog(f.recipient.root.id))!.photoCount, 0); } finally { await reopened.close(); }
		} else { assert.equal(await remainsPending(work), true); release.resolve(); assert.equal((await work).status, 'imported'); }
		assert.equal(nativeCloses, 1);
	} finally { release.resolve(); await observed; await f.close(); }
});

for (const [process, virtual] of [[1, false], [2, false], [2, true]] as const) test(`Light receive publishes complete process${process} selected ${virtual ? 'copy' : 'master'} with original and disabled LUT custody`, async () => {
	const f = await fixture(process, virtual);
	try {
		const result = await receive(f.receiver).receive(f.request); assert.equal(result.status, 'imported'); assert.equal(result.settlement, 'complete');
		assert.ok(Object.isFrozen(result)); assert.equal(result.catalogId, f.recipient.root.id); assert.equal(result.revision, 0);
		const photo = normalizePhotoDocumentV1OrV2(await f.recipient.catalog.loadPhoto(result.catalogId, result.photoId));
		assert.equal(photo.original.name, f.photo.original.name); assert.equal(photo.original.contentSha256, f.photo.original.contentSha256);
		assert.equal(photo.activeVersionId, result.activeVersionId); assert.equal(photo.versions.length, virtual ? 2 : 1);
		assert.deepEqual(photo.versions.find(version => version.id === photo.activeVersionId)!.develop, f.photo.versions.find(version => version.id === f.photo.activeVersionId)!.develop);
		assert.deepEqual(new Uint8Array(await (await f.recipient.media.mediaRepository.loadAsset(photo.original.storageKey))!.arrayBuffer()), PNG);
		if (process === 2) await f.recipient.resources.source.withBytes(LUT_REFERENCE, bytes => assert.deepEqual(bytes, LUT_BODY));
		assert.equal(f.before, serializePhotoDocumentV1OrV2(f.photo)); assert.equal(nativeCloses, 1);
		assert.equal(f.recipient.leases, 2, 'One startup recovery lease and one receive lease; managed importer must not nest.');
	} finally { await f.close(); }
});

test('Light receive seals request and host capabilities synchronously before held native verification', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	nativeGate = async () => { entered.resolve(); await release.promise; };
	try {
		const request = { ...f.request }, work = receive(f.receiver).receive(request); await entered.promise;
		request.sourceId = 'late'; Object.defineProperty(f.recipient.ports, 'createId', { value: () => 'late' });
		f.recipient.ports.catalog.publishPhotos = async () => { throw Symbol('late publisher'); };
		release.resolve(); assert.equal((await work).photoId, 'received-1');
	} finally { release.resolve(); await f.close(); }
});

test('Light receive native mismatch refuses before any resource or catalog publication', async () => {
	const f = await fixture(); nativePixels = Uint8Array.of(24, 71, 149, 255);
	try { await assert.rejects(receive(f.receiver).receive(f.request), /canonical|pixel|digest/iu);
		assert.equal((await f.recipient.catalog.loadCatalog(f.recipient.root.id))!.photoCount, 0);
		await assert.rejects(f.recipient.resources.source.withBytes(LUT_REFERENCE, () => undefined), /missing/iu);
	} finally { await f.close(); }
});

test('Light receive Close joins held native decode and refuses before selected writes', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); nativeGate = async () => { entered.resolve(); await release.promise; };
	const work = receive(f.receiver).receive(f.request), refusal = assert.rejects(work);
	try { await entered.promise; const closing = f.receiver.close(); assert.equal(await remainsPending(closing), true); assert.equal(f.recipient.closed, 0);
		release.resolve(); await refusal; await closing; assert.equal(f.recipient.closed, 1); assert.equal(nativeCloses, 1);
	} finally { release.resolve(); await f.close(); }
});


test('Light keyword reuse deduplicates memberships while keeping extracted repetitions', async () => {
	const f = await database('keywords'), base = photoArchiveFixture(1, PNG); let allocated = 0;
	try {
		const photo = normalizePhotoDocumentV1OrV2({ ...base.photo, catalogId: f.root.id });
		const result = await resolvePhotoImportKeywordsV1(f.catalog, f.root.id, { photo, keywordNames: ['Camera', 'Camera', 'Travel'] }, () => `keyword-${String(++allocated)}`, new AbortController().signal, true);
		assert.deepEqual(result, { ids: ['keyword-1', 'keyword-2'], notice: false });
		const root = (await f.catalog.loadCatalog(f.root.id))!; assert.equal(root.revision, 1); assert.deepEqual(root.keywords.map(value => value.name), ['Camera', 'Travel']);
		const reused = await resolvePhotoImportKeywordsV1(f.catalog, f.root.id, { photo, keywordNames: ['Camera'] }, () => { throw new Error('Existing keyword must be reused.'); }, new AbortController().signal, true);
		assert.deepEqual(reused.ids, ['keyword-1']); assert.equal((await f.catalog.loadCatalog(f.root.id))!.revision, 1);
	} finally { await f.ports.closeResources(); }
});

test('Light receive strict keyword planning refuses complete plan before writes while legacy keeps notices', async () => {
	for (const strict of [false, true]) {
		const f = await database(`keyword-${String(strict)}`), base = photoArchiveFixture(1, PNG); let allocated = 0;
		try {
			const photo = normalizePhotoDocumentV1OrV2({ ...base.photo, catalogId: f.root.id });
			const work = resolvePhotoImportKeywordsV1(f.catalog, f.root.id, { photo, keywordNames: ['Good', 'x'.repeat(257)] }, () => `keyword-${String(++allocated)}`, new AbortController().signal, strict);
			if (strict) { await assert.rejects(work, /keyword/iu); assert.deepEqual((await f.catalog.loadCatalog(f.root.id))!.keywords, []); }
			else { assert.deepEqual(await work, { ids: ['keyword-1'], notice: true }); assert.equal((await f.catalog.loadCatalog(f.root.id))!.keywords.length, 1); }
		} finally { await f.ports.closeResources(); }
	}
});


test('Light receive preserves actual Imported ACK through post-publication opaque cancellation', async () => {
	const stop = new AbortController(), reason = new Proxy({}, { ownKeys() { throw new Error('Do not inspect cancellation.'); } });
	const f = await fixture(2, false, recipient => {
		const publish = recipient.catalog.publishPhotos.bind(recipient.catalog);
		recipient.catalog.publishPhotos = async (...args) => { const result = await publish(...args); stop.abort(reason); return result; };
	});
	try { const result = await receive(f.receiver).receive(f.request, { signal: stop.signal });
		assert.equal(result.status, 'imported'); assert.equal(result.settlement, 'recovery-pending'); assert.equal(result.failure, reason);
		assert.ok(await f.recipient.catalog.loadPhoto(result.catalogId, result.photoId));
	} finally { await f.close(); }
});

test('Light receive native ACK outranks physical lease cleanup and retains exact opaque failure', async () => {
	const primary = new Proxy({}, { getPrototypeOf() { throw new Error('Do not inspect cleanup.'); } }); let calls = 0;
	const f = await fixture(1, false, recipient => {
		Object.defineProperty(recipient.ports, 'exclusive', { value: async (_id: string, operation: (signal?: AbortSignal) => Promise<unknown>, signal?: AbortSignal) => {
			const result = await operation(signal); if (++calls === 2) throw primary; return result;
		} });
	});
	try { const result = await receive(f.receiver).receive(f.request);
		assert.equal(result.settlement, 'recovery-pending'); assert.equal(result.failure, primary);
		assert.equal((await f.recipient.catalog.loadCatalog(result.catalogId))!.photoCount, 1);
	} finally { await f.close(); }
});

test('Light receive lost native ACK requires whole recipe proof, rejecting original-only matching readback', async () => {
	for (const tamper of [false, true]) {
		const primary = Symbol('lost-publish-ack');
		const f = await fixture(2, false, recipient => {
			const publish = recipient.catalog.publishPhotos.bind(recipient.catalog);
			recipient.catalog.publishPhotos = async (...args) => {
				await publish(...args);
				if (tamper) { const photo = normalizePhotoDocumentV1OrV2(args[2][0]);
					recipient.change(normalizePhotoDocumentV1OrV2({ ...photo, versions: photo.versions.map(version => ({ ...version, develop: { ...version.develop, effects: [] } })) })); }
				throw primary;
			};
		});
		try {
			if (tamper) await assert.rejects(receive(f.receiver).receive(f.request), reason => reason === primary);
			else { const result = await receive(f.receiver).receive(f.request); assert.equal(result.status, 'imported'); assert.equal(result.settlement, 'complete'); }
			assert.equal((await f.recipient.catalog.loadCatalog(f.recipient.root.id))!.photoCount, 1);
		} finally { await f.close(); }
	}
});

test('Light receive refuses own getters, unknown fields and shadowed native signal before selected startup', async () => {
	const f = await fixture(1); let invoked = 0;
	try {
		const accessor = Object.defineProperty({ ...f.request }, 'archive', { get() { invoked++; return f.request.archive; } });
		for (const request of [accessor, { ...f.request, destination: {} }, Object.create(f.request) as typeof f.request]) await assert.rejects(receive(f.receiver).receive(request));
		const signal = Object.defineProperty(new AbortController().signal, 'aborted', { get() { invoked++; return false; } });
		await assert.rejects(receive(f.receiver).receive(f.request, { signal })); assert.equal(invoked, 0); assert.equal(f.recipient.leases, 0);
	} finally { await f.close(); }
});

test('Light receive refuses repeated newly allocated identities before original publication', async () => {
	const f = await fixture(1, false, recipient => { Object.defineProperty(recipient.ports, 'createId', { value: () => 'already-used' }); });
	try { await assert.rejects(receive(f.receiver).receive(f.request), /distinct|identity|collid/iu);
		assert.equal((await f.recipient.catalog.loadCatalog(f.recipient.root.id))!.photoCount, 0);
	} finally { await f.close(); }
});


test('Light receive keyword plan reserves both native catalog revision increments before any write', async () => {
	const base = photoArchiveFixture(1, PNG); let saves = 0;
	const catalog = { async loadCatalog() { return normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: base.photo.catalogId,
		name: 'Near limit', revision: Number.MAX_SAFE_INTEGER - 1, photoCount: 0, folders: [], keywords: [], collections: [] }); },
		async saveCatalog(value: unknown) { saves++; return normalizePhotoCatalogRootV1(value); } };
	await assert.rejects(resolvePhotoImportKeywordsV1(catalog, base.photo.catalogId, { photo: base.photo, keywordNames: ['Camera'] }, () => 'fresh-keyword', new AbortController().signal, true), /revision|bound|capacity/iu);
	assert.equal(saves, 0);
});


test('Light receive imports extracted repeated IPTC keywords into complete selected memberships', async () => {
	// Maintained metadata fixture plus injected static native pixels: this proves
	// real parser/publication custody, not browser JPEG codec behavior.
	const encoded = jpegFixture(photoshopIptc(joinBytes(iptcText(25, 'Camera'), iptcText(25, 'Travel'), iptcText(25, 'Camera'))),
		jpegSegment(0xc0, Uint8Array.of(8, 0, 1, 0, 1, 1, 1, 0x11, 0)), jpegSegment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0)), Uint8Array.of(0xff, 0, 0xff, 0xd0));
	const f = await fixture(2, false, undefined, new Uint8Array(encoded));
	try {
		const result = await receive(f.receiver).receive(f.request), photo = normalizePhotoDocumentV1OrV2(await f.recipient.catalog.loadPhoto(result.catalogId, result.photoId));
		const root = (await f.recipient.catalog.loadCatalog(result.catalogId))!;
		assert.deepEqual(root.keywords.map(value => value.name), ['Camera', 'Travel']); assert.equal(photo.keywordIds.length, 2);
		assert.deepEqual(photo.keywordIds, root.keywords.map(value => value.id)); assert.deepEqual(photo.extractedMetadata?.iptc?.keywords, ['Camera', 'Travel', 'Camera']);
	} finally { await f.close(); }
});

test('Light receive closes only after a held disabled-LUT write joins and cancels before publication', async () => {
	const entered = deferred<void>(), release = deferred<void>(); let writes = 0;
	const f = await fixture(2, false, recipient => {
		const put = recipient.resources.put.bind(recipient.resources);
		Object.defineProperty(recipient.ports, 'cubeLutResources', { value: async () => ({ ...recipient.resources,
			async put(...args: Parameters<typeof put>) { writes++; entered.resolve(); await release.promise; return put(...args); } }) });
	});
	const work = receive(f.receiver).receive(f.request), refusal = assert.rejects(work);
	try {
		await entered.promise; const closing = f.receiver.close(); assert.equal(await remainsPending(closing), true); assert.equal(f.recipient.closed, 0);
		release.resolve(); await refusal; await closing; assert.equal(writes, 1); assert.equal(f.recipient.closed, 1);
	} finally { release.resolve(); await f.close(); }
});

test('Light receive reuses only the authenticated digest-and-length original while keeping fresh identities', async () => {
	const f = await fixture(1);
	await f.recipient.media.mediaRepository.writeAsset('existing-authenticated-body', new Blob([PNG], { type: 'image/png' }));
	try {
		const first = await receive(f.receiver).receive(f.request), second = await receive(f.receiver).receive(f.request);
		const a = normalizePhotoDocumentV1OrV2(await f.recipient.catalog.loadPhoto(first.catalogId, first.photoId));
		const b = normalizePhotoDocumentV1OrV2(await f.recipient.catalog.loadPhoto(second.catalogId, second.photoId));
		assert.equal(first.reusedOriginal, true); assert.equal(second.reusedOriginal, true); assert.notEqual(a.id, b.id); assert.notEqual(a.original.id, b.original.id);
		assert.equal(a.original.storageKey, 'existing-authenticated-body'); assert.equal(b.original.storageKey, a.original.storageKey);
		assert.equal((await f.recipient.catalog.loadCatalog(first.catalogId))!.photoCount, 2);
	} finally { await f.close(); }
});

test('Light receive preserves opaque original-write failure before a publication ACK', async () => {
	const primary = new Proxy({}, { getPrototypeOf() { throw new Error('Do not inspect original-write refusal.'); } });
	const f = await fixture(1, false, recipient => { Object.defineProperty(recipient.ports.media, 'writeAsset', { value: async () => { throw primary; } }); });
	try {
		let failed = false;
		try { await receive(f.receiver).receive(f.request); } catch (error) { failed = true; if (error !== primary) assert.fail('Original-write failure identity was replaced.'); }
		assert.equal(failed, true); assert.equal((await f.recipient.catalog.loadCatalog(f.recipient.root.id))!.photoCount, 0);
	} finally { await f.close(); }
});

test('Light receive allocated original ID refuses collision with an existing nonselected version', async () => {
	const f = await fixture(1, false, recipient => { let next = 0;
		Object.defineProperty(recipient.ports, 'createId', { value: () => ++next === 6 ? 'received-4' : `received-${String(next)}` });
	});
	try {
		await receive(f.receiver).receive(f.request);
		await assert.rejects(receive(f.receiver).receive(f.request), /already exists/iu);
		assert.equal((await f.recipient.catalog.loadCatalog(f.recipient.root.id))!.photoCount, 1);
	} finally { await f.close(); }
});

test('Light receive strict keyword capacity refuses memberships, definitions and root bytes before saving', async () => {
	const base = photoArchiveFixture(1, PNG), limits = LIGHTSCAPER_CATALOG_LIMITS;
	for (const kind of ['memberships', 'definitions', 'bytes'] as const) {
		let saves = 0;
		const keyword = (index: number, length = 8) => ({ id: `key-${String(index)}`, name: `${String(index).padStart(8, '0')}${'x'.repeat(length - 8)}`, parentId: null });
		const root = { schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: base.photo.catalogId,
			name: 'Capacity', revision: 0, photoCount: 0, folders: [], keywords: [] as ReturnType<typeof keyword>[], collections: [] };
		let photo: ReturnType<typeof normalizePhotoDocumentV1OrV2> = base.photo;
		if (kind === 'memberships') { root.keywords = Array.from({ length: limits.maximumMemberships }, (_, i) => keyword(i));
			photo = normalizePhotoDocumentV1OrV2({ ...photo, keywordIds: root.keywords.map(value => value.id) }); }
		if (kind === 'definitions') root.keywords = Array.from({ length: limits.maximumKeywords }, (_, i) => keyword(i));
		if (kind === 'bytes') {
			let low = 0, high = limits.maximumKeywords;
			while (low < high) { const count = Math.ceil((low + high) / 2), keywords = Array.from({ length: count }, (_, i) => keyword(i, 256));
				if (new TextEncoder().encode(JSON.stringify({ ...root, keywords, revision: 2, photoCount: 1 })).length <= limits.maximumDocumentBytes) low = count; else high = count - 1; }
			root.keywords = Array.from({ length: low }, (_, i) => keyword(i, 256));
		}
		const admitted = normalizePhotoCatalogRootV1(root), catalog = { async loadCatalog() { return admitted; }, async saveCatalog() { saves++; return admitted; } };
		await assert.rejects(resolvePhotoImportKeywordsV1(catalog, root.id, { photo, keywordNames: [kind === 'bytes' ? 'z'.repeat(256) : 'New'] }, () => 'new-keyword', new AbortController().signal, true), /capacity/iu);
		assert.equal(saves, 0);
	}
});


test('Light receive preserves distinct original staging and settlement failures', async () => {
	const primary = Symbol('original staging'), cleanup = Symbol('original settlement'); let failed = false;
	const f = await fixture(1, false, recipient => {
		const custody = recipient.ports.media.custody, read = custody.readPage.bind(custody);
		Object.defineProperty(custody, 'stage', { value: async () => { failed = true; throw primary; } });
		Object.defineProperty(custody, 'readPage', { value: (...args: Parameters<typeof read>) => failed ? Promise.reject(cleanup) : read(...args) });
	});
	try { await assert.rejects(receive(f.receiver).receive(f.request), error => error instanceof AggregateError && error.cause === primary && error.errors[0] === primary && error.errors[1] === cleanup); }
	finally { await f.close(); }
});


test('Light receive reports actual digest reuse when the orphan body key equals the new storage key', async () => {
	const f = await fixture(1);
	await f.recipient.media.mediaRepository.writeAsset('received-3', new Blob([PNG], { type: 'image/png' }));
	try {
		const result = await receive(f.receiver).receive(f.request);
		assert.equal(result.reusedOriginal, true);
		const photo = normalizePhotoDocumentV1OrV2(await f.recipient.catalog.loadPhoto(result.catalogId, result.photoId)); assert.equal(photo.original.storageKey, 'received-3');
	} finally { await f.close(); }
});

test('Light receive pins the default UUID allocator before held native work', async () => {
	const owner = globalThis.crypto, prior = Object.getOwnPropertyDescriptor(owner, 'randomUUID'); let identities = 0;
	Object.defineProperty(owner, 'randomUUID', { configurable: true, value: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++identities).padStart(12, '0')}` });
	const f = await fixture(1, false, recipient => { Reflect.deleteProperty(recipient.ports, 'createId'); });
	const entered = deferred<void>(), release = deferred<void>(); nativeGate = async () => { entered.resolve(); await release.promise; };
	const work = receive(f.receiver).receive(f.request);
	try {
		await entered.promise; Object.defineProperty(owner, 'randomUUID', { configurable: true, value: () => `bbbbbbbb-bbbb-4bbb-8bbb-${String(++identities).padStart(12, '0')}` });
		release.resolve(); assert.match((await work).photoId, /^aaaaaaaa-/u);
	} finally { release.resolve(); if (prior) Object.defineProperty(owner, 'randomUUID', prior); else Reflect.deleteProperty(owner, 'randomUUID'); await f.close(); }
});


test('Light receive keeps native publication primary with both distinct settlement and full-readback failures', async () => {
	const primary = Symbol('native publication'), settlement = Symbol('native settlement read'), readback = Symbol('complete candidate read'); let failed = false, reads = 0;
	const f = await fixture(1, false, recipient => {
		const load = recipient.catalog.loadPhoto.bind(recipient.catalog);
		recipient.catalog.publishPhotos = async () => { failed = true; throw primary; };
		recipient.catalog.loadPhoto = (...args) => failed ? Promise.reject(++reads === 1 ? settlement : readback) : load(...args);
	});
	try { await assert.rejects(receive(f.receiver).receive(f.request), error => error instanceof AggregateError && error.cause === primary && error.errors.length === 3 && error.errors[0] === primary && error.errors[1] === settlement && error.errors[2] === readback); }
	finally { await f.close(); }
});
