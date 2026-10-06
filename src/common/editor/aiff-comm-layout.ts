/* SPDX-License-Identifier: AGPL-3.0-only */

export type AiffPcmSampleFormat = 'int8' | 'int16' | 'int24' | 'int32' | 'float32';

export interface AiffCommLayout {
	readonly sampleFormat: AiffPcmSampleFormat;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly bitDepth: number;
	readonly bytesPerSample: number;
	readonly blockAlign: number;
	readonly byteRate: number;
}

/** AIFF-C adds a four-byte compression code and a padded Pascal name. */
export function validateAiffCommByteLength(length: number, isAifc: boolean): void {
	if (isAifc ? length < 24 || length > 278 || length % 2 !== 0 : length !== 18) {
		throw new Error(isAifc
			? 'The AIFF-C COMM chunk must contain its fixed fields and padded compression name.'
			: 'The classic AIFF COMM chunk must contain exactly 18 bytes.');
	}
}

/** Read bounded integer PCM and big-endian IEEE float32 PCM. */
export function parseAiffCommLayout(bytes: Uint8Array, isAifc: boolean): AiffCommLayout {
	validateAiffCommByteLength(bytes.byteLength, isAifc);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const channelCount = view.getUint16(0, false);
	const frameCount = view.getUint32(2, false);
	const bitDepth = view.getUint16(6, false);
	if (channelCount < 1 || channelCount > 64) throw new RangeError('AIFF channel count must be between 1 and 64.');
	if (frameCount < 1) throw new RangeError('AIFF frame count must be positive.');
	const sampleFormat = isAifc ? aifcSampleFormat(bytes, bitDepth) : aiffIntegerSampleFormat(bitDepth);
	const bytesPerSample = bitDepth / 8;
	const blockAlign = channelCount * bytesPerSample;
	const sampleRate = readExtended80(view, 8);
	const byteRate = sampleRate * blockAlign;
	if (!Number.isSafeInteger(byteRate)) throw new RangeError('AIFF byte rate exceeds integer precision.');
	return Object.freeze({ sampleFormat, sampleRate, channelCount, frameCount, bitDepth, bytesPerSample, blockAlign, byteRate });
}

function aifcSampleFormat(bytes: Uint8Array, bitDepth: number): AiffPcmSampleFormat {
	const compression = String.fromCharCode(...bytes.subarray(18, 22));
	const nameLength = bytes[22]!;
	if (23 + nameLength + (1 + nameLength) % 2 !== bytes.byteLength) {
		throw new Error('The AIFF-C compression name does not fit its COMM chunk.');
	}
	if (compression === 'NONE') return aiffIntegerSampleFormat(bitDepth);
	if (bitDepth !== 32 || (compression !== 'fl32' && compression !== 'FL32')) {
		throw new Error('AIFF-C linked originals require NONE integer PCM or fl32/FL32 float PCM.');
	}
	// The Pascal string describes the codec; its spelling does not select one.
	return 'float32';
}

export function aiffIntegerSampleFormat(value: number): AiffPcmSampleFormat {
	if (value === 8) return 'int8';
	if (value === 16) return 'int16';
	if (value === 24) return 'int24';
	if (value === 32) return 'int32';
	throw new RangeError(`AIFF integer PCM bit depth ${value} is unsupported.`);
}

function readExtended80(view: DataView, offset: number): number {
	const signAndExponent = view.getUint16(offset, false);
	if ((signAndExponent & 0x8000) !== 0) throw new RangeError('AIFF sample rate must be positive.');
	const exponent = signAndExponent & 0x7fff;
	const high = view.getUint32(offset + 2, false);
	const low = view.getUint32(offset + 6, false);
	if (exponent === 0 || exponent === 0x7fff || (high & 0x8000_0000) === 0) {
		throw new RangeError('AIFF sample rate has an invalid extended-float encoding.');
	}
	const mantissa = high * 0x1_0000_0000 + low;
	const value = mantissa * 2 ** (exponent - 16_383 - 63);
	if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('AIFF sample rate must be a positive safe integer.');
	return value;
}
