/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ASSISTANCE_OPERATION_CONTRACT_VERSION } from '../desktop/assistance-operation-contract.ts';
import {
	ADVANCED_ASSISTANCE_WORKFLOW_IDS,
	ASSISTANCE_GUIDED_WORKFLOW_IDS,
	ASSISTANCE_WORKFLOW_CONTRACT_VERSION,
	ASSISTANCE_WORKFLOW_FENCE_VERSION,
	ASSISTANCE_WORKFLOW_IDS,
	AssistanceWorkflowProgressTracker,
	assistanceWorkflowStageGraph,
	normalizeAssistanceWorkflowId,
	validateAssistanceWorkflow,
	validateAssistanceWorkflowFenceV1,
	validateAssistanceWorkflowProgress,
	type AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';
import { ASSISTANCE_OPERATIONS } from '../src/common/editor/assistance/operation.ts';

const JOB_ID = '01'.repeat(20);
const SHA_A = '12'.repeat(32);
const SHA_B = '34'.repeat(32);
const SHA_C = '56'.repeat(32);
const SHA_D = '78'.repeat(32);

function fence(overrides: Record<string, unknown> = {}) {
	return {
		fenceVersion: ASSISTANCE_WORKFLOW_FENCE_VERSION,
		projectId: 'project-a',
		schemaVersion: 31,
		revision: 8,
		sequenceId: 'sequence-a',
		sourceRanges: [{
			slotId: 'primary-audio',
			mediaKind: 'audio',
			sourceId: 'source-a',
			sourceSha256: SHA_A,
			occurrenceIds: ['occurrence-a'],
			sourceStartFrame: 0,
			sourceEndFrame: 96_000,
			linkMembershipSha256: SHA_B,
			timingAuthoritySha256: SHA_C,
			retimeKind: 'identity',
		}],
		transcriptBodySha256: null,
		recipeSha256: SHA_B,
		settingsSha256: SHA_C,
		modelBindingsSha256: SHA_D,
		...overrides,
	};
}

function claim(
	direction: 'input' | 'output',
	stageId: string,
	slotId: string,
	index: number,
) {
	return {
		claimVersion: 1,
		direction,
		claimId: index.toString(16).padStart(40, '0'),
		jobId: JOB_ID,
		stageId,
		slotId,
	};
}

function model(stageId: string, slotId: string, index: number) {
	return {
		bindingVersion: 1,
		stageId,
		slotId,
		modelId: index === 1 ? 'silero-vad' : 'parakeet-tdt-0.6b-v3',
		version: index === 1 ? '6.2.0' : '3.0.0',
		artifactSha256s: [index.toString(16).padStart(64, '0')],
	};
}

function workflow(overrides: Record<string, unknown> = {}): AssistanceWorkflowV1 {
	return {
		contractVersion: ASSISTANCE_WORKFLOW_CONTRACT_VERSION,
		jobId: JOB_ID,
		workflowId: 'transcribe-captions',
		recipeVersion: 1,
		settingsVersion: 1,
		fence: fence(),
		stageIds: ['detect-speech', 'recognize-speech', 'assemble-captions'],
		models: [
			model('detect-speech', 'vad', 1),
			model('recognize-speech', 'speech-recognizer', 2),
		],
		inputs: [
			claim('input', 'detect-speech', 'audio', 1),
			claim('input', 'recognize-speech', 'audio', 2),
			claim('input', 'assemble-captions', 'transcript', 3),
		],
		outputs: [
			claim('output', 'detect-speech', 'voice-activity', 4),
			claim('output', 'recognize-speech', 'transcript', 5),
			claim('output', 'assemble-captions', 'captions', 6),
		],
		...overrides,
	} as AssistanceWorkflowV1;
}

test('workflow IDs close every guided recipe and one advanced recipe per primitive operation', () => {
	assert.deepEqual(ASSISTANCE_GUIDED_WORKFLOW_IDS, [
		'transcribe-captions',
		'clean-filler-silence',
		'identify-speakers',
		'enhance-dialogue',
		'separate-dialogue-music-effects',
		'mark-reactions',
		'index-transcript',
		'detect-beats-tempo',
		'mark-cuts',
		'index-video',
		'reframe',
		'make-highlights',
		'generate-editorial-text',
	]);
	assert.equal(ADVANCED_ASSISTANCE_WORKFLOW_IDS.length, ASSISTANCE_OPERATIONS.length);
	assert.deepEqual(
		ADVANCED_ASSISTANCE_WORKFLOW_IDS,
		ASSISTANCE_OPERATIONS.map((operation) => `advanced:${operation}`),
	);
	assert.equal(ASSISTANCE_WORKFLOW_IDS.length, ASSISTANCE_GUIDED_WORKFLOW_IDS.length + 15);
	assert.equal(normalizeAssistanceWorkflowId('mark-cuts'), 'mark-cuts');
	assert.throws(() => normalizeAssistanceWorkflowId('arbitrary-pipeline'), /workflow/iu);
	assert.equal(ASSISTANCE_OPERATION_CONTRACT_VERSION, 1, 'operation-v1 remains independently supported');
});

test('main can derive an immutable permitted graph without trusting renderer-supplied operations', () => {
	const graph = assistanceWorkflowStageGraph('transcribe-captions');
	assert.deepEqual(graph.map(({ stageId, operation, required, after }) => ({
		stageId, operation, required, after,
	})), [
		{ stageId: 'detect-speech', operation: 'voice-activity-detection', required: true, after: [] },
		{ stageId: 'recognize-speech', operation: 'speech-recognition', required: true, after: ['detect-speech'] },
		{ stageId: 'align-words', operation: 'word-alignment', required: false, after: ['recognize-speech'] },
		{ stageId: 'assemble-captions', operation: null, required: true, after: ['recognize-speech'] },
	]);
	assert.equal(Object.isFrozen(graph), true);
	assert.equal(Object.isFrozen(graph[0]), true);
	assert.deepEqual(assistanceWorkflowStageGraph('advanced:audio-tagging').map(({ operation }) => operation), [
		'audio-tagging',
	]);
});

test('a workflow admits exact stages, slotted claims, model bindings, and aggregate fence', () => {
	const admitted = validateAssistanceWorkflow(workflow());
	assert.deepEqual(admitted, workflow());
	assert.equal(Object.isFrozen(admitted), true);
	assert.equal(Object.isFrozen(admitted.fence.sourceRanges), true);
	assert.equal(Object.isFrozen(admitted.models[0]?.artifactSha256s), true);

	assert.throws(
		() => validateAssistanceWorkflow(workflow({ stageIds: [
			'detect-speech', 'recognize-speech', 'execute-shell', 'assemble-captions',
		] })),
		/stage/iu,
	);
	assert.throws(
		() => validateAssistanceWorkflow(workflow({ stageIds: ['recognize-speech', 'assemble-captions'] })),
		/required stage|dependency/iu,
	);
	assert.throws(
		() => validateAssistanceWorkflow(workflow({ models: [
			model('detect-speech', 'vad', 1),
			model('recognize-speech', 'untrusted-model-slot', 2),
		] })),
		/model slot/iu,
	);
	assert.throws(
		() => validateAssistanceWorkflow(workflow({ models: [model('detect-speech', 'vad', 1)] })),
		/required model/iu,
	);
	assert.throws(
		() => validateAssistanceWorkflow(workflow({ inputs: [
			...workflow().inputs,
			claim('input', 'recognize-speech', 'filesystem-path', 20),
		] })),
		/input slot/iu,
	);
});

test('optional graph stages become exact only when selected', () => {
	const withAlignment = workflow({
		stageIds: ['detect-speech', 'recognize-speech', 'align-words', 'assemble-captions'],
		models: [
			...workflow().models,
			{
				...model('align-words', 'alignment', 3),
				modelId: 'wav2vec2-base-960h',
			},
		],
		inputs: [
			...workflow().inputs,
			claim('input', 'align-words', 'audio', 21),
			claim('input', 'align-words', 'transcript', 22),
		],
		outputs: [
			...workflow().outputs,
			claim('output', 'align-words', 'word-alignment', 23),
		],
	});
	assert.deepEqual(validateAssistanceWorkflow(withAlignment).stageIds, withAlignment.stageIds);
	assert.throws(
		() => validateAssistanceWorkflow(workflow({ models: [
			...workflow().models,
			model('align-words', 'alignment', 3),
		] })),
		/unselected stage/iu,
	);
});

test('the aggregate fence binds every source range and refuses ambiguous or unsupported timing', () => {
	const second = {
		...fence().sourceRanges[0],
		slotId: 'primary-video',
		mediaKind: 'video',
		sourceId: 'source-b',
		sourceSha256: SHA_D,
		occurrenceIds: ['occurrence-b'],
		retimeKind: 'monotonic-forward',
	};
	const aggregate = validateAssistanceWorkflowFenceV1(fence({
		sourceRanges: [...fence().sourceRanges, second],
		transcriptBodySha256: SHA_A,
	}));
	assert.equal(aggregate.sourceRanges.length, 2);
	assert.equal(aggregate.transcriptBodySha256, SHA_A);
	assert.throws(
		() => validateAssistanceWorkflowFenceV1(fence({ sourceRanges: [
			second, ...fence().sourceRanges,
		] })),
		/canonical order/iu,
	);
	assert.throws(
		() => validateAssistanceWorkflowFenceV1(fence({ sourceRanges: [{
			...fence().sourceRanges[0], retimeKind: 'reverse',
		}] })),
		/retime/iu,
	);
	assert.throws(
		() => validateAssistanceWorkflowFenceV1(fence({ sourceRanges: [{
			...fence().sourceRanges[0], sourceEndFrame: 0,
		}] })),
		/source range/iu,
	);
	assert.throws(
		() => validateAssistanceWorkflowFenceV1(fence({ sourceRanges: [
			fence().sourceRanges[0], { ...second, occurrenceIds: ['occurrence-a'] },
		] })),
		/occurrence.*unique/iu,
	);
	assert.throws(
		() => validateAssistanceWorkflowFenceV1({ ...fence(), path: '/private/project.scape' }),
		/fence.*keys|schema keys/iu,
	);
});

test('stage-aware progress is correlated and advances monotonically through the selected graph', () => {
	const request = workflow();
	const update = (overrides: Record<string, unknown> = {}) => ({
		contractVersion: ASSISTANCE_WORKFLOW_CONTRACT_VERSION,
		jobId: JOB_ID,
		workflowId: 'transcribe-captions',
		sequence: 0,
		stageId: 'detect-speech',
		stageIndex: 0,
		stageCount: 3,
		phase: 'running',
		completed: 1,
		total: 4,
		...overrides,
	});
	assert.deepEqual(validateAssistanceWorkflowProgress(update(), request), update());
	assert.throws(
		() => validateAssistanceWorkflowProgress(update({ stageId: 'align-words', stageIndex: 2 }), request),
		/selected stage|stage index/iu,
	);
	assert.throws(
		() => validateAssistanceWorkflowProgress(update({ workflowId: 'mark-cuts' }), request),
		/correlate/iu,
	);

	const tracker = new AssistanceWorkflowProgressTracker(request);
	assert.equal(tracker.accept(update()).sequence, 0);
	assert.equal(tracker.accept(update({ sequence: 1, phase: 'finalizing', completed: null, total: null })).phase,
		'finalizing');
	assert.equal(tracker.accept(update({
		sequence: 2,
		stageId: 'recognize-speech',
		stageIndex: 1,
		phase: 'running',
		completed: 1,
		total: 2,
	})).stageIndex, 1);
	assert.throws(
		() => tracker.accept(update({ sequence: 3, stageIndex: 0 })),
		/stage.*regress|stage index/iu,
	);
});
