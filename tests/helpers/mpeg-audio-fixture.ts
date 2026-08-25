/* SPDX-License-Identifier: AGPL-3.0-only */

export type TestMpegAudioLayer = 2 | 3;

interface TestMpegAudioFrameOptions {
	readonly layer: TestMpegAudioLayer;
	readonly sampleRate?: 32_000 | 44_100 | 48_000;
	readonly bitrateKbps?: number;
	readonly channelCount?: 1 | 2;
	readonly padding?: boolean;
	readonly crcProtected?: boolean;
	readonly mpegVersion?: 1 | 2;
}

const MPEG1_BITRATES = Object.freeze({
	2: Object.freeze([0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384]),
	3: Object.freeze([0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]),
});
const MPEG2_BITRATES = Object.freeze([0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]);

export function testMpegAudioFrame(options: TestMpegAudioFrameOptions): Uint8Array {
	const version = options.mpegVersion ?? 1;
	const layer = options.layer;
	const sampleRate = options.sampleRate ?? 44_100;
	const bitrateKbps = options.bitrateKbps ?? (layer === 2 ? 192 : 128);
	const channelCount = options.channelCount ?? 2;
	const rates = version === 1 ? [44_100, 48_000, 32_000] : [22_050, 24_000, 16_000];
	const encodedSampleRate = version === 1 ? sampleRate : sampleRate / 2;
	const sampleRateIndex = rates.indexOf(encodedSampleRate);
	const bitrates = version === 1 ? MPEG1_BITRATES[layer] : MPEG2_BITRATES;
	const bitrateIndex = bitrates.indexOf(bitrateKbps);
	if (sampleRateIndex < 0 || bitrateIndex < 1 || channelCount < 1 || channelCount > 2) {
		throw new RangeError('The MPEG audio test-frame options are invalid.');
	}
	const padding = options.padding ? 1 : 0;
	const coefficient = version === 1 || layer === 2 ? 144 : 72;
	const frameBytes = Math.floor(coefficient * bitrateKbps * 1_000 / encodedSampleRate) + padding;
	const header = (0x7ff << 21) | ((version === 1 ? 3 : 2) << 19)
		| ((layer === 2 ? 2 : 1) << 17) | ((options.crcProtected ? 0 : 1) << 16)
		| (bitrateIndex << 12) | (sampleRateIndex << 10) | (padding << 9)
		| ((channelCount === 1 ? 3 : 0) << 6);
	const frame = new Uint8Array(frameBytes);
	new DataView(frame.buffer).setUint32(0, header >>> 0, false);
	return frame;
}

export function testMpegAudioStream(
	options: TestMpegAudioFrameOptions & Readonly<{ readonly frameCount?: number }>,
): Uint8Array {
	const frameCount = options.frameCount ?? 4;
	const frames = Array.from({ length: frameCount }, (_, index) => testMpegAudioFrame({
		...options, padding: options.padding ?? index % 2 === 1,
	}));
	const output = new Uint8Array(frames.reduce((sum, frame) => sum + frame.byteLength, 0));
	let offset = 0;
	for (const frame of frames) { output.set(frame, offset); offset += frame.byteLength; }
	return output;
}

export function withId3v2(stream: Uint8Array): Uint8Array {
	return concatenate(Uint8Array.of(0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0), stream);
}

export function withId3v1(stream: Uint8Array): Uint8Array {
	return concatenate(stream, Uint8Array.of(0x54, 0x41, 0x47), new Uint8Array(125));
}

export function concatenate(...parts: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
	return output;
}
