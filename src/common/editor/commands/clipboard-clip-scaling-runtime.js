/* SPDX-License-Identifier: AGPL-3.0-only */

import { conformClipboardVideoPlacement } from './clipboard-time-runtime.js';
import { cloneVideoCompositionCarrierFields } from './video-composition-carrier.ts';
import { rebindVideoKeyframeCarrierEffects } from './video-keyframe-carrier.ts';
import { cloneVideoEffectsWithCommandIds } from './shared-runtime.js';

export function scaleClipboardClip(
	descriptor,
	scale,
	atFrame,
	id,
	groupIds,
	avLinkIds,
	videoEffectIds = undefined,
	targetSequence = null,
	conformedAnchor = null,
) {
	const durationFrames = Math.max(1, Math.round(descriptor.durationFrames * scale));
	const videoPlacement = descriptor.kind === 'video' && targetSequence && conformedAnchor
		? conformClipboardVideoPlacement(descriptor, scale, targetSequence, conformedAnchor)
		: null;
	const timelineStartFrame = videoPlacement?.timelineStartFrame
		?? atFrame + Math.round(descriptor.offsetFrame * scale) + (conformedAnchor?.sampleDelta ?? 0);
	const timelineDurationFrames = videoPlacement?.durationFrames ?? durationFrames;
	const candidate = {
		...descriptor,
		kind: descriptor.kind || 'audio',
		id,
		binItemId: null,
		groupId: descriptor.groupId ? groupIds[descriptor.groupId] || null : null,
		avLinkId: descriptor.avLinkId ? avLinkIds[descriptor.avLinkId] || null : null,
		timelineStartFrame,
		durationFrames: timelineDurationFrames,
		...(videoPlacement || {}),
		fadeInFrames: Math.min(timelineDurationFrames, Math.round((descriptor.fadeInFrames || 0) * scale)),
		fadeOutFrames: Math.min(timelineDurationFrames, Math.round((descriptor.fadeOutFrames || 0) * scale)),
		...(descriptor.kind === 'video' && Array.isArray(descriptor.videoEffects) ? {
			videoEffects: cloneVideoEffectsWithCommandIds(
				descriptor.videoEffects,
				videoEffectIds,
				`Pasted clip ${descriptor.key}`,
			),
		} : {}),
		...cloneVideoCompositionCarrierFields(descriptor, `Pasted clip ${descriptor.key}`),
		...(Array.isArray(descriptor.envelope) ? {
			envelope: descriptor.envelope.map((point) => ({
				...point,
				frame: Math.min(durationFrames, Math.max(0, Math.round(point.frame * scale))),
			})).filter((point, index, values) => !index || point.frame > values[index - 1].frame),
		} : {}),
	};
	return rebindVideoKeyframeCarrierEffects(
		candidate,
		descriptor,
		candidate,
		`Pasted clip ${descriptor.key}`,
	);
}

export function cloneRational(value) {
	return value && typeof value === 'object'
		? { num: value.num, den: value.den }
		: value ?? null;
}

export function cloneBreakpointMap(value) {
	if (value?.feature === 'video-retime' && value?.version === 2
		&& Array.isArray(value.points) && Array.isArray(value.segments)) {
		return {
			...value,
			points: value.points.map((point) => ({
				...point,
				sourceFrame: cloneRational(point.sourceFrame),
			})),
			segments: value.segments.map((segment) => ({
				...segment,
				...(segment.startVelocity ? { startVelocity: cloneRational(segment.startVelocity) } : {}),
				...(segment.endVelocity ? { endVelocity: cloneRational(segment.endVelocity) } : {}),
			})),
		};
	}
	return value && typeof value === 'object' && Array.isArray(value.points)
		? {
			...value,
			points: value.points.map((point) => ({
				...point,
				outer: cloneRational(point.outer),
				source: cloneRational(point.source),
			})),
		}
		: value ?? null;
}
