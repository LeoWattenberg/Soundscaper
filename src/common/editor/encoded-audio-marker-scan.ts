/* SPDX-License-Identifier: AGPL-3.0-only */

import { parseAiffMarkChunk } from './aiff-markers.ts';
import { parseRiffMarkers, type RiffMarker } from './riff-markers.ts';

/**
 * Rescue markers from an encoded audio file the maintained PCM readers refused.
 *
 * A non-PCM WAV (ADPCM, MP3-in-RIFF, …) falls through to the codec decode
 * path, which reads samples and nothing else — its cue chunk used to vanish
 * without a trace. This scan walks only the container's chunk headers, so it
 * can read the cues out of a file whose audio payload it cannot decode. It is
 * deliberately tolerant: any structural surprise returns null rather than
 * failing an import whose audio is still perfectly decodable.
 */

const MAXIMUM_MARKER_PAYLOAD_BYTES = 16 * 1024 * 1024;
const MAXIMUM_SCANNED_CHUNKS = 4_096;

export interface EncodedAudioMarkerScanSource {
	readonly size: number;
	slice(start: number, end: number): Readonly<{ arrayBuffer(): Promise<ArrayBuffer> }>;
}

export interface EncodedAudioMarkerScan {
	readonly markers: readonly RiffMarker[];
	/** The container's declared sample rate — the rate the cue offsets count in. */
	readonly sampleRate: number | null;
}

export async function scanEncodedAudioMarkers(
	source: unknown,
): Promise<EncodedAudioMarkerScan | null> {
	if (!isScanSource(source)) return null;
	try {
		if (source.size < 12) return null;
		const signature = await readBytes(source, 0, 12);
		const container = ascii(signature, 0, 4);
		if (container === 'RIFF' && ascii(signature, 8, 4) === 'WAVE') {
			return await scanRiffMarkers(source);
		}
		const formType = ascii(signature, 8, 4);
		if (container === 'FORM' && (formType === 'AIFF' || formType === 'AIFC')) {
			return await scanAiffMarkers(source);
		}
		return null;
	} catch {
		return null;
	}
}

async function scanRiffMarkers(source: EncodedAudioMarkerScanSource): Promise<EncodedAudioMarkerScan | null> {
	let cue: Uint8Array | null = null;
	const adtl: Uint8Array[] = [];
	let sampleRate: number | null = null;
	let offset = 12;
	let chunksRead = 0;
	while (offset + 8 <= source.size && chunksRead < MAXIMUM_SCANNED_CHUNKS) {
		chunksRead += 1;
		const header = await readBytes(source, offset, offset + 8);
		const id = ascii(header, 0, 4);
		const size = new DataView(header.buffer, header.byteOffset + 4, 4).getUint32(0, true);
		const payloadStart = offset + 8;
		const payloadEnd = payloadStart + size;
		// A truncated final chunk is a sloppy writer, not a reason to drop the
		// cues that were already collected from well-formed chunks before it.
		if (!Number.isSafeInteger(payloadEnd) || payloadEnd > source.size) break;
		if (id === 'fmt ' && size >= 16) {
			const fmt = await readBytes(source, payloadStart, payloadStart + 16);
			const declared = new DataView(fmt.buffer, fmt.byteOffset + 4, 4).getUint32(0, true);
			if (Number.isSafeInteger(declared) && declared > 0) sampleRate = declared;
		} else if (id === 'cue ' && !cue && size <= MAXIMUM_MARKER_PAYLOAD_BYTES) {
			cue = await readBytes(source, payloadStart, payloadEnd);
		} else if (id === 'LIST' && size >= 4 && size <= MAXIMUM_MARKER_PAYLOAD_BYTES) {
			const listType = ascii(await readBytes(source, payloadStart, payloadStart + 4), 0, 4);
			if (listType === 'adtl') adtl.push(await readBytes(source, payloadStart + 4, payloadEnd));
		}
		offset = payloadEnd + (size & 1);
	}
	if (!cue) return null;
	const markers = parseRiffMarkers(cue, adtl);
	if (!markers.length) return null;
	return Object.freeze({ markers, sampleRate });
}

async function scanAiffMarkers(source: EncodedAudioMarkerScanSource): Promise<EncodedAudioMarkerScan | null> {
	let mark: Uint8Array | null = null;
	let sampleRate: number | null = null;
	let offset = 12;
	let chunksRead = 0;
	while (offset + 8 <= source.size && chunksRead < MAXIMUM_SCANNED_CHUNKS) {
		chunksRead += 1;
		const header = await readBytes(source, offset, offset + 8);
		const id = ascii(header, 0, 4);
		const size = new DataView(header.buffer, header.byteOffset + 4, 4).getUint32(0, false);
		const payloadStart = offset + 8;
		const payloadEnd = payloadStart + size;
		if (!Number.isSafeInteger(payloadEnd) || payloadEnd > source.size) break;
		if (id === 'COMM' && size >= 18) {
			const comm = await readBytes(source, payloadStart, payloadStart + 18);
			sampleRate = extended80SampleRate(new DataView(comm.buffer, comm.byteOffset, comm.byteLength), 8);
		} else if (id === 'MARK' && !mark && size <= MAXIMUM_MARKER_PAYLOAD_BYTES) {
			mark = await readBytes(source, payloadStart, payloadEnd);
		}
		offset = payloadEnd + (size & 1);
	}
	if (!mark) return null;
	const markers = parseAiffMarkChunk(mark);
	if (!markers.length) return null;
	return Object.freeze({ markers, sampleRate });
}

/** The COMM sample rate is an 80-bit extended float; anything irregular scans as unknown. */
function extended80SampleRate(view: DataView, offset: number): number | null {
	const signAndExponent = view.getUint16(offset, false);
	if ((signAndExponent & 0x8000) !== 0) return null;
	const exponent = signAndExponent & 0x7fff;
	const high = view.getUint32(offset + 2, false);
	const low = view.getUint32(offset + 6, false);
	if (exponent === 0 || exponent === 0x7fff || (high & 0x8000_0000) === 0) return null;
	const value = (high * 0x1_0000_0000 + low) * 2 ** (exponent - 16_383 - 63);
	return Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function readBytes(
	source: EncodedAudioMarkerScanSource,
	start: number,
	end: number,
): Promise<Uint8Array> {
	const buffer = await source.slice(start, end).arrayBuffer();
	if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== end - start) {
		throw new Error('The marker scan read an unexpected number of bytes.');
	}
	return new Uint8Array(buffer);
}

function isScanSource(value: unknown): value is EncodedAudioMarkerScanSource {
	if (!value || typeof value !== 'object') return false;
	const source = value as Readonly<{ size?: unknown; slice?: unknown }>;
	return Number.isSafeInteger(source.size) && Number(source.size) >= 0
		&& typeof source.slice === 'function';
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
