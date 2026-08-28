/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceWorkflowPrimitiveStageRunner,
	type AssistanceWorkflowPrimitiveStageCustody,
} from '../desktop/assistance-workflow-primitive-stage.ts';
import type { AssistanceOutputClaim } from '../desktop/assistance-data-claims.ts';
import type { AssistanceOperationRequest } from '../desktop/assistance-operation-contract.ts';
import type { AssistanceOperationOutcome } from '../desktop/assistance-operation-service.ts';
import {
	assistanceWorkflowStageGraph,
} from '../src/common/editor/assistance/workflow.ts';
import {
	createAssistanceWorkflowStageCustodyToken,
	type AssistanceWorkflowStageExecutionV1,
} from '../desktop/assistance-workflow-executor.ts';
import { assistanceWorkflowFixture } from './helpers/assistance-workflow-fixture.ts';

test('primitive stage runner projects aggregate authority into operation-v1 without paths', async () => {
	const stage = primitiveStage();
	const input = Object.freeze({ claimVersion: 1 as const, claimId: 'a'.repeat(40),
		jobId: stage.request.jobId, role: 'audio' as const, mediaType: 'audio/wav',
		byteLength: 8, sha256: '1'.repeat(64) });
	const output = Object.freeze({ claimVersion: 1 as const, claimId: 'b'.repeat(40),
		jobId: stage.request.jobId, role: 'voice-activity' as const,
		mediaType: 'application/json', maximumByteLength: 8_192 });
	const calls: unknown[] = [];
	const progress: Array<readonly [number, number]> = [];
	const runner = createAssistanceWorkflowPrimitiveStageRunner({
		custody: Object.freeze({
			preparePrimitiveStage: async (value: AssistanceWorkflowStageExecutionV1) => {
				calls.push(Object.freeze({ kind: 'prepare', value }));
				return Object.freeze({ inputs: Object.freeze([input]), outputs: Object.freeze([output]) });
			},
			bindPrimitiveOutputs: async (
				value: AssistanceWorkflowStageExecutionV1,
				values: readonly AssistanceOutputClaim[],
			) => {
				calls.push(Object.freeze({ kind: 'bind', value, values }));
			},
		}),
		operations: Object.freeze({
			executeStaged: async (
				request: AssistanceOperationRequest,
				signal: AbortSignal,
			): Promise<AssistanceOperationOutcome> => {
				calls.push(Object.freeze({ kind: 'execute', request, signal }));
				return Object.freeze({ contractVersion: 1 as const, jobId: request.jobId,
					operation: request.operation, outcome: 'completed' as const,
					result: Object.freeze({ contractVersion: 1 as const, jobId: request.jobId,
						operation: request.operation, outputs: Object.freeze([{ claimVersion: 1 as const,
							claimId: output.claimId, jobId: request.jobId, role: output.role,
							mediaType: output.mediaType, byteLength: 12, sha256: '2'.repeat(64) }]) }),
				});
			},
		}),
	});
	const result = await runner(Object.freeze({ ...stage,
		progress: (completed: number, total: number) => progress.push([completed, total]) }));

	assert.deepEqual(result, { outcome: 'completed' });
	const execution = calls.find((value) => (value as { kind?: string }).kind === 'execute') as
		Readonly<{ request: Readonly<Record<string, unknown>>; signal: AbortSignal }>;
	assert.equal(execution.signal, stage.signal);
	assert.deepEqual(execution.request, {
		contractVersion: 1, jobId: stage.request.jobId, operation: 'voice-activity-detection',
		selectionFence: {
			projectId: 'project-a', schemaFamily: 'framescaper', schemaVersion: 1,
			revision: 8, sequenceId: 'sequence-a',
			occurrenceIds: ['occurrence-a'], sourceId: 'source-a', sourceSha256: '12'.repeat(32),
			sourceStartFrame: 0, sourceEndFrame: 96_000,
			linkMembershipSha256: '34'.repeat(32), timingAuthoritySha256: '56'.repeat(32),
		},
		models: [{ modelId: 'silero-vad', version: '6.2.0', artifactSha256s: ['01'.repeat(32)] }],
		inputs: [input], outputs: [output],
	});
	assert.doesNotMatch(JSON.stringify(execution.request), /(?:\/models|staging|"path")/u);
	const binding = calls.find((value) => (value as { kind?: string }).kind === 'bind') as
		Readonly<{ values: readonly unknown[] }>;
	assert.equal((binding.values[0] as { claimId: string }).claimId, output.claimId);
	assert.deepEqual(progress, [[0, 1], [1, 1]]);
});

test('primitive stage runner preserves model-unavailable and never substitutes runtime failures', async () => {
	for (const [reason, expected] of [
		['model-unavailable', 'model-unavailable'],
		['adapter-unavailable', 'stage-unavailable'],
		['runtime-unavailable', 'stage-unavailable'],
	] as const) {
		let bindings = 0;
		const runner = createAssistanceWorkflowPrimitiveStageRunner({
			custody: Object.freeze({
				preparePrimitiveStage: async () => primitiveClaims(),
				bindPrimitiveOutputs: async () => { bindings += 1; },
			}) satisfies AssistanceWorkflowPrimitiveStageCustody,
			operations: Object.freeze({ executeStaged: async (
				request: AssistanceOperationRequest,
			): Promise<AssistanceOperationOutcome> => Object.freeze({
				contractVersion: 1 as const, jobId: request.jobId, operation: request.operation,
				outcome: 'unavailable' as const, reason,
			}) }),
		});
		assert.deepEqual(await runner(primitiveStage()), { outcome: 'unavailable', reason: expected });
		assert.equal(bindings, 0);
	}
});

function primitiveStage(): AssistanceWorkflowStageExecutionV1 {
	const request = assistanceWorkflowFixture();
	const stage = assistanceWorkflowStageGraph(request.workflowId)[0]!;
	const binding = Object.freeze({ request, stage, stageIndex: 0, stageCount: request.stageIds.length,
		inputs: Object.freeze(request.inputs.filter(({ stageId }) => stageId === stage.stageId)),
		outputs: Object.freeze(request.outputs.filter(({ stageId }) => stageId === stage.stageId)),
		models: Object.freeze(request.models.filter(({ stageId }) => stageId === stage.stageId)),
		signal: new AbortController().signal });
	return Object.freeze({ ...binding, custody: createAssistanceWorkflowStageCustodyToken(binding),
		progress: () => undefined });
}

function primitiveClaims() {
	const jobId = assistanceWorkflowFixture().jobId;
	return Object.freeze({
		inputs: Object.freeze([{ claimVersion: 1 as const, claimId: 'a'.repeat(40), jobId,
			role: 'audio' as const, mediaType: 'audio/wav', byteLength: 8, sha256: '1'.repeat(64) }]),
		outputs: Object.freeze([{ claimVersion: 1 as const, claimId: 'b'.repeat(40), jobId,
			role: 'voice-activity' as const, mediaType: 'application/json', maximumByteLength: 8_192 }]),
	});
}
