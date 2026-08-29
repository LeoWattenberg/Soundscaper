/* SPDX-License-Identifier: AGPL-3.0-only */

import { isOpfsPcmStorage, type StorageRecord } from './media-records.ts';
import type { KeyValueRepository } from './key-value-repository.ts';
import type { MediaRepository } from './media-repository.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { PcmRepository } from './pcm-repository.ts';
import type { SourceReadOptions, SourceReadRepository } from './source-read-repository.ts';
import type { SourceRecordRepository } from './source-record-repository.ts';
import type {
	AudioSourceStageReceipt,
	OwnedAudioSourceWriter,
	SourceWriteRepository,
} from './source-write-repository.ts';
import type { TransientAnalysisCacheRepository } from './transient-analysis-cache-repository.ts';

const WAVEFORM_PEAK_CACHE_PREFIXES = Object.freeze(['audio-editor-peaks-v1:', 'audio-editor-peaks-v2:']);

export interface SourceRepositoryOptions {
	readonly records: SourceRecordRepository;
	readonly writer: SourceWriteRepository;
	readonly reader: SourceReadRepository;
	readonly media: MediaRepository;
	readonly analysis: KeyValueRepository;
	readonly transientAnalysisCache?: Pick<TransientAnalysisCacheRepository, 'purge'>;
	readonly opfs: OpfsRepository;
	readonly pcm: PcmRepository;
}

/** Public source domain assembled from bounded write and read ports. */
export class SourceRepository {
	readonly #options: SourceRepositoryOptions;

	constructor(options: SourceRepositoryOptions) {
		this.#options = options;
	}

	beginWrite(sourceId: string, metadata: Record<string, unknown> = {}): Promise<OwnedAudioSourceWriter> {
		return this.#options.writer.begin(sourceId, metadata);
	}

	createStageReceipt(sourceId: string): AudioSourceStageReceipt {
		return this.#options.writer.createStageReceipt(sourceId);
	}

	beginOwnedStage(
		receipt: AudioSourceStageReceipt,
		metadata: Record<string, unknown> = {},
	): Promise<OwnedAudioSourceWriter> {
		return this.#options.writer.beginOwned(receipt, metadata);
	}

	discardStageIfCurrent(receipt: AudioSourceStageReceipt): Promise<boolean> {
		return this.#options.writer.discardStageIfCurrent(receipt);
	}

	writeDerived(
		sourceId: string,
		baseSourceId: string,
		replacementChunks: readonly unknown[],
		metadata: Record<string, unknown> = {},
	): Promise<StorageRecord> {
		return this.#options.writer.writeDerived(sourceId, baseSourceId, replacementChunks, metadata);
	}

	writeAudioBuffer(
		sourceId: string,
		audioBuffer: AudioBuffer,
		metadata: Record<string, unknown> = {},
		options: { readonly chunkFrames?: number } = {},
	): Promise<StorageRecord> {
		return this.#options.writer.writeAudioBuffer(sourceId, audioBuffer, metadata, options);
	}

	getMetadata(sourceId: string): Promise<StorageRecord | null> {
		return this.#options.reader.getMetadata(sourceId);
	}

	replaceMetadataIfCurrent(expected: StorageRecord, replacement: StorageRecord): Promise<boolean> {
		return this.#options.records.compareAndSwapMetadata(expected, replacement);
	}

	list(): Promise<StorageRecord[]> {
		return this.#options.records.list();
	}

	chunks(sourceId: string, options: SourceReadOptions = {}) {
		return this.#options.reader.chunks(sourceId, options);
	}

	chunk(sourceId: string, chunkIndex: number, options: SourceReadOptions = {}) {
		return this.#options.reader.chunk(sourceId, chunkIndex, options);
	}

	openReadSession(sourceId: string, options: SourceReadOptions = {}) {
		return this.#options.reader.openSession(sourceId, options);
	}

	releaseReadSessions(): Promise<void> {
		return this.#options.reader.releaseSessions();
	}

	loadAudioBuffer(sourceId: string, audioContext: BaseAudioContext) {
		return this.#options.reader.loadAudioBuffer(sourceId, audioContext);
	}

	async delete(sourceId: string): Promise<void> {
		const deletion = await this.#options.records.deleteMetadataIfUnreferenced(sourceId);
		if (deletion.status === 'retained') {
			throw new Error(`Source ${sourceId} is retained by derived source ${deletion.dependentSourceId}.`);
		}
		if (deletion.status === 'deleted') await this.deleteStored(deletion.record);
		await this.#options.media.deleteAsset(sourceId);
		// Cache payloads are disposable. Their cleanup can be retried and must
		// never change the already-committed authoritative source deletion.
		await this.#options.transientAnalysisCache?.purge().catch(() => undefined);
		for (const prefix of WAVEFORM_PEAK_CACHE_PREFIXES) {
			await this.#options.analysis.delete(`${prefix}${sourceId}`);
		}
	}

	async discardIfCurrent(source: StorageRecord): Promise<boolean> {
		if (!await this.#options.records.deleteMetadataIfCurrent(source)) return false;
		await this.deleteStored(source);
		return true;
	}

	async deleteStored(source: StorageRecord): Promise<void> {
		if (isOpfsPcmStorage(source.storage) && source.path) {
			await this.#options.opfs.deletePath(source.path);
			return;
		}
		if (source.sourceToken) await this.#options.records.deleteChunks(source.sourceToken);
	}

	async stopBackgroundWork({ closeCodec = false }: { readonly closeCodec?: boolean } = {}): Promise<void> {
		try {
			await this.#options.reader.releaseSessions();
		} finally {
			this.#options.opfs.clearCache();
			if (closeCodec) this.#options.pcm.closeOwnedCodec();
		}
	}
}
