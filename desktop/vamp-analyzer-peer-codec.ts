/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed binary M5A1 body codec shared by the isolated Vamp peer proxy. */

import {
	VAMP_ANALYZER_LIMITS,
	admitVampAnalyzerDescriptor,
	admitVampAnalyzerFeatures,
	admitVampAnalyzerOutputs,
	type VampAnalyzerConfiguration,
	type VampAnalyzerDescriptor,
	type VampAnalyzerFeature,
	type VampAnalyzerOutputDescriptor,
	type VampAnalyzerPcmChunk,
} from './vamp-analyzer-contract.ts';

export const VAMP_PEER_VERSION = 1;
export const VAMP_PEER_MAXIMUM_FRAME_BYTES = 16 * 1_024 ** 2;
export const VAMP_PEER_PCM_REQUEST_OVERHEAD_BYTES = 2 + 8 + 4 + 4;
export const VAMP_PEER_OPERATION = Object.freeze({
	scan: 1, open: 2, configure: 3, process: 4, finish: 5, cancel: 6, close: 7,
} as const);

const STATUS = Object.freeze([
	'ok', 'invalid-argument', 'library-unreadable', 'library-malformed',
	'analyzer-not-found', 'configuration-refused', 'limit-exceeded', 'cancelled',
]);

export class VampPeerWriter {
	readonly #parts: Buffer[] = [];
	#length = 0;

	byte(value: number): void { this.#append(Buffer.from([integer(value, 0, 0xff, 'byte')])); }
	unsigned32(value: number): void {
		const bytes = Buffer.allocUnsafe(4);
		bytes.writeUInt32LE(integer(value, 0, 0xffff_ffff, 'unsigned integer'));
		this.#append(bytes);
	}
	unsigned64(value: number): void {
		const admitted = integer(value, 0, Number.MAX_SAFE_INTEGER, 'wide unsigned integer');
		const bytes = Buffer.allocUnsafe(8);
		bytes.writeBigUInt64LE(BigInt(admitted));
		this.#append(bytes);
	}
	number(value: number): void {
		if (!Number.isFinite(value)) throw new TypeError('A finite Vamp peer number is required.');
		const bytes = Buffer.allocUnsafe(8);
		bytes.writeDoubleLE(value);
		this.#append(bytes);
	}
	text(value: string, maximum = 32_768): void {
		if (typeof value !== 'string' || value.includes('\0')) throw new TypeError('Vamp peer text is invalid.');
		const bytes = Buffer.from(value, 'utf8');
		if (bytes.byteLength > maximum) throw new RangeError('Vamp peer text is oversized.');
		this.unsigned32(bytes.byteLength);
		this.#append(bytes);
	}
	floats(value: Float32Array): void {
		if (!(value instanceof Float32Array)
			|| (typeof SharedArrayBuffer !== 'undefined' && value.buffer instanceof SharedArrayBuffer)) {
			throw new TypeError('Vamp peer PCM requires ordinary Float32 arrays.');
		}
		const bytes = Buffer.allocUnsafe(value.byteLength);
		for (let index = 0; index < value.length; index += 1) bytes.writeFloatLE(value[index]!, index * 4);
		this.#append(bytes);
	}
	value(): Uint8Array { return new Uint8Array(Buffer.concat(this.#parts)); }

	#append(bytes: Buffer): void {
		if (bytes.byteLength > VAMP_PEER_MAXIMUM_FRAME_BYTES - this.#length) {
			throw new RangeError('A Vamp peer request is oversized.');
		}
		this.#parts.push(bytes);
		this.#length += bytes.byteLength;
	}
}

export class VampPeerReader {
	readonly #bytes: Buffer;
	#offset = 0;

	constructor(value: Uint8Array) {
		if (!(value instanceof Uint8Array) || value.byteLength > VAMP_PEER_MAXIMUM_FRAME_BYTES) {
			throw new TypeError('A bounded Vamp peer response is required.');
		}
		this.#bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	}
	byte(): number { return this.#take(1).readUInt8(0); }
	unsigned32(): number { return this.#take(4).readUInt32LE(0); }
	signed32(): number { return this.#take(4).readInt32LE(0); }
	unsigned64(): number { return safeWide(this.#take(8).readBigUInt64LE(0)); }
	signed64(): number { return safeWide(this.#take(8).readBigInt64LE(0)); }
	number(): number {
		const value = this.#take(8).readDoubleLE(0);
		if (!Number.isFinite(value)) throw new TypeError('The Vamp peer returned a non-finite number.');
		return value;
	}
	text(maximum: number, empty = true): string {
		const bytes = this.blob(maximum);
		let value: string;
		try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
		catch { throw new TypeError('The Vamp peer returned invalid UTF-8.'); }
		if ((!empty && value.length === 0) || value.includes('\0')) {
			throw new TypeError('The Vamp peer returned invalid text.');
		}
		return value;
	}
	blob(maximum: number): Uint8Array {
		const length = this.unsigned32();
		if (length > maximum) throw new RangeError('The Vamp peer returned an oversized blob.');
		return new Uint8Array(this.#take(length));
	}
	done(): void {
		if (this.#offset !== this.#bytes.byteLength) throw new Error('The Vamp peer response has trailing bytes.');
	}

	#take(length: number): Buffer {
		if (length > this.#bytes.byteLength - this.#offset) throw new Error('The Vamp peer response ended early.');
		const value = this.#bytes.subarray(this.#offset, this.#offset + length);
		this.#offset += length;
		return value;
	}
}

export function vampPeerResponse(value: Uint8Array, operation: number): VampPeerReader {
	const reader = new VampPeerReader(value);
	if (reader.byte() !== VAMP_PEER_VERSION || reader.byte() !== operation) {
		throw new Error('The Vamp peer response is misbound.');
	}
	const status = reader.unsigned32();
	if (status !== 0) {
		const error = Object.assign(new Error(reader.text(2_048, false)), {
			code: STATUS[status] ?? 'invalid-argument',
		});
		reader.done();
		throw error;
	}
	const payload = new VampPeerReader(reader.blob(VAMP_PEER_MAXIMUM_FRAME_BYTES - 16));
	reader.done();
	return payload;
}

export function readVampAnalyzerDescriptors(
	reader: VampPeerReader,
): readonly Readonly<VampAnalyzerDescriptor>[] {
	const count = reader.unsigned32();
	if (count < 1 || count > 256) throw new RangeError('The Vamp peer returned an invalid descriptor count.');
	const values = Object.freeze(Array.from({ length: count }, () => readVampAnalyzerDescriptor(reader)));
	if (new Set(values.map(({ identifier }) => identifier)).size !== values.length) {
		throw new TypeError('The Vamp peer returned duplicate analyzer identifiers.');
	}
	return values;
}

export function readVampAnalyzerOutputs(
	reader: VampPeerReader,
): readonly Readonly<VampAnalyzerOutputDescriptor>[] {
	const count = reader.unsigned32();
	if (count < 1 || count > VAMP_ANALYZER_LIMITS.maximumOutputs) {
		throw new RangeError('The Vamp peer returned an invalid output count.');
	}
	return admitVampAnalyzerOutputs(Array.from({ length: count }, () => readOutput(reader)));
}

export function readVampAnalyzerFeatures(
	reader: VampPeerReader,
	outputs: readonly Readonly<VampAnalyzerOutputDescriptor>[],
): readonly Readonly<VampAnalyzerFeature>[] {
	const count = reader.unsigned32();
	if (count > VAMP_ANALYZER_LIMITS.maximumBatchFeatures) {
		throw new RangeError('The Vamp peer returned too many features.');
	}
	const values = Array.from({ length: count }, () => {
		const outputId = reader.text(256, false);
		const timestamp = optionalTime(reader);
		const duration = optionalTime(reader);
		const valueCount = reader.unsigned32();
		if (valueCount > VAMP_ANALYZER_LIMITS.maximumBins) {
			throw new RangeError('The Vamp peer returned too many feature values.');
		}
		return {
			outputId, timestamp, duration,
			values: Array.from({ length: valueCount }, () => reader.number()),
			label: reader.text(VAMP_ANALYZER_LIMITS.maximumLabelLength),
		};
	});
	return admitVampAnalyzerFeatures(values, outputs);
}

export function writeVampAnalyzerConfiguration(
	writer: VampPeerWriter,
	value: Readonly<VampAnalyzerConfiguration>,
): void {
	writer.number(value.sampleRate);
	writer.unsigned32(value.channelCount);
	writer.unsigned32(value.stepSize);
	writer.unsigned32(value.blockSize);
	writer.unsigned64(value.frameCount);
	const parameters = Object.entries(value.parameters).sort(([left], [right]) => left.localeCompare(right));
	writer.unsigned32(parameters.length);
	for (const [identifier, parameter] of parameters) {
		writer.text(identifier, 256);
		writer.number(parameter);
	}
	writer.byte(value.program === null ? 0 : 1);
	if (value.program !== null) writer.text(value.program, VAMP_ANALYZER_LIMITS.maximumTextLength);
}

export function writeVampAnalyzerPcm(writer: VampPeerWriter, value: Readonly<VampAnalyzerPcmChunk>): void {
	const pcmBytes = value.frameCount * value.channels.length * Float32Array.BYTES_PER_ELEMENT;
	if (pcmBytes > VAMP_PEER_MAXIMUM_FRAME_BYTES - VAMP_PEER_PCM_REQUEST_OVERHEAD_BYTES) {
		throw new RangeError('The Vamp PCM chunk exceeds one M5A1 transport frame.');
	}
	writer.unsigned64(value.startFrame);
	writer.unsigned32(value.channels.length);
	writer.unsigned32(value.frameCount);
	for (const channel of value.channels) writer.floats(channel);
}

export function maximumVampPeerPcmFrames(channelCount: number): number {
	const channels = integer(channelCount, 1, VAMP_ANALYZER_LIMITS.maximumChannels, 'PCM channel count');
	return Math.min(VAMP_ANALYZER_LIMITS.maximumPcmChunkFrames, Math.floor(
		(VAMP_PEER_MAXIMUM_FRAME_BYTES - VAMP_PEER_PCM_REQUEST_OVERHEAD_BYTES)
		/ (channels * Float32Array.BYTES_PER_ELEMENT),
	));
}

export function splitVampPeerPcmChunkForTransport(
	value: Readonly<VampAnalyzerPcmChunk>,
): readonly Readonly<VampAnalyzerPcmChunk>[] {
	const maximumFrames = maximumVampPeerPcmFrames(value.channels.length);
	if (value.frameCount <= maximumFrames) return Object.freeze([value]);
	const chunks: Readonly<VampAnalyzerPcmChunk>[] = [];
	for (let offset = 0; offset < value.frameCount; offset += maximumFrames) {
		const frameCount = Math.min(maximumFrames, value.frameCount - offset);
		chunks.push(Object.freeze({
			startFrame: value.startFrame + offset,
			frameCount,
			channels: Object.freeze(value.channels.map(
				(channel) => channel.subarray(offset, offset + frameCount),
			)),
		}));
	}
	return Object.freeze(chunks);
}

export function readVampAnalyzerDescriptor(reader: VampPeerReader): Readonly<VampAnalyzerDescriptor> {
	const identity = {
		identifier: reader.text(256, false), name: reader.text(512), description: reader.text(512),
		maker: reader.text(512), copyright: reader.text(512), pluginVersion: reader.signed32(),
		vampApiVersion: reader.unsigned32(),
	};
	const domain = reader.byte();
	if (domain > 1) throw new TypeError('The Vamp peer returned an invalid input domain.');
	const header = {
		kind: 'analyzer', format: 'vamp', ...identity,
		inputDomain: domain === 0 ? 'time' : 'frequency',
		minimumChannels: reader.unsigned32(), maximumChannels: reader.unsigned32(),
		preferredStepSize: reader.unsigned32(), preferredBlockSize: reader.unsigned32(),
	};
	const parameterCount = reader.unsigned32();
	if (parameterCount > VAMP_ANALYZER_LIMITS.maximumParameters) {
		throw new RangeError('The Vamp peer returned too many parameters.');
	}
	const parameters = Array.from({ length: parameterCount }, () => {
		const parameter = {
			identifier: reader.text(256, false), name: reader.text(512), description: reader.text(512),
			unit: reader.text(512), minimumValue: reader.number(), maximumValue: reader.number(),
			defaultValue: reader.number(), quantizeStep: optionalNumber(reader),
		};
		const valueNameCount = reader.unsigned32();
		if (valueNameCount > VAMP_ANALYZER_LIMITS.maximumBins) throw new RangeError('Too many Vamp value names.');
		return { ...parameter,
			valueNames: Array.from({ length: valueNameCount }, () => reader.text(VAMP_ANALYZER_LIMITS.maximumTextLength)),
		};
	});
	const programCount = reader.unsigned32();
	if (programCount > VAMP_ANALYZER_LIMITS.maximumPrograms) throw new RangeError('Too many Vamp programs.');
	const programs = Array.from({ length: programCount }, () => reader.text(VAMP_ANALYZER_LIMITS.maximumTextLength));
	const outputCount = reader.unsigned32();
	if (outputCount < 1 || outputCount > VAMP_ANALYZER_LIMITS.maximumOutputs) throw new RangeError('Invalid Vamp outputs.');
	const outputs = Array.from({ length: outputCount }, () => readOutput(reader));
	return admitVampAnalyzerDescriptor({ ...header, parameters, programs, outputs });
}

function readOutput(reader: VampPeerReader): Record<string, unknown> {
	const identifier = reader.text(256, false);
	const name = reader.text(512), description = reader.text(512), unit = reader.text(512);
	const binCount = optionalUnsigned32(reader);
	const binNameCount = reader.unsigned32();
	if (binNameCount > VAMP_ANALYZER_LIMITS.maximumBins) throw new RangeError('Too many Vamp bin names.');
	const binNames = Array.from({ length: binNameCount }, () => reader.text(512));
	const extents = reader.byte() === 0 ? null
		: Object.freeze({ minimumValue: reader.number(), maximumValue: reader.number() });
	const quantizeStep = optionalNumber(reader);
	const sampleType = ['one-sample-per-step', 'fixed-sample-rate', 'variable-sample-rate'][reader.byte()];
	const sampleRate = optionalNumber(reader);
	const duration = reader.byte();
	if (sampleType === undefined || duration > 1) throw new TypeError('Invalid Vamp output flags.');
	return { identifier, name, description, unit, binCount, binNames, extents, quantizeStep,
		sampleType, sampleRate, hasDuration: duration === 1 };
}

function optionalUnsigned32(reader: VampPeerReader): number | null {
	const present = reader.byte();
	if (present > 1) throw new TypeError('Invalid optional Vamp integer.');
	return present === 0 ? null : reader.unsigned32();
}

function optionalNumber(reader: VampPeerReader): number | null {
	const present = reader.byte();
	if (present > 1) throw new TypeError('Invalid optional Vamp number.');
	return present === 0 ? null : reader.number();
}

function optionalTime(reader: VampPeerReader): { seconds: number; nanoseconds: number } | null {
	const present = reader.byte();
	if (present > 1) throw new TypeError('Invalid optional Vamp time.');
	return present === 0 ? null : Object.freeze({ seconds: reader.signed64(), nanoseconds: reader.signed32() });
}

function integer(value: number, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`Invalid Vamp peer ${label}.`);
	}
	return value;
}

function safeWide(value: bigint): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number)) throw new RangeError('The Vamp peer returned an unsafe wide integer.');
	return number;
}
