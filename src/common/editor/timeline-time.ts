/* SPDX-License-Identifier: AGPL-3.0-only */

import { requiredArrayEntry } from './required-array-entry.ts';
import {
	roundingPolicy,
	type TimeRoundingDirection,
	type TimeRoundingPolicy,
} from './timeline-rounding-policy.ts';

export type { TimeRoundingDirection, TimeRoundingPolicy } from './timeline-rounding-policy.ts';

declare const sampleFrameBrand: unique symbol;
declare const videoFrameBrand: unique symbol;
declare const sourceTicksBrand: unique symbol;

export type SampleFrame = number & { readonly [sampleFrameBrand]: 'SampleFrame' };
export type VideoFrame = number & { readonly [videoFrameBrand]: 'VideoFrame' };
export type SourceTicks = number & { readonly [sourceTicksBrand]: 'SourceTicks' };
export interface Rational { readonly num: number; readonly den: number }
export type RationalInput = Rational | number;
export interface RationalRate { readonly num: number; readonly den: number }
export interface HoldTempoEvent {
	readonly beat: Rational;
	readonly bpm: Rational;
	readonly samplePosition?: SampleFrame;
}
export interface HoldTempoMap {
	readonly mode: 'musical' | 'sampleLocked';
	readonly events: readonly HoldTempoEvent[];
}
export type BreakpointMode = 'forward' | 'freeze' | 'reverse';
export interface Breakpoint {
	readonly outer: RationalInput;
	readonly source: RationalInput;
	readonly mode: BreakpointMode;
}
export interface BreakpointMap {
	readonly feature: 'audio-warp' | 'video-retime';
	readonly points: readonly Breakpoint[];
}
interface BigFraction {
	readonly numerator: bigint;
	readonly denominator: bigint;
}
const MAX_BREAKPOINTS = 4_096;
const MAX_RATIONAL_DENOMINATOR = 1_000_000;
export function normalizeRational(
	value: RationalInput,
	options: Readonly<{ maximumDenominator?: number }> = {},
): Rational {
	const maximumDenominator = positiveSafeInteger(
		options.maximumDenominator ?? MAX_RATIONAL_DENOMINATOR,
		'maximumDenominator',
	);
	const fraction = bigFraction(value);
	const result = publicRational(fraction);
	if (result.den > maximumDenominator) {
		throw new RangeError(`Rational denominator exceeds ${String(maximumDenominator)}.`);
	}
	return result;
}
export function addRationals(left: RationalInput, right: RationalInput): Rational {
	return publicRational(addFractions(bigFraction(left), bigFraction(right)));
}
export function subtractRationals(left: RationalInput, right: RationalInput): Rational {
	return publicRational(subtractFractions(bigFraction(left), bigFraction(right)));
}
export function multiplyRationals(left: RationalInput, right: RationalInput): Rational {
	return publicRational(multiplyFractions(bigFraction(left), bigFraction(right)));
}
export function divideRationals(left: RationalInput, right: RationalInput): Rational {
	const divisor = bigFraction(right);
	if (divisor.numerator === 0n) throw new RangeError('Cannot divide by zero.');
	return publicRational(multiplyFractions(bigFraction(left), {
		numerator: divisor.denominator,
		denominator: divisor.numerator,
	}));
}
export function multiplyDivideRationals(left: RationalInput, right: RationalInput, divisor: RationalInput): Rational {
	return publicRational(divideFractions(multiplyFractions(bigFraction(left), bigFraction(right)), bigFraction(divisor))); }
export function addMultiplyDivideRationals(addend: RationalInput, left: RationalInput, right: RationalInput, divisor: RationalInput): Rational {
	return publicRational(addFractions(bigFraction(addend), divideFractions(multiplyFractions(bigFraction(left), bigFraction(right)), bigFraction(divisor)))); }
export function compareRationalSum(left: RationalInput, right: RationalInput, target: RationalInput): -1 | 0 | 1 { const difference = subtractFractions(addFractions(bigFraction(left), bigFraction(right)), bigFraction(target)); return difference.numerator < 0n ? -1 : difference.numerator > 0n ? 1 : 0; }
export function compareRationals(left: RationalInput, right: RationalInput): -1 | 0 | 1 {
	const a = bigFraction(left);
	const b = bigFraction(right);
	const difference = a.numerator * b.denominator - b.numerator * a.denominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
/** Round an exact integer ratio under an explicitly named timeline policy. */
export function roundRational(
	numerator: number | bigint,
	denominator: number | bigint,
	policy: TimeRoundingPolicy,
	direction?: TimeRoundingDirection,
): number {
	const normalizedPolicy = roundingPolicy(policy, direction);
	if (typeof numerator === 'number' && typeof denominator === 'number') {
		const safeNumerator = safeInteger(numerator, 'numerator');
		const safeDenominator = nonZeroSafeInteger(denominator, 'denominator');
		return safeRoundedResult(roundNumberRatio(safeNumerator, safeDenominator, normalizedPolicy));
	}
	const bigNumerator = typeof numerator === 'bigint' ? numerator : BigInt(safeInteger(numerator, 'numerator'));
	const bigDenominator = typeof denominator === 'bigint' ? denominator : BigInt(nonZeroSafeInteger(denominator, 'denominator'));
	return safeRoundedResult(Number(roundBigIntRatio(bigNumerator, bigDenominator, normalizedPolicy)));
}
export function secondsToSampleFrame(
	seconds: RationalInput,
	sampleRate: number,
	policy: TimeRoundingPolicy = 'point',
	direction?: TimeRoundingDirection,
): SampleFrame {
	const rate = positiveSafeInteger(sampleRate, 'sampleRate');
	const numericSeconds = typeof seconds === 'number' ? finiteNumber(seconds, 'seconds') : null;
	const frames = multiplyFractions(bigFraction(numericSeconds ?? seconds), bigFraction(rate));
	if (numericSeconds !== null) {
		const scaled = numericSeconds * rate;
		if (!Number.isFinite(scaled) || Math.abs(scaled) > Number.MAX_SAFE_INTEGER) throw new RangeError('The resolved timeline value is outside the safe integer range.');
	}
	// A number is an exact binary rational, so the exact product decides every
	// policy: rounding the floating product instead can land one sample away
	// from the identical value given as its equal Rational.
	return fractionToInteger(frames, policy, direction) as SampleFrame;
}
export function sampleFrameToSeconds(frame: SampleFrame | number, sampleRate: number): number {
	return safeInteger(frame, 'frame') / positiveSafeInteger(sampleRate, 'sampleRate');
}
export function scaleSampleFrame(
	frame: SampleFrame | number,
	inputSampleRate: number,
	outputSampleRate: number,
	policy: TimeRoundingPolicy = 'point',
	direction?: TimeRoundingDirection,
): SampleFrame {
	return evaluateIntegerRatio(
		[safeInteger(frame, 'frame'), positiveSafeInteger(outputSampleRate, 'outputSampleRate')],
		[positiveSafeInteger(inputSampleRate, 'inputSampleRate')],
		policy,
		direction,
	) as SampleFrame;
}
export function videoFrameToSampleFrame(
	frame: VideoFrame | number,
	rate: RationalRate,
	sampleRate: number,
	policy: TimeRoundingPolicy = 'point',
	direction?: TimeRoundingDirection,
): SampleFrame {
	const normalizedRate = normalizeRate(rate);
	return evaluateIntegerRatio(
		[
			safeInteger(frame, 'videoFrame'),
			normalizedRate.den,
			positiveSafeInteger(sampleRate, 'sampleRate'),
		],
		[normalizedRate.num],
		policy,
		direction,
	) as SampleFrame;
}
export function sampleFrameToVideoFrame(
	frame: SampleFrame | number,
	rate: RationalRate,
	sampleRate: number,
	policy: TimeRoundingPolicy = 'point',
	direction?: TimeRoundingDirection,
): VideoFrame {
	const normalizedRate = normalizeRate(rate);
	return evaluateIntegerRatio(
		[safeInteger(frame, 'sampleFrame'), normalizedRate.num],
		[normalizedRate.den, positiveSafeInteger(sampleRate, 'sampleRate')],
		policy,
		direction,
	) as VideoFrame;
}
export function videoFrameRangeToSampleRange(
	startFrame: VideoFrame | number,
	frameCount: number,
	rate: RationalRate,
	sampleRate: number,
): Readonly<{ startFrame: SampleFrame; endFrame: SampleFrame; durationFrames: number }> {
	const start = safeInteger(startFrame, 'startFrame');
	const count = nonNegativeSafeInteger(frameCount, 'frameCount');
	const end = safeSum(start, count, 'video frame range');
	const resolvedStart = videoFrameToSampleFrame(start, rate, sampleRate, 'point');
	const resolvedEnd = videoFrameToSampleFrame(end, rate, sampleRate, 'point');
	return Object.freeze({
		startFrame: resolvedStart,
		endFrame: resolvedEnd,
		durationFrames: resolvedEnd - resolvedStart,
	});
}
export function composeRationalRates(...rates: readonly RationalRate[]): RationalRate {
	if (!rates.length) throw new TypeError('At least one rational rate is required.');
	let result: BigFraction = { numerator: 1n, denominator: 1n };
	for (const rate of rates) {
		const normalized = normalizeRate(rate);
		result = multiplyFractions(result, {
			numerator: BigInt(normalized.num),
			denominator: BigInt(normalized.den),
		});
	}
	const composed = publicRational(result);
	if (composed.num <= 0) throw new RangeError('A composed rate must be positive.');
	return composed;
}
/** Resolve a beat through a hold-only tempo map and round once at the origin. */
export function beatToSampleFrame(
	beat: RationalInput,
	tempoMap: HoldTempoMap,
	sampleRate: number,
	policy: TimeRoundingPolicy = 'point',
): SampleFrame {
	const rate = positiveSafeInteger(sampleRate, 'sampleRate');
	const target = bigFraction(beat);
	const events = normalizeTempoEvents(tempoMap);
	if (tempoMap.mode === 'sampleLocked') return sampleLockedBeatToFrame(target, events, rate, policy);
	let position: BigFraction = { numerator: 0n, denominator: 1n };
	const firstEvent = requiredArrayEntry(events, 0, 'tempo map');
	let eventBeat = bigFraction(firstEvent.beat);
	let tempo = bigFraction(firstEvent.bpm);
	if (compareFractions(target, eventBeat) < 0) {
		return fractionToInteger(tempoSegmentSamples(target, eventBeat, tempo, rate), policy) as SampleFrame;
	}
	for (let index = 1; index < events.length; index += 1) {
		const event = requiredArrayEntry(events, index, 'tempo map');
		const nextBeat = bigFraction(event.beat);
		if (compareFractions(target, nextBeat) <= 0) {
			position = addFractions(position, tempoSegmentSamples(target, eventBeat, tempo, rate));
			return fractionToInteger(position, policy) as SampleFrame;
		}
		position = addFractions(position, tempoSegmentSamples(nextBeat, eventBeat, tempo, rate));
		eventBeat = nextBeat;
		tempo = bigFraction(event.bpm);
	}
	position = addFractions(position, tempoSegmentSamples(target, eventBeat, tempo, rate));
	return fractionToInteger(position, policy) as SampleFrame;
}
export function countInSampleFrames(
	measureCount: number,
	tempo: Readonly<{
		bpm: RationalInput;
		timeSignature: Readonly<{ numerator: number; denominator: number }>;
	}>,
	sampleRate: number,
): SampleFrame {
	const measures = nonNegativeSafeInteger(measureCount, 'measureCount');
	const numerator = positiveSafeInteger(tempo.timeSignature.numerator, 'timeSignature.numerator');
	const denominator = positiveSafeInteger(tempo.timeSignature.denominator, 'timeSignature.denominator');
	const denominatorBits = BigInt(denominator);
	if ((denominatorBits & (denominatorBits - 1n)) !== 0n) {
		throw new RangeError('timeSignature.denominator must be a power of two.');
	}
	const quarterBeats = normalizeBigFraction(
		BigInt(measures) * BigInt(numerator) * 4n,
		BigInt(denominator),
	);
	const samples = tempoSegmentSamples(quarterBeats, { numerator: 0n, denominator: 1n }, bigFraction(tempo.bpm), sampleRate);
	return fractionToInteger(samples, 'point') as SampleFrame;
}

export function validateBreakpointMap(map: BreakpointMap): true {
	if (!map || typeof map !== 'object' || !['audio-warp', 'video-retime'].includes(map.feature)) {
		throw new TypeError('A breakpoint map with a supported feature is required.');
	}
	if (!Array.isArray(map.points) || map.points.length < 2 || map.points.length > MAX_BREAKPOINTS) {
		throw new RangeError(`A breakpoint map requires 2 through ${String(MAX_BREAKPOINTS)} points.`);
	}
	const points = map.points.map((point, index) => normalizeBreakpoint(point, index));
	for (let index = 0; index < points.length - 1; index += 1) {
		const point = requiredArrayEntry(points, index, 'breakpoint map');
		const next = requiredArrayEntry(points, index + 1, 'breakpoint map');
		if (compareFractions(point.outer, next.outer) >= 0) {
			throw new RangeError('Breakpoint outer positions must be strictly increasing.');
		}
		const sourceDirection = compareFractions(next.source, point.source);
		if (map.feature === 'audio-warp') {
			if (point.mode !== 'forward' || sourceDirection <= 0) {
				throw new RangeError('Audio warp source positions must be strictly increasing in forward segments.');
			}
			continue;
		}
		if ((point.mode === 'forward' && sourceDirection <= 0)
			|| (point.mode === 'freeze' && sourceDirection !== 0)
			|| (point.mode === 'reverse' && sourceDirection >= 0)) {
			throw new RangeError(`Video retime ${point.mode} segment direction does not match its source positions.`);
		}
	}
	return true;
}
export function evaluateBreakpointMap(map: BreakpointMap, outer: RationalInput): Rational {
	validateBreakpointMap(map);
	const target = bigFraction(outer);
	const points = map.points.map((point, index) => normalizeBreakpoint(point, index));
	const first = requiredArrayEntry(points, 0, 'breakpoint map');
	if (compareFractions(target, first.outer) <= 0) return publicRational(first.source);
	const last = requiredArrayEntry(points, points.length - 1, 'breakpoint map');
	if (compareFractions(target, last.outer) >= 0) return publicRational(last.source);
	for (let index = 0; index < points.length - 1; index += 1) {
		const start = requiredArrayEntry(points, index, 'breakpoint map');
		const end = requiredArrayEntry(points, index + 1, 'breakpoint map');
		if (compareFractions(target, end.outer) > 0) continue;
		if (start.mode === 'freeze') return publicRational(start.source);
		const outerOffset = subtractFractions(target, start.outer);
		const outerSpan = subtractFractions(end.outer, start.outer);
		const sourceSpan = subtractFractions(end.source, start.source);
		const interpolation = multiplyFractions(outerOffset, divideFractions(sourceSpan, outerSpan));
		return publicRational(addFractions(start.source, interpolation));
	}
	throw new RangeError('The breakpoint position could not be evaluated.');
}
function normalizeTempoEvents(tempoMap: HoldTempoMap): readonly HoldTempoEvent[] {
	if (!tempoMap || typeof tempoMap !== 'object' || !['musical', 'sampleLocked'].includes(tempoMap.mode)) {
		throw new TypeError('A hold tempo map is required.');
	}
	if (!Array.isArray(tempoMap.events) || !tempoMap.events.length || tempoMap.events.length > MAX_BREAKPOINTS) {
		throw new RangeError('A tempo map requires a bounded non-empty event list.');
	}
	let previous: BigFraction | null = null;
	for (const [index, event] of tempoMap.events.entries()) {
		const beat = bigFraction(event.beat);
		const bpm = bigFraction(event.bpm);
		if (bpm.numerator <= 0n) throw new RangeError(`tempoMap.events[${String(index)}].bpm must be positive.`);
		if (previous && compareFractions(previous, beat) >= 0) {
			throw new RangeError('Tempo event beats must be strictly increasing.');
		}
		if (tempoMap.mode === 'sampleLocked' && !Number.isSafeInteger(event.samplePosition)) {
			throw new RangeError('Sample-locked tempo events require safe integer sample positions.');
		}
		previous = beat;
	}
	if (compareFractions(bigFraction(requiredArrayEntry(tempoMap.events, 0, 'tempo map').beat), { numerator: 0n, denominator: 1n }) !== 0) {
		throw new RangeError('The first tempo event must begin at beat zero.');
	}
	return tempoMap.events;
}
function sampleLockedBeatToFrame(
	target: BigFraction,
	events: readonly HoldTempoEvent[],
	sampleRate: number,
	policy: TimeRoundingPolicy,
): SampleFrame {
	let active = requiredArrayEntry(events, 0, 'tempo map');
	for (let index = 1; index < events.length; index += 1) {
		const event = requiredArrayEntry(events, index, 'tempo map');
		if (compareFractions(target, bigFraction(event.beat)) < 0) break;
		active = event;
	}
	const relative = tempoSegmentSamples(target, bigFraction(active.beat), bigFraction(active.bpm), sampleRate);
	const absolute = addFractions(bigFraction(active.samplePosition ?? 0), relative);
	return fractionToInteger(absolute, policy) as SampleFrame;
}
function tempoSegmentSamples(
	endBeat: BigFraction,
	startBeat: BigFraction,
	bpm: BigFraction,
	sampleRate: number,
): BigFraction {
	const beatSpan = subtractFractions(endBeat, startBeat);
	const samplesPerMinute = multiplyFractions(
		bigFraction(60),
		bigFraction(positiveSafeInteger(sampleRate, 'sampleRate')),
	);
	return multiplyFractions(beatSpan, divideFractions(samplesPerMinute, bpm));
}

function normalizeBreakpoint(point: Breakpoint, index: number): Readonly<{
	outer: BigFraction;
	source: BigFraction;
	mode: BreakpointMode;
}> {
	if (!point || typeof point !== 'object' || !['forward', 'freeze', 'reverse'].includes(point.mode)) {
		throw new TypeError(`breakpoint[${String(index)}] is invalid.`);
	}
	return Object.freeze({
		outer: bigFraction(point.outer),
		source: bigFraction(point.source),
		mode: point.mode,
	});
}

function normalizeRate(rate: RationalRate): RationalRate {
	if (!rate || typeof rate !== 'object') throw new TypeError('A rational rate is required.');
	const normalized = normalizeRational(rate, { maximumDenominator: Number.MAX_SAFE_INTEGER });
	if (normalized.num <= 0) throw new RangeError('A rational rate must be positive.');
	return normalized;
}

function evaluateIntegerRatio(
	numeratorFactors: readonly number[],
	denominatorFactors: readonly number[],
	policy: TimeRoundingPolicy,
	direction?: TimeRoundingDirection,
): number {
	const numerators = numeratorFactors.map((factor, index) => safeInteger(factor, `numeratorFactors[${String(index)}]`));
	const denominators = denominatorFactors.map((factor, index) => positiveSafeInteger(factor, `denominatorFactors[${String(index)}]`));
	let sign = 1;
	for (const [index, numerator] of numerators.entries()) {
		if (numerator < 0) sign *= -1;
		numerators[index] = Math.abs(numerator);
	}
	for (let numeratorIndex = 0; numeratorIndex < numerators.length; numeratorIndex += 1) {
		for (let denominatorIndex = 0; denominatorIndex < denominators.length; denominatorIndex += 1) {
			const numerator = requiredArrayEntry(numerators, numeratorIndex, 'integer-ratio numerator');
			const denominator = requiredArrayEntry(denominators, denominatorIndex, 'integer-ratio denominator');
			const divisor = gcdNumber(numerator, denominator);
			numerators[numeratorIndex] = numerator / divisor;
			denominators[denominatorIndex] = denominator / divisor;
		}
	}
	const numberNumerator = safeProduct(numerators);
	const numberDenominator = safeProduct(denominators);
	if (numberNumerator != null && numberDenominator != null) {
		return roundRational(sign * numberNumerator, numberDenominator, policy, direction);
	}
	const bigNumerator = numerators.reduce((product, factor) => product * BigInt(factor), BigInt(sign));
	const bigDenominator = denominators.reduce((product, factor) => product * BigInt(factor), 1n);
	return roundRational(bigNumerator, bigDenominator, policy, direction);
}

function roundNumberRatio(
	numerator: number,
	denominator: number,
	policy: 'point' | 'floor' | 'ceil',
): number {
	if (denominator < 0) return roundNumberRatio(-numerator, -denominator, policy);
	const quotient = Math.trunc(numerator / denominator);
	const remainder = numerator - quotient * denominator;
	if (!remainder) return quotient;
	if (policy === 'floor') return numerator < 0 ? quotient - 1 : quotient;
	if (policy === 'ceil') return numerator > 0 ? quotient + 1 : quotient;
	return Math.abs(remainder) * 2 >= denominator ? quotient + Math.sign(numerator) : quotient;
}

function roundBigIntRatio(
	numerator: bigint,
	denominator: bigint,
	policy: 'point' | 'floor' | 'ceil',
): bigint {
	if (denominator === 0n) throw new RangeError('denominator cannot be zero.');
	if (denominator < 0n) return roundBigIntRatio(-numerator, -denominator, policy);
	const quotient = numerator / denominator;
	const remainder = numerator % denominator;
	if (remainder === 0n) return quotient;
	if (policy === 'floor') return numerator < 0n ? quotient - 1n : quotient;
	if (policy === 'ceil') return numerator > 0n ? quotient + 1n : quotient;
	return absoluteBigInt(remainder) * 2n >= denominator
		? quotient + (numerator < 0n ? -1n : 1n)
		: quotient;
}

function fractionToInteger(
	fraction: BigFraction,
	policy: TimeRoundingPolicy,
	direction?: TimeRoundingDirection,
): number {
	return roundRational(fraction.numerator, fraction.denominator, policy, direction);
}

function bigFraction(value: RationalInput): BigFraction {
	if (typeof value === 'number') return numberFraction(value);
	if (!value || typeof value !== 'object') throw new TypeError('A rational value is required.');
	return normalizeBigFraction(
		BigInt(safeInteger(value.num, 'rational.num')),
		BigInt(nonZeroSafeInteger(value.den, 'rational.den')),
	);
}

function numberFraction(value: number): BigFraction {
	const number = finiteNumber(value, 'rational');
	if (Number.isSafeInteger(number)) return { numerator: BigInt(number), denominator: 1n };
	const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(number.toString());
	if (!match) throw new RangeError('The number cannot be represented as a finite rational.');
	const sign = match[1] === '-' ? -1n : 1n;
	const decimals = match[3] ?? '';
	const exponent = Number(match[4] ?? 0) - decimals.length;
	let numerator = BigInt(`${match[2]}${decimals}`) * sign;
	let denominator = 1n;
	if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
	else denominator = 10n ** BigInt(-exponent);
	return normalizeBigFraction(numerator, denominator);
}

function normalizeBigFraction(numerator: bigint, denominator: bigint): BigFraction {
	if (denominator === 0n) throw new RangeError('A rational denominator cannot be zero.');
	if (denominator < 0n) {
		numerator = -numerator;
		denominator = -denominator;
	}
	const divisor = gcdBigInt(absoluteBigInt(numerator), denominator);
	return Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
}

function publicRational(value: BigFraction): Rational {
	const normalized = normalizeBigFraction(value.numerator, value.denominator);
	const num = Number(normalized.numerator);
	const den = Number(normalized.denominator);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) {
		throw new RangeError('The rational result is outside the safe integer domain.');
	}
	return Object.freeze({ num, den });
}

function addFractions(left: BigFraction, right: BigFraction): BigFraction {
	return normalizeBigFraction(
		left.numerator * right.denominator + right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function subtractFractions(left: BigFraction, right: BigFraction): BigFraction {
	return normalizeBigFraction(
		left.numerator * right.denominator - right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function multiplyFractions(left: BigFraction, right: BigFraction): BigFraction {
	const leftNumeratorDivisor = gcdBigInt(absoluteBigInt(left.numerator), right.denominator);
	const rightNumeratorDivisor = gcdBigInt(absoluteBigInt(right.numerator), left.denominator);
	return normalizeBigFraction(
		(left.numerator / leftNumeratorDivisor) * (right.numerator / rightNumeratorDivisor),
		(left.denominator / rightNumeratorDivisor) * (right.denominator / leftNumeratorDivisor),
	);
}

function divideFractions(left: BigFraction, right: BigFraction): BigFraction {
	if (right.numerator === 0n) throw new RangeError('Cannot divide by zero.');
	return multiplyFractions(left, {
		numerator: right.denominator,
		denominator: right.numerator,
	});
}

function compareFractions(left: BigFraction, right: BigFraction): -1 | 0 | 1 {
	const difference = left.numerator * right.denominator - right.numerator * left.denominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function safeProduct(factors: readonly number[]): number | null {
	let product = 1;
	for (const factor of factors) {
		if (factor && product > Number.MAX_SAFE_INTEGER / factor) return null;
		product *= factor;
	}
	return product;
}

function gcdNumber(left: number, right: number): number {
	left = Math.abs(left);
	right = Math.abs(right);
	while (right) [left, right] = [right, left % right];
	return left || 1;
}

function gcdBigInt(left: bigint, right: bigint): bigint {
	while (right) [left, right] = [right, left % right];
	return left || 1n;
}

function absoluteBigInt(value: bigint): bigint { return value < 0n ? -value : value; }
function safeRoundedResult(value: number): number {
	if (!Number.isSafeInteger(value)) throw new RangeError('The resolved timeline value is outside the safe integer range.'); return value;
}

function safeSum(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} is outside the safe integer range.`);
	return result;
}

function finiteNumber(value: number, name: string): number {
	if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
	return value;
}

function safeInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`);
	return value;
}

function nonNegativeSafeInteger(value: number, name: string): number {
	const result = safeInteger(value, name);
	if (result < 0) throw new RangeError(`${name} must be non-negative.`);
	return result;
}

function positiveSafeInteger(value: number, name: string): number {
	const result = safeInteger(value, name);
	if (result <= 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function nonZeroSafeInteger(value: number, name: string): number {
	const result = safeInteger(value, name);
	if (!result) throw new RangeError(`${name} cannot be zero.`);
	return result;
}
