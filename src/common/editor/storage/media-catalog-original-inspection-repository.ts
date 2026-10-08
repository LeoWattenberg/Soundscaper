/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAbortGuard } from '../abort-error.ts';
import { inspectMediaAssetBinaryRecord, type MediaAssetBinaryInspection } from './media-asset-binary-inspection.ts';
import { MediaAssetChunkRecords } from './media-asset-chunk-records.ts';
import type { MediaAssetLifecycleCoordinator } from './media-asset-lifecycle-coordinator.ts';
import { MediaAssetWriteAdmission } from './media-asset-write-admission.ts';
import { normalizeCatalogOriginalRepairBindingV1, readCatalogOriginalRepairSignalV1,
	type CatalogOriginalRepairOptionsV1 } from './media-catalog-original-repair-contract.ts';
import { readCatalogOriginalRepairCapture } from './media-catalog-original-repair-publication.ts';
import { digestMediaContent } from './media-content-digest.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export type CatalogOriginalInspectionOutcomeV1 = Readonly<
	{ status: 'present' }
	| { status: 'missing'; reason: 'media-row' | Extract<MediaAssetBinaryInspection, { status: 'missing' }>['reason'] }
	| { status: 'corrupt'; reason: 'size' | 'digest' }
>;

const throwIfAborted = createAbortGuard('Catalog original inspection was cancelled.');

/** Authenticate existing original bytes while retaining their custody and joined read lifetime. */
export class MediaCatalogOriginalInspectionRepositoryV1 {
	readonly #port: StorageRepositoryPort;
	readonly #opfs: Pick<OpfsRepository, 'inspectBinaryRecord'>;
	readonly #chunks: MediaAssetChunkRecords;
	readonly #lifecycle: MediaAssetLifecycleCoordinator;

	constructor(port: StorageRepositoryPort, opfs: Pick<OpfsRepository, 'inspectBinaryRecord'>, lifecycle: MediaAssetLifecycleCoordinator) {
		this.#port = port; this.#opfs = opfs; this.#lifecycle = lifecycle;
		this.#chunks = new MediaAssetChunkRecords(port);
	}

	async inspect(input: unknown, options: CatalogOriginalRepairOptionsV1 = {}): Promise<CatalogOriginalInspectionOutcomeV1> {
		const binding = normalizeCatalogOriginalRepairBindingV1(input);
		const signal = readCatalogOriginalRepairSignalV1(options);
		throwIfAborted(signal);
		const admission = new MediaAssetWriteAdmission(this.#lifecycle, signal);
		try {
			const database = await this.#port.database();
			admission.throwIfCancelled();
			if (!database) throw new Error('Catalog original inspection requires durable IndexedDB custody.');
			const { record } = await readCatalogOriginalRepairCapture(database, binding, admission.signal);
			admission.throwIfCancelled();
			if (!record) return Object.freeze({ status: 'missing', reason: 'media-row' });
			admission.setIdentity({ path: typeof record.path === 'string' ? record.path : undefined,
				mediaChunkToken: typeof record.mediaChunkToken === 'string' ? record.mediaChunkToken : undefined });
			const opened = await inspectMediaAssetBinaryRecord(record, { opfs: this.#opfs, chunks: this.#chunks }, { signal: admission.signal });
			admission.throwIfCancelled();
			if (opened.status === 'missing') return opened;
			if (opened.body.size !== binding.size) return Object.freeze({ status: 'corrupt', reason: 'size' });
			const digest = await digestMediaContent(opened.body, { signal: admission.signal });
			admission.throwIfCancelled();
			return Object.freeze(digest === binding.sha256 ? { status: 'present' } : { status: 'corrupt', reason: 'digest' });
		} catch (error) {
			admission.throwIfCancelled();
			throw error;
		} finally {
			admission.complete();
			admission.release();
		}
	}
}
