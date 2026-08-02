/* SPDX-License-Identifier: AGPL-3.0-only */

import type { WavBlobPcmSource } from '../wav-pcm-chunk-reader.ts';
import type { LinkedOriginalRangeByteSource } from './linked-original-range-byte-source.ts';

export interface LinkedOriginalRangeBlobSource extends WavBlobPcmSource {
	readonly type: string;
}

/** Present an admitted range source to the maintained WAV inspector without a whole-file Blob. */
export function createLinkedOriginalRangeBlobSource(
	source: LinkedOriginalRangeByteSource,
	signal?: AbortSignal,
): LinkedOriginalRangeBlobSource {
	if (!source || typeof source !== 'object' || typeof source.slice !== 'function') {
		throw new TypeError('A linked original range byte source is required.');
	}
	return Object.freeze({
		size: source.size,
		type: source.type,
		slice(start: number, end: number) {
			return Object.freeze({
				async arrayBuffer(): Promise<ArrayBuffer> {
					const bytes = await source.slice(start, end, signal ? { signal } : {});
					if (bytes.buffer instanceof ArrayBuffer) {
						if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
							return bytes.buffer;
						}
						return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
					}
					return Uint8Array.from(bytes).buffer;
				},
			});
		},
	});
}
