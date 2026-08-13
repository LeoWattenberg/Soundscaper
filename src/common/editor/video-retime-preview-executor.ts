/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoRetimeFrameDescriptor } from './video-retime-frame-dispatch.ts';

const MAXIMUM_EXACT_BITS = 4_096;
const MODES = new Set([
	'constant-forward', 'constant-reverse', 'freeze', 'ramp-forward', 'ramp-reverse',
]);

export interface VideoRetimePreviewPresentationRequest {
	readonly drawableSourceFrame: number;
	readonly intervalStartSeconds: number;
	readonly intervalEndSeconds: number;
	readonly targetSeconds: number;
	readonly signal: AbortSignal;
}

export interface VideoRetimePreviewMediaPort {
	readonly pause: () => void;
	readonly assertCurrent: () => void;
	readonly present: (
		request: VideoRetimePreviewPresentationRequest,
	) => PromiseLike<Readonly<{ readonly mediaTime: number }>>;
}

/** Validate one exact descriptor and derive the interior HTML-media seek request. */
export function createVideoRetimePreviewPresentationRequest(
	descriptorValue: VideoRetimeFrameDescriptor,
	signalValue: AbortSignal,
): VideoRetimePreviewPresentationRequest {
	if (typeof AbortSignal === 'undefined' || !(signalValue instanceof AbortSignal)) {
		throw new TypeError('A video retime preview presentation request requires an AbortSignal.');
	}
	const prepared = prepareFrame(descriptorValue);
	return Object.freeze({
		drawableSourceFrame: prepared.descriptor.drawableSourceFrame,
		intervalStartSeconds: prepared.intervalStartSeconds,
		intervalEndSeconds: prepared.intervalEndSeconds,
		targetSeconds: prepared.targetSeconds,
		signal: signalValue,
	});
}

export type VideoRetimePreviewResult =
	| Readonly<{ readonly kind: 'presented' }>
	| Readonly<{ readonly kind: 'superseded' }>
	| Readonly<{ readonly kind: 'cancelled' }>;

export interface VideoRetimePreviewExecutor {
	readonly requestFrame: (
		descriptor: VideoRetimeFrameDescriptor,
	) => Promise<VideoRetimePreviewResult>;
	readonly cancel: () => void;
	readonly dispose: () => void;
}

interface ExactValue {
	readonly numerator: bigint;
	readonly denominator: bigint;
}

interface PreparedFrame {
	readonly key: string;
	readonly descriptor: VideoRetimeFrameDescriptor;
	readonly intervalStart: ExactValue;
	readonly intervalEnd: ExactValue;
	readonly intervalStartSeconds: number;
	readonly intervalEndSeconds: number;
	readonly targetSeconds: number;
}

interface Work {
	readonly key: string;
	readonly promise: Promise<VideoRetimePreviewResult>;
	readonly resolve: (result: VideoRetimePreviewResult) => void;
	readonly reject: (error: unknown) => void;
	latest: PreparedFrame;
	controller: AbortController | null;
	settled: boolean;
	cancelled: boolean;
}

const PRESENTED_RESULT = Object.freeze({ kind: 'presented' }) as VideoRetimePreviewResult;
const SUPERSEDED_RESULT = Object.freeze({ kind: 'superseded' }) as VideoRetimePreviewResult;
const CANCELLED_RESULT = Object.freeze({ kind: 'cancelled' }) as VideoRetimePreviewResult;
const CACHED_PRESENTED_PROMISE = Promise.resolve(PRESENTED_RESULT);

/** Queue exact retime frame presentations through one exclusive paused media port. */
export function createVideoRetimePreviewExecutor(
	portValue: VideoRetimePreviewMediaPort,
	optionsValue: Readonly<{ readonly onPresented: (descriptor: VideoRetimeFrameDescriptor) => void }>,
): VideoRetimePreviewExecutor {
	const port = closedDataSnapshot(portValue, 'video retime preview media port', [
		'pause', 'assertCurrent', 'present',
	]);
	const pause = functionValue(port.pause, 'video retime preview media port.pause');
	const assertCurrent = functionValue(port.assertCurrent, 'video retime preview media port.assertCurrent');
	const present = presentFunction(port.present);
	const options = closedDataSnapshot(optionsValue, 'video retime preview executor options', ['onPresented']);
	const onPresented = presentedFunction(options.onPresented);
	pause();

	let active: Work | null = null;
	let pending: Work | null = null;
	let presentedKey: string | null = null;
	let terminalError: unknown = null;
	let disposed = false;

	const requestFrame = (
		descriptorValue: VideoRetimeFrameDescriptor,
	): Promise<VideoRetimePreviewResult> => {
		if (disposed) return Promise.reject(new Error('The video retime preview executor is disposed.'));
		if (terminalError !== null) return Promise.reject(terminalError);
		const prepared = prepareFrame(descriptorValue);
		if (active !== null) {
			if (!active.cancelled && active.key === prepared.key) {
				active.latest = prepared;
				if (pending !== null) {
					settle(pending, SUPERSEDED_RESULT);
					pending = null;
				}
				return active.promise;
			}
			return queuePending(prepared);
		}
		if (presentedKey === prepared.key) {
			try {
				assertCurrent();
			} catch (errorValue) {
				const error = errorValue instanceof Error ? errorValue : new Error(String(errorValue));
				terminalError = error;
				presentedKey = null;
				return Promise.reject(error);
			}
			return CACHED_PRESENTED_PROMISE;
		}
		const work = createWork(prepared);
		start(work);
		return work.promise;
	};

	const queuePending = (prepared: PreparedFrame): Promise<VideoRetimePreviewResult> => {
		if (pending?.key === prepared.key) {
			pending.latest = prepared;
			return pending.promise;
		}
		if (pending !== null) settle(pending, SUPERSEDED_RESULT);
		pending = createWork(prepared);
		return pending.promise;
	};

	function start(work: Work): void {
		if (disposed || terminalError !== null) {
			settleRejection(work, terminalError ?? new Error('The video retime preview executor is disposed.'));
			return;
		}
		active = work;
		presentedKey = null;
		const controller = new AbortController();
		work.controller = controller;
		let presentation: PromiseLike<Readonly<{ readonly mediaTime: number }>>;
		try {
			assertCurrent();
			presentation = present(Object.freeze({
				drawableSourceFrame: work.latest.descriptor.drawableSourceFrame,
				intervalStartSeconds: work.latest.intervalStartSeconds,
				intervalEndSeconds: work.latest.intervalEndSeconds,
				targetSeconds: work.latest.targetSeconds,
				signal: controller.signal,
			}));
		} catch (error) {
			terminalFault(work, error);
			return;
		}
		void Promise.resolve(presentation).then(
			(result) => { complete(work, result); },
			(error: unknown) => { fail(work, error); },
		);
	}

	function complete(work: Work, resultValue: unknown): void {
		if (active !== work) return;
		if (work.cancelled) {
			drain(work);
			return;
		}
		try {
			assertCurrent();
			assertPresentedMediaTime(resultValue, work.latest.intervalStart, work.latest.intervalEnd);
		} catch (error) {
			terminalFault(work, error);
			return;
		}
		if (pending !== null) {
			settle(work, SUPERSEDED_RESULT);
			active = null;
			startNext();
			return;
		}
		presentedKey = work.key;
		try {
			onPresented(work.latest.descriptor);
		} catch (error) {
			terminalFault(work, error);
			return;
		}
		settle(work, PRESENTED_RESULT);
		active = null;
		startNext();
	}

	function fail(work: Work, error: unknown): void {
		if (active !== work) return;
		if (work.cancelled) {
			drain(work);
			return;
		}
		terminalFault(work, error);
	}

	function drain(work: Work): void {
		if (active !== work) return;
		active = null;
		startNext();
	}

	function startNext(): void {
		if (disposed || terminalError !== null || active !== null || pending === null) return;
		const next = pending;
		pending = null;
		start(next);
	}

	function terminalFault(work: Work, errorValue: unknown): void {
		const error = errorValue instanceof Error ? errorValue : new Error(String(errorValue));
		terminalError = error;
		presentedKey = null;
		work.controller?.abort();
		settleRejection(work, error);
		if (pending !== null) {
			settleRejection(pending, error);
			pending = null;
		}
		if (active === work) active = null;
	}

	function cancelWork(): void {
		if (pending !== null) {
			settle(pending, CANCELLED_RESULT);
			pending = null;
		}
		if (active !== null && !active.cancelled) {
			active.cancelled = true;
			active.controller?.abort();
			settle(active, CANCELLED_RESULT);
		}
	}

	const cancel = (): void => {
		if (disposed || terminalError !== null) return;
		cancelWork();
	};

	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		presentedKey = null;
		cancelWork();
	};

	return Object.freeze({ requestFrame, cancel, dispose });
}

function createWork(prepared: PreparedFrame): Work {
	let resolve: (result: VideoRetimePreviewResult) => void = () => undefined;
	let reject: (error: unknown) => void = () => undefined;
	const promise = new Promise<VideoRetimePreviewResult>((complete, fail) => {
		resolve = complete;
		reject = fail;
	});
	return { key: prepared.key, promise, resolve, reject, latest: prepared, controller: null, settled: false, cancelled: false };
}

function settle(work: Work, result: VideoRetimePreviewResult): void {
	if (work.settled) return;
	work.settled = true;
	work.resolve(result);
}

function settleRejection(work: Work, error: unknown): void {
	if (work.settled) return;
	work.settled = true;
	work.reject(error);
}

function prepareFrame(value: unknown): PreparedFrame {
	const record = closedDataSnapshot(value, 'video retime frame descriptor', [
		'outerCell', 'segmentIndex', 'mode', 'sourceFrame', 'sourceTime',
		'drawableSourceFrame', 'drawableSourceStartTime', 'drawableSourceEndTime',
	]);
	const outerCell = nonNegativeSafeInteger(record.outerCell, 'video retime frame descriptor.outerCell');
	const segmentIndex = nonNegativeSafeInteger(record.segmentIndex, 'video retime frame descriptor.segmentIndex');
	const mode = modeValue(record.mode);
	const sourceFrame = exactValue(record.sourceFrame, 'video retime frame descriptor.sourceFrame', true);
	const sourceTime = exactValue(record.sourceTime, 'video retime frame descriptor.sourceTime', true);
	const drawableSourceFrame = nonNegativeSafeInteger(
		record.drawableSourceFrame,
		'video retime frame descriptor.drawableSourceFrame',
	);
	const intervalStart = exactValue(
		record.drawableSourceStartTime,
		'video retime frame descriptor.drawableSourceStartTime',
		true,
	);
	const intervalEnd = exactValue(
		record.drawableSourceEndTime,
		'video retime frame descriptor.drawableSourceEndTime',
		true,
	);
	if (compareExact(intervalStart, intervalEnd) >= 0) {
		throw new RangeError('A video retime drawable interval must have positive exact duration.');
	}
	const descriptor = Object.freeze({
		outerCell,
		segmentIndex,
		mode,
		sourceFrame,
		sourceTime,
		drawableSourceFrame,
		drawableSourceStartTime: intervalStart,
		drawableSourceEndTime: intervalEnd,
	});
	const midpoint = midpointExact(intervalStart, intervalEnd);
	const intervalStartSeconds = exactToNumber(intervalStart);
	const intervalEndSeconds = exactToNumber(intervalEnd);
	if (!Number.isFinite(intervalStartSeconds) || !Number.isFinite(intervalEndSeconds)
		|| intervalStartSeconds >= intervalEndSeconds) {
		throw new RangeError('The exact video retime interval collapses in the Number media-time domain.');
	}
	let targetSeconds = exactToNumber(midpoint);
	if (!exactNumberInside(targetSeconds, intervalStart, intervalEnd)) {
		targetSeconds = nextRepresentableInside(intervalStartSeconds, intervalStart, intervalEnd);
	}
	if (!Number.isFinite(targetSeconds) || targetSeconds < intervalStartSeconds
		|| targetSeconds >= intervalEndSeconds || !exactNumberInside(targetSeconds, intervalStart, intervalEnd)) {
		throw new RangeError('The exact video retime interval has no representable interior media time.');
	}
	return Object.freeze({
		key: `${String(drawableSourceFrame)}:${String(intervalStart.numerator)}/${String(intervalStart.denominator)}:${String(intervalEnd.numerator)}/${String(intervalEnd.denominator)}`,
		descriptor,
		intervalStart,
		intervalEnd,
		intervalStartSeconds,
		intervalEndSeconds,
		targetSeconds,
	});
}

function midpointExact(start: ExactValue, end: ExactValue): ExactValue {
	const common = greatestCommonDivisor(start.denominator, end.denominator);
	const startScale = end.denominator / common;
	const endScale = start.denominator / common;
	return normalizeExact(
		start.numerator * startScale + end.numerator * endScale,
		2n * start.denominator * startScale,
		'video retime interval midpoint',
	);
}

function exactValue(value: unknown, name: string, nonNegative: boolean): ExactValue {
	const record = closedDataSnapshot(value, name, ['numerator', 'denominator']);
	if (typeof record.numerator !== 'bigint' || typeof record.denominator !== 'bigint') {
		throw new TypeError(`${name} numerator and denominator must be BigInt.`);
	}
	if (record.denominator <= 0n || (nonNegative && record.numerator < 0n)) {
		throw new RangeError(`${name} must have a positive denominator and non-negative value.`);
	}
	if (bitLength(record.numerator) > MAXIMUM_EXACT_BITS || bitLength(record.denominator) > MAXIMUM_EXACT_BITS) {
		throw new RangeError(`${name} exact complexity exceeds ${String(MAXIMUM_EXACT_BITS)} bits.`);
	}
	const divisor = greatestCommonDivisor(absoluteBigInt(record.numerator), record.denominator);
	if (divisor !== 1n) throw new RangeError(`${name} must be canonically reduced.`);
	return Object.freeze({ numerator: record.numerator, denominator: record.denominator });
}

function normalizeExact(numerator: bigint, denominator: bigint, name: string): ExactValue {
	if (denominator <= 0n) throw new RangeError(`${name} denominator must be positive.`);
	const divisor = greatestCommonDivisor(absoluteBigInt(numerator), denominator);
	const result = Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
	if (bitLength(result.numerator) > MAXIMUM_EXACT_BITS || bitLength(result.denominator) > MAXIMUM_EXACT_BITS) {
		throw new RangeError(`${name} normalized exact complexity exceeds ${String(MAXIMUM_EXACT_BITS)} bits.`);
	}
	return result;
}

function exactToNumber(value: ExactValue): number {
	if (value.numerator === 0n) return 0;
	const negative = value.numerator < 0n;
	const numerator = absoluteBigInt(value.numerator);
	let exponent = floorBinaryExponent(numerator, value.denominator);
	if (exponent > 1_023) return negative ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
	let magnitude: number;
	if (exponent >= -1_022) {
		const shift = 52 - exponent;
		const scaledNumerator = shift >= 0 ? numerator << BigInt(shift) : numerator;
		const scaledDenominator = shift >= 0 ? value.denominator : value.denominator << BigInt(-shift);
		let significand = roundedQuotient(scaledNumerator, scaledDenominator);
		if (significand === 1n << 53n) {
			significand >>= 1n;
			exponent += 1;
			if (exponent > 1_023) return negative ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
		}
		magnitude = Number(significand) * 2 ** (exponent - 52);
	} else {
		const subnormal = roundedQuotient(numerator << 1_074n, value.denominator);
		magnitude = Number(subnormal) * Number.MIN_VALUE;
	}
	return negative ? -magnitude : magnitude;
}

function floorBinaryExponent(numerator: bigint, denominator: bigint): number {
	let exponent = bitLength(numerator) - bitLength(denominator);
	const below = exponent >= 0
		? numerator < denominator << BigInt(exponent)
		: numerator << BigInt(-exponent) < denominator;
	if (below) exponent -= 1;
	return exponent;
}

function roundedQuotient(numerator: bigint, denominator: bigint): bigint {
	const quotient = numerator / denominator;
	const remainder = numerator % denominator;
	const doubled = remainder * 2n;
	return doubled > denominator || (doubled === denominator && quotient % 2n !== 0n)
		? quotient + 1n
		: quotient;
}

function exactNumberInside(value: number, start: ExactValue, end: ExactValue): boolean {
	if (!Number.isFinite(value)) return false;
	const exact = exactFromNumber(value);
	return compareExact(exact, start) > 0 && compareExact(exact, end) < 0;
}

function nextRepresentableInside(lower: number, start: ExactValue, end: ExactValue): number {
	let candidate = lower;
	if (!exactNumberInside(candidate, start, end)) candidate = nextUp(candidate);
	return exactNumberInside(candidate, start, end) ? candidate : Number.NaN;
}

function nextUp(value: number): number {
	if (!Number.isFinite(value)) return value;
	if (Object.is(value, -0) || value === 0) return Number.MIN_VALUE;
	const view = new DataView(new ArrayBuffer(8));
	view.setFloat64(0, value, false);
	let bits = view.getBigUint64(0, false);
	bits = value > 0 ? bits + 1n : bits - 1n;
	view.setBigUint64(0, bits, false);
	return view.getFloat64(0, false);
}

function exactFromNumber(value: number): ExactValue {
	if (!Number.isFinite(value)) throw new RangeError('A media time must be finite.');
	if (value === 0) return Object.freeze({ numerator: 0n, denominator: 1n });
	const view = new DataView(new ArrayBuffer(8));
	view.setFloat64(0, value, false);
	const bits = view.getBigUint64(0, false);
	const negative = (bits >> 63n) !== 0n;
	const exponentBits = Number((bits >> 52n) & 0x7ffn);
	const fractionBits = bits & ((1n << 52n) - 1n);
	let numerator: bigint;
	let denominator: bigint;
	if (exponentBits === 0) {
		numerator = fractionBits;
		denominator = 1n << 1_074n;
	} else {
		numerator = (1n << 52n) + fractionBits;
		const exponent = exponentBits - 1_023 - 52;
		if (exponent >= 0) {
			numerator <<= BigInt(exponent);
			denominator = 1n;
		} else denominator = 1n << BigInt(-exponent);
	}
	if (negative) numerator = -numerator;
	const divisor = greatestCommonDivisor(absoluteBigInt(numerator), denominator);
	return Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
}

function assertPresentedMediaTime(resultValue: unknown, start: ExactValue, end: ExactValue): void {
	const result = closedDataSnapshot(resultValue, 'video retime presented media result', ['mediaTime']);
	if (typeof result.mediaTime !== 'number' || !Number.isFinite(result.mediaTime)) {
		throw new RangeError('Video retime presented mediaTime must be finite.');
	}
	const roundedStart = exactToNumber(start);
	const roundedEnd = exactToNumber(end);
	if (result.mediaTime < roundedStart || result.mediaTime >= roundedEnd) {
		throw new RangeError('The presented video picture is outside its numeric drawable interval.');
	}
	if (result.mediaTime === roundedStart) return;
	const exact = exactFromNumber(result.mediaTime);
	if (compareExact(exact, start) < 0 || compareExact(exact, end) >= 0) {
		throw new RangeError('The presented video picture is outside its exact drawable interval.');
	}
}

function compareExact(left: ExactValue, right: ExactValue): -1 | 0 | 1 {
	const difference = left.numerator * right.denominator - right.numerator * left.denominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function closedDataSnapshot(value: unknown, name: string, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a closed own-data record.`);
	}
	const record = value as Record<string, unknown>;
	const actualKeys = Reflect.ownKeys(record);
	if (actualKeys.length !== keys.length || keys.some((key) => !actualKeys.includes(key))
		|| actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
		throw new TypeError(`${name} has an invalid closed field shape.`);
	}
	const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property, not an accessor.`);
		}
		snapshot[key] = descriptor.value;
	}
	return Object.freeze(snapshot);
}

function modeValue(value: unknown): VideoRetimeFrameDescriptor['mode'] {
	if (typeof value !== 'string' || !MODES.has(value)) throw new RangeError('Invalid video retime frame mode.');
	return value as VideoRetimeFrameDescriptor['mode'];
}

function functionValue(value: unknown, name: string): () => void {
	if (typeof value !== 'function') throw new TypeError(`${name} must be a function.`);
	return value as () => void;
}

function presentFunction(value: unknown): VideoRetimePreviewMediaPort['present'] {
	if (typeof value !== 'function') throw new TypeError('Video retime preview media port.present must be a function.');
	return value as VideoRetimePreviewMediaPort['present'];
}

function presentedFunction(value: unknown): (descriptor: VideoRetimeFrameDescriptor) => void {
	if (typeof value !== 'function') throw new TypeError('Video retime preview onPresented must be a function.');
	return value as (descriptor: VideoRetimeFrameDescriptor) => void;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	left = absoluteBigInt(left);
	right = absoluteBigInt(right);
	while (right !== 0n) {
		const remainder = left % right;
		left = right;
		right = remainder;
	}
	return left || 1n;
}

function bitLength(value: bigint): number {
	return absoluteBigInt(value).toString(2).length;
}

function absoluteBigInt(value: bigint): bigint {
	return value < 0n ? -value : value;
}
