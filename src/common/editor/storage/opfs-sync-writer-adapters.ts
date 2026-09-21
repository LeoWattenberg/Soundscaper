/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StorageRecord } from './media-records.ts';
import {
	createOpfsPcmWriterLifecycle,
	type OpfsPcmWriter,
} from './opfs-pcm-writer-lifecycle.ts';
import type { OpfsSyncWriter } from './opfs-sync-worker-client.ts';

export function syncBinaryWriter(
	path: string,
	writer: OpfsSyncWriter,
	remove: () => Promise<void>,
	defaultSignal?: AbortSignal,
): Readonly<{
	path: string;
	write(bytes: Uint8Array, options?: Readonly<{ signal?: AbortSignal }>): Promise<void>;
	close(options?: Readonly<{ signal?: AbortSignal }>): Promise<void>;
	abort(): Promise<void>;
}> {
	let removal: Promise<void> | null = null;
	return {
		path,
		write: (bytes, options = {}) => writer.write(bytes, options.signal ?? defaultSignal),
		close: (options = {}) => writer.close(options.signal ?? defaultSignal),
		abort: async () => {
			try { await writer.abort(); } finally { await (removal ??= remove()); }
		},
	};
}

export function syncPcmWriter(
	path: string,
	writer: OpfsSyncWriter,
	metadata: StorageRecord,
	invalidate: () => void,
	remove: () => Promise<void>,
): OpfsPcmWriter {
	const writable = {
		write: (input: unknown) => writer.write(binaryBytes(input)),
		close: () => writer.close(),
	};
	return createOpfsPcmWriterLifecycle({
		path,
		metadata,
		writable,
		closeEmpty: () => writer.close(),
		abortOpen: () => writer.abort(),
		invalidate,
		remove,
	});
}

function binaryBytes(value: unknown): Uint8Array {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	throw new TypeError('A binary OPFS container write is required.');
}
