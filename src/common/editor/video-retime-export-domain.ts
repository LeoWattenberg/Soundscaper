/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RationalRate } from './timeline-time.ts';
import type { VideoRetimeOutputCadence } from './video-retime-output-cadence.ts';
import {
	videoRetimeJsonStringTokenByteLength,
} from './video-retime-export-json.ts';
import type {
	ExactSourcePosition,
	ExactSourceTime,
} from './video-source-timing-view.ts';

export const VIDEO_RETIME_EXPORT_MAXIMUM_TOPOLOGY_RECORDS = 16_384;
const MAXIMUM_EXACT_BITS = 4_096;

export interface VideoRetimeExportIntentInputV6 {
	readonly sampleStart: number;
	readonly sampleDuration: number;
	readonly sampleRate: number;
	readonly sequenceBinding: Readonly<{ id: string; rate: RationalRate }>;
	readonly outputRate?: RationalRate;
	readonly topology: readonly Readonly<{
		startSample: number;
		endSample: number;
		layers: readonly Readonly<{
			clips: readonly Readonly<{ clipId: string }>[];
		}>[];
	}>[];
	readonly canonicalClips: readonly unknown[];
}

export interface DecimalExactRationalV6 {
	readonly numerator: string;
	readonly denominator: string;
}

export interface VideoRetimeExportTopologyClip { readonly clipId: string }
export interface VideoRetimeExportTopologyLayer {
	readonly clips: readonly VideoRetimeExportTopologyClip[];
}
export interface VideoRetimeExportTopologyInterval {
	readonly startSample: number;
	readonly endSample: number;
	readonly layers: readonly VideoRetimeExportTopologyLayer[];
}

export interface CapturedVideoRetimeExportInput {
	readonly sampleStart: number;
	readonly sampleDuration: number;
	readonly sampleEnd: number;
	readonly sampleRate: number;
	readonly sequenceBinding: Readonly<{ id: string; rate: RationalRate }>;
	readonly outputRate?: RationalRate;
	readonly topology: readonly VideoRetimeExportTopologyInterval[];
	readonly canonicalClips: readonly unknown[];
	readonly topologyRecordCount: number;
}

export function captureVideoRetimeExportInput(value: unknown): CapturedVideoRetimeExportInput {
	const raw = closedRecord(value, 'video retime export input', [
		'sampleStart', 'sampleDuration', 'sampleRate', 'sequenceBinding', 'topology', 'canonicalClips',
	], ['outputRate']);
	const sampleStart = nonNegativeSafeInteger(raw.sampleStart, 'video retime export sampleStart');
	const sampleDuration = positiveSafeInteger(raw.sampleDuration, 'video retime export sampleDuration');
	const sampleEnd = videoRetimeExportSafeAdd(sampleStart, sampleDuration, 'video retime export sample range');
	const sampleRate = positiveSafeInteger(raw.sampleRate, 'video retime export sampleRate');
	const sequence = closedRecord(raw.sequenceBinding, 'video retime export sequenceBinding', ['id', 'rate']);
	const sequenceBinding = Object.freeze({
		id: nonEmptyString(sequence.id, 'video retime export sequenceBinding.id'),
		rate: rationalRate(sequence.rate, 'video retime export sequenceBinding.rate'),
	});
	const outputRate = Object.hasOwn(raw, 'outputRate')
		? rationalRate(raw.outputRate, 'video retime export outputRate')
		: undefined;
	let topologyRecordCount = 0;
	const chargeTopology = (): void => {
		topologyRecordCount += 1;
		if (topologyRecordCount > VIDEO_RETIME_EXPORT_MAXIMUM_TOPOLOGY_RECORDS) {
			throw new RangeError('Video retime export topology records exceed their limit.');
		}
	};
	let expectedStart = sampleStart;
	const topology = denseArray(
		raw.topology,
		'video retime export topology',
		VIDEO_RETIME_EXPORT_MAXIMUM_TOPOLOGY_RECORDS,
	).map((candidate, intervalIndex) => {
		chargeTopology();
		const interval = closedRecord(candidate, `video retime export topology[${String(intervalIndex)}]`, [
			'startSample', 'endSample', 'layers',
		]);
		const startSample = nonNegativeSafeInteger(interval.startSample, 'video retime export topology start');
		const endSample = positiveSafeInteger(interval.endSample, 'video retime export topology end');
		if (startSample !== expectedStart || endSample <= startSample || endSample > sampleEnd) {
			throw new RangeError('Video retime export topology must contiguously partition its sample range.');
		}
		expectedStart = endSample;
		const layers = denseArray(
			interval.layers,
			'video retime export topology layers',
			VIDEO_RETIME_EXPORT_MAXIMUM_TOPOLOGY_RECORDS - topologyRecordCount,
		).map((layerValue) => {
			chargeTopology();
			const layer = closedRecord(layerValue, 'video retime export topology layer', ['clips']);
			const clips = denseArray(
				layer.clips,
				'video retime export topology clips',
				VIDEO_RETIME_EXPORT_MAXIMUM_TOPOLOGY_RECORDS - topologyRecordCount,
			).map((clipValue) => {
				chargeTopology();
				const clip = closedRecord(clipValue, 'video retime export topology clip', ['clipId']);
				return Object.freeze({ clipId: nonEmptyString(clip.clipId, 'video retime export clipId') });
			});
			return Object.freeze({ clips: Object.freeze(clips) });
		});
		return Object.freeze({ startSample, endSample, layers: Object.freeze(layers) });
	});
	if (topology.length === 0 || expectedStart !== sampleEnd) {
		throw new RangeError('Video retime export topology must cover its whole sample range.');
	}
	return Object.freeze({
		sampleStart, sampleDuration, sampleEnd, sampleRate, sequenceBinding,
		...(outputRate ? { outputRate } : {}),
		topology: Object.freeze(topology),
		canonicalClips: denseArray(
			raw.canonicalClips,
			'video retime export canonicalClips',
			VIDEO_RETIME_EXPORT_MAXIMUM_TOPOLOGY_RECORDS,
		),
		topologyRecordCount,
	});
}

export function videoRetimeExportOutputBoundary(
	sample: number,
	cadence: VideoRetimeOutputCadence,
): number {
	if (sample <= cadence.sampleStart) return 0;
	const end = videoRetimeExportSafeAdd(
		cadence.sampleStart,
		cadence.sampleDuration,
		'video retime cadence range',
	);
	if (sample >= end) return cadence.outputFrameCount;
	const numerator = BigInt(sample - cadence.sampleStart) * BigInt(cadence.outputRate.num);
	const denominator = BigInt(cadence.sampleRate) * BigInt(cadence.outputRate.den);
	return Math.min(cadence.outputFrameCount, Number((numerator + denominator - 1n) / denominator));
}

export function videoRetimeInterpolateSourceTime(
	start: ExactSourceTime,
	end: ExactSourceTime,
	sample: number,
	clipStart: number,
	clipEnd: number,
): ExactSourceTime {
	const progress = normalizeExact(BigInt(sample - clipStart), BigInt(clipEnd - clipStart));
	return addExact(start, multiplyExact(subtractExact(end, start), progress));
}

export function videoRetimeExportDecimal(value: ExactSourceTime): DecimalExactRationalV6 {
	if (value.denominator <= 0n
		|| greatestCommonDivisor(absolute(value.numerator), value.denominator) !== 1n
		|| bitLength(value.numerator) > MAXIMUM_EXACT_BITS
		|| bitLength(value.denominator) > MAXIMUM_EXACT_BITS) {
		throw new RangeError('Video retime export exact rational is not canonical and bounded.');
	}
	return Object.freeze({ numerator: value.numerator.toString(), denominator: value.denominator.toString() });
}

export function videoRetimeExportDecimalTokenBytes(value: unknown): number {
	if (!value || typeof value !== 'object') return 0;
	if (Array.isArray(value)) {
		return value.reduce((sum: number, entry) => sum + videoRetimeExportDecimalTokenBytes(entry), 0);
	}
	const record = value as Record<string, unknown>;
	if (typeof record.numerator === 'string' && typeof record.denominator === 'string'
		&& Reflect.ownKeys(record).length === 2) {
		return videoRetimeJsonStringTokenByteLength(record.numerator)
			+ videoRetimeJsonStringTokenByteLength(record.denominator);
	}
	return Object.values(record).reduce(
		(sum: number, entry) => sum + videoRetimeExportDecimalTokenBytes(entry),
		0,
	);
}

export function videoRetimeExportPosition(value: number): ExactSourcePosition {
	return Object.freeze({ numerator: BigInt(value), denominator: 1n });
}

export function videoRetimeExportSafeAdd(left: number, right: number, name: string): number {
	const result = BigInt(left) + BigInt(right);
	if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return Number(result);
}

export function videoRetimeExportRequired<Value>(value: Value | null | undefined): Value {
	if (value == null) throw new RangeError('Expected a bounded video retime export value.');
	return value;
}

function addExact(left: ExactSourceTime, right: ExactSourceTime): ExactSourceTime {
	return normalizeExact(
		left.numerator * right.denominator + right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function subtractExact(left: ExactSourceTime, right: ExactSourceTime): ExactSourceTime {
	return normalizeExact(
		left.numerator * right.denominator - right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function multiplyExact(left: ExactSourceTime, right: ExactSourceTime): ExactSourceTime {
	const leftCancellation = greatestCommonDivisor(absolute(left.numerator), right.denominator);
	const rightCancellation = greatestCommonDivisor(absolute(right.numerator), left.denominator);
	return normalizeExact(
		(left.numerator / leftCancellation) * (right.numerator / rightCancellation),
		(left.denominator / rightCancellation) * (right.denominator / leftCancellation),
	);
}

function normalizeExact(numerator: bigint, denominator: bigint): ExactSourceTime {
	if (denominator === 0n) throw new RangeError('Video retime export exact denominator cannot be zero.');
	if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
	const divisor = greatestCommonDivisor(absolute(numerator), denominator);
	const result = Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
	if (bitLength(result.numerator) > MAXIMUM_EXACT_BITS
		|| bitLength(result.denominator) > MAXIMUM_EXACT_BITS) {
		throw new RangeError('Video retime export exact rational exceeds 4096 bits.');
	}
	return result;
}

function closedRecord(
	value: unknown,
	name: string,
	requiredKeys: readonly string[],
	optionalKeys: readonly string[] = [],
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a closed plain data record.`);
	}
	const source = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(source);
	const allowed = new Set([...requiredKeys, ...optionalKeys]);
	if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))
		|| requiredKeys.some((key) => !keys.includes(key))) {
		throw new TypeError(`${name} has an invalid closed shape.`);
	}
	const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(source, key);
		if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${String(key)} must be an enumerable data property.`);
		}
		result[key] = descriptor.value;
	}
	return Object.freeze(result);
}

function denseArray(value: unknown, name: string, maximumLength = Number.MAX_SAFE_INTEGER): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must be a standard dense data array.`);
	}
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, 'value')
		? lengthDescriptor.value : null;
	if (!Number.isSafeInteger(length) || Number(length) < 0) throw new TypeError(`${name} has an invalid length.`);
	if (Number(length) > maximumLength) {
		throw new RangeError(`${name} exceeds the video retime export 16384 record limit.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== Number(length) + 1 || !keys.includes('length')) {
		throw new TypeError(`${name} must be dense and carry no extra keys.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < Number(length); index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must contain enumerable data elements.`);
		}
		result.push(descriptor.value);
	}
	return Object.freeze(result);
}

function rationalRate(value: unknown, name: string): RationalRate {
	const record = closedRecord(value, name, ['num', 'den']);
	const num = positiveSafeInteger(record.num, `${name}.num`);
	const den = positiveSafeInteger(record.den, `${name}.den`);
	if (greatestCommonDivisor(BigInt(num), BigInt(den)) !== 1n) throw new RangeError(`${name} must be reduced.`);
	return Object.freeze({ num, den });
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result < 0) throw new RangeError(`${name} must be non-negative.`);
	return result;
}

function positiveSafeInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result <= 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function safeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`);
	return Number(value);
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be non-empty.`);
	return value;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	while (right !== 0n) { const remainder = left % right; left = right; right = remainder; }
	return left || 1n;
}

function absolute(value: bigint): bigint { return value < 0n ? -value : value; }
function bitLength(value: bigint): number { return absolute(value).toString(2).length; }
