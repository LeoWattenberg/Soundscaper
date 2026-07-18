const MAX_SIGNATURE_SCAN_BYTES = 1024 * 1024;
const MAX_CONTAINER_BOXES = 16_384;
const ASF_HEADER_GUID = Object.freeze([
	0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11,
	0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c,
]);
const ASF_STREAM_PROPERTIES_GUID = Object.freeze([
	0x91, 0x07, 0xdc, 0xb7, 0xb7, 0xa9, 0xcf, 0x11,
	0x8e, 0xe6, 0x00, 0xc0, 0x0c, 0x20, 0x53, 0x65,
]);
const ASF_AUDIO_MEDIA_GUID = Object.freeze([
	0x40, 0x9e, 0x69, 0xf8, 0x4d, 0x5b, 0xcf, 0x11,
	0xa8, 0xfd, 0x00, 0x80, 0x5f, 0x5c, 0x44, 0x2b,
]);
const WAVPACK_SAMPLE_RATES = Object.freeze([
	6_000, 8_000, 9_600, 11_025,
	12_000, 16_000, 22_050, 24_000,
	32_000, 44_100, 48_000, 64_000,
	88_200, 96_000, 192_000, 0,
]);
const AAC_SAMPLE_RATES = Object.freeze([
	96_000, 88_200, 64_000, 48_000,
	44_100, 32_000, 24_000, 22_050,
	16_000, 12_000, 11_025, 8_000,
	7_350,
]);

/**
 * Reads the declared source sample rate from common browser-decodable audio
 * containers without decoding their PCM. Unknown or malformed inputs return
 * null so import can safely fall back to the decoder's reported rate.
 */
export function inspectEncodedAudioSampleRate(input) {
	const bytes = byteView(input);
	if (!bytes || bytes.byteLength < 4) return null;
	try {
		return inspectWaveSampleRate(bytes)
			?? inspectAiffSampleRate(bytes)
			?? inspectFlacSampleRate(bytes)
			?? inspectOggSampleRate(bytes)
			?? inspectIsoMediaSampleRate(bytes)
			?? inspectAsfSampleRate(bytes)
			?? inspectWavPackSampleRate(bytes)
			?? inspectMpegOrAdtsSampleRate(bytes);
	} catch {
		return null;
	}
}

function inspectWaveSampleRate(bytes) {
	const signature = ascii(bytes, 0, 4);
	const littleEndian = signature === 'RIFF' || signature === 'RF64';
	if ((!littleEndian && signature !== 'RIFX') || ascii(bytes, 8, 4) !== 'WAVE') return null;
	const view = dataView(bytes);
	let offset = 12;
	for (let chunks = 0; chunks < MAX_CONTAINER_BOXES && offset + 8 <= bytes.byteLength; chunks += 1) {
		const id = ascii(bytes, offset, 4);
		const size = view.getUint32(offset + 4, littleEndian);
		const payload = offset + 8;
		if (id === 'fmt ' && size >= 16 && payload + 16 <= bytes.byteLength) {
			return sampleRate(view.getUint32(payload + 4, littleEndian));
		}
		if (size === 0xffffffff || payload + size > bytes.byteLength) return null;
		offset = payload + size + (size & 1);
	}
	return null;
}

function inspectAiffSampleRate(bytes) {
	if (ascii(bytes, 0, 4) !== 'FORM') return null;
	const form = ascii(bytes, 8, 4);
	if (form !== 'AIFF' && form !== 'AIFC') return null;
	const view = dataView(bytes);
	let offset = 12;
	for (let chunks = 0; chunks < MAX_CONTAINER_BOXES && offset + 8 <= bytes.byteLength; chunks += 1) {
		const id = ascii(bytes, offset, 4);
		const size = view.getUint32(offset + 4, false);
		const payload = offset + 8;
		if (id === 'COMM' && size >= 18 && payload + 18 <= bytes.byteLength) {
			return sampleRate(readExtended80(view, payload + 8));
		}
		if (payload + size > bytes.byteLength) return null;
		offset = payload + size + (size & 1);
	}
	return null;
}

function inspectFlacSampleRate(bytes) {
	const limit = Math.min(bytes.byteLength - 4, 64 * 1024);
	for (let offset = 0; offset <= limit; offset += 1) {
		if (ascii(bytes, offset, 4) !== 'fLaC') continue;
		let block = offset + 4;
		for (let count = 0; count < 128 && block + 4 <= bytes.byteLength; count += 1) {
			const type = bytes[block] & 0x7f;
			const length = (bytes[block + 1] << 16) | (bytes[block + 2] << 8) | bytes[block + 3];
			const payload = block + 4;
			if (payload + length > bytes.byteLength) return null;
			if (type === 0 && length >= 18) {
				return sampleRate(
					(bytes[payload + 10] << 12)
					| (bytes[payload + 11] << 4)
					| (bytes[payload + 12] >>> 4),
				);
			}
			if (bytes[block] & 0x80) return null;
			block = payload + length;
		}
	}
	return null;
}

function inspectOggSampleRate(bytes) {
	if (ascii(bytes, 0, 4) !== 'OggS') return null;
	const limit = Math.min(bytes.byteLength, MAX_SIGNATURE_SCAN_BYTES);
	for (let offset = 0; offset + 16 <= limit; offset += 1) {
		if (bytes[offset] === 1 && ascii(bytes, offset + 1, 6) === 'vorbis') {
			return sampleRate(dataView(bytes).getUint32(offset + 12, true));
		}
		if (ascii(bytes, offset, 8) === 'OpusHead') {
			// Opus packets always use a 48 kHz decode clock. The header's input
			// rate field is informational and must not drive PCM resampling.
			return 48_000;
		}
	}
	return null;
}

function inspectIsoMediaSampleRate(bytes) {
	const topLevel = isoBoxes(bytes, 0, bytes.byteLength);
	const moov = topLevel.find((box) => box.type === 'moov');
	if (!moov) return null;
	for (const track of isoBoxes(bytes, moov.payload, moov.end).filter((box) => box.type === 'trak')) {
		const mdia = isoBoxes(bytes, track.payload, track.end).find((box) => box.type === 'mdia');
		if (!mdia) continue;
		const mediaBoxes = isoBoxes(bytes, mdia.payload, mdia.end);
		const handler = mediaBoxes.find((box) => box.type === 'hdlr');
		if (!handler || handler.payload + 12 > handler.end || ascii(bytes, handler.payload + 8, 4) !== 'soun') continue;
		const header = mediaBoxes.find((box) => box.type === 'mdhd');
		if (!header || header.payload + 16 > header.end) continue;
		const version = bytes[header.payload];
		const timescaleOffset = version === 1 ? header.payload + 20 : header.payload + 12;
		if (timescaleOffset + 4 > header.end) continue;
		const rate = sampleRate(dataView(bytes).getUint32(timescaleOffset, false));
		if (rate) return rate;
	}
	return null;
}

function inspectAsfSampleRate(bytes) {
	if (!matches(bytes, 0, ASF_HEADER_GUID)) return null;
	const view = dataView(bytes);
	const limit = Math.min(bytes.byteLength, MAX_SIGNATURE_SCAN_BYTES);
	for (let offset = 24; offset + 86 <= limit; offset += 1) {
		if (!matches(bytes, offset, ASF_STREAM_PROPERTIES_GUID)
			|| !matches(bytes, offset + 24, ASF_AUDIO_MEDIA_GUID)) continue;
		const objectSize = uint64(view, offset + 16, true);
		const typeDataLength = view.getUint32(offset + 64, true);
		if (!objectSize || objectSize < 94 || typeDataLength < 16 || offset + objectSize > bytes.byteLength) return null;
		return sampleRate(view.getUint32(offset + 82, true));
	}
	return null;
}

function inspectWavPackSampleRate(bytes) {
	if (ascii(bytes, 0, 4) !== 'wvpk' || bytes.byteLength < 28) return null;
	const flags = dataView(bytes).getUint32(24, true);
	return sampleRate(WAVPACK_SAMPLE_RATES[(flags >>> 23) & 0x0f]);
}

function inspectMpegOrAdtsSampleRate(bytes) {
	const view = dataView(bytes);
	let offset = 0;
	let tagged = false;
	if (ascii(bytes, 0, 3) === 'ID3' && bytes.byteLength >= 10) {
		const size = syncSafeInteger(bytes, 6);
		if (size === null) return null;
		offset = 10 + size + (bytes[5] & 0x10 ? 10 : 0);
		tagged = true;
	}
	// Untagged elementary streams start with their first frame. Searching an
	// arbitrary unknown container for sync bytes produces false positives from
	// compressed payloads (for example Matroska).
	const limit = tagged
		? Math.min(bytes.byteLength - 4, offset + 4_096)
		: Math.min(bytes.byteLength - 4, offset);
	for (; offset <= limit; offset += 1) {
		const first = bytes[offset];
		const second = bytes[offset + 1];
		if (first !== 0xff || (second & 0xe0) !== 0xe0) continue;

		// ADTS uses layer bits 00 and carries its frequency index in byte 2.
		if ((second & 0x06) === 0) {
			const frequencyIndex = (bytes[offset + 2] >>> 2) & 0x0f;
			const rate = sampleRate(AAC_SAMPLE_RATES[frequencyIndex]);
			if (rate) return rate;
			continue;
		}

		const header = view.getUint32(offset, false);
		const version = (header >>> 19) & 0x03;
		const layer = (header >>> 17) & 0x03;
		const bitrateIndex = (header >>> 12) & 0x0f;
		const frequencyIndex = (header >>> 10) & 0x03;
		if (version === 1 || layer === 0 || bitrateIndex === 0 || bitrateIndex === 0x0f || frequencyIndex === 3) continue;
		const rates = version === 3
			? [44_100, 48_000, 32_000]
			: version === 2
				? [22_050, 24_000, 16_000]
				: [11_025, 12_000, 8_000];
		return rates[frequencyIndex];
	}
	return null;
}

function isoBoxes(bytes, start, end) {
	const boxes = [];
	const view = dataView(bytes);
	let offset = start;
	for (let count = 0; count < MAX_CONTAINER_BOXES && offset + 8 <= end; count += 1) {
		let size = view.getUint32(offset, false);
		const type = ascii(bytes, offset + 4, 4);
		let headerBytes = 8;
		if (size === 1) {
			if (offset + 16 > end) break;
			size = uint64(view, offset + 8, false);
			headerBytes = 16;
		} else if (size === 0) {
			size = end - offset;
		}
		if (!Number.isSafeInteger(size) || size < headerBytes || offset + size > end) break;
		boxes.push({ type, payload: offset + headerBytes, end: offset + size });
		offset += size;
	}
	return boxes;
}

function readExtended80(view, offset) {
	const signAndExponent = view.getUint16(offset, false);
	const sign = signAndExponent & 0x8000 ? -1 : 1;
	const exponent = signAndExponent & 0x7fff;
	const high = view.getUint32(offset + 2, false);
	const low = view.getUint32(offset + 6, false);
	if (exponent === 0 && high === 0 && low === 0) return 0;
	if (exponent === 0x7fff) return Number.NaN;
	const mantissa = high * 0x100000000 + low;
	return sign * mantissa * 2 ** (exponent - 16_383 - 63);
}

function syncSafeInteger(bytes, offset) {
	if (offset + 4 > bytes.byteLength) return null;
	let value = 0;
	for (let index = 0; index < 4; index += 1) {
		const byte = bytes[offset + index];
		if (byte & 0x80) return null;
		value = value * 128 + byte;
	}
	return value;
}

function uint64(view, offset, littleEndian) {
	const lowOffset = littleEndian ? offset : offset + 4;
	const highOffset = littleEndian ? offset + 4 : offset;
	const high = view.getUint32(highOffset, littleEndian);
	const low = view.getUint32(lowOffset, littleEndian);
	const value = high * 0x100000000 + low;
	return Number.isSafeInteger(value) ? value : null;
}

function sampleRate(value) {
	const rounded = Math.round(Number(value));
	return Number.isSafeInteger(rounded) && rounded >= 1_000 && rounded <= 1_000_000
		? rounded
		: null;
}

function byteView(input) {
	if (input instanceof ArrayBuffer) return new Uint8Array(input);
	if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	return null;
}

function dataView(bytes) {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes, offset, length) {
	if (offset < 0 || offset + length > bytes.byteLength) return '';
	let value = '';
	for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index]);
	return value;
}

function matches(bytes, offset, signature) {
	if (offset < 0 || offset + signature.length > bytes.byteLength) return false;
	for (let index = 0; index < signature.length; index += 1) {
		if (bytes[offset + index] !== signature[index]) return false;
	}
	return true;
}
