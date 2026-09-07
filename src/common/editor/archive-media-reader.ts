/* SPDX-License-Identifier: AGPL-3.0-only */

import { Reader } from '@zip.js/zip.js/index-native.js';
import type { BlobLike } from './storage/media-records.ts';

/** Read the storage owner's sliceable media without materializing a second full container. */
export function createArchiveMediaReader(source: BlobLike, signal?: AbortSignal): Reader<BlobLike> {
	return new ArchiveMediaReader(source, signal);
}

class ArchiveMediaReader extends Reader<BlobLike> {
	constructor(private readonly source: BlobLike, private readonly signal?: AbortSignal) {
		super(source);
		if (!Number.isSafeInteger(source.size) || source.size < 0) {
			throw new RangeError('Archive media requires a safe non-negative size.');
		}
		this.size = source.size;
	}

	override async readUint8Array(offset: number, length: number): Promise<Uint8Array> {
		this.signal?.throwIfAborted();
		if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
			|| offset < 0 || length < 0) {
			throw new RangeError('Archive media requested an invalid byte range.');
		}
		// zip.js probes past EOF when consuming a reader without a fixed stream size.
		if (offset >= this.size || length === 0) return new Uint8Array();
		const available = Math.min(length, this.size - offset);
		const bytes = new Uint8Array(await this.source.slice(offset, offset + available).arrayBuffer());
		this.signal?.throwIfAborted();
		if (bytes.byteLength !== available) throw new Error('Archive media returned an incomplete byte range.');
		return bytes;
	}
}
