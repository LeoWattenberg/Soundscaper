/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict transient crop edits over one authenticated Guided Reframe path. */

import {
	reviewAssistanceOwnedVideoHighlightTransformResultV1,
} from '../assistance/owned-video-highlight-transform-results-v1.ts';
import type {
	AssistanceOwnedReframePathV1,
} from '../assistance/owned-video-highlight-transform-types-v1.ts';
import type {
	AssistanceReframePathKeyframeV1,
} from '../assistance/visual-semantic-results-v1.ts';

type Crop = AssistanceReframePathKeyframeV1['crop'];

export function createLocalAssistanceGuidedReframeDraftV1(
	value: unknown,
): AssistanceOwnedReframePathV1 {
	const reviewed = reframe(value);
	return reframe({ ...reviewed,
		authority: { ...reviewed.authority,
			frames: reviewed.authority.frames.map((frame) => ({ ...frame })) },
		fallbackChain: [...reviewed.fallbackChain],
		path: { ...reviewed.path, targetAspect: { ...reviewed.path.targetAspect },
			keyframes: reviewed.path.keyframes.map((keyframe) => ({ ...keyframe,
				trackIds: [...keyframe.trackIds], crop: { ...keyframe.crop } })) },
	});
}

export function setLocalAssistanceGuidedReframeCropV1(
	draftValue: unknown,
	sourceFrame: number,
	crop: Crop,
): AssistanceOwnedReframePathV1 {
	const draft = reframe(draftValue);
	if (!Number.isSafeInteger(sourceFrame)) {
		throw new RangeError('A Guided Reframe crop frame is invalid.');
	}
	assertTargetAspect(draft, crop);
	let found = false;
	const keyframes = draft.path.keyframes.map((keyframe) => {
		if (keyframe.sourceFrame !== sourceFrame) return keyframe;
		found = true;
		if (same(keyframe.crop, crop)) return keyframe;
		return { ...keyframe, authority: 'center' as const, trackIds: [], crop: { ...crop } };
	});
	if (!found) throw new RangeError('A Guided Reframe crop must edit an admitted keyframe.');
	return reframe({ ...draft, path: { ...draft.path, keyframes } });
}

export function validateLocalAssistanceGuidedReframeDraftV1(
	originalValue: unknown,
	draftValue: unknown,
): AssistanceOwnedReframePathV1 {
	const original = reframe(originalValue);
	const draft = reframe(draftValue);
	if (!same(original.authority, draft.authority)
		|| !same(original.fallbackChain, draft.fallbackChain)
		|| !same(original.path.targetAspect, draft.path.targetAspect)
		|| original.path.keyframes.length !== draft.path.keyframes.length
		|| original.path.keyframes.some(({ sourceFrame }, index) => (
			draft.path.keyframes[index]?.sourceFrame !== sourceFrame
		))) {
		throw new TypeError('A Guided Reframe draft changed authenticated path authority.');
	}
	for (const [index, keyframe] of draft.path.keyframes.entries()) {
		const authenticated = original.path.keyframes[index]!;
		assertTargetAspect(draft, keyframe.crop);
		if (same(authenticated.crop, keyframe.crop)) {
			if (keyframe.authority !== authenticated.authority
				|| !same(keyframe.trackIds, authenticated.trackIds)) {
				throw new TypeError('A Guided Reframe draft forged keyframe evidence authority.');
			}
		} else if (keyframe.authority !== 'center' || keyframe.trackIds.length !== 0) {
			throw new TypeError('A Guided Reframe crop edit must carry manual centre authority.');
		}
	}
	return draft;
}

function assertTargetAspect(value: AssistanceOwnedReframePathV1, crop: Crop): void {
	const width = (1 - crop.left - crop.right) * value.authority.width;
	const height = (1 - crop.top - crop.bottom) * value.authority.height;
	const target = value.path.targetAspect.width / value.path.targetAspect.height;
	if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0
		|| Math.abs((width / height) - target) > 0.000_001) {
		throw new RangeError('A Guided Reframe crop must preserve its target aspect.');
	}
}

function reframe(value: unknown): AssistanceOwnedReframePathV1 {
	const reviewed = reviewAssistanceOwnedVideoHighlightTransformResultV1({
		schemaVersion: 1, transformId: 'plan-crops', outputs: { 'reframe-path': value },
	});
	if (reviewed.transformId !== 'plan-crops') {
		throw new TypeError('The Guided Reframe draft changed transform identity.');
	}
	return reviewed.outputs['reframe-path'];
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
