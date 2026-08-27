/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceGuidedHighlightPreviewPlanV1,
	extractLocalAssistanceGuidedHighlightSourceTimeAuthorityV1,
	snapLocalAssistanceGuidedHighlightTrimBoundaryV1,
} from '../src/common/editor/controller/local-assistance-guided-highlight-preview.ts';
import { assistanceWorkflowFixture } from './helpers/assistance-workflow-fixture.ts';

test('highlight preview seeks the exact edited VFR/retime interval and current crop', () => {
	const workflow = highlightWorkflow();
	const authority = extractLocalAssistanceGuidedHighlightSourceTimeAuthorityV1(workflow, {
		schemaVersion: 1, kind: 'highlight-video-signals', sourceId: 'source-a',
		sampleRate: 48_000, timescale: 1_000, sourceSize: { width: 1_920, height: 1_080 },
		videoOccurrenceId: 'clip-a', audioOccurrenceId: null,
		selectionStartFrame: 0, selectionEndFrame: 48_000, reframeEvidence: null,
		sourceTimeAuthority: [row(0, 0, 0), row(5, 6_500, 12_000),
			row(12, 15_100, 30_000), row(24, 31_000, 48_000)], windows: [],
	});
	const plan = createLocalAssistanceGuidedHighlightPreviewPlanV1(authority, {
		id: 'highlight-a', startFrame: 12_000, endFrame: 30_000,
		sourceStartFrame: 5, sourceEndFrame: 12, score: 0.8, evidenceMode: 'speechless',
		transcriptExcerpt: null, visualSummary: 'Exact visual evidence.', selected: false,
		videoOccurrenceId: 'clip-a', audioOccurrenceId: null, title: 'Highlight 1', hook: null,
		chapters: [], explanation: null, cropKeyframes: [crop(5, 0.2), crop(11, 0.25)],
	});
	assert.deepEqual(plan, { proposalId: 'highlight-a', startSeconds: 6.5, endSeconds: 15.1,
		sourceStartFrame: 5, sourceEndFrame: 12,
		crop: { left: 0.2, top: 0, right: 0.48359375, bottom: 0 } });
});

test('highlight preview refuses a boundary absent from admitted source-time rows', () => {
	const workflow = highlightWorkflow();
	const authority = extractLocalAssistanceGuidedHighlightSourceTimeAuthorityV1(workflow, {
		schemaVersion: 1, kind: 'highlight-video-signals', sourceId: 'source-a',
		sampleRate: 48_000, timescale: 1_000, sourceSize: { width: 1_920, height: 1_080 },
		videoOccurrenceId: 'clip-a', audioOccurrenceId: null,
		selectionStartFrame: 0, selectionEndFrame: 48_000, reframeEvidence: null,
		sourceTimeAuthority: [row(0, 0, 0), row(24, 31_000, 48_000)], windows: [],
	});
	assert.throws(() => createLocalAssistanceGuidedHighlightPreviewPlanV1(authority, {
		id: 'highlight-a', startFrame: 1, endFrame: 48_000, sourceStartFrame: 1,
		sourceEndFrame: 24, score: 0.8, evidenceMode: 'speechless', transcriptExcerpt: null,
		visualSummary: 'Exact visual evidence.', selected: false, videoOccurrenceId: 'clip-a',
		audioOccurrenceId: null, title: 'Highlight 1', hook: null, chapters: [], explanation: null,
		cropKeyframes: [crop(1, 0.2), crop(23, 0.25)],
	}), /exact admitted source interval/iu);
});

test('highlight trim controls snap inward to exact admitted VFR boundaries', () => {
	const authority = extractLocalAssistanceGuidedHighlightSourceTimeAuthorityV1(highlightWorkflow(), {
		schemaVersion: 1, kind: 'highlight-video-signals', sourceId: 'source-a',
		sampleRate: 48_000, timescale: 1_000, sourceSize: { width: 1_920, height: 1_080 },
		videoOccurrenceId: 'clip-a', audioOccurrenceId: null,
		selectionStartFrame: 0, selectionEndFrame: 48_000, reframeEvidence: null,
		sourceTimeAuthority: [row(0, 0, 0), row(5, 6_500, 12_000),
			row(12, 15_100, 30_000), row(24, 31_000, 48_000)], windows: [],
	});
	const proposal = { id: 'highlight-a', startFrame: 0, endFrame: 48_000,
		sourceStartFrame: 0, sourceEndFrame: 24, score: 0.8, evidenceMode: 'speechless' as const,
		transcriptExcerpt: null, visualSummary: 'Exact visual evidence.', selected: false as const,
		videoOccurrenceId: 'clip-a', audioOccurrenceId: null, title: 'Highlight 1', hook: null,
		chapters: [], explanation: null, cropKeyframes: [crop(0, 0.2), crop(23, 0.25)] };
	assert.equal(snapLocalAssistanceGuidedHighlightTrimBoundaryV1(
		authority, proposal, 'start', 20_000,
	), 30_000, 'start snaps forward/inward');
	assert.equal(snapLocalAssistanceGuidedHighlightTrimBoundaryV1(
		authority, proposal, 'end', 20_000,
	), 12_000, 'end snaps backward/inward');
	assert.equal(snapLocalAssistanceGuidedHighlightTrimBoundaryV1(
		authority, proposal, 'start', Number.NaN,
	), 0, 'invalid input retains the current exact boundary');
});

function videoRange() {
	return { slotId: 'primary-video', mediaKind: 'video' as const, sourceId: 'source-a',
		sourceSha256: 'aa'.repeat(32), sourceSampleRate: null, occurrenceIds: ['clip-a'],
		sourceStartFrame: 0, sourceEndFrame: 24, linkMembershipSha256: 'bb'.repeat(32),
		timingAuthoritySha256: 'cc'.repeat(32), retimeKind: 'monotonic-forward' as const };
}

function highlightWorkflow() {
	const workflow = assistanceWorkflowFixture({ workflowId: 'make-highlights',
		stageIds: highlightStages(), models: [] });
	return { ...workflow, fence: { ...workflow.fence, sourceRanges: [videoRange()] } };
}

function highlightStages() {
	return ['detect-highlight-shots', 'gather-signals', 'rank-highlights',
		'assemble-highlights'];
}

function row(sourceFrame: number, presentationTick: number, timelineFrame: number) {
	return { sourceFrame, presentationTick: String(presentationTick), timelineFrame };
}

function crop(sourceFrame: number, left: number) {
	return { sourceFrame, authority: 'center' as const, trackIds: [],
		crop: { left, top: 0, right: 1 - 0.31640625 - left, bottom: 0 } };
}
