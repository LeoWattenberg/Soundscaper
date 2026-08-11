/* SPDX-License-Identifier: AGPL-3.0-only */

import { sequenceFrameAtSample } from './sequence-frame-navigation.ts';
import type { RationalRate } from './timeline-time.ts';

const MAXIMUM_OUTPUT_FRAMES = 2_000_000;

export interface VideoRetimeOutputCadenceInput {
	readonly sampleStart: number;
	readonly sampleDuration: number;
	readonly sampleRate: number;
	readonly sequenceRate: RationalRate;
	readonly outputRate?: RationalRate;
}

export interface VideoRetimeOutputTime {
	readonly numerator: bigint;
	readonly denominator: bigint;
}

export interface VideoRetimeOutputFrame {
	readonly outputFrame: number;
	readonly relativePts: VideoRetimeOutputTime;
	readonly absoluteSample: number;
	readonly sequenceFrame: number;
}

export interface VideoRetimeOutputCadence {
	readonly sampleStart: number;
	readonly sampleDuration: number;
	readonly sampleRate: number;
	readonly sequenceRate: RationalRate;
	readonly outputRate: RationalRate;
	readonly outputFrameCount: number;
	readonly frameAt: (index: number) => VideoRetimeOutputFrame;
	readonly localCellAt: (
		index: number,
		sequenceStartFrame: number,
		outerFrameCount: number,
	) => number | null;
}

/** Convert one UI-owned integer rate into the strict rational cadence form. */
export function videoRetimeOutputRateFromInteger(rate: number): RationalRate {
	return Object.freeze({ num: positiveSafeInteger(rate, 'video retime output rate'), den: 1 });
}

/** Build one lazy output schedule whose phase is owned by a single global sample range. */
export function createVideoRetimeOutputCadence(
	inputValue: VideoRetimeOutputCadenceInput,
): VideoRetimeOutputCadence {
	const input = inputRecord(inputValue);
	const sampleStart = nonNegativeSafeInteger(input.sampleStart, 'video retime cadence sampleStart');
	const sampleDuration = positiveSafeInteger(input.sampleDuration, 'video retime cadence sampleDuration');
	const sampleRate = positiveSafeInteger(input.sampleRate, 'video retime cadence sampleRate');
	const sampleEnd = safeSum(sampleStart, sampleDuration, 'video retime cadence sample range');
	const sequenceRate = rationalRate(input.sequenceRate, 'video retime cadence sequenceRate');
	if (BigInt(sequenceRate.num) > BigInt(sequenceRate.den) * BigInt(sampleRate)) {
		throw new RangeError('The video retime sequence rate exceeds the unique sample-frame grid.');
	}
	const outputRate = Object.hasOwn(input, 'outputRate')
		? rationalRate(input.outputRate, 'video retime cadence outputRate')
		: sequenceRate;
	const countNumerator = BigInt(sampleDuration) * BigInt(outputRate.num);
	const countDenominator = BigInt(sampleRate) * BigInt(outputRate.den);
	const outputFrameCountBig = ceilingRatio(countNumerator, countDenominator);
	if (outputFrameCountBig < 1n || outputFrameCountBig > BigInt(MAXIMUM_OUTPUT_FRAMES)) {
		throw new RangeError(`Video retime output frame count must be between 1 and ${String(MAXIMUM_OUTPUT_FRAMES)}.`);
	}
	const outputFrameCount = Number(outputFrameCountBig);
	let cachedIndex: number | null = null;
	let cachedFrame: VideoRetimeOutputFrame | null = null;

	const frameAt = (indexValue: number): VideoRetimeOutputFrame => {
		const index = outputIndex(indexValue, outputFrameCount);
		if (cachedIndex === index && cachedFrame !== null) return cachedFrame;
		const indexBig = BigInt(index);
		const relativePts = exactTime(indexBig * BigInt(outputRate.den), BigInt(outputRate.num));
		const sampleOffset = indexBig * BigInt(sampleRate) * BigInt(outputRate.den)
			/ BigInt(outputRate.num);
		const absoluteSampleBig = BigInt(sampleStart) + sampleOffset;
		if (absoluteSampleBig < BigInt(sampleStart) || absoluteSampleBig >= BigInt(sampleEnd)
			|| absoluteSampleBig > BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new RangeError('A video retime output frame resolved outside its global sample range.');
		}
		const absoluteSample = Number(absoluteSampleBig);
		const frame = Object.freeze({
			outputFrame: index,
			relativePts,
			absoluteSample,
			sequenceFrame: sequenceFrameAtSample(absoluteSample, sequenceRate, sampleRate),
		});
		cachedIndex = index;
		cachedFrame = frame;
		return frame;
	};

	const localCellAt = (
		indexValue: number,
		sequenceStartFrameValue: number,
		outerFrameCountValue: number,
	): number | null => {
		const sequenceStartFrame = nonNegativeSafeInteger(
			sequenceStartFrameValue,
			'video retime clip sequenceStartFrame',
		);
		const outerFrameCount = positiveSafeInteger(
			outerFrameCountValue,
			'video retime clip outerFrameCount',
		);
		safeSum(sequenceStartFrame, outerFrameCount, 'video retime clip sequence range');
		const sequenceFrame = frameAt(indexValue).sequenceFrame;
		const localCell = BigInt(sequenceFrame) - BigInt(sequenceStartFrame);
		if (localCell < 0n || localCell >= BigInt(outerFrameCount)) return null;
		return Number(localCell);
	};

	return Object.freeze({
		sampleStart,
		sampleDuration,
		sampleRate,
		sequenceRate,
		outputRate,
		outputFrameCount,
		frameAt,
		localCellAt,
	});
}

function inputRecord(value: unknown): Record<string, unknown> {
	const input = closedDataRecord(
		value,
		'video retime output cadence input',
		['sampleStart', 'sampleDuration', 'sampleRate', 'sequenceRate'],
		['outputRate'],
	);
	return input;
}

function rationalRate(value: unknown, name: string): RationalRate {
	const rate = closedDataRecord(value, name, ['num', 'den']);
	const num = positiveSafeInteger(rate.num, `${name}.num`);
	const den = positiveSafeInteger(rate.den, `${name}.den`);
	if (greatestCommonDivisor(BigInt(num), BigInt(den)) !== 1n) {
		throw new RangeError(`${name} must be canonically reduced.`);
	}
	return Object.freeze({ num, den });
}

function closedDataRecord(
	value: unknown,
	name: string,
	requiredKeys: readonly string[],
	optionalKeys: readonly string[] = [],
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a closed data record.`);
	}
	const record = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(record);
	const allowed = new Set([...requiredKeys, ...optionalKeys]);
	if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))
		|| requiredKeys.some((key) => !keys.includes(key))) {
		throw new TypeError(`${name} has an invalid closed record shape.`);
	}
	const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${String(key)} must be an own enumerable data property, not an accessor.`);
		}
		snapshot[String(key)] = descriptor.value;
	}
	return Object.freeze(snapshot);
}

function exactTime(numerator: bigint, denominator: bigint): VideoRetimeOutputTime {
	if (denominator <= 0n) throw new RangeError('An exact output time denominator must be positive.');
	const divisor = greatestCommonDivisor(absoluteBigInt(numerator), denominator);
	return Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
}

function ceilingRatio(numerator: bigint, denominator: bigint): bigint {
	if (numerator < 0n || denominator <= 0n) throw new RangeError('A cadence ratio must be positive.');
	return (numerator + denominator - 1n) / denominator;
}

function outputIndex(value: unknown, outputFrameCount: number): number {
	const index = nonNegativeSafeInteger(value, 'video retime output frame index');
	if (index >= outputFrameCount) throw new RangeError('Video retime output frame index is outside its range.');
	return index;
}

function safeSum(left: number, right: number, name: string): number {
	const result = BigInt(left) + BigInt(right);
	if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return Number(result);
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

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	while (right !== 0n) {
		const remainder = left % right;
		left = right;
		right = remainder;
	}
	return left || 1n;
}

function absoluteBigInt(value: bigint): bigint {
	return value < 0n ? -value : value;
}
