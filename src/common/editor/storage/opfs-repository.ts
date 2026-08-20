/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PCM_CONTAINER_EXTENSION,
	PcmContainerWriter,
	compressionStatistics,
	containerCodecToEncoding,
	parsePcmContainerIndex,
	readPcmContainerPayload,
} from '../wavpack/index.js';
import {
	blobWithMimeType,
	type BlobLike,
	type StorageRecord,
} from './media-records.ts';
import { MediaAssetCleanupError } from './media-asset-cleanup-error.ts';
import { OpfsSyncRepositoryBridge } from './opfs-sync-repository-bridge.ts';
import type { OpfsSyncStoragePort } from './opfs-sync-worker-client.ts';
import type { OpfsSyncOperationId } from './opfs-sync-worker-protocol.ts';
import { syncBinaryWriter, syncPcmWriter } from './opfs-sync-writer-adapters.ts';

export const DEFAULT_OPFS_DIRECTORY_NAME = 'audio-editor-sources';

interface PcmIndexEntry {
	readonly index: number;
	readonly frames: number;
	readonly codec: number;
	readonly pcmCrc32: number;
}

interface PcmContainerIndex {
	readonly entries: readonly PcmIndexEntry[];
}

interface PcmChunk {
	readonly index: number;
	readonly frames: number;
	readonly channels: readonly Float32Array[];
}

interface StoredPcmChunk extends Record<string, unknown> {
	readonly frames: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly chunkFrames: number;
}

interface PcmWriter {
	readonly path: string;
	write(chunk: StoredPcmChunk): Promise<void>;
	close(): Promise<Record<string, unknown>>;
	remove(): Promise<void>;
	abort(): Promise<void>;
}

export interface OpfsBinaryWriter {
	readonly path: string;
	write(bytes: Uint8Array, options?: Readonly<{ signal?: AbortSignal }>): Promise<void>;
	close(options?: Readonly<{ signal?: AbortSignal }>): Promise<void>;
	abort(): Promise<void>;
}

export interface OpfsBinaryWriterPlan {
	readonly path: string;
	open(): Promise<OpfsBinaryWriter | null>;
}

interface ContainerWriterInstance {
	write(chunk: StoredPcmChunk): Promise<void>;
	close(): Promise<Record<string, unknown>>;
	statistics(): Record<string, unknown>;
}

type ContainerWriterConstructor = new (
	writable: FileSystemWritableFileStream,
	options: {
		readonly channelCount: number;
		readonly sampleRate: number;
		readonly chunkFrames: number;
	},
) => ContainerWriterInstance;

const ContainerWriter = PcmContainerWriter as unknown as ContainerWriterConstructor;

type DecodeChunk = (
	record: Record<string, unknown>,
	source: StorageRecord,
	signal: AbortSignal | undefined,
	priority: string,
) => Promise<PcmChunk>;

export interface OpfsRepositoryOptions {
	readonly preferOpfs: boolean;
	readonly storageManager?: StorageManager | null;
	readonly opfsRoot?: FileSystemDirectoryHandle | null;
	readonly opfsDirectoryName?: string;
	readonly opfsWorkerName?: string;
	readonly syncWorkerClient?: OpfsSyncStoragePort | null;
}

/** Origin-private binary and PCM-container storage. */
export class OpfsRepository {
	readonly #options: OpfsRepositoryOptions;
	#directoryPromise: Promise<FileSystemDirectoryHandle | null> | null = null;
	readonly #indexCache = new Map<string, Promise<PcmContainerIndex>>();
	readonly #sync: OpfsSyncRepositoryBridge;

	constructor(options: OpfsRepositoryOptions) {
		this.#options = options;
		this.#sync = new OpfsSyncRepositoryBridge({
			client: options.syncWorkerClient,
			workerName: options.opfsWorkerName,
		});
	}

	async directory(): Promise<FileSystemDirectoryHandle | null> {
		if (!this.#options.preferOpfs) return null;
		if (!this.#directoryPromise) {
			this.#directoryPromise = (async () => {
				try {
					const root = this.#options.opfsRoot || await this.#options.storageManager?.getDirectory?.();
					if (!root?.getDirectoryHandle) return null;
					return root.getDirectoryHandle(
						this.#options.opfsDirectoryName ?? DEFAULT_OPFS_DIRECTORY_NAME,
						{ create: true },
					);
				} catch {
					return null;
				}
			})();
		}
		return this.#directoryPromise;
	}

	async loadBinaryRecord(
		record: StorageRecord,
		missingMessage: string,
		operationId: OpfsSyncOperationId = 'media-asset-chunk-read',
	): Promise<BlobLike> {
		if (record.storage !== 'opfs') {
			if (!record.blob) throw new Error(missingMessage);
			return blobWithMimeType(record.blob as BlobLike, record.mimeType);
		}
		const directory = await this.directory();
		try {
			const snapshot = record.path && directory
				? await this.#sync.snapshot(directory, operationId, record.path)
				: null;
			if (snapshot) return blobWithMimeType(snapshot, record.mimeType);
			const handle = record.path ? await directory?.getFileHandle(record.path) : null;
			if (!handle) throw new Error(missingMessage);
			return blobWithMimeType(await handle.getFile(), record.mimeType);
		} catch {
			throw new Error(missingMessage);
		}
	}

	async writeBlob(
		prefix: string,
		blob: BlobLike,
		{
			signal,
			operationId = 'media-asset-chunk-write',
		}: { readonly signal?: AbortSignal; readonly operationId?: OpfsSyncOperationId } = {},
	): Promise<{ path: string } | null> {
		throwIfAborted(signal);
		const directory = await this.directory();
		throwIfAborted(signal);
		if (!directory?.getFileHandle) return null;
		const stem = String(prefix || 'media').replace(/[^a-z0-9._-]+/giu, '-').slice(0, 80);
		const path = `${stem}-${createId('asset').replace(/[^a-z0-9._-]+/giu, '-')}.blob`;
		let writable: FileSystemWritableFileStream | undefined;
		try {
			if (await this.#sync.writeBlob(directory, operationId, path, blob, signal)) return { path };
			const handle = await directory.getFileHandle(path, { create: true });
			throwIfAborted(signal);
			writable = await handle.createWritable();
			throwIfAborted(signal);
			await writable.write(blob as Blob);
			throwIfAborted(signal);
			await writable.close();
			throwIfAborted(signal);
			return { path };
		} catch {
			try { await writable?.abort(); } catch { /* A failed OPFS write may already be closed. */ }
			await this.deletePath(path);
			throwIfAborted(signal);
			return null;
		}
	}

	async planBinaryWriter(
		prefix: string,
		{ signal }: { readonly signal?: AbortSignal } = {},
	): Promise<OpfsBinaryWriterPlan | null> {
		throwIfAborted(signal);
		const directory = await this.directory();
		throwIfAborted(signal);
		if (!directory?.getFileHandle) return null;
		const stem = String(prefix || 'media').replace(/[^a-z0-9._-]+/giu, '-').slice(0, 80);
		const path = `${stem}-${createId('asset').replace(/[^a-z0-9._-]+/giu, '-')}.blob`;
		if (await this.#sync.available(directory)) {
			return {
				path,
				open: async () => {
					const writer = await this.#sync.openWriter(
						directory, 'media-asset-chunk-write', path, signal,
					);
					return writer ? syncBinaryWriter(path, writer, signal) : null;
				},
			};
		}
		return {
			path,
			open: () => openBinaryWriter(directory, path, signal),
		};
	}

	async deleteBinaryRecords(records: readonly (StorageRecord | null | undefined)[]): Promise<void> {
		for (const record of records || []) {
			if (record?.storage === 'opfs' && record.path) await this.deletePath(record.path);
		}
	}

	async deletePath(path: string | null | undefined): Promise<void> {
		if (!path) return;
		this.#indexCache.delete(path);
		const directory = await this.directory();
		try {
			if (directory && await this.#sync.remove(directory, path)) return;
			await directory?.removeEntry(path);
		} catch { /* Missing and orphaned files are harmless. */ }
	}

	/** Delete a durably referenced path, reconciling acknowledgement loss and surfacing retained bodies. */
	async deletePathExact(pathValue: string): Promise<void> {
		if (!pathValue || pathValue !== pathValue.trim() || pathValue.length > 512
			|| /[\u0000-\u001f\u007f]/u.test(pathValue)) {
			throw new TypeError('An exact OPFS deletion requires a valid path.');
		}
		this.#indexCache.delete(pathValue);
		const directory = await this.directory();
		if (!directory?.getFileHandle || !directory.removeEntry) {
			throw new Error('The exact OPFS deletion backend is unavailable.');
		}
		let removalFailure: unknown = null;
		try {
			if (!await this.#sync.remove(directory, pathValue)) await directory.removeEntry(pathValue);
		} catch (error) { removalFailure = error; }
		try {
			await directory.getFileHandle(pathValue);
		} catch (error) {
			if (isNotFoundError(error)) return;
			if (removalFailure !== null) {
				throw new AggregateError([removalFailure, error], 'Exact OPFS deletion could not verify its result.');
			}
			throw error;
		}
		if (removalFailure !== null) throw removalFailure;
		throw new Error('Exact OPFS deletion left its referenced path present.');
	}

	invalidate(path: string | null | undefined): void {
		if (path) this.#indexCache.delete(path);
	}

	async createPcmWriter(token: string, metadata: StorageRecord = {}): Promise<PcmWriter | null> {
		const directory = await this.directory();
		if (!directory?.getFileHandle) return null;
		const path = `${token.replace(/[^a-z0-9._-]+/giu, '-')}${PCM_CONTAINER_EXTENSION}`;
		const invalidate = () => this.invalidate(path);
		try {
			const syncWriter = await this.#sync.openWriter(
				directory, 'canonical-pcm-chunk-write', path,
			);
			if (syncWriter) return syncPcmWriter(path, syncWriter, metadata, invalidate, () => this.deletePath(path));
			const handle = await directory.getFileHandle(path, { create: true });
			const writable = await handle.createWritable();
			let container: ContainerWriterInstance | null = null;
			let closed = false;
			return {
				path,
				async write(chunk) {
					if (closed) throw new Error('The OPFS source writer is closed.');
					if (!container) {
						container = new ContainerWriter(writable, {
							channelCount: chunk.channelCount,
							sampleRate: chunk.sampleRate ?? metadata.sampleRate ?? 48_000,
							chunkFrames: chunk.chunkFrames ?? metadata.chunkFrames ?? chunk.frames,
						});
					}
					await container.write(chunk);
				},
				async close() {
					if (closed) return container?.statistics() || compressionStatistics();
					closed = true;
					if (container) return container.close();
					await writable.close();
					return compressionStatistics();
				},
				async remove() {
					invalidate();
					try { await directory.removeEntry(path); } catch { /* Already absent. */ }
				},
				async abort() {
					if (!closed) {
						closed = true;
						if (typeof writable.abort === 'function') await writable.abort();
						else await writable.close();
					}
					invalidate();
					try { await directory.removeEntry(path); } catch { /* Already absent. */ }
				},
			};
		} catch {
			try { await directory.removeEntry(path); } catch { /* Creation may not have reached disk. */ }
			return null;
		}
	}

	async *readPcmContainerChunks(
		source: StorageRecord,
		decode: DecodeChunk,
		{ priority = 'foreground', signal }: { readonly priority?: string; readonly signal?: AbortSignal } = {},
	): AsyncGenerator<PcmChunk> {
		throwIfAborted(signal);
		const file = await this.#sourceFile(source, signal);
		throwIfAborted(signal);
		const index = await this.#containerIndex(source, file);
		throwIfAborted(signal);
		for (const entry of index.entries) {
			throwIfAborted(signal);
			const payload = await readPcmContainerPayload(file, entry, { signal });
			throwIfAborted(signal);
			yield await decode(containerRecord(entry, payload), source, signal, priority);
		}
	}

	async readPcmContainerChunk(
		source: StorageRecord,
		chunkIndex: number,
		decode: DecodeChunk,
		signal?: AbortSignal,
		priority = 'foreground',
	): Promise<PcmChunk> {
		const file = await this.#sourceFile(source, signal);
		const index = await this.#containerIndex(source, file);
		const entry = index.entries[chunkIndex];
		if (!entry) throw new RangeError(`Source storage chunk ${chunkIndex} does not exist.`);
		const payload = await readPcmContainerPayload(file, entry, { signal });
		return decode(containerRecord(entry, payload), source, signal, priority);
	}

	async *readLegacyChunks(
		source: StorageRecord,
		{ signal }: { readonly signal?: AbortSignal } = {},
	): AsyncGenerator<PcmChunk> {
		throwIfAborted(signal);
		const file = await this.#sourceFile(source, signal);
		throwIfAborted(signal);
		let offset = 0;
		let index = 0;
		while (offset < file.size) {
			throwIfAborted(signal);
			if (file.size - offset < 8) throw new Error('The local audio source is truncated.');
			const header = new DataView(await file.slice(offset, offset + 8).arrayBuffer());
			throwIfAborted(signal);
			const frames = header.getUint32(0, true);
			const channelCount = header.getUint16(4, true);
			offset += 8;
			const channelBytes = frames * Float32Array.BYTES_PER_ELEMENT;
			if (!frames || !channelCount || offset + channelBytes * channelCount > file.size) {
				throw new Error('The local audio source contains an invalid chunk.');
			}
			const channels: Float32Array[] = [];
			for (let channel = 0; channel < channelCount; channel += 1) {
				channels.push(new Float32Array(await file.slice(offset, offset + channelBytes).arrayBuffer()));
				throwIfAborted(signal);
				offset += channelBytes;
			}
			yield { index, frames, channels };
			index += 1;
		}
	}

	async readLegacyChunk(source: StorageRecord, chunkIndex: number, signal?: AbortSignal): Promise<PcmChunk> {
		const chunkFrames = nonNegativeInteger(source.chunkFrames, 0);
		const channelCount = nonNegativeInteger(source.channelCount, 0);
		if (!chunkFrames || !channelCount) {
			for await (const chunk of this.readLegacyChunks(source, { signal })) {
				throwIfAborted(signal);
				if (chunk.index === chunkIndex) return chunk;
			}
			throw new RangeError(`Source storage chunk ${chunkIndex} does not exist.`);
		}
		const file = await this.#sourceFile(source, signal);
		throwIfAborted(signal);
		const fullChunkBytes = 8 + chunkFrames * channelCount * Float32Array.BYTES_PER_ELEMENT;
		let offset = chunkIndex * fullChunkBytes;
		if (file.size - offset < 8) throw new Error('The local audio source is truncated.');
		const header = new DataView(await file.slice(offset, offset + 8).arrayBuffer());
		const frames = header.getUint32(0, true);
		const storedChannelCount = header.getUint16(4, true);
		if (!frames || frames > chunkFrames || storedChannelCount !== channelCount) {
			throw new Error('The local audio source contains an invalid chunk.');
		}
		offset += 8;
		const channelBytes = frames * Float32Array.BYTES_PER_ELEMENT;
		if (offset + channelBytes * channelCount > file.size) throw new Error('The local audio source is truncated.');
		const channels: Float32Array[] = [];
		for (let channel = 0; channel < channelCount; channel += 1) {
			throwIfAborted(signal);
			channels.push(new Float32Array(await file.slice(offset, offset + channelBytes).arrayBuffer()));
			offset += channelBytes;
		}
		return { index: chunkIndex, frames, channels };
	}

	async cleanupOrphans(retainedPaths: ReadonlySet<string>, cutoff: number): Promise<void> {
		const directory = await this.directory();
		if (!directory?.entries) return;
		for await (const [name, handle] of directory.entries()) {
			if (retainedPaths.has(name) || handle.kind !== 'file') continue;
			try {
				const file = await handle.getFile();
				if (file.lastModified < cutoff) await this.deletePath(name);
			} catch { /* A concurrently removed file needs no cleanup. */ }
		}
	}

	clearCache(): void {
		this.#indexCache.clear();
	}

	close(): void {
		this.#indexCache.clear();
		this.#sync.close();
	}

	async #containerIndex(source: StorageRecord, file: BlobLike): Promise<PcmContainerIndex> {
		if (!source.path) throw new Error('The requested local audio source is missing.');
		let cached = this.#indexCache.get(source.path);
		if (!cached) {
			cached = parsePcmContainerIndex(file, {
				expectedChannelCount: source.channelCount,
				expectedSampleRate: source.sampleRate,
				expectedChunkFrames: source.chunkFrames,
				expectedChunkCount: source.chunkCount,
				expectedFrameCount: source.frameCount ?? source.frameLength,
			}) as Promise<PcmContainerIndex>;
			this.#indexCache.set(source.path, cached);
			cached.catch(() => {
				if (this.#indexCache.get(source.path as string) === cached) this.#indexCache.delete(source.path as string);
			});
		}
		return cached;
	}

	async #sourceFile(source: StorageRecord, signal?: AbortSignal): Promise<BlobLike> {
		const directory = await this.directory();
		if (!directory) throw new Error('Origin-private audio storage is unavailable.');
		try {
			if (!source.path) throw new Error('Missing path.');
			const readable = await this.#sync.readable(
				directory, 'canonical-pcm-chunk-read', source.path, signal,
			);
			if (readable) return readable;
			const handle = await directory.getFileHandle(source.path);
			return await handle.getFile();
		} catch {
			throwIfAborted(signal);
			throw new Error('The requested local audio source is missing.');
		}
	}
}

async function openBinaryWriter(
	directory: FileSystemDirectoryHandle,
	path: string,
	defaultSignal?: AbortSignal,
): Promise<OpfsBinaryWriter | null> {
	const remove = (): Promise<void> => removeStagedPath(directory, path);
	let writable: FileSystemWritableFileStream | undefined;
	try {
		const handle = await directory.getFileHandle(path, { create: true });
		throwIfAborted(defaultSignal);
		writable = await handle.createWritable();
		throwIfAborted(defaultSignal);
	} catch (error) {
		try { await writable?.abort(); } catch { /* Creation may not have reached a writable stream. */ }
		try {
			await remove();
		} catch (removeError) {
			throw new MediaAssetCleanupError(
				[error, removeError],
				'OPFS media writer creation and staged-file removal both failed.',
			);
		}
		throwIfAborted(defaultSignal);
		return null;
	}
	let closed = false;
	return {
		path,
		async write(bytes, options = {}) {
			if (closed) throw new Error('The OPFS media writer is closed.');
			throwIfAborted(options.signal ?? defaultSignal);
			await writable?.write(copyArrayBuffer(bytes));
			throwIfAborted(options.signal ?? defaultSignal);
		},
		async close(options = {}) {
			if (closed) return;
			throwIfAborted(options.signal ?? defaultSignal);
			await writable?.close();
			closed = true;
			throwIfAborted(options.signal ?? defaultSignal);
		},
		async abort() {
			let abortError: unknown;
			if (!closed) {
				closed = true;
				try { await writable?.abort(); } catch (error) { abortError = error; }
			}
			try {
				await remove();
			} catch (removeError) {
				if (abortError !== undefined) {
					throw new MediaAssetCleanupError(
						[abortError, removeError],
						'OPFS media writer abort and staged-file removal both failed.',
					);
				}
				throw removeError;
			}
		},
	};
}

function containerRecord(entry: PcmIndexEntry, payload: unknown): Record<string, unknown> {
	return {
		index: entry.index,
		frames: entry.frames,
		encoding: containerCodecToEncoding(entry.codec),
		payload,
		pcmCrc32: entry.pcmCrc32,
	};
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') throw new DOMException('Audio storage was cancelled.', 'AbortError');
	const error = new Error('Audio storage was cancelled.');
	error.name = 'AbortError';
	throw error;
}

function createId(prefix: string): string {
	if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

async function removeStagedPath(directory: FileSystemDirectoryHandle, path: string): Promise<void> {
	try {
		await directory.removeEntry(path);
	} catch (error) {
		if (isNotFoundError(error)) return;
		throw error;
	}
}

function isNotFoundError(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && (error as { readonly name?: unknown }).name === 'NotFoundError');
}

function nonNegativeInteger(value: unknown, fallback: number): number {
	return Number.isFinite(value) && Number(value) >= 0 ? Math.floor(Number(value)) : fallback;
}
