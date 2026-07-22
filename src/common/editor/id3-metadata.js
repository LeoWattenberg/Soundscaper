import { normalizeMediaMetadata } from './media-export.js';

const TEXT_FRAME_IDS = Object.freeze({
	title: 'TIT2',
	artist: 'TPE1',
	album: 'TALB',
	track: 'TRCK',
	tracknumber: 'TRCK',
	year: 'TDRC',
	date: 'TDRC',
	genre: 'TCON',
	copyright: 'TCOP',
});

/**
 * Creates a compact ID3v2.4 tag for native WAV/AIFF exports. UTF-8 text and
 * TXXX frames retain custom editor metadata without depending on FFmpeg.
 */
export function createAudioMetadataId3Tag(metadata = {}) {
	const normalized = normalizeMediaMetadata(metadata);
	const frames = [];
	for (const [key, value] of Object.entries(normalized)) {
		const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
		if (normalizedKey === 'comment' || normalizedKey === 'comments') {
			frames.push(createId3Frame('COMM', concatBytes(
				Uint8Array.of(3),
				new TextEncoder().encode('eng'),
				Uint8Array.of(0),
				new TextEncoder().encode(value),
			)));
			continue;
		}
		const frameId = TEXT_FRAME_IDS[normalizedKey];
		if (frameId) {
			frames.push(createId3Frame(frameId, concatBytes(Uint8Array.of(3), new TextEncoder().encode(value))));
			continue;
		}
		frames.push(createId3Frame('TXXX', concatBytes(
			Uint8Array.of(3),
			new TextEncoder().encode(key),
			Uint8Array.of(0),
			new TextEncoder().encode(value),
		)));
	}
	if (!frames.length) return new Uint8Array(0);
	const body = concatBytes(...frames);
	const header = new Uint8Array(10);
	header.set(new TextEncoder().encode('ID3'), 0);
	header[3] = 4;
	header[4] = 0;
	header[5] = 0;
	header.set(encodeSynchsafe(body.byteLength), 6);
	return concatBytes(header, body);
}

export function createRiffId3Chunk(metadata = {}) {
	const tag = createAudioMetadataId3Tag(metadata);
	if (!tag.byteLength) return tag;
	const output = new Uint8Array(8 + tag.byteLength + (tag.byteLength % 2));
	const view = new DataView(output.buffer);
	writeAscii(view, 0, 'id3 ');
	view.setUint32(4, tag.byteLength, true);
	output.set(tag, 8);
	return output;
}

export function createAiffId3Chunk(metadata = {}) {
	const tag = createAudioMetadataId3Tag(metadata);
	if (!tag.byteLength) return tag;
	const output = new Uint8Array(8 + tag.byteLength + (tag.byteLength % 2));
	const view = new DataView(output.buffer);
	writeAscii(view, 0, 'ID3 ');
	view.setUint32(4, tag.byteLength, false);
	output.set(tag, 8);
	return output;
}

function createId3Frame(id, payload) {
	const frame = new Uint8Array(10 + payload.byteLength);
	const view = new DataView(frame.buffer);
	writeAscii(view, 0, id);
	frame.set(encodeSynchsafe(payload.byteLength), 4);
	view.setUint16(8, 0, false);
	frame.set(payload, 10);
	return frame;
}

function encodeSynchsafe(value) {
	if (!Number.isSafeInteger(value) || value < 0 || value > 0x0fffffff) throw new RangeError('ID3 metadata is too large.');
	return Uint8Array.of(
		(value >>> 21) & 0x7f,
		(value >>> 14) & 0x7f,
		(value >>> 7) & 0x7f,
		value & 0x7f,
	);
}

function concatBytes(...parts) {
	const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.byteLength;
	}
	return result;
}

function writeAscii(view, offset, value) {
	for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}
