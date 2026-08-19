/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	multiplyDivideRationals,
	type Rational,
} from './timeline-time.ts';
import type {
	VideoKeyframeRenderState,
	VideoKeyframeRenderStateProvider,
} from './video-keyframe-render-state-provider.ts';
import type {
	VideoRenderCanvas,
	VideoRenderDisplaySize,
} from './video-render-description.ts';

export interface VideoKeyframePreviewStateRequest {
	readonly clip: unknown;
	readonly source?: unknown;
	/** Exact absolute project sample under the program playhead. */
	readonly timelineSample: number;
	readonly sourceDisplaySize: VideoRenderDisplaySize;
	readonly canvas: VideoRenderCanvas;
	readonly transitionWeight?: number;
}

const PREVIEW_STATE_ERRORS = new WeakSet<object>();

/** Identify the bounded error surfaced by a preview consumer after keyed state fails closed. */
export function isVideoKeyframePreviewStateError(value: unknown): value is Error {
	return Boolean(value && typeof value === 'object' && PREVIEW_STATE_ERRORS.has(value));
}

/** A latched failure belongs only to the immutable project snapshot that raised it. */
export function isVideoKeyframePreviewFailureCurrent(
	failedProject: unknown,
	currentProject: unknown,
): boolean {
	return failedProject != null && failedProject === currentProject;
}

/**
 * Resolve one keyed preview state at the exact projected playhead.
 *
 * Legacy clips return null before keyframe-only timing or composition fields
 * are inspected. A clip that declares the V20 field is strict: malformed
 * descriptors, timing, or authored state become one branded preview error.
 */
export function resolveVideoKeyframePreviewState(
	provider: VideoKeyframeRenderStateProvider | null | undefined,
	request: VideoKeyframePreviewStateRequest,
): VideoKeyframeRenderState | null {
	try {
		if (!hasVideoKeyframes(request?.clip)) return null;
		if (!provider || typeof provider.resolve !== 'function') {
			throw new TypeError('A video keyframe render-state provider is required.');
		}
		const transitionWeight = request.transitionWeight ?? 1;
		return provider.resolve({
			clip: request.clip,
			localSequencePosition: videoKeyframeLocalSequencePositionAtTimelineSample(
				request.clip,
				request.timelineSample,
			),
			sourceDisplaySize: request.sourceDisplaySize,
			// The panel resolves its reference canvas with the export resolver,
			// which states eleven fields, and the provider reads a canvas as a
			// closed record of the three a placement needs. Narrowing here is what
			// lets both stay strict: the provider keeps refusing a canvas it does
			// not understand, and a keyframed clip still previews.
			canvas: renderCanvas(request.canvas),
			transitionWeightStart: transitionWeight,
			transitionWeightEnd: transitionWeight,
		});
	} catch (cause) {
		if (isVideoKeyframePreviewStateError(cause)) throw cause;
		const error = new Error('The video keyframe preview state could not be resolved.', { cause });
		PREVIEW_STATE_ERRORS.add(error);
		throw error;
	}
}

/** Map the projected visible sample interval exactly onto local sequence frames. */
export function videoKeyframeLocalSequencePositionAtTimelineSample(
	clipValue: unknown,
	timelineSampleValue: unknown,
): Rational {
	const clip = plainObject(clipValue, 'video keyframe preview clip');
	const timelineStartFrame = nonNegativeSafeInteger(
		dataProperty(clip, 'timelineStartFrame', 'video keyframe preview clip'),
		'video keyframe preview clip.timelineStartFrame',
	);
	const durationFrames = positiveSafeInteger(
		dataProperty(clip, 'durationFrames', 'video keyframe preview clip'),
		'video keyframe preview clip.durationFrames',
	);
	const sequenceFrameCount = positiveSafeInteger(
		dataProperty(clip, 'sequenceFrameCount', 'video keyframe preview clip'),
		'video keyframe preview clip.sequenceFrameCount',
	);
	const timelineSample = nonNegativeSafeInteger(
		timelineSampleValue,
		'video keyframe preview timeline sample',
	);
	const timelineEndFrame = safeSum(timelineStartFrame, durationFrames);
	if (timelineSample < timelineStartFrame || timelineSample > timelineEndFrame) {
		throw new RangeError('The video keyframe preview sample is outside the visible clip range.');
	}
	return multiplyDivideRationals(
		timelineSample - timelineStartFrame,
		sequenceFrameCount,
		durationFrames,
	);
}

function hasVideoKeyframes(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'videoKeyframes');
	if (!descriptor) return false;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('videoKeyframes must be an enumerable own data property.');
	}
	return true;
}

function plainObject(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function dataProperty(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable own data property.`);
	}
	return descriptor.value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	const result = nonNegativeSafeInteger(value, name);
	if (result === 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function safeSum(left: number, right: number): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) {
		throw new RangeError('The video keyframe preview clip range exceeds the safe integer domain.');
	}
	return result;
}

/** The three fields a placement is resolved from, whatever else the caller carries. */
function renderCanvas(canvas: VideoRenderCanvas): VideoRenderCanvas {
	const record = canvas as unknown as Readonly<Record<string, unknown>>;
	const fit = record?.fit;
	return Object.freeze({
		width: record?.width,
		height: record?.height,
		...(fit === undefined ? {} : { fit }),
	}) as VideoRenderCanvas;
}
