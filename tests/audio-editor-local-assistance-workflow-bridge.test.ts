/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLocalAssistanceBridge } from '../src/common/editor/ui/local-assistance-bridge.ts';
import { assistanceWorkflowFixture, WORKFLOW_JOB_ID } from './helpers/assistance-workflow-fixture.ts';
import { rawBridgeFixture } from './helpers/local-assistance-fixtures.ts';

test('the renderer bridge optionally projects the shared workflow-v1 boundary', async () => {
	const progressState: { listener: ((value: unknown) => void) | null } = { listener: null };
	const request = assistanceWorkflowFixture();
	const workflow = {
		createJob: async () => ({ contractVersion: 1, jobId: WORKFLOW_JOB_ID }),
		run: async () => {
			progressState.listener?.({ contractVersion: 1, jobId: WORKFLOW_JOB_ID,
				workflowId: request.workflowId, sequence: 0, stageId: 'detect-speech',
				stageIndex: 0, stageCount: 3, phase: 'running', completed: 1, total: 2 });
			return { contractVersion: 1, jobId: WORKFLOW_JOB_ID,
				workflowId: request.workflowId, outcome: 'completed', result: {
				contractVersion: 1, jobId: WORKFLOW_JOB_ID, workflowId: request.workflowId,
				stageIds: request.stageIds, outputs: request.outputs,
			} };
		},
		cancel: async () => ({ contractVersion: 1, jobId: WORKFLOW_JOB_ID, outcome: 'cancelled' }),
		onProgress: (listener: (value: unknown) => void) => {
			progressState.listener = listener;
			return () => { progressState.listener = null; };
		},
	};
	const bridge = resolveLocalAssistanceBridge({
		localAssistance: { ...rawBridgeFixture().api, workflow },
	});
	assert.ok(bridge?.workflow);
	assert.deepEqual(await bridge.workflow.createJob(), { contractVersion: 1, jobId: WORKFLOW_JOB_ID });
	const seen: unknown[] = [];
	bridge.workflow.onProgress((value) => seen.push(value));
	const running = bridge.workflow.run(request);
	assert.equal((await running).outcome, 'completed');
	assert.equal(seen.length, 1);
	assert.deepEqual(await bridge.workflow.cancel(WORKFLOW_JOB_ID), {
		contractVersion: 1, jobId: WORKFLOW_JOB_ID, outcome: 'cancelled',
	});
});

test('legacy operation-only bridges remain valid while malformed workflow surfaces are refused', () => {
	const legacy = rawBridgeFixture().api;
	assert.ok(resolveLocalAssistanceBridge({ localAssistance: legacy }));
	assert.equal(resolveLocalAssistanceBridge({ localAssistance: {
		...legacy,
		workflow: { createJob() {}, run() {}, cancel() {}, onProgress: '/private/path' },
	} }), null);
	assert.equal(resolveLocalAssistanceBridge({ localAssistance: {
		...legacy,
		workflow: { createJob() {}, run() {}, cancel() {}, onProgress() {}, executeShell() {} },
	} }), null);
});
