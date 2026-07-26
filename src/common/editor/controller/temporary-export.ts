import { cloneProject } from '../project.js';
import { throwIfAborted } from './app-helpers.ts';

interface TemporaryExportCopy {
	readonly temporaryExportClosed: string;
	readonly largeStemsStorageRequired: string;
	readonly stemArchiveClosed: string;
}

interface TemporaryFileSink {
	readonly persistent: boolean;
	write(chunk: Uint8Array | ArrayBuffer | ArrayBufferView): Promise<void>;
	close(mimeType: string): Promise<Blob>;
	remove(): Promise<void>;
	abort(): Promise<void>;
}

export interface StreamingZipArchive {
	add(
		fileName: string,
		input: Blob | Uint8Array | ArrayBuffer | ArrayBufferView,
		signal?: AbortSignal | null,
	): Promise<void>;
	finish(): Promise<{ readonly blob: Blob; readonly cleanup: () => Promise<void> }>;
	abort(): Promise<void>;
}

export async function createTemporaryFileSink(name: string, copy: TemporaryExportCopy): Promise<TemporaryFileSink> {
	let directory: FileSystemDirectoryHandle | null = null;
	let handle: FileSystemFileHandle | null = null;
	let writable: FileSystemWritableFileStream | null = null;
	const chunks: BlobPart[] = [];
	let queue = Promise.resolve();
	let closed = false;
	try {
		const storage = globalThis.navigator?.storage as StorageManager & {
			getDirectory?(): Promise<FileSystemDirectoryHandle>;
		};
		const root = await storage?.getDirectory?.();
		directory = await root?.getDirectoryHandle?.('audio-editor-exports', { create: true }) || null;
		handle = await directory?.getFileHandle?.(name, { create: true }) || null;
		writable = await handle?.createWritable?.() || null;
	} catch {
		directory = null;
		handle = null;
		writable = null;
	}
	return {
		persistent: Boolean(writable),
		write(chunk): Promise<void> {
			if (closed) throw new Error(copy.temporaryExportClosed);
			const bytes = Uint8Array.from(toUint8Array(chunk));
			if (writable) queue = queue.then(() => writable!.write(bytes));
			else chunks.push(bytes as BlobPart);
			return queue;
		},
		async close(mimeType): Promise<Blob> {
			if (closed) throw new Error(copy.temporaryExportClosed);
			closed = true;
			await queue;
			if (writable && handle) {
				await writable.close();
				return handle.getFile();
			}
			return new Blob(chunks, { type: mimeType });
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
	const { Zip, ZipPassThrough } = await import('fflate');
	let writeQueue = Promise.resolve();
	let closed = false;
	let failed: Error | null = null;
	let resolveFinished!: (value: { readonly blob: Blob; readonly cleanup: () => Promise<void> }) => void;
	let rejectFinished!: (reason?: unknown) => void;
	const finished = new Promise<{ readonly blob: Blob; readonly cleanup: () => Promise<void> }>((resolve, reject) => {
		resolveFinished = resolve;
		rejectFinished = reject;
	});
	const zip = new Zip((error, chunk, final) => {
		if (error) {
			failed = error;
			rejectFinished(error);
			return;
		}
		if (chunk?.length) writeQueue = writeQueue.then(() => sink.write(chunk));
		if (final) {
			writeQueue
				.then(() => sink.close('application/zip'))
				.then((blob) => resolveFinished({ blob, cleanup: () => sink.remove() }), rejectFinished);
		}
	});

	return {
		async add(fileName, input, signal = null): Promise<void> {
			if (closed || failed) throw failed || new Error(copy.stemArchiveClosed);
			throwIfAborted(signal);
			const entry = new ZipPassThrough(fileName);
			zip.add(entry);
			if (input instanceof Blob) {
				const reader = input.stream().getReader();
				try {
					while (true) {
						throwIfAborted(signal);
						const { done, value } = await reader.read();
						if (done) break;
						entry.push(value instanceof Uint8Array ? value : new Uint8Array(value), false);
					}
				} finally {
					reader.releaseLock();
				}
			} else {
				const bytes = toUint8Array(input);
				if (bytes.length) entry.push(bytes, false);
			}
			entry.push(new Uint8Array(0), true);
			await writeQueue;
		},
		async finish() {
			if (closed) return finished;
			closed = true;
			zip.end();
			return finished;
		},
		async abort(): Promise<void> {
			const wasClosed = closed;
			closed = true;
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
