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
		'highlight-a', 12_000, 48_000, sourceTimeAuthority());
	const edited = setLocalAssistanceGuidedHighlightCropV1(trimmed, 'highlight-a', 12,
		{ left: 0.2, top: 0, right: 0.48359375, bottom: 0 }, sourceTimeAuthority());
	const proposal = edited.proposals[0]!;
	assert.equal(proposal.title, 'A tighter opening');
	assert.deepEqual({ startFrame: proposal.startFrame, endFrame: proposal.endFrame,
		sourceStartFrame: proposal.sourceStartFrame, sourceEndFrame: proposal.sourceEndFrame }, {
		startFrame: 12_000, endFrame: 48_000, sourceStartFrame: 12, sourceEndFrame: 48,
	});
	assert.deepEqual(proposal.cropKeyframes.map(({ sourceFrame }) => sourceFrame), [12, 47]);
	assert.deepEqual(proposal.cropKeyframes[0]?.crop,
		{ left: 0.2, top: 0, right: 0.48359375, bottom: 0 });
	assert.equal(Object.isFrozen(proposal.cropKeyframes), true);
	assert.deepEqual(validateLocalAssistanceGuidedHighlightDraftV1(
		original, edited, sourceTimeAuthority(),
	), edited);
});

test('Guided highlight trims use admitted VFR and ramp-retime rows instead of endpoint ratios', () => {
	const original = proposals({ sourceEndFrame: 24,
		cropKeyframes: [crop(0, 0.341796875), crop(23, 0.341796875)] });
	const draft = createLocalAssistanceGuidedHighlightDraftV1(original);
	const authority = sourceTimeAuthority([
		row(0, 0, 0), row(5, 6_500, 12_000), row(12, 15_100, 30_000), row(24, 31_000, 96_000),
	]);
	const trimmed = setLocalAssistanceGuidedHighlightTrimV1(
		original, draft, 'highlight-a', 12_000, 30_000, authority,
	);
	assert.deepEqual(trimmed.proposals[0], {
		...draft.proposals[0], startFrame: 12_000, endFrame: 30_000,
		sourceStartFrame: 5, sourceEndFrame: 12,
		cropKeyframes: [crop(5, 0.341796875), crop(11, 0.341796875)],
	});
	assert.throws(() => setLocalAssistanceGuidedHighlightTrimV1(
		original, draft, 'highlight-a', 1, 48_000, authority,
	), /exact|mapping/iu);
	assert.throws(() => setLocalAssistanceGuidedHighlightTrimV1(
		original, draft, 'highlight-a', -1, 48_000, authority,
	), /range|trim|invalid/iu);
	assert.throws(() => setLocalAssistanceGuidedHighlightTrimV1(
		original, draft, 'highlight-a', 0, 96_001, authority,
	), /range|trim/iu);
	assert.throws(() => setLocalAssistanceGuidedHighlightTrimV1(
		original,
		draft,
		'highlight-a',
		12_000,
		13_000,
		sourceTimeAuthority([
			row(0, 0, 0), row(12, 12_000, 12_000), row(13, 13_000, 13_000),
			row(24, 24_000, 96_000),
		]),
	), /at least two source frames/iu);
});

test('Guided highlight drafts cannot rewrite evidence, identities, or unsafe text and crops', () => {
	const original = proposals();
	const draft = createLocalAssistanceGuidedHighlightDraftV1(original);
	assert.throws(() => setLocalAssistanceGuidedHighlightTitleV1(
		draft, 'highlight-a', '  title  ',
	), /title/iu);
	assert.throws(() => setLocalAssistanceGuidedHighlightCropV1(
		draft, 'highlight-a', 0, { left: 0.6, top: 0, right: 0.5, bottom: 0 },
		sourceTimeAuthority(),
	), /crop|aperture/iu);
	assert.throws(() => setLocalAssistanceGuidedHighlightCropV1(
		draft, 'highlight-a', 0, { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 },
		sourceTimeAuthority(),
	), /target aspect/iu);
	assert.throws(() => validateLocalAssistanceGuidedHighlightDraftV1(original, {
		...draft, proposals: [{ ...draft.proposals[0]!, score: 1 }],
	}, sourceTimeAuthority()), /evidence|authority|rewrite/iu);
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

function sourceTimeAuthority(frames = [row(0, 0, 0), row(12, 12_000, 12_000),
	row(48, 48_000, 48_000), row(96, 96_000, 96_000)]) {
	const first = frames[0]!;
	const last = frames.at(-1)!;
	return { descriptorVersion: 1 as const,
		kind: 'selected-video-source-time-authority' as const,
		schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
		projectId: 'project-a', projectRevision: 1, sequenceId: 'sequence-a',
		videoOccurrenceId: 'video-occurrence', sourceId: 'video-source',
		sourceSha256: '11'.repeat(32), timingAuthoritySha256: '22'.repeat(32),
		sourceWidth: 1_920, sourceHeight: 1_080, sourceStartFrame: first.sourceFrame,
		sourceEndFrame: last.sourceFrame, sampleRate: 48_000, timescale: 1_000,
		selectionStartFrame: first.timelineFrame, selectionEndFrame: last.timelineFrame, frames };
}

function row(sourceFrame: number, presentationTick: number, timelineFrame: number) {
	return { sourceFrame, presentationTick: String(presentationTick), timelineFrame };
}
