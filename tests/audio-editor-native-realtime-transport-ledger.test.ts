/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	NativeRealtimeProtocolError,
	createNativeRealtimePacketPool,
	createNativeRealtimeSender,
} from '../src/common/editor/native-realtime-transport.ts';
import type {
	NativeRealtimeAudioMessage,
	NativeRealtimeCloseEvent,
	NativeRealtimeErrorCode,
	NativeRealtimePacketDispatch,
} from '../src/common/editor/native-realtime-transport.ts';

const FRAMES = 8;
const CHANNELS = 2;

/**
 * The pool ledger decides who owns a packet buffer. These cover the paths a
 * live peer reaches by being late, duplicating a message, or handing back
 * memory that is not shaped like what it was lent.
 */

function createPool(capacity = 2) {
	return createNativeRealtimePacketPool({ capacity, channelCount: CHANNELS, frameCount: FRAMES });
}

function hasCode(code: NativeRealtimeErrorCode): (error: unknown) => boolean {
	return (error: unknown) => error instanceof NativeRealtimeProtocolError && error.code === code;
}

/** The return a well-behaved peer would send for a packet it has finished with. */
function returnFor(packet: NativeRealtimeAudioMessage): NativeRealtimePacketDispatch {
	return { generation: packet.generation, packetId: packet.packetId, sequence: packet.sequence, channels: [...packet.channels] };
}

test('the pool ledger rejects returns it cannot account for', () => {
	const pool = createPool();
	const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
	const dispatch = { generation: 1, sequence: 0, channels };
	assert.throws(() => pool.release({ ...dispatch, packetId: 0 }), hasCode('POOL_LEDGER'));
	assert.throws(() => pool.release({ ...dispatch, packetId: 5 }), hasCode('INVALID_FIELD'));
	const lease = pool.acquire();
	assert.ok(lease);
	assert.throws(() => pool.release({ ...dispatch, packetId: lease.packetId }), hasCode('POOL_LEDGER'));
	const sender = createNativeRealtimeSender({ pool, generation: 1 });
	sender.send(lease);
	assert.throws(() => pool.release({ ...dispatch, packetId: lease.packetId, channels: [new Float32Array(FRAMES)] }), hasCode('POOL_LEDGER'));
	assert.throws(
		() => pool.release({ ...dispatch, packetId: lease.packetId, channels: [new Float32Array(2), new Float32Array(2)] }),
		hasCode('POOL_LEDGER'),
	);
	assert.throws(() => pool.recycle(lease), hasCode('POOL_LEDGER'));
	assert.equal(pool.inFlightCount, 1);
});

test('a return that aliases one buffer across channels is refused', () => {
	const pool = createPool(1);
	const sender = createNativeRealtimeSender({ pool, generation: 1 });
	const lease = sender.acquire();
	assert.ok(lease);
	const sent = sender.send(lease);
	// Adopting these would cost the pool a buffer and leave both channels
	// writing over each other for the rest of the pool's life.
	const alias = new Float32Array(FRAMES);
	assert.throws(() => pool.release({ ...returnFor(sent.message), channels: [alias, alias] }), hasCode('POOL_LEDGER'));
	assert.equal(pool.inFlightCount, 1);
	assert.equal(pool.availableCount, 0);

	pool.release(returnFor(sent.message));
	const reused = pool.acquire();
	assert.ok(reused);
	const channels = reused.channels();
	assert.notEqual(channels[0].buffer, channels[1].buffer, 'each channel must keep its own buffer');
	channels[1][0] = 1;
	assert.equal(channels[0][0], 0);
	assert.equal(pool.allocationCount, CHANNELS);
});

test('a late return from a cancelled generation still restores pool credit', () => {
	const pool = createPool();
	const first = createNativeRealtimeSender({ pool, generation: 1 });
	const sent = [first.send(first.acquire()!), first.send(first.acquire()!)];
	first.close('cancelled');
	assert.equal(pool.availableCount, 0);

	// The buffers belong to the pool, not to the generation that sent them, so
	// the next generation is not starved by the one that was interrupted.
	const second = createNativeRealtimeSender({ pool, generation: 2 });
	assert.equal(second.credit, 0);
	for (const packet of sent) second.acceptReturn({ protocolVersion: 1, kind: 'return', ...returnFor(packet.message) });
	assert.equal(second.closed, false);
	assert.equal(second.credit, 2);
	assert.equal(pool.inFlightCount, 0);
	assert.equal(pool.allocationCount, 2 * CHANNELS);
	const lease = second.acquire();
	assert.ok(lease, 'a cancelled generation must not strand the pool it borrowed from');
	assert.equal(lease.channels()[0].length, FRAMES);
});

test('a duplicated return can never credit a packet that is in flight again', () => {
	const pool = createPool(1);
	const sender = createNativeRealtimeSender({ pool, generation: 1 });
	const first = sender.send(sender.acquire()!);
	const wire = { protocolVersion: 1, kind: 'return', ...returnFor(first.message) };
	sender.acceptReturn(wire);
	assert.equal(pool.availableCount, 1);

	const second = sender.send(sender.acquire()!);
	assert.equal(second.message.sequence, 1);
	assert.equal(pool.inFlightCount, 1);
	// The peer repeats the first return while it still holds the second packet.
	// Crediting it would hand the same memory to a second writer.
	sender.acceptReturn(wire);
	assert.equal(pool.inFlightCount, 1, 'the packet still in flight stays in flight');
	assert.equal(pool.availableCount, 0);
	assert.equal(sender.closeReason, 'pool-leak');
	assert.equal(sender.lastError?.code, 'POOL_LEDGER');
	assert.equal(sender.acquire(), null);
});

test('a buffer that never comes home trips the pool-leak deadline', () => {
	let clock = 0;
	const closes: NativeRealtimeCloseEvent[] = [];
	const sender = createNativeRealtimeSender({
		pool: createPool(1), generation: 1, leaseTimeoutMs: 100, now: () => clock, onClose: (event) => closes.push(event),
	});
	sender.send(sender.acquire()!);
	clock = 100;
	sender.auditPool();
	assert.equal(sender.closed, false, 'the deadline has not passed yet');
	clock = 101;
	sender.auditPool();
	assert.equal(sender.closeReason, 'pool-leak');
	assert.deepEqual(closes, [{ generation: 1, reason: 'pool-leak' }]);
	sender.auditPool();
	assert.equal(closes.length, 1, 'a later audit never closes the generation twice');
});

test('a sender requires a pool built by this module', () => {
	const foreign = { capacity: 1, channelCount: 1, frameCount: FRAMES, availableCount: 1 };
	assert.throws(
		() => createNativeRealtimeSender({ pool: foreign as never, generation: 1 }),
		/requires a pool from createNativeRealtimePacketPool/u,
	);
});

test('a return that names the wrong sequence of the right packet is refused', () => {
	const pool = createPool(1);
	const sender = createNativeRealtimeSender({ pool, generation: 1 });
	const sent = sender.send(sender.acquire()!);
	assert.throws(() => pool.release({ ...returnFor(sent.message), sequence: 7 }), hasCode('POOL_LEDGER'));
	assert.throws(() => pool.release({ ...returnFor(sent.message), generation: 9 }), hasCode('POOL_LEDGER'));
	pool.release(returnFor(sent.message));
	assert.equal(pool.availableCount, 1);
	assert.equal(pool.inFlightCount, 0);
});
