/* SPDX-License-Identifier: AGPL-3.0-only */

import { isOpfsPcmStorage, type StorageRecord } from './media-records.ts';
import type { KeyValueRepository } from './key-value-repository.ts';
import type { MediaRepository } from './media-repository.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { PcmMigrationRepository } from './pcm-migration-repository.ts';
import type { SourceReadOptions, SourceReadRepository } from './source-read-repository.ts';
import type { SourceRecordRepository } from './source-record-repository.ts';
import type { AudioSourceWriter, SourceWriteRepository } from './source-write-repository.ts';

const WAVEFORM_PEAK_CACHE_PREFIXES = Object.freeze(['audio-editor-peaks-v1:', 'audio-editor-peaks-v2:']);

export interface SourceRepositoryOptions {
	readonly records: SourceRecordRepository;
	readonly writer: SourceWriteRepository;
	readonly reader: SourceReadRepository;
	readonly migrations: PcmMigrationRepository;
	readonly media: MediaRepository;
	readonly analysis: KeyValueRepository;
	readonly opfs: OpfsRepository;
}

/** Public source domain assembled from bounded write, read, and migration ports. */
export class SourceRepository {
	readonly #options: SourceRepositoryOptions;

	constructor(options: SourceRepositoryOptions) {
		this.#options = options;
	}

	beginWrite(sourceId: string, metadata: Record<string, unknown> = {}): Promise<AudioSourceWriter> {
		return this.#options.writer.begin(sourceId, metadata);
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

	list(): Promise<StorageRecord[]> {
		return this.#options.records.list();
	}

	chunks(sourceId: string, options: SourceReadOptions = {}) {
		return this.#options.reader.chunks(sourceId, options);
	}

	chunk(sourceId: string, chunkIndex: number, options: SourceReadOptions = {}) {
		return this.#options.reader.chunk(sourceId, chunkIndex, options);
	}

	loadAudioBuffer(sourceId: string, audioContext: BaseAudioContext) {
		return this.#options.reader.loadAudioBuffer(sourceId, audioContext);
	}

	async delete(sourceId: string): Promise<void> {
		await this.#options.migrations.cancel(sourceId);
		const source = await this.#options.records.getMetadata(sourceId);
		if (source) {
			const dependent = (await this.list()).find((candidate) => candidate.baseSourceId === sourceId);
			if (dependent) throw new Error(`Source ${sourceId} is retained by derived source ${String(dependent.id)}.`);
			await this.#options.records.deleteMetadata(sourceId);
			await this.deleteStored(source);
		}
		await this.#options.media.deleteAsset(sourceId);
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

	queueMigration(source: StorageRecord): void {
		this.#options.migrations.queue(source);
	}

	pendingMigrationSourceIds(): string[] {
		return this.#options.migrations.pendingSourceIds();
	}

	forgetMigrationFailures(sourceIds: Iterable<string>): void {
		this.#options.migrations.forgetFailures(sourceIds);
	}

	stopBackgroundWork(options: { readonly closeCodec?: boolean; readonly clearFailures?: boolean } = {}): Promise<void> {
		return this.#options.migrations.stop(options);
	}
}
