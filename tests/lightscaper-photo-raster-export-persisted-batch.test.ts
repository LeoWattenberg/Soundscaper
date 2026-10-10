/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoRasterPersistedBatch, readPhotoRasterExportBinding } from '../src/lightscaper/controller/photo-raster-export-persisted-batch.ts';
import { openPhotoLibraryExportJournalSession } from '../src/lightscaper/controller/photo-library-export-journal-session.ts';
import { PhotoLibrarySessionLifetime } from '../src/lightscaper/controller/photo-library-session-lifetime.ts';
import { PhotoRasterExportBatchQueue } from '../src/lightscaper/controller/photo-raster-export-batch-queue.ts';
import { capturePhotoRasterExportBatchV1 } from '../src/lightscaper/controller/photo-raster-export-batch-v1.ts';
import { normalizePhotoRasterExportJournalV1 } from '../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
import { createPhotoMediaCubeLutResourcesV1 } from '../src/lightscaper/storage/photo-media-cube-lut-resources-v1.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { lutArchiveFixture, LUT_REFERENCE, LUT_BODY } from './helpers/lightscaper-lut-archive-fixture.ts';
import { canonicalJsonSha256 } from '../src/common/canonical-json-sha256.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { encodePixelFramePngV1 } from '../src/common/editor/imaging/pixel-frame-png-v1.ts';
import type { BrowserFileSaveRequest, BrowserSavedFile, PreparedBrowserSave } from '../src/common/editor/browser-file-save-service.ts';
import type { ExecutePhotoDevelopV2 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-v2.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

// The maintained memory repositories exercise actual CAS/resource admission;
// their three-byte original is an admitted unit-storage oracle, not UI ingest.
async function fixture(count = 1) {
	const base = lutArchiveFixture().record, photos = new Map<string, ReturnType<typeof normalizePhotoDocumentV2>>(), originals = new Map<string, Blob>();
	for (let index = 1; index <= count; index++) {
		const photo = normalizePhotoDocumentV2({ ...base.photo, id: `photo-${index}`, original: { ...base.photo.original, storageKey: `original-${index}` } });
		photos.set(photo.id, photo); originals.set(photo.original.storageKey, base.original);
	}
	const memory = getMemoryDatabase(`persisted-export-${crypto.randomUUID()}`), port = { memory, database: async () => null };
	const repository = new KeyValueRepository(port, 'settings'), lifetime = new PhotoLibrarySessionLifetime();
	const resources = createPhotoMediaCubeLutResourcesV1(port, operation => operation(), () => lifetime.assertAccepting());
	await resources.resources.put(LUT_REFERENCE, LUT_BODY);
	const events: string[] = [], held = deferred<void>(), entered = deferred<void>(); let holdIntent = false, holdCreate = false, holdLastRead = false, publicationFailure = false;
	const settings = {
		get: repository.get.bind(repository),
		async putIfAbsent(key: string, next: unknown) { if (holdCreate) { entered.resolve(); await held.promise; } return repository.putIfAbsent(key, next); },
		async replaceIfCurrent(key: string, before: unknown, next: unknown) {
			const journal = normalizePhotoRasterExportJournalV1(next);
			if (holdIntent && journal.members.some(member => member.state === 'started')) { entered.resolve(); await held.promise; }
			if (publicationFailure && journal.members.some(member => member.state === 'committed')) throw Symbol('publication');
			return repository.replaceIfCurrent(key, before, next);
		},
	};
	const host = { settings, ready: async () => base.photo.catalogId, catalog: { loadPhoto: async (_catalog: string, id: string) => photos.get(id) ?? null },
		loadOriginal: async (original: { storageKey: string }) => { events.push('original-verification'); const body = originals.get(original.storageKey); if (!body) throw new ReferenceError('Original missing'); return body; },
		verifyResources: async (photo: unknown, signal?: AbortSignal) => { events.push('lut-verification'); await resources.resources.verifyPhoto(photo, signal); },
		operation: lifetime.operation.bind(lifetime),
	};
	const stop = new AbortController();
	const execute: ExecutePhotoDevelopV2 = async (action, signal) => {
		await action({ signal: signal ?? stop.signal, isCurrent: () => true, refresh: async () => undefined, acquire: async () => ({ schemaVersion: 2,
			read: async request => { const photo = photos.get(request.photoId)!; return { schemaVersion: 2, catalogId: photo.catalogId, photoId: photo.id,
				revision: photo.revision, activeVersionId: photo.activeVersionId, versionId: photo.activeVersionId,
				versions: [], develop: photo.versions[0]!.develop, history: { cursor: 0, entries: [] }, snapshots: [] }; }, apply: async () => assert.fail('Export cannot edit photos') }) });
		return 'completed';
	};
	const selection = [...photos.values()].map(photo => ({ photoId: photo.id, fileName: photo.metadata.fileName }));
	const prepare = (selected = selection) => PhotoRasterPersistedBatch.prepare({ selection: selected, execute, signal: stop.signal,
		readSidecar: async request => { if (holdLastRead) { entered.resolve(); await held.promise; } return serializePhotoExportSidecarV1(createPhotoExportSidecarV1(photos.get(request.photoId), request)); },
		openJournal: options => openPhotoLibraryExportJournalSession(host, options) });
	const plan = (owner: PhotoRasterPersistedBatch, batchId = 'batch') => capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId, format: 'png', filenameTemplate: '{index:2}-{name}', members: owner.prepared!.members });
	const runtime = {
		prepareSave(request: BrowserFileSaveRequest): PreparedBrowserSave { assert.equal(this, runtime); assert.ok(typeof request.fileName === 'string'); events.push('prepare'); return { mode: 'blob', target: request.target!, fileName: request.fileName }; },
		saveFile(request: BrowserFileSaveRequest): BrowserSavedFile { assert.equal(this, runtime); assert.ok(typeof request.fileName === 'string'); events.push(`native:${request.fileName}`); return { method: 'download', fileName: request.fileName, size: request.blob!.size }; },
	};
	return { photos, originals, memory, repository, host, resources, events, held, entered, stop, execute, prepare, plan, runtime,
		holdIntent: () => { holdIntent = true; }, holdCreate: () => { holdCreate = true; }, holdLastRead: () => { holdLastRead = true; }, failPublication: () => { publicationFailure = true; },
		close: () => lifetime.close(() => resources.close()) };
}
function request(fileName: string): BrowserFileSaveRequest { return { fileName, blob: new Blob(['encoded']), signal: new AbortController().signal }; }

test('persisted work binds the actual admitted selected sidecar original and complete recipe', async () => {
	const { photo } = photoArchiveFixture(), versionId = photo.activeVersionId;
	const request = { catalogId: photo.catalogId, photoId: photo.id, versionId, expectedRevision: photo.revision }, sidecar = createPhotoExportSidecarV1(photo, request);
	const binding = await readPhotoRasterExportBinding(request, async () => serializePhotoExportSidecarV1(sidecar), new AbortController().signal);
	assert.deepEqual(binding, { originalSha256: photo.original.contentSha256, recipeSha256: canonicalJsonSha256(sidecar.version.develop), lutSha256: [] });
});

test('a refused selected binding joins its held sibling before preserving the opaque failure', async () => {
	const f = await fixture(2), primary = Symbol('refused saved binding'), entered = deferred<void>(), held = deferred<void>();
	const work = PhotoRasterPersistedBatch.prepare({ signal: f.stop.signal, execute: f.execute,
		selection: [...f.photos.values()].map(photo => ({ photoId: photo.id, fileName: photo.metadata.fileName })),
		openJournal: options => openPhotoLibraryExportJournalSession(f.host, options),
		readSidecar: async request => {
			if (request.photoId === 'photo-1') throw primary;
			entered.resolve(); await held.promise;
			return serializePhotoExportSidecarV1(createPhotoExportSidecarV1(f.photos.get(request.photoId), request));
		} });
	void work.catch(() => undefined);
	try {
		await entered.promise; assert.equal(await remainsPending(work), true);
		held.resolve(); await assert.rejects(work, cause => cause === primary);
	} finally { held.resolve(); await work.catch(() => undefined); await f.close(); }
});

for (const change of ['original', 'disabled-lut'] as const) test(`a held last scalar read followed by ${change} replacement still verifies bodies immediately before native`, async () => {
	const f = await fixture(), owner = await f.prepare(), plan = f.plan(owner), destinations = await owner.prepareFreshDestinations(plan, f.runtime, '{index:2}-{name}'); f.holdLastRead();
	const work = Promise.resolve(destinations.saveFile(plan.members[0]!, request(plan.members[0]!.fileName)));
	try {
		await f.entered.promise;
		if (change === 'original') f.originals.set(f.photos.get('photo-1')!.original.storageKey, new Blob([Uint8Array.of(3, 2, 1)]));
		else { const row = f.memory.analysis.get(LUT_REFERENCE.storageKey) as { value: { bytes: Uint8Array } }; row.value.bytes[0] = 0; }
		f.held.resolve(); await assert.rejects(work); assert.equal(f.events.some(event => event.startsWith('native:')), false);
		await assert.rejects(destinations.retireAndJoin());
	} finally { f.held.resolve(); await work.catch(() => undefined); await owner.closeAndJoin(); await f.close(); }
});

test('opening and reopening classify body-free fingerprints without acquiring destinations or original/LUT bodies', async () => {
	const f = await fixture(), owner = await f.prepare();
	try {
		assert.deepEqual(f.events, []); const plan = f.plan(owner), destinations = await owner.prepareFreshDestinations(plan, f.runtime, '{index:2}-{name}');
		assert.deepEqual(owner.journal!.members[0]!.binding.lutSha256, [LUT_REFERENCE.sha256]); await destinations.retireAndJoin();
		const reopened = await f.prepare([]); assert.equal(reopened.recovery[0]!.disposition, 'eligible'); assert.deepEqual(f.events, []); await reopened.closeAndJoin();
	} finally { await owner.closeAndJoin(); await f.close(); }
});

for (const change of ['original', 'disabled-lut', 'revision', 'recipe', 'active-version'] as const) test(`held durable intent followed by same-generation ${change} change refuses native publication`, async () => {
	const f = await fixture(), owner = await f.prepare(); f.holdIntent();
	const plan = f.plan(owner), destinations = await owner.prepareFreshDestinations(plan, f.runtime, '{index:2}-{name}'), member = plan.members[0]!;
	await destinations.prepareSave(member, request(member.fileName)); const work = Promise.resolve(destinations.saveFile(member, request(member.fileName)));
	try {
		await f.entered.promise; assert.equal(await remainsPending(work), true);
		const photo = f.photos.get(member.photoId)!;
		if (change === 'original') f.originals.set(photo.original.storageKey, new Blob([Uint8Array.of(3, 2, 1)]));
		else if (change === 'disabled-lut') {
			const row = f.memory.analysis.get(LUT_REFERENCE.storageKey) as { value: { bytes: Uint8Array } }; row.value.bytes[0] = 0;
		} else if (change === 'revision') f.photos.set(photo.id, normalizePhotoDocumentV2({ ...photo, revision: photo.revision + 1 }));
		else if (change === 'recipe') f.photos.set(photo.id, normalizePhotoDocumentV2({ ...photo, versions: photo.versions.map(version => ({ ...version, develop: { ...version.develop, effects: [] } })) }));
		else f.photos.set(photo.id, normalizePhotoDocumentV2({ ...photo, activeVersionId: 'other', versions: [...photo.versions, { ...photo.versions[0]!, id: 'other', kind: 'virtual-copy' }] }));
		f.held.resolve(); await assert.rejects(work); assert.equal(f.events.some(event => event.startsWith('native:')), false);
		assert.equal(owner.journal!.members[0]!.state, 'started'); await assert.rejects(destinations.retireAndJoin());
		const reopened = await f.prepare([]); assert.equal(reopened.recovery[0]!.disposition, 'needs-review'); await reopened.closeAndJoin();
	} finally { f.held.resolve(); await work.catch(() => undefined); await owner.closeAndJoin(); await f.close(); }
});

test('the original gesture pins native save receivers before a held journal creation', async () => {
	const f = await fixture(), owner = await f.prepare(); f.holdCreate(); const plan = f.plan(owner);
	const preparing = owner.prepareFreshDestinations(plan, f.runtime, '{index:2}-{name}');
	f.runtime.prepareSave = () => assert.fail('Late prepare substitution'); f.runtime.saveFile = () => assert.fail('Late save substitution');
	try {
		await f.entered.promise; f.held.resolve(); const destinations = await preparing, member = plan.members[0]!;
		await destinations.prepareSave(member, request(member.fileName)); await destinations.saveFile(member, request(member.fileName));
		assert.deepEqual(f.events.filter(event => event.startsWith('native:')), ['native:01-Photo 1.png']); assert.equal(owner.journal!.members[0]!.state, 'committed'); await destinations.retireAndJoin();
	} finally { f.held.resolve(); await preparing.catch(() => undefined); await owner.closeAndJoin(); await f.close(); }
});

test('download-started ACK survives failed durable publication and reopen demands explicit review', async () => {
	const f = await fixture(), owner = await f.prepare(), plan = f.plan(owner), destinations = await owner.prepareFreshDestinations(plan, f.runtime, '{index:2}-{name}');
	try {
		f.failPublication(); const member = plan.members[0]!, saved = await destinations.saveFile(member, request(member.fileName));
		assert.ok('method' in saved); assert.equal(saved.method, 'download'); assert.equal(owner.journal!.members[0]!.state, 'started'); await destinations.retireAndJoin();
		const reopened = await f.prepare([]); assert.equal(reopened.recovery[0]!.disposition, 'needs-review');
		assert.throws(() => reopened.prepareRecoveryDestinations(plan, f.runtime, [])); await reopened.closeAndJoin();
	} finally { await owner.closeAndJoin(); await f.close(); }
});

test('explicit reviewed recovery enqueues only unfinished original ordinals and encodes through the existing owner', async () => {
	const f = await fixture(4), initial = await f.prepare(), full = f.plan(initial), destinations = await initial.prepareFreshDestinations(full, f.runtime, '{index:2}-{name}');
	try {
		for (const index of [0, 2]) await destinations.saveFile(full.members[index]!, request(full.members[index]!.fileName));
		await destinations.retireAndJoin(); const reopened = await f.prepare([]);
		assert.deepEqual(reopened.recovery.map(row => row.disposition), ['already-committed', 'eligible', 'already-committed', 'eligible']);
		const queue = new PhotoRasterExportBatchQueue({ fileTypeDescription: 'PNG', execute: f.execute,
			prepareDestinations: plan => reopened.prepareRecoveryDestinations(plan, f.runtime, []),
			withOriginalFrame: async (bound, consume) => consume({ photoId: bound.photoId, revision: 0, frame: {
				descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: Uint8Array.of(32, 64, 96, 255) } }),
			loadRenderer: async () => createPhotoDevelopRenderRuntimeV2({ source: f.resources.resources.source }), encode: (_kind, frame, options) => encodePixelFramePngV1(frame, options) });
		const receipt = await queue.startRecovery(reopened.journal, ['batch:4', 'batch:2']);
		assert.deepEqual(receipt.members.map(member => [member.jobId, member.index, member.fileName, member.delivery?.status]),
			[['batch:2', 2, '02-Photo 1.png', 'download-started'], ['batch:4', 4, '04-Photo 1.png', 'download-started']]);
		assert.equal(f.events.filter(event => event === 'native:01-Photo 1.png').length, 1); assert.equal(f.events.filter(event => event === 'native:03-Photo 1.png').length, 1);
		await reopened.closeAndJoin();
	} finally { await initial.closeAndJoin(); await f.close(); }
});

test('closed Session retirement joins a held intent and forbids later native delivery', async () => {
	const f = await fixture(), owner = await f.prepare(), plan = f.plan(owner), destinations = await owner.prepareFreshDestinations(plan, f.runtime, '{index:2}-{name}'); f.holdIntent();
	const work = Promise.resolve(destinations.saveFile(plan.members[0]!, request(plan.members[0]!.fileName)));
	try {
		await f.entered.promise; const close = f.close(); assert.equal(await remainsPending(close), true); f.held.resolve();
		await assert.rejects(work); await close; assert.equal(f.events.some(event => event.startsWith('native:')), false); await assert.rejects(destinations.retireAndJoin());
	} finally { f.held.resolve(); await work.catch(() => undefined); await owner.closeAndJoin(); await f.close(); }
});

test('completed history needs explicit replacement and a distinct batch before any authority admission', async () => {
	const f = await fixture(), owner = await f.prepare(), plan = f.plan(owner), destinations = await owner.prepareFreshDestinations(plan, f.runtime, '{index:2}-{name}');
	try {
		await destinations.saveFile(plan.members[0]!, request(plan.members[0]!.fileName)); await destinations.retireAndJoin(); const reopened = await f.prepare();
		assert.throws(() => reopened.prepareFreshDestinations(f.plan(reopened, 'next'), {}, '{index:2}-{name}'));
		assert.throws(() => reopened.prepareFreshDestinations(plan, {}, '{index:2}-{name}', true), /different/u);
		const next = await reopened.prepareFreshDestinations(f.plan(reopened, 'next'), f.runtime, '{index:2}-{name}', true);
		assert.equal(reopened.journal!.batchId, 'next'); assert.equal(reopened.journal!.revision, 4); await next.retireAndJoin(); await reopened.closeAndJoin();
	} finally { await owner.closeAndJoin(); await f.close(); }
});

test('composition captures own callback receivers before opening and refuses accessors without invocation', async () => {
	const f = await fixture(), signal = f.stop.signal; let reads = 0;
	const options = {
		selection: [{ photoId: 'photo-1', fileName: 'Photo 1.png' }], signal,
		async openJournal(input: { signal: AbortSignal }) { assert.equal(this, options); return openPhotoLibraryExportJournalSession(f.host, input); },
		async execute(...args: Parameters<ExecutePhotoDevelopV2>) { assert.equal(this, options); return f.execute(...args); },
		async readSidecar(bound: { catalogId: string; photoId: string; versionId: string; expectedRevision: number }) { assert.equal(this, options); return serializePhotoExportSidecarV1(createPhotoExportSidecarV1(f.photos.get(bound.photoId), bound)); },
	};
	try {
		const owner = await PhotoRasterPersistedBatch.prepare(options); await owner.closeAndJoin();
		const accessor = Object.defineProperty({ ...options }, 'selection', { enumerable: true, get() { reads++; return options.selection; } });
		await assert.rejects(PhotoRasterPersistedBatch.prepare(accessor)); assert.equal(reads, 0);
	} finally { await f.close(); }
});
