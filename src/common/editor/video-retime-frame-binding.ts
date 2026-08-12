/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ExactVideoRetimeRational,
	VideoRetimeCurveRational,
	VideoRetimeCurveSegment,
} from './video-retime-curve.ts';
import {
	createVideoRetimeRuntimeMapper,
	type VideoRetimeRuntimePartition,
	type VideoRetimeRuntimeQuery,
} from './video-retime-runtime-mapping.ts';
import {
	boundVideoSourceTimingViewInfo,
	videoSourceFrameTime,
	type BoundVideoSourceTimingView,
	type ExactSourcePosition,
	type ExactSourceTime,
} from './video-source-timing-view.ts';

export interface VideoRetimeFrameClipSnapshot {
	readonly id: string;
	readonly sourceId: string;
	readonly sequenceId: string;
	readonly sequenceStartFrame: number;
	readonly outerFrameCount: number;
	readonly sourceInFrame: number;
	readonly sourceOutFrame: number;
	readonly mapping: 'curve' | 'uniform-wall-clock';
	readonly segmentCount: number;
}

interface VideoRetimeFrameBindingSegmentBase {
	readonly segmentIndex: number;
	readonly startOuterCell: number;
	readonly endOuterCell: number;
	readonly sourceStart: ExactVideoRetimeRational;
	readonly sourceEnd: ExactVideoRetimeRational;
}

export interface VideoRetimeFrameBindingSegment extends VideoRetimeFrameBindingSegmentBase {
	readonly mode: VideoRetimeCurveSegment['mode'];
	readonly startVelocity?: ExactVideoRetimeRational;
	readonly endVelocity?: ExactVideoRetimeRational;
}

export interface VideoRetimeFrameDescriptor {
	readonly outerCell: number;
	readonly segmentIndex: number;
	readonly mode: VideoRetimeCurveSegment['mode'];
	readonly sourceFrame: ExactSourcePosition;
	readonly sourceTime: ExactSourceTime;
	readonly drawableSourceFrame: number;
	readonly drawableSourceStartTime: ExactSourceTime;
	readonly drawableSourceEndTime: ExactSourceTime;
}

export interface VideoRetimeTerminalBoundary {
	readonly outerBoundary: number;
	readonly sourceFrame: ExactSourcePosition;
	readonly sourceTime: ExactSourceTime;
}

export interface VideoRetimeFrameBinding {
	readonly clip: VideoRetimeFrameClipSnapshot;
	readonly timing: BoundVideoSourceTimingView;
	readonly segments: readonly VideoRetimeFrameBindingSegment[];
	readonly terminal: VideoRetimeTerminalBoundary;
	readonly mapOuterFrame: (outerFrame: VideoRetimeRuntimeQuery) => ExactVideoRetimeRational;
	readonly ownedFrameAt: (outerCell: number) => VideoRetimeFrameDescriptor;
}

type SnapshotRational = Readonly<{ readonly num: number; readonly den: number }>;
type SnapshotSegment = Readonly<
	| { readonly mode: 'constant-forward' | 'constant-reverse' | 'freeze' }
	| {
		readonly mode: 'ramp-forward' | 'ramp-reverse';
		readonly startVelocity: SnapshotRational;
		readonly endVelocity: SnapshotRational;
	}
>;
type SnapshotCurve = Readonly<{
	readonly feature: unknown;
	readonly version: unknown;
	readonly points: readonly unknown[];
	readonly segments: readonly SnapshotSegment[];
}>;
interface VideoRetimeFrameClipSnapshotState {
	readonly info: VideoRetimeFrameClipSnapshot;
	readonly mapperClip: Readonly<Record<string, unknown>>;
	readonly curve: SnapshotCurve | null;
}

const MAXIMUM_SEGMENTS = 4_096;
const RUNTIME_PROJECTION_ALIASES = Object.freeze([
	'timelineStartFrame',
	'timelineEndFrame',
	'durationFrames',
	'sourceStartFrame',
	'sourceEndFrame',
	'sourceDurationFrames',
	'sequenceEndFrame',
	'coordinateDomain',
] as const);
const VIDEO_RETIME_FRAME_CLIP_SNAPSHOTS = new WeakMap<object, VideoRetimeFrameClipSnapshotState>();

/** Snapshot one open persisted video clip and its complete V2 retime wire without invoking getters. */
export function snapshotVideoRetimeFrameClip(clipValue: unknown): VideoRetimeFrameClipSnapshot {
	const clip = plainRecord(clipValue, 'video retime frame clip');
	for (const alias of RUNTIME_PROJECTION_ALIASES) {
		if (Object.hasOwn(clip, alias)) {
			throw new TypeError('A resolved runtime projection cannot be used as a persisted video retime clip.');
		}
	}
	const values = snapshotRequiredProperties(clip, [
		'kind', 'id', 'sourceId', 'sequenceId', 'sequenceStartFrame',
		'sequenceFrameCount', 'sourceInFrame', 'sourceFrameCount', 'retimeMap',
	], 'video retime frame clip');
	if (values.kind !== 'video') throw new TypeError('A video retime frame binding requires a video clip.');
	const id = nonEmptyString(values.id, 'video retime frame clip.id');
	const sourceId = nonEmptyString(values.sourceId, 'video retime frame clip.sourceId');
	const sequenceId = nonEmptyString(values.sequenceId, 'video retime frame clip.sequenceId');
	const sequenceStartFrame = nonNegativeSafeInteger(
		values.sequenceStartFrame,
		'video retime frame clip.sequenceStartFrame',
	);
	const outerFrameCount = positiveSafeInteger(
		values.sequenceFrameCount,
		'video retime frame clip.sequenceFrameCount',
	);
	const sourceInFrame = nonNegativeSafeInteger(values.sourceInFrame, 'video retime frame clip.sourceInFrame');
	const sourceFrameCount = positiveSafeInteger(
		values.sourceFrameCount,
		'video retime frame clip.sourceFrameCount',
	);
	safeAdd(sequenceStartFrame, outerFrameCount, 'video retime frame clip sequence end');
	const sourceOutFrame = safeAdd(sourceInFrame, sourceFrameCount, 'video retime frame clip source end');
	const curve = values.retimeMap === null ? null : snapshotCurve(values.retimeMap);
	const info = Object.freeze({
		id,
		sourceId,
		sequenceId,
		sequenceStartFrame,
		outerFrameCount,
		sourceInFrame,
		sourceOutFrame,
		mapping: curve === null ? 'uniform-wall-clock' as const : 'curve' as const,
		segmentCount: curve?.segments.length ?? 0,
	});
	const mapperClip = Object.freeze({
		kind: 'video' as const,
		sequenceStartFrame,
		sequenceFrameCount: outerFrameCount,
		sourceInFrame,
		sourceFrameCount,
		retimeMap: curve,
	});
	VIDEO_RETIME_FRAME_CLIP_SNAPSHOTS.set(info, Object.freeze({ info, mapperClip, curve }));
	return info;
}

/** Authenticate a frame-clip snapshot before exposing its frozen canonical metadata. */
export function videoRetimeFrameClipSnapshotInfo(value: unknown): VideoRetimeFrameClipSnapshot {
	return frameClipSnapshotState(value).info;
}

/** Bind one already-snapshotted curve clip to one authenticated source timing token. */
export function createVideoRetimeFrameBindingFromSnapshot(
	clipSnapshot: VideoRetimeFrameClipSnapshot,
	timing: BoundVideoSourceTimingView,
): VideoRetimeFrameBinding {
	const state = frameClipSnapshotState(clipSnapshot);
	const timingInfo = boundVideoSourceTimingViewInfo(timing);
	if (state.curve === null) throw new TypeError('A video retime frame binding requires a non-null retime curve.');
	if (state.info.sourceId !== timingInfo.sourceId) {
		throw new RangeError('The video retime clip source must match its bound timing source.');
	}
	if (state.info.sourceOutFrame > timingInfo.frameCount) {
		throw new RangeError('The video retime clip source binding exceeds its bound timing frame count.');
	}

	const mapper = createVideoRetimeRuntimeMapper(state.mapperClip);
	const segments = createBindingSegments(mapper.partitions, state.curve.segments);
	const terminalSourceFrame = mapper.mapOuterFrame(mapper.outerFrameCount);
	const terminal = Object.freeze({
		outerBoundary: mapper.outerFrameCount,
		sourceFrame: terminalSourceFrame,
		sourceTime: videoSourceFrameTime(timing, terminalSourceFrame),
	});
	let cachedOuterCell: number | null = null;
	let cachedDescriptor: VideoRetimeFrameDescriptor | null = null;

	const ownedFrameAt = (outerCell: number): VideoRetimeFrameDescriptor => {
		assertDrawableOuterCell(outerCell, mapper.outerFrameCount);
		if (outerCell === cachedOuterCell && cachedDescriptor !== null) return cachedDescriptor;
		const segment = segmentForOuterCell(segments, outerCell);
		const sourceFrame = mapper.mapOuterFrame(outerCell);
		const drawableSourceFrame = drawableFrameForPosition(
			sourceFrame,
			segment.mode,
			mapper.sourceInFrame,
			mapper.sourceOutFrame,
		);
		const descriptor = Object.freeze({
			outerCell,
			segmentIndex: segment.segmentIndex,
			mode: segment.mode,
			sourceFrame,
			sourceTime: videoSourceFrameTime(timing, sourceFrame),
			drawableSourceFrame,
			drawableSourceStartTime: videoSourceFrameTime(timing, integerPosition(drawableSourceFrame)),
			drawableSourceEndTime: videoSourceFrameTime(timing, integerPosition(drawableSourceFrame + 1)),
		});
		cachedOuterCell = outerCell;
		cachedDescriptor = descriptor;
		return descriptor;
	};

	return Object.freeze({
		clip: state.info,
		timing,
		segments,
		terminal,
		mapOuterFrame: mapper.mapOuterFrame,
		ownedFrameAt,
	});
}

/** Snapshot and bind one persisted non-null retimed video clip. */
export function createVideoRetimeFrameBinding(
	clipValue: unknown,
	timing: BoundVideoSourceTimingView,
): VideoRetimeFrameBinding {
	return createVideoRetimeFrameBindingFromSnapshot(snapshotVideoRetimeFrameClip(clipValue), timing);
}

function createBindingSegments(
	partitions: readonly VideoRetimeRuntimePartition[],
	curveSegments: readonly SnapshotSegment[],
): readonly VideoRetimeFrameBindingSegment[] {
	if (partitions.length !== curveSegments.length) {
		throw new RangeError('A compiled video retime curve has inconsistent segment metadata.');
	}
	return Object.freeze(partitions.map((partition, index): VideoRetimeFrameBindingSegment => {
		const curveSegment = required(curveSegments[index]);
		if (partition.mode !== curveSegment.mode) {
			throw new RangeError('A compiled video retime curve has inconsistent segment modes.');
		}
		const base = {
			segmentIndex: partition.segmentIndex,
			mode: partition.mode,
			startOuterCell: partition.startOuterFrame,
			endOuterCell: partition.endOuterFrame,
			sourceStart: partition.startSourceFrame,
			sourceEnd: partition.endSourceFrame,
		};
		if (curveSegment.mode === 'ramp-forward' || curveSegment.mode === 'ramp-reverse') {
			return Object.freeze({
				...base,
				mode: curveSegment.mode,
				startVelocity: exactInputRational(curveSegment.startVelocity),
				endVelocity: exactInputRational(curveSegment.endVelocity),
			});
		}
		return Object.freeze({ ...base, mode: curveSegment.mode });
	}));
}

function segmentForOuterCell(
	segments: readonly VideoRetimeFrameBindingSegment[],
	outerCell: number,
): VideoRetimeFrameBindingSegment {
	let lower = 0;
	let upper = segments.length;
	while (lower + 1 < upper) {
		const middle = lower + Math.floor((upper - lower) / 2);
		if (required(segments[middle]).startOuterCell <= outerCell) lower = middle;
		else upper = middle;
	}
	return required(segments[lower]);
}

function drawableFrameForPosition(
	position: ExactSourcePosition,
	mode: VideoRetimeCurveSegment['mode'],
	sourceInFrame: number,
	sourceOutFrame: number,
): number {
	const owned = mode === 'constant-reverse' || mode === 'ramp-reverse'
		? ceiling(position) - 1n
		: floor(position);
	const lower = BigInt(sourceInFrame);
	const upper = BigInt(sourceOutFrame - 1);
	return Number(owned < lower ? lower : owned > upper ? upper : owned);
}

function snapshotCurve(value: unknown): SnapshotCurve {
	const map = snapshotClosedRecord(
		value,
		'video retime map',
		['feature', 'version', 'points', 'segments'],
	);
	const pointCount = snapshotDenseArrayLength(
		map.points,
		'video retime map.points',
		MAXIMUM_SEGMENTS + 1,
	);
	const segmentCount = snapshotDenseArrayLength(
		map.segments,
		'video retime map.segments',
		MAXIMUM_SEGMENTS,
	);
	if (segmentCount < 1 || pointCount !== segmentCount + 1) {
		throw new RangeError('A video retime map must have exactly one more point than segment.');
	}
	const points = snapshotDenseArray(map.points, 'video retime map.points', pointCount, snapshotPoint);
	const segments = snapshotDenseArray(map.segments, 'video retime map.segments', segmentCount, snapshotSegment);
	return Object.freeze({ feature: map.feature, version: map.version, points, segments });
}

function snapshotPoint(value: unknown, name: string): Readonly<Record<string, unknown>> {
	const point = snapshotClosedRecord(value, name, ['outerFrame', 'sourceFrame']);
	return Object.freeze({ outerFrame: point.outerFrame, sourceFrame: snapshotRational(point.sourceFrame, `${name}.sourceFrame`) });
}

function snapshotSegment(value: unknown, name: string): SnapshotSegment {
	const segment = snapshotClosedRecord(value, name, ['mode'], ['startVelocity', 'endVelocity']);
	if (segment.mode === 'constant-forward' || segment.mode === 'constant-reverse' || segment.mode === 'freeze') {
		if (Object.hasOwn(segment, 'startVelocity') || Object.hasOwn(segment, 'endVelocity')) {
			throw new TypeError(`${name} contains unsupported velocity fields.`);
		}
		return Object.freeze({ mode: segment.mode });
	}
	if (segment.mode === 'ramp-forward' || segment.mode === 'ramp-reverse') {
		if (!Object.hasOwn(segment, 'startVelocity') || !Object.hasOwn(segment, 'endVelocity')) {
			throw new TypeError(`${name} requires startVelocity and endVelocity.`);
		}
		return Object.freeze({
			mode: segment.mode,
			startVelocity: snapshotRational(segment.startVelocity, `${name}.startVelocity`),
			endVelocity: snapshotRational(segment.endVelocity, `${name}.endVelocity`),
		});
	}
	throw new RangeError(`${name}.mode is unsupported.`);
}

function snapshotRational(value: unknown, name: string): SnapshotRational {
	const rational = snapshotClosedRecord(value, name, ['num', 'den']);
	return Object.freeze({
		num: safeInteger(rational.num, `${name}.num`),
		den: positiveSafeInteger(rational.den, `${name}.den`),
	});
}

function snapshotDenseArray<Value>(
	value: unknown,
	name: string,
	length: number,
	snapshotItem: (item: unknown, name: string) => Value,
): readonly Value[] {
	const array = value as readonly unknown[];
	const keys = Reflect.ownKeys(array);
	const keySet = new Set(keys);
	if (keys.length !== length + 1 || !keySet.has('length')) throw new TypeError(`${name} must be dense.`);
	const result: Value[] = [];
	for (let index = 0; index < length; index += 1) {
		const key = String(index);
		if (!keySet.has(key)) throw new TypeError(`${name} must be dense.`);
		const descriptor = Object.getOwnPropertyDescriptor(array, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}[${key}] must be an enumerable data property, not an accessor.`);
		}
		result.push(snapshotItem(descriptor.value, `${name}[${key}]`));
	}
	return Object.freeze(result);
}

function snapshotDenseArrayLength(value: unknown, name: string, maximumLength: number): number {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must be a standard dense array.`);
	}
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')
		|| !Number.isSafeInteger(lengthDescriptor.value) || Number(lengthDescriptor.value) < 0) {
		throw new TypeError(`${name}.length must be an own data property.`);
	}
	const length = Number(lengthDescriptor.value);
	if (length > maximumLength) throw new RangeError(`${name} exceeds its bounded length.`);
	return length;
}

function snapshotClosedRecord(
	value: unknown,
	name: string,
	requiredKeys: readonly string[],
	optionalKeys: readonly string[] = [],
): Readonly<Record<string, unknown>> {
	const record = plainRecord(value, name);
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
			throw new TypeError(`${name}.${String(key)} must be an enumerable data property, not an accessor.`);
		}
		snapshot[String(key)] = descriptor.value;
	}
	return Object.freeze(snapshot);
}

function snapshotRequiredProperties(
	value: Record<string, unknown>,
	keys: readonly string[],
	name: string,
): Readonly<Record<string, unknown>> {
	const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property, not an accessor.`);
		}
		snapshot[key] = descriptor.value;
	}
	return Object.freeze(snapshot);
}

function frameClipSnapshotState(value: unknown): VideoRetimeFrameClipSnapshotState {
	if (!value || typeof value !== 'object') throw new TypeError('An authenticated video retime frame clip snapshot is required.');
	const state = VIDEO_RETIME_FRAME_CLIP_SNAPSHOTS.get(value);
	if (!state) throw new TypeError('A forged video retime frame clip snapshot is not accepted.');
	return state;
}

function plainRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a plain record.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must have a plain record prototype.`);
	return value as Record<string, unknown>;
}

function exactInputRational(value: VideoRetimeCurveRational): ExactVideoRetimeRational {
	return Object.freeze({ numerator: BigInt(value.num), denominator: BigInt(value.den) });
}

function floor(position: ExactSourcePosition): bigint {
	const quotient = position.numerator / position.denominator;
	return position.numerator % position.denominator < 0n ? quotient - 1n : quotient;
}

function ceiling(position: ExactSourcePosition): bigint {
	const quotient = position.numerator / position.denominator;
	return position.numerator % position.denominator > 0n ? quotient + 1n : quotient;
}

function integerPosition(frame: number): ExactSourcePosition {
	return Object.freeze({ numerator: BigInt(frame), denominator: 1n });
}

function assertDrawableOuterCell(value: unknown, outerFrameCount: number): asserts value is number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= outerFrameCount) {
		throw new RangeError('A drawable video retime outer cell must be a safe integer inside its cell domain.');
	}
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function safeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`);
	return Number(value);
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

function safeAdd(left: number, right: number, name: string): number {
	const result = BigInt(left) + BigInt(right);
	if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return Number(result);
}

function required<Value>(value: Value | null | undefined): Value {
	if (value == null) throw new RangeError('Expected bounded video retime frame metadata.');
	return value;
}
