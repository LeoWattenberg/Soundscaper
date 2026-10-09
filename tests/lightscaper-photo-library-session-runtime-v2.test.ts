/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoLibrarySessionV2 } from '../src/lightscaper/photo-library-session-runtime-v2.ts';
import { initializeDefaultPhotoLibraryPointerV2 } from '../src/lightscaper/storage/photo-library-default-initializer-v2.ts';
import { createPhotoCatalogRestoreStageV1 } from '../src/lightscaper/catalog/photo-catalog-restore-stage-v1.ts';
import { createPhotoMediaRestoreNamespaceV1 } from '../src/lightscaper/storage/photo-media-restore-namespace-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { photoLibraryRestoreNamespacesV1, PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1 } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import { photoLibraryRestorePointerV2, PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2 as ANCHOR } from '../src/lightscaper/storage/photo-library-location-v2.ts';
import { photoLibraryRestoreCommitV1, photoLibraryRestoreCommitKeyV1 } from '../src/lightscaper/storage/photo-library-restore-journal-v1.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 as POINTER } from '../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { photoImportIntentKeyV1 } from '../src/lightscaper/import/managed-import-v1.ts';
import { photoImportPresetsKeyV1 } from '../src/lightscaper/storage/photo-import-presets-v1.ts';
import { photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { copyImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { createImageDevelopPresetV1 } from '../src/common/editor/imaging/image-develop-preset-v1.ts';
import { mediaRestoreFixture, mediaRestoreAllocation, mediaRestoreRoot } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });

function lockFixture() {
	const active = new Set<string>(), calls: string[] = [], releases: string[] = [];
	let before: ((name: string) => Promise<void>) | null = null;
	const locks = { async request(name: string, _options: unknown, operation: (lock: unknown) => Promise<unknown>) {
		calls.push(name); await before?.(name);
		if (active.has(name)) return operation(null);
		active.add(name);
		try { return await operation({ name, mode: 'exclusive' }); }
		finally { active.delete(name); releases.push(name); }
	} } as unknown as LockManager;
	return { locks, active, calls, releases, before(run: typeof before) { before = run; } };
}
const preset = (name: string) => ({ schemaVersion: 1, kind: 'photo-import-presets', catalogId: 'catalog-1', revision: 1,
	presets: [{ id: 'preset', name, settings: { rename: null, metadata: {}, keywordIds: [] } }] });
const developPreset = (name: string) => createImageDevelopPresetV1({ schemaVersion: 1, id: 'develop-preset', name,
	settings: copyImageDevelopSettingsV1({ schemaVersion: 1, develop: defaultPhotoDevelopV1(),
		selection: { effectTypes: 'all', geometry: true, localAdjustments: true } }) });
const developPresetRow = (name: string, revision: number) => ({ schemaVersion: 1, kind: 'photo-develop-presets',
	catalogId: 'catalog-1', revision, presets: [developPreset(name)] });

function observeCloses(factory: IDBFactory) {
	const closed: string[] = [], decorated = new WeakSet<object>(), open = factory.open.bind(factory);
	factory.open = ((...args: Parameters<IDBFactory['open']>) => {
		const opening = open(...args), descriptor = Object.getOwnPropertyDescriptor(opening, 'result')!;
		Object.defineProperty(opening, 'result', { configurable: true, get: descriptor.get, set(value: IDBDatabase) {
			descriptor.set!.call(opening, value);
			if (!decorated.has(value)) { decorated.add(value); const close = value.close.bind(value);
				value.close = () => { closed.push(value.name); close(); }; }
		} });
		return opening;
	}) as IDBFactory['open'];
	return closed;
}

async function fixture(restored = true) {
	const f = mediaRestoreFixture(), l = lockFixture();
	const anchor = new PhotoMediaStoreV1({ indexedDB: f.factory, locks: l.locks, preferOpfs: false });
	await anchor.ready();
	const allocation = mediaRestoreAllocation(), names = photoLibraryRestoreNamespacesV1(allocation);
	const seed = async (token = 'a', owner = 'b') => {
		const allocation = { ...mediaRestoreAllocation(), operationId: token.repeat(32), namespaceToken: token.repeat(32), ownerToken: owner.repeat(32) };
		const names = photoLibraryRestoreNamespacesV1(allocation);
		const stage = await createPhotoCatalogRestoreStageV1({ indexedDB: f.factory, databaseName: names.catalogDatabaseName,
			root: mediaRestoreRoot(0), savedState: null, restoreAllocation: allocation });
		await stage.finish(); await stage.close();
		const media = await createPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation }); await media.close();
		const pointer = photoLibraryRestorePointerV2(allocation);
		const receipt = { schemaVersion: 1, kind: 'photo-library-restore-ready', catalogId: allocation.catalogId, ...names,
			catalogRevision: 23, photoCount: 0, stackCount: 0, savedCollectionCount: 0, indexRevision: 0, originalCount: 0, originalByteLength: 0 };
		const commit = photoLibraryRestoreCommitV1({ schemaVersion: 1, kind: 'photo-library-restore-journal', allocation,
			expectedPointer: { schemaVersion: 1, kind: 'photo-library', catalogId: 'catalog-1' }, phase: 'ready', candidateReceipt: receipt });
		await anchor.settingsRepository.put(photoLibraryRestoreCommitKeyV1(allocation.namespaceToken), commit);
		await anchor.settingsRepository.put(POINTER, pointer);
		return pointer;
	};
	if (restored) await seed();
	f.opens.length = 0; l.calls.length = 0; l.releases.length = 0;
	return { ...f, ...l, anchor, allocation, names, seed, options: { name: 'Library', indexedDB: f.factory, locks: l.locks } };
}

test('cold default initializes under one legacy initializer lease then releases it before selected recovery', async () => {
	const f = await fixture(false);
	const session = await createPhotoLibrarySessionV2(f.options);
	try {
		const page = await session.readPage(); assert.equal(page.rows.length, 0);
		const pointer = await f.anchor.settingsRepository.get(POINTER) as { catalogId: string; schemaVersion: number };
		assert.equal(pointer.schemaVersion, 1);
		assert.equal(f.calls.filter(name => name === 'lightscaper-photo-catalog:photo-library-default').length, 1);
		assert.ok(f.calls.includes(`lightscaper-photo-catalog:${pointer.catalogId}`));
		assert.equal([...f.active].some(name => name.startsWith('lightscaper-')), false);
		assert.equal(f.releases.filter(name => name.startsWith('lightscaper-'))[0], 'lightscaper-photo-catalog:photo-library-default');
	} finally { await session.close(); await f.anchor.close(); }
});

test('restored pointer selects exact physical namespaces and ordinary repository opens private 16-store DB5 without resetting revisions', async () => {
	const f = await fixture(), session = await createPhotoLibrarySessionV2(f.options);
	try {
		const page = await session.readPage(); assert.equal(page.rows.length, 0);
		assert.ok(f.opens.some(open => open.name === f.names.catalogDatabaseName && open.version === 5));
		assert.ok(f.opens.some(open => open.name === f.names.mediaDatabaseName && open.version === 2));
		assert.equal(f.opens.some(open => open.name === 'lightscaper-photo-catalog-v1'), false);
		assert.equal((f.raw(f.names.catalogDatabaseName).records(f.names.catalogDatabaseName, 'catalogs')[0] as { revision: number }).revision, 23);
		const edit = await session.applyDefinition(23, { type: 'create-node', nodeKind: 'keyword', id: 'authored-keyword', name: 'Authored', parentId: null });
		assert.equal(edit.rootRevision, 24);
		assert.equal((f.raw(f.names.catalogDatabaseName).records(f.names.catalogDatabaseName, 'catalogs')[0] as { revision: number }).revision, 24);
		assert.equal(f.calls.includes('lightscaper-photo-catalog:catalog-1'), false);
	} finally { await session.close(); await f.anchor.close(); }
});

test('bad V2 permanent history refuses before either selected resource is constructed, without default fallback', async () => {
	const f = await fixture();
	await f.anchor.settingsRepository.put(photoLibraryRestoreCommitKeyV1(f.allocation.namespaceToken), { bad: true });
	await assert.rejects(createPhotoLibrarySessionV2(f.options));
	assert.deepEqual(f.opens.map(open => open.name), [ANCHOR]);
	assert.equal([...f.active].some(name => name.startsWith('lightscaper-')), false); await f.anchor.close();
});

test('either foreign allocation marker refuses exposure of the selected library', async () => {
	for (const component of ['catalog', 'media']) {
		const f = await fixture(), name = component === 'catalog' ? f.names.catalogDatabaseName : f.names.mediaDatabaseName;
		const store = component === 'catalog' ? 'photoCatalogRestoreOwners' : 'settings';
		const row = f.raw(name).records(name, store).find((value: { key: string }) => value.key === PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1) as Record<string, unknown>;
		if (component === 'catalog') row.ownerToken = 'c'.repeat(32);
		else row.value = { ...(row.value as Record<string, unknown>), ownerToken: 'c'.repeat(32) };
		f.raw(name).seedRecord(name, store, row);
		await assert.rejects(createPhotoLibrarySessionV2(f.options), /owner|allocation|namespace/iu);
		assert.equal([...f.active].some(name => name.startsWith('lightscaper-')), false); await f.anchor.close();
	}
});

test('a held namespace acquisition rechecks a same-catalog-ID pointer replacement before selected resource work', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	await f.seed('c', 'd'); await f.anchor.settingsRepository.put(POINTER, photoLibraryRestorePointerV2(f.allocation));
	f.opens.length = 0;
	f.before(async name => { if (name.includes(':namespace:')) { entered.resolve(); await release.promise; } });
	const opening = createPhotoLibrarySessionV2(f.options); const rejection = assert.rejects(opening, /location|changed|stale/iu);
	await entered.promise; await f.anchor.settingsRepository.put(POINTER, photoLibraryRestorePointerV2({ ...f.allocation,
		operationId: 'c'.repeat(32), namespaceToken: 'c'.repeat(32), ownerToken: 'd'.repeat(32) }));
	release.resolve(); await rejection;
	assert.equal(f.opens.some(open => open.name !== ANCHOR), false); await f.anchor.close();
});

test('all selected writes refuse stale physical pointer despite identical archived catalog IDs', async () => {
	const f = await fixture(), session = await createPhotoLibrarySessionV2(f.options);
	try {
		await session.readPage(); await f.seed('c', 'd');
		await assert.rejects(session.applyImportPreset({ type: 'save', expectedRevision: 0, id: 'preset', name: 'New',
			settings: { rename: null, metadata: {}, keywordIds: [] } }), /location|changed|stale/iu);
		assert.equal(f.raw(ANCHOR).records(ANCHOR, 'settings').some((row: { key: string }) => row.key === photoImportPresetsKeyV1('catalog-1')), false);
	} finally { await session.close(); await f.anchor.close(); }
});

test('import presets use fixed anchor while startup import journal uses selected media settings', async () => {
	const f = await fixture();
	await f.anchor.settingsRepository.put(photoImportPresetsKeyV1('catalog-1'), preset('Anchor preset'));
	f.raw(f.names.mediaDatabaseName).seedRecord(f.names.mediaDatabaseName, 'settings', { key: photoImportPresetsKeyV1('catalog-1'), value: preset('Selected preset') });
	await f.anchor.settingsRepository.put(photoImportIntentKeyV1('catalog-1'), { bad: 'anchor-only journal' });
	const session = await createPhotoLibrarySessionV2(f.options);
	try { assert.equal((await session.readImportPresets()).presets[0]?.name, 'Anchor preset'); }
	finally { await session.close(); }
	f.raw(f.names.mediaDatabaseName).seedRecord(f.names.mediaDatabaseName, 'settings', { key: photoImportIntentKeyV1('catalog-1'), value: { bad: 'selected journal' } });
	const damaged = await createPhotoLibrarySessionV2(f.options);
	try { await assert.rejects(damaged.readPage()); } finally { await damaged.close(); await f.anchor.close(); }
});

test('Develop presets read and write the selected physical media namespace despite identical archived catalog IDs', async () => {
	const f = await fixture(), key = photoDevelopPresetsKeyV1('catalog-1');
	const anchorRow = developPresetRow('Old anchor preset', 2), selectedRow = developPresetRow('Restored preset', 8);
	await f.anchor.settingsRepository.put(key, anchorRow);
	f.raw(f.names.mediaDatabaseName).seedRecord(f.names.mediaDatabaseName, 'settings', { key, value: selectedRow });
	const pointerBefore = await f.anchor.settingsRepository.get(POINTER);
	const session = await createPhotoLibrarySessionV2(f.options);
	try {
		const presets = session.develop.presets!;
		const initial = await presets.list({ schemaVersion: 1, catalogId: 'catalog-1' });
		assert.equal(initial.revision, 8); assert.equal(initial.presets[0]?.name, 'Restored preset');
		assert.equal((await presets.read({ schemaVersion: 1, catalogId: 'catalog-1', presetId: 'develop-preset', expectedRevision: 8 })).preset.identity.name, 'Restored preset');
		const saved = await presets.write({ schemaVersion: 1, catalogId: 'catalog-1',
			command: { type: 'save', expectedRevision: 8, preset: developPreset('Edited restored preset') } });
		assert.equal(saved.snapshot.revision, 9);
		assert.deepEqual(await f.anchor.settingsRepository.get(key), anchorRow);
		const physical = f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'settings')
			.find((row: { key: string }) => row.key === key) as { value: { revision: number; presets: { identity: { name: string } }[] } };
		assert.equal(physical.value.revision, 9); assert.equal(physical.value.presets[0]?.identity.name, 'Edited restored preset');
		assert.deepEqual(await f.anchor.settingsRepository.get(POINTER), pointerBefore);
		assert.equal((f.raw(f.names.catalogDatabaseName).records(f.names.catalogDatabaseName, 'catalogs')[0] as { revision: number }).revision, 23);
	} finally { await session.close(); }
	const reopened = await createPhotoLibrarySessionV2(f.options);
	try { assert.equal((await reopened.develop.presets!.list({ schemaVersion: 1, catalogId: 'catalog-1' })).presets[0]?.name, 'Edited restored preset'); }
	finally { await reopened.close(); await f.anchor.close(); }
});

test('an absent selected Develop preset row never falls back to the same catalog ID in the fixed anchor', async () => {
	const f = await fixture(), key = photoDevelopPresetsKeyV1('catalog-1'), old = developPresetRow('Old anchor preset', 7);
	await f.anchor.settingsRepository.put(key, old);
	const session = await createPhotoLibrarySessionV2(f.options);
	try {
		assert.deepEqual(await session.develop.presets!.list({ schemaVersion: 1, catalogId: 'catalog-1' }),
			{ schemaVersion: 1, catalogId: 'catalog-1', revision: 0, presets: [] });
		const saved = await session.develop.presets!.write({ schemaVersion: 1, catalogId: 'catalog-1',
			command: { type: 'save', expectedRevision: 0, preset: developPreset('First selected preset') } });
		assert.equal(saved.snapshot.revision, 1); assert.deepEqual(await f.anchor.settingsRepository.get(key), old);
	} finally { await session.close(); await f.anchor.close(); }
});

test('a selected Develop preset writer refuses a same-catalog-ID pointer replacement before changing either namespace', async () => {
	const f = await fixture(), key = photoDevelopPresetsKeyV1('catalog-1'), selected = developPresetRow('Selected preset', 3);
	f.raw(f.names.mediaDatabaseName).seedRecord(f.names.mediaDatabaseName, 'settings', { key, value: selected });
	const session = await createPhotoLibrarySessionV2(f.options);
	try {
		await session.readPage(); await f.seed('c', 'd');
		await assert.rejects(session.develop.presets!.write({ schemaVersion: 1, catalogId: 'catalog-1',
			command: { type: 'save', expectedRevision: 3, preset: developPreset('Stale write') } }), /location|changed|stale/iu);
		const physical = f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'settings')
			.find((row: { key: string }) => row.key === key) as { value: unknown };
		assert.deepEqual(physical.value, selected); assert.equal(await f.anchor.settingsRepository.get(key), undefined);
	} finally { await session.close(); await f.anchor.close(); }
});

test('trusted restore recovery runs after fixed anchor opens and before initializer lock admission', async () => {
	const f = await fixture(); let recovered = false;
	const session = await createPhotoLibrarySessionV2({ ...f.options, recoverRestores: async (settings, signal) => {
		assert.equal([...f.active].some(name => name.startsWith('lightscaper-')), false);
		assert.equal(f.calls.some(name => name.startsWith('lightscaper-')), false); signal.throwIfAborted();
		assert.deepEqual(await settings.get(POINTER), photoLibraryRestorePointerV2(f.allocation)); recovered = true;
	} });
	assert.equal(recovered, true); await session.close(); await f.anchor.close();
});

test('held recovery cancellation joins before rejecting without constructing selected resources or inspecting opaque reason', async () => {
	const f = await fixture(), stop = new AbortController(), entered = deferred<void>(), release = deferred<void>();
	let inspections = 0;
	const reason = new Proxy({}, { get() { inspections++; throw new Error('Opaque read.'); }, getPrototypeOf() { inspections++; throw new Error('Opaque prototype.'); } });
	const opening = createPhotoLibrarySessionV2({ ...f.options, signal: stop.signal, recoverRestores: async () => { entered.resolve(); await release.promise; } });
	const rejection = opening.then(() => assert.fail('Cancelled factory returned a Session.'), (failure: unknown) => { assert.equal(failure, reason); });
	await entered.promise; stop.abort(reason); assert.equal(await remainsPending(opening), true);
	release.resolve(); await rejection;
	assert.deepEqual(f.opens.map(open => open.name), [ANCHOR]); assert.equal(inspections, 0); await f.anchor.close();
});

test('default initializer takes borrowed authority without an old Session ready or recursively acquiring a lock', async () => {
	const f = await fixture(false), stop = new AbortController(); let guards = 0;
	const pointer = await initializeDefaultPhotoLibraryPointerV2({ indexedDB: f.factory, settings: f.anchor.settingsRepository,
		name: 'Cold restore', authority: { signal: stop.signal, assertActive() { guards++; stop.signal.throwIfAborted(); } } });
	assert.equal(pointer.schemaVersion, 1); assert.ok(Object.isFrozen(pointer)); assert.ok(guards > 0);
	assert.equal(f.calls.some(name => name.startsWith('lightscaper-')), false); await f.anchor.close();
});

test('held native anchor acquisition cancellation joins and closes its acquired connection before refusing', async () => {
	const f = await fixture(), closed = observeCloses(f.factory), stop = new AbortController();
	const entered = deferred<void>(), release = deferred<void>(), open = f.factory.open.bind(f.factory);
	f.factory.open = ((...args: Parameters<IDBFactory['open']>) => {
		const opening = open(...args);
		if (args[0] === ANCHOR) {
			let success: IDBOpenDBRequest['onsuccess'] = null;
			Object.defineProperty(opening, 'onsuccess', { configurable: true, set(value: IDBOpenDBRequest['onsuccess']) { success = value; },
				get: () => (event: Event) => { entered.resolve(); void release.promise.then(() => { success?.call(opening, event); }); } });
		}
		return opening;
	}) as IDBFactory['open'];
	const reason = new Error('Stop held anchor.'), opening = createPhotoLibrarySessionV2({ ...f.options, signal: stop.signal });
	const rejected = assert.rejects(opening, (error: unknown) => error === reason);
	await entered.promise; stop.abort(reason); assert.equal(await remainsPending(opening), true); assert.deepEqual(closed, []);
	release.resolve(); await rejected;
	assert.deepEqual(closed, [ANCHOR]); assert.deepEqual(f.opens.map(value => value.name), [ANCHOR]); await f.anchor.close();
});

test('selected catalog admission failure closes every partial factory owner after native work settles', async () => {
	const f = await fixture(), closed = observeCloses(f.factory);
	f.raw(f.names.catalogDatabaseName).seedRecord(f.names.catalogDatabaseName, 'catalogs', { ...mediaRestoreRoot(0), id: 'other-catalog' }, 'catalog-1');
	await assert.rejects(createPhotoLibrarySessionV2(f.options), /identity|pointer/iu);
	assert.ok(closed.includes(ANCHOR));
	assert.ok(closed.filter(name => name === f.names.catalogDatabaseName).length >= 2);
	assert.ok(closed.filter(name => name === f.names.mediaDatabaseName).length >= 2);
	assert.equal([...f.active].some(name => name.startsWith('lightscaper-')), false); await f.anchor.close();
});

test('default pointer native ACK survives a same-boundary cancellation and remains reopenable', async () => {
	const f = await fixture(false), stop = new AbortController(), original = f.anchor.settingsRepository.putIfAbsent;
	const pointer = await initializeDefaultPhotoLibraryPointerV2({ indexedDB: f.factory, name: 'ACK',
		authority: { signal: stop.signal, assertActive() { stop.signal.throwIfAborted(); } },
		settings: { get: f.anchor.settingsRepository.get, putIfAbsent: async (...args) => { const acknowledged = await original(...args); stop.abort(); return acknowledged; } } });
	assert.deepEqual(await f.anchor.settingsRepository.get(POINTER), pointer); await f.anchor.close();
});

test('runtime closes temporary default connection and anchor when cancellation arrives with initialization ACK', async () => {
	const f = await fixture(false), closed = observeCloses(f.factory), stop = new AbortController();
	const originalOpen = f.factory.open.bind(f.factory);
	f.factory.open = ((...args: Parameters<IDBFactory['open']>) => {
		const opening = originalOpen(...args);
		if (args[0] === ANCHOR) {
			const result = Object.getOwnPropertyDescriptor(opening, 'result')!;
			Object.defineProperty(opening, 'result', { configurable: true, get: result.get, set(database: IDBDatabase) {
				result.set!.call(opening, database); const transaction = database.transaction.bind(database);
				database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
					const current = transaction(...args);
					if (args[1] === 'readwrite') {
						let wrotePointer = false, complete: IDBTransaction['oncomplete'] = null;
						const objectStore = current.objectStore.bind(current);
						current.objectStore = name => { const store = objectStore(name), put = store.put.bind(store);
							store.put = ((value: { key?: string }, key?: IDBValidKey) => { if (value.key === POINTER) wrotePointer = true; return put(value, key); }); return store; };
						Object.defineProperty(current, 'oncomplete', { configurable: true, set(value: IDBTransaction['oncomplete']) { complete = value; },
							get: () => (event: Event) => { complete?.call(current, event); if (wrotePointer) stop.abort(new Error('Stop initialized factory.')); } });
					}
					return current;
				}) as IDBDatabase['transaction'];
			} });
		}
		return opening;
	}) as IDBFactory['open'];
	await assert.rejects(createPhotoLibrarySessionV2({ ...f.options, signal: stop.signal }), /Stop initialized factory/iu);
	assert.ok(closed.includes(ANCHOR)); assert.ok(closed.includes('lightscaper-photo-catalog-v1'));
	assert.equal((await f.anchor.settingsRepository.get(POINTER) as { schemaVersion: number }).schemaVersion, 1);
	assert.equal(f.calls.some(name => name.includes(':namespace:')), false); await f.anchor.close();
});
