import { cloneProject } from '../project.js';
import { throwIfAborted } from './app-helpers.ts';
import { EMPTY_ZIP32_LAYOUT, extendZip32Layout, type Zip32Layout } from './zip32.ts';

export interface TemporaryExportCopy {
	readonly temporaryExportClosed: string;
	readonly largeStemsStorageRequired: string;
	readonly stemArchiveClosed: string;
}

export interface TemporaryFileSink {
	readonly persistent: boolean;
	write(chunk: Uint8Array | ArrayBuffer | ArrayBufferView): Promise<void>;
	writeAt(position: number, chunk: Uint8Array | ArrayBuffer | ArrayBufferView): Promise<void>;
	close(mimeType: string): Promise<Blob>;
	remove(): Promise<void>;
	abort(): Promise<void>;
}

export interface StreamingStemArchive {
	add(
		fileName: string,
		input: Blob | Uint8Array | ArrayBuffer | ArrayBufferView,
		signal?: AbortSignal | null,
	): Promise<void>;
	finish(): Promise<{ readonly blob: Blob; readonly cleanup: () => Promise<void> }>;
	abort(): Promise<void>;
}

export type StreamingZipArchive = StreamingStemArchive;

export async function createTemporaryFileSink(name: string, copy: TemporaryExportCopy): Promise<TemporaryFileSink> {
	let directory: FileSystemDirectoryHandle | null = null;
	let handle: FileSystemFileHandle | null = null;
	let writable: FileSystemWritableFileStream | null = null;
	const chunks: Uint8Array[] = [];
	let queue = Promise.resolve();
	let closed = false;
	let scheduledByteLength = 0;
	try {
		const storage = globalThis.navigator?.storage as StorageManager & {
			getDirectory?(): Promise<FileSystemDirectoryHandle>;
		};
		const root = await storage?.getDirectory?.();
		directory = await root?.getDirectoryHandle?.('audio-editor-exports', { create: true }) || null;
		handle = await directory?.getFileHandle?.(name, { create: true }) || null;
		writable = await handle?.createWritable?.() || null;
	} catch {
		try {
			await writable?.abort?.();
			if (directory && handle) await directory.removeEntry(name);
		} catch {
			// Best-effort cleanup after OPFS setup fails.
		}
		directory = null;
		handle = null;
		writable = null;
	}
	return {
		persistent: Boolean(writable),
		write(chunk): Promise<void> {
			if (closed) throw new Error(copy.temporaryExportClosed);
			const bytes = Uint8Array.from(toUint8Array(chunk));
			const position = scheduledByteLength;
			scheduledByteLength = addSafeByteLengths(scheduledByteLength, bytes.byteLength);
			if (writable) {
				queue = queue.then(() => writable!.write({ type: 'write', position, data: bytes }));
			}
			else queue = queue.then(() => { chunks.push(bytes); });
			return queue;
		},
		writeAt(position, chunk): Promise<void> {
			if (closed) throw new Error(copy.temporaryExportClosed);
			const bytes = Uint8Array.from(toUint8Array(chunk));
			validateWriteRange(position, bytes.byteLength, scheduledByteLength);
			if (writable) {
				queue = queue.then(() => writable!.write({ type: 'write', position, data: bytes }));
			} else {
				queue = queue.then(() => { patchChunks(chunks, position, bytes); });
			}
			return queue;
		},
		async close(mimeType): Promise<Blob> {
			if (closed) throw new Error(copy.temporaryExportClosed);
			closed = true;
			await queue;
			if (writable && handle) {
				await writable.close();
				const file = await handle.getFile();
				return file.type === mimeType ? file : file.slice(0, file.size, mimeType);
			}
			return new Blob(chunks as BlobPart[], { type: mimeType });
		},
		async remove(): Promise<void> {
			if (directory && handle) {
				try {
					await directory.removeEntry(name);
				} catch {
					// Already removed.
				}
			}
		},
		async abort(): Promise<void> {
			closed = true;
			queue = queue.catch(() => undefined);
			await queue;
			try {
				await writable?.abort?.();
			} catch {
				// The writer may already be closed.
			}
			if (directory && handle) {
				try {
					await directory.removeEntry(name);
				} catch {
					// Already removed.
				}
			}
		},
	};
}

export async function createStreamingZipArchive(
	name: string,
	estimatedInputBytes = 0,
	copy: TemporaryExportCopy,
): Promise<StreamingZipArchive> {
	const sink = await createTemporaryFileSink(name, copy);
	if (!sink.persistent && estimatedInputBytes > 96 * 1024 ** 2) {
		await sink.abort();
		throw new Error(copy.largeStemsStorageRequired);
	}
	let fflate: typeof import('fflate');
	try {
		fflate = await import('fflate');
	} catch (error) {
		await sink.abort();
		throw error;
	}
	const { Zip, ZipPassThrough } = fflate;
	let writeQueue = Promise.resolve();
	let closed = false;
	let failed: Error | null = null;
	let zip32Layout: Zip32Layout = EMPTY_ZIP32_LAYOUT;
	let resolveFinished!: (value: { readonly blob: Blob; readonly cleanup: () => Promise<void> }) => void;
	let rejectFinished!: (reason?: unknown) => void;
	const finished = new Promise<{ readonly blob: Blob; readonly cleanup: () => Promise<void> }>((resolve, reject) => {
		resolveFinished = resolve;
		rejectFinished = reject;
	});
	void finished.catch(() => undefined);
	const zip = new Zip((error, chunk, final) => {
		if (error) {
			failed = error;
			closed = true;
			void sink.abort();
			rejectFinished(error);
			return;
		}
		if (chunk?.length) writeQueue = writeQueue.then(() => sink.write(chunk));
		if (final) {
			void writeQueue
				.then(() => sink.close('application/zip'))
				.then((blob) => resolveFinished({ blob, cleanup: () => sink.remove() }))
				.catch(async (closeError: unknown) => {
					failed = closeError instanceof Error ? closeError : new Error(String(closeError));
					closed = true;
					await sink.abort();
					rejectFinished(failed);
				});
		}
	});

	return {
		async add(fileName, input, signal = null): Promise<void> {
			if (closed || failed) throw failed || new Error(copy.stemArchiveClosed);
			throwIfAborted(signal);
			const nextLayout = extendZip32Layout(zip32Layout, {
				fileName,
				byteLength: inputByteLength(input),
			});
			if (!nextLayout.eligible) {
				failed = new RangeError('ZIP32 limits exceeded; use a 7z archive for these stems.');
				closed = true;
				try {
					zip.terminate?.();
				} catch {
					// The stream may already be complete.
				}
				await sink.abort();
				throw failed;
			}
			zip32Layout = nextLayout;
			try {
				const entry = new ZipPassThrough(fileName);
				zip.add(entry);
				if (input instanceof Blob) {
					const reader = input.stream().getReader();
					try {
						while (true) {
							throwIfAborted(signal);
							const { done, value } = await reader.read();
							throwIfAborted(signal);
							if (done) break;
							entry.push(value instanceof Uint8Array ? value : new Uint8Array(value), false);
							await writeQueue;
						}
					} catch (error) {
						try {
							await reader.cancel();
						} catch {
							// Cancellation is best effort after a source failure.
						}
						throw error;
					} finally {
						reader.releaseLock();
					}
				} else {
					const bytes = toUint8Array(input);
					if (bytes.length) entry.push(bytes, false);
				}
				entry.push(new Uint8Array(0), true);
				await writeQueue;
			} catch (error) {
				failed = error instanceof Error ? error : new Error(String(error));
				closed = true;
				try {
					zip.terminate?.();
				} catch {
					// The stream may already be complete.
				}
				await sink.abort();
				throw error;
			}
		},
		async finish() {
			if (failed) throw failed;
			if (closed) return finished;
			closed = true;
			zip.end();
			return finished;
		},
		async abort(): Promise<void> {
			const wasClosed = closed;
			closed = true;
			if (!failed) {
				failed = new Error(copy.stemArchiveClosed);
				rejectFinished(failed);
			}
			if (!wasClosed) {
				try {
					zip.terminate?.();
				} catch {
					// The stream may already be complete.
				}
			}
			await sink.abort();
		},
	};
}

export function stemProject(
	project: Parameters<typeof cloneProject>[0],
	trackId: string,
): ReturnType<typeof cloneProject> {
	const snapshot = cloneProject(project);
	snapshot.tracks = snapshot.tracks.map((track) => track.id === trackId
		? { ...track, mute: false, solo: false }
		: { ...track, mute: true, solo: false, effects: [] });
	snapshot.master = { gain: 1, effects: [] };
	return snapshot;
}

function toUint8Array(input: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
	if (input instanceof Uint8Array) return input;
	if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	return new Uint8Array(input);
}

function inputByteLength(input: Blob | Uint8Array | ArrayBuffer | ArrayBufferView): number {
	const byteLength = input instanceof Blob ? input.size : toUint8Array(input).byteLength;
	if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
		throw new RangeError('Archive input sizes must be nonnegative safe integers.');
	}
	return byteLength;
}

function addSafeByteLengths(left: number, right: number): number {
	if (!Number.isSafeInteger(right) || right < 0 || left > Number.MAX_SAFE_INTEGER - right) {
		throw new RangeError('Temporary export size exceeds JavaScript\'s safe-integer range.');
	}
	return left + right;
}

function validateWriteRange(position: number, byteLength: number, availableByteLength: number): void {
	if (!Number.isSafeInteger(position) || position < 0
		|| position > availableByteLength
		|| byteLength > availableByteLength - position) {
		throw new RangeError('Positioned writes must stay within bytes already written to the temporary export.');
	}
}

function patchChunks(chunks: readonly Uint8Array[], position: number, bytes: Uint8Array): void {
	let chunkStart = 0;
	let sourceOffset = 0;
	for (const chunk of chunks) {
		const chunkEnd = chunkStart + chunk.byteLength;
		if (position < chunkEnd && sourceOffset < bytes.byteLength) {
			const destinationOffset = Math.max(0, position - chunkStart);
			const copyLength = Math.min(chunk.byteLength - destinationOffset, bytes.byteLength - sourceOffset);
			chunk.set(bytes.subarray(sourceOffset, sourceOffset + copyLength), destinationOffset);
			sourceOffset += copyLength;
			position += copyLength;
		}
		chunkStart = chunkEnd;
		if (sourceOffset === bytes.byteLength) return;
	}
}
