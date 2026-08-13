/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	joinVideoKeyframeCurves,
	normalizeVideoKeyframeCurves,
	splitVideoKeyframeCurvesAt,
	stretchVideoKeyframeCurves,
	trimVideoKeyframeCurvesToRange,
	type VideoKeyframeCurves,
} from '../video-keyframe-curves.ts';
import { multiplyDivideRationals, sampleFrameToVideoFrame } from '../timeline-time.ts';

type DataRecord = Record<string, unknown>;

const NO_KEYFRAMES = Object.freeze({});

/** Snapshot an optional V20 keyframe carrier using the clip's exact live context. */
export function cloneVideoKeyframeCarrierFields(
	value: unknown,
	name = 'video clip',
): Readonly<{ readonly videoKeyframes?: VideoKeyframeCurves }> {
	const clip = optionalKeyframedVideoClip(value, name);
	if (!clip) return NO_KEYFRAMES;
	return Object.freeze({
		videoKeyframes: normalizeVideoKeyframeCurves(
			clip.videoKeyframes,
			keyframeContext(clip, name),
			`${name}.videoKeyframes`,
		),
	});
}

/** Replace a spread-carried value with one detached canonical keyframe snapshot. */
export function detachVideoKeyframeCarrier<Result extends DataRecord>(
	result: Result,
	source: unknown,
	name = 'video clip',
): Result {
	const fields = cloneVideoKeyframeCarrierFields(source, name);
	return Object.hasOwn(fields, 'videoKeyframes') ? { ...result, ...fields } : result;
}

/** Trim one clip-local sequence-frame range while retaining its complete path. */
export function trimVideoKeyframeCarrierToSequenceRange<Result extends DataRecord>(
	result: Result,
	source: unknown,
	startFrame: number,
	endFrame: number,
	name = 'video clip',
): Result {
	const clip = optionalKeyframedVideoClip(source, name);
	if (!clip) return result;
	const start = nonNegativeSafeInteger(startFrame, `${name} keyframe trim start`);
	const end = nonNegativeSafeInteger(endFrame, `${name} keyframe trim end`);
	if (end <= start) throw new RangeError(`${name} keyframe trim must have positive duration.`);
	const sourceStart = nonNegativeSafeInteger(clip.sequenceStartFrame, `${name}.sequenceStartFrame`);
	positiveSafeInteger(clip.sequenceFrameCount, `${name}.sequenceFrameCount`);
	const localStart = start - sourceStart;
	const localEnd = end - sourceStart;
	return {
		...result,
		videoKeyframes: trimVideoKeyframeCurvesToRange(
			clip.videoKeyframes,
			keyframeContext(clip, name),
			{ start: localStart, end: localEnd },
		),
	};
}

/** Reframe a carrier to one already-authoritative destination placement. */
export function trimVideoKeyframeCarrierToDestination<Result extends DataRecord>(
	result: Result,
	source: unknown,
	destination: unknown,
	name = 'video clip',
): Result {
	const target = dataRecord(destination, `${name} trim destination`);
	const start = nonNegativeSafeInteger(
		dataProperty(target, 'sequenceStartFrame', `${name} trim destination`),
		`${name} trim destination.sequenceStartFrame`,
	);
	const count = positiveSafeInteger(
		dataProperty(target, 'sequenceFrameCount', `${name} trim destination`),
		`${name} trim destination.sequenceFrameCount`,
	);
	return trimVideoKeyframeCarrierToSequenceRange(result, source, start, safeAdd(start, count, `${name} trim range`), name);
}

/** Split a carrier into two detached complete paths with partitioned views. */
export function splitVideoKeyframeCarrierFields(
	source: unknown,
	position: number,
	name = 'video clip',
): Readonly<{
	readonly left: Readonly<{ readonly videoKeyframes?: VideoKeyframeCurves }>;
	readonly right: Readonly<{ readonly videoKeyframes?: VideoKeyframeCurves }>;
}> {
	const clip = optionalKeyframedVideoClip(source, name);
	if (!clip) return Object.freeze({ left: NO_KEYFRAMES, right: NO_KEYFRAMES });
	const split = splitVideoKeyframeCurvesAt(
		clip.videoKeyframes,
		keyframeContext(clip, name),
		position,
	);
	return Object.freeze({
		left: Object.freeze({ videoKeyframes: split.left }),
		right: Object.freeze({ videoKeyframes: split.right }),
	});
}

/** Apply one canonical transform's trim/stretch semantics to an optional carrier. */
export function transformVideoKeyframeCarrier<Result extends DataRecord>(
	result: Result,
	source: unknown,
	destination: unknown,
	changes: unknown,
	name = 'video clip',
): Result {
	const sourceClip = optionalKeyframedVideoClip(source, name);
	if (!sourceClip) return result;
	const target = dataRecord(destination, `${name} transform destination`);
	dataRecord(changes ?? {}, `${name} transform changes`);
	positiveOrZero(sourceClip.sequenceStartFrame, `${name}.sequenceStartFrame`);
	const sourceCount = positiveSafeInteger(sourceClip.sequenceFrameCount, `${name}.sequenceFrameCount`);
	const targetCount = positiveSafeInteger(dataProperty(target, 'sequenceFrameCount', `${name} transform destination`), `${name} destination sequenceFrameCount`);
	const sourceChanged = sourceBoundsChanged(sourceClip, target, name);
	if (targetCount !== sourceCount && sourceChanged) {
		return trimVideoKeyframeCarrierToDestination(result, sourceClip, target, name);
	}
	return retainedOrStretchedCarrier(result, sourceClip, sourceCount, targetCount, name);
}

/** Apply overwrite timing from source-local boundary intent, independent of relocation. */
export function transformVideoKeyframeCarrierFromSourceBounds<Result extends DataRecord>(
	result: Result,
	source: unknown,
	destination: unknown,
	changes: unknown,
	name = 'video clip',
): Result {
	const sourceClip = optionalKeyframedVideoClip(source, name);
	if (!sourceClip) return result;
	const target = dataRecord(destination, `${name} transform destination`);
	dataRecord(changes ?? {}, `${name} transform changes`);
	const sourceCount = positiveSafeInteger(sourceClip.sequenceFrameCount, `${name}.sequenceFrameCount`);
	const targetCount = positiveSafeInteger(
		dataProperty(target, 'sequenceFrameCount', `${name} transform destination`),
		`${name} destination sequenceFrameCount`,
	);
	if (targetCount !== sourceCount && sourceBoundsChanged(sourceClip, target, name)) {
		const sourceStart = nonNegativeSafeInteger(sourceClip.sourceStartFrame, `${name}.sourceStartFrame`);
		const sourceDuration = positiveSafeInteger(sourceClip.sourceDurationFrames, `${name}.sourceDurationFrames`);
		const targetStart = nonNegativeSafeInteger(
			dataProperty(target, 'sourceStartFrame', `${name} transform destination`),
			`${name} destination.sourceStartFrame`,
		);
		const targetDuration = positiveSafeInteger(
			dataProperty(target, 'sourceDurationFrames', `${name} transform destination`),
			`${name} destination.sourceDurationFrames`,
		);
		const targetEnd = safeAdd(targetStart, targetDuration, `${name} destination source range`);
		return {
			...result,
			videoKeyframes: trimVideoKeyframeCurvesToRange(
				sourceClip.videoKeyframes,
				keyframeContext(sourceClip, name),
				{
					start: multiplyDivideRationals(targetStart - sourceStart, sourceCount, sourceDuration),
					end: multiplyDivideRationals(targetEnd - sourceStart, sourceCount, sourceDuration),
				},
			),
		};
	}
	return retainedOrStretchedCarrier(result, sourceClip, sourceCount, targetCount, name);
}

function retainedOrStretchedCarrier<Result extends DataRecord>(
	result: Result,
	sourceClip: DataRecord,
	sourceCount: number,
	targetCount: number,
	name: string,
): Result {
	const fields = cloneVideoKeyframeCarrierFields(sourceClip, name);
	if (!Object.hasOwn(fields, 'videoKeyframes')) return result;
	return {
		...result,
		videoKeyframes: targetCount === sourceCount
			? fields.videoKeyframes
			: stretchVideoKeyframeCurves(
				sourceClip.videoKeyframes,
				keyframeContext(sourceClip, name),
				{ num: targetCount, den: 1 },
			),
	};
}

/** Rebind effect-target identities after a deterministic stack clone. */
export function rebindVideoKeyframeCarrierEffects<Result extends DataRecord>(
	result: Result,
	source: unknown,
	destination: unknown,
	name = 'video clip',
): Result {
	const sourceClip = optionalKeyframedVideoClip(source, name);
	if (!sourceClip) return result;
	const target = dataRecord(destination, `${name} keyframe destination`);
	const rebound = reboundKeyframesForDestination(sourceClip, target, name);
	return {
		...result,
		videoKeyframes: normalizeVideoKeyframeCurves(
			rebound,
			keyframeContext(target, `${name} destination`),
			`${name} destination.videoKeyframes`,
		),
	};
}

/** Join two adjacent equal paths into one detached carrier. */
export function joinVideoKeyframeCarrierFields(
	left: unknown,
	right: unknown,
	destination: unknown,
	name = 'joined video clip',
): Readonly<{ readonly videoKeyframes?: VideoKeyframeCurves }> {
	const leftClip = optionalKeyframedVideoClip(left, `left ${name}`);
	const rightClip = optionalKeyframedVideoClip(right, `right ${name}`);
	if (!leftClip || !rightClip) {
		if (!leftClip && !rightClip) return NO_KEYFRAMES;
		throw new RangeError(`${name} cannot join mixed keyframe carriers.`);
	}
	const target = dataRecord(destination, name);
	const rightRebound = reboundKeyframesForDestination(rightClip, leftClip, `right ${name}`);
	const joined = joinVideoKeyframeCurves(
		leftClip.videoKeyframes,
		keyframeContext(leftClip, `left ${name}`),
		rightRebound,
		{
			...keyframeContext(leftClip, `left ${name}`),
			duration: { num: positiveSafeInteger(
				dataProperty(rightClip, 'sequenceFrameCount', `right ${name}`),
				`right ${name}.sequenceFrameCount`,
			), den: 1 },
		},
	);
	return Object.freeze({
		videoKeyframes: normalizeVideoKeyframeCurves(joined, keyframeContext(target, name), `${name}.videoKeyframes`),
	});
}

/** Fold any ordered run of adjacent views without sampling or reconstructing its path. */
export function joinVideoKeyframeCarrierSequenceFields(
	values: readonly unknown[],
	destination: unknown,
	name = 'joined video clip',
): Readonly<{ readonly videoKeyframes?: VideoKeyframeCurves }> {
	if (!values.length) throw new RangeError(`${name} requires at least one clip.`);
	const carrierCount = values.reduce<number>((count, value) => count + (hasOwnVideoKeyframes(value) ? 1 : 0), 0);
	if (carrierCount === 0) return NO_KEYFRAMES;
	if (carrierCount !== values.length) throw new RangeError(`${name} cannot join mixed keyframe carriers.`);
	let current = dataRecord(values[0], `${name}[0]`);
	for (let index = 1; index < values.length; index += 1) {
		const right = dataRecord(values[index], `${name}[${String(index)}]`);
		const sequenceFrameCount = safeAdd(
			positiveSafeInteger(dataProperty(current, 'sequenceFrameCount', name), `${name}.sequenceFrameCount`),
			positiveSafeInteger(dataProperty(right, 'sequenceFrameCount', name), `${name}.sequenceFrameCount`),
			`${name} duration`,
		);
		const interim = { ...current, sequenceFrameCount };
		current = {
			...interim,
			...joinVideoKeyframeCarrierFields(current, right, interim, `${name}[0..${String(index)}]`),
		};
	}
	const fields = cloneVideoKeyframeCarrierFields(current, name);
	if (!Object.hasOwn(fields, 'videoKeyframes')) return fields;
	const target = dataRecord(destination, `${name} destination`);
	return Object.freeze({
		videoKeyframes: normalizeVideoKeyframeCurves(
			fields.videoKeyframes,
			keyframeContext(target, `${name} destination`),
			`${name} destination.videoKeyframes`,
		),
	});
}

/** Legacy clips without carriers join together; mixed or incompatible carriers do not. */
export function videoKeyframeCarriersJoinable(left: unknown, right: unknown): boolean {
	const leftClip = optionalKeyframedVideoClip(left, 'left video clip');
	const rightClip = optionalKeyframedVideoClip(right, 'right video clip');
	if (!leftClip || !rightClip) return !leftClip && !rightClip;
	try {
		joinVideoKeyframeCarrierFields(leftClip, rightClip, {
			...leftClip,
			sequenceFrameCount: safeAdd(
				positiveSafeInteger(
				dataProperty(leftClip, 'sequenceFrameCount', 'left video clip'),
				'left video clip.sequenceFrameCount',
			), positiveSafeInteger(
				dataProperty(rightClip, 'sequenceFrameCount', 'right video clip'),
				'right video clip.sequenceFrameCount',
			), 'joined video clip duration'),
		}, 'video clip join admission');
		return true;
	} catch (error) {
		if (error instanceof RangeError || error instanceof ReferenceError) return false;
		throw error;
	}
}

/** Convert a resolved sample-frame boundary into one clip-local sequence position. */
export function videoKeyframeSequencePositionAtTimelineFrame(
	project: unknown,
	clip: unknown,
	timelineFrame: number,
	name = 'video clip',
): number | null {
	const source = optionalKeyframedVideoClip(clip, name);
	if (!source) return null;
	const projectRecord = dataRecord(project, 'project');
	const sequence = uniqueSequence(projectRecord, source.sequenceId, name);
	const frame = sampleFrameToVideoFrame(
		timelineFrame,
		dataRecord(dataProperty(sequence, 'rate', `sequence ${String(source.sequenceId)}`), 'sequence rate') as never,
		positiveSafeInteger(dataProperty(projectRecord, 'sampleRate', 'project'), 'project.sampleRate'),
		'point',
	);
	return frame - positiveOrZero(source.sequenceStartFrame, `${name}.sequenceStartFrame`);
}

function optionalKeyframedVideoClip(value: unknown, name: string): DataRecord | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const clip = value as DataRecord;
	const keyframes = Object.getOwnPropertyDescriptor(clip, 'videoKeyframes');
	if (!keyframes) return null;
	if (!keyframes.enumerable || !Object.hasOwn(keyframes, 'value')) {
		throw new TypeError(`${name}.videoKeyframes must be an own enumerable data property.`);
	}
	if (dataProperty(clip, 'kind', name) !== 'video') {
		throw new TypeError(`${name} must be a video clip to carry videoKeyframes.`);
	}
	return clip;
}

function hasOwnVideoKeyframes(value: unknown): boolean {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value)
		&& Object.getOwnPropertyDescriptor(value, 'videoKeyframes'));
}

function keyframeContext(clip: DataRecord, name: string): Readonly<Record<string, unknown>> {
	return Object.freeze({
		duration: {
			num: positiveSafeInteger(dataProperty(clip, 'sequenceFrameCount', name), `${name}.sequenceFrameCount`),
			den: 1,
		},
		composition: dataProperty(clip, 'videoComposition', name),
		videoEffects: dataProperty(clip, 'videoEffects', name),
	});
}

function sourceBoundsChanged(source: DataRecord, target: DataRecord, name: string): boolean {
	for (const key of ['sourceStartFrame', 'sourceDurationFrames'] as const) {
		const before = dataProperty(source, key, name);
		const after = dataProperty(target, key, `${name} transform destination`);
		if (before !== after) return true;
	}
	return false;
}

function cloneWithEffectIds(value: unknown, ids: ReadonlyMap<string, string>, name: string): unknown {
	const snapshot = structuredClone(value) as DataRecord;
	const curves = dataArray(dataProperty(snapshot, 'curves', `${name}.videoKeyframes`), `${name}.videoKeyframes.curves`);
	for (const [index, curve] of curves.entries()) {
		const target = dataRecord(dataProperty(curve, 'target', `${name} curve ${String(index)}`), `${name} curve target`);
		if (dataProperty(target, 'kind', `${name} curve target`) !== 'video-effect') continue;
		const prior = nonEmptyString(dataProperty(target, 'effectId', `${name} curve target`), `${name} keyframe effect ID`);
		const next = ids.get(prior);
		if (!next) throw new ReferenceError(`${name} keyframes reference missing video effect ${prior}.`);
		target.effectId = next;
	}
	return snapshot;
}

function reboundKeyframesForDestination(
	source: DataRecord,
	destination: DataRecord,
	name: string,
): unknown {
	const sourceEffects = dataArray(dataProperty(source, 'videoEffects', name), `${name}.videoEffects`);
	const targetEffects = dataArray(dataProperty(destination, 'videoEffects', `${name} destination`), `${name} destination.videoEffects`);
	if (sourceEffects.length !== targetEffects.length) {
		throw new RangeError(`${name} keyframe effect rebinding requires equal stack lengths.`);
	}
	const effectIds = new Map<string, string>();
	for (let index = 0; index < sourceEffects.length; index += 1) {
		const before = sourceEffects[index]!;
		const after = targetEffects[index]!;
		if (dataProperty(before, 'type', `${name}.videoEffects[${String(index)}]`)
			!== dataProperty(after, 'type', `${name} destination.videoEffects[${String(index)}]`)) {
			throw new RangeError(`${name} keyframe effect rebinding requires equal stack types.`);
		}
		effectIds.set(
			nonEmptyString(dataProperty(before, 'id', `${name}.videoEffects[${String(index)}]`), `${name} effect ID`),
			nonEmptyString(dataProperty(after, 'id', `${name} destination.videoEffects[${String(index)}]`), `${name} destination effect ID`),
		);
	}
	return cloneWithEffectIds(dataProperty(source, 'videoKeyframes', name), effectIds, name);
}

function uniqueSequence(project: DataRecord, id: unknown, name: string): DataRecord {
	const sequenceId = nonEmptyString(id, `${name}.sequenceId`);
	const matches = dataArray(dataProperty(project, 'sequences', 'project'), 'project.sequences')
		.filter((sequence) => dataProperty(sequence, 'id', 'sequence') === sequenceId);
	if (matches.length !== 1) throw new ReferenceError(`${name} references missing or duplicate sequence ${sequenceId}.`);
	return matches[0]!;
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}
function dataArray(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => dataRecord(item, `${name}[${String(index)}]`));
}
function dataProperty(value: DataRecord, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}
function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}
function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}
function positiveOrZero(value: unknown, name: string): number { return nonNegativeSafeInteger(value, name); }
function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}
function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}
