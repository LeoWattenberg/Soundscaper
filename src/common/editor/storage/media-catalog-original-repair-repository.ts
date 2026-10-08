/* SPDX-License-Identifier: AGPL-3.0-only */

import { MediaAssetChunkRecords } from './media-asset-chunk-records.ts';
import { MEDIA_ASSET_STREAM_CHUNK_BYTES } from './media-asset-chunk-schema.ts';
import { MediaAssetCleanupError } from './media-asset-cleanup-error.ts';
import type { MediaAssetLifecycleCoordinator } from './media-asset-lifecycle-coordinator.ts';
import { MediaAssetWriteAdmission } from './media-asset-write-admission.ts';
import { MediaPublicationReconciliationError } from './media-asset-owned-publication.ts';
import { abortPreparedMediaAssetStaging, prepareMediaAssetStaging, type PreparedMediaAssetStaging } from './media-asset-staged-sink.ts';
import { MediaAssetStagingRepository } from './media-asset-staging-repository.ts';
import { canonicalMediaContentBlob, digestMediaContent } from './media-content-digest.ts';
import { normalizeCatalogOriginalRepairBindingV1, readCatalogOriginalRepairSignalV1, type CatalogOriginalRepairBindingV1,
	type CatalogOriginalRepairOptionsV1, type CatalogOriginalRepairReceiptV1 } from './media-catalog-original-repair-contract.ts';
import { publishCatalogOriginalRepair, readCatalogOriginalRepairCapture } from './media-catalog-original-repair-publication.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

/** Exact bytes repair a retained original's body without changing its logical custody. */
export class MediaCatalogOriginalRepairRepositoryV1 {
	readonly #port: StorageRepositoryPort;
	readonly #opfs: OpfsRepository;
	readonly #lifecycle: MediaAssetLifecycleCoordinator;
	readonly #chunks: MediaAssetChunkRecords;
	readonly #staging: MediaAssetStagingRepository;
	readonly #active = new Set<string>();

	constructor(port: StorageRepositoryPort, opfs: OpfsRepository, lifecycle: MediaAssetLifecycleCoordinator) {
		this.#port = port; this.#opfs = opfs; this.#lifecycle = lifecycle;
		this.#chunks = new MediaAssetChunkRecords(port); this.#staging = new MediaAssetStagingRepository(port);
	}

	async restore(bindingValue: CatalogOriginalRepairBindingV1, selected: unknown,
		options: CatalogOriginalRepairOptionsV1 = {}): Promise<Readonly<CatalogOriginalRepairReceiptV1>> {
		const binding = normalizeCatalogOriginalRepairBindingV1(bindingValue);
		const signal = readCatalogOriginalRepairSignalV1(options);
		const blob = canonicalMediaContentBlob(selected);
		if (blob.size !== binding.size) throw new RangeError('Selected original size differs from its retained binding.');
		this.#lifecycle.assertAccepting();
		if (this.#active.has(binding.assetId)) throw new Error('An original body repair is already pending.');
		const admission = new MediaAssetWriteAdmission(this.#lifecycle, signal);
		this.#active.add(binding.assetId);
		let prepared: PreparedMediaAssetStaging | null = null;
		let keepBody = false;
		try {
			admission.throwIfCancelled();
			const database = await this.#port.database(); admission.throwIfCancelled();
			if (!database) throw new Error('Original body repair requires durable IndexedDB custody.');
			const captured = await readCatalogOriginalRepairCapture(database, binding, admission.signal);
			if (await digestMediaContent(blob, { signal: admission.signal }) !== binding.sha256) throw new Error('Selected original SHA-256 digest differs from its retained binding.');
			admission.throwIfCancelled();
			prepared = await prepareMediaAssetStaging({ sourceId: binding.assetId, expectedBytes: binding.size,
				maximumMemoryBytes: 0, database, chunks: this.#chunks, staging: this.#staging, opfs: this.#opfs, signal: admission.signal,
				discardStagedPath: path => this.#opfs.deletePathExact(path) });
			admission.setIdentity({ path: prepared.sink.path, mediaChunkToken: prepared.sink.mediaChunkToken });
			admission.throwIfCancelled();
			let chunkCount = 0;
			for (let start = 0; start < blob.size;) {
				admission.throwIfCancelled();
				const length = Math.min(MEDIA_ASSET_STREAM_CHUNK_BYTES, blob.size - start);
				const buffer = await blob.slice(start, start + length).arrayBuffer();
				admission.throwIfCancelled();
				if (buffer.byteLength !== length) throw new Error('Selected original staging read has the wrong byte length.');
				await prepared.sink.write(new Uint8Array(buffer), chunkCount, admission.signal);
				admission.throwIfCancelled(); chunkCount++; start += length;
			}
			await prepared.sink.close(admission.signal); admission.throwIfCancelled();
			await publishCatalogOriginalRepair(database, binding, captured, prepared, chunkCount, admission.signal);
			keepBody = true;
			admission.complete();
			return Object.freeze({ assetId: binding.assetId, sha256: binding.sha256, size: binding.size });
		} catch (primary) {
			if (isErrorInstance(primary, MediaPublicationReconciliationError)) keepBody = true;
			try { if (prepared && !keepBody) await this.#cleanup(prepared); }
			catch (cleanup) {
				admission.failCleanup(cleanup);
				throw new MediaAssetCleanupError([primary, cleanup], 'Original repair and staged cleanup both failed.');
			}
			if (isErrorInstance(primary, MediaAssetCleanupError)) admission.failCleanup(primary);
			else admission.complete();
			throw primary;
		} finally { this.#active.delete(binding.assetId); admission.release(); }
	}

	async #cleanup(prepared: PreparedMediaAssetStaging): Promise<void> {
		const failures: unknown[] = [];
		try { await abortPreparedMediaAssetStaging(prepared); } catch (error) { failures.push(error); }
		// Sync staging historically removes permissively. Confirm this exact new
		// path is absent; no old locator is ever disposed by body repair.
		if (prepared.sink.path) try { await this.#opfs.deletePathExact(prepared.sink.path); } catch (error) { failures.push(error); }
		if (failures.length) throw new MediaAssetCleanupError(failures, 'Original repair staging could not be removed.');
	}
}

/** Native cancellation reasons are arbitrary values, including hostile proxies. */
function isErrorInstance(value: unknown, kind: new (...args: never[]) => Error): boolean {
	try { return value instanceof kind; } catch { return false; }
}
