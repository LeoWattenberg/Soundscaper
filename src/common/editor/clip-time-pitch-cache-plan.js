/* SPDX-License-Identifier: AGPL-3.0-only */

// What a clip's pitch and speed actually ask StaffPad to do, and the content
// address that answer earns. A speed change outside StaffPad's tested 0.5-2.0
// range is decomposed into sequential passes, each pass is hashed together with
// the immutable source identity it reads from, and the resulting keys let a
// render already on disk be recognised without touching a sample. Split out of
// clip-time-pitch-cache.js, which coordinates and commits those renders rather
// than deciding what they are; no behaviour changes here.

import {
	STAFFPAD_ALGORITHM_ID,
	STAFFPAD_ALGORITHM_VERSION,
	STAFFPAD_MAXIMUM_PITCH_CENTS,
	STAFFPAD_MAXIMUM_RATIO,
	STAFFPAD_MAXIMUM_RENDER_BYTES,
	STAFFPAD_MINIMUM_PITCH_CENTS,
	STAFFPAD_MINIMUM_RATIO,
	normalizeStaffPadTransform,
	pitchCentsToRatio,
	staffPadTransformOutputFrames,
} from './staffpad/index.js';
import { cacheError } from './clip-time-pitch-cache-errors.js';
import { stableSerialize } from './clip-time-pitch-cache-values.ts';
import {
	finiteRange,
	integerRange,
	nonEmptyString,
	nonNegativeInteger,
	positiveFinite,
	positiveInteger,
} from './clip-time-pitch-cache-validation.ts';

export const CLIP_TIME_PITCH_CACHE_SCHEMA_VERSION = 1;
export const CLIP_TIME_PITCH_CACHE_ALGORITHM_REVISION = STAFFPAD_ALGORITHM_VERSION;
export const CLIP_TIME_PITCH_CACHE_PREFIX = 'audio-editor-time-pitch-v1';
const MAXIMUM_SEQUENTIAL_STAGES = 32;

export function clipNeedsTimePitchRender(clip) {
	if (!clip || typeof clip !== 'object') return false;
	return Number(clip.pitchCents ?? 0) !== 0 || Number(clip.speedRatio ?? 1) !== 1;
}

/**
 * Validate one V2 clip/source pair and split extreme speed changes into scalar
 * StaffPad passes. The native ABI remains within 0.5–2.0 on every pass while
 * the browser model keeps accepting any finite positive clip speed.
 */
export function describeClipTimePitchRender(clip, source, options = {}) {
	if (!clip || typeof clip !== 'object' || Array.isArray(clip)) {
		throw new TypeError('A V2 audio clip is required.');
	}
	if (!source || typeof source !== 'object' || Array.isArray(source)) {
		throw new TypeError('A V2 audio source is required.');
	}
	const sourceId = nonEmptyString(source.id, 'source.id');
	if (nonEmptyString(clip.sourceId, 'clip.sourceId') !== sourceId) {
		throw cacheError('SOURCE_MISMATCH', 'The clip does not reference the supplied immutable source.');
	}
	const clipId = nonEmptyString(clip.id, 'clip.id');
	const sourceFrameCount = positiveInteger(source.frameCount, 'source.frameCount');
	const sourceStartFrame = nonNegativeInteger(clip.sourceStartFrame ?? 0, 'clip.sourceStartFrame');
	const sourceDurationFrames = positiveInteger(
		clip.sourceDurationFrames ?? clip.durationFrames,
		'clip.sourceDurationFrames',
	);
	if (sourceStartFrame + sourceDurationFrames > sourceFrameCount) {
		throw cacheError('INVALID_SOURCE_RANGE', 'The clip source range extends beyond its immutable source.');
	}
	const channelCount = integerRange(source.channelCount, 1, 2, 'source.channelCount');
	const sampleRate = integerRange(
		options.sampleRate ?? source.sampleRate,
		8_000,
		192_000,
		'sampleRate',
	);
	const pitchCents = finiteRange(
		clip.pitchCents ?? 0,
		STAFFPAD_MINIMUM_PITCH_CENTS,
		STAFFPAD_MAXIMUM_PITCH_CENTS,
		'clip.pitchCents',
	);
	const speedRatio = positiveFinite(clip.speedRatio ?? 1, 'clip.speedRatio');
	const preserveFormants = Boolean(clip.preserveFormants);
	const direction = clip.reversed ? 'reverse' : 'forward';
	const renderCacheRevision = nonNegativeInteger(
		clip.renderCacheRevision ?? 0,
		'clip.renderCacheRevision',
	);
	const algorithmRevision = nonEmptyString(
		options.algorithmRevision ?? CLIP_TIME_PITCH_CACHE_ALGORITHM_REVISION,
		'algorithmRevision',
	);
	const speedStages = decomposeSpeedRatio(speedRatio);
	let inputFrames = sourceDurationFrames;
	const stages = speedStages.map((tempoRatio, index) => {
		const stagePitchCents = index === 0 ? pitchCents : 0;
		const transform = normalizeStaffPadTransform({
			tempoRatio,
			pitchRatio: pitchCentsToRatio(stagePitchCents),
			preserveFormants: index === 0 && preserveFormants,
		});
		const outputFrames = staffPadTransformOutputFrames(inputFrames, transform);
		const stage = Object.freeze({
			index,
			inputFrames,
			outputFrames,
			tempoRatio,
			pitchCents: stagePitchCents,
			preserveFormants: transform.preserveFormants,
			transform: freezeTransform(transform),
		});
		inputFrames = outputFrames;
		return stage;
	});
	const outputFrames = stages.at(-1).outputFrames;
	const outputBytes = outputFrames * channelCount * Float32Array.BYTES_PER_ELEMENT;
	const maximumOutputBytes = options.maximumOutputBytes ?? STAFFPAD_MAXIMUM_RENDER_BYTES;
	const largestStageBytes = stages.reduce((largest, stage) => (
		Math.max(largest, stage.outputFrames * channelCount * Float32Array.BYTES_PER_ELEMENT)
	), 0);
	if (!Number.isSafeInteger(outputBytes) || !Number.isSafeInteger(largestStageBytes)
		|| largestStageBytes > maximumOutputBytes) {
		throw cacheError(
			'OUTPUT_LIMIT_EXCEEDED',
			`The clip render would exceed the ${maximumOutputBytes} byte output limit.`,
			{ outputFrames, outputBytes, largestStageBytes },
		);
	}
	const warnings = [];
	if (speedRatio < STAFFPAD_MINIMUM_RATIO || speedRatio > STAFFPAD_MAXIMUM_RATIO) {
		warnings.push(Object.freeze({
			code: 'STAFFPAD_TIME_RATIO_OUTSIDE_TESTED_RANGE',
			message: `The ${speedRatio}:1 clip speed is outside StaffPad's best-tested 0.5–2.0 range; ${stages.length} sequential passes will be used.`,
			speedRatio,
			stageCount: stages.length,
		}));
	}
	return Object.freeze({
		schemaVersion: CLIP_TIME_PITCH_CACHE_SCHEMA_VERSION,
		clipId,
		sourceId,
		storageKey: nonEmptyString(source.storageKey || sourceId, 'source.storageKey'),
		sourceFrameCount,
		sourceRange: Object.freeze({ startFrame: sourceStartFrame, frameCount: sourceDurationFrames }),
		channelCount,
		sampleRate,
		direction,
		pitchCents,
		speedRatio,
		preserveFormants,
		renderCacheRevision,
		algorithmRevision,
		outputFrames,
		outputBytes,
		stages: Object.freeze(stages),
		warnings: Object.freeze(warnings),
		sourceIdentity: Object.freeze({
			id: sourceId,
			storageKey: nonEmptyString(source.storageKey || sourceId, 'source.storageKey'),
			frameCount: sourceFrameCount,
			channelCount,
			sampleRate,
			sampleFormat: String(source.sampleFormat || 'float32'),
			revision: sourceRevision(source),
		}),
	});
}

/** Derive the immutable, sequential stage keys without reading source PCM. */
export async function deriveClipTimePitchCachePlan(clip, source, options = {}) {
	const description = describeClipTimePitchRender(clip, source, options);
	let priorKey = null;
	const stages = [];
	for (const stage of description.stages) {
		const descriptor = Object.freeze({
			schemaVersion: CLIP_TIME_PITCH_CACHE_SCHEMA_VERSION,
			algorithm: Object.freeze({
				id: STAFFPAD_ALGORITHM_ID,
				revision: description.algorithmRevision,
			}),
			input: priorKey == null
				? Object.freeze({
					source: description.sourceIdentity,
					range: description.sourceRange,
					direction: description.direction,
				})
				: Object.freeze({
					cacheKey: priorKey,
					range: Object.freeze({ startFrame: 0, frameCount: stage.inputFrames }),
					direction: 'forward',
				}),
			intent: Object.freeze({
				pitchCents: description.pitchCents,
				speedRatio: description.speedRatio,
				preserveFormants: description.preserveFormants,
				renderCacheRevision: description.renderCacheRevision,
			}),
			sampleRate: description.sampleRate,
			channelCount: description.channelCount,
			stage: Object.freeze({
				index: stage.index,
				count: description.stages.length,
				inputFrames: stage.inputFrames,
				outputFrames: stage.outputFrames,
				transform: stage.transform,
			}),
		});
		const cacheKey = await hashCacheDescriptor(descriptor);
		stages.push(Object.freeze({ ...stage, descriptor, cacheKey }));
		priorKey = cacheKey;
	}
	const finalKey = priorKey;
	return Object.freeze({
		...description,
		stages: Object.freeze(stages),
		finalKey,
		cacheSourceId: cacheSourceIdForKey(finalKey),
	});
}

/**
 * Coordinates immutable StaffPad renders and their atomic source-store commit.
 * A clip may retain its previous committed entry while a newer revision runs.
 */

export function cacheSourceIdForKey(cacheKey) {
	const match = /^audio-editor-time-pitch-v1:([0-9a-f]{64})$/.exec(String(cacheKey));
	if (!match) throw new TypeError('A clip time-and-pitch cache key is required.');
	return `${CLIP_TIME_PITCH_CACHE_PREFIX}-${match[1]}`;
}

function decomposeSpeedRatio(value) {
	let remaining = positiveFinite(value, 'clip.speedRatio');
	const stages = [];
	for (let index = 0; index < MAXIMUM_SEQUENTIAL_STAGES; index += 1) {
		if (remaining > STAFFPAD_MAXIMUM_RATIO) {
			stages.push(STAFFPAD_MAXIMUM_RATIO);
			remaining /= STAFFPAD_MAXIMUM_RATIO;
			continue;
		}
		if (remaining < STAFFPAD_MINIMUM_RATIO) {
			stages.push(STAFFPAD_MINIMUM_RATIO);
			remaining /= STAFFPAD_MINIMUM_RATIO;
			continue;
		}
		stages.push(remaining);
		return stages;
	}
	throw cacheError('SPEED_RATIO_LIMIT_EXCEEDED', 'The clip speed requires too many sequential StaffPad passes.');
}

async function hashCacheDescriptor(descriptor) {
	if (!globalThis.crypto?.subtle) throw cacheError('HASH_UNAVAILABLE', 'SHA-256 is unavailable for clip render cache keys.');
	const bytes = new TextEncoder().encode(stableSerialize(descriptor));
	const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
	const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
	return `${CLIP_TIME_PITCH_CACHE_PREFIX}:${hash}`;
}


function sourceRevision(source) {
	const value = source.revision ?? source.opaqueExtensions?.revision ?? source.opaqueExtensions?.sourceRevision ?? 0;
	return nonNegativeInteger(value, 'source revision');
}
function freezeTransform(transform) {
	return Object.freeze({
		preserveFormants: transform.preserveFormants,
		durationRatio: transform.durationRatio,
		keyframes: Object.freeze(transform.keyframes.map((keyframe) => Object.freeze({ ...keyframe }))),
	});
}
