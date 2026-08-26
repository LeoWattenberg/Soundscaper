/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_WORKFLOW_IPC_CHANNELS,
	registerAssistanceWorkflowIpc,
} from '../desktop/assistance-workflow-main-ipc.ts';
import { createAssistanceWorkflowService } from '../desktop/assistance-workflow-service.ts';
import type { AssistanceWorkflowTransfers } from '../desktop/assistance-workflow-transfers.ts';
import type { AssistanceWorkflowCustodyHandleV1 } from '../desktop/assistance-workflow-custody.ts';
import { assistanceWorkflowFixture, WORKFLOW_JOB_ID } from './helpers/assistance-workflow-fixture.ts';

const STREAM_ID = '22'.repeat(20);

test('workflow custody IPC stages pathlessly and delegates only exact slotted requests', async () => {
	const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
	const listeners = new Map<string, (event: unknown, value?: unknown) => void>();
	const events: string[] = [];
	const input = handle('input', 'enhance-dialogue', 'audio', '33'.repeat(20));
	const output = handle('output', 'enhance-dialogue', 'enhanced-audio', '44'.repeat(20));
	const fakeTransfers = {
		prepareInput: (request: unknown) => {
			events.push(`prepare:${JSON.stringify(request)}`);
			return { contractVersion: 1, jobId: WORKFLOW_JOB_ID, streamId: STREAM_ID,
				reservation: { dataPlaneVersion: 1, transport: 'message-port', streamId: STREAM_ID,
					direction: 'host-to-helper', authentication: 'trailer-sha256-v1', byteLength: 4,
					maximumChunkBytes: 4, maximumInFlightChunks: 1 } };
		},
		awaitInput: async () => { events.push('await'); return input; },
		acceptInputPort: async () => { events.push('port'); },
		cancelJob: async () => { events.push('cancel-transfer'); },
		dispose: async () => undefined,
	} as unknown as AssistanceWorkflowTransfers;
	const custody = {
		createJob: async () => ({ contractVersion: 1 as const, jobId: WORKFLOW_JOB_ID }),
		assertJob: () => undefined,
		reserveOutput: async () => { events.push('reserve'); return output; },
		bindProducer: () => { events.push('bind'); return input; },
		validateWorkflow: () => assistanceWorkflowFixture(),
		releaseJob: async () => { events.push('release'); return true; },
	};
	const registration = registerAssistanceWorkflowIpc({
		channels: ASSISTANCE_WORKFLOW_IPC_CHANNELS,
		handle: (channel, handler) => handlers.set(channel, handler),
		on: (channel, listener) => listeners.set(channel, listener),
		sendToRenderer: () => undefined,
		createWorkflows: () => createAssistanceWorkflowService({ custody }),
		createTransfers: () => fakeTransfers,
		confirmWorkflow: async () => true,
	});
	assert.deepEqual(await handlers.get(ASSISTANCE_WORKFLOW_IPC_CHANNELS.create)?.({}), {
		contractVersion: 1, jobId: WORKFLOW_JOB_ID,
	});
	const prepared = handlers.get(ASSISTANCE_WORKFLOW_IPC_CHANNELS.stage)?.({}, {
		operation: 'prepare', jobId: WORKFLOW_JOB_ID, workflowId: 'enhance-dialogue',
		stageId: 'enhance-dialogue', slotId: 'audio', mediaType: 'audio/wav',
		byteLength: 4, sha256: 'aa'.repeat(32),
	});
	assert.equal((await prepared as { streamId?: unknown }).streamId, STREAM_ID);
	assert.deepEqual(await handlers.get(ASSISTANCE_WORKFLOW_IPC_CHANNELS.stage)?.({}, {
		operation: 'await', jobId: WORKFLOW_JOB_ID, streamId: STREAM_ID,
	}), input);
	assert.deepEqual(await handlers.get(ASSISTANCE_WORKFLOW_IPC_CHANNELS.reserve)?.({}, {
		jobId: WORKFLOW_JOB_ID, workflowId: 'enhance-dialogue', stageId: 'enhance-dialogue',
		slotId: 'enhanced-audio', maximumByteLength: 4096,
	}), output);
	assert.deepEqual(await handlers.get(ASSISTANCE_WORKFLOW_IPC_CHANNELS.bindProducer)?.({}, {
		jobId: WORKFLOW_JOB_ID, workflowId: 'enhance-dialogue', stageId: 'enhance-dialogue',
		slotId: 'audio', producerStageId: 'enhance-dialogue',
		producerSlotId: 'enhanced-audio', producerClaimId: output.custody.claimId,
	}), input);
	assert.equal(await handlers.get(ASSISTANCE_WORKFLOW_IPC_CHANNELS.release)?.({}, WORKFLOW_JOB_ID), true);
	assert.deepEqual(events.slice(-2), ['cancel-transfer', 'release']);
	assert.doesNotMatch(JSON.stringify({ input, output }), /path|private/iu);
	await registration.dispose();
});

test('workflow custody IPC rejects renderer paths before transfer or reservation', async () => {
	const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
	let called = false;
	const registration = registerAssistanceWorkflowIpc({
		channels: ASSISTANCE_WORKFLOW_IPC_CHANNELS,
		handle: (channel, handler) => handlers.set(channel, handler), on: () => undefined,
		sendToRenderer: () => undefined,
		createWorkflows: () => createAssistanceWorkflowService(),
		createTransfers: () => ({ prepareInput: () => { called = true; } } as never),
		confirmWorkflow: async () => true,
	});
	await assert.rejects(Promise.resolve(handlers.get(ASSISTANCE_WORKFLOW_IPC_CHANNELS.stage)?.({}, {
		operation: 'prepare', jobId: WORKFLOW_JOB_ID, workflowId: 'enhance-dialogue',
		stageId: 'enhance-dialogue', slotId: 'audio', mediaType: 'audio/wav', byteLength: 4,
		sha256: 'aa'.repeat(32), path: '/renderer/file.wav',
	})), /could not be staged/iu);
	assert.equal(called, false);
	await registration.dispose();
});

function handle(
	direction: 'input' | 'output', stageId: string, slotId: string, claimId: string,
): AssistanceWorkflowCustodyHandleV1 {
	const maximumByteLength = direction === 'output' ? 4096 : null;
	const custody = Object.freeze({ custodyVersion: 1 as const, workflowId: 'enhance-dialogue' as const,
		direction, jobId: WORKFLOW_JOB_ID, stageId, slotId, claimId,
		role: direction === 'output' ? 'enhanced-audio' as const : 'audio' as const,
		mediaType: 'audio/wav', byteLength: direction === 'input' ? 4 : null,
		sha256: direction === 'input' ? 'aa'.repeat(32) : null, maximumByteLength, producer: null });
	return Object.freeze({ custody, workflowClaim: Object.freeze({ claimVersion: 1,
		direction, claimId, jobId: WORKFLOW_JOB_ID, stageId, slotId }) });
}
