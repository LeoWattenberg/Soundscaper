/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { openDatabase, readCursorPage, request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { createPhotoCatalogRestoreStageV1, type PhotoCatalogRestoreStageV1 } from '../../src/lightscaper/catalog/photo-catalog-restore-stage-v1.ts';
import { inspectPhotoCatalogRestoreNamespaceV1 } from '../../src/lightscaper/catalog/photo-catalog-restore-owner-v1.ts';
import { createPhotoMediaRestoreNamespaceV1, inspectPhotoMediaRestoreNamespaceV1,
	type PhotoMediaRestoreNamespaceV1 } from '../../src/lightscaper/storage/photo-media-restore-namespace-v1.ts';
import { normalizePhotoLibraryRestoreAllocationV1, photoLibraryRestoreNamespacesV1, photoLibraryRestoreOwnerMarkerV1,
	PHOTO_CATALOG_RESTORE_OWNER_STORE_V1, PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1,
	type PhotoLibraryRestoreAllocationV1, type PhotoLibraryRestoreOwnerComponentV1 } from '../../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import { queryCatalogRootV1 } from './lightscaper-catalog-query-fixture.ts';

type NamespaceOwner = PhotoCatalogRestoreStageV1 | PhotoMediaRestoreNamespaceV1;
const encoder = new TextEncoder();
const nativeAddListener = EventTarget.prototype.addEventListener;
const nativeStopImmediatePropagation = Event.prototype.stopImmediatePropagation;

/** Creation and point ownership only: no original bodies, active pointer, or recovery orchestration. */
export async function qualifyNativeRestoreOwnershipV1(mode: string, workerPath: string) {
	const names = new Set<string>(), owners = new Set<NamespaceOwner>(), connections = new Set<IDBDatabase>();
	const add = IDBObjectStore.prototype.add, get = IDBObjectStore.prototype.get;
	const creationModes: string[] = []; let abortRead: ((databaseName: string) => void) | null = null;
	IDBObjectStore.prototype.add = function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
		if (names.has(this.transaction.db.name) && ((this.name === PHOTO_CATALOG_RESTORE_OWNER_STORE_V1)
			|| (this.name === 'settings' && typeof value === 'object' && value !== null
				&& Reflect.get(value, 'key') === PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1))) creationModes.push(this.transaction.mode);
		return Reflect.apply(add, this, key === undefined ? [value] : [value, key]) as IDBRequest<IDBValidKey>;
	};
	IDBObjectStore.prototype.get = function(this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
		const reading = Reflect.apply(get, this, [key]) as IDBRequest<unknown>, databaseName = this.transaction.db.name;
		if (key === PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1 && names.has(databaseName)) {
			Reflect.apply(nativeAddListener, reading, ['success', () => { abortRead?.(databaseName); }, { once: true }]);
		}
		return reading;
	};
	try {
		return mode === 'creation' ? await creation() : mode === 'collision' ? await collision()
			: mode === 'authentication' ? await authentication() : mode === 'realm-retirement' ? await retirement()
				: (() => { throw new RangeError('Unknown native ownership qualification.'); })();
	} finally {
		abortRead = null;
		for (const owner of owners) await owner.close();
		for (const database of connections) database.close();
		IDBObjectStore.prototype.add = add; IDBObjectStore.prototype.get = get;
		for (const name of names) await request(indexedDB.deleteDatabase(name));
	}
	function allocation() {
		const namespaceToken = crypto.randomUUID().replaceAll('-', ''); let ownerToken: string;
		do { ownerToken = crypto.randomUUID().replaceAll('-', ''); } while (ownerToken === namespaceToken);
		const value = normalizePhotoLibraryRestoreAllocationV1({ schemaVersion: 1, kind: 'photo-library-restore-allocation',
			operationId: namespaceToken, namespaceToken, ownerToken, catalogId: 'catalog' });
		const physical = photoLibraryRestoreNamespacesV1(value);
		names.add(physical.catalogDatabaseName); names.add(physical.mediaDatabaseName); return value;
	}
	function databaseName(value: PhotoLibraryRestoreAllocationV1, component: PhotoLibraryRestoreOwnerComponentV1) {
		const physical = photoLibraryRestoreNamespacesV1(value);
		return component === 'catalog' ? physical.catalogDatabaseName : physical.mediaDatabaseName;
	}
	async function open(name: string) { const database = await request(indexedDB.open(name)); connections.add(database); return database; }
	async function create(value: PhotoLibraryRestoreAllocationV1, component: PhotoLibraryRestoreOwnerComponentV1) {
		const owner = component === 'catalog' ? await createPhotoCatalogRestoreStageV1({ indexedDB,
			databaseName: databaseName(value, component), root: { ...queryCatalogRootV1(), revision: Number.MAX_SAFE_INTEGER, photoCount: 0 },
			savedState: null, restoreAllocation: value }) : await createPhotoMediaRestoreNamespaceV1({ indexedDB, allocation: value });
		owners.add(owner); return owner;
	}
	async function inspect(value: PhotoLibraryRestoreAllocationV1, component: PhotoLibraryRestoreOwnerComponentV1, signal?: AbortSignal) {
		return component === 'catalog' ? await inspectPhotoCatalogRestoreNamespaceV1({ indexedDB, allocation: value, signal })
			: await inspectPhotoMediaRestoreNamespaceV1({ indexedDB, allocation: value, signal });
	}
	async function storedOwner(database: IDBDatabase, component: PhotoLibraryRestoreOwnerComponentV1) {
		const store = component === 'catalog' ? PHOTO_CATALOG_RESTORE_OWNER_STORE_V1 : 'settings';
		const value = await transact(database, store, 'readonly', stores => request(stores[store]!.get(PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1))) as unknown;
		return component === 'catalog' ? value : (value as { value: unknown } | undefined)?.value;
	}
	async function fingerprint(database: IDBDatabase) {
		const hash = sha256.create(); hash.update(encoder.encode(String(database.version)));
		for (const name of [...database.objectStoreNames].sort()) {
			hash.update(encoder.encode(name)); let after: IDBValidKey | undefined;
			for (;;) {
				const page = await transact(database, name, 'readonly', stores => readCursorPage(stores[name]!, {
					limit: 64, query: after === undefined ? undefined : IDBKeyRange.lowerBound(after, true),
					project: (value: unknown, key) => ({ key, value }),
				}));
				for (const row of page) hash.update(encoder.encode(JSON.stringify(row)));
				if (page.length < 64) break; after = page.at(-1)!.key;
			}
		}
		return bytesToHex(hash.digest());
	}
	async function refuses(operation: () => Promise<unknown>) { try { await operation(); return false; } catch { return true; } }
	async function creation() {
		const value = allocation(), catalog = await create(value, 'catalog') as PhotoCatalogRestoreStageV1;
		const media = await create(value, 'media'); const ready = await catalog.finish(); await catalog.close(); await media.close();
		const catalogDatabase = await open(databaseName(value, 'catalog')), mediaDatabase = await open(databaseName(value, 'media'));
		const status = [await inspect(value, 'catalog'), await inspect(value, 'media')];
		const markersExact = JSON.stringify(await storedOwner(catalogDatabase, 'catalog')) === JSON.stringify(photoLibraryRestoreOwnerMarkerV1(value, 'catalog'))
			&& JSON.stringify(await storedOwner(mediaDatabase, 'media')) === JSON.stringify(photoLibraryRestoreOwnerMarkerV1(value, 'media'));
		return { status, markersExact, creationModes, catalogStores: catalogDatabase.objectStoreNames.length,
			catalogVersion: catalogDatabase.version, mediaVersion: mediaDatabase.version, readyRevision: ready.catalogRevision,
			originals: await transact(mediaDatabase, 'mediaAssets', 'readonly', stores => request(stores.mediaAssets!.count())) };
	}
	async function collision() {
		let existingUnchanged = true; const refusals: string[] = [];
		for (const component of ['catalog', 'media'] as const) {
			const absent = allocation(); if (await inspect(absent, component) !== 'absent') throw new Error('Absent probe differs.');
			const probe = indexedDB.open(databaseName(absent, component)); let wasAbsent = false;
			probe.onupgradeneeded = event => { wasAbsent = event.oldVersion === 0; probe.transaction!.abort(); };
			try { (await request(probe)).close(); } catch { /* Deliberately aborted absent probe. */ }
			if (!wasAbsent) throw new Error('Inspection persisted an absent namespace.');
			for (const version of [1, 2, 5, 6]) {
				const value = allocation(), creating = indexedDB.open(databaseName(value, component), version);
				creating.onupgradeneeded = () => { creating.result.createObjectStore('existing', { keyPath: 'key' }).add({ key: 'keep', bytes: [1, 4, 9] }); };
				const database = await request(creating); connections.add(database); const before = await fingerprint(database);
				database.close(); connections.delete(database);
				if (await refuses(() => create(value, component))) refusals.push(`${component}:${version}`);
				if (await inspect(value, component) !== 'foreign') throw new Error('Collision was adopted.');
				existingUnchanged &&= before === await fingerprint(await open(databaseName(value, component)));
			}
		}
		return { refusals, existingUnchanged, absentProbeDidNotCreate: true };
	}
	async function authentication() {
		const refusals: string[] = []; let auditDidNotRepair = true;
		for (const component of ['catalog', 'media'] as const) for (const fault of ['missing', 'replacement', 'future-schema']) {
			const value = allocation(), owner = await create(value, component), database = await open(databaseName(value, component));
			const marker = photoLibraryRestoreOwnerMarkerV1(value, component), store = component === 'catalog' ? PHOTO_CATALOG_RESTORE_OWNER_STORE_V1 : 'settings';
			await transact(database, store, 'readwrite', async stores => {
				if (fault === 'missing') await request(stores[store]!.delete(marker.key));
				else {
					const otherToken = ['f', 'e', 'd'].map(character => character.repeat(32))
						.find(token => token !== marker.ownerToken && token !== marker.namespaceToken)!;
					const wrong = fault === 'future-schema' ? { ...marker, schemaVersion: 2 } : { ...marker, ownerToken: otherToken };
					await request(stores[store]!.put(component === 'catalog' ? wrong : { key: marker.key, value: wrong }));
				}
			});
			const before = await fingerprint(database);
			if (await inspect(value, component) === 'foreign') refusals.push(`${component}:${fault}`);
			if (component === 'catalog') {
				if (!await refuses(() => (owner as PhotoCatalogRestoreStageV1).finish())) throw new Error('Counterfeit owner gained readiness.');
				const ready = await transact(database, 'photoQueryBuildStatesV2', 'readonly', stores => request(stores.photoQueryBuildStatesV2!.get('catalog'))) as { ready: boolean };
				if (ready.ready) throw new Error('Failed owner audit wrote readiness.');
			}
			auditDidNotRepair &&= before === await fingerprint(database);
		}
		const cancellations: boolean[] = [];
		for (const component of ['catalog', 'media'] as const) {
			const value = allocation(), owner = await create(value, component); await owner.close();
			const stop = new AbortController(), reason = new Proxy({}, {
				get() { throw new Error('Opaque native abort reason was inspected.'); },
				getPrototypeOf() { throw new Error('Opaque native abort prototype was inspected.'); },
			});
			abortRead = name => { if (name === databaseName(value, component)) { abortRead = null; stop.abort(reason); } };
			let failure: unknown; try { await inspect(value, component, stop.signal); } catch (error) { failure = error; }
			abortRead = null; cancellations.push(failure === reason);
		}
		return { refusals, auditDidNotRepair, cancellations };
	}
	async function retirement() {
		const registryName = `lightscaper-native-allocation-${crypto.randomUUID()}`; names.add(registryName);
		const registry = await openDatabase(indexedDB, registryName); connections.add(registry);
		const statuses: string[] = [], postOpenRows: number[] = []; let descriptorsExact = true;
		for (const component of ['catalog', 'media'] as const) {
			const value = allocation();
			await transact(registry, 'settings', 'readwrite', stores => { stores.settings!.add({ key: value.operationId, value }); });
			await retireCreatingRealm(value, component);
			const row = await transact(registry, 'settings', 'readonly', stores => request(stores.settings!.get(value.operationId))) as { value: unknown };
			const recovered = normalizePhotoLibraryRestoreAllocationV1(row.value);
			descriptorsExact &&= JSON.stringify(value) === JSON.stringify(recovered); statuses.push(await inspect(recovered, component));
			const database = await open(databaseName(recovered, component)), store = component === 'catalog' ? 'catalogs' : 'mediaAssets';
			postOpenRows.push(await transact(database, store, 'readonly', stores => request(stores[store]!.count())));
		}
		return { statuses, descriptorsExact, ownerRealmsRetired: true, postOpenRows };
	}
	async function retireCreatingRealm(value: PhotoLibraryRestoreAllocationV1, component: PhotoLibraryRestoreOwnerComponentV1) {
		const worker = new Worker(workerPath, { type: 'module' });
		try {
			await new Promise<void>((resolve, reject) => {
				worker.onerror = event => { reject(new Error(event.message)); };
				worker.onmessage = (event: MessageEvent<{ phase: string; error?: string }>) => {
					if (event.data.phase === 'ready') worker.postMessage({ allocation: value, component });
					else if (event.data.phase === 'native-creation-complete') resolve();
					else reject(new Error(event.data.error ?? 'Worker creation failed.'));
				};
			});
		} finally { worker.terminate(); }
	}
}

/** Test-only worker retires on native creation ACK before returning an owner to its caller. */
export async function retireAtNativeRestoreCreationV1(allocation: unknown, component: PhotoLibraryRestoreOwnerComponentV1): Promise<void> {
	const value = normalizePhotoLibraryRestoreAllocationV1(allocation), physical = photoLibraryRestoreNamespacesV1(value);
	const name = component === 'catalog' ? physical.catalogDatabaseName : physical.mediaDatabaseName;
	const worker = globalThis as unknown as { postMessage(value: unknown): void; close(): void };
	const factory = { open(databaseName: string, version?: number) {
		const opening = version === undefined ? indexedDB.open(databaseName) : indexedDB.open(databaseName, version); let fresh = false;
		if (databaseName === name) {
			Reflect.apply(nativeAddListener, opening, ['upgradeneeded', (event: IDBVersionChangeEvent) => { fresh = event.oldVersion === 0; }]);
			Reflect.apply(nativeAddListener, opening, ['success', (event: Event) => {
				if (fresh) {
					// Inject loss of the JS open ACK after the genuine native versionchange committed.
					Reflect.apply(nativeStopImmediatePropagation, event, []);
					worker.postMessage({ phase: 'native-creation-complete' }); worker.close();
				}
			}]);
		}
		return opening;
	}, deleteDatabase: indexedDB.deleteDatabase.bind(indexedDB) } as unknown as IDBFactory;
	if (component === 'catalog') await createPhotoCatalogRestoreStageV1({ indexedDB: factory, databaseName: name,
		root: { ...queryCatalogRootV1(), photoCount: 0 }, savedState: null, restoreAllocation: value });
	else await createPhotoMediaRestoreNamespaceV1({ indexedDB: factory, allocation: value });
	worker.postMessage({ phase: 'unexpected-owner-delivery' });
}
