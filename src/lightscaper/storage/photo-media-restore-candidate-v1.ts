/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { aggregateScapeErrors } from '../../common/editor/scape-abort.ts';
import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { catalogOriginalKey } from '../../common/editor/storage/media-catalog-original-schema.ts';
import { makeCatalogOriginalRoot, putCatalogOriginalRoot } from '../../common/editor/storage/media-catalog-original-records.ts';
import type { MediaAssetWriter } from '../../common/editor/storage/media-asset-write-contract.ts';
import { PHOTO_CATALOG_PACK_LIMITS_V1 } from '../archive/catalog-pack.ts';
import { photoPackByteView } from '../archive/pack-byte-chunk.ts';
import { catalogTransaction } from '../catalog/catalog-transaction.ts';
import { readValidatedPhotoCatalogRootV1, validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import { PhotoMediaStoreV1 } from './photo-media-store.ts';
import { createPhotoMediaRestoreNamespaceV1, inspectPhotoMediaRestoreNamespaceV1, type PhotoMediaRestoreNamespaceV1 } from './photo-media-restore-namespace-v1.ts';
import { normalizePhotoLibraryRestoreAllocationV1, photoLibraryRestoreNamespacesV1, type PhotoLibraryRestoreAllocationV1 } from './photo-library-restore-ownership-v1.ts';
import { assertMediaRestoreOwnerV1, openMediaRestoreExistingV1, readMediaRestoreDescriptorV1 } from './photo-media-restore-read-v1.ts';
import { finishPhotoMediaRestoreV1, type PhotoMediaRestoreCountsV1 } from './photo-media-restore-audit-v1.ts';
import { assertMediaRestoreSignalV1, checkMediaRestoreSignalV1, forwardMediaRestoreSignalV1, mediaRestoreCancellationV1 } from './photo-media-restore-signal-v1.ts';
import { photoDevelopPresetsKeyV1 } from './photo-develop-presets-v1.ts';
import { admitPhotoMediaRestorePresetHeaderV1, admitPhotoMediaRestorePresetsV1, bindPhotoMediaRestorePresetsV1,
	type PhotoMediaRestorePresetHeaderV1, type PhotoMediaRestorePresetBindingV1 } from './photo-media-restore-presets-v1.ts';

export interface PhotoMediaRestoreCandidateOptionsV1 { readonly indexedDB: IDBFactory; readonly allocation: unknown; readonly root: unknown; readonly signal?: AbortSignal; readonly developPresets?: PhotoMediaRestorePresetHeaderV1 | null }
export interface PhotoMediaRestoreOriginalReceiptV1 { readonly photoId: string; readonly assetId: string; readonly sha256: string; readonly size: number; readonly reused: boolean }
export interface PhotoMediaRestoreReceiptV1 extends PhotoMediaRestoreCountsV1 { readonly databaseName: string; readonly catalogId: string }
export interface PhotoMediaRestoreCandidateV1 {
	readonly databaseName: string; readonly catalogId: string;
	writeOriginal(photo: unknown, source: AsyncIterable<Uint8Array>): Promise<Readonly<PhotoMediaRestoreOriginalReceiptV1>>;
	writeDevelopPresets(value: unknown): Promise<void>;
	finish(): Promise<Readonly<PhotoMediaRestoreReceiptV1>>;
	close(): Promise<void>; rollback(): Promise<void>;
}
const names = new WeakMap<object, Set<string>>();

/** Fresh private IDB-only candidate. Incoming originals are serial; no default namespace or digest deduplication. */
export async function createPhotoMediaRestoreCandidateV1(value: PhotoMediaRestoreCandidateOptionsV1): Promise<PhotoMediaRestoreCandidateV1> {
	const input = readClosedDomainRecord(value, 'media restore candidate', ['indexedDB', 'allocation', 'root', 'signal', 'developPresets'], ['indexedDB', 'allocation', 'root']);
	const field = (name: string) => readClosedDomainField(input, name, 'media restore candidate');
	const signal = Object.hasOwn(input, 'signal') ? field('signal') : undefined;
	if (signal !== undefined) assertMediaRestoreSignalV1(signal);
	const allocation = normalizePhotoLibraryRestoreAllocationV1(field('allocation')), root = readValidatedPhotoCatalogRootV1(field('root'));
	if (root.id !== allocation.catalogId) throw new Error('Media restore root and allocation differ.');
	const presets = admitPhotoMediaRestorePresetHeaderV1(Object.hasOwn(input, 'developPresets') ? field('developPresets') : null);
	const factory = field('indexedDB') as IDBFactory, open = factory?.open, remove = factory?.deleteDatabase;
	if (typeof open !== 'function' || typeof remove !== 'function') throw new TypeError('Media restore requires durable IndexedDB.');
	checkMediaRestoreSignalV1(signal);
	const captured = Object.freeze({ open: open.bind(factory), deleteDatabase: remove.bind(factory) }) as IDBFactory;
	const databaseName = photoLibraryRestoreNamespacesV1(allocation).mediaDatabaseName, held = names.get(factory) ?? new Set<string>();
	let owns = false;
	const claim = (): void => { if (owns) return; if (held.has(databaseName)) throw new Error('A restore already owns this media name.'); held.add(databaseName); names.set(factory, held); owns = true; };
	const release = (): void => { if (owns) { held.delete(databaseName); owns = false; } };
	claim(); const owner = new Candidate(captured, allocation, root, signal, claim, release, presets);
	try {
		await owner.initialize();
		return Object.freeze({ databaseName, catalogId: root.id, writeOriginal: (photo: unknown, source: AsyncIterable<Uint8Array>) => owner.write(photo, source),
			writeDevelopPresets: (value: unknown) => owner.writePresets(value),
			finish: () => owner.finish(), close: () => owner.close(), rollback: () => owner.rollback() });
	} catch (error) {
		const cleanup: unknown[] = []; try { await owner.rollback(); } catch (failure) { cleanup.push(failure); }
		throw aggregateScapeErrors(error, cleanup, 'Media restore creation and cleanup failed.', { primaryIsAbort: owner.cancelled(error) });
	}
}

class Candidate {
	readonly stop: ReturnType<typeof forwardMediaRestoreSignalV1>;
	readonly databaseName: string;
	#namespace: PhotoMediaRestoreNamespaceV1 | null = null;
	#store: PhotoMediaStoreV1 | null = null;
	#closeStore: (() => Promise<void>) | null = null;
	#catalog: IDBDatabase | null = null;
	readonly #cleanupErrors: unknown[] = [];
	#database: IDBDatabase | null = null;
	#begin: PhotoMediaStoreV1['mediaRepository']['beginAssetWrite'] | null = null;
	#active: Promise<unknown> | null = null;
	#retired = false; #failed = false;
	#closing: Promise<void> | null = null; #rollback: Promise<void> | null = null; #removing = false;
	#receipt: Readonly<PhotoMediaRestoreReceiptV1> | null = null;
	#photos = 0; #assets = 0; #bytes = 0;
	#presets: Readonly<PhotoMediaRestorePresetBindingV1> | null = null;
	constructor(readonly factory: IDBFactory, readonly allocation: PhotoLibraryRestoreAllocationV1,
		readonly root: PhotoCatalogRootV1, signal: AbortSignal | undefined, readonly claim: () => void, readonly release: () => void,
		readonly presetHeader: PhotoMediaRestorePresetHeaderV1 | null) {
		this.stop = forwardMediaRestoreSignalV1(signal); this.databaseName = photoLibraryRestoreNamespacesV1(allocation).mediaDatabaseName;
	}
	cancelled(error: unknown): boolean { return mediaRestoreCancellationV1(error, this.stop.signal); }
	async initialize(): Promise<void> {
		this.#namespace = await createPhotoMediaRestoreNamespaceV1({ indexedDB: this.factory, allocation: this.allocation, signal: this.stop.signal });
		this.#store = new PhotoMediaStoreV1({ indexedDB: this.factory, databaseName: this.databaseName, preferOpfs: false, locks: null });
		this.#begin = this.#store.mediaRepository.beginAssetWrite.bind(this.#store.mediaRepository);
		this.#closeStore = this.#store.close.bind(this.#store);
		await this.#store.ready(); checkMediaRestoreSignalV1(this.stop.signal);
		if (await inspectPhotoMediaRestoreNamespaceV1({ indexedDB: this.factory, allocation: this.allocation, signal: this.stop.signal }) !== 'owned') throw new Error('Media restore owner/profile differs.');
		this.#database = await openMediaRestoreExistingV1(this.factory.open.bind(this.factory), this.databaseName, this.stop.signal);
	}
	#run<T>(operation: () => Promise<T>): Promise<T> {
		if (this.#active) return Promise.reject(new Error('A media restore operation is pending.'));
		if (this.#retired || this.#failed || this.#receipt) return Promise.reject(new Error('Media restore candidate is failed or retired.'));
		// Register before caller reflection, borrowed iterator creation or native callbacks can reenter.
		let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason: unknown) => void;
		const work = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; }); this.#active = work;
		void work.then(() => { if (this.#active === work) this.#active = null; }, () => { this.#failed = true; if (this.#active === work) this.#active = null; });
		try { checkMediaRestoreSignalV1(this.stop.signal); resolve(operation()); } catch (error) { reject(error); }
		return work;
	}
	write(value: unknown, source: AsyncIterable<Uint8Array>): Promise<Readonly<PhotoMediaRestoreOriginalReceiptV1>> { return this.#run(() => this.#write(value, source)); }
	writePresets(value: unknown): Promise<void> {
		return this.#run(async () => {
			if (this.#presets !== null) throw new Error('Restore preset row was already delivered.');
			const row = admitPhotoMediaRestorePresetsV1(value, this.root.id, this.presetHeader), binding = bindPhotoMediaRestorePresetsV1(row);
			await catalogTransaction(this.#database!, ['settings'], 'readwrite', async stores => {
				await assertMediaRestoreOwnerV1(stores, this.allocation);
				await request(stores.settings!.add({ key: photoDevelopPresetsKeyV1(this.root.id), value: row }));
			}, this.stop.signal);
			this.#presets = binding;
		});
	}
	async #write(value: unknown, source: AsyncIterable<Uint8Array>): Promise<Readonly<PhotoMediaRestoreOriginalReceiptV1>> {
		const photo = validateLightscaperDocumentV1(value);
		if (photo.kind !== 'photo' || photo.catalogId !== this.root.id) throw new TypeError('Restore original requires a photo in the allocated catalog.');
		const original = photo.original, size = original.byteLength;
		if (12 + 8 + new TextEncoder().encode(JSON.stringify(photo)).byteLength + size > PHOTO_CATALOG_PACK_LIMITS_V1.maximumPackBytes) throw new RangeError('A photo original cannot fit its bounded archive pack.');
		const binding = Object.freeze({ photoId: photo.id, assetId: original.storageKey, sourceId: original.id, sha256: original.contentSha256, size });
		if (this.#photos >= this.root.photoCount) throw new Error('Restore original count exceeds the archived catalog.');
		const database = this.#database!, signal = this.stop.signal;
		await catalogTransaction(database, ['settings', 'catalogOriginalRoots'], 'readonly', async stores => {
			await assertMediaRestoreOwnerV1(stores, this.allocation);
			if (await request(stores.catalogOriginalRoots!.get(catalogOriginalKey(this.root.id, this.allocation.operationId, photo.id))) !== undefined) throw new Error('Restore photo original was already delivered.');
		}, signal);
		const previous = await readMediaRestoreDescriptorV1(database, this.allocation, original.storageKey, signal);
		if (previous && (previous.sha256 !== binding.sha256 || previous.size !== size)) throw new Error('Repeated restore key has conflicting digest/size.');
		let iterator: AsyncIterator<Uint8Array> | null = null, writer: MediaAssetWriter | null = null, done = false, committed = false;
		let failed = false, failure: unknown; const cleanup: unknown[] = []; let receipt: Readonly<PhotoMediaRestoreOriginalReceiptV1> | undefined;
		try {
			checkMediaRestoreSignalV1(signal);
			const iterate = source?.[Symbol.asyncIterator];
			if (typeof iterate !== 'function') throw new TypeError('Restore original requires an async byte source.');
			iterator = Reflect.apply(iterate, source, []) as AsyncIterator<Uint8Array>; const next = iterator.next.bind(iterator), leave = iterator.return?.bind(iterator);
			// Capture return independently from a replaceable source/iterator port.
			iterator = { next, ...(leave ? { return: leave } : {}) };
			if (!previous) writer = await this.#begin!(original.storageKey, { name: original.name, mimeType: original.mimeType }, { expectedBytes: size, expectedSha256: binding.sha256, signal });
			const hash = sha256.create(); let length = 0;
			for (;;) {
				checkMediaRestoreSignalV1(signal); const item = await iterator.next(); checkMediaRestoreSignalV1(signal);
				if (item.done) { done = true; break; }
				const bytes = photoPackByteView(item.value);
				if (bytes.byteLength > PHOTO_CATALOG_PACK_LIMITS_V1.maximumChunkBytes || bytes.byteLength > size - length) throw new RangeError('Restore original chunk exceeds its byte budget.');
				hash.update(bytes); length += bytes.byteLength; if (writer) await writer.write(bytes, { signal });
			}
			if (length !== size || bytesToHex(hash.digest()) !== binding.sha256) throw new Error('Restore original size/SHA-256 digest differs.');
			if (writer) {
				const ack = await writer.commit({ signal }); committed = true;
				if (ack.sourceId !== binding.assetId || ack.sha256 !== binding.sha256 || ack.size !== size) throw new Error('Restore body acknowledgement differs.');
				this.#assets++; this.#bytes += size;
			}
			await catalogTransaction(database, ['settings', 'mediaAssets', 'catalogOriginalRoots'], 'readwrite', async stores => {
				await assertMediaRestoreOwnerV1(stores, this.allocation);
				await putCatalogOriginalRoot(stores, await makeCatalogOriginalRoot(stores.mediaAssets!, this.root.id, this.allocation.operationId, binding));
			}, signal);
			this.#photos++; receipt = Object.freeze({ photoId: binding.photoId, assetId: binding.assetId, sha256: binding.sha256, size, reused: previous !== null });
		} catch (error) { failed = true; failure = error; }
		if (!done && iterator?.return) { try { await iterator.return(); } catch (error) { cleanup.push(error); } }
		if (writer && !committed) { try { await writer.abort(); } catch (error) { cleanup.push(error); } }
		if (failed) throw aggregateScapeErrors(failure, cleanup, 'Restore original and cleanup failed.', { primaryIsAbort: this.cancelled(failure) });
		if (cleanup.length) throw cleanup[0]; return receipt!;
	}
	finish(): Promise<Readonly<PhotoMediaRestoreReceiptV1>> {
		if (this.#receipt) return Promise.resolve(this.#receipt);
		return this.#run(async () => {
			if (this.presetHeader !== null && this.#presets === null) throw new Error('Restore preset row was not delivered.');
			if (await inspectPhotoMediaRestoreNamespaceV1({ indexedDB: this.factory, allocation: this.allocation, signal: this.stop.signal }) !== 'owned') throw new Error('Media restore owner/profile differs.');
			const catalog = await openMediaRestoreExistingV1(this.factory.open.bind(this.factory), photoLibraryRestoreNamespacesV1(this.allocation).catalogDatabaseName, this.stop.signal);
			this.#catalog = catalog;
			let failed = false, failure: unknown, counts: Readonly<PhotoMediaRestoreCountsV1> | undefined; const cleanup: unknown[] = [];
			try { counts = await finishPhotoMediaRestoreV1(this.#database!, catalog, this.allocation, this.root,
				{ photoCount: this.#photos, originalCount: this.#assets, originalByteLength: this.#bytes }, this.stop.signal, this.#presets); }
			catch (error) { failed = true; failure = error; }
			try { catalog.close(); this.#catalog = null; } catch (error) { cleanup.push(error); }
			this.#cleanupErrors.push(...cleanup);
			if (failed) throw aggregateScapeErrors(failure, cleanup, 'Media restore audit and cleanup failed.', { primaryIsAbort: this.cancelled(failure) });
			this.#receipt = Object.freeze({ ...counts!, databaseName: this.databaseName, catalogId: this.root.id });
			// Candidate-ready ACK is provisional for global publication; explicit close must report all cleanup failures.
			return this.#receipt;
		});
	}
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#retired = true; if (!this.#receipt) this.stop.abort();
		this.#closing = (async () => {
			await this.#active?.catch(() => undefined); const failures: unknown[] = [...this.#cleanupErrors];
			try { this.#catalog?.close(); this.#catalog = null; } catch (error) { failures.push(error); }
			try { this.#database?.close(); this.#database = null; } catch (error) { failures.push(error); }
			try { await this.#closeStore?.(); } catch (error) { failures.push(error); }
			try { await this.#namespace?.close(); } catch (error) { failures.push(error); }
			this.stop.detach(); if (!this.#removing) this.release();
			if (failures.length === 1) throw failures[0]; if (failures.length) throw new AggregateError(failures, 'Media restore close failed.');
		})(); return this.#closing;
	}
	rollback(): Promise<void> {
		if (this.#rollback) return this.#rollback;
		try { this.claim(); } catch (error) { return Promise.reject(error); }
		this.#removing = true;
		this.#rollback = (async () => {
			const failures: unknown[] = [];
			try { await this.close(); } catch (error) { failures.push(error); }
			try { await this.#namespace?.rollback(); } catch (error) { failures.push(error); }
			finally { this.release(); }
			if (failures.length === 1) throw failures[0]; if (failures.length) throw new AggregateError(failures, 'Media restore rollback failed.');
		})(); return this.#rollback;
	}
}
