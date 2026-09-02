/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeRiffMarkers, type RiffMarker, type RiffMarkerInput } from './riff-markers.ts';

/**
 * The AIFF `MARK` chunk, spoken in the product's one marker vocabulary.
 *
 * AIFF markers are points with a Pascal-string name: there is no region length
 * and no note field. Writing flattens a region to its start point and drops the
 * note — the delivery report discloses that — and reading produces the same
 * RiffMarker shape every other import path yields, so nothing downstream needs
 * to know which container the markers came from.
 */

/** MarkerIds are positive signed 16-bit values, so this is the format's own ceiling. */
export const AIFF_MARK_MAXIMUM_MARKERS = 32_767;

const MAXIMUM_NAME_BYTES = 255;

/** Encode the complete `MARK` chunk (header included) for these markers, or no bytes for none. */
export function createAiffMarkChunk(input: readonly RiffMarkerInput[] = []): Uint8Array {
	const markers = normalizeRiffMarkers(input);
	if (!markers.length) return new Uint8Array(0);
	if (markers.length > AIFF_MARK_MAXIMUM_MARKERS) {
		throw new RangeError(`AIFF MARK chunks support at most ${AIFF_MARK_MAXIMUM_MARKERS} markers.`);
	}
	const names = markers.map((marker) => pascalString(marker.label));
	const payloadBytes = 2 + names.reduce((total, name) => total + 6 + name.byteLength, 0);
	const chunk = new Uint8Array(8 + payloadBytes);
	const view = new DataView(chunk.buffer);
	writeAscii(chunk, 0, 'MARK');
	view.setUint32(4, payloadBytes, false);
	view.setUint16(8, markers.length, false);
	let offset = 10;
	for (const [index, marker] of markers.entries()) {
		view.setInt16(offset, index + 1, false);
		view.setUint32(offset + 2, marker.sampleOffset, false);
		chunk.set(names[index]!, offset + 6);
		offset += 6 + names[index]!.byteLength;
	}
	return chunk;
}

/** Decode a `MARK` chunk payload (header excluded) into offset-ordered point markers. */
export function parseAiffMarkChunk(payload: Uint8Array): readonly RiffMarker[] {
	if (payload.byteLength < 2) throw new Error('The AIFF MARK chunk is truncated.');
	const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
	const count = view.getUint16(0, false);
	const markers = new Map<number, RiffMarker>();
	let offset = 2;
	for (let index = 0; index < count; index += 1) {
		if (payload.byteLength - offset < 7) throw new Error('The AIFF MARK chunk ends inside a marker.');
		const id = view.getInt16(offset, false);
		const position = view.getUint32(offset + 2, false);
		const nameBytes = payload[offset + 6]!;
		const nameEnd = offset + 7 + nameBytes;
		if (nameEnd > payload.byteLength) throw new Error('An AIFF marker name is truncated.');
		if (id <= 0 || markers.has(id)) throw new Error('The AIFF MARK chunk contains duplicate or invalid marker IDs.');
		markers.set(id, Object.freeze({
			id,
			sampleOffset: position,
			sampleLength: 0,
			label: new TextDecoder('utf-8', { fatal: false }).decode(payload.subarray(offset + 7, nameEnd)),
			note: '',
		}));
		// The Pascal string pads to an even total, count byte included.
		offset = nameEnd + ((1 + nameBytes) % 2);
	}
	return Object.freeze([...markers.values()].sort(
		(left, right) => left.sampleOffset - right.sampleOffset || left.id - right.id,
	));
}

function pascalString(value: string): Uint8Array {
	let encoded = new TextEncoder().encode(value);
	if (encoded.byteLength > MAXIMUM_NAME_BYTES) {
		let end = MAXIMUM_NAME_BYTES;
		while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end -= 1;
		encoded = encoded.subarray(0, end);
	}
	const output = new Uint8Array(1 + encoded.byteLength + ((1 + encoded.byteLength) % 2));
	output[0] = encoded.byteLength;
	output.set(encoded, 1);
	return output;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}
