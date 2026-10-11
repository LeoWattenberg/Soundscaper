/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../closed-domain-value.ts';
import { EDITOR_STORAGE_DATABASE_VERSION, request, transact } from './indexeddb-backend.ts';
import type { MediaAssetStagingLeaseRecord } from './media-asset-staging-schema.ts';

export interface MediaAssetNonBinaryDatabaseProfile {
	readonly version: number;
	readonly stores: Readonly<Record<string, string>>;
}

export interface MediaAssetOpfsStartupNamespace {
	readonly databases: readonly IDBDatabase[];
	unchanged(): Promise<boolean>;
}

type Inventory = readonly Readonly<{ name: string; version: number }>[];
type IndexProfile = Readonly<Record<string, readonly [boolean, string]>>;
type BindingLease = Readonly<Pick<MediaAssetStagingLeaseRecord, 'leaseId' | 'sourceId' | 'path'>>;
export interface MediaAssetOpfsDirectoryBindingAdmission { readonly directory: FileSystemDirectoryHandle; }
export interface MediaAssetOpfsDirectoryBinding {
	readonly key: string;
	readonly value: Readonly<{ schemaVersion: 1; kind: 'media-asset-opfs-directory-binding';
		leaseId: string; sourceId: string; path: string; directoryHandle: unknown }>;
}
const directoryAdmissions = new WeakMap<object, Readonly<{ directory: FileSystemDirectoryHandle; compare: (candidate: unknown) => Promise<boolean> }>>();
const cloneRefusals = new WeakSet<object>();
const exceptionName = Object.getOwnPropertyDescriptor(DOMException.prototype, 'name')!.get!;
const MEDIA_PROFILE: Readonly<Record<string, readonly [string, IndexProfile]>> = {
	projects: ['id', {}], revisions: ['key', { projectId: [false, 'projectId'] }], settings: ['key', {}], analysis: ['key', {}],
	sources: ['id', { path: [false, 'path'] }], sourceChunks: ['key', { sourceToken: [false, 'sourceToken'] }],
	mediaAssets: ['sourceId', { mediaChunkToken: [false, 'mediaChunkToken'], path: [false, 'path'], sha256: [false, 'sha256'] }],
	mediaAssetChunks: ['key', { mediaChunkToken: [false, 'mediaChunkToken'] }],
	mediaAssetStaging: ['key', { kind: [false, 'kind'], mediaChunkToken: [true, 'mediaChunkToken'], path: [true, 'path'], expiresAt: [false, 'expiresAt'] }],
	linkedVideoOriginalBindings: ['key', { projectId: [false, 'projectId'] }], linkedOriginalProvisionalRoots: ['key', { projectId: [false, 'projectId'] }],
	videoDerivatives: ['key', { sourceId: [false, 'sourceId'], path: [false, 'path'] }],
	videoDerivativeCacheEntries: ['key', { sourceId: [false, 'sourceId'], path: [false, 'path'] }],
	catalogOriginalRoots: ['key', { assetId: [false, 'assetId'], scope: [false, 'scope'] }],
};

/** Borrow only a complete known native inventory; unknown databases stay protective. */
export async function withMediaAssetOpfsStartupNamespace<Result>(
	factory: IDBFactory,
	current: IDBDatabase,
	nonBinaryProfiles: readonly MediaAssetNonBinaryDatabaseProfile[],
	consume: (namespace: Readonly<MediaAssetOpfsStartupNamespace>) => Promise<Result>,
): Promise<Readonly<{ admitted: false } | { admitted: true; value: Result }>> {
	let captured: Readonly<{ enumerate: IDBFactory['databases']; open: IDBFactory['open']; profiles: readonly MediaAssetNonBinaryDatabaseProfile[] }>;
	try {
		const enumerate = factory.databases, open = factory.open;
		if (typeof enumerate !== 'function' || typeof open !== 'function') return { admitted: false };
		captured = { enumerate, open, profiles: captureProfiles(nonBinaryProfiles) };
	} catch { return { admitted: false }; }
	const { enumerate, open, profiles } = captured;
	const inventory = await readInventory(() => Reflect.apply(enumerate, factory, []) as Promise<IDBDatabaseInfo[]>);
	if (!inventory || !inventory.some(info => info.name === current.name && info.version === current.version)) return { admitted: false };
	const owned: Array<Readonly<{ database: IDBDatabase; close: () => void;
		previous: IDBDatabase['onversionchange']; handler: NonNullable<IDBDatabase['onversionchange']> }>> = [];
	const cleanupErrors: unknown[] = [];
	let stale = false, failed = false, consuming = false, failure: unknown;
	let result: Readonly<{ admitted: false } | { admitted: true; value: Result }> = { admitted: false };
	try {
		const databases: IDBDatabase[] = [];
		let complete = true;
		for (const info of inventory) {
			const database = info.name === current.name ? current : await openExisting(name => Reflect.apply(open, factory, [name]) as IDBOpenDBRequest, info.name);
			if (!database) { complete = false; break; }
			if (database !== current) {
				const close = database.close.bind(database);
				const previous = database.onversionchange;
				const handler: NonNullable<IDBDatabase['onversionchange']> = event => {
					stale = true;
					try { close(); } catch (error) { cleanupErrors.push(error); }
					try { previous?.call(database, event); } catch (error) { cleanupErrors.push(error); }
				};
				owned.push({ database, close, previous, handler });
				database.onversionchange = handler;
			}
			if (database.name !== info.name || database.version !== info.version) { complete = false; break; }
			if (await isMediaDatabase(database)) databases.push(database);
			else if (!await isNonBinaryDatabase(database, profiles)) { complete = false; break; }
		}
		const unchanged = async (): Promise<boolean> => !stale && sameInventory(inventory,
			await readInventory(() => Reflect.apply(enumerate, factory, []) as Promise<IDBDatabaseInfo[]>));
		if (complete && databases.includes(current) && await unchanged()) {
			consuming = true;
			result = { admitted: true, value: await consume(Object.freeze({ databases: Object.freeze(databases), unchanged })) };
		}
	} catch (error) {
		// A failed readonly namespace proof retains evidence; admitted cleanup failures reject.
		if (consuming) { failed = true; failure = error; }
	}
	for (const owner of owned) {
		try { if (owner.database.onversionchange === owner.handler) owner.database.onversionchange = owner.previous; }
		catch (error) { cleanupErrors.push(error); }
		try { owner.close(); } catch (error) { cleanupErrors.push(error); }
	}
	if (failed) {
		if (cleanupErrors.length) throw new AggregateError([failure, ...cleanupErrors], 'OPFS namespace inspection and cleanup failed.', { cause: failure });
		throw failure;
	}
	if (cleanupErrors.length === 1) throw cleanupErrors[0];
	if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'OPFS namespace inspection cleanup failed.');
	return result;
}

async function readInventory(enumerate: () => Promise<IDBDatabaseInfo[]>): Promise<Inventory | null> {
	try {
		const value: unknown = await enumerate();
		const rows = readClosedDomainArray(value, 'native database inventory', 1, 64);
		const names = new Set<string>();
		const inventory = rows.map(value => {
			const record = readClosedDomainRecord(value, 'native database identity', ['name', 'version']);
			const name = readClosedDomainField(record, 'name', 'native database identity');
			const version = readClosedDomainField(record, 'version', 'native database identity');
			if (typeof name !== 'string' || !name || names.has(name) || typeof version !== 'number'
				|| !Number.isSafeInteger(version) || version < 1) throw new TypeError('A complete native database identity is required.');
			names.add(name); return Object.freeze({ name, version });
		});
		return Object.freeze(inventory.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
	} catch { return null; }
}

function sameInventory(left: Inventory, right: Inventory | null): boolean {
	return right !== null && left.length === right.length
		&& left.every((entry, index) => entry.name === right[index]?.name && entry.version === right[index]?.version);
}

async function openExisting(open: (name: string) => IDBOpenDBRequest, name: string): Promise<IDBDatabase | null> {
	return await new Promise((resolve, reject) => {
		const opening = open(name); let absent = false, failed = false, failure: unknown;
		opening.onupgradeneeded = () => {
			absent = true;
			try { opening.transaction?.abort(); } catch (error) { failed = true; failure = error; }
		};
		opening.onerror = () => {
			if (failed) reject(failure);
			else if (absent) resolve(null);
			else reject(opening.error ?? new Error('Could not inspect existing media storage.'));
		};
		opening.onsuccess = () => {
			if (!absent) { resolve(opening.result); return; }
			let closeFailed = false, closeFailure: unknown;
			try { opening.result.close(); } catch (error) { closeFailed = true; closeFailure = error; }
			if (failed && closeFailed) reject(new AggregateError([failure, closeFailure], 'Native namespace refusal and close failed.', { cause: failure }));
			else if (closeFailed) reject(closeFailure);
			else if (failed) reject(failure);
			else resolve(null);
		};
		// A blocked native open is still owned until its actual success/error.
	});
}

async function isMediaDatabase(database: IDBDatabase): Promise<boolean> {
	const names = Object.keys(MEDIA_PROFILE);
	if (database.version !== EDITOR_STORAGE_DATABASE_VERSION || !sameStores(database, names)) return false;
	return transact(database, names, 'readonly', stores => {
		for (const [name, [keyPath, indexes]] of Object.entries(MEDIA_PROFILE)) {
			const store = stores[name]!;
			if (store.keyPath !== keyPath || store.autoIncrement || store.indexNames.length !== Object.keys(indexes).length) return false;
			for (const [indexName, [unique, expectedPath]] of Object.entries(indexes)) {
				if (!store.indexNames.contains(indexName)) return false;
				const index = store.index(indexName);
				if (index.keyPath !== expectedPath || index.unique !== unique || index.multiEntry) return false;
			}
		}
		return true;
	});
}

async function isNonBinaryDatabase(database: IDBDatabase, profiles: readonly MediaAssetNonBinaryDatabaseProfile[]): Promise<boolean> {
	for (const profile of profiles) {
		const names = Object.keys(profile.stores);
		if (database.version !== profile.version || !sameStores(database, names)) continue;
		if (await transact(database, names, 'readonly', stores => names.every(name =>
			stores[name]!.keyPath === profile.stores[name] && !stores[name]!.autoIncrement))) return true;
	}
	return false;
}

function sameStores(database: IDBDatabase, names: readonly string[]): boolean {
	return database.objectStoreNames.length === names.length && names.every(name => database.objectStoreNames.contains(name));
}

function captureProfiles(value: readonly MediaAssetNonBinaryDatabaseProfile[]): readonly MediaAssetNonBinaryDatabaseProfile[] {
	return Object.freeze(readClosedDomainArray(value, 'known nonbinary profiles', 0, 4).map(value => {
		const record = readClosedDomainRecord(value, 'known nonbinary profile', ['version', 'stores']);
		const version = readClosedDomainField(record, 'version', 'known nonbinary profile');
		const stores = readClosedDomainField(record, 'stores', 'known nonbinary profile');
		if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1 || !stores || typeof stores !== 'object') throw new TypeError('Known database profile required.');
		const keys = Object.keys(stores);
		if (!keys.length || keys.length > 64 || keys.some(key => Object.hasOwn(MEDIA_PROFILE, key))) throw new TypeError('Nonbinary inventory cannot contain binary storage owners.');
		const table = readClosedDomainRecord(stores, 'known nonbinary stores', keys);
		const snapshot: Record<string, string> = {};
		for (const key of keys) {
			const keyPath = readClosedDomainField(table, key, 'known nonbinary stores');
			if (typeof keyPath !== 'string' || !keyPath) throw new TypeError('Known nonbinary key path required.');
			snapshot[key] = keyPath;
		}
		return Object.freeze({ version, stores: Object.freeze(snapshot) });
	}));
}

/** Pin the genuine intrinsic for this operation, without invoking a caller's method. */
export async function captureMediaAssetOpfsDirectoryBinding(directory: FileSystemDirectoryHandle): Promise<Readonly<MediaAssetOpfsDirectoryBindingAdmission> | null> {
	let sameEntry: unknown;
	try { sameEntry = Object.getOwnPropertyDescriptor(globalThis.FileSystemHandle?.prototype ?? {}, 'isSameEntry')?.value; }
	catch { return null; }
	if (typeof sameEntry !== 'function') return null;
	const compareEntry = sameEntry;
	const compare = async (candidate: unknown): Promise<boolean> => {
		try { return await Reflect.apply(compareEntry, directory, [candidate]) === true; }
		catch { return false; }
	};
	if (!await compare(directory)) return null;
	const admission = Object.freeze({ directory });
	directoryAdmissions.set(admission, Object.freeze({ directory, compare }));
	return admission;
}

/** One immutable witness, atomically published with its new path lease before create. */
export async function addMediaAssetOpfsDirectoryBinding(
	settings: IDBObjectStore, lease: BindingLease, admission: Readonly<MediaAssetOpfsDirectoryBindingAdmission>,
): Promise<void> {
	const owner = directoryAdmissions.get(admission);
	if (!owner || !lease.path) throw new TypeError('An admitted native directory and exact path lease are required.');
	const value = Object.freeze({ schemaVersion: 1, kind: 'media-asset-opfs-directory-binding',
		leaseId: lease.leaseId, sourceId: lease.sourceId, path: lease.path, directoryHandle: owner.directory });
	try { await request(settings.add({ key: directoryBindingKey(lease), value })); }
	catch (error) {
		if (nativeDataCloneRefusal(error) && error !== null && typeof error === 'object') cloneRefusals.add(error);
		throw error;
	}
}

export function isMediaAssetOpfsDirectoryBindingCloneRefusal(value: unknown): boolean {
	return value !== null && typeof value === 'object' && cloneRefusals.has(value);
}

/** A missing/unknown witness never adopts the old lease into the current directory. */
export async function readMediaAssetOpfsDirectoryBinding(settings: IDBObjectStore, lease: BindingLease): Promise<Readonly<MediaAssetOpfsDirectoryBinding> | null> {
	const raw: unknown = await request(settings.get(directoryBindingKey(lease)));
	try {
		const row = readClosedDomainRecord(raw, 'OPFS directory binding', ['key', 'value']);
		const key = readClosedDomainField(row, 'key', 'OPFS directory binding');
		const value = readClosedDomainRecord(readClosedDomainField(row, 'value', 'OPFS directory binding'), 'OPFS directory witness',
			['schemaVersion', 'kind', 'leaseId', 'sourceId', 'path', 'directoryHandle']);
		const directoryHandle = readClosedDomainField(value, 'directoryHandle', 'OPFS directory witness');
		if (key !== directoryBindingKey(lease) || readClosedDomainField(value, 'schemaVersion', 'OPFS directory witness') !== 1
			|| readClosedDomainField(value, 'kind', 'OPFS directory witness') !== 'media-asset-opfs-directory-binding'
			|| readClosedDomainField(value, 'leaseId', 'OPFS directory witness') !== lease.leaseId
			|| readClosedDomainField(value, 'sourceId', 'OPFS directory witness') !== lease.sourceId
			|| readClosedDomainField(value, 'path', 'OPFS directory witness') !== lease.path || !lease.path
			|| !directoryHandle || typeof directoryHandle !== 'object') return null;
		return Object.freeze({ key, value: Object.freeze({ schemaVersion: 1, kind: 'media-asset-opfs-directory-binding',
			leaseId: lease.leaseId, sourceId: lease.sourceId, path: lease.path, directoryHandle }) });
	} catch { return null; }
}

export async function matchesMediaAssetOpfsDirectoryBinding(
	admission: Readonly<MediaAssetOpfsDirectoryBindingAdmission>, binding: Readonly<MediaAssetOpfsDirectoryBinding>,
): Promise<boolean> {
	return await directoryAdmissions.get(admission)?.compare(binding.value.directoryHandle) ?? false;
}

/** Native identity is checked outside the TX under sole ownership; this immutable row's scalar identity is checked again inside it. */
export async function consumeMediaAssetOpfsDirectoryBinding(settings: IDBObjectStore, lease: BindingLease): Promise<boolean> {
	const binding = await readMediaAssetOpfsDirectoryBinding(settings, lease);
	if (!binding) return false;
	await request(settings.delete(binding.key));
	return true;
}

function directoryBindingKey(lease: BindingLease): string {
	return `audio-editor-opfs-directory-binding-v1:${lease.leaseId}`;
}

function nativeDataCloneRefusal(value: unknown): boolean {
	try { return Reflect.apply(exceptionName, value, []) === 'DataCloneError'; }
	catch { return false; }
}
