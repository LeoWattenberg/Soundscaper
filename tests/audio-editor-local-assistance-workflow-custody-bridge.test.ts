/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import test from 'node:test';

import {
	createAssistanceWorkflowCustodyClaimV1,
	workflowClaimFromCustodyV1,
	type AssistanceWorkflowCustodyClaimV1,
} from '../src/common/editor/assistance/workflow-custody-v1.ts';
import {
	resolveLocalAssistanceWorkflowBridge,
} from '../src/common/editor/ui/local-assistance-workflow-bridge.ts';
import { bindLocalAssistancePreparedAudioWaveRelease } from
	'../src/common/editor/controller/local-assistance-audio-spool-release.ts';
import { WORKFLOW_JOB_ID } from './helpers/assistance-workflow-fixture.ts';

test('renderer workflow custody hashes Blobs and correlates main-minted slot handles', async () => {
	const calls: unknown[] = [];
	let ordinal = 10;
	const raw = workflowRaw({
		stageInput: async (request: Record<string, unknown>) => {
			calls.push(request);
			const custody = token({ workflowId: 'enhance-dialogue', direction: 'input',
				stageId: 'enhance-dialogue', slotId: 'audio', claimId: claimId(++ordinal),
				role: 'audio', mediaType: 'audio/wav', byteLength: request.byteLength as number,
				sha256: request.sha256 as string, maximumByteLength: null });
			return { custody, workflowClaim: workflowClaimFromCustodyV1(custody) };
		},
		reserveOutput: async (request: Record<string, unknown>) => {
			calls.push(request);
			const custody = token({ workflowId: 'enhance-dialogue', direction: 'output',
				stageId: 'enhance-dialogue', slotId: 'enhanced-audio', claimId: claimId(++ordinal),
				byteLength: null, sha256: null,
				maximumByteLength: request.maximumByteLength as number });
			return { custody, workflowClaim: workflowClaimFromCustodyV1(custody) };
		},
		bindProducer: async () => { throw new Error('unused'); },
		release: async () => true,
	});
	const bridge = resolveLocalAssistanceWorkflowBridge(raw);
	assert.ok(bridge?.custody);
	const bytes = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' });
	let released = 0;
	bindLocalAssistancePreparedAudioWaveRelease(bytes, async () => { released += 1; });
	const staged = await bridge.custody.stageInput({ jobId: WORKFLOW_JOB_ID,
		workflowId: 'enhance-dialogue', stageId: 'enhance-dialogue', slotId: 'audio',
		mediaType: 'audio/wav', bytes, signal: new AbortController().signal });
	assert.equal(staged.custody.sha256,
		bytesToHex(sha256(new Uint8Array(await bytes.arrayBuffer()))));
	const reserved = await bridge.custody.reserveOutput({ jobId: WORKFLOW_JOB_ID,
		workflowId: 'enhance-dialogue', stageId: 'enhance-dialogue', slotId: 'enhanced-audio',
		maximumByteLength: 4096 });
	assert.equal(reserved.custody.maximumByteLength, 4096);
	assert.equal((calls[0] as { bytes?: unknown }).bytes instanceof Blob, true);
	assert.equal(released, 1);
	assert.doesNotMatch(JSON.stringify(calls), /path|private/iu);
	assert.equal(await bridge.custody.release(WORKFLOW_JOB_ID), true);
});

test('producer binding preserves one exact earlier claim and legacy workflow bridges remain valid', async () => {
	const producer = token({ workflowId: 'transcribe-captions', direction: 'output',
		stageId: 'recognize-speech', slotId: 'transcript', claimId: claimId(31),
		byteLength: null, sha256: null, maximumByteLength: 4096 });
	const raw = workflowRaw({
		stageInput: async () => { throw new Error('unused'); },
		reserveOutput: async () => { throw new Error('unused'); },
		bindProducer: async () => {
			const custody = token({ workflowId: 'transcribe-captions', direction: 'input',
				stageId: 'assemble-captions', slotId: 'transcript', claimId: producer.claimId,
				role: producer.role, mediaType: producer.mediaType, byteLength: null, sha256: null,
				maximumByteLength: producer.maximumByteLength,
				producer: { stageId: producer.stageId, slotId: producer.slotId,
					claimId: producer.claimId } });
			return { custody, workflowClaim: workflowClaimFromCustodyV1(custody) };
		},
		release: async () => true,
	});
	const bridge = resolveLocalAssistanceWorkflowBridge(raw);
	assert.ok(bridge?.custody);
	const bound = await bridge.custody.bindProducer({ jobId: WORKFLOW_JOB_ID,
		workflowId: 'transcribe-captions', stageId: 'assemble-captions', slotId: 'transcript', producer });
	assert.deepEqual(bound.custody.producer, { stageId: 'recognize-speech',
		slotId: 'transcript', claimId: producer.claimId });
	const legacy = { ...raw }; delete (legacy as { custody?: unknown }).custody;
	assert.ok(resolveLocalAssistanceWorkflowBridge(legacy));
	assert.equal(resolveLocalAssistanceWorkflowBridge({ ...raw,
		custody: { ...raw.custody, shellPath: '/renderer/bin' } }), null);
});

test('renderer workflow review returns only a slot-compatible completed output Blob', async () => {
	const claim = Object.freeze({ claimVersion: 1 as const, direction: 'output' as const,
		claimId: claimId(41), jobId: WORKFLOW_JOB_ID,
		stageId: 'enhance-dialogue', slotId: 'enhanced-audio' });
	const body = new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'audio/wav' });
	const bridge = resolveLocalAssistanceWorkflowBridge(workflowRaw({
		stageInput: async () => { throw new Error('unused'); },
		reserveOutput: async () => { throw new Error('unused'); },
		bindProducer: async () => { throw new Error('unused'); },
		release: async () => true,
	}, async (request) => {
		assert.deepEqual(request, { jobId: WORKFLOW_JOB_ID,
			workflowId: 'enhance-dialogue', claim });
		return body;
	}));
	assert.ok(bridge?.readOutput);
	const reviewed = await bridge.readOutput({ jobId: WORKFLOW_JOB_ID,
		workflowId: 'enhance-dialogue', claim });
	assert.equal(reviewed.size, 4);
	assert.equal(reviewed.type, 'audio/wav');

	const malformed = resolveLocalAssistanceWorkflowBridge(workflowRaw({
		stageInput: async () => { throw new Error('unused'); },
		reserveOutput: async () => { throw new Error('unused'); },
		bindProducer: async () => { throw new Error('unused'); },
		release: async () => true,
	}, async () => new Blob(['{}'], { type: 'application/json' })));
	await assert.rejects(malformed!.readOutput!({ jobId: WORKFLOW_JOB_ID,
		workflowId: 'enhance-dialogue', claim }), /media|slot|Blob/iu);
});

function workflowRaw(custody: Record<string, unknown>, readOutput?: (request: unknown) => Promise<Blob>) {
	return { createJob: async () => ({ contractVersion: 1, jobId: WORKFLOW_JOB_ID }),
		run: async () => { throw new Error('unused'); },
		cancel: async () => ({ contractVersion: 1, jobId: WORKFLOW_JOB_ID, outcome: 'cancelled' }),
		onProgress: () => () => undefined, ...(readOutput ? { readOutput } : {}), custody };
}

function token(value: Omit<AssistanceWorkflowCustodyClaimV1,
	'custodyVersion' | 'jobId' | 'producer' | 'role' | 'mediaType'>
	& Partial<Pick<AssistanceWorkflowCustodyClaimV1, 'producer' | 'role' | 'mediaType'>>) {
	return createAssistanceWorkflowCustodyClaimV1({ custodyVersion: 1, jobId: WORKFLOW_JOB_ID,
		...value });
}

function claimId(ordinal: number): string { return ordinal.toString(16).padStart(40, '0'); }
