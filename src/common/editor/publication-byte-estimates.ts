/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PCM_CONTAINER_FOOTER_BYTES,
	PCM_CONTAINER_HEADER_BYTES,
	PCM_CONTAINER_INDEX_ENTRY_BYTES,
} from './wavpack/container.js';
import {
	WAVPACK_PCM_MAXIMUM_CHANNELS,
	WAVPACK_PCM_MAXIMUM_FRAMES,
} from './wavpack/pcm.js';
import {
	WAVEFORM_PEAK_BLOCK_SIZES,
	WAVEFORM_PEAK_FLOAT32_VALUES_PER_BUCKET,
} from './waveform-peak-contract.ts';

const MAXIMUM_PCM_CONTAINER_CHUNKS = 0xffff_ffffn;
const MAXIMUM_SAFE_BYTES = BigInt(Number.MAX_SAFE_INTEGER);

export type PublicationByteCertainty = 'exact' | 'upper-bound';
export type PublicationByteScope =
	| 'encoded-derivative-binary-payload'
	| 'canonical-opfs-pcm-container'
	| 'waveform-v4-float32-payload'
	| 'pcm-and-waveform-binary-payload';

export interface PublicationByteBound {
	readonly bytes: number;
	readonly certainty: PublicationByteCertainty;
	readonly scope: PublicationByteScope;
}

export interface EncodedDerivativePublicationEstimate {
	readonly binaryPayload: PublicationByteBound;
	readonly peakResidentBytes: null;
}

export interface PcmRenderPublicationOptions {
	readonly frameCount: number;
	readonly channelCount: number;
	readonly chunkFrames: number;
	readonly includeWaveformPeaks?: boolean;
}

export interface PcmRenderPublicationEstimate {
	readonly rawPcmBytes: number;
	readonly chunkCount: number;
	readonly pcmContainer: PublicationByteBound;
	readonly waveformPeaks: PublicationByteBound;
	readonly binaryPayload: PublicationByteBound;
	readonly peakResidentBytes: null;
}

export function estimateEncodedDerivativePublication(
	encodedBytes: unknown,
): Readonly<EncodedDerivativePublicationEstimate> {
	const bytes = safeNonNegativeInteger(encodedBytes, 'Encoded derivative bytes');
	return Object.freeze({
		binaryPayload: bound(bytes, 'exact', 'encoded-derivative-binary-payload'),
		peakResidentBytes: null,
	});
}

export function estimatePcmRenderPublication(
	options: PcmRenderPublicationOptions,
): Readonly<PcmRenderPublicationEstimate> {
	const frameCount = safeIntegerRange(
		options?.frameCount,
		1,
		Number.MAX_SAFE_INTEGER,
		'PCM publication frame count',
	);
	const channelCount = safeIntegerRange(
		options?.channelCount,
		1,
		WAVPACK_PCM_MAXIMUM_CHANNELS,
		'PCM publication channel count',
	);
	const chunkFrames = safeIntegerRange(
		options?.chunkFrames,
		1,
		WAVPACK_PCM_MAXIMUM_FRAMES,
		'PCM publication chunk frames',
	);
	const frames = BigInt(frameCount);
	const channels = BigInt(channelCount);
	const chunkCountValue = ceilDiv(frames, BigInt(chunkFrames));
	if (chunkCountValue > MAXIMUM_PCM_CONTAINER_CHUNKS) {
		throw new RangeError('PCM publication container chunk count exceeds the unsigned 32-bit format limit.');
	}
	const rawPcmValue = frames * channels * BigInt(Float32Array.BYTES_PER_ELEMENT);
	const rawPcmBytes = safeByteNumber(rawPcmValue, 'PCM publication raw PCM bytes');
	const containerValue = BigInt(PCM_CONTAINER_HEADER_BYTES)
		+ rawPcmValue
		+ BigInt(PCM_CONTAINER_INDEX_ENTRY_BYTES) * chunkCountValue
		+ BigInt(PCM_CONTAINER_FOOTER_BYTES);
	const pcmContainerBytes = safeByteNumber(containerValue, 'PCM publication container bytes');
	const peakValue = options.includeWaveformPeaks === true
		? waveformPeakPayloadBytes(frames, channels)
		: 0n;
	const waveformPeakBytes = safeByteNumber(peakValue, 'PCM publication waveform peak bytes');
	const binaryPayloadBytes = safeByteNumber(
		containerValue + peakValue,
		'PCM publication aggregate binary payload bytes',
	);
	return Object.freeze({
		rawPcmBytes,
		chunkCount: Number(chunkCountValue),
		pcmContainer: bound(
			pcmContainerBytes,
			'upper-bound',
			'canonical-opfs-pcm-container',
		),
		waveformPeaks: bound(
			waveformPeakBytes,
			'exact',
			'waveform-v4-float32-payload',
		),
		binaryPayload: bound(
			binaryPayloadBytes,
			'upper-bound',
			'pcm-and-waveform-binary-payload',
		),
		// Browser/worker decoder, transfer, AudioBuffer, and codec working sets
		// have no shared enforceable upper bound yet.
		peakResidentBytes: null,
	});
}

export function checkedPublicationByteSum(...values: readonly unknown[]): number {
	let total = 0n;
	for (const [index, value] of values.entries()) {
		total += BigInt(safeNonNegativeInteger(value, `Publication byte term ${index + 1}`));
		if (total > MAXIMUM_SAFE_BYTES) {
			throw new RangeError('Publication byte sum exceeds the supported safe integer range.');
		}
	}
	return Number(total);
}

function waveformPeakPayloadBytes(frames: bigint, channels: bigint): bigint {
	let bucketCount = 0n;
	for (const blockSize of WAVEFORM_PEAK_BLOCK_SIZES) {
		bucketCount += ceilDiv(frames, BigInt(blockSize));
	}
	return bucketCount
		* channels
		* BigInt(WAVEFORM_PEAK_FLOAT32_VALUES_PER_BUCKET)
		* BigInt(Float32Array.BYTES_PER_ELEMENT);
}

function ceilDiv(value: bigint, divisor: bigint): bigint {
	return ((value - 1n) / divisor) + 1n;
}

function safeNonNegativeInteger(value: unknown, field: string): number {
	const normalized = Number(value);
	if (!Number.isSafeInteger(normalized) || normalized < 0) {
		throw new RangeError(`${field} must be a safe non-negative integer.`);
	}
	return normalized;
}

function safeIntegerRange(
	value: unknown,
	minimum: number,
	maximum: number,
	field: string,
): number {
	const normalized = Number(value);
	if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
		throw new RangeError(`${field} must be a safe integer between ${minimum} and ${maximum}.`);
	}
	return normalized;
}

function safeByteNumber(value: bigint, field: string): number {
	if (value > MAXIMUM_SAFE_BYTES) {
		throw new RangeError(`${field} exceeds the supported safe integer range.`);
	}
	return Number(value);
}

function bound(
	bytes: number,
	certainty: PublicationByteCertainty,
	scope: PublicationByteScope,
): Readonly<PublicationByteBound> {
	return Object.freeze({ bytes, certainty, scope });
}
