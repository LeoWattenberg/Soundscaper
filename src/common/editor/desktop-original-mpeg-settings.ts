/* SPDX-License-Identifier: AGPL-3.0-only */

interface MpegFrame {
	readonly offset: number;
	readonly version: number;
	readonly layer: number;
	readonly bitRate: number;
	readonly mono: boolean;
}

const MPEG1_LAYER3_RATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG1_LAYER2_RATES = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];
const MPEG2_RATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

/** The source's first frame and Xing/LAME tag retain its bitrate strategy. */
export function originalMpegExportSettings(
	bytes: Uint8Array,
	format: 'mp3' | 'mp2',
	estimatedBitRate: number | null,
): Readonly<Record<string, unknown>> | null {
	const frame = firstFrame(bytes);
	if (!frame || frame.layer !== (format === 'mp3' ? 1 : 2)) return null;
	if (format === 'mp2') return Object.freeze({ bitRate: frame.bitRate });
	const sideInfo = frame.version === 3 ? frame.mono ? 17 : 32 : frame.mono ? 9 : 17;
	const crcBytes = bytes[frame.offset + 1]! & 1 ? 0 : 2;
	const xingOffset = frame.offset + 4 + crcBytes + sideInfo;
	const tag = ascii(bytes, xingOffset, 4);
	const vbri = ascii(bytes, frame.offset + 36 + crcBytes, 4) === 'VBRI';
	if (tag !== 'Xing' && !vbri) return Object.freeze({ bitRateMode: 'constant', bitRate: frame.bitRate });
	const lame = tag === 'Xing' ? xingLameSettings(bytes, xingOffset) : null;
	if (lame?.averageBitRate) return Object.freeze({ bitRateMode: 'average', bitRate: frame.bitRate,
		averageBitRate: lame.averageBitRate });
	return Object.freeze({ bitRateMode: 'variable', bitRate: frame.bitRate,
		vbrQuality: lame?.quality ?? approximateVbrQuality(estimatedBitRate ?? frame.bitRate) });
}

function firstFrame(bytes: Uint8Array): MpegFrame | null {
	let offset = 0;
	if (ascii(bytes, 0, 3) === 'ID3') {
		if (bytes.length < 10) return null;
		let size = 0;
		for (let index = 6; index < 10; index += 1) {
			const byte = bytes[index]!;
			if (byte & 0x80) return null;
			size = size * 128 + byte;
		}
		offset = 10 + size + (bytes[5]! & 0x10 ? 10 : 0);
	}
	if (offset + 4 > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1]! & 0xe0) !== 0xe0) return null;
	const version = bytes[offset + 1]! >>> 3 & 3;
	const layer = bytes[offset + 1]! >>> 1 & 3;
	const index = bytes[offset + 2]! >>> 4;
	const frequencyIndex = bytes[offset + 2]! >>> 2 & 3;
	if (version === 1 || (layer !== 1 && layer !== 2) || index === 0 || index === 15 || frequencyIndex === 3) return null;
	const rates = version !== 3 ? MPEG2_RATES : layer === 1 ? MPEG1_LAYER3_RATES : MPEG1_LAYER2_RATES;
	return { offset, version, layer, bitRate: rates[index]!, mono: bytes[offset + 3]! >>> 6 === 3 };
}

function xingLameSettings(bytes: Uint8Array, offset: number): Readonly<{ quality: number; averageBitRate: number | null }> | null {
	if (offset + 8 > bytes.length) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const flags = view.getUint32(offset + 4, false);
	let cursor = offset + 8 + (flags & 1 ? 4 : 0) + (flags & 2 ? 4 : 0) + (flags & 4 ? 100 : 0);
	if (!(flags & 8) || cursor + 8 > bytes.length) return null;
	const scale = view.getUint32(cursor, false);
	cursor += 4;
	// LAME writes scale = 100 - 10 * VBR quality - algorithm quality.
	// https://github.com/lameproject/lame/blob/master/libmp3lame/VbrTag.c
	if (ascii(bytes, cursor, 4) !== 'LAME' || scale > 100) return null;
	const method = cursor + 10 <= bytes.length ? bytes[cursor + 9]! & 0x0f : null;
	const averageBitRate = method === 2 && cursor + 21 <= bytes.length ? bytes[cursor + 20]! : null;
	return { quality: Math.min(9, Math.floor((100 - scale) / 10)), averageBitRate };
}

function approximateVbrQuality(bitRate: number): number {
	const quality = [230, 200, 180, 170, 140, 120].findIndex((threshold) => bitRate >= threshold);
	return quality < 0 ? 6 : quality;
}

function ascii(bytes: Uint8Array, offset: number, count: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + count));
}
