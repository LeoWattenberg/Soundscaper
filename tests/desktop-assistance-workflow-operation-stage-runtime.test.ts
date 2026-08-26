/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAssistanceOutputClaim,
	validateAssistanceOutputReservation,
	validateAssistanceStagedInputClaim } from '../desktop/assistance-data-claims.ts';
import { validateAssistanceOperationRequest } from '../desktop/assistance-operation-contract.ts';
import {
	createAssistanceWorkflowOperationStageRuntime,
} from '../desktop/assistance-workflow-operation-stage-runtime.ts';
import {
	createAssistanceWorkflowStageCustodyToken,
	type AssistanceWorkflowStageExecutionV1,
} from '../desktop/assistance-workflow-executor.ts';
import {
	assistanceWorkflowStageGraph,
	validateAssistanceWorkflow,
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

test('primitive projection refuses ambiguous multi-source authority without touching custody', async () => {
	const request = enhancementWorkflow();
	const second = { ...request.fence.sourceRanges[0]!, slotId: 'secondary-video',
		mediaKind: 'video' as const, sourceId: 'source-b', sourceSha256: '13'.repeat(32),
		occurrenceIds: ['occurrence-b'] };
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

function stageExecution(
	request: ReturnType<typeof enhancementWorkflow>,
	progress: (completed: number, total: number) => void,
): AssistanceWorkflowStageExecutionV1 {
	const stage = assistanceWorkflowStageGraph(request.workflowId)[0]!;
	const base = { request, stage, stageIndex: 0, stageCount: 1,
		inputs: request.inputs, outputs: request.outputs, models: request.models,
		signal: new AbortController().signal };
	return Object.freeze({ ...base, custody: createAssistanceWorkflowStageCustodyToken(base), progress });
}
