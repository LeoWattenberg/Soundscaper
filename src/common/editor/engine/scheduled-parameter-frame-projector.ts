/* SPDX-License-Identifier: AGPL-3.0-only */

import { roundRational } from '../timeline-time.ts';

/** One message window owns a single exact conversion ratio; callers retain frame validation. */
export function createScheduledParameterContextFrameProjector(
	fromFrame: number,
	sampleRate: number,
	contextSampleRate: number,
	transportRate: number,
	latencyFrames: number,
): (frame: number) => number {
	const normalizedFromFrame = nonNegativeSafeInteger(fromFrame, 'fromFrame');
	const normalizedSampleRate = positiveSafeInteger(sampleRate, 'sampleRate');
	const normalizedContextSampleRate = positiveSafeInteger(contextSampleRate, 'contextSampleRate');
	const normalizedTransportRate = positiveFiniteNumber(transportRate, 'transportRate');
	const normalizedLatencyFrames = nonNegativeSafeInteger(latencyFrames, 'latencyFrames');
	return prepareFrameProjector(normalizedFromFrame, normalizedSampleRate, normalizedContextSampleRate, normalizedTransportRate, normalizedLatencyFrames);
}

function prepareFrameProjector(
	normalizedFromFrame: number,
	normalizedSampleRate: number,
	normalizedContextSampleRate: number,
	normalizedTransportRate: number,
	normalizedLatencyFrames: number,
): (frame: number) => number {
	const transport = canonicalPositiveNumberRatio(normalizedTransportRate);
	const numeratorFactor = BigInt(normalizedContextSampleRate) * transport.denominator;
	const denominator = BigInt(normalizedSampleRate) * transport.numerator;
	return frame => {
		const normalizedFrame = nonNegativeSafeInteger(frame, 'frame');
		if (normalizedFrame < normalizedFromFrame) throw new RangeError('A parameter frame offset is unsafe.');
		let roundedOffset: number;
		try {
			roundedOffset = roundRational(BigInt(normalizedFrame - normalizedFromFrame) * numeratorFactor, denominator, 'point');
		} catch (error) {
			if (error instanceof RangeError) throw new RangeError('A parameter frame offset is unsafe.');
			throw error;
		}
		const offset = normalizedLatencyFrames + roundedOffset;
		if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError('A parameter frame offset is unsafe.');
		return offset;
	};
}

/** Preserve the standalone conversion's original validation order and exact half-tie ownership. */
export function roundScheduledParameterContextFrameOffset(
	frame: number,
	fromFrame: number,
	sampleRate: number,
	contextSampleRate: number,
	transportRate: number,
	latencyFrames: number,
): number {
	const normalizedFrame = nonNegativeSafeInteger(frame, 'frame');
	const normalizedFromFrame = nonNegativeSafeInteger(fromFrame, 'fromFrame');
	const normalizedSampleRate = positiveSafeInteger(sampleRate, 'sampleRate');
	const normalizedContextSampleRate = positiveSafeInteger(contextSampleRate, 'contextSampleRate');
	const normalizedTransportRate = positiveFiniteNumber(transportRate, 'transportRate');
	const normalizedLatencyFrames = nonNegativeSafeInteger(latencyFrames, 'latencyFrames');
	if (normalizedFrame < normalizedFromFrame) throw new RangeError('A parameter frame offset is unsafe.');
	return prepareFrameProjector(normalizedFromFrame, normalizedSampleRate, normalizedContextSampleRate, normalizedTransportRate, normalizedLatencyFrames)(normalizedFrame);
}

function canonicalPositiveNumberRatio(value: number): Readonly<{ numerator: bigint; denominator: bigint }> {
	if (Number.isSafeInteger(value)) return { numerator: BigInt(value), denominator: 1n };
	const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(value.toString());
	if (!match) throw new RangeError('A transport rate cannot be represented as a finite ratio.');
	const decimals = match[2] ?? '';
	const exponent = Number(match[3] ?? 0) - decimals.length;
	let numerator = BigInt(`${match[1]}${decimals}`);
	let denominator = 1n;
	if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
	else denominator = 10n ** BigInt(-exponent);
	return { numerator, denominator };
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return value;
}
function positiveSafeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return value;
}
function positiveFiniteNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
	if (!(value > 0)) throw new RangeError(`${name} must be positive.`);
	return value;
}
