/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAssistanceWorkflowService } from '../desktop/assistance-workflow-service.ts';
import { assistanceWorkflowFixture, WORKFLOW_JOB_ID } from './helpers/assistance-workflow-fixture.ts';

const OUTPUT_DATA_CLAIM = Object.freeze({ claimVersion: 1 as const,
	claimId: '04'.repeat(20), jobId: WORKFLOW_JOB_ID, role: 'voice-activity' as const,
	mediaType: 'application/json', byteLength: 2, sha256: 'ab'.repeat(32) });

test('workflow service job creation owns custody and admits only its exact staged aggregate', async () => {
	const events: string[] = [];
	const request = assistanceWorkflowFixture();
	const custody = {
		createJob: async () => {
			events.push('create');
			return { contractVersion: 1 as const, jobId: WORKFLOW_JOB_ID };
		},
		assertJob: (jobId: unknown) => {
			assert.equal(jobId, WORKFLOW_JOB_ID); events.push('assert');
		},
		reserveOutput: async (value: never) => { events.push('reserve'); return value; },
		bindProducer: (value: never) => { events.push('bind'); return value; },
		validateWorkflow: (value: unknown) => {
			assert.deepEqual(value, request); events.push('validate'); return request;
		},
		openAuthenticatedOutput: async (claim: unknown) => {
			events.push('open-output');
			return { custody: { workflowId: request.workflowId, direction: 'output',
				jobId: WORKFLOW_JOB_ID }, workflowClaim: claim, claim: OUTPUT_DATA_CLAIM,
				path: '/private/review.json' } as never;
		},
		releaseJob: async (jobId: unknown) => {
			assert.equal(jobId, WORKFLOW_JOB_ID); events.push('release'); return true;
		},
	};
	const service = createAssistanceWorkflowService({ custody,
		execute: async (_value, context) => {
			for (const [index, stage] of context.stages.entries()) {
				if (index > 0) context.progress(stage.stageId, 'queued');
				context.progress(stage.stageId, 'finalizing');
			}
			return { outcome: 'completed' };
		} });
	assert.deepEqual(await service.createJob(), { contractVersion: 1, jobId: WORKFLOW_JOB_ID });
	assert.deepEqual(service.admitWorkflow(request), request);
	await assert.rejects(service.openOutput({ jobId: WORKFLOW_JOB_ID,
		workflowId: request.workflowId, claim: request.outputs[0] }), /completed/iu);
	assert.equal((await service.run(request)).outcome, 'completed');
	assert.equal((await service.openOutput({ jobId: WORKFLOW_JOB_ID,
		workflowId: request.workflowId, claim: request.outputs[0] })).path, '/private/review.json');
	assert.throws(() => service.admitWorkflow(request), /completed/iu);
	assert.equal(await service.release(WORKFLOW_JOB_ID), true);
	assert.deepEqual(events, ['create', 'assert', 'validate', 'assert', 'assert',
		'validate', 'assert', 'open-output', 'assert', 'release']);
});

test('custody-backed cancellation quiesces execution before releasing the staging namespace', async () => {
	const events: string[] = [];
	const request = assistanceWorkflowFixture();
	const custody = {
		createJob: async () => ({ contractVersion: 1 as const, jobId: WORKFLOW_JOB_ID }),
		assertJob: () => undefined,
		reserveOutput: async (value: never) => value,
		bindProducer: (value: never) => value,
		validateWorkflow: () => request,
		openAuthenticatedOutput: async () => { throw new Error('not completed'); },
		releaseJob: async () => { events.push('release'); return true; },
	};
	const service = createAssistanceWorkflowService({ custody,
		execute: async (_value, context) => {
			try {
				await new Promise<void>((_resolve, reject) => context.signal.addEventListener(
					'abort', () => reject(context.signal.reason), { once: true },
				));
			} finally { events.push('quiesced'); }
			return { outcome: 'completed' };
		} });
	await service.createJob();
	const running = service.run(request);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal((await service.cancel(WORKFLOW_JOB_ID)).outcome, 'cancelled');
	await assert.rejects(running, /cancel/iu);
	assert.deepEqual(events, ['quiesced', 'release']);
});

test('unavailable aggregate execution never exposes partially authenticated outputs', async () => {
	const request = assistanceWorkflowFixture();
	let opened = false;
	const service = createAssistanceWorkflowService({ custody: {
		createJob: async () => ({ contractVersion: 1 as const, jobId: WORKFLOW_JOB_ID }),
		assertJob: () => undefined,
		reserveOutput: async (value: never) => value,
		bindProducer: (value: never) => value,
		validateWorkflow: () => request,
		openAuthenticatedOutput: async () => { opened = true; throw new Error('must not open'); },
		releaseJob: async () => true,
	}, execute: () => ({ outcome: 'unavailable', reason: 'stage-unavailable' }) });
	await service.createJob();
	assert.equal((await service.run(request)).outcome, 'unavailable');
	await assert.rejects(service.openOutput({ jobId: WORKFLOW_JOB_ID,
		workflowId: request.workflowId, claim: request.outputs[0] }), /completed/iu);
	assert.equal(opened, false);
	await service.release(WORKFLOW_JOB_ID);
});
