/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
	admitAudioEditorProjectValidationStructure,
} from './project-validation-budget.ts';
import { normalizeVideoKeyframeCurves } from './video-keyframe-curves.ts';

export class VideoKeyframeExportUnavailableError extends Error {
	readonly code = 'VIDEO_KEYFRAME_EXPORT_UNAVAILABLE' as const;
	readonly clipId: string;

	constructor(clipId: string) {
		super(`Video clip ${clipId} has animated keyframes, but exact animated video export is unavailable.`);
		this.name = 'VideoKeyframeExportUnavailableError';
		this.clipId = clipId;
	}
}

/**
 * Admit only static V20 keyframe fields into the current V6 export plan.
 * Animated state refuses before any media or FFmpeg boundary is reached.
 */
export function assertStaticVideoKeyframesForExport(clips: readonly unknown[]): void {
	const animated = animatedVideoKeyframeClipIdsForExport(clips);
	if (animated[0]) throw new VideoKeyframeExportUnavailableError(animated[0]);
}

/** Classify the exact active clip set without touching media or renderer state. */
export function animatedVideoKeyframeClipIdsForExport(
	clips: readonly unknown[],
): readonly string[] {
	const visited = new WeakSet<object>();
	const animated: string[] = [];
	for (const [index, value] of clips.entries()) {
		const clip = dataRecord(value, `video export clip ${String(index)}`);
		if (visited.has(clip)) continue;
		visited.add(clip);
		const descriptor = Object.getOwnPropertyDescriptor(clip, 'videoKeyframes');
		if (!descriptor) continue;
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError('video export clip.videoKeyframes must be an own enumerable data property.');
		}
		admitAudioEditorProjectValidationStructure(
			descriptor.value, AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
		);
		const id = nonEmptyString(dataProperty(clip, 'id', 'video export clip'), 'video export clip.id');
		const sequenceFrameCount = positiveSafeInteger(
			dataProperty(clip, 'sequenceFrameCount', `video export clip ${id}`),
			`video export clip ${id}.sequenceFrameCount`,
		);
		const keyframes = normalizeVideoKeyframeCurves(descriptor.value, {
			duration: { num: sequenceFrameCount, den: 1 },
			composition: dataProperty(clip, 'videoComposition', `video export clip ${id}`),
			videoEffects: dataProperty(clip, 'videoEffects', `video export clip ${id}`),
		}, `video export clip ${id}.videoKeyframes`);
		if (keyframes.curves.length > 0) animated.push(id);
	}
	return Object.freeze(animated);
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	return value as Record<string, unknown>;
}

function dataProperty(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return value;
}
