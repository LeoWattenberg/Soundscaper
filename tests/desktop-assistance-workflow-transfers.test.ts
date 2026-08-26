/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AssistanceStagingRegistry } from '../desktop/assistance-staging-registry.ts';
import { AssistanceWorkflowCustody } from '../desktop/assistance-workflow-custody.ts';
import { AssistanceWorkflowTransfers } from '../desktop/assistance-workflow-transfers.ts';
import { HelperDataPlaneInputSender } from '../desktop/helper-data-plane-input-reservation.ts';
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
	const transfers = new AssistanceWorkflowTransfers({ custody, mintStreamId: () => STREAM_ID });
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
	const transfers = new AssistanceWorkflowTransfers({ custody });
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
