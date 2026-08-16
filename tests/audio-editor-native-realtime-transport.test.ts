/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	NATIVE_REALTIME_CLOSE_REASONS,
	NATIVE_REALTIME_MAX_QUEUE_PACKETS,
	NATIVE_REALTIME_PACKET_FRAMES,
	NATIVE_REALTIME_PROTOCOL_VERSION,
	NATIVE_REALTIME_REPLAY_POLICY,
	NativeRealtimeProtocolError,
	createNativeRealtimePacketPool,
	createNativeRealtimeReceiver,
	createNativeRealtimeSender,
	transferListForNativeRealtimeChannels,
	validateNativeRealtimeMessage,
} from '../src/common/editor/native-realtime-transport.ts';
import type {
	NativeRealtimeAudioMessage,
	NativeRealtimeCloseEvent,
	NativeRealtimeErrorCode,
	NativeRealtimePacketLease,
	NativeRealtimeReceiver,
	NativeRealtimeSender,
} from '../src/common/editor/native-realtime-transport.ts';

const FRAMES = 8;
const CHANNELS = 2;

type Wire = Record<string, unknown>;

interface Loop {
	readonly pool: ReturnType<typeof createNativeRealtimePacketPool>;
	readonly sender: NativeRealtimeSender;
	readonly receiver: NativeRealtimeReceiver;
	readonly senderCloses: NativeRealtimeCloseEvent[];
	readonly receiverCloses: NativeRealtimeCloseEvent[];
}

function createLoop(overrides: { capacity?: number; queueCapacity?: number; now?: () => number; leaseTimeoutMs?: number } = {}): Loop {
	const capacity = overrides.capacity ?? 4;
	const queueCapacity = overrides.queueCapacity ?? capacity;
	const senderCloses: NativeRealtimeCloseEvent[] = [];
	const receiverCloses: NativeRealtimeCloseEvent[] = [];
	const pool = createNativeRealtimePacketPool({ capacity, channelCount: CHANNELS, frameCount: FRAMES });
	const sender = createNativeRealtimeSender({
		pool,
		generation: 1,
		queueCapacity,
		leaseTimeoutMs: overrides.leaseTimeoutMs ?? 1_000,
		now: overrides.now,
		onClose: (event) => senderCloses.push(event),
	});
	const receiver = createNativeRealtimeReceiver({
		channelCount: CHANNELS,
		frameCount: FRAMES,
		queueCapacity: NATIVE_REALTIME_MAX_QUEUE_PACKETS,
		onClose: (event) => receiverCloses.push(event),
	});
	assert.equal(receiver.accept(sender.openMessage()).status, 'opened');
	return { pool, sender, receiver, senderCloses, receiverCloses };
}

function mustAcquire(sender: NativeRealtimeSender): NativeRealtimePacketLease {
	const lease = sender.acquire();
	assert.ok(lease, 'the pool should still have credit');
	return lease;
}

function mustConsume(receiver: NativeRealtimeReceiver): NativeRealtimeAudioMessage {
	const packet = receiver.consume();
	assert.ok(packet, 'the receiver should hold a queued packet');
	return packet;
}

/** Writes an exactly representable ramp so a round trip proves the samples survived. */
function fill(lease: NativeRealtimePacketLease, seed: number): void {
	for (const [index, channel] of lease.channels().entries()) {
		for (let frame = 0; frame < channel.length; frame += 1) channel[frame] = seed * 100 + index * 10 + frame;
	}
}

function pump(loop: Loop, seed: number, frameCount?: number): NativeRealtimeAudioMessage {
	const lease = mustAcquire(loop.sender);
	fill(lease, seed);
	const sent = loop.sender.send(lease, frameCount);
	loop.receiver.accept(sent.message);
	return sent.message;
}

function drain(loop: Loop): void {
	const packet = mustConsume(loop.receiver);
	loop.sender.acceptReturn(loop.receiver.returnPacket(packet).message);
}

function hasCode(code: NativeRealtimeErrorCode): (error: unknown) => boolean {
	return (error: unknown) => error instanceof NativeRealtimeProtocolError && error.code === code;
}

function openWire(overrides: Wire = {}): Wire {
	return {
		protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION, kind: 'open', generation: 1, startFrame: 0,
		channelCount: CHANNELS, frameCount: FRAMES, queueCapacity: 4, ...overrides,
	};
}

function audioWire(overrides: Wire = {}): Wire {
	return {
		protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION, kind: 'audio', generation: 1, packetId: 0,
		sequence: 0, startFrame: 0, frameCount: FRAMES,
		channels: [new Float32Array(FRAMES), new Float32Array(FRAMES)], ...overrides,
	};
}

function returnWire(overrides: Wire = {}): Wire {
	return {
		protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION, kind: 'return', generation: 1, packetId: 0,
		channels: [new Float32Array(FRAMES), new Float32Array(FRAMES)], ...overrides,
	};
}

test('the protocol pins its version, packet vocabulary and close reasons', () => {
	assert.equal(NATIVE_REALTIME_PROTOCOL_VERSION, 1);
	assert.equal(NATIVE_REALTIME_PACKET_FRAMES, 1_024);
	assert.equal(NATIVE_REALTIME_MAX_QUEUE_PACKETS, 64);
	assert.deepEqual([...NATIVE_REALTIME_CLOSE_REASONS], [
		'completed', 'cancelled', 'underrun', 'non-contiguous',
		'queue-overflow', 'pool-leak', 'peer-loss', 'protocol-violation',
	]);
	// Offline work retries from the plan; real-time work must never replay.
	assert.equal(NATIVE_REALTIME_REPLAY_POLICY.realtime, 'never');
	assert.equal(NATIVE_REALTIME_REPLAY_POLICY.offline, 'retry-from-canonical-plan');
});

test('a generation streams contiguous packets and returns every buffer', () => {
	const loop = createLoop();
	assert.equal(loop.receiver.nextExpectedFrame, 0);
	for (let index = 0; index < 6; index += 1) {
		const message = pump(loop, index + 1);
		assert.equal(message.sequence, index);
		assert.equal(message.startFrame, index * FRAMES);
		const packet = mustConsume(loop.receiver);
		assert.equal(packet.channels[1][2], (index + 1) * 100 + 10 + 2);
		loop.sender.acceptReturn(loop.receiver.returnPacket(packet).message);
	}
	assert.equal(loop.receiver.nextExpectedFrame, 6 * FRAMES);
	assert.equal(loop.sender.nextFrame, 6 * FRAMES);
	assert.equal(loop.pool.availableCount, 4);
	assert.equal(loop.pool.inFlightCount, 0);
	assert.equal(loop.pool.allocationCount, 4 * CHANNELS);
	assert.equal(loop.receiver.state, 'open');
});

test('the pool is fixed: acquire returns null when empty and reuses the exact buffers', () => {
	const loop = createLoop({ capacity: 3 });
	const leases: NativeRealtimePacketLease[] = [];
	for (let index = 0; index < 3; index += 1) leases.push(mustAcquire(loop.sender));
	assert.equal(loop.sender.acquire(), null);
	assert.equal(loop.pool.acquire(), null);
	assert.equal(loop.pool.availableCount, 0);
	assert.equal(loop.pool.allocationCount, 3 * CHANNELS);

	const buffers = leases[2].channels().map((channel) => channel.buffer);
	loop.receiver.accept(loop.sender.send(leases[2]).message);
	drain(loop);
	const reused = mustAcquire(loop.sender);
	assert.equal(reused.packetId, leases[2].packetId);
	assert.deepEqual(reused.channels().map((channel) => channel.buffer), buffers);
	for (const [index, channel] of reused.channels().entries()) {
		assert.equal(channel.buffer, buffers[index], 'the pool must hand back the same ArrayBuffer');
		assert.equal(channel.length, FRAMES);
	}
	// Not one byte more was allocated across exhaustion, transfer and reuse.
	assert.equal(loop.pool.allocationCount, 3 * CHANNELS);
});

test('a returned buffer is the only credit for another send', () => {
	const loop = createLoop({ capacity: 2 });
	const first = mustAcquire(loop.sender);
	const second = mustAcquire(loop.sender);
	loop.receiver.accept(loop.sender.send(first).message);
	loop.receiver.accept(loop.sender.send(second).message);
	assert.equal(loop.sender.credit, 0);
	assert.equal(loop.sender.inFlightCount, 2);
	assert.equal(loop.sender.acquire(), null, 'a sender with no credit cannot obtain a packet');
	assert.throws(() => loop.sender.send(first), hasCode('STALE_REPLAY'));

	drain(loop);
	assert.equal(loop.sender.credit, 1);
	const third = mustAcquire(loop.sender);
	assert.equal(loop.sender.credit, 0);
	assert.equal(third.packetId, first.packetId);
	loop.pool.recycle(third);
	assert.equal(loop.sender.credit, 1);
});

test('a sent packet is detached and can never be read or resent by the sender', () => {
	const loop = createLoop();
	const lease = mustAcquire(loop.sender);
	fill(lease, 9);
	assert.equal(lease.detached, false);
	const sent = loop.sender.send(lease);
	assert.equal(lease.detached, true);
	assert.throws(() => lease.channels(), hasCode('PACKET_DETACHED'));
	assert.throws(() => loop.sender.send(lease), hasCode('STALE_REPLAY'));
	assert.equal(sent.transfer.length, CHANNELS);
	assert.ok(sent.transfer.every((buffer) => buffer instanceof ArrayBuffer));
});

test('a real structuredClone transfer moves ownership and the pool re-adopts what comes back', () => {
	const loop = createLoop();
	const lease = mustAcquire(loop.sender);
	fill(lease, 5);
	const source = lease.channels()[0];
	const sent = loop.sender.send(lease);
	const wire = structuredClone(sent.message, { transfer: [...sent.transfer] });

	assert.equal(source.byteLength, 0, 'the transferred buffer must be detached at the source');
	assert.throws(() => lease.channels(), hasCode('PACKET_DETACHED'));
	assert.equal(loop.receiver.accept(wire).status, 'queued');
	const packet = mustConsume(loop.receiver);
	assert.equal(packet.channels[0][3], 5 * 100 + 3);
	loop.sender.acceptReturn(loop.receiver.returnPacket(packet).message);
	assert.equal(loop.pool.availableCount, 4);
	assert.equal(loop.pool.allocationCount, 4 * CHANNELS);
	const reused = mustAcquire(loop.sender);
	assert.equal(reused.channels()[0].length, FRAMES);
});

test('a short final packet round trips and the pool restores a full-length view', () => {
	const loop = createLoop();
	const message = pump(loop, 1, 3);
	assert.equal(message.frameCount, 3);
	assert.equal(message.channels[0].length, 3);
	assert.equal(loop.receiver.nextExpectedFrame, 3);
	drain(loop);
	const reused = mustAcquire(loop.sender);
	assert.equal(reused.channels()[0].length, FRAMES);
	assert.equal(loop.pool.allocationCount, 4 * CHANNELS);
});

test('a non-contiguous packet closes the generation exactly once', () => {
	const loop = createLoop();
	pump(loop, 1);
	const outcome = loop.receiver.accept(audioWire({ sequence: 1, startFrame: FRAMES + 1 }));
	assert.equal(outcome.status, 'closed');
	assert.equal(outcome.reason, 'non-contiguous');
	assert.equal(outcome.error?.field, 'startFrame');
	assert.equal(loop.receiver.state, 'closed');
	assert.equal(loop.receiver.closeReason, 'non-contiguous');
	assert.deepEqual(loop.receiverCloses, [{ generation: 1, reason: 'non-contiguous' }]);

	// Every later cause is a no-op and never overwrites the recorded reason.
	assert.equal(loop.receiver.reportUnderrun(), null);
	assert.equal(loop.receiver.close('cancelled'), null);
	assert.equal(loop.receiver.accept(audioWire({ sequence: 1, startFrame: FRAMES })).status, 'ignored');
	assert.equal(loop.receiver.closeReason, 'non-contiguous');
	assert.equal(loop.receiverCloses.length, 1);
});

test('concurrent close causes still close a generation exactly once', () => {
	const loop = createLoop({ capacity: 2, queueCapacity: 2 });
	pump(loop, 1);
	pump(loop, 2);
	// Overflow and a peer close race for the same generation.
	const overflow = loop.receiver.accept(audioWire({ sequence: 2, startFrame: 2 * FRAMES }));
	assert.equal(overflow.reason, 'queue-overflow');
	const peer = loop.receiver.accept({
		protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION, kind: 'close', generation: 1, reason: 'peer-loss',
	});
	assert.equal(peer.status, 'ignored');
	assert.equal(loop.receiver.closeReason, 'queue-overflow');
	assert.equal(loop.receiverCloses.length, 1);

	loop.sender.close('cancelled');
	assert.equal(loop.sender.close('completed'), null);
	assert.equal(loop.sender.closeReason, 'cancelled');
	assert.equal(loop.senderCloses.length, 1);
	assert.equal(loop.sender.credit, 0);
	assert.equal(loop.sender.acquire(), null);
	// A closed sender still drains returns, so its pool is never stranded.
	loop.sender.acceptReturn(loop.receiver.returnPacket(mustConsume(loop.receiver)).message);
	assert.equal(loop.pool.availableCount, 1);
	const spare = loop.pool.acquire();
	assert.ok(spare);
	assert.throws(() => loop.sender.send(spare), hasCode('CLOSED_GENERATION'));
});

test('a deeper queue than the sender pool is refused, and overflow closes the receiver', () => {
	const pool = createNativeRealtimePacketPool({ capacity: 4, channelCount: CHANNELS, frameCount: FRAMES });
	assert.throws(
		() => createNativeRealtimeSender({ pool, generation: 1, queueCapacity: 2 }),
		/must not be deeper than the receiver queue/u,
	);
	const receiver = createNativeRealtimeReceiver({ channelCount: CHANNELS, frameCount: FRAMES });
	receiver.accept(openWire({ queueCapacity: 2 }));
	assert.equal(receiver.accept(audioWire({ sequence: 0, startFrame: 0 })).status, 'queued');
	assert.equal(receiver.accept(audioWire({ sequence: 1, startFrame: FRAMES })).status, 'queued');
	const overflow = receiver.accept(audioWire({ sequence: 2, startFrame: 2 * FRAMES }));
	assert.equal(overflow.status, 'closed');
	assert.equal(overflow.reason, 'queue-overflow');
	assert.equal(receiver.queuedPackets, 2);
});

test('a newer generation cancels the old one and stale packets can never satisfy it', () => {
	const closes: NativeRealtimeCloseEvent[] = [];
	const receiver = createNativeRealtimeReceiver({
		channelCount: CHANNELS, frameCount: FRAMES, onClose: (event) => closes.push(event),
	});
	receiver.accept(openWire({ generation: 1, startFrame: 0 }));
	assert.equal(receiver.accept(audioWire({ generation: 1, sequence: 0, startFrame: 0 })).status, 'queued');
	assert.equal(receiver.queuedPackets, 1);

	assert.equal(receiver.accept(openWire({ generation: 2, startFrame: 4_096 })).status, 'opened');
	assert.deepEqual(closes, [{ generation: 1, reason: 'cancelled' }]);
	assert.equal(receiver.queuedPackets, 0, 'the old generation queue is dropped, not replayed');
	assert.equal(receiver.nextExpectedFrame, 4_096);

	const stale = receiver.accept(audioWire({ generation: 1, sequence: 0, startFrame: 0 }));
	assert.equal(stale.status, 'discarded');
	assert.equal(stale.detail, 'stale-generation');
	assert.equal(receiver.queuedPackets, 0);
	assert.equal(receiver.nextExpectedFrame, 4_096, 'a stale packet never advances a newer generation');
	assert.equal(receiver.state, 'open');

	const foreign = receiver.accept(audioWire({ generation: 7, sequence: 0, startFrame: 4_096 }));
	assert.equal(foreign.detail, 'foreign-generation');
	assert.equal(receiver.accept(openWire({ generation: 2 })).detail, 'stale-open');
	assert.equal(receiver.accept(openWire({ generation: 3, queueCapacity: NATIVE_REALTIME_MAX_QUEUE_PACKETS + 1 })).status, 'closed');
	assert.equal(receiver.discardedPacketCount, 3);
});

test('an open the receiver cannot honour is refused without closing the running generation', () => {
	const receiver = createNativeRealtimeReceiver({ channelCount: 2, frameCount: FRAMES, queueCapacity: 4 });
	receiver.accept(openWire({ generation: 1 }));
	assert.equal(receiver.accept(openWire({ generation: 2, channelCount: 8 })).detail, 'rejected-open');
	assert.equal(receiver.accept(openWire({ generation: 3, frameCount: FRAMES * 4 })).detail, 'rejected-open');
	assert.equal(receiver.accept(openWire({ generation: 4, queueCapacity: 8 })).detail, 'rejected-open');
	assert.equal(receiver.generation, 1);
	assert.equal(receiver.state, 'open');
});

test('replayed audio closes the generation instead of playing late', () => {
	const loop = createLoop();
	const message = pump(loop, 1);
	const replay = loop.receiver.accept({ ...message, channels: [...message.channels] });
	assert.equal(replay.status, 'closed');
	assert.equal(replay.reason, 'protocol-violation');
	assert.equal(replay.error?.code, 'STALE_REPLAY');
	assert.equal(loop.receiverCloses.length, 1);
});

test('an unaccountable return closes the sender with pool-leak', () => {
	const loop = createLoop();
	pump(loop, 1);
	const packet = mustConsume(loop.receiver);
	const returned = loop.receiver.returnPacket(packet);
	loop.sender.acceptReturn(returned.message);
	assert.equal(loop.pool.availableCount, 4);

	// A second return of the same packet would duplicate a pool buffer.
	assert.throws(() => loop.receiver.returnPacket(packet), hasCode('POOL_LEDGER'));
	loop.sender.acceptReturn(returned.message);
	assert.equal(loop.sender.closeReason, 'pool-leak');
	assert.deepEqual(loop.senderCloses, [{ generation: 1, reason: 'pool-leak' }]);
	loop.sender.acceptReturn(returned.message);
	assert.equal(loop.senderCloses.length, 1);
});

test('a buffer that never comes home trips the pool-leak deadline', () => {
	let clock = 0;
	const loop = createLoop({ now: () => clock, leaseTimeoutMs: 100 });
	pump(loop, 1);
	clock = 100;
	loop.sender.auditPool();
	assert.equal(loop.sender.closed, false);
	clock = 101;
	loop.sender.auditPool();
	assert.equal(loop.sender.closeReason, 'pool-leak');
	assert.equal(loop.senderCloses.length, 1);
	loop.sender.auditPool();
	assert.equal(loop.senderCloses.length, 1);
});

test('the pool ledger rejects returns it cannot account for', () => {
	const pool = createNativeRealtimePacketPool({ capacity: 2, channelCount: CHANNELS, frameCount: FRAMES });
	const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
	assert.throws(() => pool.release(0, channels), hasCode('POOL_LEDGER'));
	assert.throws(() => pool.release(5, channels), hasCode('INVALID_FIELD'));
	const lease = pool.acquire();
	assert.ok(lease);
	assert.throws(() => pool.release(lease.packetId, channels), hasCode('POOL_LEDGER'));
	const sender = createNativeRealtimeSender({ pool, generation: 1 });
	sender.send(lease);
	assert.throws(() => pool.release(lease.packetId, [new Float32Array(FRAMES)]), hasCode('POOL_LEDGER'));
	assert.throws(() => pool.release(lease.packetId, [new Float32Array(2), new Float32Array(2)]), hasCode('POOL_LEDGER'));
	assert.throws(() => pool.recycle(lease), hasCode('POOL_LEDGER'));
	assert.equal(pool.inFlightCount, 1);
});

test('a sender requires a pool built by this module', () => {
	const foreign = { capacity: 1, channelCount: 1, frameCount: FRAMES, availableCount: 1 };
	assert.throws(
		() => createNativeRealtimeSender({ pool: foreign as never, generation: 1 }),
		/requires a pool from createNativeRealtimePacketPool/u,
	);
});

test('the receiver never accepts a return message and refuses malformed control data', () => {
	const loop = createLoop();
	const outcome = loop.receiver.accept(returnWire());
	assert.equal(outcome.reason, 'protocol-violation');
	assert.equal(outcome.error?.code, 'UNKNOWN_KIND');

	const other = createLoop();
	const rejected = other.receiver.accept({ protocolVersion: 2, kind: 'audio' });
	assert.equal(rejected.status, 'closed');
	assert.equal(rejected.error?.code, 'PROTOCOL_VERSION');
	assert.equal(other.receiverCloses.length, 1);
});

test('the sender treats a malformed or misdirected return as a protocol violation', () => {
	const loop = createLoop();
	loop.sender.acceptReturn({ protocolVersion: 99, kind: 'return' });
	assert.equal(loop.sender.closeReason, 'protocol-violation');

	const second = createLoop();
	second.sender.acceptReturn(audioWire());
	assert.equal(second.sender.closeReason, 'protocol-violation');

	const third = createLoop();
	pump(third, 1);
	third.sender.acceptReturn(returnWire({ generation: 4 }));
	assert.equal(third.sender.closed, false, 'a foreign-generation return is ignored, not fatal');
	assert.equal(third.pool.inFlightCount, 1);
});

test('the closed schema rejects every malformed wire message', () => {
	const accessor: Wire = audioWire();
	Object.defineProperty(accessor, 'sequence', { get: () => 0, enumerable: true, configurable: true });
	const missing: Wire = audioWire();
	delete missing.sequence;
	const symbolKeyed: Wire = audioWire();
	Object.defineProperty(symbolKeyed, Symbol('extra'), { value: 1, enumerable: true });

	const cases: readonly (readonly [string, unknown, NativeRealtimeErrorCode])[] = [
		['not an object', 'audio', 'INVALID_FIELD'],
		['null', null, 'INVALID_FIELD'],
		['array', [], 'INVALID_FIELD'],
		['class instance', new (class Message { protocolVersion = 1 })(), 'INVALID_FIELD'],
		['wrong protocol version', audioWire({ protocolVersion: 2 }), 'PROTOCOL_VERSION'],
		['missing protocol version', { kind: 'audio' }, 'INVALID_FIELD'],
		['unknown kind', audioWire({ kind: 'video' }), 'UNKNOWN_KIND'],
		['unknown key', { ...audioWire(), sampleRate: 48_000 }, 'UNKNOWN_KEY'],
		['symbol key', symbolKeyed, 'UNKNOWN_KEY'],
		['missing field', missing, 'INVALID_FIELD'],
		['accessor field', accessor, 'INVALID_FIELD'],
		['non-finite number', audioWire({ startFrame: Number.NaN }), 'INVALID_FIELD'],
		['infinite number', audioWire({ generation: Number.POSITIVE_INFINITY }), 'INVALID_FIELD'],
		['fractional frame', audioWire({ startFrame: 1.5 }), 'INVALID_FIELD'],
		['negative packet id', audioWire({ packetId: -1 }), 'INVALID_FIELD'],
		['out-of-range generation', audioWire({ generation: 0x1_0000_0000 }), 'INVALID_FIELD'],
		['numeric string', audioWire({ frameCount: '8' }), 'INVALID_FIELD'],
		['zero frame count', audioWire({ frameCount: 0 }), 'INVALID_FIELD'],
		['channels not an array', audioWire({ channels: new Float32Array(FRAMES) }), 'INVALID_FIELD'],
		['channels empty', audioWire({ channels: [] }), 'INVALID_FIELD'],
		['channel not planar float', audioWire({ channels: [new Float64Array(FRAMES), new Float32Array(FRAMES)] }), 'INVALID_FIELD'],
		['channel length mismatch', audioWire({ channels: [new Float32Array(FRAMES), new Float32Array(2)] }), 'INVALID_FIELD'],
		['too many channels', audioWire({ channels: Array.from({ length: 33 }, () => new Float32Array(FRAMES)), frameCount: FRAMES }), 'INVALID_FIELD'],
		['unknown close reason', { protocolVersion: 1, kind: 'close', generation: 1, reason: 'bored' }, 'INVALID_FIELD'],
		['oversize control string', audioWire({ kind: 'x'.repeat(30_000) }), 'PAYLOAD_TOO_LARGE'],
		['control key explosion', Object.fromEntries(Array.from({ length: 9_000 }, (_unused, index) => [`k${index}`, index])), 'PAYLOAD_TOO_LARGE'],
	];

	for (const [label, message, code] of cases) {
		assert.throws(() => validateNativeRealtimeMessage(message), hasCode(code), label);
	}
});

test('the schema accepts every well-formed message this module emits', () => {
	const loop = createLoop();
	const open = validateNativeRealtimeMessage(loop.sender.openMessage());
	assert.equal(open.kind, 'open');
	const sent = pump(loop, 1);
	const audio = validateNativeRealtimeMessage(sent);
	assert.equal(audio.kind, 'audio');
	assert.equal(validateNativeRealtimeMessage(validateNativeRealtimeMessage(sent)).kind, 'audio');
	const returned = loop.receiver.returnPacket(mustConsume(loop.receiver)).message;
	assert.equal(validateNativeRealtimeMessage(returned).kind, 'return');
	const closed = loop.sender.close('completed');
	assert.ok(closed);
	assert.equal(validateNativeRealtimeMessage(closed).kind, 'close');
	assert.throws(() => loop.receiver.close('exploded' as never), hasCode('INVALID_FIELD'));
});

test('shared memory is refused at the schema boundary', () => {
	const shared = new SharedArrayBuffer(FRAMES * Float32Array.BYTES_PER_ELEMENT);
	const channels = [new Float32Array(shared), new Float32Array(FRAMES)];
	assert.throws(() => validateNativeRealtimeMessage(audioWire({ channels })), hasCode('SHARED_MEMORY_FORBIDDEN'));
	assert.throws(() => transferListForNativeRealtimeChannels(channels), hasCode('SHARED_MEMORY_FORBIDDEN'));
});

test('no sender or receiver path constructs a SharedArrayBuffer', () => {
	const original = globalThis.SharedArrayBuffer;
	let constructed = 0;
	class ForbiddenSharedArrayBuffer {
		constructor() {
			constructed += 1;
			throw new Error('The native real-time transport must never allocate shared memory.');
		}

		static [Symbol.hasInstance](): boolean { return false; }
	}
	Object.defineProperty(globalThis, 'SharedArrayBuffer', { value: ForbiddenSharedArrayBuffer, configurable: true, writable: true });
	try {
		const loop = createLoop();
		for (let index = 0; index < 5; index += 1) {
			pump(loop, index);
			drain(loop);
		}
		const lease = mustAcquire(loop.sender);
		for (const channel of lease.channels()) {
			assert.ok(channel.buffer instanceof ArrayBuffer);
			assert.ok(!(channel.buffer instanceof original));
		}
		loop.pool.recycle(lease);
		loop.sender.close('completed');
	} finally {
		Object.defineProperty(globalThis, 'SharedArrayBuffer', { value: original, configurable: true, writable: true });
	}
	assert.equal(constructed, 0);
});

test('a default-shaped pool uses the existing 1024-frame planar vocabulary', () => {
	const pool = createNativeRealtimePacketPool({ capacity: 2, channelCount: CHANNELS });
	const sender = createNativeRealtimeSender({ pool, generation: 0, startFrame: 44_100 });
	const receiver = createNativeRealtimeReceiver({ channelCount: CHANNELS });
	assert.equal(pool.frameCount, NATIVE_REALTIME_PACKET_FRAMES);
	const open = sender.openMessage();
	assert.equal(open.frameCount, NATIVE_REALTIME_PACKET_FRAMES);
	assert.equal(open.startFrame, 44_100);
	assert.equal(receiver.accept(open).status, 'opened');
	const lease = sender.acquire();
	assert.ok(lease);
	assert.equal(lease.capacityFrames, NATIVE_REALTIME_PACKET_FRAMES);
	assert.equal(lease.channelCount, CHANNELS);
	const sent = sender.send(lease);
	assert.equal(sent.message.startFrame, 44_100);
	assert.equal(receiver.accept(sent.message).status, 'queued');
	assert.equal(receiver.nextExpectedFrame, 44_100 + NATIVE_REALTIME_PACKET_FRAMES);
	assert.equal(sender.replayPolicy, 'never');
	assert.equal(receiver.reportUnderrun()?.reason, 'underrun');
	assert.equal(receiver.reportUnderrun(), null);
	assert.equal(receiver.closeReason, 'underrun');
});

test('an idle receiver has nothing to close and discards packets that precede an open', () => {
	const receiver = createNativeRealtimeReceiver({ channelCount: CHANNELS, frameCount: FRAMES });
	assert.equal(receiver.state, 'idle');
	assert.equal(receiver.generation, null);
	assert.equal(receiver.nextExpectedFrame, null);
	assert.equal(receiver.close('cancelled'), null);
	assert.equal(receiver.reportUnderrun(), null);
	assert.equal(receiver.consume(), null);
	assert.equal(receiver.accept(audioWire()).detail, 'foreign-generation');
	assert.equal(receiver.discardedPacketCount, 1);
	assert.throws(() => receiver.returnPacket(audioWire() as unknown as NativeRealtimeAudioMessage), hasCode('POOL_LEDGER'));
});

test('a packet whose shape contradicts its open generation closes the generation', () => {
	const receiver = createNativeRealtimeReceiver({ channelCount: 4, frameCount: FRAMES });
	receiver.accept(openWire({ channelCount: 2 }));
	const outcome = receiver.accept(audioWire({ channels: [new Float32Array(FRAMES)] }));
	assert.equal(outcome.reason, 'protocol-violation');
	assert.equal(outcome.error?.field, 'channels');
});

test('pool and transport options are bounded', () => {
	assert.throws(() => createNativeRealtimePacketPool({ capacity: 0, channelCount: 2 }), hasCode('INVALID_FIELD'));
	assert.throws(() => createNativeRealtimePacketPool({ capacity: 1, channelCount: 64 }), hasCode('INVALID_FIELD'));
	assert.throws(() => createNativeRealtimePacketPool({ capacity: 1, channelCount: 2, frameCount: 0 }), hasCode('INVALID_FIELD'));
	assert.throws(() => createNativeRealtimeReceiver({ channelCount: 0 }), hasCode('INVALID_FIELD'));
	const pool = createNativeRealtimePacketPool({ capacity: 1, channelCount: 1 });
	assert.throws(() => createNativeRealtimeSender({ pool, generation: -1 }), hasCode('INVALID_FIELD'));
	assert.throws(() => createNativeRealtimeSender({ pool, generation: 1, leaseTimeoutMs: 0 }), hasCode('INVALID_FIELD'));
	const sender = createNativeRealtimeSender({ pool, generation: 1 });
	const lease = sender.acquire();
	assert.ok(lease);
	assert.throws(() => sender.send(lease, NATIVE_REALTIME_PACKET_FRAMES + 1), hasCode('INVALID_FIELD'));
	assert.throws(() => sender.send(lease, 0), hasCode('INVALID_FIELD'));
});
