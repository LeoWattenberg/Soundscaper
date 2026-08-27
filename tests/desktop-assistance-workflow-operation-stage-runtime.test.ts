/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAssistanceOutputClaim,
	validateAssistanceOutputReservation,
	validateAssistanceStagedInputClaim } from '../desktop/assistance-data-claims.ts';
import { validateAssistanceOperationRequest } from '../desktop/assistance-operation-contract.ts';
import {
	canonicalizeAssistanceWorkflowOperationModelBindingsV1,
	createAssistanceWorkflowOperationStageRuntime,
} from '../desktop/assistance-workflow-operation-stage-runtime.ts';
import {
	createAssistanceWorkflowStageCustodyToken,
	type AssistanceWorkflowStageExecutionV1,
} from '../desktop/assistance-workflow-executor.ts';
import {
	assistanceWorkflowStageGraph,
	validateAssistanceWorkflow,
	type AssistanceWorkflowClaimV1,
	type AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';
import { assistanceWorkflowFixture, WORKFLOW_JOB_ID } from './helpers/assistance-workflow-fixture.ts';

const INPUT_ID = '11'.repeat(20);
const OUTPUT_ID = '22'.repeat(20);

test('primitive workflow stages execute through operation-v1 and record exact authenticated outputs', async () => {
	const request = enhancementWorkflow();
	const input = validateAssistanceStagedInputClaim({ claimVersion: 1, claimId: INPUT_ID,
		jobId: WORKFLOW_JOB_ID, role: 'audio', mediaType: 'audio/wav', byteLength: 4,
		sha256: 'aa'.repeat(32) });
	const reservation = validateAssistanceOutputReservation({ claimVersion: 1, claimId: OUTPUT_ID,
		jobId: WORKFLOW_JOB_ID, role: 'enhanced-audio', mediaType: 'audio/wav',
		maximumByteLength: 4096 });
	const output = validateAssistanceOutputClaim({ claimVersion: 1, claimId: OUTPUT_ID,
		jobId: WORKFLOW_JOB_ID, role: 'enhanced-audio', mediaType: 'audio/wav',
		byteLength: 4, sha256: 'bb'.repeat(32) });
	let operationRequest: unknown = null;
	const recorded: unknown[] = [];
	const runtime = createAssistanceWorkflowOperationStageRuntime({
		operations: { executeStaged: async (value) => {
			operationRequest = value;
			return { contractVersion: 1, jobId: WORKFLOW_JOB_ID,
				operation: 'speech-enhancement' as const, outcome: 'completed' as const,
				result: { contractVersion: 1, jobId: WORKFLOW_JOB_ID,
					operation: 'speech-enhancement' as const, outputs: [output] } };
		} },
		custody: {
		operationInputClaim: async (_claim, operation) => {
			assert.equal(operation, 'speech-enhancement'); return input;
		},
			outputReservationForClaim: () => reservation,
			recordAuthenticatedOutputForClaim: async (claim, result) => {
				recorded.push([claim, result]); return output;
			},
		},
	});
	const progress: unknown[] = [];
	const result = await runtime(stageExecution(request, (completed, total) =>
		progress.push([completed, total])));
	assert.deepEqual(result, { outcome: 'completed' });
	const validated = validateAssistanceOperationRequest(operationRequest);
	assert.equal(validated.operation, 'speech-enhancement');
	assert.deepEqual(validated.selectionFence, {
		projectId: 'project-a', schemaVersion: 31, revision: 8, sequenceId: 'sequence-a',
		occurrenceIds: ['occurrence-a'], sourceId: 'source-a', sourceSha256: '12'.repeat(32),
		sourceStartFrame: 0, sourceEndFrame: 96_000,
		linkMembershipSha256: '34'.repeat(32), timingAuthoritySha256: '56'.repeat(32),
	});
	assert.equal(recorded.length, 1);
	assert.deepEqual(progress, [[1, 1]]);
});

test('Whisper workflow projection carries the exact selected language into operation-v1', async () => {
	for (const language of ['auto', 'en'] as const) {
		const request = whisperWorkflow(language);
		let operationRequest: unknown = null;
		const runtime = createAssistanceWorkflowOperationStageRuntime({
			operations: { executeStaged: async (value) => {
				operationRequest = value;
				return { contractVersion: 1, jobId: WORKFLOW_JOB_ID,
					operation: 'speech-recognition' as const, outcome: 'unavailable' as const,
					reason: 'model-unavailable' as const };
			} },
			custody: {
				operationInputClaim: async (claimValue) => {
					const claim = claimValue as AssistanceWorkflowClaimV1;
					return validateAssistanceStagedInputClaim({
						claimVersion: 1, claimId: claim.claimId, jobId: WORKFLOW_JOB_ID,
						role: claim.slotId === 'audio' ? 'audio' : 'voice-activity',
						mediaType: claim.slotId === 'audio' ? 'audio/wav' : 'application/json',
						byteLength: 4, sha256: 'aa'.repeat(32),
					});
				},
				outputReservationForClaim: (claimValue) => {
					const claim = claimValue as AssistanceWorkflowClaimV1;
					return validateAssistanceOutputReservation({
						claimVersion: 1, claimId: claim.claimId, jobId: WORKFLOW_JOB_ID,
						role: 'transcript', mediaType: 'application/json', maximumByteLength: 4096,
					});
				},
				recordAuthenticatedOutputForClaim: async () => {
					throw new Error('An unavailable operation must not publish output.');
				},
			},
		});
		assert.deepEqual(await runtime(stageExecution(request, () => undefined, 'recognize-speech')),
			{ outcome: 'unavailable', reason: 'model-unavailable' });
		assert.deepEqual(validateAssistanceOperationRequest(operationRequest).settings,
			{ settingsVersion: 1, language });
	}
});

test('primitive projection refuses ambiguous multi-source authority without touching custody', async () => {
	const request = enhancementWorkflow();
	const second = { ...request.fence.sourceRanges[0]!, slotId: 'secondary-audio',
		sourceId: 'source-b', sourceSha256: '13'.repeat(32), occurrenceIds: ['occurrence-b'] };
	const multi = validateAssistanceWorkflow({ ...request,
		fence: { ...request.fence, sourceRanges: [...request.fence.sourceRanges, second] } });
	let touched = false;
	const runtime = createAssistanceWorkflowOperationStageRuntime({
		operations: { executeStaged: async () => { touched = true; throw new Error('must not execute'); } },
		custody: {
			operationInputClaim: async () => { touched = true; throw new Error('must not resolve'); },
			outputReservationForClaim: () => { touched = true; throw new Error('must not reserve'); },
			recordAuthenticatedOutputForClaim: async () => { touched = true; throw new Error('must not record'); },
		},
	});
	assert.deepEqual(await runtime(stageExecution(multi, () => undefined)), {
		outcome: 'unavailable', reason: 'stage-unavailable',
	});
	assert.equal(touched, false);
});

test('editorial reranking projects video authority from a linked audio/video highlight fence', async () => {
	const request = highlightsWorkflow();
	const input = validateAssistanceStagedInputClaim({ claimVersion: 1, claimId: INPUT_ID,
		jobId: WORKFLOW_JOB_ID, role: 'editorial-context', mediaType: 'application/json', byteLength: 4,
		sha256: 'aa'.repeat(32) });
	const reservation = validateAssistanceOutputReservation({ claimVersion: 1, claimId: OUTPUT_ID,
		jobId: WORKFLOW_JOB_ID, role: 'editorial-proposal', mediaType: 'application/json',
		maximumByteLength: 4096 });
	const output = validateAssistanceOutputClaim({ claimVersion: 1, claimId: OUTPUT_ID,
		jobId: WORKFLOW_JOB_ID, role: 'editorial-proposal', mediaType: 'application/json',
		byteLength: 4, sha256: 'bb'.repeat(32) });
	let operationRequest: unknown = null;
	const runtime = createAssistanceWorkflowOperationStageRuntime({
		operations: { executeStaged: async (value) => {
			operationRequest = value;
			return { contractVersion: 1, jobId: WORKFLOW_JOB_ID,
				operation: 'editorial-generation' as const, outcome: 'completed' as const,
				result: { contractVersion: 1, jobId: WORKFLOW_JOB_ID,
					operation: 'editorial-generation' as const, outputs: [output] } };
		} },
		custody: {
			operationInputClaim: async () => input,
			outputReservationForClaim: () => reservation,
			recordAuthenticatedOutputForClaim: async () => output,
		},
	});
	assert.deepEqual(await runtime(stageExecution(request, () => undefined, 'rerank-editorial')),
		{ outcome: 'completed' });
	const validated = validateAssistanceOperationRequest(operationRequest);
	assert.equal(validated.selectionFence.sourceId, 'source-video');
	assert.deepEqual(validated.selectionFence.occurrenceIds, ['occurrence-video']);
});

test('workflow OCR canonicalizes only two byte-identical detector and recognizer bindings', () => {
	const binding = Object.freeze({ modelId: 'ppocr-v4-mobile', version: '4.0.0',
		artifactSha256s: Object.freeze(['01'.repeat(32), '02'.repeat(32)]) });
	assert.deepEqual(canonicalizeAssistanceWorkflowOperationModelBindingsV1(
		'optical-character-recognition', [binding, { ...binding }]), [binding]);
	assert.throws(() => canonicalizeAssistanceWorkflowOperationModelBindingsV1(
		'optical-character-recognition', [binding, { ...binding, version: '4.0.1' }]),
	/exactly identical|PP-OCR/iu);
	assert.throws(() => canonicalizeAssistanceWorkflowOperationModelBindingsV1(
		'optical-character-recognition', [binding, { ...binding,
			artifactSha256s: ['01'.repeat(32), '03'.repeat(32)] }]), /exactly identical|PP-OCR/iu);
	assert.equal(canonicalizeAssistanceWorkflowOperationModelBindingsV1(
		'image-text-embedding', [binding, { ...binding }]).length, 2);
});

function enhancementWorkflow() {
	return validateAssistanceWorkflow(assistanceWorkflowFixture({
		workflowId: 'enhance-dialogue', stageIds: ['enhance-dialogue'],
		models: [{ bindingVersion: 1, stageId: 'enhance-dialogue', slotId: 'enhancer',
			modelId: 'deepfilternet3', version: '3.0.0', artifactSha256s: ['01'.repeat(32)] }],
		inputs: [{ claimVersion: 1, direction: 'input', claimId: INPUT_ID,
			jobId: WORKFLOW_JOB_ID, stageId: 'enhance-dialogue', slotId: 'audio' }],
		outputs: [{ claimVersion: 1, direction: 'output', claimId: OUTPUT_ID,
			jobId: WORKFLOW_JOB_ID, stageId: 'enhance-dialogue', slotId: 'enhanced-audio' }],
	}));
}

function whisperWorkflow(language: 'auto' | 'en'): AssistanceWorkflowV1 {
	return validateAssistanceWorkflow(assistanceWorkflowFixture({
		settings: { settingsVersion: 1, workflowId: 'transcribe-captions',
			recognizer: 'whisper', language, englishWhisperAlignment: 'when-installed' },
		models: [
			{ bindingVersion: 1, stageId: 'detect-speech', slotId: 'vad', modelId: 'silero-vad',
				version: '6.2.0', artifactSha256s: ['01'.repeat(32)] },
			{ bindingVersion: 1, stageId: 'recognize-speech', slotId: 'speech-recognizer',
				modelId: 'whisper-large-v3-turbo-ggml', version: '1.0.0',
				artifactSha256s: ['02'.repeat(32)] },
		],
	}));
}

function highlightsWorkflow(): AssistanceWorkflowV1 {
	const stageIds = ['detect-highlight-shots', 'gather-signals', 'rank-highlights', 'rerank-editorial',
		'assemble-highlights'] as const;
	const models = [{ bindingVersion: 1 as const, stageId: 'rerank-editorial',
		slotId: 'editorial-generator', modelId: 'qwen3-4b-q4-k-m', version: 'bc640142',
		artifactSha256s: ['01'.repeat(32)] }];
	const inputs = [
		workflowClaim('input', 'detect-highlight-shots', 'video', 1),
		workflowClaim('input', 'gather-signals', 'video', 2),
		workflowClaim('input', 'rank-highlights', 'highlight-signals', 3),
		workflowClaim('input', 'rerank-editorial', 'highlight-candidates', 4),
		workflowClaim('input', 'assemble-highlights', 'highlight-candidates', 5),
	];
	const outputs = [
		workflowClaim('output', 'detect-highlight-shots', 'shot-boundaries', 6),
		workflowClaim('output', 'gather-signals', 'highlight-signals', 7),
		workflowClaim('output', 'rank-highlights', 'highlight-candidates', 8),
		workflowClaim('output', 'rerank-editorial', 'editorial-proposal', 9),
		workflowClaim('output', 'assemble-highlights', 'highlight-proposals', 10),
	];
	const single = assistanceWorkflowFixture({ workflowId: 'make-highlights', stageIds,
		models, inputs, outputs });
	const video = { ...single.fence.sourceRanges[0]!, slotId: 'primary-video',
		mediaKind: 'video' as const, sourceId: 'source-video', sourceSha256: '13'.repeat(32),
		sourceSampleRate: null, occurrenceIds: ['occurrence-video'], sourceEndFrame: 100,
		linkMembershipSha256: '35'.repeat(32), timingAuthoritySha256: '57'.repeat(32) };
	const audio = { ...single.fence.sourceRanges[0]!, sourceEndFrame: 96_000 };
	return validateAssistanceWorkflow({ ...single,
		fence: { ...single.fence, sourceRanges: [audio, video] } });
}

function workflowClaim(
	direction: 'input' | 'output', stageId: string, slotId: string, index: number,
) {
	return { claimVersion: 1 as const, direction,
		claimId: index.toString(16).padStart(40, '0'), jobId: WORKFLOW_JOB_ID, stageId, slotId };
}

function stageExecution(
	request: AssistanceWorkflowV1,
	progress: (completed: number, total: number) => void,
	stageId = request.stageIds[0]!,
): AssistanceWorkflowStageExecutionV1 {
	const stage = assistanceWorkflowStageGraph(request.workflowId)
		.find((candidate) => candidate.stageId === stageId)!;
	const stageIndex = request.stageIds.indexOf(stageId);
	const base = { request, stage, stageIndex, stageCount: request.stageIds.length,
		inputs: request.inputs.filter((claim) => claim.stageId === stageId),
		outputs: request.outputs.filter((claim) => claim.stageId === stageId),
		models: request.models.filter((claim) => claim.stageId === stageId),
		signal: new AbortController().signal };
	return Object.freeze({ ...base, custody: createAssistanceWorkflowStageCustodyToken(base), progress });
}
