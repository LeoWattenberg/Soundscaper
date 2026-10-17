/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openDefaultPhotoCatalogV1, PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1,
	PHOTO_LIBRARY_INITIALIZATION_LOCK_ID_V1, type PhotoLibraryCatalogPointerPortsV1 } from '../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import type { PhotoCatalogRootV1 } from '../src/lightscaper/catalog/types.ts';
import type { PhotoCatalogImportExclusiveV1 } from '../src/lightscaper/import/catalog-write-lock-v1.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

function root(id = 'catalog-1', name = 'Photo library'): PhotoCatalogRootV1 {
	return { schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id, name,
		revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] };
}
function pointer(catalogId = 'catalog-1') { return { schemaVersion: 1, kind: 'photo-library', catalogId }; }
function fixture() {
	const roots = new Map<string, unknown>();
	const calls: string[] = [];
	let stored: unknown;
	let ids = 0;
	const ports: PhotoLibraryCatalogPointerPortsV1 = {
		catalog: {
			async loadCatalog(id) { calls.push(`load:${id}`); return roots.get(id) as PhotoCatalogRootV1 | undefined ?? null; },
			async createCatalog(value) {
				const document = value as PhotoCatalogRootV1;
				calls.push(`create:${document.id}`);
				if (roots.has(document.id)) throw new Error('Root already exists.');
				roots.set(document.id, structuredClone(document));
			},
		},
		settings: {
			async get(key) { assert.equal(key, PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1); calls.push('pointer:get'); return stored; },
			async putIfAbsent(key, value) {
				assert.equal(key, PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1); calls.push('pointer:put');
				if (stored !== undefined) return false;
				stored = structuredClone(value); return true;
			},
		},
		exclusive: async (key, operation, signal) => {
			assert.equal(key, PHOTO_LIBRARY_INITIALIZATION_LOCK_ID_V1);
			calls.push('lock'); return operation(signal);
		},
		createId: () => `catalog-${String(++ids)}`,
	};
	return { ports, roots, calls, pointer: () => stored, seed: (value: unknown) => { stored = value; } };
}

function serialExclusive(): PhotoCatalogImportExclusiveV1 {
	let tail = Promise.resolve();
	return async (key, operation, signal) => {
		assert.equal(key, PHOTO_LIBRARY_INITIALIZATION_LOCK_ID_V1);
		const previous = tail;
		let release!: () => void;
		tail = new Promise<void>((resolve) => { release = resolve; });
		await previous;
		try { return await operation(signal); } finally { release(); }
	};
}

test('default library initialization publishes its empty validated root before the bounded scalar pointer', async () => {
	const f = fixture();
	const opened = await openDefaultPhotoCatalogV1(f.ports, { name: 'Photo library' });
	assert.deepEqual(opened, root());
	assert.ok(Object.isFrozen(opened));
	assert.deepEqual(f.pointer(), pointer());
	assert.ok(new TextEncoder().encode(JSON.stringify(f.pointer())).byteLength <= 1_024);
	assert.deepEqual(f.calls, ['lock', 'pointer:get', 'create:catalog-1', 'pointer:put']);
});

test('reopening loads the winning catalog without renaming, resetting or recreating it', async () => {
	const f = fixture();
	const existing = { ...root(), revision: 7, photoCount: 9,
		keywords: [{ id: 'keyword', name: 'Travel', parentId: null }] };
	f.roots.set(existing.id, existing); f.seed(pointer());
	assert.deepEqual(await openDefaultPhotoCatalogV1(f.ports, { name: 'A different locale name' }), existing);
	assert.deepEqual(f.calls, ['lock', 'pointer:get', 'load:catalog-1']);
});

test('independent initializers share one fixed exclusive initialization scope', async () => {
	const f = fixture();
	const exclusive = serialExclusive();
	const [first, second] = await Promise.all([
		openDefaultPhotoCatalogV1({ ...f.ports, exclusive }, { name: 'Photo library' }),
		openDefaultPhotoCatalogV1({ ...f.ports, exclusive }, { name: 'Photo library' }),
	]);
	assert.equal(first.id, second.id);
	assert.equal(f.roots.size, 1);
	assert.equal(f.calls.filter((call) => call === 'pointer:put').length, 1);
});

test('a pointer CAS loser opens the actual winning root instead of its own unpublished candidate', async () => {
	const f = fixture();
	const [first, second] = await Promise.all([
		openDefaultPhotoCatalogV1(f.ports, { name: 'Photo library' }),
		openDefaultPhotoCatalogV1(f.ports, { name: 'Photo library' }),
	]);
	assert.equal(f.roots.size, 2);
	assert.deepEqual(first, second);
	assert.equal(first.id, 'catalog-1');
	assert.deepEqual(f.pointer(), pointer());
	assert.ok(f.calls.includes('load:catalog-1'));
});

test('root creation failure cannot publish a dangling pointer and preserves its failure', async () => {
	const f = fixture(), failure = new Error('Catalog transaction failed.');
	f.ports.catalog.createCatalog = async () => { throw failure; };
	await assert.rejects(openDefaultPhotoCatalogV1(f.ports, { name: 'Photo library' }), (error: unknown) => error === failure);
	assert.equal(f.pointer(), undefined);
	assert.equal(f.calls.includes('pointer:put'), false);
});

test('lost root acknowledgement accepts only the same matching empty initial root', async () => {
	const f = fixture(), failure = new Error('Creation acknowledgement lost.');
	const create = f.ports.catalog.createCatalog;
	f.ports.catalog.createCatalog = async (value) => { await create(value); throw failure; };
	assert.deepEqual(await openDefaultPhotoCatalogV1(f.ports, { name: 'Photo library' }), root());
	assert.deepEqual(f.pointer(), pointer());
	assert.ok(f.calls.indexOf('load:catalog-1') < f.calls.indexOf('pointer:put'));
});

test('root acknowledgement reconciliation rejects unrelated or edited roots', async () => {
	for (const existing of [{ ...root(), name: 'Another root' }, { ...root(), revision: 1 },
		{ ...root(), photoCount: 1 }, { ...root(), folders: [{ id: 'folder', name: 'Folder', parentId: null }] }]) {
		const f = fixture(), failure = new Error('Creation failed.');
		f.roots.set('catalog-1', existing);
		f.ports.catalog.createCatalog = async () => { throw failure; };
		await assert.rejects(openDefaultPhotoCatalogV1(f.ports, { name: 'Photo library' }), (error: unknown) => error === failure);
		assert.equal(f.pointer(), undefined);
		assert.equal(f.calls.includes('pointer:put'), false);
	}
});

test('lost pointer acknowledgement recovers a valid durable winner and missing publication keeps the failure', async () => {
	for (const committed of [false, true]) {
		const f = fixture(), failure = new Error('Pointer acknowledgement failed.');
		const put = f.ports.settings.putIfAbsent;
		f.ports.settings.putIfAbsent = async (key, value) => { if (committed) await put(key, value); throw failure; };
		const opening = openDefaultPhotoCatalogV1(f.ports, { name: 'Photo library' });
		if (committed) assert.deepEqual(await opening, root());
		else await assert.rejects(opening, (error: unknown) => error === failure);
		assert.equal(f.roots.size, 1);
	}
});

test('invalid, future and accessor-bearing persisted pointers refuse without creating or replacing data', async () => {
	const hostile = Object.defineProperty(pointer(), 'catalogId', { enumerable: true, get() { assert.fail('Pointer accessor ran.'); } });
	for (const invalid of [null, { ...pointer(), schemaVersion: 2 }, { ...pointer(), kind: 'photo-import' },
		{ ...pointer(), catalogId: '../catalog' }, { ...pointer(), catalogId: 'a'.repeat(1_024) },
		{ ...pointer(), inventory: [] }, hostile]) {
		const f = fixture(); f.seed(invalid);
		await assert.rejects(openDefaultPhotoCatalogV1(f.ports, { name: 'Photo library' }));
		assert.equal(f.roots.size, 0);
		assert.equal(f.pointer(), invalid);
		assert.deepEqual(f.calls, ['lock', 'pointer:get']);
	}
});

test('missing, foreign, photo-kind and future-schema winning roots fail closed without resetting the pointer', async () => {
	for (const invalid of [undefined, { ...root(), id: 'other' }, { ...root(), kind: 'photo' }, { ...root(), schemaVersion: 2 }]) {
		const f = fixture(); f.seed(pointer()); if (invalid !== undefined) f.roots.set('catalog-1', invalid);
		await assert.rejects(openDefaultPhotoCatalogV1(f.ports, { name: 'Photo library' }));
		assert.deepEqual(f.pointer(), pointer());
		assert.deepEqual(f.calls, ['lock', 'pointer:get', 'load:catalog-1']);
	}
});

test('cancellation before pointer admission leaves at most an unpublished empty root', async () => {
	for (const boundary of ['before', 'read', 'create']) {
		const f = fixture(), controller = new AbortController(), failure = new Error(`Cancel at ${boundary}`);
		if (boundary === 'before') controller.abort(failure);
		if (boundary === 'read') {
			const get = f.ports.settings.get;
			f.ports.settings.get = async (key) => { const value = await get(key); controller.abort(failure); return value; };
		}
		if (boundary === 'create') {
			const create = f.ports.catalog.createCatalog;
			f.ports.catalog.createCatalog = async (value) => { await create(value); controller.abort(failure); };
		}
		await assert.rejects(openDefaultPhotoCatalogV1(f.ports, { name: 'Photo library', signal: controller.signal }), (error: unknown) => error === failure);
		assert.equal(f.pointer(), undefined);
		assert.equal(f.calls.includes('pointer:put'), false);
		assert.equal(f.roots.size, boundary === 'create' ? 1 : 0);
	}
});

test('acknowledged pointer publication wins cancellation arriving during acknowledgement', async () => {
	const f = fixture(), controller = new AbortController();
	const put = f.ports.settings.putIfAbsent;
	f.ports.settings.putIfAbsent = async (key, value) => { const created = await put(key, value); controller.abort(); return created; };
	assert.deepEqual(await openDefaultPhotoCatalogV1(f.ports, { name: 'Photo library', signal: controller.signal }), root());
	assert.deepEqual(f.pointer(), pointer());
});

test('unsafe options or generated identities are refused before durable pointer publication', async () => {
	const f = fixture();
	const hostile = Object.defineProperty({}, 'name', { enumerable: true, get() { assert.fail('Option accessor ran.'); } });
	await assert.rejects(openDefaultPhotoCatalogV1(f.ports, hostile as { name: string }));
	assert.deepEqual(f.calls, []);
	await assert.rejects(openDefaultPhotoCatalogV1({ ...f.ports, createId: () => '../catalog' }, { name: 'Photo library' }));
	assert.equal(f.roots.size, 0);
	assert.equal(f.pointer(), undefined);
});

test('reopening independent actual catalog/media repository owners preserves one durable library pointer', async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const suffix = crypto.randomUUID();
	const mediaOptions = { indexedDB, locks: null, preferOpfs: false, databaseName: `lightscaper-pointer-media-${suffix}` };
	let expected: PhotoCatalogRootV1 | undefined;
	for (const name of ['Photo library', 'A later locale']) {
		const media = new PhotoMediaStoreV1(mediaOptions);
		const catalog = new PhotoCatalogRepositoryV1({ indexedDB,
			databaseName: `lightscaper-pointer-catalog-${suffix}`, verifyOriginal: media.verifyOriginal });
		try {
			const opened = await openDefaultPhotoCatalogV1({ catalog, settings: media.settingsRepository,
				exclusive: serialExclusive(), createId: () => 'durable-library' }, { name });
			if (!expected) expected = opened; else assert.deepEqual(opened, expected);
			assert.deepEqual(await media.settingsRepository.get(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1), pointer('durable-library'));
		} finally { await catalog.close(); await media.close(); }
	}
});

test('a refused pointer CAS with no durable winner fails without replacing any state', async () => {
	const f = fixture();
	f.ports.settings.putIfAbsent = async () => false;
	await assert.rejects(openDefaultPhotoCatalogV1(f.ports, { name: 'Photo library' }), /winning.*missing/iu);
	assert.equal(f.pointer(), undefined);
	assert.equal(f.roots.size, 1);
});

async function withNavigator<Result>(value: unknown, operation: () => Promise<Result>): Promise<Result> {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
	try { return await operation(); }
	finally {
		if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
		else Reflect.deleteProperty(globalThis, 'navigator');
	}
}

test('the default initializer requires the actual shared browser lock before storage admission', async () => {
	await withNavigator({}, async () => {
		const f = fixture();
		const { exclusive: _exclusive, ...ports } = f.ports;
		await assert.rejects(openDefaultPhotoCatalogV1(ports, { name: 'Photo library' }), /requires browser project locks/iu);
		assert.deepEqual(f.calls, []);
	});
});

test('the default initializer uses and releases the fixed shared Lightscaper lock namespace', async () => {
	const names: string[] = [];
	const locks = { async request(name: string, _options: unknown,
		callback: (lock: Readonly<{ name: string; mode: 'exclusive' }>) => Promise<void>) {
		names.push(name); await callback({ name, mode: 'exclusive' });
	} };
	await withNavigator({ locks }, async () => {
		const f = fixture();
		const { exclusive: _exclusive, ...ports } = f.ports;
		assert.deepEqual(await openDefaultPhotoCatalogV1(ports, { name: 'Photo library' }), root());
	});
	assert.deepEqual(names, [`lightscaper-photo-catalog:${PHOTO_LIBRARY_INITIALIZATION_LOCK_ID_V1}`]);
});

test('acknowledgement reconciliation lookup failures preserve both errors without publishing replacement state', async () => {
	for (const boundary of ['root', 'pointer']) {
		const f = fixture(), failure = new Error(`${boundary} acknowledgement failed`), lookupFailure = new Error('Reconciliation lookup failed');
		if (boundary === 'root') {
			f.ports.catalog.createCatalog = async () => { throw failure; };
			f.ports.catalog.loadCatalog = async () => { throw lookupFailure; };
		} else {
			const get = f.ports.settings.get;
			let reads = 0;
			f.ports.settings.get = async (key) => { if (++reads > 1) throw lookupFailure; return get(key); };
			f.ports.settings.putIfAbsent = async () => { throw failure; };
		}
		await assert.rejects(openDefaultPhotoCatalogV1(f.ports, { name: 'Photo library' }), (error: unknown) =>
			error instanceof AggregateError && error.errors.includes(failure) && error.errors.includes(lookupFailure));
		assert.equal(f.pointer(), undefined);
	}
});

test('cancellation while opening an existing root leaves its durable pointer unchanged', async () => {
	const f = fixture(), controller = new AbortController(), failure = new Error('Stop loading catalog');
	f.seed(pointer()); f.roots.set('catalog-1', root());
	const load = f.ports.catalog.loadCatalog;
	f.ports.catalog.loadCatalog = async (key) => { const catalog = await load(key); controller.abort(failure); return catalog; };
	await assert.rejects(openDefaultPhotoCatalogV1(f.ports, { name: 'Photo library', signal: controller.signal }), (error: unknown) => error === failure);
	assert.deepEqual(f.pointer(), pointer());
	assert.equal(f.calls.includes('pointer:put'), false);
});
