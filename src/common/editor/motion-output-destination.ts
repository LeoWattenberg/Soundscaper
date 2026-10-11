/* SPDX-License-Identifier: AGPL-3.0-only */

import { motionInteger } from './motion-values.ts';
import { SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES } from './scape-export-estimate.ts';

const MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;
export interface MotionOutputDestination {
	readonly byteLength: number;
	write(bytes: Uint8Array): Promise<void>;
	finish(): Promise<Blob | null>;
	abort(reason: unknown): Promise<void>;
}
export interface MotionOutputDestinationOptions {
	readonly writable?: WritableStream<Uint8Array>; readonly mimeType: string;
	readonly maximumBlobBytes?: number; readonly maximumOutputBytes?: number;
}

/** Streaming retains one bounded chunk; the download fallback has a hard resident-byte admission. */
export function createMotionOutputDestination(options: MotionOutputDestinationOptions): MotionOutputDestination {
	const maximumBytes = motionInteger(options.writable ? options.maximumOutputBytes ?? Number.MAX_SAFE_INTEGER
		: Math.min(options.maximumBlobBytes ?? SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES, options.maximumOutputBytes ?? Number.MAX_SAFE_INTEGER), 'motion output maximum bytes', 1);
	const writer = options.writable?.getWriter();
	if (writer) void writer.closed.catch(() => undefined);
	const chunks: Uint8Array<ArrayBuffer>[] = [];
	let byteLength = 0;
	let state: 'open' | 'finished' | 'aborted' = 'open';
	return {
		get byteLength() { return byteLength; },
		async write(bytes) {
			if (state !== 'open') throw new Error('Motion output destination is closed.');
			if (!(bytes instanceof Uint8Array)) throw new TypeError('Motion output requires byte chunks.');
			if (bytes.byteLength > maximumBytes - byteLength) throw new RangeError(writer ? 'Motion output exceeds its admitted byte limit.' : 'Motion output exceeds Blob memory admission; choose a streaming destination.');
			for (let offset = 0; offset < bytes.byteLength; offset += MAXIMUM_CHUNK_BYTES) {
				const chunk = bytes.slice(offset, offset + MAXIMUM_CHUNK_BYTES);
				if (writer) await writer.write(chunk); else chunks.push(chunk);
				byteLength += chunk.byteLength;
			}
		},
		async finish() {
			if (state !== 'open') throw new Error('Motion output destination is closed.');
			if (writer) {
				await writer.close(); state = 'finished'; writer.releaseLock(); return null;
			}
			const blob = new Blob(chunks, { type: options.mimeType });
			chunks.length = 0; state = 'finished'; return blob;
		},
		async abort(reason) {
			if (state !== 'open') return;
			state = 'aborted'; chunks.length = 0;
			if (writer) { try { await writer.abort(reason); } finally { writer.releaseLock(); } }
		},
	};
}
