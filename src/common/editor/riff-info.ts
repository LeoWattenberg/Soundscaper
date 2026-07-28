/* SPDX-License-Identifier: AGPL-3.0-only */

const FIELD_IDS = Object.freeze({
	title: 'INAM', artist: 'IART', comments: 'ICMT', comment: 'ICMT', copyright: 'ICOP',
	year: 'ICRD', date: 'ICRD', genre: 'IGNR', software: 'ISFT',
} as const);
const ID_FIELDS: Readonly<Record<string, string>> = Object.freeze({ INAM: 'title', IART: 'artist', ICMT: 'comments', ICOP: 'copyright', ICRD: 'year', IGNR: 'genre', ISFT: 'software' });

export function createRiffInfoChunk(metadata: Readonly<Record<string, unknown>> = {}): Uint8Array {
	const chunks: Uint8Array[] = [];
	const emitted = new Set<string>();
	for (const [rawKey, rawValue] of Object.entries(metadata || {})) {
		const id = FIELD_IDS[rawKey.toLowerCase() as keyof typeof FIELD_IDS];
		if (!id || emitted.has(id) || rawValue == null || String(rawValue) === '') continue;
		emitted.add(id);
		const encoded = new TextEncoder().encode(`${String(rawValue)}\0`);
		chunks.push(chunk(id, encoded));
	}
	if (!chunks.length) return new Uint8Array(0);
	const body = concat(...chunks);
	const payload = new Uint8Array(4 + body.byteLength);
	writeAscii(payload, 0, 'INFO');
	payload.set(body, 4);
	return chunk('LIST', payload);
}

export function parseRiffInfo(payloads: readonly Uint8Array[] = []): Readonly<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const payload of payloads) {
		let offset = 0;
		while (offset < payload.byteLength) {
			if (payload.byteLength - offset < 8) throw new Error('The WAV INFO list ends inside a subchunk header.');
			const id = ascii(payload, offset, 4);
			const size = new DataView(payload.buffer, payload.byteOffset + offset + 4, 4).getUint32(0, true);
			const start = offset + 8;
			const end = start + size;
			if (end > payload.byteLength) throw new Error('The WAV INFO subchunk is truncated.');
			const field = ID_FIELDS[id] as string | null | undefined;
			if (field && result[field] == null) result[field] = decode(payload.subarray(start, end));
			offset = end + (size & 1);
		}
	}
	return Object.freeze(result);
}

function chunk(id: string, payload: Uint8Array): Uint8Array {
	const result = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	writeAscii(result, 0, id);
	new DataView(result.buffer).setUint32(4, payload.byteLength, true);
	result.set(payload, 8);
	return result;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
	return result;
}

function decode(bytes: Uint8Array): string {
	const end = bytes.indexOf(0);
	return new TextDecoder('utf-8').decode(end < 0 ? bytes : bytes.subarray(0, end));
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
