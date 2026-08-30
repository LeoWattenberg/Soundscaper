/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import test from 'node:test';

import {
	createSoundscaperPersistentDeliveryPrivateTransport,
} from '../src/common/editor/controller/soundscaper-persistent-delivery-private-transport.ts';
import {
	createSoundscaperPersistentAudioDeliveryPlanV1,
} from '../src/common/editor/soundscaper-persistent-delivery-plan-v1.ts';

const JOB = '1'.repeat(48);
const CLAIM = '2'.repeat(48);
const WRITE = '3'.repeat(48);
const PROJECT = Object.freeze({
	projectId: 'album-project', projectRevision: 7, projectSha256: 'a'.repeat(64),
});
const PLAN = createSoundscaperPersistentAudioDeliveryPlanV1({
	settings: { format: 'wav' }, exportPlan: { format: 'wav', outputFrames: 4 }, batch: null,
});

test('renderer obtains one claim capability and serializes private port operations with transferred bytes', async () => {
	const operations: Array<Readonly<{ sequence: number; operation: string; payload: unknown }>> = [];
	const transport = createSoundscaperPersistentDeliveryPrivateTransport({
		createMessageChannel: () => new MessageChannel() as never,
		scope: {
			postMessage(
				message: { type: string; request: { jobId: string } },
				_origin: string,
				ports: MessagePort[],
			) {
				assert.equal(message.type, 'soundscaper-persistent-delivery-worker-connect-v1');
				assert.equal(message.request.jobId, JOB);
				const port = ports[0]!;
				port.on('message', (value: unknown) => {
					const request = value as { sequence: number; operation: string; payload: unknown };
					operations.push(request);
					const respond = () => {
						port.postMessage({
							protocolVersion: 1, type: 'response', sequence: request.sequence, ok: true,
							value: responseValue(request.operation),
						});
					};
					if (request.operation === 'progress') setImmediate(respond);
					else respond();
				});
				port.postMessage({
					protocolVersion: 1, type: 'claimed', maximumChunkBytes: 4 * 1024 * 1024,
					claim: { jobId: JOB, claimId: CLAIM, plan: PLAN },
				});
			},
		} as never,
	});
	const capability = await transport.claimNext({
		jobId: JOB,
		currentAuthority: { projectIdentity: PROJECT, planFingerprint: 'b'.repeat(64) },
	});
	assert.ok(capability);
	assert.equal(capability.claimId, CLAIM);
	const progress = capability.progress(0.25);
	const opened = capability.beginWrite({ fileName: 'master.wav', size: 4 });
	await progress;
	assert.deepEqual(await opened, { writeId: WRITE, chunkSize: 4 * 1024 * 1024 });
	const input = new Uint8Array([1, 2, 3, 4]);
	await capability.writeChunk({ writeId: WRITE, offset: 0, bytes: input });
	input[0] = 99;
	assert.deepEqual(
		[...((operations.at(-1)!.payload as { bytes: Uint8Array }).bytes)],
		[1, 2, 3, 4],
	);
	await capability.finishWrite(WRITE);
	await capability.complete(deliveryReport() as never);
	assert.deepEqual(operations.map(({ sequence, operation }) => [sequence, operation]), [
		[0, 'progress'], [1, 'write-begin'], [2, 'write-chunk'], [3, 'write-finish'], [4, 'complete'],
	]);
});

test('renderer returns null for an unavailable authenticated exact-job claim', async () => {
	const transport = createSoundscaperPersistentDeliveryPrivateTransport({
		createMessageChannel: () => new MessageChannel() as never,
		scope: {
			postMessage(_message: unknown, _origin: string, ports: MessagePort[]) {
				ports[0]!.postMessage({ protocolVersion: 1, type: 'unavailable' });
			},
		} as never,
	});
	assert.equal(await transport.claimNext({
		jobId: JOB,
		currentAuthority: { projectIdentity: PROJECT, planFingerprint: 'b'.repeat(64) },
	}), null);
});

test('a refused terminal operation still closes the claim port for main-owned release', async () => {
	let serverPort: MessagePort | null = null;
	let closeServerPort = () => undefined;
	let signalClosed!: () => void;
	const terminalRequests: Array<Readonly<{ operation?: unknown; payload?: unknown }>> = [];
	const closed = new Promise<void>((resolve) => { signalClosed = resolve; });
	const transport = createSoundscaperPersistentDeliveryPrivateTransport({
		createMessageChannel: () => new MessageChannel() as never,
		scope: {
			postMessage(_message: unknown, _origin: string, ports: MessagePort[]) {
				serverPort = ports[0]!;
				closeServerPort = () => { serverPort?.close(); };
				serverPort.on('close', signalClosed);
				serverPort.on('message', (value: unknown) => {
					const request = value as { sequence: number; operation?: unknown; payload?: unknown };
					terminalRequests.push(request);
					serverPort!.postMessage({
						protocolVersion: 1, type: 'response', sequence: request.sequence,
						ok: false, errorCode: 'operation-refused',
					});
				});
				serverPort.postMessage({
					protocolVersion: 1, type: 'claimed', maximumChunkBytes: 4 * 1024 * 1024,
					claim: { jobId: JOB, claimId: CLAIM, plan: PLAN },
				});
			},
		} as never,
	});
	const capability = await transport.claimNext({
		jobId: JOB,
		currentAuthority: { projectIdentity: PROJECT, planFingerprint: 'b'.repeat(64) },
	});
	assert.ok(capability);
	try {
		const report = deliveryReport();
		await assert.rejects(capability.fail('ordinary-export-error', report as never), /operation-refused/u);
		assert.equal(terminalRequests.at(-1)?.operation, 'fail');
		assert.deepEqual((terminalRequests.at(-1)?.payload as { report: unknown }).report, report);
		await Promise.race([
			closed,
			new Promise<never>((_resolve, reject) => {
				setTimeout(() => { reject(new Error('terminal claim port remained open')); }, 100).unref?.();
			}),
		]);
	} finally {
		closeServerPort();
	}
});

test('a synchronous claim-offer failure removes pending listeners and closes both ports', async () => {
	const first = trackedPort();
	const second = trackedPort();
	const transport = createSoundscaperPersistentDeliveryPrivateTransport({
		createMessageChannel: () => ({ port1: first.port, port2: second.port }) as never,
		scope: {
			postMessage() { throw new Error('claim offer failed synchronously'); },
		} as never,
	});
	await assert.rejects(transport.claimNext({
		jobId: JOB,
		currentAuthority: { projectIdentity: PROJECT, planFingerprint: 'b'.repeat(64) },
	}), /claim offer failed synchronously/u);
	assert.equal(first.closed(), 1);
	assert.equal(second.closed(), 1);
	assert.equal(first.listenerCount(), 0);
});

function responseValue(operation: string): unknown {
	if (operation === 'write-begin') return { writeId: WRITE, chunkSize: 4 * 1024 * 1024 };
	if (operation === 'write-chunk') return { nextOffset: 4 };
	if (operation === 'write-finish') return { byteLength: 4 };
	return true;
}

function deliveryReport() {
	return {
		schemaVersion: 1, format: 'delivery', direction: 'export',
		subject: {
			format: 'wav', container: 'riff', codec: 'pcm-s24le', sampleRate: 48_000,
			channelCount: 2, lossless: true,
		},
		items: [], counts: { preserved: 0, converted: 0, missing: 0, omitted: 0 },
	};
}

function trackedPort() {
	const listeners = new Map<string, Set<(event: unknown) => void>>();
	let closes = 0;
	return {
		port: {
			postMessage() { /* no peer */ },
			start() { /* no peer */ },
			close() { closes += 1; },
			addEventListener(type: string, listener: (event: unknown) => void) {
				const selected = listeners.get(type) ?? new Set();
				selected.add(listener);
				listeners.set(type, selected);
			},
			removeEventListener(type: string, listener: (event: unknown) => void) {
				listeners.get(type)?.delete(listener);
			},
		},
		closed: () => closes,
		listenerCount: () => [...listeners.values()].reduce((total, selected) => total + selected.size, 0),
	};
}
