/* SPDX-License-Identifier: AGPL-3.0-only */

// Actual selected Session/catalog/media owners with controlled Node IDB ports.
// Source hooks forward real immutable body reads; no native browser claim.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after } from 'node:test';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js/index-native.js';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from '../src/lightscaper/controller/photo-library-session-ports-v2.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { createPhotoDevelopWorkspaceV2, commitPhotoDevelopWorkspaceV2, selectPhotoDevelopHistoryV2 } from '../src/lightscaper/catalog/photo-develop-workspace-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import type { BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { importPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-import-v5.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const CLOCK = '2026-10-11T00:00:00.000Z';
type Placement = 'none' | 'active' | 'inactive' | 'history' | 'redo' | 'snapshot' | 'disabled' | 'unbound' | 'unused';
function body(alpha: readonly number[]) {
	const bytes = Uint8Array.from([83, 67, 77, 65, 83, 75, 48, 49, alpha.length, 0, 0, 0, 1, 0, 0, 0, ...alpha]);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	return { bytes, reference: Object.freeze({ storageKey: `brush-mask-v1:${alpha.length}:1:${sha256}`, sha256,
		width: alpha.length, height: 1, byteLength: bytes.byteLength }) };
}
const BODIES = [body([0, 64, 128, 255]), body([193])] as const;
function recipe(placement: Placement) {
	return { ...defaultImageDevelopStateV1(), processVersion: 2,
		effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled: placement === 'active', params: { exposure: 1 } }],
		masks: [{ schemaVersion: 1, id: 'brush', kind: 'mask',
			inputs: [{ name: 'Brush', sourceRef: BODIES[0].reference.storageKey, kind: 'alpha' },
				...(placement === 'unused' ? [{ name: 'Unused', sourceRef: BODIES[1].reference.storageKey, kind: 'alpha' }] : [])],
			nodes: [{ id: 'output', kind: 'alpha', inputName: 'Brush' }], outputNodeId: 'output' }],
		maskBindings: placement === 'active' || placement === 'disabled' ? [{ effectId: 'tone', maskId: 'brush' }] : [] };
}
function placed(index: number, placement: Placement) {
	const input = photoArchiveFixture(index), master = input.photo.versions[0]!, develop = recipe(placement);
	let versions: unknown[] = [master];
	if (placement === 'inactive') versions = [master, { ...master, id: `inactive-${index}`, kind: 'virtual-copy', name: 'Retained brush', develop }];
	else if (['history', 'redo', 'snapshot'].includes(placement)) {
		let workspace = createPhotoDevelopWorkspaceV2(master.develop, { label: 'Original', createdAt: CLOCK });
		workspace = commitPhotoDevelopWorkspaceV2(workspace, develop, { label: 'Brush', createdAt: CLOCK });
		if (placement === 'history') workspace = commitPhotoDevelopWorkspaceV2(workspace, master.develop, { label: 'Neutral', createdAt: CLOCK });
		else if (placement === 'redo') workspace = selectPhotoDevelopHistoryV2(workspace, 0);
		else workspace = { ...workspace, cursor: 0, entries: workspace.entries.slice(0, 1),
			snapshots: [{ id: 'snapshot-brush', name: 'Snapshot brush', createdAt: CLOCK, develop: workspace.entries[1]!.develop }] };
		versions = [{ ...master, develop: workspace.entries[workspace.cursor]!.develop, workspace }];
	} else if (placement !== 'none') versions = [{ ...master, develop }];
	return { photo: normalizePhotoDocumentV2({ ...input.photo, schemaVersion: 2, versions }), original: input.original };
}
async function fixture(placement: Placement = 'redo', count = 2,
	extraBodies: readonly { bytes: Uint8Array<ArrayBuffer>; reference: Readonly<BrushMaskResourceReferenceV1> }[] = []) {
	const raw = createInstrumentedIndexedDB(), indexedDB = raw as unknown as IDBFactory, suffix = crypto.randomUUID();
	const media = new PhotoMediaStoreV1({ indexedDB, databaseName: `lightscaper-brush-backup-media-${suffix}`, preferOpfs: false, locks: null });
	const resources = await media.getMaskRasterResources(), luts = await media.getCubeLutResources();
	for (const input of [...BODIES, ...extraBodies]) await resources.put(input.reference, input.bytes);
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB, databaseName: `lightscaper-brush-backup-catalog-${suffix}`,
		verifyOriginal: media.verifyOriginal, verifyResources: resources.verifyPhoto });
	const records = Array.from({ length: count }, (_, index) => placed(index + 1, index === count - 1 ? placement : 'none'));
	if (extraBodies.length) {
		const input = records[records.length - 1]!, master = input.photo.versions[0]!;
		const inputs = extraBodies.map((entry, index) => ({ name: `Large${index}`, kind: 'alpha', sourceRef: entry.reference.storageKey }));
		records[records.length - 1] = { ...input, photo: normalizePhotoDocumentV2({ ...input.photo,
			versions: [{ ...master, develop: { ...recipe('unbound'), masks: [{ schemaVersion: 1, id: 'large', kind: 'mask',
				inputs, nodes: [{ id: 'output', kind: 'alpha', inputName: 'Large0' }], outputNodeId: 'output' }] } }] }) };
	}
	for (const input of records) await media.mediaRepository.writeAsset(input.photo.original.storageKey, input.original);
	let root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Brush custody', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	await catalog.createCatalog(root);
	for (let offset = 0; offset < records.length; offset += 16) {
		root = await catalog.publishPhotos(root.id, root.revision, records.slice(offset, offset + 16).map(input => input.photo));
	}
	const events: string[] = [], borrowed: Uint8Array<ArrayBuffer>[] = [];
	let sourceReads = 0, originalReads = 0, resourceCloses = 0;
	const hooks: { beforeBody?: (read: number, reference: Readonly<BrushMaskResourceReferenceV1>, bytes: Uint8Array<ArrayBuffer>) => Promise<void>;
		beforeOriginal?: () => Promise<void>; afterBody?: () => Promise<void>; beforeFactory?: () => Promise<void> } = {};
	const source: MaskRasterSourcePortV1 = { async withBytes<Result>(reference: Readonly<BrushMaskResourceReferenceV1>,
		consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result> {
		assert.equal(this, source); const read = ++sourceReads; events.push(`body:${reference.storageKey}`);
		const result = await resources.source.withBytes(reference, async bytes => {
			borrowed.push(bytes); await hooks.beforeBody?.(read, reference, bytes); return consume(bytes);
		}, options);
		await hooks.afterBody?.(); return result;
	} };
	const ports: PhotoLibrarySessionPortsV2 = { catalog, stacks: catalog, journal: media.settingsRepository,
		developPresetSettings: media.settingsRepository, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
		initialize: async () => root, exclusive: async (_catalogId, run, signal) => run(signal),
		cubeLutResources: async () => luts,
		maskRasterResources: async function () { assert.equal(this, ports); events.push('factory'); await hooks.beforeFactory?.(); return { ...resources, source }; },
		backup: { readSnapshot: (...args) => catalog.readSnapshot(...args), captureSmartCollectionArchiveV1: (...args) => catalog.captureSmartCollectionArchiveV1(...args),
			async loadOriginal(original, signal) { originalReads++; events.push('original'); await hooks.beforeOriginal?.();
				await media.verifyOriginal(original, signal); return media.mediaRepository.loadAsset(original.storageKey, { signal, expectedSize: original.byteLength }); } },
		closeResources: async () => { resourceCloses++; events.push('resources-close'); const results = await Promise.allSettled([catalog.close(), media.close()]);
			const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
			if (errors.length === 1) throw errors[0]; if (errors.length) throw new AggregateError(errors, 'Backup fixture cleanup failed.'); },
	};
	const session = new PhotoLibrarySessionV2(ports);
	return { raw, media, catalog, root, records, session, ports, source, hooks, events, borrowed,
		reads: () => sourceReads, originals: () => originalReads, closes: () => resourceCloses };
}
function target(events: string[]) {
	const parts: Uint8Array<ArrayBuffer>[] = [];
	const writable = new WritableStream<Uint8Array>({ write(bytes) { events.push('write'); parts.push(new Uint8Array(bytes)); },
		close() { events.push('commit'); }, abort() { events.push('abort'); } });
	return { parts, writable, createWritable: async () => { events.push('open'); return writable; } };
}
async function zip(blob: Blob) {
	const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false }), entries = new Map<string, Uint8Array>();
	try { for (const entry of await reader.getEntries()) if (!entry.directory) entries.set(entry.filename, await entry.getData(new Uint8ArrayWriter())); }
	finally { await reader.close(); }
	const document: unknown = JSON.parse(new TextDecoder().decode(entries.get('project.json')));
	assert.ok(document && typeof document === 'object');
	return { entries, document: document as Record<string, unknown> };
}
function outcome<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
async function enteredBeforeFailure(entered: Promise<void>, work: Promise<unknown>) {
	assert.equal(await Promise.race([entered.then(() => true), outcome(work).then(() => false)]), true, 'Actual source must be reached before backup settles.');
}

for (const placement of ['active', 'inactive', 'history', 'redo', 'snapshot', 'disabled', 'unbound', 'unused'] as const) {
	test(`selected backup authenticates complete ${placement} brush custody before originals and writable acquisition`, async () => {
		const f = await fixture(placement), destination = target(f.events), before = await f.catalog.readSnapshot(f.root.id);
		try {
			const result = await f.session.backupCatalog({ createWritable: destination.createWritable });
			assert.equal(result.blob, null); assert.deepEqual(result.notices, []);
			const firstOpen = f.events.indexOf('open'), firstOriginal = f.events.indexOf('original');
			const wanted = placement === 'unused' ? BODIES : [BODIES[0]];
			for (const input of wanted) assert.ok(f.events.indexOf(`body:${input.reference.storageKey}`) < firstOpen);
			assert.ok(firstOpen >= 0 && firstOriginal > firstOpen); assert.equal(f.events.at(-1), 'commit');
			assert.ok(f.reads() >= wanted.length * 3); assert.equal(f.originals(), 2);
			const archive = await zip(new Blob(destination.parts)); assert.equal(archive.document.schemaVersion, 6);
			assert.deepEqual(archive.document.maskRasters, [...wanted].sort((a, b) => a.reference.storageKey.localeCompare(b.reference.storageKey)).map(input => ({
				id: input.reference.storageKey, entry: `assets/masks/${input.reference.sha256}.scmask`, reference: input.reference })));
			for (const input of wanted) assert.deepEqual(archive.entries.get(`assets/masks/${input.reference.sha256}.scmask`), input.bytes);
			assert.deepEqual(await f.catalog.readSnapshot(f.root.id), before);
			for (const input of f.records) assert.deepEqual(await f.catalog.loadPhoto(f.root.id, input.photo.id), input.photo);
			assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
		} finally { await f.session.close(); }
	});
}

test('selected backup authenticates a later retained brush across the real 64-row page boundary before destination or originals', async () => {
	const f = await fixture('redo', 65), destination = target(f.events);
	try { await f.session.backupCatalog({ createWritable: destination.createWritable });
		assert.equal(f.originals(), 65); assert.ok(f.events.findIndex(event => event.startsWith('body:')) < f.events.indexOf('open'));
	} finally { await f.session.close(); }
});

test('selected backup serially authenticates seventeen maximum brush bodies beyond 16MiB with a compact scalar closure', async () => {
	const bodies = Array.from({ length: 17 }, (_, index) => {
		const bytes = new Uint8Array(16 + 1024 * 1024);
		bytes.set([83, 67, 77, 65, 83, 75, 48, 49, 0, 4, 0, 0, 0, 4, 0, 0]); bytes.fill(index + 1, 16);
		const sha256 = createHash('sha256').update(bytes).digest('hex');
		return { bytes, reference: Object.freeze({ storageKey: `brush-mask-v1:1024:1024:${sha256}`, sha256,
			width: 1024, height: 1024, byteLength: bytes.byteLength }) };
	});
	assert.ok(bodies.reduce((total, entry) => total + entry.bytes.byteLength, 0) > 16 * 1024 * 1024);
	assert.ok(new TextEncoder().encode(JSON.stringify(bodies.map(entry => entry.reference))).byteLength < 16 * 1024);
	const f = await fixture('none', 1, bodies);
	try {
		const result = await f.session.backupCatalog(); assert.ok(result.blob);
		assert.equal(f.originals(), 1); assert.ok(f.reads() >= 3 * bodies.length);
		assert.ok(f.events.findIndex(event => event.startsWith('body:')) < f.events.indexOf('original'));
		const archive = await zip(result.blob); assert.equal(archive.document.schemaVersion, 6);
		assert.ok(Array.isArray(archive.document.maskRasters)); assert.equal(archive.document.maskRasters.length, 17);
		for (const entry of bodies) assert.deepEqual(archive.entries.get(`assets/masks/${entry.reference.sha256}.scmask`), entry.bytes);
		assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await f.session.close(); }
});

test('a catalog without brush keeps exact V5 output and does not acquire the optional mask source', async () => {
	const f = await fixture('none');
	try { const result = await f.session.backupCatalog(); assert.ok(result.blob);
		assert.equal((await zip(result.blob)).document.schemaVersion, 5); assert.equal(f.reads(), 0); assert.equal(f.events.includes('factory'), false);
		let count = 0; await importPhotoCatalogArchiveV5(result.blob, async () => ({ async writePhoto(_photo, original) {
			for await (const _chunk of original) { /* authenticate and drain */ } count++;
		}, async writeStack() {}, async writeSavedCollection() {}, async writeDevelopPresets() {}, async writeLut() {}, async publish() {}, async rollback() {} }));
		assert.equal(count, 2);
	} finally { await f.session.close(); }
});

test('missing and corrupted selected brush bodies refuse before destination, originals or durable source mutation', async () => {
	for (const mode of ['missing', 'corrupt'] as const) {
		const f = await fixture('unused'), destination = target(f.events);
		f.hooks.beforeBody = async (_read, reference, bytes) => {
			if (reference.storageKey !== BODIES[1].reference.storageKey) return;
			if (mode === 'missing') throw new ReferenceError('The selected brush body is missing.'); bytes[16] = bytes[16]! ^ 255;
		};
		try { await assert.rejects(f.session.backupCatalog({ createWritable: destination.createWritable }), mode === 'missing' ? /selected brush body is missing/u : /SHA256/iu);
			assert.equal(f.originals(), 0); assert.equal(f.events.includes('open'), false); assert.equal(destination.writable.locked, false);
			await (await f.media.getMaskRasterResources()).verifyPhoto(f.records[1]!.photo);
			assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
		} finally { await f.session.close(); }
	}
});

test('held selected-body cancellation joins actual source cleanup and Session Close with the exact opaque first reason', async () => {
	const f = await fixture(), destination = target(f.events), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const reason = Proxy.revocable({}, {}); reason.revoke(); f.hooks.beforeBody = async () => { entered.resolve(); await release.promise; };
	const work = f.session.backupCatalog({ createWritable: destination.createWritable, signal: stop.signal }), observed = outcome(work);
	try { await enteredBeforeFailure(entered.promise, work); stop.abort(reason.proxy); const closing = f.session.close();
		assert.equal(closing, f.session.close()); assert.equal(await remainsPending(observed), true); assert.equal(await remainsPending(closing), true);
		assert.equal(f.closes(), 0); assert.equal(f.originals(), 0); assert.equal(f.events.includes('open'), false);
		release.resolve(); const result = await observed; assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error, reason.proxy);
		await closing; assert.equal(f.closes(), 1); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { release.resolve(); await observed; await f.session.close(); }
});

test('opaque selected source cleanup failure retains exact identity before any destination or original acquisition', async () => {
	const f = await fixture(), destination = target(f.events), entered = deferred<void>(), release = deferred<void>();
	const failure = Proxy.revocable({}, {}); failure.revoke(); f.hooks.afterBody = async () => { entered.resolve(); await release.promise; throw failure.proxy; };
	const work = f.session.backupCatalog({ createWritable: destination.createWritable }), observed = outcome(work);
	try { await enteredBeforeFailure(entered.promise, work); assert.equal(await remainsPending(observed), true); release.resolve();
		const result = await observed; assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error, failure.proxy);
		assert.equal(f.originals(), 0); assert.equal(f.events.includes('open'), false); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { release.resolve(); await observed; await f.session.close(); }
});

test('selected source method and receiver remain pinned through its awaited factory and before destination demand', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); let traps = 0;
	const read = f.source.withBytes;
	f.source.withBytes = new Proxy(read, { get() { traps++; throw new Error('Callable metadata was borrowed.'); } });
	f.hooks.beforeBody = async read => { if (read === 1) { entered.resolve(); await release.promise; } };
	const work = f.session.backupCatalog(), observed = outcome(work);
	try { await enteredBeforeFailure(entered.promise, work); f.source.withBytes = async () => { assert.fail('Late selected body method replacement was acquired.'); };
		release.resolve(); const result = await work; assert.ok(result.blob); assert.equal(traps, 0);
	} finally { release.resolve(); await observed; await f.session.close(); }
});

test('final selected-body failure after archive writes prevents destination Close and releases its lock', async () => {
	const f = await fixture(), destination = target(f.events); const failure = Object.freeze({ finalBody: 'failed' });
	f.hooks.beforeBody = async read => { if (read >= 3 && f.events.includes('write')) throw failure; };
	try { const result = await outcome(f.session.backupCatalog({ createWritable: destination.createWritable }));
		assert.equal(result.ok, false); assert.equal(f.events.includes('write'), true); assert.equal(f.events.includes('commit'), false);
		assert.equal(f.events.at(-1), 'abort'); assert.equal(destination.writable.locked, false);
	} finally { await f.session.close(); }
});
