/* SPDX-License-Identifier: AGPL-3.0-only */

import { createStableId } from './stable-id.js';
import { normalizeVideoEffects } from './video-effects.js';
import { normalizeVideoEffectsV2 } from './video-effects-v2.ts';

/** Fixed owners retain legacy fixture admission and opt current Frame in
 * separately; callers cannot supply a normalizer or resource profile. */
export function createFoundationVideoClip(options: Record<string, unknown>): Record<string, unknown> {
	return createClip(options, false);
}
export function createFoundationVideoClipV2(options: Record<string, unknown>): Record<string, unknown> {
	return createClip(options, true);
}
function createClip(options: Record<string, unknown>, resourceV2: boolean): Record<string, unknown> {
	const durationFrames = safeInteger(options.durationFrames, 1, 'clip.durationFrames');
	return {
		kind: 'video',
		id: options.id || createStableId('video-clip'),
		sourceId: nonEmptyString(options.sourceId, 'clip.sourceId'),
		title: String(options.title || 'Video clip'),
		timelineStartFrame: safeInteger(options.timelineStartFrame ?? 0, 0, 'clip.timelineStartFrame'),
		sourceStartFrame: safeInteger(options.sourceStartFrame ?? 0, 0, 'clip.sourceStartFrame'),
		sourceDurationFrames: safeInteger(
			options.sourceDurationFrames ?? durationFrames,
			1,
			'clip.sourceDurationFrames',
		),
		durationFrames,
		trimStartFrames: safeInteger(options.trimStartFrames ?? 0, 0, 'clip.trimStartFrames'),
		trimEndFrames: safeInteger(options.trimEndFrames ?? 0, 0, 'clip.trimEndFrames'),
		groupId: optionalId(options.groupId, 'clip.groupId'),
		color: nonEmptyString(options.color || 'auto', 'clip.color'),
		speedRatio: positiveFinite(options.speedRatio ?? 1, 'clip.speedRatio'),
		avLinkId: optionalId(options.avLinkId, 'clip.avLinkId'),
		binItemId: optionalId(options.binItemId, 'clip.binItemId'),
		opaqueExtensions: clone(options.opaqueExtensions ?? {}),
		videoEffects: (resourceV2 ? normalizeVideoEffectsV2 : normalizeVideoEffects)(
			Object.hasOwn(options, 'videoEffects') ? options.videoEffects : [],
			'clip.videoEffects',
		),
	};
}


function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}

function optionalId(value: unknown, name: string): string | null {
	return value == null ? null : nonEmptyString(value, name);
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function safeInteger(value: unknown, minimum: number, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum) {
		throw new RangeError(`${name} must be a safe integer greater than or equal to ${String(minimum)}.`);
	}
	return number;
}

function positiveFinite(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}
