/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { exportPhotoLibraryBackupV3, type PhotoLibraryBackupPortsV3 } from '../src/lightscaper/controller/photo-library-backup-v3.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { normalizePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { photoSmartCollectionSummaryRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { importPhotoCatalogArchiveV3 } from '../src/lightscaper/archive/catalog-archive-import-v3.ts';
import { AUDIT_DATABASE, auditStateV1, smartCollectionAuditFixtureV1 } from './helpers/lightscaper-smart-collection-audit-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { savedArchiveDestinationV3 } from './helpers/lightscaper-saved-collection-archive-fixture.ts';
import { stackArchiveFailure } from './helpers/lightscaper-stack-archive-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

async function fixture(photoCount = 2, savedCount = 1, hasStack = true) {
	const f = await smartCollectionAuditFixtureV1(), catalog = new PhotoCatalogRepositoryV1({ indexedDB: f.factory,
		databaseName: AUDIT_DATABASE, verifyOriginal: async () => undefined });
	const originals = new Map<string, Blob>(); let root = f.root;
	if (photoCount) {
		const sources = Array.from({ length: photoCount }, (_, index) => photoArchiveFixture(index + 1, new Uint8Array([index + 1, 2, 3])));
		for (const source of sources) originals.set(source.photo.original.storageKey, source.original);
		root = await catalog.publishPhotos(root.id, root.revision, sources.map(source => normalizePhotoDocumentV1({
			...source.photo, catalogId: root.id, folderId: 'folder', keywordIds: ['keyword'], collectionIds: ['manual'],
		})));
	}
	if (hasStack && photoCount >= 2) {
		await catalog.saveStack(normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: root.id,
			id: 'stack-1', revision: 0, photoIds: ['photo-2', 'photo-1'], coverPhotoId: 'photo-1' }), null,
		{ expectedCatalogRevision: root.revision, expectedStateRevision: 0 });
		const current = await catalog.loadCatalog(root.id); assert.ok(current); root = current;
	}
	const definitions = Array.from({ length: savedCount }, (_, index) => normalizePhotoSmartCollectionV1({
		schemaVersion: 1, kind: 'photo-smart-collection', catalogId: root.id, id: `saved-${index}`, revision: 17 + index,
		name: `Stored selection ${index} 界`, query: { schemaVersion: 2, kind: 'photo-catalog-query', text: 'Camera',
			filter: { kind: 'collection', id: 'manual' }, sort: { field: 'capture-time', direction: 'descending' },
			predicate: { kind: 'all', terms: [
				{ kind: 'any', terms: [{ kind: 'keyword', id: 'keyword' }, { kind: 'not', term: { kind: 'folder', id: 'folder' } }] },
				{ kind: 'text', column: 'camera-make', operator: 'contains', value: 'Nikon' },
				{ kind: 'number', column: 'width', minimum: 1, maximum: 64 }, { kind: 'presence', column: 'lens', value: 'unknown' },
			] } },
	}));
	if (savedCount) f.indexedDB.seedRecord(AUDIT_DATABASE, 'photoSmartCollectionStates', auditStateV1(savedCount, 31));
	for (const definition of definitions) f.seed(definition);
	const ports: PhotoLibraryBackupPortsV3 = { catalog, stacks: catalog,
		loadOriginal: async original => originals.get(original.storageKey) };
	return { ...f, catalog, root, definitions, ports, originals, close: async () => { await catalog.close(); f.close(); } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function catalogPorts(f: Fixture, overrides: Partial<PhotoLibraryBackupPortsV3['catalog']> = {}): PhotoLibraryBackupPortsV3['catalog'] {
	return { readSnapshot: f.catalog.readSnapshot.bind(f.catalog), readSummaryPage: f.catalog.readSummaryPage.bind(f.catalog),
		loadPhoto: f.catalog.loadPhoto.bind(f.catalog), captureSmartCollectionArchiveV1: f.catalog.captureSmartCollectionArchiveV1.bind(f.catalog),
		...overrides };
}
function destination(onClose?: () => void) {
	const parts: Uint8Array<ArrayBuffer>[] = []; let closed = false, aborted = false;
	const writable = new WritableStream<Uint8Array>({ write(bytes) { parts.push(new Uint8Array(bytes)); },
		close() { closed = true; onClose?.(); }, abort() { aborted = true; parts.length = 0; } });
	return { writable, parts, closed: () => closed, aborted: () => aborted };
}
function hasFailure(value: unknown, reason: unknown): boolean {
	return value === reason || value instanceof AggregateError && (value.errors as unknown[]).some(error => hasFailure(error, reason));
}

test('V3 joins a held snapshot using private native cancellation despite late caller method shadows', async () => {
	const f = await smartCollectionAuditFixtureV1(), catalog = new PhotoCatalogRepositoryV1({ indexedDB: f.factory,
		databaseName: 'smart-collection-audit', verifyOriginal: async () => undefined });
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(); let inspections = 0, originals = 0;
	const reason = new Proxy({}, { get() { inspections++; throw new Error('Opaque reason inspected.'); } });
	const work = exportPhotoLibraryBackupV3(f.root.id, { catalog: {
		readSummaryPage: catalog.readSummaryPage.bind(catalog), loadPhoto: catalog.loadPhoto.bind(catalog),
		captureSmartCollectionArchiveV1: catalog.captureSmartCollectionArchiveV1.bind(catalog),
		async readSnapshot(...args) {
			const snapshot = await catalog.readSnapshot(...args);
			Object.defineProperty(stop.signal, 'throwIfAborted', { get() { inspections++; throw new Error('Caller override inspected.'); } });
			entered.resolve(); await release.promise; return snapshot;
		},
	}, stacks: catalog, async loadOriginal() { originals++; assert.fail('Cancelled empty backup has no originals.'); } }, { signal: stop.signal });
	let failure: unknown; const joined = work.catch((error: unknown) => { failure = error; });
	try {
		await entered.promise; stop.abort(reason); assert.equal(await remainsPending(joined), true); release.resolve(); await joined;
		assert.equal(failure, reason); assert.equal(inspections, 0); assert.equal(originals, 0);
	} finally { release.resolve(); await joined; await catalog.close(); f.close(); }
});

test('actual V3 backup retains complete recipes, revisions, ordered stacks and original bytes without changing any store', async () => {
	const f = await fixture(2, 2), target = savedArchiveDestinationV3(), output = destination(), events: string[] = [];
	try {
		const before = f.snapshot(), expected = await f.catalog.readSnapshot(f.root.id); assert.ok(expected);
		const result = await exportPhotoLibraryBackupV3(f.root.id, { ...f.ports, catalog: catalogPorts(f, {
			async captureSmartCollectionArchiveV1(...args) {
				const capture = await f.catalog.captureSmartCollectionArchiveV1(...args); events.push('saved-audit'); return capture;
			},
		}), stacks: { readStackState: async (...args) => { events.push('stack-state'); return f.catalog.readStackState(...args); },
			readStackPage: f.catalog.readStackPage.bind(f.catalog), loadStack: f.catalog.loadStack.bind(f.catalog) },
		async loadOriginal(...args) { events.push('original'); assert.deepEqual(events.slice(0, 2), ['saved-audit', 'stack-state']); return f.ports.loadOriginal(...args); },
		}, { writable: output.writable });
		assert.equal(result.blob, null); assert.equal(output.closed(), true); assert.equal(output.aborted(), false); assert.equal(output.writable.locked, false);
		assert.deepEqual(result.document.catalog, expected.catalog); assert.deepEqual(result.document.savedCollectionState, auditStateV1(2, 31));
		assert.equal(result.document.stackCount, 1); assert.deepEqual(result.document.savedCollectionPacks.map(pack => pack.collectionCount), [2]);
		// This generic stage authenticates archived values; it does not publish a restored native database.
		const imported = await importPhotoCatalogArchiveV3(new Blob(output.parts), async (root, state) => {
			assert.deepEqual(root, expected.catalog); assert.deepEqual(state, auditStateV1(2, 31)); return target.stage;
		});
		assert.deepEqual(imported, expected.catalog); assert.deepEqual([...target.saved.values()], f.definitions);
		assert.deepEqual([...target.stacks.values()], [await f.catalog.loadStack(f.root.id, 'stack-1')]);
		for (const entry of target.photos.values()) {
			assert.deepEqual(entry.photo, await f.catalog.loadPhoto(f.root.id, entry.photo.id));
			const original = f.originals.get(entry.photo.original.storageKey); assert.ok(original);
			assert.deepEqual(entry.bytes, new Uint8Array(await original.arrayBuffer()));
		}
		assert.equal(target.photos.size, 2); assert.deepEqual(target.events.slice(-1), ['publish']);
		assert.deepEqual(f.snapshot(), before); assert.equal(f.indexedDB.stats.activeTransactions, 0); assert.equal(f.indexedDB.stats.getAllRequests.length, 0);
	} finally { await f.close(); }
});

for (const revision of [0, 99]) test(`persisted empty saved state retains physical revision ${revision}`, async () => {
	const f = await fixture(0, 0), target = savedArchiveDestinationV3();
	try {
		const state = auditStateV1(0, revision); f.indexedDB.seedRecord(AUDIT_DATABASE, 'photoSmartCollectionStates', state);
		const before = f.snapshot(), result = await exportPhotoLibraryBackupV3(f.root.id, f.ports); assert.ok(result.blob);
		assert.deepEqual(result.document.savedCollectionState, state); assert.deepEqual(result.document.savedCollectionPacks, []);
		await importPhotoCatalogArchiveV3(result.blob, async (_root, restoredState) => { assert.deepEqual(restoredState, state); return target.stage; });
		assert.deepEqual(f.snapshot(), before); assert.equal(target.saved.size, 0);
	} finally { await f.close(); }
});

for (const corruption of ['summary', 'hidden-reference', 'count', 'absent-state'] as const) {
	test(`${corruption} fails initial saved audit before originals or destination acquisition`, async () => {
		const f = await fixture(2, 2), output = destination(); let originalReads = 0;
		try {
			if (corruption === 'summary') f.indexedDB.seedRecord(AUDIT_DATABASE, 'photoSmartCollectionSummaries',
				photoSmartCollectionSummaryRecordV1({ ...f.definitions[1], name: 'Different summary' }));
			if (corruption === 'hidden-reference') f.seed(normalizePhotoSmartCollectionV1({ ...f.definitions[1], query: {
				...f.definitions[1]!.query, predicate: { kind: 'any', terms: [{ kind: 'rating', minimum: 0, maximum: 5 },
					{ kind: 'not', term: { kind: 'folder', id: 'missing-folder' } }] },
			} }));
			if (corruption === 'count') f.indexedDB.seedRecord(AUDIT_DATABASE, 'photoSmartCollectionStates', auditStateV1(1, 31));
			if (corruption === 'absent-state') {
				const tx = f.database.transaction('photoSmartCollectionStates', 'readwrite');
				await new Promise<void>((resolve, reject) => { tx.oncomplete = () => { resolve(); }; tx.onerror = () => { reject(tx.error); };
					tx.objectStore('photoSmartCollectionStates').delete(f.root.id); });
			}
			const before = f.snapshot();
			await assert.rejects(exportPhotoLibraryBackupV3(f.root.id, { ...f.ports,
				async loadOriginal(...args) { originalReads++; return f.ports.loadOriginal(...args); } }, { writable: output.writable }));
			assert.equal(originalReads, 0); assert.equal(output.parts.length, 0); assert.equal(output.closed(), false);
			assert.equal(output.aborted(), false); assert.equal(output.writable.locked, false); assert.deepEqual(f.snapshot(), before);
			assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { await f.close(); }
	});
}

for (const contextField of ['catalogId', 'catalogRevision', 'indexRevision'] as const) {
	test(`saved context ${contextField} is bound to the ordinary snapshot before output`, async () => {
		const f = await fixture(), output = destination(); let originalReads = 0, stackReads = 0;
		try {
			await assert.rejects(exportPhotoLibraryBackupV3(f.root.id, { ...f.ports, catalog: catalogPorts(f, {
				async captureSmartCollectionArchiveV1(...args) {
					const capture = await f.catalog.captureSmartCollectionArchiveV1(...args);
					return { ...capture, context: { ...capture.context, [contextField]: contextField === 'catalogId' ? 'foreign' : 999 } };
				},
			}), stacks: { readStackState: async (...args) => { stackReads++; return f.catalog.readStackState(...args); },
				readStackPage: f.catalog.readStackPage.bind(f.catalog), loadStack: f.catalog.loadStack.bind(f.catalog) },
			async loadOriginal(...args) { originalReads++; return f.ports.loadOriginal(...args); } }, { writable: output.writable }),
				error => stackArchiveFailure(error, /revision/iu));
			assert.equal(originalReads, 0); assert.equal(stackReads, 0); assert.equal(output.parts.length, 0);
			assert.equal(output.aborted(), false); assert.equal(output.closed(), false); assert.equal(output.writable.locked, false);
		} finally { await f.close(); }
	});
}

test('late same-revision recipe mutation is authenticated again before destination close', async () => {
	const f = await fixture(), output = destination(); let verified = 0;
	try {
		const before = await f.catalog.readSnapshot(f.root.id);
		await assert.rejects(exportPhotoLibraryBackupV3(f.root.id, { ...f.ports, catalog: catalogPorts(f, {
			async captureSmartCollectionArchiveV1(...args) {
				const capture = await f.catalog.captureSmartCollectionArchiveV1(...args);
				return { ...capture, async verify() {
					verified++; f.seed(normalizePhotoSmartCollectionV1({ ...f.definitions[0], name: 'Changed without revision' }));
					await capture.verify();
				} };
			},
		}) }, { writable: output.writable }), error => stackArchiveFailure(error, /snapshot changed/iu));
		assert.equal(verified, 1); assert.deepEqual(await f.catalog.readSnapshot(f.root.id), before);
		assert.equal(output.aborted(), true); assert.equal(output.closed(), false); assert.equal(output.writable.locked, false);
	} finally { await f.close(); }
});

for (const drift of ['stack', 'photo'] as const) test(`late ${drift} drift during saved verification is fenced again`, async () => {
	const f = await fixture(), output = destination(); let verified = 0;
	try {
		await assert.rejects(exportPhotoLibraryBackupV3(f.root.id, { ...f.ports, catalog: catalogPorts(f, {
			async captureSmartCollectionArchiveV1(...args) {
				const capture = await f.catalog.captureSmartCollectionArchiveV1(...args);
				return { ...capture, async verify() {
					await capture.verify(); verified++;
					if (drift === 'stack') {
						const state = await f.catalog.readStackState(f.root.id);
						f.indexedDB.seedRecord(AUDIT_DATABASE, 'photoStackStates', { ...state, revision: state.revision + 1 });
					} else {
						const photo = await f.catalog.loadPhoto(f.root.id, 'photo-1'); assert.ok(photo);
						await f.catalog.savePhoto({ ...photo, rating: 5 }, photo.revision);
					}
				} };
			},
		}) }, { writable: output.writable }), error => stackArchiveFailure(error, /revision/iu));
		assert.equal(verified, 1); assert.equal(output.aborted(), true); assert.equal(output.closed(), false); assert.equal(output.writable.locked, false);
	} finally { await f.close(); }
});

for (const phase of ['initial-audit', 'final-audit'] as const) test(`${phase} cancellation joins its held borrowed capture before output settlement`, async () => {
	const f = await fixture(), output = destination(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const reason = { cancellation: phase }; let originalReads = 0;
	const work = exportPhotoLibraryBackupV3(f.root.id, { ...f.ports, catalog: catalogPorts(f, {
		async captureSmartCollectionArchiveV1(...args) {
			const capture = await f.catalog.captureSmartCollectionArchiveV1(...args);
			if (phase === 'initial-audit') { entered.resolve(); await release.promise; return capture; }
			return { ...capture, async verify() { entered.resolve(); await release.promise; await capture.verify(); } };
		},
	}), async loadOriginal(...args) { originalReads++; return f.ports.loadOriginal(...args); } }, { signal: stop.signal, writable: output.writable });
	const joined = work.catch(() => undefined);
	try {
		await entered.promise; stop.abort(reason); assert.equal(await remainsPending(joined), true);
		assert.equal(output.writable.locked, phase === 'final-audit'); assert.equal(output.aborted(), false);
		assert.equal(originalReads, phase === 'final-audit' ? 2 : 0); release.resolve();
		await assert.rejects(work, error => hasFailure(error, reason));
		assert.equal(output.writable.locked, false); assert.equal(output.closed(), false); assert.equal(output.aborted(), phase === 'final-audit');
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { release.resolve(); await joined; await f.close(); }
});

test('final verify and borrowed port receivers are captured before held originals can replace callbacks', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); let verified = 0;
	let captured: Awaited<ReturnType<typeof f.catalog.captureSmartCollectionArchiveV1>> | undefined;
	const borrowed = catalogPorts(f, { async captureSmartCollectionArchiveV1(...args) {
		assert.equal(this, borrowed); const native = await f.catalog.captureSmartCollectionArchiveV1(...args);
		captured = { ...native, async verify() { assert.equal(this, captured); verified++; await native.verify(); } }; return captured;
	} });
	const borrowedStacks = { readStackState: f.catalog.readStackState.bind(f.catalog),
		async readStackPage(...args: Parameters<typeof f.catalog.readStackPage>) { assert.equal(this, borrowedStacks); return f.catalog.readStackPage(...args); },
		loadStack: f.catalog.loadStack.bind(f.catalog) };
	const work = exportPhotoLibraryBackupV3(f.root.id, { ...f.ports, catalog: borrowed, stacks: borrowedStacks,
		async loadOriginal(...args) { entered.resolve(); await release.promise; return f.ports.loadOriginal(...args); } });
	const joined = work.catch(() => undefined);
	try {
		await entered.promise; assert.ok(captured);
		Object.defineProperty(captured, 'verify', { value: async () => { assert.fail('Late callback replacement must not run.'); } });
		borrowed.readSnapshot = async () => { assert.fail('Late snapshot replacement must not run.'); };
		borrowedStacks.readStackPage = async () => { assert.fail('Late stack page replacement must not run.'); };
		release.resolve(); const result = await work; assert.equal(result.document.schemaVersion, 3); assert.equal(verified, 1);
	} finally { release.resolve(); await joined; await f.close(); }
});

test('fulfilled native destination close remains acknowledged after a synchronous late abort', async () => {
	const f = await fixture(), stop = new AbortController(), reason = { afterClose: true }, output = destination(() => { stop.abort(reason); });
	try {
		const result = await exportPhotoLibraryBackupV3(f.root.id, f.ports, { writable: output.writable, signal: stop.signal });
		assert.equal(result.document.schemaVersion, 3); assert.ok(result.byteLength > 0); assert.equal(stop.signal.reason, reason);
		assert.equal(output.closed(), true); assert.equal(output.aborted(), false); assert.equal(output.writable.locked, false);
	} finally { await f.close(); }
});

for (const capability of ['stacks', 'saved-capture'] as const) test(`missing ${capability} refuses V3 before lazy snapshot and never falls back`, async () => {
	const f = await fixture(0, 0), output = destination(); let snapshots = 0;
	try {
		const catalog = catalogPorts(f, { async readSnapshot(...args) { snapshots++; return f.catalog.readSnapshot(...args); } });
		const broken = capability === 'stacks' ? { ...f.ports, catalog, stacks: undefined }
			: { ...f.ports, catalog: { ...catalog, captureSmartCollectionArchiveV1: undefined } };
		await assert.rejects(exportPhotoLibraryBackupV3(f.root.id, broken as unknown as PhotoLibraryBackupPortsV3, { writable: output.writable }), /capabilities/iu);
		assert.equal(snapshots, 0); assert.equal(output.parts.length, 0); assert.equal(output.closed(), false); assert.equal(output.aborted(), false);
	} finally { await f.close(); }
});

test('V3 backup authenticates a genuinely absent saved inventory on an actual catalog', async () => {
	const f = await smartCollectionAuditFixtureV1(), catalog = new PhotoCatalogRepositoryV1({ indexedDB: f.factory,
		databaseName: 'smart-collection-audit', verifyOriginal: async () => undefined });
	try {
		const result = await exportPhotoLibraryBackupV3(f.root.id, { catalog, stacks: catalog,
			loadOriginal: async () => { assert.fail('Empty catalog has no originals.'); } });
		assert.equal(result.document.schemaVersion, 3); assert.equal(result.document.savedCollectionState, null);
		assert.deepEqual(result.document.savedCollectionPacks, []); assert.ok(result.blob);
	} finally { await catalog.close(); f.close(); }
});
