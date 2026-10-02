/* SPDX-License-Identifier: AGPL-3.0-only */

import { confirmFileSizeWarning, type FileSizeWarningOptions } from '../shared/file-size-warning.ts';

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

/** Wrap admitted raw PCM as WAV, retaining large inputs through bounded slices. */
export async function prepareRawPcmWaveFile(file: File, options: RawPcmImportOptions,
	settings: Readonly<FileSizeWarningOptions & { desktop?: boolean }> = {}): Promise<File> {
	if (!file || typeof file.size !== 'number' || typeof file.name !== 'string') throw new TypeError('A raw PCM file is required.');
	if (!Number.isSafeInteger(file.size) || file.size < 0) throw new RangeError('Raw PCM input must have a safe non-negative byte length.');
	if (!Object.hasOwn(FORMAT_BYTES, options?.sampleFormat)) throw new RangeError('Unsupported raw PCM sample format.');
	if (options.byteOrder !== 'little' && options.byteOrder !== 'big') throw new RangeError('Unsupported raw PCM byte order.');
	const sampleRate = boundedInteger(options.sampleRate, 1, 384_000, 'sample rate');
	const channelCount = boundedInteger(options.channelCount, 1, 32, 'channel count');
	const offsetBytes = boundedInteger(options.offsetBytes, 0, file.size, 'byte offset');
	const bytesPerSample = FORMAT_BYTES[options.sampleFormat];
	const dataBytes = file.size - offsetBytes;
	const blockAlign = bytesPerSample * channelCount;
	if (!dataBytes || dataBytes % blockAlign !== 0) throw new RangeError('Raw PCM data must contain complete interleaved frames.');
	if (dataBytes > Number.MAX_SAFE_INTEGER - 81) throw new RangeError('Raw PCM input exceeds the safe WAV byte range.');
	if (!settings.desktop) await confirmFileSizeWarning(file.size, MAXIMUM_RAW_PCM_IMPORT_BYTES, file.name, settings);
	settings.signal?.throwIfAborted(); settings.assertCurrent?.();
	const name = `${file.name.replace(/\.[^.]*$/, '') || 'raw-audio'}.wav`;
	if (settings.desktop || file.size > MAXIMUM_RAW_PCM_IMPORT_BYTES) {
		const header = dataBytes + 36 + (dataBytes % 2) > 0xffff_ffff
			? rf64Header(dataBytes, options.sampleFormat, sampleRate, channelCount, blockAlign)
			: wavHeader(dataBytes, options.sampleFormat, sampleRate, channelCount, blockAlign);
		return new RawPcmWaveFile(header, file, offsetBytes, bytesPerSample,
			options.byteOrder === 'big' && bytesPerSample > 1, name);
	}
	const source = new Uint8Array(await file.slice(offsetBytes).arrayBuffer());
	settings.signal?.throwIfAborted(); settings.assertCurrent?.();
	if (options.byteOrder === 'big' && bytesPerSample > 1) swapSamples(source, bytesPerSample);
	const header = wavHeader(dataBytes, options.sampleFormat, sampleRate, channelCount, blockAlign);
	return new File([header.buffer as ArrayBuffer, source.buffer as ArrayBuffer, new Uint8Array(dataBytes % 2)], name, { type: 'audio/wav', lastModified: file.lastModified });
}

function rf64Header(dataBytes: number, format: RawPcmSampleFormat, sampleRate: number,
	channelCount: number, blockAlign: number): Uint8Array {
	const header = new Uint8Array(80);
	const view = new DataView(header.buffer);
	writeAscii(header, 0, 'RF64'); view.setUint32(4, 0xffff_ffff, true); writeAscii(header, 8, 'WAVE');
	writeAscii(header, 12, 'ds64'); view.setUint32(16, 28, true);
	view.setBigUint64(20, BigInt(dataBytes + 72 + (dataBytes % 2)), true);
	view.setBigUint64(28, BigInt(dataBytes), true);
	view.setBigUint64(36, BigInt(dataBytes / blockAlign), true);
	writeAscii(header, 48, 'fmt '); view.setUint32(52, 16, true);
	view.setUint16(56, format === 'float32' ? 3 : 1, true);
	view.setUint16(58, channelCount, true); view.setUint32(60, sampleRate, true);
	view.setUint32(64, sampleRate * blockAlign, true);
	view.setUint16(68, blockAlign, true); view.setUint16(70, FORMAT_BYTES[format] * 8, true);
	writeAscii(header, 72, 'data'); view.setUint32(76, 0xffff_ffff, true);
	return header;
}

class RawPcmWaveFile extends File {
	readonly #body: RawPcmWaveBlob;
	constructor(header: Uint8Array, source: File, sourceOffset: number, width: number, swap: boolean, name: string) {
		super([], name, { type: 'audio/wav', lastModified: source.lastModified });
		this.#body = new RawPcmWaveBlob(header, source, sourceOffset, width, swap, 0,
			header.byteLength + source.size - sourceOffset + ((source.size - sourceOffset) % 2));
	}
	override get size(): number { return this.#body.size; }
	override slice(start?: number, end?: number, contentType?: string): Blob { return this.#body.slice(start, end, contentType); }
	override arrayBuffer(): Promise<ArrayBuffer> { return this.#body.arrayBuffer(); }
	override bytes(): Promise<Uint8Array<ArrayBuffer>> { return this.#body.bytes(); }
	override text(): Promise<string> { return this.#body.text(); }
	override stream(): ReadableStream<Uint8Array<ArrayBuffer>> { return this.#body.stream(); }
}

class RawPcmWaveBlob extends Blob {
	readonly #header: Uint8Array;
	readonly #source: File;
	readonly #sourceOffset: number;
	readonly #width: number;
	readonly #swap: boolean;
	readonly #offset: number;
	readonly #length: number;
	constructor(header: Uint8Array, source: File, sourceOffset: number, width: number, swap: boolean,
		offset: number, length: number, type = 'audio/wav') {
		super([], { type });
		this.#header = header; this.#source = source; this.#sourceOffset = sourceOffset;
		this.#width = width; this.#swap = swap; this.#offset = offset; this.#length = length;
	}
	override get size(): number { return this.#length; }
	override slice(start = 0, end = this.size, contentType = ''): Blob {
		const first = relative(start, this.size); const last = relative(end, this.size);
		return new RawPcmWaveBlob(this.#header, this.#source, this.#sourceOffset, this.#width, this.#swap,
			this.#offset + first, Math.max(0, last - first), contentType);
	}
	override async arrayBuffer(): Promise<ArrayBuffer> {
		const bytes = new Uint8Array(this.size);
		let offset = 0;
		for await (const part of this.stream()) { bytes.set(part, offset); offset += part.byteLength; }
		return bytes.buffer;
	}
	override async bytes(): Promise<Uint8Array<ArrayBuffer>> { return new Uint8Array(await this.arrayBuffer()); }
	override async text(): Promise<string> { return new TextDecoder().decode(await this.arrayBuffer()); }
	override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
		let offset = 0;
		return new ReadableStream({ pull: async (controller) => {
			if (offset >= this.size) { controller.close(); return; }
			const length = Math.min(4 * 1024 * 1024, this.size - offset);
			controller.enqueue(await this.#read(this.#offset + offset, length)); offset += length;
		} });
	}
	async #read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
		const bytes = new Uint8Array(length);
		const headerEnd = Math.min(offset + length, this.#header.byteLength);
		if (offset < headerEnd) bytes.set(this.#header.subarray(offset, headerEnd));
		const dataStart = this.#header.byteLength;
		const dataEnd = dataStart + this.#source.size - this.#sourceOffset;
		const first = Math.max(offset, dataStart); const last = Math.min(offset + length, dataEnd);
		if (first < last) {
			const relativeFirst = first - dataStart;
			const relativeLast = last - dataStart;
			const alignedFirst = this.#swap ? Math.floor(relativeFirst / this.#width) * this.#width : relativeFirst;
			const alignedLast = this.#swap ? Math.ceil(relativeLast / this.#width) * this.#width : relativeLast;
			const source = new Uint8Array(await this.#source.slice(this.#sourceOffset + alignedFirst,
				this.#sourceOffset + alignedLast).arrayBuffer());
			if (this.#swap) swapSamples(source, this.#width);
			bytes.set(source.subarray(relativeFirst - alignedFirst, relativeLast - alignedFirst), first - offset);
		}
		return bytes;
	}
}

function relative(value: number, size: number): number {
	const integer = Number.isNaN(value) ? 0 : Math.trunc(value);
	return integer < 0 ? Math.max(size + integer, 0) : Math.min(integer, size);
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
	view.setUint32(4, 36 + dataBytes + (dataBytes % 2), true);
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
