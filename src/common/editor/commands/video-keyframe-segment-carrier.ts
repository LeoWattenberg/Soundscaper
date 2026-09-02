/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	rebindVideoKeyframeCarrierEffects,
	trimVideoKeyframeCarrierToSequenceRange,
	transformVideoKeyframeCarrier,
	transformVideoKeyframeCarrierFromSourceBounds,
	videoKeyframeSequencePositionAtTimelineFrame,
} from './video-keyframe-carrier.ts';
import { isRuntimeProjectProjection } from '../runtime-clip-projection.ts';
import { VIDEO_KEYFRAME_CARRIER_EDITED } from './command-projection-transients.ts';
import { applyCanonicalVideoTransformPlacement } from './canonical-video-transform-placement.ts';
import { positiveSafeInteger, safeInteger } from './scalar-guards.ts';

type DataRecord = Record<string, unknown>;

interface SequenceTrimRange { readonly startFrame: number; readonly endFrame: number }

/** Apply canonical placement plus an optional exact range in the source clip's local sequence space. */
export function applyCanonicalVideoKeyframeTransform(
	project: unknown,
	source: DataRecord,
	track: unknown,
	result: DataRecord,
	placementValue: unknown,
	trimRangeValue: unknown,
	changes: unknown,
	name: string,
): Readonly<{
	readonly sequencePlacement: Readonly<{ sequenceStartFrame: number; sequenceFrameCount: number }>;
	readonly sequenceTrimRange: SequenceTrimRange | null;
	readonly updated: DataRecord;
}> | null {
	if (placementValue === undefined) {
		if (trimRangeValue !== undefined) throw new TypeError(`${name} sequence trim range requires canonical placement.`);
		return null;
	}
	const placement = applyCanonicalVideoTransformPlacement(project, source, track, result, placementValue);
	const sequenceTrimRange = trimRangeValue === undefined
		? null
		: normalizeSequenceTrimRange(trimRangeValue, placement.sequencePlacement.sequenceFrameCount, name);
	if (!sequenceTrimRange) {
		assertCanonicalPlacementWithoutTrim(source, placement.updated, name);
		return {
			...placement,
			sequenceTrimRange,
			updated: transformVideoKeyframeCarrier(
				placement.updated, source, placement.updated, changes, name,
			),
		};
	}
	const sourceStart = safeInteger(source.sequenceStartFrame, `${name}.sequenceStartFrame`);
	const trimStart = safeAdd(sourceStart, sequenceTrimRange.startFrame, `${name} keyframe trim start`);
	const trimEnd = safeAdd(sourceStart, sequenceTrimRange.endFrame, `${name} keyframe trim end`);
	if (trimStart < 0) throw new RangeError(`${name} keyframe trim starts before the sequence.`);
	return {
		...placement,
		sequenceTrimRange,
		updated: trimVideoKeyframeCarrierToSequenceRange(
			placement.updated,
			source,
			trimStart,
			trimEnd,
			name,
		),
	};
}

function assertCanonicalPlacementWithoutTrim(
	source: DataRecord,
	result: DataRecord,
	name: string,
): void {
	if (hasOwnCarrier(source) && (source.sourceStartFrame !== result.sourceStartFrame
		|| source.sourceDurationFrames !== result.sourceDurationFrames)) {
		throw new RangeError(`${name} source-changing canonical placement requires an exact sequence trim range.`);
	}
}

/** Mark child-ordered carrier ownership only on a transient command projection. */
export function markVideoKeyframeCarrierEdited(project: unknown, clip: DataRecord): void {
	if (isRuntimeProjectProjection(project as never)) {
		(clip as Record<PropertyKey, unknown>)[VIDEO_KEYFRAME_CARRIER_EDITED] = true;
	}
}

/** Apply exact view trimming and optional effect-ID rebinding to a new clip segment. */
export function finalizeVideoKeyframeSegmentCarrier<Result extends DataRecord>(
	project: unknown,
	result: Result,
	source: unknown,
	segmentStartFrame: number,
	segmentEndFrame: number,
	rebindEffects: boolean,
	name: string,
): Result {
	if (!hasOwnCarrier(source)) return result;
	const clip = source as DataRecord;
	const localStart = videoKeyframeSequencePositionAtTimelineFrame(project, clip, segmentStartFrame, name);
	const localEnd = videoKeyframeSequencePositionAtTimelineFrame(project, clip, segmentEndFrame, name);
	if (localStart === null || localEnd === null) throw new Error(`${name} lost its keyframe sequence range.`);
	const rebound = rebindEffects
		? rebindVideoKeyframeCarrierEffects(result, clip, result, name)
		: result;
	return trimVideoKeyframeCarrierToSequenceRange(
		rebound,
		rebound,
		Number(clip.sequenceStartFrame) + localStart,
		Number(clip.sequenceStartFrame) + localEnd,
		name,
	);
}

/** Transform overwrite timing from source-local bounds and a relocation-neutral extent. */
export function transformVideoKeyframeCarrierForOverwrite<Result extends DataRecord>(
	project: unknown,
	result: Result,
	source: unknown,
	changes: unknown,
	name: string,
): Result {
	if (!hasOwnCarrier(source)) return result;
	const clip = source as DataRecord;
	const sourceStartFrame = safeInteger(clip.timelineStartFrame, `${name}.timelineStartFrame`);
	const durationFrames = positiveSafeInteger(result.durationFrames, `${name} destination.durationFrames`);
	const localStart = videoKeyframeSequencePositionAtTimelineFrame(project, clip, sourceStartFrame, name);
	const localEnd = videoKeyframeSequencePositionAtTimelineFrame(
		project,
		clip,
		safeAdd(sourceStartFrame, durationFrames, `${name} destination timeline extent`),
		name,
	);
	if (localStart === null || localEnd === null || localEnd <= localStart) {
		throw new Error(`${name} lost its keyframe sequence range.`);
	}
	return transformVideoKeyframeCarrierFromSourceBounds(result, clip, {
		...result,
		sequenceFrameCount: localEnd - localStart,
	}, changes, name);
}

function hasOwnCarrier(value: unknown): boolean {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value)
		&& Object.getOwnPropertyDescriptor(value, 'videoKeyframes'));
}

function normalizeSequenceTrimRange(
	value: unknown,
	sequenceFrameCount: number,
	name: string,
): SequenceTrimRange {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} sequence trim range must be an object.`);
	}
	const candidate = value as Record<string, unknown>;
	const prototype = Object.getPrototypeOf(candidate) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} sequence trim range must be a plain object.`);
	}
	const keys = Reflect.ownKeys(candidate);
	if (keys.length !== 2 || !keys.includes('startFrame') || !keys.includes('endFrame')) {
		throw new TypeError(`${name} sequence trim range must contain only startFrame and endFrame.`);
	}
	const startFrame = rangeField(candidate, 'startFrame', name);
	const endFrame = rangeField(candidate, 'endFrame', name);
	if (safeAdd(endFrame, -startFrame, `${name} sequence trim duration`) !== sequenceFrameCount) {
		throw new RangeError(`${name} sequence trim range must match canonical placement duration.`);
	}
	return Object.freeze({ startFrame, endFrame });
}

function rangeField(value: Record<string, unknown>, key: string, name: string): number {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name} sequence trim range fields must be enumerable data properties.`);
	}
	return safeInteger(descriptor.value, `${name} sequence trim range.${key}`);
}


function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}
