/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_WORKFLOW_IPC_CHANNELS,
	registerAssistanceWorkflowIpc,
} from '../desktop/assistance-workflow-main-ipc.ts';
import { createAssistanceWorkflowService } from '../desktop/assistance-workflow-service.ts';
import { assistanceWorkflowFixture, WORKFLOW_JOB_ID } from './helpers/assistance-workflow-fixture.ts';

function harness(confirmWorkflow: (request: unknown, stages: readonly unknown[]) => Promise<boolean>) {
	const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
	const sent: Array<Readonly<{ channel: string; value: unknown }>> = [];
	let built = 0;
	let runs = 0;
	let prompts = 0;
	const registration = registerAssistanceWorkflowIpc({
		channels: ASSISTANCE_WORKFLOW_IPC_CHANNELS,
		handle: (channel, handler) => handlers.set(channel, handler),
		sendToRenderer: (channel, value) => sent.push({ channel, value }),
		createWorkflows: (onProgress) => {
			built += 1;
			return createAssistanceWorkflowService({
				mintJobId: () => WORKFLOW_JOB_ID,
				onProgress,
				execute: async (_request, context) => {
					runs += 1;
					context.progress('detect-speech', 'finalizing');
					context.progress('recognize-speech', 'queued');
					context.progress('recognize-speech', 'finalizing');
					context.progress('assemble-captions', 'queued');
					context.progress('assemble-captions', 'finalizing');
					return { outcome: 'completed' };
				},
			});
		},
		confirmWorkflow: (request, stages) => {
			prompts += 1;
			return confirmWorkflow(request, stages);
		},
	});
	return { handlers, sent, registration, built: () => built, runs: () => runs,
		prompts: () => prompts };
}

test('workflow IPC is lazy and one prompt receives the exact request plus a main-derived graph', async () => {
	let confirmed: unknown = null;
	let graph: readonly unknown[] = [];
	const fixture = harness(async (request, stages) => {
		confirmed = request;
		graph = stages;
		return true;
	});
	assert.deepEqual([...fixture.handlers.keys()].sort(), [
		ASSISTANCE_WORKFLOW_IPC_CHANNELS.create,
		ASSISTANCE_WORKFLOW_IPC_CHANNELS.run,
		ASSISTANCE_WORKFLOW_IPC_CHANNELS.cancel,
	].sort());
	assert.equal(fixture.built(), 0);
	assert.deepEqual(await fixture.handlers.get(ASSISTANCE_WORKFLOW_IPC_CHANNELS.create)?.(null), {
		contractVersion: 1, jobId: WORKFLOW_JOB_ID,
	});
	const request = assistanceWorkflowFixture();
	const outcome = await fixture.handlers.get(ASSISTANCE_WORKFLOW_IPC_CHANNELS.run)?.({}, request);
	assert.equal((outcome as { outcome?: unknown }).outcome, 'completed');
	assert.deepEqual(confirmed, request);
	assert.deepEqual(graph.map((value) => (value as { operation?: unknown }).operation), [
		'voice-activity-detection', 'speech-recognition', null,
	]);
	assert.equal(fixture.runs(), 1);
	assert.ok(fixture.sent.length >= 1);
});

test('declined consent and injected operations never enter workflow execution', async () => {
	const fixture = harness(async () => false);
	await fixture.handlers.get(ASSISTANCE_WORKFLOW_IPC_CHANNELS.create)?.(null);
	assert.deepEqual(await fixture.handlers.get(ASSISTANCE_WORKFLOW_IPC_CHANNELS.run)?.(
		{}, assistanceWorkflowFixture(),
	), {
		contractVersion: 1,
		jobId: WORKFLOW_JOB_ID,
		workflowId: 'transcribe-captions',
		outcome: 'consent-declined',
	});
	assert.equal(fixture.runs(), 0);
	assert.equal(fixture.prompts(), 1);
	await assert.rejects(Promise.resolve(fixture.handlers.get(ASSISTANCE_WORKFLOW_IPC_CHANNELS.run)?.(
		{}, assistanceWorkflowFixture(),
	)), /workflow could not be completed/iu);
	assert.equal(fixture.prompts(), 1, 'a declined job is surrendered before another prompt');
	await assert.rejects(Promise.resolve(fixture.handlers.get(ASSISTANCE_WORKFLOW_IPC_CHANNELS.run)?.(
		{}, { ...assistanceWorkflowFixture(), operations: ['execute-shell'] },
	)), /workflow could not be completed/iu);
	assert.equal(fixture.runs(), 0);
});

test('an unknown workflow job is rejected before native consent is requested', async () => {
	const fixture = harness(async () => true);
	await assert.rejects(Promise.resolve(fixture.handlers.get(ASSISTANCE_WORKFLOW_IPC_CHANNELS.run)?.(
		{}, assistanceWorkflowFixture(),
	)), /workflow could not be completed/iu);
	assert.equal(fixture.prompts(), 0);
});
