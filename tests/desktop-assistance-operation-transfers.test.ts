/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { validateAssistanceStagedInputClaim } from '../desktop/assistance-data-claims.ts';
import { AssistanceOperationTransfers } from '../desktop/assistance-operation-transfers.ts';
import { HelperDataPlaneInputSender } from '../desktop/helper-data-plane-input-reservation.ts';
import { HelperDataPlaneReceiver, type HelperDataPlaneMessage } from '../desktop/helper-data-plane.ts';
import type { HelperDataPlaneIoPort } from '../desktop/helper-data-plane-io.ts';

const JOB_ID = '1'.repeat(40);
const CLAIM_ID = '2'.repeat(40);

class Port extends EventEmitter implements HelperDataPlaneIoPort {
	peer: Port | null = null;
	closed = false;
	postMessage(message: unknown): void { queueMicrotask(() => this.peer?.emit('message', structuredClone(message))); }
	start(): void {}
	close(): void { this.closed = true; }
}

function portPair(): readonly [Port, Port] {
	const first = new Port(); const second = new Port(); first.peer = second; second.peer = first;
	return Object.freeze([first, second]);
}

function claim(bytes: Uint8Array) {
	return validateAssistanceStagedInputClaim({
		claimVersion: 1, claimId: CLAIM_ID, jobId: JOB_ID, role: 'audio', mediaType: 'audio/wav',
		byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'),
	});
}

async function completeInput(
	transfers: AssistanceOperationTransfers,
	offer: ReturnType<AssistanceOperationTransfers['prepareInput']>,
	body: Uint8Array,
): Promise<void> {
	const [mainPort, rendererPort] = portPair();
	const receiving = transfers.acceptInputPort({
		jobId: JOB_ID, streamId: offer.streamId, reservation: offer.reservation,
	}, mainPort);
	const sender = new HelperDataPlaneInputSender(offer.reservation);
	rendererPort.postMessage(sender.createChunk(body));
	const [ack] = await once(rendererPort, 'message');
	sender.acceptAck(ack);
	rendererPort.postMessage(sender.complete());
	await receiving;
}

test('a negotiated input port streams bounded bytes into staging and authenticates its claim', async () => {
	const body = Buffer.from('RIFF-audio');
	const staged: Uint8Array[] = [];
	const expected = claim(body);
	const transfers = new AssistanceOperationTransfers({
		operations: {
			assertJob: (jobId) => assert.equal(jobId, JOB_ID),
			stageInput: async (request) => {
				for await (const chunk of request.bytes) staged.push(chunk);
				return expected;
			},
			openOutput: async () => { throw new Error('unused'); },
		},
		mintStreamId: () => '3'.repeat(40),
	});
	const offer = transfers.prepareInput({
		jobId: JOB_ID, role: 'audio', mediaType: 'audio/wav', byteLength: body.byteLength,
		sha256: expected.sha256,
	});
	const [mainPort, rendererPort] = portPair();
	const receiving = transfers.acceptInputPort({ jobId: JOB_ID, streamId: offer.streamId,
		reservation: offer.reservation }, mainPort);
	const sender = new HelperDataPlaneInputSender(offer.reservation);
	const message = sender.createChunk(body);
	rendererPort.postMessage(message);
	const [ack] = await once(rendererPort, 'message');
	sender.acceptAck(ack);
	rendererPort.postMessage(sender.complete());

	assert.deepEqual(await transfers.awaitInput({ jobId: JOB_ID, streamId: offer.streamId }), expected);
	await receiving;
	assert.equal(Buffer.concat(staged).toString(), body.toString());
	assert.equal(mainPort.closed, true);
	assert.doesNotMatch(JSON.stringify(offer), /path|RIFF/u);
});

test('a digest mismatch rejects the transfer instead of publishing a staged claim', async () => {
	const body = Buffer.from('wrong');
	const transfers = new AssistanceOperationTransfers({
		operations: {
			assertJob: () => undefined,
			stageInput: async (request) => { for await (const _chunk of request.bytes) { /* drain */ } return claim(body); },
			openOutput: async () => { throw new Error('unused'); },
		}, mintStreamId: () => '4'.repeat(40),
	});
	const offer = transfers.prepareInput({ jobId: JOB_ID, role: 'audio', mediaType: 'audio/wav',
		byteLength: body.byteLength, sha256: 'f'.repeat(64) });
	const [mainPort, rendererPort] = portPair();
	const receiving = transfers.acceptInputPort({ jobId: JOB_ID, streamId: offer.streamId,
		reservation: offer.reservation }, mainPort);
	const sender = new HelperDataPlaneInputSender(offer.reservation);
	rendererPort.postMessage(sender.createChunk(body));
	const [ack] = await once(rendererPort, 'message'); sender.acceptAck(ack);
	rendererPort.postMessage(sender.complete());

	await assert.rejects(transfers.awaitInput({ jobId: JOB_ID, streamId: offer.streamId }), /digest|SHA/iu);
	await assert.rejects(receiving, /digest|SHA/iu);
});

test('output bytes flow only through a correlated negotiated port', async (t) => {
	const body = Buffer.from('{"segments":[]}');
	const digest = createHash('sha256').update(body).digest('hex');
	const root = await mkdtemp(join(tmpdir(), 'assistance-output-port-'));
	const path = join(root, 'result.json');
	await writeFile(path, body);
	t.after(() => rm(root, { recursive: true, force: true }));
	const transfers = new AssistanceOperationTransfers({
		operations: {
			assertJob: () => undefined,
			stageInput: async () => { throw new Error('unused'); },
			openOutput: async () => ({ path, binding: {
				dataPlaneVersion: 1, transport: 'message-port', streamId: '5'.repeat(40),
				direction: 'helper-to-host', byteLength: body.byteLength, sha256: digest,
				maximumChunkBytes: 1024, maximumInFlightChunks: 1,
			} }),
		},
	});
	const outputClaim = { claimVersion: 1, claimId: CLAIM_ID, jobId: JOB_ID,
		role: 'transcript', mediaType: 'application/json', byteLength: body.byteLength, sha256: digest };
	const offer = await transfers.prepareOutput({ jobId: JOB_ID, claim: outputClaim });
	const [mainPort, rendererPort] = portPair();
	const receiver = new HelperDataPlaneReceiver(offer.binding);
	const received: Uint8Array[] = [];
	rendererPort.on('message', (value: HelperDataPlaneMessage) => {
		if (value.type === 'chunk') { received.push(value.bytes); rendererPort.postMessage(receiver.acceptChunk(value)); }
		else if (value.type === 'complete') receiver.acceptComplete(value);
	});
	await transfers.acceptOutputPort({ jobId: JOB_ID, streamId: offer.binding.streamId,
		binding: offer.binding }, mainPort);

	assert.equal(Buffer.concat(received).toString(), body.toString());
	assert.doesNotMatch(JSON.stringify(offer), /assistance-output-port|path/u);
});

test('job cancellation rejects unattached negotiations and waits for attached port cleanup', async () => {
	let released = false;
	const transfers = new AssistanceOperationTransfers({
		operations: {
			assertJob: () => undefined,
			stageInput: async (request) => {
				try { for await (const _chunk of request.bytes) { /* drain */ } }
				finally { await new Promise((resolve) => setTimeout(resolve, 5)); released = true; }
				throw new Error('cancelled');
			},
			openOutput: async () => { throw new Error('unused'); },
		}, mintStreamId: () => '6'.repeat(40),
	});
	const offer = transfers.prepareInput({ jobId: JOB_ID, role: 'audio', mediaType: 'audio/wav',
		byteLength: 5, sha256: 'f'.repeat(64) });
	const [mainPort] = portPair();
	const attached = transfers.acceptInputPort({ jobId: JOB_ID, streamId: offer.streamId,
		reservation: offer.reservation }, mainPort);
	const awaited = assert.rejects(transfers.awaitInput({ jobId: JOB_ID, streamId: offer.streamId }), /cancel/iu);
	await transfers.cancelJob(JOB_ID);

	assert.equal(released, true);
	await awaited;
	await assert.rejects(attached, /cancel/iu);
});

test('cancel and job release do not leak completed inputs when awaitInput is omitted', async () => {
	const body = Buffer.from('x');
	let stream = 10;
	const transfers = new AssistanceOperationTransfers({
		operations: {
			assertJob: () => undefined,
			stageInput: async (request) => {
				const chunks: Uint8Array[] = [];
				for await (const chunk of request.bytes) chunks.push(chunk);
				return claim(Buffer.concat(chunks));
			},
			openOutput: async () => { throw new Error('unused'); },
		},
		mintStreamId: () => (stream++).toString(16).padStart(40, '0'),
	});

	for (let index = 0; index < 65; index += 1) {
		const offer = transfers.prepareInput({
			jobId: JOB_ID, role: 'audio', mediaType: 'audio/wav', byteLength: body.byteLength,
			sha256: claim(body).sha256,
		});
		await completeInput(transfers, offer, body);
		await transfers.cancelJob(JOB_ID);
	}
});

test('dispose deletes an attached input even when awaitInput is omitted', async () => {
	const body = Buffer.from('x');
	const transfers = new AssistanceOperationTransfers({
		operations: {
			assertJob: () => undefined,
			stageInput: async (request) => {
				for await (const _chunk of request.bytes) { /* drain */ }
				return claim(body);
			},
			openOutput: async () => { throw new Error('unused'); },
		},
		mintStreamId: () => '7'.repeat(40),
	});
	const first = transfers.prepareInput({
		jobId: JOB_ID, role: 'audio', mediaType: 'audio/wav', byteLength: body.byteLength,
		sha256: claim(body).sha256,
	});
	await completeInput(transfers, first, body);
	await transfers.dispose();

	const second = transfers.prepareInput({
		jobId: JOB_ID, role: 'audio', mediaType: 'audio/wav', byteLength: body.byteLength,
		sha256: claim(body).sha256,
	});
	assert.equal(second.streamId, first.streamId);
	await transfers.dispose();
});
