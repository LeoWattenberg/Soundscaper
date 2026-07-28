/* SPDX-License-Identifier: AGPL-3.0-only */

export const CHNA_ENTRY_BYTES = 40;
export const CHNA_HEADER_BYTES = 4;
export const CHNA_MAX_ENTRIES = 0xffff;
export const CHNA_MAX_PAYLOAD_BYTES = CHNA_HEADER_BYTES + (CHNA_ENTRY_BYTES * CHNA_MAX_ENTRIES);

export type AdmBedLayout = 'mono' | 'stereo' | '5.1';

export interface AdmBedDefinition {
	readonly packRef: string;
	readonly channelRefs: readonly string[];
}

export const ADM_BED_DEFINITIONS: Readonly<Record<AdmBedLayout, AdmBedDefinition>> = Object.freeze({
	mono: Object.freeze({ packRef: 'AP_00010001', channelRefs: Object.freeze(['AC_00010003']) }),
	stereo: Object.freeze({ packRef: 'AP_00010002', channelRefs: Object.freeze(['AC_00010001', 'AC_00010002']) }),
	'5.1': Object.freeze({
		packRef: 'AP_00010003',
		channelRefs: Object.freeze([
			'AC_00010001', 'AC_00010002', 'AC_00010003',
			'AC_00010004', 'AC_00010005', 'AC_00010006',
		]),
	}),
});

export interface ChnaEntry {
	readonly trackIndex: number;
	readonly uid: string;
	readonly trackRef: string;
	readonly packRef: string;
}

export interface ChnaMetadata {
	readonly numTracks: number;
	readonly entries: readonly ChnaEntry[];
}

export interface ChnaMetadataInput {
	readonly numTracks: number;
	readonly entries: readonly ChnaEntry[];
}

export function createAdmChna(input: { readonly layout?: AdmBedLayout } = {}): ChnaMetadata {
	const definition = ADM_BED_DEFINITIONS[input.layout ?? 'stereo'];
	if (!definition) throw new RangeError('ADM bed layout must be mono, stereo, or 5.1.');
	return normalizeChnaMetadata({
		numTracks: definition.channelRefs.length,
		entries: definition.channelRefs.map((trackRef, index) => ({
			trackIndex: index + 1,
			uid: `ATU_${String(index + 1).padStart(8, '0')}`,
			trackRef,
			packRef: definition.packRef,
		})),
	});
}

export function normalizeChnaMetadata(input: ChnaMetadataInput): ChnaMetadata {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new TypeError('CHNA metadata must be an object.');
	}
	const numTracks = uint16(input.numTracks, 'CHNA numTracks', true);
	if (!Array.isArray(input.entries)) throw new TypeError('CHNA entries must be an array.');
	if (input.entries.length > CHNA_MAX_ENTRIES) throw new RangeError('CHNA cannot contain more than 65,535 UIDs.');
	const seenUids = new Set<string>();
	const seenTracks = new Set<number>();
	const entries = input.entries.map((candidate, index) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError(`CHNA entry ${index + 1} must be an object.`);
		}
		const trackIndex = uint16(candidate.trackIndex, 'CHNA track index', true);
		if (trackIndex > numTracks) throw new RangeError(`CHNA track index ${trackIndex} exceeds numTracks ${numTracks}.`);
		const uid = identifier(candidate.uid, /^ATU_[0-9A-Fa-f]{8}$/u, 'CHNA UID');
		if (/^ATU_0{8}$/iu.test(uid)) throw new RangeError('CHNA UID cannot use the reserved zero identifier.');
		const uidKey = uid.toUpperCase();
		if (seenUids.has(uidKey)) throw new RangeError(`CHNA contains duplicate CHNA UID ${uid}.`);
		seenUids.add(uidKey);
		seenTracks.add(trackIndex);
		return Object.freeze({
			trackIndex,
			uid,
			trackRef: identifier(candidate.trackRef, /^(?:AT_[0-9A-Fa-f]{8}_[0-9A-Fa-f]{2}|AC_[0-9A-Fa-f]{8})$/u, 'CHNA track reference'),
			packRef: candidate.packRef === ''
				? ''
				: identifier(candidate.packRef, /^AP_[0-9A-Fa-f]{8}$/u, 'CHNA pack reference'),
		});
	});
	if (entries.length === 0) throw new RangeError('CHNA must contain at least one UID.');
	if (seenTracks.size !== numTracks) throw new RangeError('CHNA entries must account for every track from 1 through numTracks.');
	return Object.freeze({ numTracks, entries: Object.freeze(entries) });
}

export function encodeChnaPayload(input: ChnaMetadataInput): Uint8Array {
	const metadata = normalizeChnaMetadata(input);
	const output = new Uint8Array(CHNA_HEADER_BYTES + (metadata.entries.length * CHNA_ENTRY_BYTES));
	const view = new DataView(output.buffer);
	view.setUint16(0, metadata.numTracks, true);
	view.setUint16(2, metadata.entries.length, true);
	metadata.entries.forEach((entry, index) => {
		const offset = CHNA_HEADER_BYTES + (index * CHNA_ENTRY_BYTES);
		view.setUint16(offset, entry.trackIndex, true);
		writeFixed(output, offset + 2, 12, entry.uid, 'CHNA UID');
		writeFixed(output, offset + 14, 14, encodedTrackRef(entry.trackRef), 'CHNA track reference');
		writeFixed(output, offset + 28, 11, entry.packRef, 'CHNA pack reference');
	});
	return output;
}

export function parseChnaPayload(input: Uint8Array | ArrayBuffer | ArrayBufferView): ChnaMetadata {
	const bytes = byteView(input, 'CHNA payload');
	if (bytes.byteLength > CHNA_MAX_PAYLOAD_BYTES) throw new RangeError('The CHNA payload exceeds its 65,535-entry safety limit.');
	if (bytes.byteLength < CHNA_HEADER_BYTES || ((bytes.byteLength - CHNA_HEADER_BYTES) % CHNA_ENTRY_BYTES) !== 0) {
		throw new Error('The CHNA payload must have a four-byte header followed by 40-byte entries.');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const numTracks = view.getUint16(0, true);
	const numUids = view.getUint16(2, true);
	const allocatedEntries = (bytes.byteLength - CHNA_HEADER_BYTES) / CHNA_ENTRY_BYTES;
	if (numUids > allocatedEntries) throw new Error('CHNA numUIDs exceeds the available AudioID allocation.');
	const entries: ChnaEntry[] = [];
	for (let index = 0; index < allocatedEntries; index += 1) {
		const offset = CHNA_HEADER_BYTES + (index * CHNA_ENTRY_BYTES);
		const record = bytes.subarray(offset, offset + CHNA_ENTRY_BYTES);
		if (index >= numUids) {
			if (record.some((byte) => byte !== 0)) throw new Error('An unused CHNA allocation entry contains non-zero data.');
			continue;
		}
		if (record[CHNA_ENTRY_BYTES - 1] !== 0) throw new Error(`CHNA AudioID ${index + 1} has a non-zero pad byte.`);
		entries.push({
			trackIndex: view.getUint16(offset, true),
			uid: readFixed(bytes, offset + 2, 12, 'CHNA UID'),
			trackRef: readTrackRef(bytes, offset + 14),
			packRef: readFixed(bytes, offset + 28, 11, 'CHNA pack reference'),
		});
	}
	return normalizeChnaMetadata({ numTracks, entries });
}

export function createRiffChnaChunk(input: ChnaMetadataInput): Uint8Array {
	const payload = encodeChnaPayload(input);
	const chunk = new Uint8Array(8 + payload.byteLength);
	chunk.set(new TextEncoder().encode('chna'), 0);
	new DataView(chunk.buffer).setUint32(4, payload.byteLength, true);
	chunk.set(payload, 8);
	return chunk;
}

export function parseRiffChnaChunk(input: Uint8Array | ArrayBuffer | ArrayBufferView): ChnaMetadata {
	const bytes = byteView(input, 'RIFF CHNA chunk');
	if (bytes.byteLength < 8) throw new Error('The RIFF CHNA chunk is truncated.');
	if (new TextDecoder('ascii').decode(bytes.subarray(0, 4)) !== 'chna') {
		throw new Error('The RIFF chunk does not have the chna identifier.');
	}
	const payloadBytes = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
	const expectedBytes = 8 + payloadBytes + (payloadBytes & 1);
	if (bytes.byteLength < expectedBytes) throw new Error('The RIFF CHNA chunk is truncated.');
	if (bytes.byteLength > expectedBytes) throw new Error('The RIFF CHNA chunk contains trailing bytes.');
	if ((payloadBytes & 1) !== 0 && bytes[bytes.byteLength - 1] !== 0) {
		throw new Error('The RIFF CHNA chunk has a non-zero alignment byte.');
	}
	return parseChnaPayload(bytes.subarray(8, 8 + payloadBytes));
}

function identifier(value: unknown, pattern: RegExp, field: string): string {
	if (typeof value !== 'string' || !pattern.test(value)) throw new RangeError(`${field} is invalid.`);
	return value;
}

function uint16(value: unknown, field: string, positive = false): number {
	if (!Number.isSafeInteger(value) || Number(value) < (positive ? 1 : 0) || Number(value) > 0xffff) {
		throw new RangeError(`${field} must be ${positive ? 'a positive' : 'an'} unsigned 16-bit integer.`);
	}
	return Number(value);
}

function writeFixed(output: Uint8Array, offset: number, width: number, value: string, field: string): void {
	const encoded = new TextEncoder().encode(value);
	if (encoded.byteLength > width || encoded.some((byte) => byte < 0x20 || byte > 0x7e)) {
		throw new RangeError(`${field} does not fit its ASCII field.`);
	}
	output.set(encoded, offset);
}

function readFixed(input: Uint8Array, offset: number, width: number, field: string): string {
	const fieldBytes = input.subarray(offset, offset + width);
	const terminator = fieldBytes.indexOf(0);
	const textBytes = terminator < 0 ? fieldBytes : fieldBytes.subarray(0, terminator);
	if (terminator >= 0 && fieldBytes.subarray(terminator).some((byte) => byte !== 0)) {
		throw new Error(`${field} has non-zero bytes after its NUL padding.`);
	}
	if (textBytes.some((byte) => byte < 0x20 || byte > 0x7e)) throw new Error(`${field} contains non-ASCII bytes.`);
	return new TextDecoder('ascii').decode(textBytes);
}

function encodedTrackRef(value: string): string {
	return value.startsWith('AC_') ? `${value}_00` : value;
}

function readTrackRef(input: Uint8Array, offset: number): string {
	const encoded = readFixed(input, offset, 14, 'CHNA track reference');
	if (/^AT_[0-9A-Fa-f]{8}_[0-9A-Fa-f]{2}$/u.test(encoded)) return encoded;
	if (/^AC_[0-9A-Fa-f]{8}_00$/u.test(encoded)) return encoded.slice(0, -3);
	throw new Error('A CHNA audioChannelFormat track reference must end in the required _00 field padding.');
}

function byteView(input: Uint8Array | ArrayBuffer | ArrayBufferView, field: string): Uint8Array {
	if (input instanceof Uint8Array) return input;
	if (input instanceof ArrayBuffer) return new Uint8Array(input);
	if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	throw new TypeError(`${field} must be bytes.`);
}
