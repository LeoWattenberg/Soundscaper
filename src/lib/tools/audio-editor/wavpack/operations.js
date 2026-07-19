/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PCM_ENCODING_RAW_F32LE,
	PCM_ENCODING_WAVPACK_F32_V1,
	PcmStorageCorruptionError,
	crc32,
	exactArrayBuffer,
	minimumWavPackSavings,
	pcmRawByteLength,
} from './pcm.js';

export function encodePcmAdaptively(rawInput, {
	frames,
	channelCount,
	sampleRate,
	runtime,
} = {}) {
	if (!runtime?.encode) throw new TypeError('A WavPack runtime is required.');
	const raw = exactArrayBuffer(rawInput);
	const rawBytes = pcmRawByteLength(frames, channelCount);
	if (raw.byteLength !== rawBytes) throw new RangeError('Raw PCM does not match its declared geometry.');
	const pcmCrc32 = crc32(raw);
	const minimumSavings = minimumWavPackSavings(rawBytes);
	if (rawBytes <= minimumSavings) return rawCodecResult(raw, pcmCrc32);
	const compressed = runtime.encode(raw, {
		frames,
		channelCount,
		sampleRate,
		maximumOutputBytes: rawBytes - minimumSavings,
	});
	if (!compressed) return rawCodecResult(raw, pcmCrc32);
	return {
		encoding: PCM_ENCODING_WAVPACK_F32_V1,
		payload: compressed,
		pcmCrc32,
		uncompressedBytes: rawBytes,
		storedBytes: compressed.byteLength,
	};
}

export function decodePcmWithWavPack(encodedInput, {
	frames,
	channelCount,
	sampleRate,
	pcmCrc32,
	runtime,
} = {}) {
	if (!runtime?.decode) throw new TypeError('A WavPack runtime is required.');
	const raw = runtime.decode(encodedInput, { frames, channelCount, sampleRate });
	const expectedCrc32 = Number(pcmCrc32) >>> 0;
	if (crc32(raw) !== expectedCrc32) {
		throw new PcmStorageCorruptionError(
			'Decoded WavPack PCM failed its persisted CRC-32.',
			'PCM_CRC_MISMATCH',
		);
	}
	return raw;
}

function rawCodecResult(raw, pcmCrc32) {
	return {
		encoding: PCM_ENCODING_RAW_F32LE,
		payload: raw,
		pcmCrc32,
		uncompressedBytes: raw.byteLength,
		storedBytes: raw.byteLength,
	};
}
