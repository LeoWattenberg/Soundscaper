/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceGuidedReframeDraftV1,
	setLocalAssistanceGuidedReframeCropV1,
	validateLocalAssistanceGuidedReframeDraftV1,
} from '../src/common/editor/controller/local-assistance-guided-reframe-edits.ts';

test('Guided Reframe crop edits stay transient, aspect-correct, and authority-bound', () => {
	const original = reframeResult();
	const draft = createLocalAssistanceGuidedReframeDraftV1(original);
	const crop = { left: 0.2, top: 0, right: 0.48359375, bottom: 0 };
	const edited = setLocalAssistanceGuidedReframeCropV1(draft, 0, crop);
	assert.deepEqual(edited.path.keyframes[0], {
		sourceFrame: 0, authority: 'center', trackIds: [], crop,
	});
	assert.deepEqual(original.path.keyframes[0]?.crop, {
		left: 0.341796875, top: 0, right: 0.341796875, bottom: 0,
	});
	assert.deepEqual(validateLocalAssistanceGuidedReframeDraftV1(original, edited), edited);
	assert.throws(() => setLocalAssistanceGuidedReframeCropV1(draft, 1, crop),
		/admitted keyframe/iu);
	assert.throws(() => setLocalAssistanceGuidedReframeCropV1(draft, 0,
		{ ...crop, right: 0.4 }), /aspect/iu);
});

test('Guided Reframe draft validation rejects rewritten timing and fallback evidence', () => {
	const original = reframeResult();
	const draft = createLocalAssistanceGuidedReframeDraftV1(original);
	assert.throws(() => validateLocalAssistanceGuidedReframeDraftV1(original, {
		...draft, authority: { ...draft.authority, timescale: 30 },
	}), /authority/iu);
	assert.throws(() => validateLocalAssistanceGuidedReframeDraftV1(original, {
		...draft, fallbackChain: ['center', 'saliency', 'subject'],
	}), /fallback|authority/iu);
});

test('Guided Reframe draft validation rejects forged per-keyframe evidence', () => {
	const original = reframeResult();
	const draft = createLocalAssistanceGuidedReframeDraftV1(original);
	assert.equal(setLocalAssistanceGuidedReframeCropV1(
		draft, 0, draft.path.keyframes[0]!.crop,
	).path.keyframes[0]!.authority, 'subject');
	assert.throws(() => validateLocalAssistanceGuidedReframeDraftV1(original, {
		...draft, path: { ...draft.path, keyframes: draft.path.keyframes.map((keyframe, index) =>
			index === 0 ? { ...keyframe, trackIds: ['forged-track'] } : keyframe) },
	}), /evidence authority/iu);
	assert.throws(() => validateLocalAssistanceGuidedReframeDraftV1(original, {
		...draft, path: { ...draft.path, keyframes: draft.path.keyframes.map((keyframe, index) =>
			index === 0 ? { ...keyframe, authority: 'saliency', trackIds: [] } : keyframe) },
	}), /evidence authority/iu);
});

function reframeResult() {
	return { schemaVersion: 1, kind: 'reframe-path', authority: {
		width: 1_920, height: 1_080, timescale: 24,
		frames: [{ sourceFrame: 0, presentationTick: '0' },
			{ sourceFrame: 239, presentationTick: '239' }],
	}, fallbackChain: ['subject', 'saliency', 'center'], path: {
		schemaVersion: 1, targetAspect: { width: 9, height: 16 }, keyframes: [
			cropKeyframe(0), cropKeyframe(239),
		],
	} };
}

function cropKeyframe(sourceFrame: number) {
	return { sourceFrame, authority: 'subject', trackIds: ['track-a'],
		crop: { left: 0.341796875, top: 0, right: 0.341796875, bottom: 0 } };
}
