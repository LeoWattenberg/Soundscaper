/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ZipWriter } from '@zip.js/zip.js/index-native.js';
import type { ScapeArchiveEntry } from './scape-archive-envelope.ts';

/** Both sides of a bounded ZIP copy settle before failure releases archive custody. */
export async function copyScapeArchiveEntry(writer: ZipWriter<unknown>, entry: ScapeArchiveEntry, signal?: AbortSignal): Promise<void> {
	if (!entry.getData) throw new TypeError('Scape archive entry is unreadable.');
	const abort = new AbortController(); const sharedSignal = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
	const stream = new TransformStream<Uint8Array, Uint8Array>();
	const operations = [entry.getData(stream.writable, { signal: sharedSignal, strictness: 'strict' }), writer.add(entry.filename, stream.readable, { signal: sharedSignal })];
	try { await Promise.all(operations); }
	catch (error) { abort.abort(error); await Promise.allSettled(operations); throw error; }
}
