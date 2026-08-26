/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AssistanceWorkflowCancelledError,
	createAssistanceWorkflowService,
} from '../desktop/assistance-workflow-service.ts';
import { assistanceWorkflowFixture, WORKFLOW_JOB_ID } from './helpers/assistance-workflow-fixture.ts';

test('the workflow service derives the selected graph and emits main-owned stage progress', async () => {
	const progress: unknown[] = [];
	let operations: unknown[] = [];
	const service = createAssistanceWorkflowService({
		mintJobId: () => WORKFLOW_JOB_ID,
		onProgress: (value) => progress.push(value),
		execute: async (_request, context) => {
			operations = context.stages.map(({ operation }) => operation);
			context.progress('detect-speech', 'finalizing');
			context.progress('recognize-speech', 'queued');
			context.progress('recognize-speech', 'finalizing');
			context.progress('assemble-captions', 'queued');
			context.progress('assemble-captions', 'finalizing');
			return { outcome: 'completed' };
		},
	});
	assert.throws(() => service.assertJob(WORKFLOW_JOB_ID), /unknown/iu);
	assert.deepEqual(await service.createJob(), { contractVersion: 1, jobId: WORKFLOW_JOB_ID });
	assert.doesNotThrow(() => service.assertJob(WORKFLOW_JOB_ID));
	const request = assistanceWorkflowFixture();
	const outcome = await service.run(request);
	assert.deepEqual(operations, ['voice-activity-detection', 'speech-recognition', null]);
	assert.equal(outcome.outcome, 'completed');
	assert.deepEqual(outcome.outcome === 'completed' ? outcome.result.outputs : [], request.outputs);
	assert.deepEqual(progress.map((value) => {
		const item = value as { sequence?: unknown; stageId?: unknown; phase?: unknown };
		return [item.sequence, item.stageId, item.phase];
	}), [
		[0, 'detect-speech', 'queued'],
		[1, 'detect-speech', 'finalizing'],
		[2, 'recognize-speech', 'queued'],
		[3, 'recognize-speech', 'finalizing'],
		[4, 'assemble-captions', 'queued'],
		[5, 'assemble-captions', 'finalizing'],
	]);
	assert.deepEqual(await service.cancel(WORKFLOW_JOB_ID), {
		contractVersion: 1, jobId: WORKFLOW_JOB_ID, outcome: 'not-active',
	});
});

test('the default runner is honestly unavailable and renderer operations cannot replace the graph', async () => {
	const service = createAssistanceWorkflowService({ mintJobId: () => WORKFLOW_JOB_ID });
	await service.createJob();
	assert.deepEqual(await service.run(assistanceWorkflowFixture()), {
		contractVersion: 1,
		jobId: WORKFLOW_JOB_ID,
		workflowId: 'transcribe-captions',
		outcome: 'unavailable',
		reason: 'workflow-runner-unavailable',
	});
	const second = createAssistanceWorkflowService({ mintJobId: () => WORKFLOW_JOB_ID });
	await second.createJob();
	await assert.rejects(second.run({ ...assistanceWorkflowFixture(),
		operations: ['execute-shell'] }), /schema keys/iu);
});

test('cancellation aborts and quiesces one active workflow before surrendering its job', async () => {
	const observed: { signal: AbortSignal | null } = { signal: null };
	const service = createAssistanceWorkflowService({
		mintJobId: () => WORKFLOW_JOB_ID,
		execute: async (_request, context) => {
			observed.signal = context.signal;
			await new Promise<void>((_resolve, reject) => context.signal.addEventListener('abort',
				() => reject(context.signal.reason), { once: true }));
			return { outcome: 'completed' };
		},
	});
	await service.createJob();
	const running = service.run(assistanceWorkflowFixture());
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(await service.cancel(WORKFLOW_JOB_ID), {
		contractVersion: 1, jobId: WORKFLOW_JOB_ID, outcome: 'cancelled',
	});
	assert.equal(observed.signal?.aborted, true);
	await assert.rejects(running, AssistanceWorkflowCancelledError);
});
