/* SPDX-License-Identifier: AGPL-3.0-only */
import { createScapeArchiveByteSource, type ScapeArchiveByteSource } from '../common/editor/scape-archive-byte-source.ts';
import { MOTIONSCAPER_FILE_CHUNK_BYTES, MOTIONSCAPER_FILE_METHODS, type MotionDesktopFiles, type MotionSaveFileReceipt } from './desktop-file-contract.ts';

export interface MotionDesktopArchiveInput {
	readonly input: ScapeArchiveByteSource; readonly name: string;
	bind(projectId: string): Promise<void>; release(): Promise<void>;
}
export interface MotionDesktopArchiveOutput {
	readonly writable: WritableStream<Uint8Array>;
	commit(): Promise<MotionSaveFileReceipt>;
	abort(): Promise<void>;
}
export function motionscaperDesktopFiles(value: unknown = globalThis): MotionDesktopFiles | null {
	const global = value as { scapeDesktop?: { v1?: { motionFiles?: unknown } } } | null;
	const files = global?.scapeDesktop?.v1?.motionFiles;
	if (!files || typeof files !== 'object') return null;
	if (!MOTIONSCAPER_FILE_METHODS.every((method) => typeof (files as Record<string, unknown>)[method] === 'function')) throw new TypeError('Motionscaper desktop file bridge is incomplete.');
	return files as MotionDesktopFiles;
}

/** The importer sees bounded archive bytes and never receives a filesystem path. */
export async function selectMotionscaperDesktopArchive(files: MotionDesktopFiles, signal?: AbortSignal): Promise<MotionDesktopArchiveInput | null> {
	signal?.throwIfAborted(); const selected = await files.selectOpen();
	if (!selected) return null;
	let released = false; let releasing: Promise<void> | null = null;
	const release = async () => {
		if (released) return;
		releasing ??= files.release({ token: selected.token });
		try { await releasing; released = true; } finally { releasing = null; }
	};
	if (signal?.aborted) { await release(); signal.throwIfAborted(); }
	return Object.freeze({ name: selected.name,
		input: createScapeArchiveByteSource({ size: selected.byteLength, maximumReadBytes: MOTIONSCAPER_FILE_CHUNK_BYTES,
			read: async ({ offset, length, signal: readSignal }) => {
				if (released || releasing) throw new Error('Motionscaper archive capability was released.');
				signal?.throwIfAborted(); readSignal?.throwIfAborted();
				const bytes = await files.read({ token: selected.token, offset, length });
				signal?.throwIfAborted(); readSignal?.throwIfAborted(); return bytes;
			},
		}),
		bind: async (projectId: string) => { if (released) throw new Error('Motionscaper archive capability was released.'); await files.bindOpened({ token: selected.token, projectId }); },
		release,
	});
}

/** File commit is explicit and must finish before publishing the revision to the project store. */
export async function beginMotionscaperDesktopSave(files: MotionDesktopFiles, options: {
	readonly projectId: string; readonly suggestedName: string; readonly saveAs?: boolean; readonly saveCopy?: boolean; readonly signal?: AbortSignal;
}): Promise<MotionDesktopArchiveOutput | null> {
	options.signal?.throwIfAborted();
	const selected = await files.beginSave({ projectId: options.projectId, suggestedName: options.suggestedName,
		saveAs: options.saveAs ?? false, ...(options.saveCopy === undefined ? {} : { saveCopy: options.saveCopy }) });
	if (!selected) return null;
	let offset = 0; let closed = false; let terminal = false; let aborting = false; let cancellation: Promise<void> | null = null;
	let pending: Promise<void> = Promise.resolve();
	const abort = async () => {
		if (terminal) return; aborting = true;
		cancellation ??= (async () => { await pending.catch(() => undefined); await files.cancel({ token: selected.token }); terminal = true; })();
		try { await cancellation; } finally { cancellation = null; }
	};
	if (options.signal?.aborted) { await abort(); options.signal.throwIfAborted(); }
	const writable = new WritableStream<Uint8Array>({
		write(chunk) {
			if (terminal || aborting) throw new Error('Motionscaper archive save is closed.');
			if (!(chunk instanceof Uint8Array)) throw new TypeError('Motionscaper archive output requires byte chunks.');
			const snapshot = new Uint8Array(chunk);
			pending = (async () => {
				for (let cursor = 0; cursor < snapshot.byteLength; cursor += MOTIONSCAPER_FILE_CHUNK_BYTES) {
					options.signal?.throwIfAborted();
					const bytes = snapshot.subarray(cursor, cursor + MOTIONSCAPER_FILE_CHUNK_BYTES);
					await files.write({ token: selected.token, offset, bytes }); offset += bytes.byteLength;
				}
			})();
			return pending;
		},
		close() { closed = true; }, abort,
	});
	return Object.freeze({ writable, abort,
		async commit() {
			if (!closed || terminal || aborting) throw new Error('Motionscaper archive must finish streaming before file commit.');
			options.signal?.throwIfAborted();
			const receipt = await files.commit({ token: selected.token, byteLength: offset });
			terminal = true; return receipt;
		},
	});
}
