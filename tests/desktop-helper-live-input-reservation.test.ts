/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';

import {
	HELPER_DATA_PLANE_INPUT_AUTHENTICATION,
	HelperDataPlaneInputReceiver,
	HelperDataPlaneInputSender,
	validateHelperDataPlaneInputReservation,
} from '../desktop/helper-data-plane-input-reservation.ts';
import {
	receiveHelperDataPlaneInputStream,
	type HelperDataPlaneIoPort,
} from '../desktop/helper-data-plane-io.ts';

const reservation = Object.freeze({
	dataPlaneVersion: 1 as const, transport: 'message-port' as const,
	streamId: 'ab'.repeat(20), direction: 'host-to-helper' as const,
	authentication: HELPER_DATA_PLANE_INPUT_AUTHENTICATION,
	byteLength: 5, maximumChunkBytes: 3, maximumInFlightChunks: 1,
});

test('live helper input authenticates its exact length and terminal SHA-256 under one-chunk backpressure', () => {
	const sender = new HelperDataPlaneInputSender(reservation);
	const receiver = new HelperDataPlaneInputReceiver(reservation);
	const first = sender.createChunk(new Uint8Array([1, 2, 3]));
	assert.throws(() => sender.createChunk(new Uint8Array([4])), /backpressure/iu);
	const acceptedFirst = receiver.acceptChunk(first);
	sender.acceptAck(acceptedFirst.ack);
	const second = sender.createChunk(new Uint8Array([4, 5]));
	sender.acceptAck(receiver.acceptChunk(second).ack);
	const completion = sender.complete();
	assert.deepEqual(receiver.acceptComplete(completion), {
		streamId: reservation.streamId, byteLength: 5,
		sha256: '74f81fe167d99b4cb41d6d0ccda82278caee9f3e2f25d5e5a3936ff3dcec60d0',
	});
});

test('live helper input rejects a caller-authored digest and any changed trailer', () => {
	assert.throws(() => validateHelperDataPlaneInputReservation({ ...reservation,
		sha256: '00'.repeat(32) }), /closed schema/iu);
	const sender = new HelperDataPlaneInputSender(reservation);
	const receiver = new HelperDataPlaneInputReceiver(reservation);
	for (const bytes of [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]) {
		const chunk = sender.createChunk(bytes); sender.acceptAck(receiver.acceptChunk(chunk).ack);
	}
	assert.throws(() => receiver.acceptComplete({ ...sender.complete(), sha256: '00'.repeat(32) }),
		/trailer disagrees/iu);
});

test('the native-input receiver ACKs only after its awaited sink write settles', async () => {
	const [host, helper] = portPair();
	const write = deferred<void>();
	let completes = 0;
	const receiving = receiveHelperDataPlaneInputStream({
		reservation, port: helper,
		sink: {
			write: () => write.promise,
			complete: () => { completes += 1; },
			abort: () => undefined,
		},
	});
	const sender = new HelperDataPlaneInputSender(reservation);
	const first = sender.createChunk(new Uint8Array([1, 2, 3]));
	host.postMessage(first);
	await tick();
	assert.equal(host.received.length, 0, 'a stalled native write must not receive an early ACK');
	write.resolve();
	const acknowledgement = await host.next();
	sender.acceptAck(acknowledgement);
	const second = sender.createChunk(new Uint8Array([4, 5]));
	host.postMessage(second);
	sender.acceptAck(await host.next());
	host.postMessage(sender.complete());
	assert.deepEqual(await receiving, {
		streamId: reservation.streamId, byteLength: 5,
		sha256: '74f81fe167d99b4cb41d6d0ccda82278caee9f3e2f25d5e5a3936ff3dcec60d0',
	});
	assert.equal(completes, 1);
});

test('a helper that floods beyond its admitted in-flight window closes the data plane', async () => {
	const [host, helper] = portPair();
	const entered = deferred<void>();
	const stalled = deferred<void>();
	const receiving = receiveHelperDataPlaneInputStream({
		reservation, port: helper,
		sink: {
			write: () => { entered.resolve(); return stalled.promise; },
			complete: () => undefined,
			abort: () => undefined,
		},
	});
	host.postMessage({
		dataPlaneVersion: 1, type: 'chunk', streamId: reservation.streamId,
		sequence: 0, offset: 0, bytes: new Uint8Array([1, 2, 3]),
	});
	await entered.promise;
	for (const [sequence, offset, byte] of [[1, 3, 4], [2, 4, 5]] as const) {
		host.postMessage({
			dataPlaneVersion: 1, type: 'chunk', streamId: reservation.streamId,
			sequence, offset, bytes: new Uint8Array([byte]),
		});
	}
	await tick();
	stalled.resolve();
	await assert.rejects(receiving, /flood|in-flight|queue|backpressure/iu);
});

test('cancelling a stalled native-input sink aborts it without acknowledging the chunk', async () => {
	const [host, helper] = portPair();
	const entered = deferred<void>();
	const stalled = deferred<void>();
	const abort = new AbortController();
	let aborts = 0;
	const receiving = receiveHelperDataPlaneInputStream({
		reservation, port: helper, signal: abort.signal,
		sink: {
			write: () => { entered.resolve(); return stalled.promise; },
			complete: () => undefined,
			abort: () => { aborts += 1; stalled.reject(new Error('native sink aborted')); },
		},
	});
	const sender = new HelperDataPlaneInputSender(reservation);
	host.postMessage(sender.createChunk(new Uint8Array([1, 2, 3])));
	await entered.promise;
	abort.abort(new Error('cancelled by queue'));
	await assert.rejects(receiving, /cancelled|aborted/iu);
	assert.equal(aborts >= 1, true);
	assert.equal(host.received.some((message) => messageType(message) === 'ack'), false);
});

test('a changed live-input trailer aborts the native sink fail-closed', async () => {
	const [host, helper] = portPair();
	let aborts = 0;
	let completes = 0;
	const receiving = receiveHelperDataPlaneInputStream({
		reservation, port: helper,
		sink: {
			write: () => undefined,
			complete: () => { completes += 1; },
			abort: () => { aborts += 1; },
		},
	});
	const sender = new HelperDataPlaneInputSender(reservation);
	for (const bytes of [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]) {
		host.postMessage(sender.createChunk(bytes));
		sender.acceptAck(await host.next());
	}
	host.postMessage({ ...sender.complete(), sha256: '00'.repeat(32) });
	await assert.rejects(receiving, /trailer disagrees/iu);
	assert.equal(completes, 0);
	assert.equal(aborts >= 1, true);
});

class Port extends EventEmitter implements HelperDataPlaneIoPort {
	peer: Port | null = null;
	readonly received: unknown[] = [];
	postMessage(message: unknown): void { queueMicrotask(() => this.peer?.accept(message)); }
	start(): void {}
	close(): void {}
	accept(message: unknown): void { this.received.push(message); this.emit('message', { data: message }); }
	async next(): Promise<unknown> {
		const existing = this.received.shift();
		if (existing !== undefined) return existing;
		const [event] = await once(this, 'message') as [{ data: unknown }];
		this.received.shift();
		return event.data;
	}
}

function portPair(): readonly [Port, Port] {
	const left = new Port(); const right = new Port(); left.peer = right; right.peer = left;
	return [left, right] as const;
}
function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
	return { promise, resolve, reject };
}
function messageType(value: unknown): unknown {
	return value && typeof value === 'object' ? (value as Record<string, unknown>).type : null;
}
async function tick(): Promise<void> { await new Promise<void>((resolve) => setImmediate(resolve)); }
