/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createLocalAssistanceGuidedResultAcceptance as createGuidedResultAcceptance,
} from '../src/common/editor/controller/local-assistance-guided-result-acceptance.ts';
import {
	createLocalAssistanceGuidedHighlightDraftV1,
	setLocalAssistanceGuidedHighlightTitleV1,
} from '../src/common/editor/controller/local-assistance-guided-highlight-edits.ts';
import {
	createLocalAssistanceGuidedReframeDraftV1,
	setLocalAssistanceGuidedReframeCropV1,
} from '../src/common/editor/controller/local-assistance-guided-reframe-edits.ts';
import {
	assistanceWorkflowModelBindingsSha256V1,
	assistanceWorkflowRecipeSha256V1,
	type AssistanceWorkflowModelBindingV1,
	type AssistanceWorkflowSourceRangeV1,
	type AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';
import {
	assistanceWorkflowSettingsSha256V1,
	defaultAssistanceWorkflowSettingsV1,
} from '../src/common/editor/assistance/workflow-settings-v1.ts';

const JOB_ID = '01'.repeat(20);
const MODEL_SHA256 = '34'.repeat(32);

type AcceptanceDependencies = Parameters<typeof createGuidedResultAcceptance>[0];
function createLocalAssistanceGuidedResultAcceptance(
	dependencies: Omit<AcceptanceDependencies, 'assertCurrentWorkflowFence'>,
) {
	return createGuidedResultAcceptance({
		assertCurrentWorkflowFence: async () => undefined,
		...dependencies,
	});
}

test('Guided Reframe keeps its path unchecked and revalidates before exact publication', async () => {
	const workflow = reframeWorkflow();
	const result = reframeResult();
	const held = reviewed(workflow, 'plan-crops', 'reframe-path', result,
		[{ id: 'reframe-path', kind: 'reframe', label: '9:16 crop path' }]);
	let current = primitiveFence(workflow);
	const calls: unknown[] = [];
	const acceptance = createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => current,
		acceptReframeResult: async (request) => { calls.push(request); },
	});
	const empty = acceptance.createAcceptanceSession({ workflow, reviewedResult: held });
	assert.equal(empty.outcome, 'ready');
	if (empty.outcome !== 'ready') return;
	assert.deepEqual(empty.session.snapshot().choices.map(({ selected }) => selected), [false]);
	assert.deepEqual(await empty.session.accept([]), { outcome: 'accepted', selectedIds: [] });
	assert.equal(calls.length, 0);

	const selected = acceptance.createAcceptanceSession({ workflow, reviewedResult: held });
	assert.equal(selected.outcome, 'ready');
	if (selected.outcome !== 'ready') return;
	await selected.session.accept(['reframe-path']);
	assert.deepEqual(calls, [{ fence: workflow.fence, result }]);

	const stale = acceptance.createAcceptanceSession({ workflow, reviewedResult: held });
	assert.equal(stale.outcome, 'ready');
	if (stale.outcome !== 'ready') return;
	current = { ...current, revision: current.revision + 1 };
	await assert.rejects(stale.session.accept(['reframe-path']), /stale|no longer matches/iu);
	assert.equal(calls.length, 1);
});

test('Guided Reframe publishes only bounded transient crop edits', async () => {
	const workflow = reframeWorkflow();
	const result = reframeResult();
	const held = reviewed(workflow, 'plan-crops', 'reframe-path', result,
		[{ id: 'reframe-path', kind: 'reframe', label: '9:16 crop path' }]);
	const draft = setLocalAssistanceGuidedReframeCropV1(
		createLocalAssistanceGuidedReframeDraftV1(result), 0,
		{ left: 0.2, top: 0, right: 0.48359375, bottom: 0 },
	);
	const calls: unknown[] = [];
	const ready = createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => primitiveFence(workflow),
		acceptReframeResult: async (request) => { calls.push(request); },
	}).createAcceptanceSession({ workflow, reviewedResult: held, reframeDraft: draft });
	assert.equal(ready.outcome, 'ready');
	if (ready.outcome !== 'ready') return;
	await ready.session.accept(['reframe-path']);
	assert.deepEqual((calls[0] as { result: ReturnType<typeof reframeResult> }).result
		.path.keyframes[0]?.crop, draft.path.keyframes[0]?.crop);
	assert.throws(() => createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => primitiveFence(workflow),
		acceptReframeResult: async () => undefined,
	}).createAcceptanceSession({ workflow, reviewedResult: held,
		reframeDraft: { ...draft, authority: { ...draft.authority, timescale: 30 } } }),
	/authority/iu);
});

test('Guided Highlights forwards only the explicit initially-unselected proposal subset', async () => {
	const workflow = highlightWorkflow();
	const result = highlightResult();
	const held = reviewed(workflow, 'assemble-highlights', 'highlight-proposals', result,
		result.proposals.map(({ id }) => ({ id, kind: 'highlight', label: id })));
	const calls: unknown[] = [];
	const acceptance = createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => primitiveFence(workflow, true),
		acceptHighlightResult: async (request) => { calls.push(request); },
	});
	const ready = acceptance.createAcceptanceSession({ workflow, reviewedResult: held });
	assert.equal(ready.outcome, 'ready');
	if (ready.outcome !== 'ready') return;
	assert.deepEqual(ready.session.snapshot().choices.map(({ id, selected }) => ({ id, selected })), [
		{ id: 'highlight-a', selected: false }, { id: 'highlight-b', selected: false },
	]);
	await ready.session.accept(['highlight-b']);
	assert.deepEqual(calls, [{ fence: workflow.fence, result,
		selectedProposalIds: ['highlight-b'] }]);
});

test('Guided Highlights admits authenticated monotonic-forward timing for exact publication', async () => {
	const workflow = highlightWorkflow('monotonic-forward');
	const result = highlightResult();
	const held = reviewed(workflow, 'assemble-highlights', 'highlight-proposals', result,
		result.proposals.map(({ id }) => ({ id, kind: 'highlight', label: id })));
	const calls: unknown[] = [];
	const availability = createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => primitiveFence(workflow, true),
		acceptHighlightResult: async (request) => { calls.push(request); },
	}).createAcceptanceSession({ workflow, reviewedResult: held });
	assert.equal(availability.outcome, 'ready');
	if (availability.outcome !== 'ready') return;
	await availability.session.accept(['highlight-a']);
	assert.deepEqual(calls, [{ fence: workflow.fence, result,
		selectedProposalIds: ['highlight-a'] }]);
});

test('Guided Highlights revalidates bounded review edits separately from authenticated evidence', async () => {
	const workflow = highlightWorkflow();
	const result = highlightResult();
	const held = reviewed(workflow, 'assemble-highlights', 'highlight-proposals', result,
		result.proposals.map(({ id }) => ({ id, kind: 'highlight', label: id })));
	const draft = setLocalAssistanceGuidedHighlightTitleV1(
		createLocalAssistanceGuidedHighlightDraftV1(result), 'highlight-b', 'Edited title',
	);
	const calls: unknown[] = [];
	const availability = createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => primitiveFence(workflow, true),
		acceptHighlightResult: async (request) => { calls.push(request); },
	}).createAcceptanceSession({ workflow, reviewedResult: held, highlightDraft: draft,
		highlightSourceTimeAuthority: highlightSourceTimeAuthority() });
	assert.equal(availability.outcome, 'ready');
	if (availability.outcome !== 'ready') return;
	await availability.session.accept(['highlight-b']);
	assert.equal((calls[0] as { result: ReturnType<typeof highlightResult> }).result
		.proposals[1]?.title, 'Edited title');
	const hostile = { ...draft, proposals: [{ ...draft.proposals[0]!, score: 1 }, draft.proposals[1]!] };
	assert.throws(() => createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => primitiveFence(workflow, true),
		acceptHighlightResult: async () => undefined,
	}).createAcceptanceSession({ workflow, reviewedResult: held, highlightDraft: hostile,
		highlightSourceTimeAuthority: highlightSourceTimeAuthority() }),
	/evidence|authority|rewrite/iu);
});

test('Guided Framescaper workflows remain unavailable without their publication ports', () => {
	for (const workflow of [reframeWorkflow(), highlightWorkflow()]) {
		const availability = createLocalAssistanceGuidedResultAcceptance({
			currentSelectionFence: () => primitiveFence(workflow,
				workflow.workflowId === 'make-highlights'),
		}).createAcceptanceSession({ workflow, reviewedResult: {} });
		assert.deepEqual(availability, { outcome: 'unsupported', workflowId: workflow.workflowId,
			reason: 'primitive-acceptance-unavailable' });
	}
});

function reframeWorkflow(): AssistanceWorkflowV1 {
	const stages = ['detect-subjects', 'detect-saliency', 'track-subjects', 'plan-crops'];
	const models = [
		model('detect-subjects', 'face-detector', 'yunet'),
		model('detect-subjects', 'object-detector', 'd-fine'),
		model('detect-saliency', 'saliency-detector', 'u2netp'),
	];
	return workflow('reframe', stages, models, [
		claim('input', 'detect-subjects', 'frame-pack', 1),
		claim('input', 'detect-saliency', 'frame-pack', 2),
		claim('input', 'track-subjects', 'subject-tracks', 3),
		claim('input', 'plan-crops', 'tracked-subjects', 4),
		claim('input', 'plan-crops', 'saliency-map', 5),
	], [
		claim('output', 'detect-subjects', 'subject-tracks', 6),
		claim('output', 'detect-saliency', 'saliency-map', 7),
		claim('output', 'track-subjects', 'tracked-subjects', 8),
		claim('output', 'plan-crops', 'reframe-path', 9),
	], [videoRange()]);
}

function highlightWorkflow(
	retimeKind: AssistanceWorkflowSourceRangeV1['retimeKind'] = 'identity',
): AssistanceWorkflowV1 {
	const stages = ['detect-highlight-shots', 'gather-signals',
		'rank-highlights', 'assemble-highlights'];
	return workflow('make-highlights', stages, [], [
		claim('input', 'detect-highlight-shots', 'video', 1),
		claim('input', 'gather-signals', 'video', 2),
		claim('input', 'gather-signals', 'audio', 3),
		claim('input', 'gather-signals', 'shot-boundaries', 4),
		claim('input', 'rank-highlights', 'highlight-signals', 5),
		claim('input', 'assemble-highlights', 'highlight-candidates', 6),
	], [
		claim('output', 'detect-highlight-shots', 'shot-boundaries', 7),
		claim('output', 'gather-signals', 'highlight-signals', 8),
		claim('output', 'rank-highlights', 'highlight-candidates', 9),
		claim('output', 'assemble-highlights', 'highlight-proposals', 10),
	], [audioRange(), videoRange(retimeKind)]);
}

function workflow(
	workflowId: 'reframe' | 'make-highlights',
	stageIds: readonly string[],
	models: readonly AssistanceWorkflowModelBindingV1[],
	inputs: AssistanceWorkflowV1['inputs'],
	outputs: AssistanceWorkflowV1['outputs'],
	sourceRanges: readonly AssistanceWorkflowSourceRangeV1[],
): AssistanceWorkflowV1 {
	const settings = defaultAssistanceWorkflowSettingsV1(workflowId);
	return {
		contractVersion: 1, jobId: JOB_ID, workflowId, recipeVersion: 1, settingsVersion: 1,
		settings, stageIds, models, inputs, outputs,
		fence: {
			fenceVersion: 1, projectId: 'project-a', schemaVersion: 31, revision: 8,
			sequenceId: 'sequence-a', sourceRanges, transcriptBodySha256: null,
			recipeSha256: assistanceWorkflowRecipeSha256V1(workflowId, 1, stageIds),
			settingsSha256: assistanceWorkflowSettingsSha256V1(settings),
			modelBindingsSha256: assistanceWorkflowModelBindingsSha256V1(models),
		},
	};
}

function videoRange(
	retimeKind: AssistanceWorkflowSourceRangeV1['retimeKind'] = 'identity',
): AssistanceWorkflowSourceRangeV1 {
	return { slotId: 'primary-video', mediaKind: 'video', sourceId: 'video-source',
		sourceSha256: '12'.repeat(32), sourceSampleRate: null,
		occurrenceIds: ['video-occurrence'], sourceStartFrame: 0, sourceEndFrame: 240,
		linkMembershipSha256: '56'.repeat(32), timingAuthoritySha256: '78'.repeat(32),
		retimeKind };
}

function audioRange(): AssistanceWorkflowSourceRangeV1 {
	return { slotId: 'primary-audio', mediaKind: 'audio', sourceId: 'audio-source',
		sourceSha256: '9a'.repeat(32), sourceSampleRate: 48_000,
		occurrenceIds: ['audio-occurrence'], sourceStartFrame: 0, sourceEndFrame: 96_000,
		linkMembershipSha256: '56'.repeat(32), timingAuthoritySha256: 'bc'.repeat(32),
		retimeKind: 'identity' };
}

function reframeResult() {
	const left = 0.341796875;
	return { schemaVersion: 1, kind: 'reframe-path', authority: {
		width: 1_920, height: 1_080, timescale: 24,
		frames: [{ sourceFrame: 0, presentationTick: '0' },
			{ sourceFrame: 239, presentationTick: '239' }],
	}, fallbackChain: ['subject', 'saliency', 'center'], path: {
		schemaVersion: 1, targetAspect: { width: 9, height: 16 }, keyframes: [
			cropKeyframe(0, left), cropKeyframe(239, left),
		],
	} };
}

function highlightResult() {
	return { schemaVersion: 1, kind: 'highlight-proposals', workflowId: 'make-highlights',
		targetAspect: { width: 9, height: 16 }, proposals: [
			highlight('highlight-a', 0, 48_000, 0, 119),
			highlight('highlight-b', 48_000, 96_000, 120, 239),
		] };
}

function highlight(id: string, startFrame: number, endFrame: number,
	sourceStartFrame: number, lastSourceFrame: number) {
	return { id, startFrame, endFrame, sourceStartFrame, sourceEndFrame: lastSourceFrame + 1,
		score: 0.8, evidenceMode: 'transcript', transcriptExcerpt: 'Exact transcript evidence.',
		visualSummary: 'Exact visual evidence.', selected: false,
		videoOccurrenceId: 'video-occurrence', audioOccurrenceId: 'audio-occurrence', title: id,
		hook: null, chapters: [], explanation: null,
		cropKeyframes: [cropKeyframe(sourceStartFrame, 0.341796875),
			cropKeyframe(lastSourceFrame, 0.341796875)] };
}

function cropKeyframe(sourceFrame: number, left: number) {
	return { sourceFrame, authority: 'center', trackIds: [],
		crop: { left, top: 0, right: 1 - 0.31640625 - left, bottom: 0 } };
}

function highlightSourceTimeAuthority() {
	return { schemaVersion: 1, kind: 'selected-video-source-time-authority',
		projectId: 'project-a', projectRevision: 1, sequenceId: 'sequence-a',
		videoOccurrenceId: 'video-occurrence', sourceId: 'video-source',
		sourceSha256: '78'.repeat(32), timingAuthoritySha256: 'bc'.repeat(32),
		sourceWidth: 1_920, sourceHeight: 1_080, sourceStartFrame: 0, sourceEndFrame: 240,
		sampleRate: 48_000, timescale: 24, selectionStartFrame: 0, selectionEndFrame: 96_000,
		frames: [{ sourceFrame: 0, presentationTick: '0', timelineFrame: 0 },
			{ sourceFrame: 120, presentationTick: '120', timelineFrame: 48_000 },
			{ sourceFrame: 240, presentationTick: '240', timelineFrame: 96_000 }],
	};
}

function model(stageId: string, slotId: string, modelId: string): AssistanceWorkflowModelBindingV1 {
	return { bindingVersion: 1, stageId, slotId, modelId, version: '1.0.0',
		artifactSha256s: [MODEL_SHA256] };
}

function claim<const Direction extends 'input' | 'output'>(
	direction: Direction,
	stageId: string,
	slotId: string,
	index: number,
) {
	return { claimVersion: 1 as const, direction, claimId: index.toString(16).padStart(40, '0'),
		jobId: JOB_ID, stageId, slotId };
}

function reviewed(
	workflowValue: AssistanceWorkflowV1,
	stageId: string,
	slotId: string,
	semantic: unknown,
	choices: readonly Readonly<{ id: string; kind: string; label: string }>[],
) {
	const text = JSON.stringify(semantic);
	const body = new Blob([text], { type: `application/vnd.soundscaper.${slotId}+json` });
	const output = workflowValue.outputs.find((candidate) => candidate.stageId === stageId
		&& candidate.slotId === slotId)!;
	return { reviewVersion: 1, jobId: workflowValue.jobId, workflowId: workflowValue.workflowId,
		outputs: [{ stageId, slotId, claim: output, mediaType: body.type, byteLength: body.size,
			sha256: createHash('sha256').update(text).digest('hex'), body, semantic }],
		choices: choices.map((choice) => ({ ...choice, selected: false, enabled: true })) };
}

function primitiveFence(workflowValue: AssistanceWorkflowV1, includeLinked = false) {
	const range = workflowValue.fence.sourceRanges.find(({ mediaKind }) => mediaKind === 'video')!;
	return { projectId: workflowValue.fence.projectId, schemaVersion: workflowValue.fence.schemaVersion,
		revision: workflowValue.fence.revision, sequenceId: workflowValue.fence.sequenceId,
		occurrenceIds: includeLinked ? ['audio-occurrence', 'video-occurrence'] : range.occurrenceIds,
		sourceId: range.sourceId, sourceSha256: range.sourceSha256,
		sourceStartFrame: range.sourceStartFrame, sourceEndFrame: range.sourceEndFrame,
		linkMembershipSha256: range.linkMembershipSha256,
		timingAuthoritySha256: range.timingAuthoritySha256 };
}
