/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AssistanceStagingRegistry } from '../desktop/assistance-staging-registry.ts';
import { AssistanceWorkflowCustody } from '../desktop/assistance-workflow-custody.ts';
import { AssistanceWorkflowTransfers } from '../desktop/assistance-workflow-transfers.ts';
import { HelperDataPlaneInputSender } from '../desktop/helper-data-plane-input-reservation.ts';
import { HelperDataPlaneReceiver, type HelperDataPlaneMessage } from '../desktop/helper-data-plane.ts';
import type { HelperDataPlaneIoPort } from '../desktop/helper-data-plane-io.ts';

const JOB_ID = '11'.repeat(20);
const STREAM_ID = '22'.repeat(20);

class Port extends EventEmitter implements HelperDataPlaneIoPort {
	peer: Port | null = null;
	postMessage(message: unknown): void {
		queueMicrotask(() => this.peer?.emit('message', structuredClone(message)));
	}
	start(): void {}
	close(): void {}
}

function portPair(): readonly [Port, Port] {
	const first = new Port(); const second = new Port(); first.peer = second; second.peer = first;
	return Object.freeze([first, second]);
}

test('workflow input bytes stream into its main-owned namespace and return only exact slotted custody', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'workflow-transfer-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	let ordinal = 1;
	const custody = new AssistanceWorkflowCustody({ staging: new AssistanceStagingRegistry({
		root, mintId: () => ordinal++ === 1 ? JOB_ID : ordinal.toString(16).padStart(40, '0'),
	}) });
	const transfers = new AssistanceWorkflowTransfers({ custody,
		workflows: { openOutput: async () => { throw new Error('unused'); } },
		mintStreamId: () => STREAM_ID });
	assert.deepEqual(await custody.createJob(), { contractVersion: 1, jobId: JOB_ID });
	const body = Buffer.from('RIFF-workflow-audio');
	const sha256 = createHash('sha256').update(body).digest('hex');
	const offer = transfers.prepareInput({ jobId: JOB_ID, workflowId: 'enhance-dialogue',
		stageId: 'enhance-dialogue', slotId: 'audio', mediaType: 'audio/wav',
		byteLength: body.byteLength, sha256 });
	const [mainPort, rendererPort] = portPair();
	const receiving = transfers.acceptInputPort({ jobId: JOB_ID, streamId: STREAM_ID,
		reservation: offer.reservation }, mainPort);
	const sender = new HelperDataPlaneInputSender(offer.reservation);
	rendererPort.postMessage(sender.createChunk(body));
	const [ack] = await once(rendererPort, 'message');
	sender.acceptAck(ack);
	rendererPort.postMessage(sender.complete());
	const result = await transfers.awaitInput({ jobId: JOB_ID, streamId: STREAM_ID });
	await receiving;

	assert.equal(result.custody.role, 'audio');
	assert.equal(result.custody.mediaType, 'audio/wav');
	assert.equal(result.custody.byteLength, body.byteLength);
	assert.equal(result.custody.sha256, sha256);
	assert.deepEqual(result.workflowClaim, { claimVersion: 1, direction: 'input',
		claimId: result.custody.claimId, jobId: JOB_ID,
		stageId: 'enhance-dialogue', slotId: 'audio' });
	assert.doesNotMatch(JSON.stringify({ offer, result }), /workflow-transfer|path|RIFF/u);
	await transfers.dispose();
	await custody.releaseJob(JOB_ID);
});

test('workflow transfers derive roles from closed slots and reject renderer paths or incompatible media', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'workflow-transfer-refusal-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	let ordinal = 1;
	const custody = new AssistanceWorkflowCustody({ staging: new AssistanceStagingRegistry({
		root, mintId: () => ordinal++ === 1 ? JOB_ID : ordinal.toString(16).padStart(40, '0'),
	}) });
	const transfers = new AssistanceWorkflowTransfers({ custody,
		workflows: { openOutput: async () => { throw new Error('unused'); } } });
	await custody.createJob();
	const base = { jobId: JOB_ID, workflowId: 'enhance-dialogue', stageId: 'enhance-dialogue',
		slotId: 'audio', mediaType: 'audio/wav', byteLength: 4, sha256: 'aa'.repeat(32) };
	assert.throws(() => transfers.prepareInput({ ...base, path: '/renderer/source.wav' }), /schema/iu);
	assert.throws(() => transfers.prepareInput({ ...base, mediaType: 'video/mp4' }), /media type/iu);
	assert.throws(() => transfers.prepareInput({ ...base, slotId: 'enhanced-audio' }), /slot/iu);
	assert.doesNotThrow(() => custody.assertJob(JOB_ID));
	await transfers.dispose();
	await custody.releaseJob(JOB_ID);
});

test('completed authenticated workflow output streams through one exact slotted MessagePort', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'workflow-review-transfer-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, 'review.json');
	const body = Buffer.from('{"cues":[]}');
	const sha256 = createHash('sha256').update(body).digest('hex');
	await writeFile(path, body);
	const workflowClaim = Object.freeze({ claimVersion: 1 as const, direction: 'output' as const,
		claimId: '33'.repeat(20), jobId: JOB_ID, stageId: 'assemble-captions', slotId: 'captions' });
	const outputClaim = Object.freeze({ claimVersion: 1 as const, claimId: workflowClaim.claimId,
		jobId: JOB_ID, role: 'captions' as const, mediaType: 'application/json',
		byteLength: body.byteLength, sha256 });
	const transfers = new AssistanceWorkflowTransfers({ custody: {
		assertJob: () => undefined, stageRawInput: async () => { throw new Error('unused'); },
		bindStagedInput: () => { throw new Error('unused'); },
	} as never, workflows: { openOutput: async (request) => {
		assert.deepEqual(request, { jobId: JOB_ID, workflowId: 'transcribe-captions',
			claim: workflowClaim });
		return { custody: { custodyVersion: 1, workflowId: 'transcribe-captions', direction: 'output',
			jobId: JOB_ID, stageId: workflowClaim.stageId, slotId: workflowClaim.slotId,
			claimId: workflowClaim.claimId, role: 'captions', mediaType: 'application/json',
			byteLength: null, sha256: null, maximumByteLength: 4096, producer: null },
			workflowClaim, claim: outputClaim, path } as never;
	} }, mintStreamId: () => STREAM_ID });
	const offer = await transfers.prepareOutput({ jobId: JOB_ID,
		workflowId: 'transcribe-captions', claim: workflowClaim });
	assert.equal(offer.mediaType, 'application/json');
	assert.deepEqual(offer.workflowClaim, workflowClaim);
	const [mainPort, rendererPort] = portPair();
	const receiver = new HelperDataPlaneReceiver(offer.binding);
	const received: Uint8Array[] = [];
	rendererPort.on('message', (message: HelperDataPlaneMessage) => {
		if (message.type === 'chunk') {
			received.push(message.bytes); rendererPort.postMessage(receiver.acceptChunk(message));
		} else if (message.type === 'complete') receiver.acceptComplete(message);
	});
	await transfers.acceptOutputPort({ jobId: JOB_ID, workflowId: 'transcribe-captions',
		workflowClaim, streamId: offer.binding.streamId, binding: offer.binding }, mainPort);
	assert.equal(Buffer.concat(received).toString(), body.toString());
	assert.doesNotMatch(JSON.stringify(offer), /workflow-review-transfer|path|cues/iu);
	await transfers.dispose();
});

test('workflow output cancellation quiesces an attached review before cleanup', async () => {
	const workflowClaim = Object.freeze({ claimVersion: 1 as const, direction: 'output' as const,
		claimId: '44'.repeat(20), jobId: JOB_ID, stageId: 'enhance-dialogue',
		slotId: 'enhanced-audio' });
	const claim = Object.freeze({ claimVersion: 1 as const, claimId: workflowClaim.claimId,
		jobId: JOB_ID, role: 'enhanced-audio' as const, mediaType: 'audio/wav',
		byteLength: 4, sha256: 'aa'.repeat(32) });
	let quiesced = false;
	const transfers = new AssistanceWorkflowTransfers({ custody: {
		assertJob: () => undefined, stageRawInput: async () => { throw new Error('unused'); },
		bindStagedInput: () => { throw new Error('unused'); },
	} as never, workflows: { openOutput: async () => ({ custody: {
		custodyVersion: 1, workflowId: 'enhance-dialogue', direction: 'output', jobId: JOB_ID,
		stageId: workflowClaim.stageId, slotId: workflowClaim.slotId, claimId: workflowClaim.claimId,
		role: claim.role, mediaType: claim.mediaType, byteLength: null, sha256: null,
		maximumByteLength: 4096, producer: null,
	}, workflowClaim, claim, path: '/private/review.wav' }) }, mintStreamId: () => STREAM_ID,
		sendFile: async ({ signal, port, binding }) => {
			try {
				await new Promise<void>((_resolve, reject) => signal?.addEventListener(
					'abort', () => reject(signal.reason), { once: true },
				));
				return { streamId: binding.streamId, byteLength: binding.byteLength,
					sha256: binding.sha256 };
			} finally { quiesced = true; port.close(); }
		},
	});
	const offer = await transfers.prepareOutput({ jobId: JOB_ID,
		workflowId: 'enhance-dialogue', claim: workflowClaim });
	const [mainPort] = portPair();
	const active = transfers.acceptOutputPort({ jobId: JOB_ID, workflowId: 'enhance-dialogue',
		workflowClaim, streamId: STREAM_ID, binding: offer.binding }, mainPort);
	await transfers.cancelJob(JOB_ID);
	await assert.rejects(active, /abort|cancel/iu);
	assert.equal(quiesced, true);
	await transfers.dispose();
});
