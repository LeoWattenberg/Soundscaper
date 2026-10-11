/* SPDX-License-Identifier: AGPL-3.0-only */
import type { NativeProjectFileService } from '../common/editor/controller/document/native-project-types.ts';
import { createBlobScapeArchiveByteSource, assertScapeArchiveByteSource, readScapeArchiveByteRange } from '../common/editor/scape-archive-byte-source.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { createScapeDigest, scapeHex } from '../common/editor/scape-archive-media.ts';
import type { TemporaryFileSink } from '../common/editor/controller/export/temporary-export.ts';
import { OBJECT_URL_REVOKE_DELAY_MS } from '../common/editor/object-url-revoke.ts';
import { motionDigest } from '../common/editor/motion-values.ts';

const DOWNLOAD_BYTES = 16 * 1024 * 1024;
const MIME_TYPE = 'application/vnd.framescaper.scape+zip';
type Sink = Pick<TemporaryFileSink, 'persistent' | 'write' | 'close' | 'remove' | 'abort'>;
interface SaveOptions { readonly createSink?: () => Promise<Sink>; readonly awaitDownload?: (milliseconds: number) => Promise<void> }
export interface FramescaperOriginalDownloadCleanup { cleanup(): Promise<void> }
type Files = Pick<NativeProjectFileService, 'prepareSave' | 'saveFile'>;

/** Small downloads have a fixed memory bound; larger originals require a streaming file destination. */
export async function saveFramescaperRetainedOriginal(input: ScapeProjectInput, expectedDigest: string, fileName: string, files: Files, signal: AbortSignal, options: SaveOptions = {}): Promise<FramescaperOriginalDownloadCleanup | undefined> {
	signal.throwIfAborted(); motionDigest(expectedDigest);
	const source = input instanceof Blob ? createBlobScapeArchiveByteSource(input) : input; assertScapeArchiveByteSource(source);
	const prepared = await files.prepareSave({ purpose: 'project', suggestedName: fileName, mimeType: MIME_TYPE,
		types: [{ description: 'Framescaper project', accept: { [MIME_TYPE]: ['.fscape'] } }], useFileSystemAccess: source.size > DOWNLOAD_BYTES, signal });
	if (prepared.mode === 'cancelled') return;
	async function copy(write: (bytes: Uint8Array) => Promise<void>): Promise<void> {
		const digest = createScapeDigest();
		for (let offset = 0; offset < source.size; offset += 1024 * 1024) {
			signal.throwIfAborted(); const bytes = await readScapeArchiveByteRange(source, { offset, length: Math.min(1024 * 1024, source.size - offset), signal });
			digest.update(bytes); await write(bytes);
		}
		signal.throwIfAborted(); if (scapeHex(digest.digest()) !== expectedDigest) throw new RangeError('Retained original archive digest changed; the copy was not published.');
	}
	if (prepared.mode === 'blob' && source.size > DOWNLOAD_BYTES) {
		const createSink = options.createSink ?? (async () => {
			const { createTemporaryFileSink } = await import('../common/editor/storage/temporary-export-sink.ts');
			return createTemporaryFileSink('framescaper-original.fscape', { temporaryExportClosed: 'The temporary archive is closed.', largeStemsStorageRequired: 'Large archives require file storage.', stemArchiveClosed: 'The archive is closed.' });
		});
		const sink = await createSink(); let download: boolean;
		try {
			if (!sink.persistent) throw new RangeError('This original archive requires streaming file saves or available temporary file storage. Free browser storage or use a browser supporting the file save picker.');
			await copy(bytes => sink.write(bytes)); const blob = await sink.close(MIME_TYPE); signal.throwIfAborted();
			if (blob.size !== source.size) throw new RangeError('Temporary original archive byte count changed.');
			const saved = await files.saveFile({ purpose: 'project', blob, suggestedName: fileName, mimeType: MIME_TYPE, target: prepared.target, useFileSystemAccess: false, signal });
			download = saved.method === 'download';
		} catch (error) {
			const failures: unknown[] = []; try { await sink.abort(); } catch (cleanup) { failures.push(cleanup); }
			if (failures.length) throw new AggregateError([error, ...failures], 'Original download and temporary cleanup failed.', { cause: error }); throw error;
		}
		if (download) {
			// The caller owns cleanup independently of its completed Save action. A late Cancel cannot shorten download custody.
			let pending: Promise<void> | undefined;
			return Object.freeze({ cleanup() { return pending ??= (async () => {
				await (options.awaitDownload ?? (milliseconds => new Promise<void>(resolve => setTimeout(resolve, milliseconds))))(OBJECT_URL_REVOKE_DELAY_MS);
				await sink.remove();
			})(); } });
		}
		await sink.remove(); return;
	}
	if (prepared.mode === 'blob') {
		const parts: Uint8Array<ArrayBuffer>[] = []; await copy(async bytes => { parts.push(bytes.slice()); });
		await files.saveFile({ purpose: 'project', blob: new Blob(parts, { type: MIME_TYPE }), suggestedName: fileName, mimeType: MIME_TYPE, target: prepared.target, useFileSystemAccess: false, signal }); return;
	}
	try {
		const writer = (await prepared.createWritable(source.size)).getWriter();
		try { await copy(bytes => writer.write(bytes)); await writer.close(); } finally { writer.releaseLock(); }
		if (prepared.bytesWritten() !== source.size) throw new RangeError('Retained original copy byte count changed.');
		signal.throwIfAborted(); await prepared.commit();
	} catch (error) {
		const failures: unknown[] = []; try { await prepared.abort(error); } catch (cleanup) { failures.push(cleanup); }
		if (failures.length) throw new AggregateError([error, ...failures], 'Original archive copy and destination cleanup failed.', { cause: error }); throw error;
	}
}
