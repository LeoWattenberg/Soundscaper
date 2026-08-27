/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceWorkflowExecutor,
	createAssistanceWorkflowStageCustodyToken,
	type AssistanceWorkflowStageBindingV1,
	type AssistanceWorkflowStageExecutionV1,
} from '../desktop/assistance-workflow-executor.ts';
import {
	AssistanceWorkflowCancelledError,
	createAssistanceWorkflowService,
} from '../desktop/assistance-workflow-service.ts';
import { assistanceWorkflowFixture, WORKFLOW_JOB_ID } from './helpers/assistance-workflow-fixture.ts';

test('executor derives stages, correlates slots canonically, and dispatches primitive versus owned stages', async () => {
	const base = assistanceWorkflowFixture();
	const request = assistanceWorkflowFixture({
		inputs: Object.freeze([...base.inputs].reverse()),
		outputs: Object.freeze([...base.outputs].reverse()),
		models: Object.freeze([...base.models].reverse()),
	});
	const calls: Array<Readonly<Record<string, unknown>>> = [];
	const progress: Array<Readonly<{ stageId: string; phase: string; completed: number | null }>> = [];
	const execute = createAssistanceWorkflowExecutor({
		resolveCustody: async (stage) => {
			calls.push(Object.freeze({ kind: 'custody', stageId: stage.stage.stageId }));
			return Object.freeze({
				outcome: 'resolved' as const,
				custody: createAssistanceWorkflowStageCustodyToken(stage),
			});
		},
		runPrimitiveStage: async (stage) => {
			calls.push(stageCall('primitive', stage));
			stage.progress(1, 2);
			stage.progress(2, 2);
			return Object.freeze({ outcome: 'completed' as const });
		},
		deterministicHandlers: {
			'assemble-captions': async (stage) => {
				calls.push(stageCall('owned', stage));
				return Object.freeze({ outcome: 'completed' as const });
			},
		},
	});
	const service = createAssistanceWorkflowService({
		mintJobId: () => WORKFLOW_JOB_ID,
		onProgress: (value) => progress.push(value),
		execute,
	});
	await service.createJob();
	const outcome = await service.run(request);

	assert.equal(outcome.outcome, 'completed');
	assert.deepEqual(calls.map(({ kind, stageId }) => [kind, stageId]), [
		['custody', 'detect-speech'],
		['primitive', 'detect-speech'],
		['custody', 'recognize-speech'],
		['primitive', 'recognize-speech'],
		['custody', 'assemble-captions'],
		['owned', 'assemble-captions'],
	]);
	assert.deepEqual(calls.filter(({ kind }) => kind !== 'custody').map(({ inputs, outputs, models }) => (
		[inputs, outputs, models]
	)), [
		[['audio'], ['voice-activity'], ['vad']],
		[['audio', 'voice-activity'], ['transcript'], ['speech-recognizer']],
		[['transcript'], ['captions'], []],
	]);
	assert.deepEqual(progress.filter(({ phase }) => phase !== 'running').map(({ stageId, phase }) => (
		[stageId, phase]
	)), [
		['detect-speech', 'queued'],
		['detect-speech', 'staging-input'],
		['detect-speech', 'loading-model'],
		['detect-speech', 'staging-output'],
		['detect-speech', 'finalizing'],
		['recognize-speech', 'queued'],
		['recognize-speech', 'staging-input'],
		['recognize-speech', 'loading-model'],
		['recognize-speech', 'staging-output'],
		['recognize-speech', 'finalizing'],
		['assemble-captions', 'queued'],
		['assemble-captions', 'staging-input'],
		['assemble-captions', 'staging-output'],
		['assemble-captions', 'finalizing'],
	]);
	assert.deepEqual(progress.filter(({ phase }) => phase === 'running')
		.map(({ stageId, completed }) => [stageId, completed]), [
			['detect-speech', null], ['detect-speech', 1], ['detect-speech', 2],
			['recognize-speech', null], ['recognize-speech', 1], ['recognize-speech', 2],
			['assemble-captions', null],
		]);
});

test('executor forwards every repeated frame-pack claim in aggregate order', async () => {
	const stageId = 'run-saliency-detection';
	const request = assistanceWorkflowFixture({
		workflowId: 'advanced:saliency-detection',
		settings: { settingsVersion: 1, workflowId: 'advanced:saliency-detection',
			operationSettings: {} },
		stageIds: [stageId],
		models: [{ bindingVersion: 1, stageId, slotId: 'model', modelId: 'u2netp-saliency',
			version: '1.0.0', artifactSha256s: ['09'.repeat(32)] }],
		inputs: [
			workflowClaim('input', stageId, 'frame-pack', 9),
			workflowClaim('input', stageId, 'frame-pack', 7),
		],
		outputs: [workflowClaim('output', stageId, 'saliency-map', 8)],
	});
	const observed: string[][] = [];
	const execute = createAssistanceWorkflowExecutor({
		resolveCustody: (stage) => Object.freeze({ outcome: 'resolved' as const,
			custody: createAssistanceWorkflowStageCustodyToken(stage) }),
		runPrimitiveStage: (stage) => {
			observed.push(stage.inputs.map(({ claimId }) => claimId));
			return Object.freeze({ outcome: 'completed' as const });
		},
	});
	const result = await execute(request, { signal: new AbortController().signal,
		stages: Object.freeze([]), progress: () => undefined });
	assert.equal(result.outcome, 'completed');
	assert.deepEqual(observed, [[
		9..toString(16).padStart(40, '0'),
		7..toString(16).padStart(40, '0'),
	]]);
});

test('executor returns typed unavailable without primitive or deterministic substitution', async () => {
	const resolver = async (stage: AssistanceWorkflowStageBindingV1) => Object.freeze({
		outcome: 'resolved' as const,
		custody: createAssistanceWorkflowStageCustodyToken(stage),
	});
	const missingPrimitive = createAssistanceWorkflowService({
		mintJobId: () => WORKFLOW_JOB_ID,
		execute: createAssistanceWorkflowExecutor({
			resolveCustody: resolver,
			deterministicHandlers: {
				'assemble-captions': async () => Object.freeze({ outcome: 'completed' as const }),
			},
		}),
	});
	await missingPrimitive.createJob();
	assert.deepEqual(await missingPrimitive.run(assistanceWorkflowFixture()), unavailable('stage-unavailable'));

	const primitiveCalls: string[] = [];
	const missingOwned = createAssistanceWorkflowService({
		mintJobId: () => WORKFLOW_JOB_ID,
		execute: createAssistanceWorkflowExecutor({
			resolveCustody: resolver,
			runPrimitiveStage: async (stage) => {
				primitiveCalls.push(stage.stage.stageId);
				return Object.freeze({ outcome: 'completed' as const });
			},
		}),
	});
	await missingOwned.createJob();
	assert.deepEqual(await missingOwned.run(assistanceWorkflowFixture()), unavailable('stage-unavailable'));
	assert.deepEqual(primitiveCalls, ['detect-speech', 'recognize-speech']);

	const missingCustody = createAssistanceWorkflowService({
		mintJobId: () => WORKFLOW_JOB_ID,
		execute: createAssistanceWorkflowExecutor({
			runPrimitiveStage: async () => Object.freeze({ outcome: 'completed' as const }),
		}),
	});
	await missingCustody.createJob();
	assert.deepEqual(await missingCustody.run(assistanceWorkflowFixture()), unavailable('stage-unavailable'));
});

test('model-unavailable stops the selected graph and cannot fall through to owned handlers', async () => {
	let ownedCalls = 0;
	const service = createAssistanceWorkflowService({
		mintJobId: () => WORKFLOW_JOB_ID,
		execute: createAssistanceWorkflowExecutor({
			resolveCustody: async (stage) => Object.freeze({
				outcome: 'resolved' as const,
				custody: createAssistanceWorkflowStageCustodyToken(stage),
			}),
			runPrimitiveStage: async () => Object.freeze({
				outcome: 'unavailable' as const, reason: 'model-unavailable' as const,
			}),
			deterministicHandlers: {
				'assemble-captions': async () => {
					ownedCalls += 1;
					return Object.freeze({ outcome: 'completed' as const });
				},
			},
		}),
	});
	await service.createJob();
	assert.deepEqual(await service.run(assistanceWorkflowFixture()), unavailable('model-unavailable'));
	assert.equal(ownedCalls, 0);
});

test('executor rejects malformed custody and ignores caller-supplied graph projections', async () => {
	assert.throws(() => createAssistanceWorkflowExecutor({
		deterministicHandlers: { 'execute-shell': async () => ({ outcome: 'completed' }) } as never,
	}), /handler|stage/iu);
	const request = assistanceWorkflowFixture();
	const observed: string[] = [];
	const executor = createAssistanceWorkflowExecutor({
		resolveCustody: async (stage) => Object.freeze({
			outcome: 'resolved' as const,
			custody: stage.stage.stageId === 'detect-speech'
				? Object.freeze({
					custodyVersion: 1, jobId: stage.request.jobId, stageId: stage.stage.stageId,
					inputClaimIds: Object.freeze(['f'.repeat(40)]),
					outputClaimIds: Object.freeze(stage.outputs.map(({ claimId }) => claimId)),
				})
				: createAssistanceWorkflowStageCustodyToken(stage),
		}),
		runPrimitiveStage: async (stage) => {
			observed.push(`${stage.stage.stageId}:${String(stage.stage.operation)}`);
			return Object.freeze({ outcome: 'completed' as const });
		},
		deterministicHandlers: {
			'assemble-captions': async () => Object.freeze({ outcome: 'completed' as const }),
		},
	});
	await assert.rejects(executor(request, {
		signal: new AbortController().signal,
		stages: Object.freeze([{ stageId: 'execute-shell', operation: null }]) as never,
		progress: () => undefined,
	}), /custody.*input|input.*custody/iu);
	assert.deepEqual(observed, [], 'malformed custody must fail before any stage delegation');
});

test('executor forwards cancellation to the active custody and stage ports', async () => {
	const stageSignals: AbortSignal[] = [];
	const service = createAssistanceWorkflowService({
		mintJobId: () => WORKFLOW_JOB_ID,
		execute: createAssistanceWorkflowExecutor({
			resolveCustody: async (stage) => Object.freeze({
				outcome: 'resolved' as const,
				custody: createAssistanceWorkflowStageCustodyToken(stage),
			}),
			runPrimitiveStage: async (stage) => {
				stageSignals.push(stage.signal);
				await new Promise<void>((_resolve, reject) => stage.signal.addEventListener(
					'abort', () => reject(stage.signal.reason), { once: true },
				));
				return Object.freeze({ outcome: 'completed' as const });
			},
		}),
	});
	await service.createJob();
	const running = service.run(assistanceWorkflowFixture());
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(await service.cancel(WORKFLOW_JOB_ID), {
		contractVersion: 1, jobId: WORKFLOW_JOB_ID, outcome: 'cancelled',
	});
	assert.equal(stageSignals[0]?.aborted, true);
	await assert.rejects(running, AssistanceWorkflowCancelledError);
});

test('executor bounds determinate stage progress before forwarding it', async () => {
	const request = assistanceWorkflowFixture();
	const execute = createAssistanceWorkflowExecutor({
		resolveCustody: async (stage) => Object.freeze({
			outcome: 'resolved' as const,
			custody: createAssistanceWorkflowStageCustodyToken(stage),
		}),
		runPrimitiveStage: async (stage) => {
			stage.progress(Number.NaN, 1);
			return Object.freeze({ outcome: 'completed' as const });
		},
	});
	await assert.rejects(execute(request, {
		signal: new AbortController().signal,
		stages: Object.freeze([]),
		progress: () => undefined,
	}), /progress.*finite|finite.*progress/iu);
});

function stageCall(kind: string, stage: AssistanceWorkflowStageExecutionV1) {
	assert.equal(Object.isFrozen(stage), true);
	assert.equal(Object.isFrozen(stage.inputs), true);
	assert.equal(Object.isFrozen(stage.outputs), true);
	assert.equal(Object.isFrozen(stage.models), true);
	return Object.freeze({
		kind,
		stageId: stage.stage.stageId,
		inputs: Object.freeze(stage.inputs.map(({ slotId }) => slotId)),
		outputs: Object.freeze(stage.outputs.map(({ slotId }) => slotId)),
		models: Object.freeze(stage.models.map(({ slotId }) => slotId)),
	});
}

function workflowClaim(
	direction: 'input' | 'output', stageId: string, slotId: string, ordinal: number,
) {
	return Object.freeze({ claimVersion: 1 as const, direction,
		claimId: ordinal.toString(16).padStart(40, '0'), jobId: WORKFLOW_JOB_ID, stageId, slotId });
}

function unavailable(reason: 'stage-unavailable' | 'model-unavailable') {
	return {
		contractVersion: 1,
		jobId: WORKFLOW_JOB_ID,
		workflowId: 'transcribe-captions',
		outcome: 'unavailable',
		reason,
	};
}
