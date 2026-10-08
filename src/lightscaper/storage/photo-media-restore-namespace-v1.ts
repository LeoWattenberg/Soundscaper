/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { aggregateScapeErrors } from '../../common/editor/scape-abort.ts';
import { request, transact } from '../../common/editor/storage/indexeddb-backend.ts';
import { applyEditorStorageMigrations, EDITOR_STORAGE_DATABASE_VERSION } from '../../common/editor/storage/indexeddb-schema.ts';
import { normalizePhotoLibraryRestoreAllocationV1, photoLibraryRestoreNamespacesV1, photoLibraryRestoreOwnerMarkerV1,
	assertPhotoLibraryRestoreOwnerMarkerV1, PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1,
	type PhotoLibraryRestoreAllocationV1 } from './photo-library-restore-ownership-v1.ts';

export interface PhotoMediaRestoreNamespaceOptionsV1 {
	readonly indexedDB: IDBFactory;
	readonly allocation: unknown;
	readonly signal?: AbortSignal;
}
export interface PhotoMediaRestoreNamespaceV1 {
	readonly databaseName: string;
	close(): Promise<void>;
	rollback(): Promise<void>;
}

const activeNames = new WeakMap<object, Set<string>>();
const NativeAbortController = AbortController, nativeSignalPrototype = AbortSignal.prototype;
const nativeThrow = nativeSignalPrototype.throwIfAborted;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeAbort = AbortController.prototype.abort;
const nativeAdd = EventTarget.prototype.addEventListener, nativeRemove = EventTarget.prototype.removeEventListener;
const nativeExceptionName = Object.getOwnPropertyDescriptor(DOMException.prototype, 'name')!.get!;

type AdmittedOptions = Readonly<{ factory: IDBFactory; allocation: Readonly<PhotoLibraryRestoreAllocationV1>;
	databaseName: string; signal: AbortSignal | undefined; open: IDBFactory['open']; remove: IDBFactory['deleteDatabase'] | null }>;

/** Only a positively fresh native creation owns deletion; the marker alone never grants that authority. */
export async function createPhotoMediaRestoreNamespaceV1(value: PhotoMediaRestoreNamespaceOptionsV1): Promise<PhotoMediaRestoreNamespaceV1> {
	const input = admit(value, true), names = activeNames.get(input.factory) ?? new Set<string>();
	if (names.has(input.databaseName)) throw new Error('A restore already owns this media database name.');
	names.add(input.databaseName); activeNames.set(input.factory, names);
	let held = true;
	const release = (): void => { if (held) { names.delete(input.databaseName); held = false; } };
	const claim = (): void => {
		if (held) return;
		if (names.has(input.databaseName)) throw new Error('A restore already owns this media database name.');
		names.add(input.databaseName); held = true;
	};
	const owner = new NamespaceOwner(input, release, claim);
	try {
		await owner.initialize();
		return Object.freeze({ databaseName: input.databaseName, close: () => owner.close(), rollback: () => owner.rollback() });
	} catch (error) {
		const cleanup: unknown[] = [];
		try { await owner.rollback(); } catch (failure) { cleanup.push(failure); }
		throw aggregateScapeErrors(error, cleanup, 'Media namespace creation and cleanup failed.',
			{ primaryIsAbort: isAbort(error, input.signal) });
	}
}

/** Point proof only: never creates schema, migrates, adopts, or authorizes deletion of an existing namespace. */
export async function inspectPhotoMediaRestoreNamespaceV1(value: PhotoMediaRestoreNamespaceOptionsV1): Promise<'absent' | 'owned' | 'foreign'> {
	const input = admit(value, false), stop = forwardSignal(input.signal); let database: IDBDatabase | null = null;
	let failed = false, failure: unknown, result: 'absent' | 'owned' | 'foreign' = 'absent'; const cleanup: unknown[] = [];
	try {
		database = await openExisting(input.open, input.databaseName, stop.signal);
		if (database) result = await inspectDatabase(database, input.allocation, stop.signal);
		check(stop.signal);
	} catch (error) { failed = true; failure = error; }
	try { database?.close(); } catch (error) { cleanup.push(error); }
	stop.detach();
	if (failed) throw aggregateScapeErrors(failure, cleanup, 'Media namespace inspection and cleanup failed.',
		{ primaryIsAbort: isAbort(failure, input.signal) });
	if (cleanup.length) throw cleanup[0];
	return result;
}

class NamespaceOwner {
	readonly #stop: ReturnType<typeof forwardSignal>;
	#database: IDBDatabase | null = null;
	#opening: Promise<void> | null = null;
	#owned = false;
	#closing: Promise<void> | null = null;
	#rollback: Promise<void> | null = null;
	#rollbackRequested = false;

	constructor(readonly input: AdmittedOptions, readonly release: () => void, readonly claim: () => void) {
		this.#stop = forwardSignal(input.signal);
	}
	initialize(): Promise<void> {
		this.#opening = this.#initialize(); return this.#opening;
	}
	async #initialize(): Promise<void> {
		check(this.#stop.signal);
		await new Promise<void>((resolve, reject) => {
			const opening = this.input.open(this.input.databaseName, EDITOR_STORAGE_DATABASE_VERSION);
			let fresh = false, failed = false, failure: unknown;
			const refuse = (error: unknown): void => {
				if (!failed) { failed = true; failure = error; }
				try { opening.transaction?.abort(); } catch { /* Still join the terminal native request. */ }
			};
			opening.onupgradeneeded = event => {
				try {
					if (event.oldVersion !== 0) throw new RangeError('Restore media database name already exists.');
					fresh = true; check(this.#stop.signal);
					const transaction = opening.transaction;
					applyEditorStorageMigrations(opening.result, 0, EDITOR_STORAGE_DATABASE_VERSION, transaction, refuse);
					if (!transaction) throw new Error('Media creation requires a native upgrade transaction.');
					check(this.#stop.signal);
					const added = transaction.objectStore('settings').add({ key: PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1,
						value: photoLibraryRestoreOwnerMarkerV1(this.input.allocation, 'media') });
					added.onerror = () => { refuse(added.error ?? new Error('Could not persist media namespace ownership.')); };
				} catch (error) { refuse(error); }
			};
			opening.onerror = () => { reject(failed ? failure : opening.error ?? new Error('Could not create media storage.')); };
			opening.onsuccess = () => {
				const database = opening.result;
				if (failed || !fresh) {
					try { database.close(); } catch (error) { reject(aggregateScapeErrors(failed ? failure : new RangeError('Restore media database name already exists.'),
						[error], 'Foreign media connection cleanup failed.', { primaryIsAbort: false })); return; }
					reject(failed ? failure : new RangeError('Restore media database name already exists.')); return;
				}
				this.#owned = true; this.#database = database;
				database.onversionchange = () => { void this.close().catch(() => undefined); };
				try { check(this.#stop.signal); resolve(); } catch (error) { reject(error); }
			};
			// Blocked and held opens retain the name until an actual success/error event settles.
		});
	}
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#stop.abort();
		this.#closing = (async () => {
			try {
				await this.#opening?.catch(() => undefined);
				this.#stop.detach();
				if (this.#database) { this.#database.onversionchange = null; this.#database.close(); this.#database = null; }
			} finally { if (!this.#rollbackRequested) this.release(); }
		})();
		return this.#closing;
	}
	rollback(): Promise<void> {
		if (this.#rollback) return this.#rollback;
		try { this.claim(); } catch (error) { return Promise.reject(error); }
		this.#rollbackRequested = true; this.#stop.abort();
		this.#rollback = (async () => {
			const failures: unknown[] = []; let deletable = false, probe: IDBDatabase | null = null;
			try {
				await this.#opening?.catch(() => undefined);
				if (this.#owned) {
					probe = this.#database ?? await openExisting(this.input.open, this.input.databaseName);
					if (probe) {
						if (await inspectDatabase(probe, this.input.allocation) !== 'owned') throw new Error('Media namespace ownership changed; refusing deletion.');
						deletable = true;
					}
				}
			} catch (error) { failures.push(error); }
			try { if (probe && probe !== this.#database) probe.close(); } catch (error) { failures.push(error); }
			try { await this.close(); } catch (error) { failures.push(error); }
			try {
				if (deletable) await new Promise<void>((resolve, reject) => {
					const removal = this.input.remove!(this.input.databaseName);
					removal.onsuccess = () => { resolve(); };
					removal.onerror = () => { reject(removal.error ?? new Error('Could not delete owned media storage.')); };
					// Native blocked deletion cannot be canceled; the name stays held until its terminal event.
				});
			} catch (error) { failures.push(error); }
			finally { this.release(); }
			if (failures.length === 1) throw failures[0];
			if (failures.length) throw new AggregateError(failures, 'Media namespace rollback failed.');
		})();
		return this.#rollback;
	}
}

function admit(value: unknown, writable: boolean): AdmittedOptions {
	const input = readClosedDomainRecord(value, 'media restore options', ['indexedDB', 'allocation', 'signal'], ['indexedDB', 'allocation']);
	const field = (key: string) => readClosedDomainField(input, key, 'media restore options');
	const signal = Object.hasOwn(input, 'signal') ? field('signal') : undefined;
	if (signal !== undefined) assertSignal(signal);
	const allocation = normalizePhotoLibraryRestoreAllocationV1(field('allocation'));
	const databaseName = photoLibraryRestoreNamespacesV1(allocation).mediaDatabaseName;
	const factory = field('indexedDB') as IDBFactory, open = factory?.open, remove = writable ? factory?.deleteDatabase : null;
	if (typeof open !== 'function' || (writable && typeof remove !== 'function')) throw new TypeError('Media restore requires durable IndexedDB.');
	if (signal !== undefined) assertSignal(signal);
	return { factory, allocation, databaseName, signal, open: open.bind(factory), remove: remove?.bind(factory) ?? null };
}
function assertSignal(value: unknown): asserts value is AbortSignal {
	if (typeof value !== 'object' || value === null) throw new TypeError('Media restore requires a native cancellation signal.');
	Reflect.apply(nativeThrow, value, []);
	if (Object.getPrototypeOf(value) !== nativeSignalPrototype
		|| ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(value, key))) {
		throw new TypeError('Media restore requires native cancellation behavior.');
	}
}
function check(signal?: AbortSignal): void { if (signal) Reflect.apply(nativeThrow, signal, []); }
function isAbort(error: unknown, signal?: AbortSignal): boolean {
	if (signal && Reflect.apply(nativeAborted, signal, []) === true && Object.is(error, Reflect.apply(nativeReason, signal, []))) return true;
	try { return Reflect.apply(nativeExceptionName, error, []) === 'AbortError'; } catch { return false; }
}
function forwardSignal(external?: AbortSignal) {
	const stop = new NativeAbortController();
	const forward = (): void => { Reflect.apply(nativeAbort, stop, [Reflect.apply(nativeReason, external!, [])]); };
	if (external) {
		Reflect.apply(nativeAdd, external, ['abort', forward, { once: true }]);
		if (Reflect.apply(nativeAborted, external, []) === true) forward();
	}
	return { signal: stop.signal, abort: () => { Reflect.apply(nativeAbort, stop, []); },
		detach: () => { if (external) Reflect.apply(nativeRemove, external, ['abort', forward]); } };
}

async function openExisting(open: IDBFactory['open'], name: string, signal?: AbortSignal): Promise<IDBDatabase | null> {
	check(signal);
	return await new Promise<IDBDatabase | null>((resolve, reject) => {
		const opening = open(name); let absent = false, failed = false, failure: unknown;
		opening.onupgradeneeded = event => {
			try {
				check(signal);
				if (event.oldVersion !== 0 || !opening.transaction) throw new Error('Unexpected media inspection upgrade.');
				opening.transaction.abort(); absent = true;
			} catch (error) { failed = true; failure = error; try { opening.transaction?.abort(); } catch { /* Join request settlement. */ } }
		};
		opening.onerror = () => {
			try { check(signal); } catch (error) { reject(error); return; }
			if (failed) reject(failure); else if (absent) resolve(null);
			else reject(opening.error ?? new Error('Could not inspect media storage.'));
		};
		opening.onsuccess = () => {
			const database = opening.result;
			try { check(signal); if (failed || absent) throw failed ? failure : new Error('Media absence probe unexpectedly committed.'); resolve(database); }
			catch (error) { try { database.close(); } catch (cleanup) { reject(aggregateScapeErrors(error, [cleanup], 'Media inspection open cleanup failed.',
				{ primaryIsAbort: isAbort(error, signal) })); return; } reject(error); }
		};
	});
}

const PROFILE: Readonly<Record<string, readonly [string, Readonly<Record<string, readonly [boolean, string]>>]>> = {
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
async function inspectDatabase(database: IDBDatabase, allocation: PhotoLibraryRestoreAllocationV1, signal?: AbortSignal): Promise<'owned' | 'foreign'> {
	check(signal); const names = Object.keys(PROFILE);
	if (database.version !== EDITOR_STORAGE_DATABASE_VERSION || database.name !== photoLibraryRestoreNamespacesV1(allocation).mediaDatabaseName
		|| database.objectStoreNames.length !== names.length
		|| names.some(name => !database.objectStoreNames.contains(name))) return 'foreign';
	const result = await transact(database, names, 'readonly', async stores => {
		for (const [name, [keyPath, indexes]] of Object.entries(PROFILE)) {
			const store = stores[name];
			if (!store || store.keyPath !== keyPath || store.autoIncrement !== false || store.indexNames.length !== Object.keys(indexes).length) return 'foreign';
			for (const [key, [unique, expectedPath]] of Object.entries(indexes)) {
				if (!store.indexNames.contains(key)) return 'foreign';
				const index = store.index(key); if (index.keyPath !== expectedPath || index.unique !== unique || index.multiEntry) return 'foreign';
			}
		}
		const value: unknown = await request(stores.settings!.get(PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1)); check(signal);
		try {
			const wrapper = readClosedDomainRecord(value, 'media namespace owner row', ['key', 'value']);
			if (readClosedDomainField(wrapper, 'key', 'media namespace owner row') !== PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1) return 'foreign';
			assertPhotoLibraryRestoreOwnerMarkerV1(readClosedDomainField(wrapper, 'value', 'media namespace owner row'), allocation, 'media');
			return 'owned';
		} catch { return 'foreign'; }
	});
	check(signal); return result;
}
