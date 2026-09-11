/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';

const JOB_ID = '1'.repeat(40);
const CLAIM_ID = '2'.repeat(40);
const STREAM_ID = '3'.repeat(40);

// Electron MessagePortMain cannot deserialize a renderer ArrayBuffer transfer:
// https://github.com/electron/electron/issues/34905. Byte arrays must be cloned.
class ElectronMessageChannel extends MessageChannel {
	constructor() {
		super();
		const postMessage = this.port2.postMessage.bind(this.port2);
		this.port2.postMessage = (message, transfer = []) => {
			assert.equal(transfer.length, 0, 'Electron main-process ports require cloned byte arrays');
			postMessage(message);
			if (message.type === 'chunk') assert.ok(message.bytes.byteLength > 0);
		};
	}
}

for (const workflow of [false, true]) {
	test(`${workflow ? 'workflow custody' : 'operation'} input clones bounded chunks for Electron main`, async () => {
		const bytes = Buffer.from('RIFF-real-Electron-transport');
		const sha256 = createHash('sha256').update(bytes).digest('hex');
		const reservation = { dataPlaneVersion: 1, transport: 'message-port', streamId: STREAM_ID,
			direction: 'host-to-helper', authentication: 'trailer-sha256-v1',
			byteLength: bytes.byteLength, maximumChunkBytes: 4, maximumInFlightChunks: 1 };
		const claim = { claimVersion: 1, claimId: CLAIM_ID, jobId: JOB_ID, role: 'audio',
			mediaType: 'audio/wav', byteLength: bytes.byteLength, sha256 };
		const workflowSlot = { workflowId: 'enhance-dialogue', stageId: 'enhance-dialogue', slotId: 'audio' };
		const custody = { custodyVersion: 1, direction: 'input', jobId: JOB_ID, claimId: CLAIM_ID,
			...workflowSlot, role: 'audio', mediaType: 'audio/wav', byteLength: bytes.byteLength,
			sha256, maximumByteLength: null, producer: null };
		const result = workflow ? { custody, workflowClaim: { claimVersion: 1, direction: 'input',
			claimId: CLAIM_ID, jobId: JOB_ID, stageId: workflowSlot.stageId, slotId: 'audio' } } : claim;
		const received = [];
		const invocations = [];
		const responses = [{ contractVersion: 1, jobId: JOB_ID, streamId: STREAM_ID, reservation }, result];
		const channelName = `soundscaper:v1:assistance:${workflow ? 'workflow' : 'operation'}:input-port`;
		const completion = Promise.withResolvers();
		let bridge;
		const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
		vm.runInNewContext(source, { AggregateError, ArrayBuffer, Array, Blob, clearTimeout, console,
			crypto: webcrypto, Error, Map, MessageChannel: ElectronMessageChannel, Number, Object,
			Promise, RangeError, Reflect, setTimeout, String, structuredClone, TypeError, Uint8Array, URL,
			require: () => ({
				contextBridge: { exposeInMainWorld(name, value) { if (name === 'scapeDesktop') bridge = value.v1; } },
				ipcRenderer: {
					async invoke(channel, value) {
						invocations.push([channel, value]);
						if (value.operation === 'await') await completion.promise;
						return responses.shift();
					},
					postMessage(channel, _control, ports) {
						assert.equal(channel, channelName);
						assert.equal(ports.length, 1);
						ports[0].on('message', (message) => {
							if (message.type === 'complete') { completion.resolve(message); return; }
							assert.equal(message.type, 'chunk');
							assert.equal(message.sequence, received.length);
							assert.ok(message.bytes.byteLength <= reservation.maximumChunkBytes);
							received.push(message.bytes);
							ports[0].postMessage({ dataPlaneVersion: 1, type: 'ack', streamId: STREAM_ID,
								sequence: message.sequence, receivedBytes: message.offset + message.bytes.byteLength });
						});
					},
					send() {}, on() {}, removeListener() {},
				},
			}),
		});
		const input = { jobId: JOB_ID, mediaType: 'audio/wav', sha256,
			bytes: new Blob([bytes], { type: 'audio/wav' }) };
		const staged = workflow
			? await bridge.localAssistance.workflow.custody.stageInput({ ...input, ...workflowSlot, byteLength: bytes.byteLength })
			: await bridge.localAssistance.stageInput({ ...input, role: 'audio' });
		assert.deepEqual(JSON.parse(JSON.stringify(staged)), result);
		assert.deepEqual(Buffer.concat(received), bytes);
		assert.deepEqual(await completion.promise, { dataPlaneVersion: 1, type: 'complete', streamId: STREAM_ID,
			byteLength: bytes.byteLength, sha256 });
		assert.equal(invocations.length, 2);
		assert.ok(invocations.every(([, value]) => !Object.hasOwn(value, 'bytes')));
	});
}
