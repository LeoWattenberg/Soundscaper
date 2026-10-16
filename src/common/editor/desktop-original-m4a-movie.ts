/* SPDX-License-Identifier: AGPL-3.0-only */

interface ByteSource {
	readonly size: number;
	slice(start: number, end: number): Readonly<{ arrayBuffer(): PromiseLike<ArrayBuffer> }>;
}

/** Skip encoded media boxes and read only the bounded movie metadata, wherever it was muxed. */
export async function readDesktopOriginalM4aMovie(file: ByteSource, maximumBytes: number): Promise<Uint8Array | null> {
	let offset = 0;
	for (let boxCount = 0; offset < file.size && boxCount < 1024; boxCount += 1) {
		const bytes = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + 16)).arrayBuffer());
		if (bytes.length < 8) return null;
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const declaredSize = view.getUint32(0, false);
		const headerSize = declaredSize === 1 ? 16 : 8;
		if (bytes.length < headerSize) return null;
		const size = declaredSize === 1 ? Number(view.getBigUint64(8, false)) : declaredSize || file.size - offset;
		if (!Number.isSafeInteger(size) || size < headerSize || size > file.size - offset) return null;
		const type = String.fromCharCode(...bytes.subarray(4, 8));
		if (boxCount === 0 && type !== 'ftyp') return null;
		if (type === 'moov') {
			return size <= maximumBytes ? new Uint8Array(await file.slice(offset, offset + size).arrayBuffer()) : null;
		}
		offset += size;
	}
	return null;
}
