/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceGuidedHighlightDraftV1,
	setLocalAssistanceGuidedHighlightCropV1,
	setLocalAssistanceGuidedHighlightTitleV1,
	setLocalAssistanceGuidedHighlightTrimV1,
	validateLocalAssistanceGuidedHighlightDraftV1,
} from '../src/common/editor/controller/local-assistance-guided-highlight-edits.ts';

test('Guided highlight edits stay bounded to the authenticated proposal', () => {
	const original = proposals();
	const initial = createLocalAssistanceGuidedHighlightDraftV1(original);
	assert.deepEqual(initial, original);
	assert.notEqual(initial, original);

	const titled = setLocalAssistanceGuidedHighlightTitleV1(initial, 'highlight-a',
		'A tighter opening');
	const trimmed = setLocalAssistanceGuidedHighlightTrimV1(original, titled,
		'highlight-a', 12_000, 48_000);
	const edited = setLocalAssistanceGuidedHighlightCropV1(trimmed, 'highlight-a', 12,
		{ left: 0.2, top: 0, right: 0.48, bottom: 0 });
	const proposal = edited.proposals[0]!;
	assert.equal(proposal.title, 'A tighter opening');
	assert.deepEqual({ startFrame: proposal.startFrame, endFrame: proposal.endFrame,
		sourceStartFrame: proposal.sourceStartFrame, sourceEndFrame: proposal.sourceEndFrame }, {
		startFrame: 12_000, endFrame: 48_000, sourceStartFrame: 12, sourceEndFrame: 48,
	});
	assert.deepEqual(proposal.cropKeyframes.map(({ sourceFrame }) => sourceFrame), [12, 47]);
	assert.deepEqual(proposal.cropKeyframes[0]?.crop,
		{ left: 0.2, top: 0, right: 0.48, bottom: 0 });
	assert.equal(Object.isFrozen(proposal.cropKeyframes), true);
	assert.deepEqual(validateLocalAssistanceGuidedHighlightDraftV1(original, edited), edited);
});

test('Guided highlight trims require exact inward source-time mapping', () => {
	const original = proposals({ sourceEndFrame: 239,
		cropKeyframes: [crop(0, 0.341796875), crop(238, 0.341796875)] });
	const draft = createLocalAssistanceGuidedHighlightDraftV1(original);
	assert.throws(() => setLocalAssistanceGuidedHighlightTrimV1(
		original, draft, 'highlight-a', 1, 48_000,
	), /exact|mapping/iu);
	assert.throws(() => setLocalAssistanceGuidedHighlightTrimV1(
		original, draft, 'highlight-a', -1, 48_000,
	), /range|trim|invalid/iu);
	assert.throws(() => setLocalAssistanceGuidedHighlightTrimV1(
		original, draft, 'highlight-a', 0, 96_001,
	), /range|trim/iu);
});

test('Guided highlight drafts cannot rewrite evidence, identities, or unsafe text and crops', () => {
	const original = proposals();
	const draft = createLocalAssistanceGuidedHighlightDraftV1(original);
	assert.throws(() => setLocalAssistanceGuidedHighlightTitleV1(
		draft, 'highlight-a', '  title  ',
	), /title/iu);
	assert.throws(() => setLocalAssistanceGuidedHighlightCropV1(
		draft, 'highlight-a', 0, { left: 0.6, top: 0, right: 0.5, bottom: 0 },
	), /crop|aperture/iu);
	assert.throws(() => validateLocalAssistanceGuidedHighlightDraftV1(original, {
		...draft, proposals: [{ ...draft.proposals[0]!, score: 1 }],
	}), /evidence|authority|rewrite/iu);
});

function proposals(overrides: Readonly<Record<string, unknown>> = {}) {
	return { schemaVersion: 1 as const, kind: 'highlight-proposals' as const,
		workflowId: 'make-highlights' as const, targetAspect: { width: 9 as const, height: 16 as const },
		proposals: [{ id: 'highlight-a', startFrame: 0, endFrame: 96_000,
			sourceStartFrame: 0, sourceEndFrame: 96, score: 0.8,
			evidenceMode: 'transcript' as const, transcriptExcerpt: 'Authenticated cue.',
			visualSummary: 'Authenticated visual evidence.', selected: false as const,
			videoOccurrenceId: 'video-occurrence', audioOccurrenceId: 'audio-occurrence',
			title: 'Highlight 1', hook: 'Authenticated hook.', chapters: ['Opening'],
			explanation: 'Authenticated explanation.',
			cropKeyframes: [crop(0, 0.341796875), crop(95, 0.341796875)],
			...overrides }],
	};
}

function crop(sourceFrame: number, left: number) {
	return { sourceFrame, authority: 'center' as const, trackIds: [],
		crop: { left, top: 0, right: 1 - 0.31640625 - left, bottom: 0 } };
}
