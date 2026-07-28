/* SPDX-License-Identifier: AGPL-3.0-only */

export async function readBlobBytes(
	blob: Blob,
	start: number,
	end: number,
	signal?: AbortSignal,
): Promise<Uint8Array> {
	throwIfAborted(signal);
	const part = blob.slice(start, end);
	if (!part || typeof part.arrayBuffer !== 'function') throw new TypeError('Blob slices must provide arrayBuffer().');
	const buffer = await part.arrayBuffer();
	throwIfAborted(signal);
	if (!(buffer instanceof ArrayBuffer)) throw new TypeError('Blob arrayBuffer() must return an ArrayBuffer.');
	const expectedBytes = end - start;
	if (buffer.byteLength !== expectedBytes) throw new Error('A WAV Blob slice returned an unexpected number of bytes.');
	return new Uint8Array(buffer);
}

export function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason instanceof Error && signal.reason.name === 'AbortError') throw signal.reason;
	const message = typeof signal.reason === 'string'
		? signal.reason
		: signal.reason instanceof Error ? signal.reason.message : 'Incremental WAV decoding was aborted.';
	if (typeof DOMException === 'function') throw new DOMException(message, 'AbortError');
	const error = new Error(message);
	error.name = 'AbortError';
	throw error;
}

export function dataView(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function ascii(bytes: Uint8Array, offset: number, length: number): string {
	let value = '';
	for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index]);
	return value;
}

export function printableChunkId(value: string): string {
	return JSON.stringify(value.replace(/[^\x20-\x7e]/gu, '?'));
}
