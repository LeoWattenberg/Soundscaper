/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	rebindVideoKeyframeCarrierEffects,
	trimVideoKeyframeCarrierToSequenceRange,
	transformVideoKeyframeCarrierFromSourceBounds,
	videoKeyframeSequencePositionAtTimelineFrame,
} from './video-keyframe-carrier.ts';
import { isRuntimeProjectProjection } from '../runtime-clip-projection.ts';
import { VIDEO_KEYFRAME_CARRIER_EDITED } from './command-projection-transients.ts';

type DataRecord = Record<string, unknown>;

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

function safeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`);
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result <= 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}
