/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { PhotoLibraryImportItemV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { readImageHdrOriginalV1 } from '../src/common/editor/imaging/image-hdr-original-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';
import type { ImageHdrMergePreviewCurrentV1 } from '../src/common/editor/controller/shared/image-hdr-merge-preview-current-v1.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { repairSettingsFixture, SETTINGS_TIME } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { rawRecoveryDngFixtureV1 } from './helpers/lightscaper-raw-recovery-dng-current-fixture.ts';
import { rawWorkerFixtureV1 } from './helpers/lightscaper-raw-worker-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

// Initial existing-frontdoor RED uses this explicit structural child contract.
// Production exports will replace these local declarations after integration.
interface Source {
	readonly photoId: string; readonly revision: number; readonly fileName: string;
	readonly width: number; readonly height: number; readonly mimeType: string; readonly profile: 'encoded-srgb8' | 'linear-srgb16';
	readonly exposureSeconds: number | null; readonly aperture: number | null; readonly iso: number | null;
}
interface MergeRequest {
	readonly schemaVersion: 1; readonly inputs: readonly Readonly<{ photoId: string; expectedRevision: number; exposureMultiplier: number }>[];
	readonly referenceIndex: number; readonly alignment: 'none' | 'ward-mtb-v1';
	readonly deghost: Readonly<{ mode: 'off' | 'reference-v1'; threshold: number }>; readonly fileName: string;
}
interface HdrChild {
	readonly schemaVersion: 1;
	readSelection(request: Readonly<{ schemaVersion: 1; photoIds: readonly string[] }>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<{
		schemaVersion: 1; catalogId: string; sources: readonly Source[]; suggestedExposureMultipliers: readonly number[] | null;
	}>>;
	merge(request: MergeRequest, options?: Readonly<{ signal?: AbortSignal; onAcknowledged?: (item: PhotoLibraryImportItemV1) => void }>): Promise<Readonly<{
		schemaVersion: 1; receipt: PhotoLibraryImportItemV1; diagnostics: Readonly<Record<string, number>>;
	}>>;
	withPreview?<Result>(request: MergeRequest, consume: (view: Readonly<ImageHdrMergePreviewCurrentV1>) => Result | Promise<Result>,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<Result>;
}
type Session = Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>>;
const OPTIONS = { concurrency: false, timeout: 40_000 };
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const observed = <Result>(work: Promise<Result>) => work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
interface CaptureFacts { readonly shutterDenominator: number; readonly aperture: number; readonly iso: number; }

/** Literal TIFF extension, independent of the application metadata writer.
 * A new IFD0 retains all existing absolute Bayer/DNG offsets and adds an Exif
 * directory. The original sensor payload is copied byte for byte. */
function dngWithCaptureFacts(bytes: Uint8Array<ArrayBuffer>, facts: CaptureFacts): Uint8Array<ArrayBuffer> {
	const original = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), oldIfd = original.getUint32(4, true), count = original.getUint16(oldIfd, true);
	assert.ok(count < 128); const ifd = (bytes.length + 1) & ~1, exif = ifd + 2 + (count + 1) * 12 + 4, rational = exif + 2 + 3 * 12 + 4;
	const result = new Uint8Array(rational + 16), view = new DataView(result.buffer); result.set(bytes); view.setUint32(4, ifd, true);
	const entries = Array.from({ length: count }, (_, index) => bytes.slice(oldIfd + 2 + index * 12, oldIfd + 14 + index * 12));
	const pointer = new Uint8Array(12), point = new DataView(pointer.buffer);
	point.setUint16(0, 0x8769, true); point.setUint16(2, 4, true); point.setUint32(4, 1, true); point.setUint32(8, exif, true); entries.push(pointer);
	entries.sort((a, b) => new DataView(a.buffer).getUint16(0, true) - new DataView(b.buffer).getUint16(0, true));
	view.setUint16(ifd, entries.length, true); entries.forEach((entry, index) => { result.set(entry, ifd + 2 + index * 12); });
	view.setUint16(exif, 3, true);
	for (const [index, [tag, type, value]] of [[0x829a, 5, rational], [0x829d, 5, rational + 8], [0x8827, 3, facts.iso]].entries()) {
		const at = exif + 2 + index * 12; view.setUint16(at, tag!, true); view.setUint16(at + 2, type!, true); view.setUint32(at + 4, 1, true);
		if (type === 3) view.setUint16(at + 8, value!, true); else view.setUint32(at + 8, value!, true);
	}
	view.setUint32(rational, 1, true); view.setUint32(rational + 4, facts.shutterDenominator, true);
	view.setUint32(rational + 8, facts.aperture, true); view.setUint32(rational + 12, 1, true);
	assert.deepEqual(result.subarray(8, bytes.length), bytes.subarray(8)); return result;
}
function child(session: Session): HdrChild {
	const value = (session as Session & { readonly hdrMergeCurrent?: HdrChild }).hdrMergeCurrent;
	assert.ok(value, 'actual Current Session must expose its named HDR merge child'); assert.equal(value.schemaVersion, 1); return value;
}

/** Filesystem and Worker transport are modeled. OPFS binary writers, leased
 * staging, immutable native Blobs, the production ABI1 worker/WASM and selected
 * catalog/media/Session owners all execute their real implementations. */
async function fixture(captureFacts?: readonly [CaptureFacts, CaptureFacts]) {
	const f = await repairSettingsFixture(1), workers = await rawWorkerFixtureV1();
	const keys = ['Worker', 'fetch', 'navigator'] as const, previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	const files = new Map<string, Blob>(), events: string[] = [], leases = new Set<string>();
	const hooks = { write: async (): Promise<void> => undefined };
	const directory = {
		async getFileHandle(path: string, options?: { create?: boolean }) {
			if (!files.has(path)) { if (!options?.create) throw new DOMException('Absent', 'NotFoundError'); files.set(path, new Blob()); events.push(`create:${path}`); }
			return { async createWritable() {
				const chunks: Uint8Array<ArrayBuffer>[] = [];
				return { async write(value: ArrayBuffer) { await hooks.write(); chunks.push(new Uint8Array(value).slice()); events.push('write'); },
					async close() { files.set(path, new Blob(chunks)); events.push('writer:closed'); }, async abort() { chunks.length = 0; events.push('writer:aborted'); } };
			}, async getFile() { const body = files.get(path); if (!body) throw new DOMException('Absent', 'NotFoundError'); return body; } };
		},
		async removeEntry(path: string) { if (!files.delete(path)) throw new DOMException('Absent', 'NotFoundError'); events.push(`delete:${path}`); },
	};
	const nativeLocks = f.options.locks, request = nativeLocks.request;
	const locks = { request(name: string, optionsOrRun: unknown, run?: (lock: unknown) => Promise<unknown>) {
		const operation = typeof optionsOrRun === 'function' ? optionsOrRun : run;
		assert.equal(typeof operation, 'function');
		return Reflect.apply(request, nativeLocks, [name, typeof optionsOrRun === 'function' ? {} : optionsOrRun, async (lock: unknown) => {
			leases.add(name); try { return await Reflect.apply(operation as (...args: unknown[]) => unknown, undefined, [lock]); } finally { leases.delete(name); }
		}]) as Promise<unknown>;
	} };
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks, storage: { async getDirectory() {
		return { async getDirectoryHandle(name: string) { assert.equal(name, 'audio-editor-exports'); return directory; } };
	} } } });
	Object.defineProperty(globalThis, 'Worker', { configurable: true, value: function (_url: URL, options: WorkerOptions) {
		assert.equal(options.name, 'lightscaper-libraw', 'HDR must sample canonical ABI1, never a saved recovery mode'); return workers.createWorker();
	} });
	Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: unknown) => {
		assert.equal(url, 'https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm');
		return new Response(new Uint8Array(await readFile(new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url))));
	} });
	let media: PhotoMediaStoreV1 | undefined, catalog: PhotoCatalogRepositoryCurrentV1 | undefined;
	// Photo bodies use this fixture's native IndexedDB owner, as they did in
	// the initial Session. Only default HDR pixel staging sees modeled OPFS.
	// Hide the filesystem transport while fresh Session media owners compose,
	// then restore it before any merge/preview operation starts.
	async function composePhotoSession<Result>(create: () => Promise<Result>): Promise<Result> {
		const navigator = globalThis.navigator, storage = Object.getOwnPropertyDescriptor(navigator, 'storage');
		Reflect.deleteProperty(navigator, 'storage');
		try { return await create(); }
		finally { if (storage) Object.defineProperty(navigator, 'storage', storage); }
	}
	async function close() {
		const outcomes = await Promise.allSettled([catalog?.close(), media?.close(), f.close(), workers.close()]);
		for (const [index, key] of keys.entries()) { const descriptor = previous[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
		const failures = outcomes.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
		if (failures.length) throw new AggregateError(failures, 'HDR Session fixture retirement failed.');
	}
	try {
		const raw = rawRecoveryDngFixtureV1({ orientation: 6 }).bytes;
		const bodies = captureFacts ? captureFacts.map(facts => dngWithCaptureFacts(raw, facts)) : [raw, raw];
		const imported = await f.session.importFiles([new File([bodies[0]!], 'Bracket one.dng', { type: 'image/png' }), new File([bodies[1]!], 'Bracket two.dng', { type: 'image/jpeg' })]);
		assert.ok(imported.every(item => item.status === 'imported' && item.photoId)); const photoIds = imported.map(item => item.photoId!);
		const anchor = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, preferOpfs: false });
		const selected = await (async () => { try { await anchor.ready(); return await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw new Error('HDR observation cannot allocate a namespace.'); } }); } finally { await anchor.close(); } })();
		media = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, databaseName: selected.location.mediaDatabaseName, preferOpfs: false }); await media.ready();
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.native.factory, databaseName: selected.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
		const actualMedia = media, actualCatalog = catalog, catalogId = selected.location.catalogId;
		const first = await f.session.develop.read({ schemaVersion: 3, photoId: photoIds[0]! });
		await f.session.develop.apply({ schemaVersion: 3, photoId: first.photoId, expectedRevision: first.revision, command: { type: 'record-develop', versionId: first.versionId,
			develop: normalizeImageDevelopStateV4({ ...first.develop, processVersion: 4, rawDevelopment: { schemaVersion: 1, mode: 'recovery' }, repairs: { schemaVersion: 1, spots: [] },
				effects: [createVideoEffectV2('tone-ladder-v1', { id: 'creative-source-exposure', params: { exposure: 3 } })] }), label: 'Source creative settings', createdAt: SETTINGS_TIME } });
		const readSource = async (photoId: string) => { const photo = await actualCatalog.loadPhoto(catalogId, photoId); assert.ok(photo);
			const body = await actualMedia.mediaRepository.loadAsset(photo.original.storageKey); assert.ok(body instanceof Blob);
			const bytes = new Uint8Array(await body.arrayBuffer()); assert.equal(digest(bytes), photo.original.contentSha256);
			const rows = f.native.raw(selected.location.mediaDatabaseName).records(selected.location.mediaDatabaseName, 'mediaAssets') as Record<string, unknown>[];
			const asset = rows.find(row => row.sourceId === photo.original.storageKey); assert.ok(asset); assert.equal(typeof asset.mediaContentToken, 'string');
			return { photo, bytes, mediaContentToken: asset.mediaContentToken };
		};
		const before = await Promise.all(photoIds.map(readSource)), original = f.session.develop.original; assert.ok(original);
		const words = await original.withFrame({ schemaVersion: 1, photoId: before[0]!.photo.id, expectedRevision: before[0]!.photo.revision }, view => {
			assert.ok(view.frame.pixels instanceof Uint16Array); return Array.from(view.frame.pixels);
		});
		const mergeRequest = (): MergeRequest => ({ schemaVersion: 1, inputs: before.map(({ photo }) => ({ photoId: photo.id, expectedRevision: photo.revision, exposureMultiplier: 1 })),
			referenceIndex: 0, alignment: 'none', deghost: { mode: 'off', threshold: .15 }, fileName: 'Merged.lshdr' });
		return { f, workers, files, events, leases, hooks, raw, catalog: actualCatalog, media: actualMedia, mediaDatabaseName: selected.location.mediaDatabaseName,
			catalogId, before, words, photoIds, mergeRequest,
			openCurrent: () => composePhotoSession(() => createPhotoLibrarySessionCurrentV1(f.options)),
			openLegacy: () => composePhotoSession(() => createPhotoLibrarySessionV3(f.options)),
			async assertSources() { assert.deepEqual(await Promise.all(photoIds.map(readSource)), before); },
			async inspectResult(photoId: string) { const photo = await actualCatalog.loadPhoto(catalogId, photoId); assert.ok(photo);
				const body = await actualMedia.mediaRepository.loadAsset(photo.original.storageKey); assert.ok(body instanceof Blob);
				const bytes = new Uint8Array(await body.arrayBuffer()), parsed = readImageHdrOriginalV1(bytes);
				assert.equal(digest(bytes), photo.original.contentSha256); return { photo, bytes, parsed }; }, close };
	} catch (error) { await close(); throw error; }
}

test('actual Current Session HDR child reads canonical source facts and publishes a lossless default Photo3 after joined real ABI1 workers and modeled filesystem transport', OPTIONS, async () => {
	const f = await fixture();
	try {
		const cap = child(f.f.session), selection = await cap.readSelection({ schemaVersion: 1, photoIds: f.photoIds });
		assert.equal(selection.catalogId, f.catalogId); assert.deepEqual(selection.sources.map(source => source.photoId), f.photoIds);
		assert.deepEqual(selection.sources.map(source => [source.width, source.height, source.profile]), [[96, 128, 'linear-srgb16'], [96, 128, 'linear-srgb16']]);
		assert.deepEqual(selection.sources.map(source => source.revision), f.before.map(({ photo }) => photo.revision));
		const facts = f.before.map(({ photo }) => photo.extractedMetadata?.exif);
		assert.deepEqual(selection.sources.map(source => [source.exposureSeconds, source.aperture, source.iso]), facts.map(exif => [exif?.exposureSeconds ?? null, exif?.aperture ?? null, exif?.iso ?? null]));
		const acknowledged: PhotoLibraryImportItemV1[] = [], created = f.workers.statistics.created;
		const result = await cap.merge(f.mergeRequest(), { onAcknowledged: receipt => { acknowledged.push(receipt); assert.equal(f.files.size, 0); assert.equal(f.workers.active(), 0); } });
		assert.equal(result.schemaVersion, 1); assert.equal(result.receipt.status, 'imported'); assert.ok(result.receipt.photoId); assert.deepEqual(acknowledged, [result.receipt]);
		assert.equal(f.workers.statistics.created - created, 2); assert.equal(f.workers.active(), 0); assert.equal(f.files.size, 0); assert.equal(f.leases.size, 0);
		const stored = await f.inspectResult(result.receipt.photoId), photo = stored.photo;
		assert.equal(photo.schemaVersion, 3); assert.equal(photo.revision, 0); assert.equal(photo.original.mimeType, 'image/x-lightscaper-hdr');
		assert.equal(photo.metadata.fileName, 'Merged.lshdr'); assert.equal(photo.metadata.orientation, 1); assert.equal(photo.extractedMetadata, null);
		assert.equal(photo.versions.length, 1); assert.deepEqual(photo.versions[0]!.develop, defaultImageDevelopStateV1()); assert.equal(photo.versions[0]!.workspace, undefined);
		assert.equal(photo.metadata.exposureSeconds, null); assert.equal(photo.metadata.aperture, null); assert.equal(photo.metadata.iso, null);
		assert.deepEqual(stored.parsed.provenance.inputs.map(input => [input.product, input.ownerId, input.sourceId, input.revision, input.profile, input.exposureMultiplier]),
			f.before.map(({ photo: source }) => ['lightscaper', f.catalogId, source.id, source.revision, 'linear-srgb16', 1]));
		await f.assertSources(); await f.f.session.close();
		const reopened = await f.openCurrent(); let borrowed: Float32Array | undefined;
		try { const original = reopened.develop.original; assert.ok(original);
			await original.withFrame({ schemaVersion: 1, photoId: photo.id, expectedRevision: 0 }, view => {
				assert.ok(view.frame.pixels instanceof Float32Array); borrowed = view.frame.pixels;
				assert.deepEqual([...view.frame.pixels], f.words.map((word, index) => index % 4 === 3 ? 1 : Math.fround(word / 65535)));
			}); assert.ok(borrowed?.every(value => value === 0));
		} finally { await reopened.close(); }
	} finally { await f.close(); }
});

test('HDR Session request capture pins input revisions and explicit multipliers before the mutation awaits, while malformed and pre-aborted requests do no work', OPTIONS, async () => {
	const f = await fixture();
	try {
		const cap = child(f.f.session), selected = f.mergeRequest(), before = f.workers.statistics.created;
		const request = { ...selected, inputs: selected.inputs.map(input => ({ ...input })) } satisfies MergeRequest;
		const work = cap.merge(request);
		request.inputs[0]!.expectedRevision++; request.inputs[1]!.exposureMultiplier = 4; request.fileName = 'Replaced.lshdr';
		const result = await work; assert.ok(result.receipt.photoId); const stored = await f.inspectResult(result.receipt.photoId);
		assert.equal(stored.photo.original.name, 'Merged.lshdr'); assert.deepEqual(stored.parsed.provenance.inputs.map(input => input.exposureMultiplier), [1, 1]);
		assert.equal(f.workers.statistics.created - before, 2);
		const after = f.workers.statistics.created;
		for (const request of [{ ...f.mergeRequest(), inputs: [] }, { ...f.mergeRequest(), inputs: [f.mergeRequest().inputs[0]!, f.mergeRequest().inputs[0]!] },
			{ ...f.mergeRequest(), referenceIndex: 2 }, { ...f.mergeRequest(), fileName: '../escape.lshdr' }]) await assert.rejects(cap.merge(request));
		const stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); stop.abort(opaque.proxy);
		const outcome = await observed(cap.merge(new Proxy(f.mergeRequest(), { ownKeys() { throw new Error('Pre-abort must precede reflection.'); } }), { signal: stop.signal }));
		assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, opaque.proxy)); assert.equal(f.workers.statistics.created, after); assert.equal(f.files.size, 0);
	} finally { await f.close(); }
});

test('HDR selection never presents edited capture metadata as immutable exposure advice', OPTIONS, async () => {
	const f = await fixture();
	try {
		const cap = child(f.f.session);
		for (const [index, source] of f.before.entries()) await f.catalog.savePhoto({ ...source.photo,
			metadata: { ...source.photo.metadata, exposureSeconds: index ? .04 : .01, aperture: 4, iso: 100 } }, source.photo.revision);
		const selection = await cap.readSelection({ schemaVersion: 1, photoIds: f.photoIds });
		assert.equal(selection.suggestedExposureMultipliers, null);
		assert.deepEqual(selection.sources.map(source => [source.exposureSeconds, source.aperture, source.iso]), [[null, null, null], [null, null, null]]);
	} finally { await f.close(); }
});

test('actual DNG Exif shutter ratios suggest [1,4] only when immutable aperture and ISO both match', OPTIONS, async () => {
	const first = { shutterDenominator: 100, aperture: 4, iso: 100 };
	for (const [aperture, iso, compatible] of [[4, 100, true], [5, 100, false], [4, 200, false]] as const) {
		const f = await fixture([first, { shutterDenominator: 25, aperture, iso }]);
		try {
			const extracted = f.before.map(({ photo }) => photo.extractedMetadata?.exif);
			assert.deepEqual(extracted.map(exif => [exif?.exposureSeconds, exif?.aperture, exif?.iso]), [[.01, 4, 100], [.04, aperture, iso]]);
			const created = f.workers.statistics.created, selection = await child(f.f.session).readSelection({ schemaVersion: 1, photoIds: f.photoIds });
			assert.deepEqual(selection.sources.map(source => [source.exposureSeconds, source.aperture, source.iso]), [[.01, 4, 100], [.04, aperture, iso]]);
			assert.deepEqual(selection.suggestedExposureMultipliers, compatible ? [1, 4] : null);
			assert.equal(f.workers.statistics.created, created); assert.equal(f.files.size, 0); await f.assertSources();
		} finally { await f.close(); }
	}
});

test('HDR Session rejects stale selected revisions before native sampling and guards a cross-connection source save at the actual publication transaction', OPTIONS, async () => {
	const f = await fixture(), descriptor = Object.getOwnPropertyDescriptor(PhotoCatalogRepositoryCurrentV1.prototype, 'publishDerivedPhotoCurrentV1')!;
	const native = PhotoCatalogRepositoryCurrentV1.prototype.publishDerivedPhotoCurrentV1; let raced = false;
	try {
		const cap = child(f.f.session), created = f.workers.statistics.created, invalid = f.mergeRequest();
		await assert.rejects(cap.merge({ ...invalid, inputs: invalid.inputs.map((input, index) => ({ ...input, expectedRevision: index ? input.expectedRevision : input.expectedRevision + 1 })) }));
		assert.equal(f.workers.statistics.created, created);
		// This observer is installed before a fresh Session captures the real native
		// method, then delegates to that native method after the independent save.
		Object.defineProperty(PhotoCatalogRepositoryCurrentV1.prototype, 'publishDerivedPhotoCurrentV1', { ...descriptor,
			value: async function (this: PhotoCatalogRepositoryCurrentV1, ...args: Parameters<typeof native>) {
				if (!raced) { raced = true; const source = f.before[0]!.photo; await f.catalog.savePhoto({ ...source, rating: 4 }, source.revision); }
				return Reflect.apply(native, this, args) as ReturnType<typeof native>;
			} });
		await f.f.session.close(); const session = await f.openCurrent(), acknowledged: PhotoLibraryImportItemV1[] = [];
		try { const result = await child(session).merge(f.mergeRequest(), { onAcknowledged: value => { acknowledged.push(value); } });
			assert.equal(raced, true); assert.equal(result.receipt.status, 'failed'); assert.deepEqual(acknowledged, []); assert.equal(f.files.size, 0);
		} finally { await session.close(); }
	} finally { Object.defineProperty(PhotoCatalogRepositoryCurrentV1.prototype, 'publishDerivedPhotoCurrentV1', descriptor); await f.close(); }
});

test('HDR Session Close joins an accepted native staging write and releases the existing mutation lease before resources close', OPTIONS, async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	try {
		const cap = child(f.f.session), acknowledged: unknown[] = []; let held = false;
		f.hooks.write = async () => { if (!held) { held = true; entered.resolve(); await release.promise; } };
		const merge = cap.merge(f.mergeRequest(), { onAcknowledged: value => { acknowledged.push(value); } }), outcome = observed(merge);
		await entered.promise; const closing = f.f.session.close(); assert.equal(await remainsPending(merge), true); assert.equal(await remainsPending(closing), true);
		await assert.rejects(cap.readSelection({ schemaVersion: 1, photoIds: f.photoIds }));
		release.resolve(); const stopped = await outcome; assert.ok(!stopped.ok); await closing;
		assert.deepEqual(acknowledged, []); assert.equal(f.files.size, 0); assert.equal(f.leases.size, 0); assert.equal(f.workers.active(), 0);
	} finally { release.resolve(); await f.close(); }
});

test('HDR Session retains a real native ACK through opaque cancellation after commit and startup recovery never replays selected-source guards', OPTIONS, async () => {
	const f = await fixture(), descriptor = Object.getOwnPropertyDescriptor(PhotoCatalogRepositoryCurrentV1.prototype, 'publishDerivedPhotoCurrentV1')!;
	const native = PhotoCatalogRepositoryCurrentV1.prototype.publishDerivedPhotoCurrentV1, stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	let saved = false;
	Object.defineProperty(PhotoCatalogRepositoryCurrentV1.prototype, 'publishDerivedPhotoCurrentV1', { ...descriptor,
		value: async function (this: PhotoCatalogRepositoryCurrentV1, ...args: Parameters<typeof native>) {
			const result = await Reflect.apply(native, this, args) as Awaited<ReturnType<typeof native>>;
			if (!saved) { saved = true; const source = f.before[0]!.photo; await f.catalog.savePhoto({ ...source, rating: 5 }, source.revision); stop.abort(opaque.proxy); }
			return result;
		} });
	try {
		await f.f.session.close(); const session = await f.openCurrent(), acknowledged: PhotoLibraryImportItemV1[] = [];
		try { const outcome = await observed(child(session).merge(f.mergeRequest(), { signal: stop.signal, onAcknowledged: value => { acknowledged.push(value); } }));
			assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, opaque.proxy)); assert.equal(acknowledged.length, 1); assert.equal(acknowledged[0]!.status, 'imported');
		} finally { await session.close(); }
		Object.defineProperty(PhotoCatalogRepositoryCurrentV1.prototype, 'publishDerivedPhotoCurrentV1', descriptor);
		const reopened = await f.openCurrent();
		try { await reopened.readPage(); assert.ok(acknowledged[0]!.photoId); const retained = await f.inspectResult(acknowledged[0]!.photoId);
			await f.media.verifyOriginal(retained.photo.original); assert.equal(f.files.size, 0); assert.equal(f.leases.size, 0);
		} finally { await reopened.close(); }
	} finally { Object.defineProperty(PhotoCatalogRepositoryCurrentV1.prototype, 'publishDerivedPhotoCurrentV1', descriptor); await f.close(); }
});

test('permanent Session V3 does not expose the Current HDR child', OPTIONS, async () => {
	const f = await fixture();
	try { const legacy = await f.openLegacy();
		try { assert.equal(Object.hasOwn(legacy, 'hdrMergeCurrent'), false); } finally { await legacy.close(); }
	} finally { await f.close(); }
});

test('actual Current HDR preview evaluates two canonical native sources and lends independent full-plane display without journal, asset or catalog publication', OPTIONS, async () => {
	const f = await fixture();
	try {
		const cap = child(f.f.session); assert.equal(typeof cap.withPreview, 'function', 'Current HDR child requires its actual scoped preview');
		const preview = cap.withPreview!, root = await f.catalog.loadCatalog(f.catalogId), created = f.workers.statistics.created;
		const assets = f.f.native.raw(f.mediaDatabaseName), databaseName = f.mediaDatabaseName;
		const beforeAssets = assets.records(databaseName, 'mediaAssets').length;
		let plane: Uint8Array<ArrayBuffer> | undefined;
		const result = await Reflect.apply(preview, cap, [f.mergeRequest(), (view: Readonly<ImageHdrMergePreviewCurrentV1>) => {
			plane = view.frame.pixels; assert.deepEqual(view.descriptor, { schemaVersion: 1, width: 96, height: 128, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' });
			assert.equal(view.frame.descriptor.width, 96); assert.equal(view.frame.descriptor.height, 128);
			const expected = f.words.map((word, index) => { if (index % 4 === 3) return 255; const linear = Math.fround(word / 65535);
				return Math.round(255 * (linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055)); });
			assert.deepEqual([...view.frame.pixels], expected); assert.equal(f.files.size, 0); assert.equal(f.workers.active(), 0); return 'painted';
		}]) as string;
		assert.equal(result, 'painted'); assert.ok(plane?.every(value => value === 0)); assert.equal(f.workers.statistics.created - created, 2);
		assert.deepEqual(await f.catalog.loadCatalog(f.catalogId), root); assert.equal(assets.records(databaseName, 'mediaAssets').length, beforeAssets);
		assert.equal(await f.media.settingsRepository.get(photoImportIntentKeyV1(f.catalogId)), undefined); await f.assertSources();
	} finally { await f.close(); }
});

test('HDR scoped preview joins a held painter, rechecks changed source authority and wipes the delivered display before refusing stale presentation', OPTIONS, async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	try {
		const cap = child(f.f.session); assert.equal(typeof cap.withPreview, 'function'); const preview = cap.withPreview!;
		let plane: Uint8Array<ArrayBuffer> | undefined;
		const work = Reflect.apply(preview, cap, [f.mergeRequest(), async (view: Readonly<ImageHdrMergePreviewCurrentV1>) => {
			plane = view.frame.pixels; entered.resolve(); await release.promise;
		}]) as Promise<void>, outcome = observed(work);
		await entered.promise; const source = f.before[0]!.photo; await f.catalog.savePhoto({ ...source, rating: 2 }, source.revision);
		assert.equal(await remainsPending(work), true); assert.ok(plane?.some(value => value !== 0)); release.resolve();
		assert.equal((await outcome).ok, false); assert.ok(plane?.every(value => value === 0)); assert.equal(f.files.size, 0);
		assert.equal(await f.media.settingsRepository.get(photoImportIntentKeyV1(f.catalogId)), undefined);
	} finally { release.resolve(); await f.close(); }
});
