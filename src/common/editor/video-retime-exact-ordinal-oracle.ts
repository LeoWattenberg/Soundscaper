/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Lazy picture-ordinal authority for the complete admitted V16 retime wire.
 * The oracle evaluates one requested output ordinal with bounded BigInt
 * rationals. It retains only mapping intersections and one last-result cache;
 * no output-sized schedule or floating-point repair exists.
 */

import type {
	VideoRetimeExportIntentV6,
	VideoRetimeExportIntersectionV6,
} from './video-retime-export-plan.ts';
import {
	createVideoRetimeOutputCadence,
	type VideoRetimeOutputCadence,
} from './video-retime-output-cadence.ts';
import {
	boundVideoSourceTimingViewInfo,
	compareSourceTimes,
	videoSourceFrameTime,
	type BoundVideoSourceTimingView,
	type ExactSourcePosition,
	type ExactSourceTime,
} from './video-source-timing-view.ts';

const MAXIMUM_EXACT_INPUT_BITS = 4_096;
const MAXIMUM_EXACT_INPUT_DECIMAL_DIGITS = 1_234;
// A fixed oracle query combines at most six admitted input rationals. Keeping
// that complete expression tree is bounded without rejecting a reduced result
// merely because its denominator is wider than one persisted input token.
const MAXIMUM_EXACT_WORKING_BITS = MAXIMUM_EXACT_INPUT_BITS * 6;
const MAXIMUM_INTERSECTIONS = 16_384;

export interface VideoRetimeExactPictureOrdinal {
	readonly intersectionIndex: number;
	readonly clipId: string;
	readonly sourceId: string;
	readonly mapping: 'curve' | 'uniform-wall-clock';
	readonly outerCell: number;
	readonly segmentIndex: number;
	readonly mode: 'constant-forward' | 'constant-reverse' | 'freeze' | 'ramp-forward' | 'ramp-reverse';
	readonly sourceOrdinal: number;
	readonly sourcePosition: ExactSourcePosition;
	readonly sourceTime: ExactSourceTime;
	readonly drawableSourceStartTime: ExactSourceTime;
	readonly drawableSourceEndTime: ExactSourceTime;
}

export interface VideoRetimeExactOutputOrdinal {
	readonly outputOrdinal: number;
	readonly relativePts: ExactSourceTime;
	readonly absoluteSample: number;
	readonly pictures: readonly VideoRetimeExactPictureOrdinal[];
}

export interface VideoRetimeExactOrdinalOracle {
	readonly outputFrameCount: number;
	readonly frameAt: (outputOrdinal: number) => VideoRetimeExactOutputOrdinal;
}

/** Validate one closed V6 wire without requiring its external timing assets. */
export function normalizeVideoRetimeExportIntentV6Wire(
	value: unknown,
): VideoRetimeExportIntentV6 {
	const captured = captureIntent(value);
	if (captured.intent.outputFrameCount !== captured.cadence.outputFrameCount) {
		throw new RangeError('Video retime intent output count disagrees with its exact cadence.');
	}
	return captured.intent;
}

type Exact = Readonly<{ readonly numerator: bigint; readonly denominator: bigint }>;
type CapturedCurveRow = Readonly<{
	readonly mapping: 'curve';
	readonly raw: VideoRetimeExportIntersectionV6;
	readonly index: number; readonly clipId: string; readonly sourceId: string;
	readonly sequenceStartFrame: number; readonly outerFrameCount: number;
	readonly sourceInFrame: number; readonly sourceOutFrame: number;
	readonly startSample: number; readonly endSample: number;
	readonly startOutputFrame: number; readonly endOutputFrame: number;
	readonly segmentIndex: number;
	readonly mode: 'constant-forward' | 'constant-reverse' | 'freeze' | 'ramp-forward' | 'ramp-reverse';
	readonly segmentStartOuterCell: number; readonly segmentEndOuterCell: number;
	readonly sourceStart: Exact; readonly sourceEnd: Exact;
	readonly startVelocity: Exact | null; readonly endVelocity: Exact | null;
}>;
type CapturedWallClockRow = Readonly<{
	readonly mapping: 'uniform-wall-clock';
	readonly raw: VideoRetimeExportIntersectionV6;
	readonly index: number; readonly clipId: string; readonly sourceId: string;
	readonly sequenceStartFrame: number; readonly outerFrameCount: number;
	readonly sourceInFrame: number; readonly sourceOutFrame: number;
	readonly startSample: number; readonly endSample: number;
	readonly startOutputFrame: number; readonly endOutputFrame: number;
	readonly clippedSourceStartTime: Exact; readonly clippedSourceEndTime: Exact;
}>;
type CapturedRow = CapturedCurveRow | CapturedWallClockRow;

const INTENT_KEYS = [
	'kind', 'version', 'sampleStart', 'sampleDuration', 'sampleRate', 'sequenceBinding',
	'outputRate', 'outputFrameCount', 'intersections', 'limits',
];
const SEQUENCE_KEYS = ['id', 'rate'];
const RATE_KEYS = ['num', 'den'];
const LIMIT_KEYS = [
	'topologyRecordCount', 'compiledSegmentCount', 'geometricCandidateCount',
	'serializedIntersectionCount', 'decimalByteCount',
];
const CURVE_KEYS = [
	'index', 'topologyIntervalIndex', 'layerIndex', 'clipIndex', 'clipId', 'sourceId',
	'sequenceStartFrame', 'outerFrameCount', 'sourceInFrame', 'sourceOutFrame',
	'startSample', 'endSample', 'startOutputFrame', 'endOutputFrame', 'mapping',
	'segmentIndex', 'mode', 'segmentStartOuterCell', 'segmentEndOuterCell', 'sourceStart',
	'sourceEnd', 'startOuterCell', 'endOuterCell', 'clippedSourceStart', 'clippedSourceEnd',
	'drawableStartTime', 'drawableEndTime',
];
const RAMP_CURVE_KEYS = [
	...CURVE_KEYS.slice(0, 21), 'startVelocity', 'endVelocity', ...CURVE_KEYS.slice(21),
];
const WALL_CLOCK_KEYS = [
	'index', 'topologyIntervalIndex', 'layerIndex', 'clipIndex', 'clipId', 'sourceId',
	'sequenceStartFrame', 'outerFrameCount', 'sourceInFrame', 'sourceOutFrame',
	'startSample', 'endSample', 'startOutputFrame', 'endOutputFrame', 'mapping',
	'clipStartSample', 'clipEndSample', 'sourceStartTime', 'sourceEndTime',
	'clippedSourceStartTime', 'clippedSourceEndTime',
];

/** Bind one serialized V6 intent and its exact authenticated source timings. */
export function createVideoRetimeExactOrdinalOracle(
	intentValue: unknown,
	timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>,
): VideoRetimeExactOrdinalOracle {
	const { intent, cadence, rows } = captureIntent(intentValue);
	const timing = captureTiming(timingBySourceId, rows);
	let cachedOrdinal: number | null = null;
	let cachedFrame: VideoRetimeExactOutputOrdinal | null = null;

	const frameAt = (ordinalValue: number): VideoRetimeExactOutputOrdinal => {
		const outputOrdinal = outputIndex(ordinalValue, cadence.outputFrameCount);
		if (cachedOrdinal === outputOrdinal && cachedFrame !== null) return cachedFrame;
		const cadenceFrame = cadence.frameAt(outputOrdinal);
		const pictures: VideoRetimeExactPictureOrdinal[] = [];
		for (const row of rows) {
			if (outputOrdinal < row.startOutputFrame || outputOrdinal >= row.endOutputFrame) continue;
			const token = required(timing.get(row.sourceId));
			pictures.push(row.mapping === 'curve'
				? curvePicture(row, token, cadence, outputOrdinal)
				: wallClockPicture(row, token, cadence, outputOrdinal, cadenceFrame.absoluteSample));
		}
		const result = Object.freeze({
			outputOrdinal,
			relativePts: exact(cadenceFrame.relativePts.numerator, cadenceFrame.relativePts.denominator),
			absoluteSample: cadenceFrame.absoluteSample,
			pictures: Object.freeze(pictures),
		});
		cachedOrdinal = outputOrdinal;
		cachedFrame = result;
		return result;
	};

	if (intent.outputFrameCount !== cadence.outputFrameCount) {
		throw new RangeError('Video retime intent output count disagrees with its exact cadence.');
	}
	return Object.freeze({ outputFrameCount: cadence.outputFrameCount, frameAt });
}

function curvePicture(
	row: CapturedCurveRow,
	timing: BoundVideoSourceTimingView,
	cadence: VideoRetimeOutputCadence,
	outputOrdinal: number,
): VideoRetimeExactPictureOrdinal {
	const outerCell = cadence.localCellAt(outputOrdinal, row.sequenceStartFrame, row.outerFrameCount);
	if (outerCell === null || outerCell < row.segmentStartOuterCell || outerCell >= row.segmentEndOuterCell) {
		throw new RangeError('A curve intersection does not own its requested output ordinal.');
	}
	const sourcePosition = evaluateCurve(row, outerCell);
	if (compare(sourcePosition, integer(row.sourceInFrame)) < 0
		|| compare(sourcePosition, integer(row.sourceOutFrame)) > 0) {
		throw new RangeError('An exact retime position escaped its source binding.');
	}
	const owned = row.mode === 'constant-reverse' || row.mode === 'ramp-reverse'
		? ceiling(sourcePosition) - 1n
		: floor(sourcePosition);
	const sourceOrdinal = Number(clamp(
		owned,
		BigInt(row.sourceInFrame),
		BigInt(row.sourceOutFrame - 1),
	));
	const drawableSourceStartTime = exactTime(videoSourceFrameTime(timing, integer(sourceOrdinal)));
	const drawableSourceEndTime = exactTime(videoSourceFrameTime(timing, integer(sourceOrdinal + 1)));
	return Object.freeze({
		intersectionIndex: row.index,
		clipId: row.clipId,
		sourceId: row.sourceId,
		mapping: row.mapping,
		outerCell,
		segmentIndex: row.segmentIndex,
		mode: row.mode,
		sourceOrdinal,
		sourcePosition,
		sourceTime: exactTime(videoSourceFrameTime(timing, sourcePosition)),
		drawableSourceStartTime,
		drawableSourceEndTime,
	});
}

function wallClockPicture(
	row: CapturedWallClockRow,
	timing: BoundVideoSourceTimingView,
	cadence: VideoRetimeOutputCadence,
	outputOrdinal: number,
	absoluteSample: number,
): VideoRetimeExactPictureOrdinal {
	if (absoluteSample < row.startSample || absoluteSample >= row.endSample) {
		throw new RangeError('A wall-clock intersection does not own its requested output sample.');
	}
	const progress = exact(
		BigInt(absoluteSample - row.startSample),
		BigInt(row.endSample - row.startSample),
	);
	const sourceTime = add(
		row.clippedSourceStartTime,
		multiply(subtract(row.clippedSourceEndTime, row.clippedSourceStartTime), progress),
	);
	const sourceOrdinal = exactPictureOrdinalAtTime(timing, sourceTime);
	if (sourceOrdinal < row.sourceInFrame || sourceOrdinal >= row.sourceOutFrame) {
		throw new RangeError('A wall-clock picture escaped its source binding.');
	}
	const outerCell = required(cadence.localCellAt(
		outputOrdinal,
		row.sequenceStartFrame,
		row.outerFrameCount,
	));
	const drawableSourceStartTime = exactTime(videoSourceFrameTime(timing, integer(sourceOrdinal)));
	const drawableSourceEndTime = exactTime(videoSourceFrameTime(timing, integer(sourceOrdinal + 1)));
	const intervalProgress = divide(
		subtract(sourceTime, drawableSourceStartTime),
		subtract(drawableSourceEndTime, drawableSourceStartTime),
	);
	const sourcePosition = add(integer(sourceOrdinal), intervalProgress);
	return Object.freeze({
		intersectionIndex: row.index,
		clipId: row.clipId,
		sourceId: row.sourceId,
		mapping: row.mapping,
		outerCell,
		segmentIndex: 0,
		mode: 'constant-forward' as const,
		sourceOrdinal,
		sourcePosition,
		sourceTime,
		drawableSourceStartTime,
		drawableSourceEndTime,
	});
}

/** Exact lower-bound ownership using only the authenticated timing token's boundary oracle. */
function exactPictureOrdinalAtTime(timing: BoundVideoSourceTimingView, time: Exact): number {
	const info = boundVideoSourceTimingViewInfo(timing);
	const first = videoSourceFrameTime(timing, integer(0));
	const end = videoSourceFrameTime(timing, integer(info.frameCount));
	if (compareSourceTimes(time, first) < 0 || compareSourceTimes(time, end) >= 0) {
		throw new RangeError('Exact source time is outside its bound timing view.');
	}
	let lower = 0;
	let upper = info.frameCount;
	while (lower + 1 < upper) {
		const middle = lower + Math.floor((upper - lower) / 2);
		const boundary = videoSourceFrameTime(timing, integer(middle));
		if (compareSourceTimes(boundary, time) <= 0) lower = middle;
		else upper = middle;
	}
	return lower;
}

function evaluateCurve(row: CapturedCurveRow, outerCell: number): Exact {
	if (row.mode === 'freeze') return row.sourceStart;
	const elapsed = integer(outerCell - row.segmentStartOuterCell);
	const span = integer(row.segmentEndOuterCell - row.segmentStartOuterCell);
	let delta: Exact;
	if (row.mode === 'constant-forward' || row.mode === 'constant-reverse') {
		delta = multiply(subtract(row.sourceEnd, row.sourceStart), divide(elapsed, span));
	} else {
		const startVelocity = required(row.startVelocity);
		const endVelocity = required(row.endVelocity);
		const velocityDelta = subtract(endVelocity, startVelocity);
		const magnitude = add(
			multiply(startVelocity, elapsed),
			multiply(velocityDelta, divide(multiply(elapsed, elapsed), multiply(integer(2), span))),
		);
		delta = row.mode === 'ramp-reverse' ? negate(magnitude) : magnitude;
	}
	return add(row.sourceStart, delta);
}

function captureIntent(value: unknown): Readonly<{
	readonly intent: VideoRetimeExportIntentV6;
	readonly cadence: VideoRetimeOutputCadence;
	readonly rows: readonly CapturedRow[];
}> {
	const intent = closedRecord(value, INTENT_KEYS, 'video retime export intent');
	if (intent.kind !== 'video-retime-export-intent' || intent.version !== 6) {
		throw new RangeError('Video retime export intent kind or version is unsupported.');
	}
	const sampleStart = nonNegativeInteger(intent.sampleStart, 'intent.sampleStart');
	const sampleDuration = positiveInteger(intent.sampleDuration, 'intent.sampleDuration');
	const sampleRate = positiveInteger(intent.sampleRate, 'intent.sampleRate');
	const sequence = closedRecord(intent.sequenceBinding, SEQUENCE_KEYS, 'intent.sequenceBinding');
	const sequenceId = id(sequence.id, 'intent.sequenceBinding.id');
	const sequenceRate = rate(sequence.rate, 'intent.sequenceBinding.rate');
	const outputRate = rate(intent.outputRate, 'intent.outputRate');
	const outputFrameCount = positiveInteger(intent.outputFrameCount, 'intent.outputFrameCount');
	const cadence = createVideoRetimeOutputCadence({
		sampleStart, sampleDuration, sampleRate, sequenceRate, outputRate,
	});
	const intersections = denseArray(intent.intersections, 'intent.intersections', MAXIMUM_INTERSECTIONS);
	const rows = Object.freeze(intersections.map((row, index) => captureRow(row, index, outputFrameCount)));
	const limits = closedRecord(intent.limits, LIMIT_KEYS, 'intent.limits');
	for (const key of LIMIT_KEYS) nonNegativeInteger(limits[key], `intent.limits.${key}`);
	if (limits.serializedIntersectionCount !== rows.length) {
		throw new RangeError('Video retime intent intersection count is inconsistent.');
	}
	return Object.freeze({
		intent: intent as unknown as VideoRetimeExportIntentV6,
		cadence,
		rows,
		sequenceId,
	});
}

function captureRow(value: unknown, index: number, outputFrameCount: number): CapturedRow {
	const record = plainRecord(value, `intent.intersections[${String(index)}]`);
	const mapping = ownData(record, 'mapping', 'retime intersection');
	if (mapping === 'curve') return captureCurveRow(record, index, outputFrameCount);
	if (mapping === 'uniform-wall-clock') return captureWallClockRow(record, index, outputFrameCount);
	throw new RangeError('Video retime intersection mapping is unsupported.');
}

function captureCurveRow(value: Record<string, unknown>, index: number, count: number): CapturedCurveRow {
	const mode = ownData(value, 'mode', 'curve intersection');
	const ramp = mode === 'ramp-forward' || mode === 'ramp-reverse';
	const row = closedRecord(value, ramp ? RAMP_CURVE_KEYS : CURVE_KEYS, 'curve intersection');
	const base = captureBase(row, index, count);
	if (!['constant-forward', 'constant-reverse', 'freeze', 'ramp-forward', 'ramp-reverse'].includes(String(mode))) {
		throw new RangeError('Curve intersection mode is unsupported.');
	}
	const segmentStartOuterCell = nonNegativeInteger(row.segmentStartOuterCell, 'segmentStartOuterCell');
	const segmentEndOuterCell = positiveInteger(row.segmentEndOuterCell, 'segmentEndOuterCell');
	if (segmentEndOuterCell <= segmentStartOuterCell) throw new RangeError('Curve segment range is empty.');
	const segmentIndex = nonNegativeInteger(row.segmentIndex, 'curve intersection.segmentIndex');
	const startOuterCell = nonNegativeInteger(row.startOuterCell, 'curve intersection.startOuterCell');
	const endOuterCell = positiveInteger(row.endOuterCell, 'curve intersection.endOuterCell');
	if (startOuterCell < segmentStartOuterCell || endOuterCell > segmentEndOuterCell
		|| endOuterCell <= startOuterCell) throw new RangeError('Curve intersection outer-cell envelope is invalid.');
	decimal(row.clippedSourceStart, 'clippedSourceStart');
	decimal(row.clippedSourceEnd, 'clippedSourceEnd');
	decimal(row.drawableStartTime, 'drawableStartTime');
	decimal(row.drawableEndTime, 'drawableEndTime');
	return Object.freeze({
		...base,
		mapping: 'curve',
		raw: row as unknown as VideoRetimeExportIntersectionV6,
		segmentIndex,
		mode: mode as CapturedCurveRow['mode'],
		segmentStartOuterCell,
		segmentEndOuterCell,
		sourceStart: decimal(row.sourceStart, 'sourceStart'),
		sourceEnd: decimal(row.sourceEnd, 'sourceEnd'),
		startVelocity: ramp ? decimal(row.startVelocity, 'startVelocity') : null,
		endVelocity: ramp ? decimal(row.endVelocity, 'endVelocity') : null,
	});
}

function captureWallClockRow(value: Record<string, unknown>, index: number, count: number): CapturedWallClockRow {
	const row = closedRecord(value, WALL_CLOCK_KEYS, 'wall-clock intersection');
	const clipStartSample = nonNegativeInteger(row.clipStartSample, 'wall-clock clipStartSample');
	const clipEndSample = positiveInteger(row.clipEndSample, 'wall-clock clipEndSample');
	if (clipEndSample <= clipStartSample) throw new RangeError('Wall-clock clip sample range is empty.');
	decimal(row.sourceStartTime, 'wall-clock sourceStartTime');
	decimal(row.sourceEndTime, 'wall-clock sourceEndTime');
	return Object.freeze({
		...captureBase(row, index, count),
		mapping: 'uniform-wall-clock',
		raw: row as unknown as VideoRetimeExportIntersectionV6,
		clippedSourceStartTime: decimal(row.clippedSourceStartTime, 'clippedSourceStartTime'),
		clippedSourceEndTime: decimal(row.clippedSourceEndTime, 'clippedSourceEndTime'),
	});
}

function captureBase(row: Record<string, unknown>, index: number, count: number) {
	if (nonNegativeInteger(row.index, 'intersection.index') !== index) {
		throw new RangeError('Video retime intersection indices must be dense.');
	}
	nonNegativeInteger(row.topologyIntervalIndex, 'intersection.topologyIntervalIndex');
	nonNegativeInteger(row.layerIndex, 'intersection.layerIndex');
	nonNegativeInteger(row.clipIndex, 'intersection.clipIndex');
	const startSample = nonNegativeInteger(row.startSample, 'intersection.startSample');
	const endSample = positiveInteger(row.endSample, 'intersection.endSample');
	const startOutputFrame = nonNegativeInteger(row.startOutputFrame, 'intersection.startOutputFrame');
	const endOutputFrame = positiveInteger(row.endOutputFrame, 'intersection.endOutputFrame');
	if (endSample <= startSample || endOutputFrame <= startOutputFrame || endOutputFrame > count) {
		throw new RangeError('Video retime intersection range is invalid.');
	}
	const sourceInFrame = nonNegativeInteger(row.sourceInFrame, 'intersection.sourceInFrame');
	const sourceOutFrame = positiveInteger(row.sourceOutFrame, 'intersection.sourceOutFrame');
	if (sourceOutFrame <= sourceInFrame) throw new RangeError('Video retime intersection source range is empty.');
	return {
		index,
		clipId: id(row.clipId, 'intersection.clipId'),
		sourceId: id(row.sourceId, 'intersection.sourceId'),
		sequenceStartFrame: nonNegativeInteger(row.sequenceStartFrame, 'intersection.sequenceStartFrame'),
		outerFrameCount: positiveInteger(row.outerFrameCount, 'intersection.outerFrameCount'),
		sourceInFrame,
		sourceOutFrame,
		startSample,
		endSample,
		startOutputFrame,
		endOutputFrame,
	};
}

function captureTiming(
	value: ReadonlyMap<string, BoundVideoSourceTimingView>,
	rows: readonly CapturedRow[],
): ReadonlyMap<string, BoundVideoSourceTimingView> {
	if (!(value instanceof Map)) throw new TypeError('Video retime ordinal timing must be an actual Map.');
	const requiredSources = new Map<string, number>();
	for (const row of rows) requiredSources.set(row.sourceId, Math.max(requiredSources.get(row.sourceId) ?? 0, row.sourceOutFrame));
	const sizeGetter = Object.getOwnPropertyDescriptor(Map.prototype, 'size')?.get;
	const size = Number(sizeGetter?.call(value));
	if (size !== requiredSources.size) throw new RangeError('Video retime ordinal timing must contain exactly its sources.');
	const result = new Map<string, BoundVideoSourceTimingView>();
	for (const [key, token] of Map.prototype.entries.call(value) as MapIterator<[
		string,
		BoundVideoSourceTimingView,
	]>) {
		const info = boundVideoSourceTimingViewInfo(token);
		const requiredEnd = requiredSources.get(key);
		if (requiredEnd === undefined || info.sourceId !== key || info.frameCount < requiredEnd) {
			throw new RangeError('Video retime ordinal timing source binding is inconsistent.');
		}
		result.set(key, token);
	}
	return result;
}

function decimal(value: unknown, name: string): Exact {
	const record = closedRecord(value, ['numerator', 'denominator'], name);
	if (typeof record.numerator !== 'string' || typeof record.denominator !== 'string'
		|| !/^(?:0|-?[1-9][0-9]*)$/u.test(record.numerator)
		|| !/^[1-9][0-9]*$/u.test(record.denominator)) throw new TypeError(`${name} is not a canonical decimal rational.`);
	if (record.numerator.replace('-', '').length > MAXIMUM_EXACT_INPUT_DECIMAL_DIGITS
		|| record.denominator.length > MAXIMUM_EXACT_INPUT_DECIMAL_DIGITS) {
		throw new RangeError(`${name} exceeds the 4,096-bit input ceiling.`);
	}
	const numerator = BigInt(record.numerator);
	const denominator = BigInt(record.denominator);
	boundInput(numerator);
	boundInput(denominator);
	const result = exact(numerator, denominator);
	if (result.numerator.toString() !== record.numerator || result.denominator.toString() !== record.denominator) {
		throw new RangeError(`${name} must be canonically reduced.`);
	}
	return result;
}

function exact(numerator: bigint, denominator: bigint): Exact {
	if (denominator <= 0n) throw new RangeError('An exact denominator must be positive.');
	const divisor = gcd(abs(numerator), denominator);
	const result = Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
	boundWorking(result.numerator); boundWorking(result.denominator);
	return result;
}

function exactTime(value: ExactSourceTime): ExactSourceTime {
	return exact(value.numerator, value.denominator);
}

function integer(value: number): Exact { return Object.freeze({ numerator: BigInt(value), denominator: 1n }); }
function negate(value: Exact): Exact { return exact(-value.numerator, value.denominator); }
function subtract(left: Exact, right: Exact): Exact { return add(left, negate(right)); }
function divide(left: Exact, right: Exact): Exact {
	if (right.numerator === 0n) throw new RangeError('Exact division by zero.');
	return multiply(left, exact(right.denominator, right.numerator));
}
function add(left: Exact, right: Exact): Exact {
	const common = gcd(left.denominator, right.denominator);
	return exact(
		checkedAdd(checkedMultiply(left.numerator, right.denominator / common), checkedMultiply(right.numerator, left.denominator / common)),
		checkedMultiply(left.denominator, right.denominator / common),
	);
}
function multiply(left: Exact, right: Exact): Exact {
	const a = gcd(abs(left.numerator), right.denominator);
	const b = gcd(abs(right.numerator), left.denominator);
	return exact(
		checkedMultiply(left.numerator / a, right.numerator / b),
		checkedMultiply(left.denominator / b, right.denominator / a),
	);
}

function compare(left: Exact, right: Exact): -1 | 0 | 1 {
	const difference = left.numerator * right.denominator - right.numerator * left.denominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
function floor(value: Exact): bigint {
	const quotient = value.numerator / value.denominator;
	return value.numerator % value.denominator < 0n ? quotient - 1n : quotient;
}
function ceiling(value: Exact): bigint {
	const quotient = value.numerator / value.denominator;
	return value.numerator % value.denominator > 0n ? quotient + 1n : quotient;
}
function clamp(value: bigint, lower: bigint, upper: bigint): bigint { return value < lower ? lower : value > upper ? upper : value; }
function checkedMultiply(left: bigint, right: bigint): bigint { return left * right; }
function checkedAdd(left: bigint, right: bigint): bigint { return left + right; }
function boundInput(value: bigint): void {
	if (abs(value).toString(2).length > MAXIMUM_EXACT_INPUT_BITS) {
		throw new RangeError('Exact retime input complexity exceeds 4,096 bits.');
	}
}
function boundWorking(value: bigint): void {
	if (abs(value).toString(2).length > MAXIMUM_EXACT_WORKING_BITS) {
		throw new RangeError('Exact retime working complexity exceeds its fixed expression bound.');
	}
}
function abs(value: bigint): bigint { return value < 0n ? -value : value; }
function gcd(left: bigint, right: bigint): bigint { while (right !== 0n) [left, right] = [right, left % right]; return left || 1n; }

function rate(value: unknown, name: string): Readonly<{ num: number; den: number }> {
	const record = closedRecord(value, RATE_KEYS, name);
	const num = positiveInteger(record.num, `${name}.num`);
	const den = positiveInteger(record.den, `${name}.den`);
	if (gcd(BigInt(num), BigInt(den)) !== 1n) throw new RangeError(`${name} must be reduced.`);
	return Object.freeze({ num, den });
}

function closedRecord(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
	const record = plainRecord(value, name);
	const actual = Reflect.ownKeys(record);
	if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
		|| keys.some((key) => !actual.includes(key))) throw new TypeError(`${name} has an invalid closed field shape.`);
	for (const key of keys) ownData(record, key, name);
	return record;
}
function plainRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new TypeError(`${name} must be a plain record.`);
	return value as Record<string, unknown>;
}
function ownData(record: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name}.${key} must be an enumerable data field.`);
	return descriptor.value;
}
function denseArray(value: unknown, name: string, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`${name} must be a bounded dense array.`);
	}
	for (let index = 0; index < value.length; index += 1) {
		ownData(value as unknown as Record<string, unknown>, String(index), name);
	}
	return value;
}
function id(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096) throw new TypeError(`${name} must be a bounded ID.`);
	return value;
}
function nonNegativeInteger(value: unknown, name: string): number { const result = safeInteger(value, name); if (result < 0) throw new RangeError(`${name} must be non-negative.`); return result; }
function positiveInteger(value: unknown, name: string): number { const result = safeInteger(value, name); if (result <= 0) throw new RangeError(`${name} must be positive.`); return result; }
function safeInteger(value: unknown, name: string): number { if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`); return Number(value); }
function outputIndex(value: unknown, count: number): number { const index = nonNegativeInteger(value, 'output ordinal'); if (index >= count) throw new RangeError('Output ordinal is outside its range.'); return index; }
function required<Value>(value: Value | null | undefined): Value { if (value == null) throw new RangeError('Expected exact retime state.'); return value; }
