/* SPDX-License-Identifier: AGPL-3.0-only */

import { aggregateScapeErrors } from '../../common/editor/scape-abort.ts';
import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { createPhotoCatalogStoresV1 } from './catalog-database-schema.ts';
import { assertNotAborted, catalogTransaction } from './catalog-transaction.ts';
import { assertPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { PHOTO_CATALOG_DATABASE_VERSION, PHOTO_CATALOG_STORES } from './repository-types.ts';
import { field, name, record } from './value-validation.ts';
import { photoCatalogRestoreRootRecordsV1, photoCatalogRestorePhotoRecordsV1, photoCatalogRestoreStackRecordsV1,
	photoCatalogRestoreSavedCollectionRecordsV1, type PhotoCatalogRestoreRootRecordsV1 } from './photo-catalog-restore-records-v1.ts';
import { PhotoCatalogRestoreDeliveryV1 } from './photo-catalog-restore-delivery-v1.ts';
import { finalizePhotoCatalogRestoreCandidateV1 } from './photo-catalog-restore-finalize-v1.ts';
import { normalizePhotoLibraryRestoreAllocationV1, photoLibraryRestoreOwnerMarkerV1, PHOTO_CATALOG_RESTORE_OWNER_STORE_V1,
	type PhotoLibraryRestoreAllocationV1 } from '../storage/photo-library-restore-ownership-v1.ts';
import { inspectPhotoCatalogRestoreNamespaceV1 } from './photo-catalog-restore-owner-v1.ts';

export interface PhotoCatalogRestoreCandidateV1 {
	readonly databaseName: string;
	readonly catalogId: string;
	readonly catalogRevision: number;
	readonly photoCount: number;
	readonly stackCount: number;
	readonly savedCollectionCount: number;
	readonly indexRevision: 0;
}
export interface PhotoCatalogRestoreStageV1 {
	readonly databaseName: string;
	readonly catalogId: string;
	writePhoto(photo: unknown): Promise<void>;
	writeStack(stack: unknown): Promise<void>;
	writeSavedCollection(definition: unknown): Promise<void>;
	/** Candidate readiness only; no active-library pointer or original-media publication. */
	finish(): Promise<PhotoCatalogRestoreCandidateV1>;
	close(): Promise<void>;
	rollback(): Promise<void>;
}
export interface PhotoCatalogRestoreStageOptionsV1 {
	readonly indexedDB: IDBFactory;
	readonly databaseName: string;
	readonly root: unknown;
	readonly savedState: unknown;
	readonly signal?: AbortSignal;
	readonly restoreAllocation?: unknown;
}

const activeNames = new WeakMap<object, Set<string>>();
const nativeAdd = EventTarget.prototype.addEventListener, nativeRemove = EventTarget.prototype.removeEventListener;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeAbort = AbortController.prototype.abort;

/** A positively fresh physical namespace is the sole private writer authority. */
export async function createPhotoCatalogRestoreStageV1(optionsValue: PhotoCatalogRestoreStageOptionsV1): Promise<PhotoCatalogRestoreStageV1> {
	const input = record(optionsValue, 'catalog restore options', ['indexedDB', 'databaseName', 'root', 'savedState', 'signal', 'restoreAllocation'],
		['indexedDB', 'databaseName', 'root', 'savedState']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const databaseName = name(field(input, 'databaseName'), 'restore database name');
	const records = photoCatalogRestoreRootRecordsV1(field(input, 'root'), field(input, 'savedState'));
	const rawAllocation = Object.hasOwn(input, 'restoreAllocation') ? field(input, 'restoreAllocation') : undefined;
	const allocation = rawAllocation === undefined ? undefined : normalizePhotoLibraryRestoreAllocationV1(rawAllocation);
	if (allocation !== undefined && (allocation.catalogId !== records.root.id
		|| photoLibraryRestoreOwnerMarkerV1(allocation, 'catalog').databaseName !== databaseName)) {
		throw new TypeError('Catalog restore allocation differs from the selected catalog or database name.');
	}
	const factory = field(input, 'indexedDB') as IDBFactory;
	if (!factory || typeof factory.open !== 'function' || typeof factory.deleteDatabase !== 'function') {
		throw new TypeError('Catalog restore requires an IndexedDB factory.');
	}
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const names = activeNames.get(factory) ?? new Set<string>();
	if (names.has(databaseName)) throw new Error('A restore already owns this database name.');
	names.add(databaseName); activeNames.set(factory, names);
	let nameHeld = true;
	const release = (): void => { if (nameHeld) { names.delete(databaseName); nameHeld = false; } };
	const claim = (): void => {
		if (nameHeld) return;
		if (names.has(databaseName)) throw new Error('A restore already owns this database name.');
		names.add(databaseName); nameHeld = true;
	};
	let stage: RestoreStage | undefined;
	try {
		stage = new RestoreStage(factory, databaseName, records, signal, release, claim, allocation);
		await stage.initialize(); return stage;
	}
	catch (error) {
		const cleanup: unknown[] = [];
		if (stage) { try { await stage.rollback(); } catch (failure) { cleanup.push(failure); } }
		else release();
		const primaryIsAbort = signal !== undefined && Reflect.apply(nativeAborted, signal, []) === true
			&& Object.is(error, Reflect.apply(nativeReason, signal, []));
		throw aggregateScapeErrors(error, cleanup, 'Catalog restore preparation and cleanup failed.',
			primaryIsAbort ? { primaryIsAbort: true } : undefined);
	}
}

class RestoreStage implements PhotoCatalogRestoreStageV1 {
	readonly catalogId: string;
	readonly #open: IDBFactory['open'];
	readonly #delete: IDBFactory['deleteDatabase'];
	readonly #records: PhotoCatalogRestoreRootRecordsV1;
	readonly #stop = new AbortController();
	readonly #delivery: PhotoCatalogRestoreDeliveryV1;
	readonly #release: () => void;
	readonly #claim: () => void;
	readonly #external: AbortSignal | undefined;
	readonly #forward: () => void;
	readonly #allocation: PhotoLibraryRestoreAllocationV1 | undefined;
	readonly #inspectionFactory: Pick<IDBFactory, 'open'>;
	#database: IDBDatabase | null = null;
	#owned = false;
	#failed = false;
	#finishing = false;
	#finished = false;
	#retiring = false;
	#active: Promise<unknown> | null = null;
	#closePromise: Promise<void> | null = null;
	#rollbackPromise: Promise<void> | null = null;
	#photoCount = 0;
	#stackCount = 0;
	#savedCount = 0;
	#legacyCount = 0;

	constructor(factory: IDBFactory, readonly databaseName: string, records: PhotoCatalogRestoreRootRecordsV1,
		signal: AbortSignal | undefined, release: () => void, claim: () => void, allocation?: PhotoLibraryRestoreAllocationV1) {
		this.#open = factory.open.bind(factory); this.#delete = factory.deleteDatabase.bind(factory);
		this.#inspectionFactory = Object.freeze({ open: this.#open });
		this.#records = records; this.catalogId = records.root.id;
		this.#allocation = allocation;
		this.#delivery = new PhotoCatalogRestoreDeliveryV1(this.catalogId); this.#release = release; this.#claim = claim; this.#external = signal;
		this.#forward = () => { Reflect.apply(nativeAbort, this.#stop, [Reflect.apply(nativeReason, signal!, [])]); };
		if (signal) {
			Reflect.apply(nativeAdd, signal, ['abort', this.#forward, { once: true }]);
			if (Reflect.apply(nativeAborted, signal, []) === true) this.#forward();
		}
	}

	async initialize(): Promise<void> {
		assertNotAborted(this.#stop.signal);
		const database = await this.#freshDatabase();
		await catalogTransaction(database, PHOTO_CATALOG_STORES, 'readwrite', async stores => {
			for (const [store, value] of [['catalogs', this.#records.root], ['catalogStates', this.#records.index],
				['photoStackStates', this.#records.stackState], ['photoQueryBuildStates', this.#records.queryBuildV1],
				['photoQueryBuildStatesV2', this.#records.queryBuildV2], ['photoSmartCollectionStates', this.#records.savedState]] as const) {
				if (value !== null) await request(stores[store]!.add(value));
			}
		}, this.#stop.signal);
	}

	writePhoto(value: unknown): Promise<void> {
		return this.#run(async () => {
			if (this.#stackCount || this.#savedCount) throw new Error('Photo records must precede grouping and saved records.');
			if (this.#photoCount >= this.#records.root.photoCount) throw new RangeError('Restore exceeds its declared photo count.');
			const packet = photoCatalogRestorePhotoRecordsV1(this.#records.root, value);
			this.#delivery.admit(packet.photo.document);
			await catalogTransaction(this.#requiredDatabase(), ['photos', 'summaries', 'photoQueryRows', 'photoQueryRowsV2'], 'readwrite', async stores => {
				await request(stores.photos!.add(packet.photo)); await request(stores.summaries!.add(packet.summary));
				if (packet.queryV1 !== null) await request(stores.photoQueryRows!.add(packet.queryV1));
				await request(stores.photoQueryRowsV2!.add(packet.queryV2));
			}, this.#stop.signal);
			await this.#addPages('memberships', packet.memberships);
			this.#photoCount++; if (packet.queryV1 !== null) this.#legacyCount++;
		});
	}
	writeStack(value: unknown): Promise<void> {
		return this.#run(async () => {
			if (this.#photoCount !== this.#records.root.photoCount || this.#savedCount) throw new Error('Stacks require complete preceding photos.');
			const packet = photoCatalogRestoreStackRecordsV1(this.#records.root, value);
			this.#delivery.admit(packet.stack.document);
			await catalogTransaction(this.#requiredDatabase(), ['photoStacks'], 'readwrite', async stores => {
				await request(stores.photoStacks!.add(packet.stack));
			}, this.#stop.signal);
			await this.#addPages('photoStackMemberships', packet.memberships, true); this.#stackCount++;
		});
	}
	writeSavedCollection(value: unknown): Promise<void> {
		return this.#run(async () => {
			if (this.#photoCount !== this.#records.root.photoCount) throw new Error('Saved records require complete preceding photos.');
			if (this.#savedCount >= (this.#records.savedState?.collectionCount ?? 0)) throw new RangeError('Restore exceeds its physical saved state count.');
			const packet = photoCatalogRestoreSavedCollectionRecordsV1(this.#records.root, value);
			this.#delivery.admit(packet.definition.document);
			await catalogTransaction(this.#requiredDatabase(), ['photoSmartCollections', 'photoSmartCollectionSummaries'], 'readwrite', async stores => {
				await request(stores.photoSmartCollections!.add(packet.definition)); await request(stores.photoSmartCollectionSummaries!.add(packet.summary));
			}, this.#stop.signal); this.#savedCount++;
		});
	}
	finish(): Promise<PhotoCatalogRestoreCandidateV1> {
		return this.#run(async () => {
			await finalizePhotoCatalogRestoreCandidateV1(this.#requiredDatabase(), { root: this.#records.root, savedState: this.#records.savedState,
				restoreAllocation: this.#allocation,
				photoCount: this.#photoCount, stackCount: this.#stackCount, savedCollectionCount: this.#savedCount,
				legacyQueryIndexedCount: this.#legacyCount, assertDelivered: (kind, document) => {
					const expected = kind === 'photo' ? 'photo' : kind === 'stack' ? 'photo-stack' : 'photo-smart-collection';
					if (document.kind !== expected) throw new TypeError('Restore delivery kind differs.');
					this.#delivery.assertDelivered(document);
				} }, this.#stop.signal);
			// Fulfilled native readiness completion wins over late lifetime cancellation.
			this.#finished = true;
			return Object.freeze({ databaseName: this.databaseName, catalogId: this.catalogId, catalogRevision: this.#records.root.revision,
				photoCount: this.#photoCount, stackCount: this.#stackCount, savedCollectionCount: this.#savedCount, indexRevision: 0 });
		}, true);
	}

	close(): Promise<void> {
		if (this.#closePromise) return this.#closePromise;
		this.#retiring = true;
		if (!this.#finished) Reflect.apply(nativeAbort, this.#stop, [new DOMException('Catalog restore was closed.', 'AbortError')]);
		this.#closePromise = Promise.resolve().then(async () => {
			try { await this.#active; } catch { /* The admitted caller owns its operation failure. */ }
			try { this.#database?.close(); }
			finally {
				this.#database = null; this.#delivery.clear(); if (!this.#rollbackPromise) this.#release();
				if (this.#external) Reflect.apply(nativeRemove, this.#external, ['abort', this.#forward]);
			}
		});
		return this.#closePromise;
	}
	rollback(): Promise<void> {
		if (this.#rollbackPromise) return this.#rollbackPromise;
		try { this.#claim(); } catch (error) { return Promise.reject(error); }
		this.#retiring = true;
		if (!this.#finished) Reflect.apply(nativeAbort, this.#stop, [new DOMException('Catalog restore was closed.', 'AbortError')]);
		this.#rollbackPromise = Promise.resolve().then(async () => {
			try {
				await this.close();
				if (!this.#owned) return;
				if (this.#allocation !== undefined) {
					// Cleanup uses captured native opening behavior, never the aborted stage lifetime.
					const current = await inspectPhotoCatalogRestoreNamespaceV1({ indexedDB: this.#inspectionFactory, allocation: this.#allocation });
					if (current === 'absent') { this.#owned = false; return; }
					if (current !== 'owned') throw new Error('Catalog restore owner became foreign; the namespace is quarantined.');
				}
				await new Promise<void>((resolve, reject) => {
					const removal = this.#delete(this.databaseName);
					removal.onsuccess = () => { this.#owned = false; resolve(); };
					removal.onerror = () => { reject(removal.error ?? new Error('Could not remove the private restore database.')); };
					// A blocked native deletion remains owned until its terminal request event.
				});
			} finally { this.#release(); }
		});
		return this.#rollbackPromise;
	}

	#run<Result>(operation: () => Promise<Result>, finishing = false): Promise<Result> {
		try {
			if (this.#retiring || this.#finished || this.#finishing) throw new Error('Catalog restore is finished or closed.');
			if (this.#failed) throw new Error('Catalog restore failed and is retired.');
			if (this.#active) throw new Error('Another catalog restore operation is pending.');
			assertNotAborted(this.#stop.signal);
		} catch (error) { return Promise.reject(error); }
		if (finishing) this.#finishing = true;
		let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (reason: unknown) => void;
		const completed = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; });
		this.#active = completed;
		const fail = (error: unknown): void => { this.#failed = true; this.#active = null; reject(error); };
		try { void operation().then(result => { this.#active = null; resolve(result); }, fail); }
		catch (error) { fail(error); }
		return completed;
	}
	#requiredDatabase(): IDBDatabase {
		if (!this.#owned || !this.#database) throw new Error('Fresh restore database ownership is unavailable.');
		return this.#database;
	}
	async #addPages(storeName: string, records: readonly Readonly<{ key: string }>[], checkPhoto = false): Promise<void> {
		for (let offset = 0; offset < records.length; offset += 64) {
			await catalogTransaction(this.#requiredDatabase(), checkPhoto ? [storeName, 'photos'] : [storeName], 'readwrite', async stores => {
				for (const row of records.slice(offset, offset + 64)) {
					if (checkPhoto && await request(stores.photos!.getKey(row.key)) !== row.key) throw new ReferenceError('Restored stack photo is missing.');
					await request(stores[storeName]!.add(row));
				}
			}, this.#stop.signal);
		}
	}
	#freshDatabase(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			let fresh = false, failed = false, failure: unknown;
			const opening = this.#open(this.databaseName, PHOTO_CATALOG_DATABASE_VERSION);
			opening.onupgradeneeded = event => {
				try {
					if (event.oldVersion !== 0) throw new RangeError('Restore database name already exists.');
					fresh = true; assertNotAborted(this.#stop.signal); createPhotoCatalogStoresV1(opening.result);
					if (this.#allocation !== undefined) {
						const owner = opening.result.createObjectStore(PHOTO_CATALOG_RESTORE_OWNER_STORE_V1, { keyPath: 'key' });
						const marker = owner.add(photoLibraryRestoreOwnerMarkerV1(this.#allocation, 'catalog'));
						marker.onerror = () => {
							failed = true; failure = marker.error ?? new Error('Could not record catalog restore ownership.'); opening.transaction?.abort();
						};
					}
				} catch (error) { failed = true; failure = error; opening.transaction?.abort(); }
			};
			opening.onerror = () => { reject(failed ? failure : opening.error ?? new Error('Could not create the restore database.')); };
			opening.onsuccess = () => {
				const database = opening.result;
				if (!fresh) { database.close(); reject(new RangeError('Restore database name already exists.')); return; }
				this.#owned = true; this.#database = database;
				database.onversionchange = () => {
					this.#failed = true; Reflect.apply(nativeAbort, this.#stop, [new Error('Restore database version changed.')]); database.close();
				};
				try { assertNotAborted(this.#stop.signal); resolve(database); } catch (error) { reject(error); }
			};
			// Native blocked/open requests cannot be canceled; do not release the ownership barrier early.
		});
	}
}
