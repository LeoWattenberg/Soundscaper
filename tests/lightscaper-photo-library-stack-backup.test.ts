/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { exportPhotoLibraryBackupV1 } from '../src/lightscaper/controller/photo-library-backup-v1.ts';
import type { PhotoLibraryBackupStackPortsV1 } from '../src/lightscaper/controller/photo-library-backup-stacks-v1.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { importPhotoCatalogArchiveV1 } from '../src/lightscaper/archive/catalog-archive-import.ts';
import { importPhotoCatalogArchiveV2 } from '../src/lightscaper/archive/catalog-archive-import-v2.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { stackArchiveDestination, stackArchiveFailure } from './helpers/lightscaper-stack-archive-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

async function fixture(photoCount = 4, stackCount = 2) {
	const indexedDB = createInstrumentedIndexedDB(), databaseName = crypto.randomUUID();
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory, databaseName,
		verifyOriginal: async () => undefined });
	let root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Stack backup', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	await catalog.createCatalog(root);
	const originals = new Map<string, Blob>();
	for (let offset = 0; offset < photoCount; offset += 16) {
		const sources = Array.from({ length: Math.min(16, photoCount - offset) }, (_, index) => photoArchiveFixture(offset + index + 1));
		for (const source of sources) originals.set(source.photo.original.storageKey, source.original);
		root = await catalog.publishPhotos(root.id, root.revision, sources.map(source => source.photo));
	}
	for (let index = 0; index < stackCount; index++) {
		const photoIds = [`photo-${String(index * 2 + 2)}`, `photo-${String(index * 2 + 1)}`];
		await catalog.saveStack(normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: root.id,
			id: `stack-${String(index).padStart(4, '0')}`, revision: 0, photoIds, coverPhotoId: photoIds[1] }), null,
		{ expectedCatalogRevision: root.revision, expectedStateRevision: index });
		const current = await catalog.loadCatalog(root.id); assert.ok(current); root = current;
	}
	const ports = { catalog, stacks: catalog, loadOriginal: async (original: { storageKey: string }) => originals.get(original.storageKey) };
	return { catalog, indexedDB, databaseName, root, ports, close: () => catalog.close() };
}

function destination() {
	let closed = false, aborted = false;
	const writable = new WritableStream<Uint8Array>({ write() {}, close() { closed = true; }, abort() { aborted = true; } });
	return { writable, closed: () => closed, aborted: () => aborted };
}

function stackPorts(f: Awaited<ReturnType<typeof fixture>>): PhotoLibraryBackupStackPortsV1 {
	return { readStackState: (...args) => f.catalog.readStackState(...args),
		readStackPage: (...args) => f.catalog.readStackPage(...args), loadStack: (...args) => f.catalog.loadStack(...args) };
}

test('durable backup preserves ordered stacks and covers across bounded summary pages without changing photos', async () => {
	const f = await fixture(132, 66), target = stackArchiveDestination();
	let pages = 0, loads = 0;
	try {
		const photosBefore = f.indexedDB.records(f.databaseName, 'photos'), initial = await f.catalog.readSnapshot(f.root.id);
		const result = await exportPhotoLibraryBackupV1(f.root.id, { ...f.ports, stacks: {
			readStackState: (...args: Parameters<typeof f.catalog.readStackState>) => f.catalog.readStackState(...args),
			readStackPage: async (...args: Parameters<typeof f.catalog.readStackPage>) => {
				pages++; const page = await f.catalog.readStackPage(...args); assert.ok(page.items.length <= 64); return page;
			},
			loadStack: (...args: Parameters<typeof f.catalog.loadStack>) => { loads++; return f.catalog.loadStack(...args); },
		} });
		assert.equal(result.document.schemaVersion, 2); assert.ok(result.blob);
		await importPhotoCatalogArchiveV2(result.blob, async () => target.stage);
		assert.equal(target.stacks.size, 66); assert.equal(target.photos.size, 132); assert.equal(pages, 2); assert.equal(loads, 66);
		for (const stack of target.stacks.values()) assert.deepEqual(stack, await f.catalog.loadStack(f.root.id, stack.id));
		assert.deepEqual(f.indexedDB.records(f.databaseName, 'photos'), photosBefore);
		assert.deepEqual(await f.catalog.readSnapshot(f.root.id), initial);
		assert.equal(f.indexedDB.stats.getAllRequests.length, 0); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		assert.deepEqual(target.events.slice(-1), ['publish']);
	} finally { await f.close(); }
});

test('a grouping edit during stack enumeration aborts the mixed archive before destination close', async () => {
	const f = await fixture(), output = destination(); let changed = false;
	try {
		await assert.rejects(exportPhotoLibraryBackupV1(f.root.id, { ...f.ports, stacks: { ...f.ports.stacks,
			readStackState: (...args: Parameters<typeof f.catalog.readStackState>) => f.catalog.readStackState(...args),
			readStackPage: (...args: Parameters<typeof f.catalog.readStackPage>) => f.catalog.readStackPage(...args),
			loadStack: async (...args: Parameters<typeof f.catalog.loadStack>) => {
				const stack = await f.catalog.loadStack(...args); assert.ok(stack);
				if (!changed) { changed = true; await f.catalog.saveStack({ ...stack, coverPhotoId: stack.photoIds[0] }, stack.revision,
					{ expectedCatalogRevision: f.root.revision, expectedStateRevision: 2 }); }
				return stack;
			},
		} }, { writable: output.writable }), error => stackArchiveFailure(error, /revision/iu));
		assert.equal(changed, true); assert.equal(output.closed(), false); assert.equal(output.aborted(), true); assert.equal(output.writable.locked, false);
	} finally { await f.close(); }
});

test('photo edits after photo enumeration still invalidate the final stack backup snapshot', async () => {
	const f = await fixture(), output = destination(); let changed = false;
	try {
		await assert.rejects(exportPhotoLibraryBackupV1(f.root.id, { ...f.ports, stacks: {
			readStackState: (...args: Parameters<typeof f.catalog.readStackState>) => f.catalog.readStackState(...args),
			readStackPage: (...args: Parameters<typeof f.catalog.readStackPage>) => f.catalog.readStackPage(...args),
			loadStack: async (...args: Parameters<typeof f.catalog.loadStack>) => {
				const stack = await f.catalog.loadStack(...args);
				if (!changed) { changed = true; const photo = await f.catalog.loadPhoto(f.root.id, 'photo-1'); assert.ok(photo);
					await f.catalog.savePhoto({ ...photo, rating: 5 }, photo.revision); }
				return stack;
			},
		} }, { writable: output.writable }), error => stackArchiveFailure(error, /revision/iu));
		assert.equal(changed, true); assert.equal(output.closed(), false); assert.equal(output.aborted(), true);
	} finally { await f.close(); }
});

test('empty grouping captured before originals refuses a stack created during original loading', async () => {
	const f = await fixture(2, 0), output = destination(); let changed = false;
	try {
		await assert.rejects(exportPhotoLibraryBackupV1(f.root.id, { ...f.ports, loadOriginal: async (original) => {
			if (!changed) { changed = true; await f.catalog.saveStack(normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack',
				catalogId: f.root.id, id: 'new-stack', revision: 0, photoIds: ['photo-1', 'photo-2'], coverPhotoId: 'photo-1' }), null,
			{ expectedCatalogRevision: f.root.revision, expectedStateRevision: 0 }); }
			return f.ports.loadOriginal(original);
		} }, { writable: output.writable }), error => stackArchiveFailure(error, /revision/iu));
		assert.equal(output.closed(), false); assert.equal(output.aborted(), true);
	} finally { await f.close(); }
});

test('cancelled stack loading joins the borrowed read before aborting its destination', async () => {
	const f = await fixture(), output = destination(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const work = exportPhotoLibraryBackupV1(f.root.id, { ...f.ports, stacks: {
		readStackState: (...args: Parameters<typeof f.catalog.readStackState>) => f.catalog.readStackState(...args),
		readStackPage: (...args: Parameters<typeof f.catalog.readStackPage>) => f.catalog.readStackPage(...args),
		loadStack: async (...args: Parameters<typeof f.catalog.loadStack>) => { entered.resolve(); await release.promise; return f.catalog.loadStack(...args); },
	} }, { signal: stop.signal, writable: output.writable });
	const settled = work.catch(() => undefined);
	try {
		await entered.promise; stop.abort(new DOMException('Stack backup stopped', 'AbortError'));
		await remainsPending(settled); assert.equal(output.writable.locked, true); assert.equal(output.aborted(), false);
		release.resolve(); await assert.rejects(work, error => stackArchiveFailure(error, /Stack backup stopped/u));
		assert.equal(output.aborted(), true); assert.equal(output.closed(), false); assert.equal(output.writable.locked, false);
	} finally { release.resolve(); await settled; await f.close(); }
});

test('stack-aware empty backup uses archive2 while legacy backup ports retain readable archive1', async () => {
	const f = await fixture(0, 0);
	try {
		const modern = await exportPhotoLibraryBackupV1(f.root.id, f.ports); assert.equal(modern.document.schemaVersion, 2); assert.ok(modern.blob);
		const target = stackArchiveDestination(); await importPhotoCatalogArchiveV2(modern.blob, async () => target.stage);
		assert.equal(target.stacks.size, 0); assert.equal(target.photos.size, 0);
		await assert.rejects(importPhotoCatalogArchiveV1(modern.blob, async () => target.stage));
		const legacy = await exportPhotoLibraryBackupV1(f.root.id, { catalog: f.catalog, loadOriginal: f.ports.loadOriginal });
		assert.equal(legacy.document.schemaVersion, 1); assert.ok(legacy.blob);
		await importPhotoCatalogArchiveV2(legacy.blob, async () => target.stage);
	} finally { await f.close(); }
});

test('exactly64 durable stacks drain the final empty summary page before output closes', async () => {
	const f = await fixture(128, 64), output = destination(); const sizes: number[] = [];
	let loaded = 0, active = 0, maximumActive = 0;
	try {
		const initial = await f.catalog.readSnapshot(f.root.id);
		const result = await exportPhotoLibraryBackupV1(f.root.id, { ...f.ports, stacks: { ...stackPorts(f),
			readStackPage: async (...args) => { const page = await f.catalog.readStackPage(...args); sizes.push(page.items.length); return page; },
			loadStack: async (...args) => {
				loaded++; active++; maximumActive = Math.max(maximumActive, active);
				try { return await f.catalog.loadStack(...args); } finally { active--; }
			},
		} }, { writable: output.writable });
		assert.deepEqual(sizes, [64, 0]); assert.equal(loaded, 64); assert.equal(maximumActive, 1);
		assert.equal(result.document.schemaVersion, 2);
		if (result.document.schemaVersion !== 2) assert.fail('Grouping requires archive2.');
		assert.equal(result.document.stackCount, 64); assert.deepEqual(result.document.stackPacks.map(pack => pack.stackCount), [64]);
		assert.equal(output.closed(), true); assert.equal(output.aborted(), false); assert.equal(output.writable.locked, false);
		assert.deepEqual(await f.catalog.readSnapshot(f.root.id), initial); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await f.close(); }
});

for (const mode of ['malformed-summary', 'foreign-summary', 'repeated-summary', 'stale-cursor'] as const) {
	test(`${mode} refuses the bounded stack enumeration before output close`, async () => {
		const full = mode === 'stale-cursor', f = await fixture(full ? 128 : 4, full ? 64 : 2), output = destination();
		let loaded = 0;
		try {
			const initial = await f.catalog.readSnapshot(f.root.id);
			await assert.rejects(exportPhotoLibraryBackupV1(f.root.id, { ...f.ports, stacks: { ...stackPorts(f),
				readStackPage: async (...args) => {
					const page = await f.catalog.readStackPage(...args); assert.ok(page.items.length > 0);
					if (mode === 'malformed-summary') return { ...page, items: [{ ...page.items[0], photoCount: 1 }] };
					if (mode === 'foreign-summary') return { ...page, items: [{ ...page.items[0], catalogId: 'foreign-catalog' }] };
					if (mode === 'repeated-summary') return { ...page, items: [page.items[0], page.items[0]] };
					assert.ok(page.continuation); return { ...page, continuation: { ...page.continuation, indexRevision: page.continuation.indexRevision + 1 } };
				},
				loadStack: (...args) => { loaded++; return f.catalog.loadStack(...args); },
			} }, { writable: output.writable }), error => stackArchiveFailure(error, /photo count|identity|order|revision/iu));
			assert.equal(loaded, mode === 'repeated-summary' ? 1 : mode === 'stale-cursor' ? 64 : 0);
			assert.equal(output.closed(), false); assert.equal(output.aborted(), true); assert.equal(output.writable.locked, false);
			assert.deepEqual(await f.catalog.readSnapshot(f.root.id), initial); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { await f.close(); }
	});
}

test('a stack durably dissolved after its summary refuses instead of omitting grouping', async () => {
	const f = await fixture(), output = destination(); let removed = false;
	try {
		const photosBefore = f.indexedDB.records(f.databaseName, 'photos');
		await assert.rejects(exportPhotoLibraryBackupV1(f.root.id, { ...f.ports, stacks: { ...stackPorts(f),
			loadStack: async (...args) => {
				if (!removed) {
					const stack = await f.catalog.loadStack(...args); assert.ok(stack);
					await f.catalog.dissolveStack(args[0], args[1], stack.revision, { expectedCatalogRevision: f.root.revision, expectedStateRevision: 2 });
					removed = true;
				}
				return f.catalog.loadStack(...args);
			},
		} }, { writable: output.writable }), error => stackArchiveFailure(error, /stack is missing/iu));
		assert.equal(removed, true); assert.equal((await f.catalog.readStackState(f.root.id)).stackCount, 1);
		assert.deepEqual(f.indexedDB.records(f.databaseName, 'photos'), photosBefore);
		assert.equal(output.closed(), false); assert.equal(output.aborted(), true); assert.equal(output.writable.locked, false);
	} finally { await f.close(); }
});

test('cancelling a held stack page joins its read and admits no aggregate before destination abort', async () => {
	const f = await fixture(), output = destination(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	let loaded = 0;
	const work = exportPhotoLibraryBackupV1(f.root.id, { ...f.ports, stacks: { ...stackPorts(f),
		readStackPage: async (...args) => { const page = await f.catalog.readStackPage(...args); entered.resolve(); await release.promise; return page; },
		loadStack: (...args) => { loaded++; return f.catalog.loadStack(...args); },
	} }, { signal: stop.signal, writable: output.writable });
	const settled = work.catch(() => undefined);
	try {
		await entered.promise; stop.abort(new DOMException('Held stack page cancelled', 'AbortError'));
		assert.equal(await remainsPending(settled), true); assert.equal(loaded, 0);
		assert.equal(output.writable.locked, true); assert.equal(output.aborted(), false);
		release.resolve(); await assert.rejects(work, error => stackArchiveFailure(error, /Held stack page cancelled/u));
		assert.equal(loaded, 0); assert.equal(output.closed(), false); assert.equal(output.aborted(), true); assert.equal(output.writable.locked, false);
	} finally { release.resolve(); await settled; await f.close(); }
});

test('cancelling held initial stack-state capture leaves the unacquired destination with its caller', async () => {
	const f = await fixture(), output = destination(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	let originals = 0;
	const reason = new DOMException('Held stack capture cancelled', 'AbortError');
	const work = exportPhotoLibraryBackupV1(f.root.id, { ...f.ports,
		loadOriginal: async original => { originals++; return f.ports.loadOriginal(original); },
		stacks: { ...stackPorts(f), readStackState: async (...args) => {
			const state = await f.catalog.readStackState(...args); entered.resolve(); await release.promise; return state;
		} },
	}, { signal: stop.signal, writable: output.writable });
	const settled = work.catch(() => undefined);
	try {
		await entered.promise; stop.abort(reason); assert.equal(await remainsPending(settled), true);
		assert.equal(originals, 0); assert.equal(output.writable.locked, false); assert.equal(output.aborted(), false);
		release.resolve(); await assert.rejects(work, error => stackArchiveFailure(error, /Held stack capture cancelled/u));
		assert.equal(originals, 0); assert.equal(output.closed(), false); assert.equal(output.aborted(), false);
		await output.writable.abort(reason); assert.equal(output.aborted(), true);
	} finally { release.resolve(); await settled; await f.close(); }
});
