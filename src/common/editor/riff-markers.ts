/* SPDX-License-Identifier: AGPL-3.0-only */

const MAX_MARKERS = 100_000;
const UINT32_MAX = 0xffff_ffff;

export interface RiffMarkerInput {
	readonly id?: number;
	readonly sampleOffset: number;
	readonly sampleLength?: number;
	readonly label?: string;
	readonly note?: string;
}

export interface RiffMarker {
	readonly id: number;
	readonly sampleOffset: number;
	readonly sampleLength: number;
	readonly label: string;
	readonly note: string;
}

export function normalizeRiffMarkers(input: readonly RiffMarkerInput[] = []): readonly RiffMarker[] {
	if (!Array.isArray(input)) throw new TypeError('RIFF markers must be an array.');
	if (input.length > MAX_MARKERS) throw new RangeError(`RIFF markers support at most ${MAX_MARKERS} entries.`);
	const used = new Set<number>();
	return Object.freeze(input.map((value, index) => {
		if (!value || typeof value !== 'object') throw new TypeError(`RIFF marker ${index} must be an object.`);
		let id = value.id == null ? index + 1 : uint32(value.id, `RIFF marker ${index} id`);
		if (id === 0) throw new RangeError('RIFF marker IDs must be non-zero.');
		while (used.has(id)) {
			id += 1;
			if (id > UINT32_MAX) id = 1;
		}
		used.add(id);
		return Object.freeze({
			id,
			sampleOffset: uint32(value.sampleOffset, `RIFF marker ${index} sampleOffset`),
			sampleLength: uint32(value.sampleLength ?? 0, `RIFF marker ${index} sampleLength`),
			label: text(value.label ?? '', `RIFF marker ${index} label`),
			note: text(value.note ?? '', `RIFF marker ${index} note`),
		});
	}));
}

export function createRiffMarkerChunks(input: readonly RiffMarkerInput[] = []): Uint8Array {
	const markers = normalizeRiffMarkers(input);
	if (!markers.length) return new Uint8Array(0);
	const cuePayload = new Uint8Array(4 + markers.length * 24);
	const cueView = new DataView(cuePayload.buffer);
	cueView.setUint32(0, markers.length, true);
	for (const [index, marker] of markers.entries()) {
		const offset = 4 + index * 24;
		cueView.setUint32(offset, marker.id, true);
		cueView.setUint32(offset + 4, marker.sampleOffset, true);
		writeAscii(cuePayload, offset + 8, 'data');
		cueView.setUint32(offset + 20, marker.sampleOffset, true);
	}
	const adtl = markers.flatMap((marker) => {
		const chunks = [];
		if (marker.label) chunks.push(textSubchunk('labl', marker.id, marker.label));
		if (marker.note) chunks.push(textSubchunk('note', marker.id, marker.note));
		if (marker.sampleLength > 0) chunks.push(regionSubchunk(marker));
		return chunks;
	});
	const parts = [riffChunk('cue ', cuePayload)];
	if (adtl.length) parts.push(riffList('adtl', adtl));
	return concat(...parts);
}

export function parseRiffMarkers(cuePayload: Uint8Array | null, adtlPayloads: readonly Uint8Array[] = []): readonly RiffMarker[] {
	if (!cuePayload) return Object.freeze([]);
	if (cuePayload.byteLength < 4) throw new Error('The WAV cue chunk is truncated.');
	const view = new DataView(cuePayload.buffer, cuePayload.byteOffset, cuePayload.byteLength);
	const count = view.getUint32(0, true);
	if (count > MAX_MARKERS || 4 + count * 24 !== cuePayload.byteLength) throw new Error('The WAV cue table is malformed.');
	const markers = new Map<number, RiffMarker>();
	for (let index = 0; index < count; index += 1) {
		const offset = 4 + index * 24;
		const id = view.getUint32(offset, true);
		if (!id || markers.has(id)) throw new Error('The WAV cue table contains duplicate or zero IDs.');
		markers.set(id, Object.freeze({
			id,
			sampleOffset: view.getUint32(offset + 20, true),
			sampleLength: 0,
			label: '',
			note: '',
		}));
	}
	for (const payload of adtlPayloads) parseAdtl(payload, markers);
	return Object.freeze([...markers.values()].sort((left, right) => left.sampleOffset - right.sampleOffset || left.id - right.id));
}

function parseAdtl(payload: Uint8Array, markers: Map<number, RiffMarker>): void {
	let offset = 0;
	while (offset < payload.byteLength) {
		if (payload.byteLength - offset < 8) throw new Error('The WAV adtl list ends inside a subchunk header.');
		const id = ascii(payload, offset, 4);
		const size = new DataView(payload.buffer, payload.byteOffset + offset + 4, 4).getUint32(0, true);
		const start = offset + 8;
		const end = start + size;
		if (end > payload.byteLength) throw new Error('The WAV adtl subchunk is truncated.');
		if ((id === 'labl' || id === 'note') && size >= 4) {
			const cueId = new DataView(payload.buffer, payload.byteOffset + start, 4).getUint32(0, true);
			const marker = markers.get(cueId);
			if (marker) markers.set(cueId, Object.freeze({ ...marker, [id === 'labl' ? 'label' : 'note']: decodeText(payload.subarray(start + 4, end)) }));
		} else if (id === 'ltxt' && size >= 20) {
			const item = new DataView(payload.buffer, payload.byteOffset + start, size);
			const cueId = item.getUint32(0, true);
			const marker = markers.get(cueId);
			if (marker) markers.set(cueId, Object.freeze({ ...marker, sampleLength: item.getUint32(4, true) }));
		}
		offset = end + (size & 1);
	}
}

function textSubchunk(kind: 'labl' | 'note', id: number, value: string): Uint8Array {
	const encoded = new TextEncoder().encode(`${value}\0`);
	const payload = new Uint8Array(4 + encoded.byteLength);
	new DataView(payload.buffer).setUint32(0, id, true);
	payload.set(encoded, 4);
	return riffChunk(kind, payload);
}

function regionSubchunk(marker: RiffMarker): Uint8Array {
	const payload = new Uint8Array(20);
	const view = new DataView(payload.buffer);
	view.setUint32(0, marker.id, true);
	view.setUint32(4, marker.sampleLength, true);
	return riffChunk('ltxt', payload);
}

function riffList(kind: string, chunks: readonly Uint8Array[]): Uint8Array {
	const body = concat(...chunks);
	const payload = new Uint8Array(4 + body.byteLength);
	writeAscii(payload, 0, kind);
	payload.set(body, 4);
	return riffChunk('LIST', payload);
}

function riffChunk(id: string, payload: Uint8Array): Uint8Array {
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

function text(value: string, name: string): string {
	if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`);
	if (value.includes('\0')) throw new RangeError(`${name} cannot contain NUL characters.`);
	return value;
}

function uint32(value: number, name: string): number {
	if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) throw new RangeError(`${name} must be an unsigned 32-bit integer.`);
	return value;
}

function decodeText(bytes: Uint8Array): string {
	const end = bytes.indexOf(0);
	return new TextDecoder('utf-8', { fatal: false }).decode(end < 0 ? bytes : bytes.subarray(0, end));
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
