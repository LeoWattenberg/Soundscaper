/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact source-presentation and forward-retime binding for selected video assistance. */

import { roundRational } from '../timeline-time.ts';
import {
	createVideoRetimeRuntimeMapper,
	type VideoRetimeRuntimeMapper,
} from '../video-retime-runtime-mapping.ts';
import {
	bindVideoSourceTimingView,
	boundVideoSourceTimingAuthority,
	compareSourceTimes,
	sourceTimeDifference,
	videoSourceFrameTime,
	type BoundVideoSourceTimingView,
	type ExactSourcePosition,
	type ExactSourceTime,
	type VideoSourceTimingView,
} from '../video-source-timing-view.ts';
import { resolveVideoSourceTimingViews } from '../video-source-timing-views.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export interface LocalAssistanceSelectedVideoTimingBinding {
	readonly sourceTimingKind: 'cfr' | 'vfr';
	readonly mappingKind: 'uniform-wall-clock' | 'forward-retime-v2';
	readonly fenceMaterial: DataRecord;
}

export interface LocalAssistanceSelectedVideoTimingGeometry {
	readonly sequenceStart: number;
	readonly sequenceCount: number;
	readonly sequenceEnd: number;
	readonly sourceStart: number;
	readonly sourceEnd: number;
}

export interface LocalAssistanceSelectedVideoFrameTiming {
	readonly sourceFrame: number;
	readonly presentationTick: string;
	readonly timestampSeconds: number;
}

export interface LocalAssistanceSelectedVideoFramePackTiming {
	readonly timescale: number;
	readonly frames: readonly LocalAssistanceSelectedVideoFrameTiming[];
}

export interface LocalAssistanceSelectedVideoSourceFrameTick {
	readonly timescale: number;
	readonly sourceFrame: number;
	readonly presentationTick: string;
}

export const LOCAL_ASSISTANCE_REFRAME_MAXIMUM_SAMPLED_FRAMES = 100_000;

interface TimingState {
	readonly timing: BoundVideoSourceTimingView;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly sequenceStartFrame: number;
	readonly sequenceFrameCount: number;
	readonly mapper: VideoRetimeRuntimeMapper | null;
}

const BINDING_STATES = new WeakMap<object, TimingState>();

export function createLocalAssistanceSelectedVideoTimingBinding(
	project: unknown,
	clip: DataRecord,
	source: DataRecord,
	sequence: DataRecord,
	geometry: LocalAssistanceSelectedVideoTimingGeometry,
): LocalAssistanceSelectedVideoTimingBinding {
	if (clip.reversed === true) {
		throw new Error('Selected-video preparation refuses reverse occurrence timing.');
	}
	if (clip.speedRatio !== 1) {
		throw new Error('Selected-video preparation refuses an unverifiable legacy speed ratio.');
	}
	const decision = record(source.timingDecision, 'video timing decision');
	const frameRate = rational(source.frameRate, 'source frame rate');
	const decisionRate = rational(decision.rate, 'timing-decision rate');
	const sequenceRate = rational(sequence.rate, 'sequence frame rate');
	if (!sameRational(frameRate, decisionRate)) {
		throw new Error('Selected-video preparation source timing rates disagree.');
	}
	const views = resolveVideoSourceTimingViews(project);
	const view = timingViewFor(views, source);
	const timing = bindVideoSourceTimingView(views, source);
	const sourceStartTime = videoSourceFrameTime(timing, position(geometry.sourceStart));
	const sourceEndTime = videoSourceFrameTime(timing, position(geometry.sourceEnd));
	if (compareSourceTimes(sourceStartTime, sourceEndTime) >= 0) {
		throw new Error('Selected-video preparation requires monotonic forward source timing.');
	}
	const mapper = forwardMapper(clip, geometry);
	const mappingMaterial = mapper === null
		? Object.freeze({ kind: 'uniform-wall-clock' as const })
		: Object.freeze({
			kind: 'forward-retime-v2' as const,
			partitions: Object.freeze(mapper.partitions.map((partition) => Object.freeze({
				segmentIndex: partition.segmentIndex,
				mode: partition.mode,
				startOuterFrame: partition.startOuterFrame,
				endOuterFrame: partition.endOuterFrame,
				startSourceFrame: decimal(partition.startSourceFrame),
				endSourceFrame: decimal(partition.endSourceFrame),
			}))),
		});
	const binding = Object.freeze({
		sourceTimingKind: view.kind,
		mappingKind: mapper === null
			? 'uniform-wall-clock' as const : 'forward-retime-v2' as const,
		fenceMaterial: Object.freeze({
			schemaVersion: 1,
			sourceId: source.id,
			sourceSha256: source.contentSha256,
			sourceTiming: boundVideoSourceTimingAuthority(timing),
			sourcePresentationRange: Object.freeze({
				start: decimal(sourceStartTime),
				end: decimal(sourceEndTime),
			}),
			sequence: Object.freeze({
				id: sequence.id,
				rate: sequenceRate,
				startFrame: geometry.sequenceStart,
				endFrame: geometry.sequenceEnd,
			}),
			sourceRange: Object.freeze({
				startFrame: geometry.sourceStart,
				endFrame: geometry.sourceEnd,
			}),
			mapping: mappingMaterial,
		}),
	});
	BINDING_STATES.set(binding, Object.freeze({
		timing,
		sourceStartFrame: geometry.sourceStart,
		sourceEndFrame: geometry.sourceEnd,
		sequenceStartFrame: geometry.sequenceStart,
		sequenceFrameCount: geometry.sequenceCount,
		mapper,
	}));
	return binding;
}

export function mapLocalAssistanceSelectedVideoTimingBoundary(
	binding: LocalAssistanceSelectedVideoTimingBinding,
	sourceFrameValue: number,
): number | null {
	const state = BINDING_STATES.get(binding);
	if (!state) {
		throw new TypeError('Selected-video boundary mapping requires authenticated timing authority.');
	}
	const sourceFrame = integer(sourceFrameValue, 0, 'source boundary frame');
	if (sourceFrame < state.sourceStartFrame || sourceFrame > state.sourceEndFrame) return null;
	const outerFrame = state.mapper === null
		? mapUniformBoundary(state, sourceFrame)
		: mapRetimedBoundary(state.mapper, sourceFrame);
	if (outerFrame === null) return null;
	if (outerFrame < 0 || outerFrame > state.sequenceFrameCount) {
		throw new RangeError('Selected-video boundary mapping escaped its sequence authority.');
	}
	return safeAdd(state.sequenceStartFrame, outerFrame, 'mapped sequence boundary');
}

/**
 * Map only a source boundary that the persisted occurrence can reproduce exactly. Uniform
 * wall-clock clips retain their canonical frame-grid rounding; forward retimes must invert to an
 * exact outer-frame point because highlight publication cannot persist a fractional source cut.
 */
export function mapLocalAssistanceSelectedVideoExactTimingBoundary(
	binding: LocalAssistanceSelectedVideoTimingBinding,
	sourceFrameValue: number,
): number | null {
	const state = BINDING_STATES.get(binding);
	if (!state) {
		throw new TypeError('Selected-video exact boundary mapping requires authenticated timing authority.');
	}
	const sourceFrame = integer(sourceFrameValue, 0, 'exact source boundary frame');
	if (sourceFrame < state.sourceStartFrame || sourceFrame > state.sourceEndFrame) return null;
	const outerFrame = state.mapper === null
		? mapUniformBoundary(state, sourceFrame)
		: mapExactRetimedBoundary(state.mapper, sourceFrame);
	if (outerFrame === null) return null;
	if (outerFrame < 0 || outerFrame > state.sequenceFrameCount) {
		throw new RangeError('Selected-video exact boundary mapping escaped its sequence authority.');
	}
	return safeAdd(state.sequenceStartFrame, outerFrame, 'exact mapped sequence boundary');
}

/** Exact source-domain decode points for model frame packs; retimes never rewrite source timing. */
export function createLocalAssistanceSelectedVideoFramePackTiming(
	binding: LocalAssistanceSelectedVideoTimingBinding,
): LocalAssistanceSelectedVideoFramePackTiming {
	const state = BINDING_STATES.get(binding);
	if (!state) {
		throw new TypeError('Selected-video frame packing requires authenticated timing authority.');
	}
	const authority = boundVideoSourceTimingAuthority(state.timing);
	const timescale = authority.kind === 'cfr'
		? authority.rate.num : authority.reference.timescale;
	if (!Number.isSafeInteger(timescale) || timescale < 1 || timescale > 0x7fff_ffff) {
		throw new RangeError('Selected-video frame-pack timescale exceeds its exact binary domain.');
	}
	const frames: LocalAssistanceSelectedVideoFrameTiming[] = [];
	for (let sourceFrame = state.sourceStartFrame;
		sourceFrame < state.sourceEndFrame; sourceFrame += 1) {
		const start = videoSourceFrameTime(state.timing, position(sourceFrame));
		const end = videoSourceFrameTime(state.timing, position(sourceFrame + 1));
		frames.push(Object.freeze({
			sourceFrame,
			presentationTick: exactTick(start, timescale).toString(),
			timestampSeconds: midpointSeconds(start, end),
		}));
	}
	if (frames.length < 1) throw new RangeError('Selected-video frame packing requires a non-empty range.');
	return Object.freeze({ timescale, frames: Object.freeze(frames) });
}

/** Deterministic source-time samples at 2 fps, unioned with authenticated shot anchors. */
export function createLocalAssistanceSelectedVideoReframeFramePackTiming(
	binding: LocalAssistanceSelectedVideoTimingBinding,
	shotAnchorFramesValue: readonly number[],
): LocalAssistanceSelectedVideoFramePackTiming {
	const state = BINDING_STATES.get(binding);
	if (!state) {
		throw new TypeError('Reframe frame sampling requires authenticated timing authority.');
	}
	if (!Array.isArray(shotAnchorFramesValue)
		|| shotAnchorFramesValue.length > LOCAL_ASSISTANCE_REFRAME_MAXIMUM_SAMPLED_FRAMES) {
		throw new RangeError('Reframe shot anchors exceed their exact frame bound.');
	}
	const selected = new Set<number>();
	const rangeStart = videoSourceFrameTime(state.timing, position(state.sourceStartFrame));
	const rangeEnd = videoSourceFrameTime(state.timing, position(state.sourceEndFrame));
	for (let ordinal = 0; ; ordinal += 1) {
		const target = halfSecondOffset(rangeStart, ordinal);
		if (compareSourceTimes(target, rangeEnd) >= 0) break;
		if (ordinal >= LOCAL_ASSISTANCE_REFRAME_MAXIMUM_SAMPLED_FRAMES) {
			throw new RangeError('Reframe 2 fps sampling exceeds its exact frame bound.');
		}
		selected.add(sourceFrameContaining(state, target));
	}
	let priorAnchor = -1;
	for (const anchorValue of shotAnchorFramesValue) {
		const anchor = integer(anchorValue, 0, 'Reframe shot-anchor frame');
		if (anchor <= priorAnchor || anchor < state.sourceStartFrame || anchor >= state.sourceEndFrame) {
			throw new RangeError('Reframe shot anchors must be ordered inside selected source authority.');
		}
		selected.add(anchor);
		priorAnchor = anchor;
	}
	if (selected.size < 1 || selected.size > LOCAL_ASSISTANCE_REFRAME_MAXIMUM_SAMPLED_FRAMES) {
		throw new RangeError('Reframe sampled frames exceed their exact inventory bound.');
	}
	const authority = boundVideoSourceTimingAuthority(state.timing);
	const timescale = authority.kind === 'cfr' ? authority.rate.num : authority.reference.timescale;
	const frames = [...selected].sort((left, right) => left - right).map((sourceFrame) => {
		const start = videoSourceFrameTime(state.timing, position(sourceFrame));
		const end = videoSourceFrameTime(state.timing, position(sourceFrame + 1));
		return Object.freeze({ sourceFrame, presentationTick: exactTick(start, timescale).toString(),
			timestampSeconds: midpointSeconds(start, end) });
	});
	return Object.freeze({ timescale, frames: Object.freeze(frames) });
}

/** Read one exact source-frame tick without materializing the complete selected range. */
export function readLocalAssistanceSelectedVideoSourceFrameTick(
	binding: LocalAssistanceSelectedVideoTimingBinding,
	sourceFrameValue: number,
): LocalAssistanceSelectedVideoSourceFrameTick | null {
	return readSourceTick(binding, sourceFrameValue, false);
}

/** Read one exact source-boundary tick, including the selected exclusive end. */
export function readLocalAssistanceSelectedVideoSourceBoundaryTick(
	binding: LocalAssistanceSelectedVideoTimingBinding,
	sourceFrameValue: number,
): LocalAssistanceSelectedVideoSourceFrameTick | null {
	return readSourceTick(binding, sourceFrameValue, true);
}

function readSourceTick(
	binding: LocalAssistanceSelectedVideoTimingBinding,
	sourceFrameValue: number,
	includeEnd: boolean,
): LocalAssistanceSelectedVideoSourceFrameTick | null {
	const state = BINDING_STATES.get(binding);
	if (!state) {
		throw new TypeError('Selected-video frame timing requires authenticated timing authority.');
	}
	const sourceFrame = integer(sourceFrameValue, 0, 'source frame');
	if (sourceFrame < state.sourceStartFrame
		|| sourceFrame > state.sourceEndFrame
		|| !includeEnd && sourceFrame === state.sourceEndFrame) return null;
	const authority = boundVideoSourceTimingAuthority(state.timing);
	const timescale = authority.kind === 'cfr'
		? authority.rate.num : authority.reference.timescale;
	if (!Number.isSafeInteger(timescale) || timescale < 1 || timescale > 0x7fff_ffff) {
		throw new RangeError('Selected-video presentation timescale exceeds its exact binary domain.');
	}
	const tick = exactTick(videoSourceFrameTime(state.timing, position(sourceFrame)), timescale);
	return Object.freeze({ timescale, sourceFrame, presentationTick: tick.toString() });
}

function forwardMapper(
	clip: DataRecord,
	geometry: LocalAssistanceSelectedVideoTimingGeometry,
): VideoRetimeRuntimeMapper | null {
	if (clip.retimeMap === null) return null;
	const mapper = createVideoRetimeRuntimeMapper(clip);
	for (const partition of mapper.partitions) {
		if (partition.mode !== 'constant-forward' && partition.mode !== 'ramp-forward') {
			throw new Error(
				`Selected-video preparation refuses ${partition.mode} retime authority; forward motion is required.`,
			);
		}
		if (comparePosition(partition.startSourceFrame, partition.endSourceFrame) >= 0) {
			throw new Error('Selected-video preparation refuses non-monotonic retime authority.');
		}
	}
	if (comparePosition(mapper.mapOuterFrame(0), position(geometry.sourceStart)) !== 0
		|| comparePosition(
			mapper.mapOuterFrame(geometry.sequenceCount),
			position(geometry.sourceEnd),
		) !== 0) {
		throw new Error('Selected-video forward retime must bind the exact selected source range.');
	}
	return mapper;
}

function timingViewFor(
	views: ReadonlyMap<string, VideoSourceTimingView>,
	source: DataRecord,
): VideoSourceTimingView {
	const sourceId = identifier(source.id, 'source ID');
	const view = views.get(sourceId);
	if (!view) {
		throw new ReferenceError(
			`Selected-video preparation has no verified timing view for source ${sourceId}.`,
		);
	}
	return view;
}

function mapUniformBoundary(state: TimingState, sourceFrame: number): number {
	const start = videoSourceFrameTime(state.timing, position(state.sourceStartFrame));
	const end = videoSourceFrameTime(state.timing, position(state.sourceEndFrame));
	const target = videoSourceFrameTime(state.timing, position(sourceFrame));
	const elapsed = sourceTimeDifference(target, start);
	const duration = sourceTimeDifference(end, start);
	if (elapsed.numerator < 0n || duration.numerator <= 0n
		|| compareSourceTimes(elapsed, duration) > 0) {
		throw new RangeError('Selected-video source timing escaped its admitted presentation range.');
	}
	return roundRational(
		elapsed.numerator * duration.denominator * BigInt(state.sequenceFrameCount),
		elapsed.denominator * duration.numerator,
		'point',
	);
}

function mapRetimedBoundary(mapper: VideoRetimeRuntimeMapper, sourceFrame: number): number | null {
	const occurrences = mapper.invertSourceFrame({ num: sourceFrame, den: 1 }, { policy: 'all' });
	if (occurrences.length === 0) return null;
	if (occurrences.length !== 1) {
		throw new Error('Selected-video forward retime inversion became ambiguous.');
	}
	const occurrence = occurrences[0]!;
	if (occurrence.kind === 'point') return occurrence.outerFrame;
	if (occurrence.kind !== 'bracket') {
		throw new Error('Selected-video forward retime inversion produced a non-monotonic range.');
	}
	const target = position(sourceFrame);
	const before = mapper.mapOuterFrame(occurrence.beforeOuterFrame);
	const after = mapper.mapOuterFrame(occurrence.afterOuterFrame);
	return compareDistance(before, after, target) < 0
		? occurrence.beforeOuterFrame : occurrence.afterOuterFrame;
}

function mapExactRetimedBoundary(mapper: VideoRetimeRuntimeMapper, sourceFrame: number): number | null {
	const occurrences = mapper.invertSourceFrame({ num: sourceFrame, den: 1 }, { policy: 'all' });
	if (occurrences.length === 0) return null;
	if (occurrences.length !== 1) {
		throw new Error('Selected-video exact forward-retime inversion became ambiguous.');
	}
	return occurrences[0]!.kind === 'point' ? occurrences[0]!.outerFrame : null;
}

function compareDistance(
	left: ExactSourcePosition,
	right: ExactSourcePosition,
	target: ExactSourcePosition,
): -1 | 0 | 1 {
	const leftDistance = absolute(
		left.numerator * target.denominator - target.numerator * left.denominator,
	);
	const rightDistance = absolute(
		right.numerator * target.denominator - target.numerator * right.denominator,
	);
	const difference = leftDistance * right.denominator - rightDistance * left.denominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function sourceFrameContaining(state: TimingState, target: ExactSourceTime): number {
	let low = state.sourceStartFrame;
	let high = state.sourceEndFrame - 1;
	while (low < high) {
		const middle = low + Math.ceil((high - low) / 2);
		const start = videoSourceFrameTime(state.timing, position(middle));
		if (compareSourceTimes(start, target) <= 0) low = middle;
		else high = middle - 1;
	}
	const end = videoSourceFrameTime(state.timing, position(low + 1));
	if (compareSourceTimes(target, end) >= 0) {
		throw new RangeError('Reframe sample escaped exact source-frame timing.');
	}
	return low;
}

function halfSecondOffset(start: ExactSourceTime, ordinal: number): ExactSourceTime {
	return Object.freeze({
		numerator: start.numerator * 2n + BigInt(ordinal) * start.denominator,
		denominator: start.denominator * 2n,
	});
}

function comparePosition(left: ExactSourcePosition, right: ExactSourcePosition): -1 | 0 | 1 {
	const difference = left.numerator * right.denominator - right.numerator * left.denominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function position(frame: number): ExactSourcePosition {
	return Object.freeze({ numerator: BigInt(frame), denominator: 1n });
}

function exactTick(value: ExactSourceTime, timescale: number): bigint {
	const numerator = value.numerator * BigInt(timescale);
	if (numerator < 0n || numerator % value.denominator !== 0n) {
		throw new RangeError('Selected-video presentation time is not exactly representable in its timescale.');
	}
	return numerator / value.denominator;
}

function midpointSeconds(start: ExactSourceTime, end: ExactSourceTime): number {
	const numerator = start.numerator * end.denominator + end.numerator * start.denominator;
	const denominator = 2n * start.denominator * end.denominator;
	const result = Number(numerator) / Number(denominator);
	if (!Number.isFinite(result) || result < 0) {
		throw new RangeError('Selected-video frame midpoint exceeds browser decode timing.');
	}
	return result;
}

function decimal(value: ExactSourcePosition | ExactSourceTime): DataRecord {
	return Object.freeze({
		numerator: value.numerator.toString(),
		denominator: value.denominator.toString(),
	});
}

function record(value: unknown, label: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`The selected ${label} is invalid.`);
	}
	return value as DataRecord;
}

function rational(value: unknown, label: string): Readonly<{ num: number; den: number }> {
	const valueRecord = record(value, label);
	return Object.freeze({
		num: integer(valueRecord.num, 1, `${label} numerator`),
		den: integer(valueRecord.den, 1, `${label} denominator`),
	});
}

function sameRational(
	left: Readonly<{ num: number; den: number }>,
	right: Readonly<{ num: number; den: number }>,
): boolean {
	return BigInt(left.num) * BigInt(right.den) === BigInt(right.num) * BigInt(left.den);
}

function integer(value: unknown, minimum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The selected ${label} is invalid.`);
	}
	return Number(value);
}

function identifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError(`The selected ${label} is invalid.`);
	}
	return value;
}

function safeAdd(left: number, right: number, label: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`The selected ${label} is invalid.`);
	return result;
}

function absolute(value: bigint): bigint {
	return value < 0n ? -value : value;
}
