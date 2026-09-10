/* SPDX-License-Identifier: AGPL-3.0-only */

export const MAXIMUM_RAW_PCM_IMPORT_BYTES = 256 * 1024 * 1024;

export type RawPcmSampleFormat = 'uint8' | 'int16' | 'int24' | 'int32' | 'float32';
export type RawPcmByteOrder = 'little' | 'big';

export interface RawPcmImportOptions {
	readonly sampleFormat: RawPcmSampleFormat;
	readonly byteOrder: RawPcmByteOrder;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly offsetBytes: number;
}

const FORMAT_BYTES = Object.freeze({ uint8: 1, int16: 2, int24: 3, int32: 4, float32: 4 });

/** Convert a closed, bounded raw PCM stream to a WAV file accepted by the normal importer. */
export async function prepareRawPcmWaveFile(file: File, options: RawPcmImportOptions): Promise<File> {
	if (!file || typeof file.size !== 'number' || typeof file.name !== 'string') throw new TypeError('A raw PCM file is required.');
	if (file.size > MAXIMUM_RAW_PCM_IMPORT_BYTES) throw new RangeError('Raw PCM input exceeds the size limit.');
	if (!Object.hasOwn(FORMAT_BYTES, options?.sampleFormat)) throw new RangeError('Unsupported raw PCM sample format.');
	if (options.byteOrder !== 'little' && options.byteOrder !== 'big') throw new RangeError('Unsupported raw PCM byte order.');
	const sampleRate = boundedInteger(options.sampleRate, 1, 384_000, 'sample rate');
	const channelCount = boundedInteger(options.channelCount, 1, 32, 'channel count');
	const offsetBytes = boundedInteger(options.offsetBytes, 0, file.size, 'byte offset');
	const bytesPerSample = FORMAT_BYTES[options.sampleFormat];
	const dataBytes = file.size - offsetBytes;
	const blockAlign = bytesPerSample * channelCount;
	if (!dataBytes || dataBytes % blockAlign !== 0) throw new RangeError('Raw PCM data must contain complete interleaved frames.');
	const source = new Uint8Array(await file.slice(offsetBytes).arrayBuffer());
	if (options.byteOrder === 'big' && bytesPerSample > 1) swapSamples(source, bytesPerSample);
	const header = wavHeader(dataBytes, options.sampleFormat, sampleRate, channelCount, blockAlign);
	const name = `${file.name.replace(/\.[^.]*$/, '') || 'raw-audio'}.wav`;
	return new File([header.buffer as ArrayBuffer, source.buffer as ArrayBuffer], name, { type: 'audio/wav', lastModified: file.lastModified });
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	const result = Number(value);
	if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new RangeError(`Invalid raw PCM ${label}.`);
	return result;
}

function swapSamples(bytes: Uint8Array, width: number): void {
	for (let offset = 0; offset < bytes.length; offset += width) {
		for (let left = 0, right = width - 1; left < right; left += 1, right -= 1) {
			[bytes[offset + left], bytes[offset + right]] = [bytes[offset + right], bytes[offset + left]];
		}
	}
}

function wavHeader(
	dataBytes: number,
	format: RawPcmSampleFormat,
	sampleRate: number,
	channelCount: number,
	blockAlign: number,
): Uint8Array {
	const bytes = new Uint8Array(44);
	const view = new DataView(bytes.buffer);
	writeAscii(bytes, 0, 'RIFF');
	view.setUint32(4, 36 + dataBytes, true);
	writeAscii(bytes, 8, 'WAVEfmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, format === 'float32' ? 3 : 1, true);
	view.setUint16(22, channelCount, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * blockAlign, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, FORMAT_BYTES[format] * 8, true);
	writeAscii(bytes, 36, 'data');
	view.setUint32(40, dataBytes, true);
	return bytes;
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) target[offset + index] = value.charCodeAt(index);
}
