/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	NATIVE_REALTIME_PACKET_FRAMES,
	NATIVE_REALTIME_MAX_GENERATION,
	NATIVE_REALTIME_MAX_QUEUE_PACKETS,
	NATIVE_REALTIME_PROTOCOL_VERSION,
	NATIVE_REALTIME_REPLAY_POLICY,
	NativeRealtimeProtocolError,
	asNativeRealtimeError as asProtocolError,
	assertOrdinaryNativeRealtimeBuffer as assertOrdinaryBuffer,
	boundedNativeRealtimeInteger as boundedInteger,
	describeNativeRealtimeValue as describe,
	isNativeRealtimeCloseReason as isCloseReason,
	nativeRealtimeError as fail,
	transferListForNativeRealtimeChannels,
	validateNativeRealtimeMessage,
	type NativeRealtimeAudioMessage,
	type NativeRealtimeCloseEvent,
	type NativeRealtimeCloseMessage,
	type NativeRealtimeCloseReason,
	type NativeRealtimeMessage,
	type NativeRealtimeOpenMessage,
	type NativeRealtimePacketDispatch,
	type NativeRealtimeReturnMessage,
	type NativeRealtimeTransfer,
} from './native-realtime-protocol.ts';
import { PLATFORM_TRANSFER_HARD_LIMITS } from './platform/bounded-transfer.ts';

/**
 * The milestone 5A real-time data plane: a supervised native helper and an
 * AudioWorklet exchange planar float packets over a directly transferred
 * MessagePort, with renderer main present only for setup and revocation.
 * Sample memory is allocated once, when the pool is built: the audio callback
 * drains an already queued packet without allocating, and the control path
 * costs only the bounded envelope it validates. The wire vocabulary and its
 * validator live in native-realtime-protocol.ts and are re-exported here, so a
 * consumer only ever imports this module.
 */

export {
	NATIVE_REALTIME_CLOSE_REASONS,
	NATIVE_REALTIME_ERROR_CODES,
	NATIVE_REALTIME_MAX_GENERATION,
	NATIVE_REALTIME_MAX_QUEUE_PACKETS,
	NATIVE_REALTIME_PACKET_FRAMES,
	NATIVE_REALTIME_PROTOCOL_VERSION,
	NATIVE_REALTIME_REPLAY_POLICY,
	NativeRealtimeProtocolError,
	transferListForNativeRealtimeChannels,
	validateNativeRealtimeMessage,
} from './native-realtime-protocol.ts';
export type {
	NativeRealtimeAudioMessage,
	NativeRealtimeCloseEvent,
	NativeRealtimeCloseMessage,
	NativeRealtimeCloseReason,
	NativeRealtimeErrorCode,
	NativeRealtimeMessage,
	NativeRealtimeOpenMessage,
	NativeRealtimePacketDispatch,
	NativeRealtimeReturnMessage,
	NativeRealtimeTransfer,
} from './native-realtime-protocol.ts';

const BYTES_PER_SAMPLE = Float32Array.BYTES_PER_ELEMENT;

export interface NativeRealtimePacketLease {
	readonly packetId: number; readonly channelCount: number; readonly capacityFrames: number; readonly detached: boolean;
	/** Throws once the packet is transferred; ownership has left this end. */
	channels(): readonly Float32Array[];
}

export type NativeRealtimePacketPoolOptions = Readonly<{ capacity: number; channelCount: number; frameCount?: number }>;

interface MutableLease extends NativeRealtimePacketLease { detached: boolean }

interface PoolSlot {
	readonly packetId: number; channels: Float32Array[]; state: 'free' | 'leased' | 'in-flight';
	lease: MutableLease | null; sentAt: number; sentGeneration: number; sentSequence: number;
}

interface PoolState {
	readonly slots: readonly PoolSlot[]; readonly free: number[];
	readonly capacityFrames: number; readonly channelCount: number;
	readonly allocationCount: number; inFlightCount: number;
}

const POOL_STATE = new WeakMap<object, PoolState>();

/**
 * Allocates every packet the transport will ever use. `acquire` returns null on
 * an empty pool instead of growing, because a pool that allocates under
 * pressure hides the starvation this milestone exists to measure; a buffer
 * coming home is therefore the only credit for another send.
 */
export function createNativeRealtimePacketPool(options: NativeRealtimePacketPoolOptions) {
	const capacity = boundedInteger(options.capacity, 'capacity', 1, NATIVE_REALTIME_MAX_QUEUE_PACKETS);
	const channelCount = boundedInteger(options.channelCount, 'channelCount', 1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkChannels);
	const capacityFrames = boundedInteger(options.frameCount ?? NATIVE_REALTIME_PACKET_FRAMES, 'frameCount', 1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames);
	const slots: PoolSlot[] = [];
	const free: number[] = [];
	for (let packetId = 0; packetId < capacity; packetId += 1) {
		const channels = Array.from({ length: channelCount }, () => new Float32Array(capacityFrames));
		slots.push({ packetId, channels, state: 'free', lease: null, sentAt: 0, sentGeneration: -1, sentSequence: -1 });
		free.push(packetId);
	}
	const state: PoolState = { slots, free, capacityFrames, channelCount, allocationCount: capacity * channelCount, inFlightCount: 0 };
	const pool = {
		capacity,
		channelCount,
		frameCount: capacityFrames,
		get availableCount(): number { return state.free.length; },
		get inFlightCount(): number { return state.inFlightCount; },
		/** Sample buffers allocated over this pool's whole life: one per channel per packet, and never another. */
		get allocationCount(): number { return state.allocationCount; },
		acquire(): NativeRealtimePacketLease | null {
			const packetId = state.free.pop();
			if (packetId === undefined) return null;
			const slot = state.slots[packetId];
			slot.state = 'leased';
			slot.lease = createLease(slot, channelCount, capacityFrames);
			return slot.lease;
		},
		/** Hands an acquired but never-sent lease straight back. */
		recycle(lease: NativeRealtimePacketLease): void {
			const slot = slotForLease(state, lease, 'leased');
			slot.lease = null;
			slot.state = 'free';
			state.free.push(slot.packetId);
		},
		/**
		 * A buffer belongs to the pool rather than to the generation that sent
		 * it, so a late return still restores credit and a cancelled generation
		 * cannot strand the pool it borrowed from. The return must name the
		 * exact dispatch it acknowledges: a duplicate would otherwise credit a
		 * packet that is legitimately in flight again, and the pool would hand
		 * the same memory to a second writer.
		 */
		release(dispatch: NativeRealtimePacketDispatch): void {
			const slot = state.slots[boundedInteger(dispatch.packetId, 'packetId', 0, capacity - 1)];
			if (slot.state !== 'in-flight' || slot.sentGeneration !== dispatch.generation || slot.sentSequence !== dispatch.sequence) {
				throw fail('POOL_LEDGER', `Packet ${dispatch.packetId} does not match a dispatch that is in flight.`, 'packetId');
			}
			slot.channels = adoptReturnedChannels(dispatch.channels, state);
			slot.state = 'free';
			slot.lease = null;
			state.inFlightCount -= 1;
			state.free.push(slot.packetId);
		},
	};
	POOL_STATE.set(pool, state);
	return pool;
}

export type NativeRealtimePacketPool = ReturnType<typeof createNativeRealtimePacketPool>;

function createLease(slot: PoolSlot, channelCount: number, capacityFrames: number): MutableLease {
	const lease: MutableLease = {
		packetId: slot.packetId, channelCount, capacityFrames, detached: false,
		channels() {
			if (lease.detached) throw fail('PACKET_DETACHED', `Packet ${slot.packetId} was transferred; this end no longer owns its buffers.`);
			return slot.channels;
		},
	};
	return lease;
}

function slotForLease(state: PoolState, lease: NativeRealtimePacketLease, expected: PoolSlot['state']): PoolSlot {
	const slot = state.slots[lease.packetId];
	if (!slot || slot.lease !== lease || slot.state !== expected) throw fail('POOL_LEDGER', `Packet ${String(lease.packetId)} is not ${expected} in this pool.`);
	return slot;
}

/**
 * Re-adopts the buffers a peer handed back. Transfer destroys object identity,
 * so the pool can only insist on its own shape: one whole buffer per channel,
 * and never two channels over one buffer, which would silently cost it a buffer
 * and leave the survivors aliased. A view that already spans its buffer is kept
 * as-is, so the steady state allocates nothing; only a short final packet costs
 * one view object, and never a new ArrayBuffer.
 */
function adoptReturnedChannels(channels: readonly Float32Array[], state: PoolState): Float32Array[] {
	if (channels.length !== state.channelCount) throw fail('POOL_LEDGER', `A returned packet must carry ${state.channelCount} channels.`, 'channels');
	const bytes = state.capacityFrames * BYTES_PER_SAMPLE;
	const adopted: Float32Array[] = [];
	for (const [index, channel] of channels.entries()) {
		const field = `channels[${index}]`;
		assertOrdinaryBuffer(channel.buffer, field);
		if (channel.buffer.byteLength !== bytes) throw fail('POOL_LEDGER', `${field} is not a pool buffer of ${bytes} bytes.`, field);
		for (const seen of adopted) {
			if (seen.buffer === channel.buffer) throw fail('POOL_LEDGER', `${field} aliases another returned channel.`, field);
		}
		adopted.push(channel.byteOffset === 0 && channel.length === state.capacityFrames ? channel : new Float32Array(channel.buffer));
	}
	return adopted;
}

interface CloseLifecycle {
	readonly closed: boolean; readonly reason: NativeRealtimeCloseReason | null;
	close(reason: NativeRealtimeCloseReason): boolean;
}

/**
 * The first cause wins. Every later cause — including the peer's own close
 * message echoing back — is a no-op, so a generation never closes twice and its
 * recorded reason is never overwritten by a downstream symptom.
 */
function createCloseLifecycle(generation: number, onClose: ((event: NativeRealtimeCloseEvent) => void) | undefined): CloseLifecycle {
	let reason: NativeRealtimeCloseReason | null = null;
	return {
		get closed() { return reason !== null; },
		get reason() { return reason; },
		close(next) {
			if (reason !== null) return false;
			if (!isCloseReason(next)) throw fail('INVALID_FIELD', `${describe(next)} is not a close reason.`, 'reason');
			reason = next;
			onClose?.(Object.freeze({ generation, reason: next }));
			return true;
		},
	};
}

function closeMessage(generation: number, reason: NativeRealtimeCloseReason): NativeRealtimeCloseMessage {
	return Object.freeze({ protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION, kind: 'close' as const, generation, reason });
}

export interface NativeRealtimeSenderOptions {
	readonly pool: NativeRealtimePacketPool; readonly generation: number;
	readonly startFrame?: number; readonly queueCapacity?: number; readonly leaseTimeoutMs?: number;
	readonly now?: () => number; readonly onClose?: (event: NativeRealtimeCloseEvent) => void;
}

/**
 * The helper side of one generation. Credit is the pool itself: a send consumes
 * a slot and only the peer handing that buffer back restores it, so a sender
 * with no credit has nothing to send and cannot outrun the queue depth the
 * receiver agreed to in the open message.
 */
export function createNativeRealtimeSender(options: NativeRealtimeSenderOptions) {
	const pool = options.pool;
	const state = POOL_STATE.get(pool);
	if (!state) throw new TypeError('A native real-time sender requires a pool from createNativeRealtimePacketPool().');
	const generation = boundedInteger(options.generation, 'generation', 0, NATIVE_REALTIME_MAX_GENERATION);
	const startFrame = boundedInteger(options.startFrame ?? 0, 'startFrame', 0, Number.MAX_SAFE_INTEGER);
	const queueCapacity = boundedInteger(options.queueCapacity ?? pool.capacity, 'queueCapacity', 1, NATIVE_REALTIME_MAX_QUEUE_PACKETS);
	if (pool.capacity > queueCapacity) throw new RangeError('The packet pool must not be deeper than the receiver queue it feeds.');
	const leaseTimeoutMs = boundedInteger(options.leaseTimeoutMs ?? 1_000, 'leaseTimeoutMs', 1, Number.MAX_SAFE_INTEGER);
	const now = options.now ?? (() => Date.now());
	const lifecycle = createCloseLifecycle(generation, options.onClose);
	let nextSequence = 0;
	let nextFrame = startFrame;
	let lastError: NativeRealtimeProtocolError | null = null;

	// Throwing out of a port handler would only strand the peer, so a cause the
	// sender decides on is kept for its supervisor instead of being dropped.
	const closeOnError = (error: unknown, reason: NativeRealtimeCloseReason): void => {
		lastError = asProtocolError(error);
		lifecycle.close(reason);
	};

	return {
		generation,
		replayPolicy: NATIVE_REALTIME_REPLAY_POLICY.realtime,
		get nextSequence(): number { return nextSequence; },
		get nextFrame(): number { return nextFrame; },
		get credit(): number { return lifecycle.closed ? 0 : pool.availableCount; },
		get inFlightCount(): number { return pool.inFlightCount; },
		get closed(): boolean { return lifecycle.closed; },
		get closeReason(): NativeRealtimeCloseReason | null { return lifecycle.reason; },
		/** The typed cause behind a close this end decided, if there was one. */
		get lastError(): NativeRealtimeProtocolError | null { return lastError; },
		openMessage(): NativeRealtimeOpenMessage {
			return Object.freeze({
				protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION, kind: 'open' as const, generation, startFrame,
				channelCount: pool.channelCount, frameCount: pool.frameCount, queueCapacity,
			});
		},
		acquire(): NativeRealtimePacketLease | null { return lifecycle.closed ? null : pool.acquire(); },
		send(lease: NativeRealtimePacketLease, frameCount = pool.frameCount): NativeRealtimeTransfer<NativeRealtimeAudioMessage> {
			if (lifecycle.closed) throw fail('CLOSED_GENERATION', `Generation ${generation} is closed and cannot send.`);
			if (lease.detached) throw fail('STALE_REPLAY', `Packet ${lease.packetId} was already sent; real-time audio is never replayed.`);
			const slot = slotForLease(state, lease, 'leased');
			const frames = boundedInteger(frameCount, 'frameCount', 1, pool.frameCount);
			const transfer = transferListForNativeRealtimeChannels(slot.channels);
			const message: NativeRealtimeAudioMessage = Object.freeze({
				protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION, kind: 'audio', generation, packetId: slot.packetId,
				sequence: nextSequence, startFrame: nextFrame, frameCount: frames,
				channels: Object.freeze(slot.channels.map((channel) => (frames === pool.frameCount ? channel : channel.subarray(0, frames)))),
			});
			// Ownership leaves this end here. Detaching before the message can
			// escape means no sender path reads or resends what it handed over.
			(lease as MutableLease).detached = true;
			slot.state = 'in-flight';
			slot.sentAt = now();
			slot.sentGeneration = generation;
			slot.sentSequence = nextSequence;
			state.inFlightCount += 1;
			nextSequence += 1;
			nextFrame += frames;
			return Object.freeze({ message, transfer });
		},
		acceptReturn(raw: unknown): void {
			let message: NativeRealtimeMessage;
			try {
				message = validateNativeRealtimeMessage(raw);
			} catch (error) {
				return void closeOnError(error, 'protocol-violation');
			}
			if (message.kind !== 'return') {
				return void closeOnError(fail('UNKNOWN_KIND', `A sender only accepts return messages, received ${message.kind}.`, 'kind'), 'protocol-violation');
			}
			try {
				pool.release(message);
			} catch (error) {
				// A return the ledger cannot account for means a pool buffer is
				// either lost or duplicated; neither is recoverable in real time.
				closeOnError(error, 'pool-leak');
			}
		},
		/** A buffer that never comes home is a leak, so the deadline closes it. */
		auditPool(nowMs = now()): void {
			if (lifecycle.closed) return;
			for (const slot of state.slots) {
				if (slot.state === 'in-flight' && nowMs - slot.sentAt > leaseTimeoutMs) return void lifecycle.close('pool-leak');
			}
		},
		close(reason: NativeRealtimeCloseReason): NativeRealtimeCloseMessage | null {
			return lifecycle.close(reason) ? closeMessage(generation, reason) : null;
		},
	};
}

export type NativeRealtimeSender = ReturnType<typeof createNativeRealtimeSender>;

export type NativeRealtimeAcceptResult = Readonly<{
	status: 'opened' | 'queued' | 'discarded' | 'ignored' | 'closed'; detail: string;
	generation: number | null; reason: NativeRealtimeCloseReason | null; error: NativeRealtimeProtocolError | null;
	/**
	 * What an open superseded: the packets it dropped from the queue, already
	 * shaped as the returns that carry their buffers home. The host owns the
	 * port, so it decides where they go, but the buffers belong to the pool that
	 * lent them and a generation that keeps them is one the pool is short.
	 */
	superseded: readonly NativeRealtimeTransfer<NativeRealtimeReturnMessage>[];
}>;

const NOTHING_SUPERSEDED: readonly NativeRealtimeTransfer<NativeRealtimeReturnMessage>[] = Object.freeze([]);

export interface NativeRealtimeReceiverOptions {
	readonly channelCount: number; readonly frameCount?: number; readonly queueCapacity?: number;
	readonly onClose?: (event: NativeRealtimeCloseEvent) => void;
}

/**
 * The AudioWorklet side. Its clock is authoritative, so it never waits: a
 * generation that arrives out of order, off its frame contiguity, or deeper
 * than the agreed queue closes once and falls silent rather than playing audio
 * that the device has already moved past.
 */
export function createNativeRealtimeReceiver(options: NativeRealtimeReceiverOptions) {
	const maxChannels = boundedInteger(options.channelCount, 'channelCount', 1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkChannels);
	const maxFrames = boundedInteger(options.frameCount ?? NATIVE_REALTIME_PACKET_FRAMES, 'frameCount', 1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames);
	const maxQueue = boundedInteger(options.queueCapacity ?? NATIVE_REALTIME_MAX_QUEUE_PACKETS, 'queueCapacity', 1, NATIVE_REALTIME_MAX_QUEUE_PACKETS);
	const issued = new WeakSet<NativeRealtimeAudioMessage>();
	const returned = new WeakSet<NativeRealtimeAudioMessage>();
	const queue: NativeRealtimeAudioMessage[] = [];
	let lifecycle: CloseLifecycle | null = null;
	let generation: number | null = null;
	let queueCapacity = maxQueue;
	let channelCount = maxChannels;
	let packetFrames = maxFrames;
	let expectedSequence = 0;
	let expectedFrame = 0;
	let discardedPacketCount = 0;

	const discard = (detail: string): NativeRealtimeAcceptResult => {
		discardedPacketCount += 1;
		return result('discarded', detail, generation, null, null);
	};

	const closeWith = (reason: NativeRealtimeCloseReason, error: NativeRealtimeProtocolError | null): NativeRealtimeAcceptResult => {
		// Nothing has opened yet, so there is no generation to close and none to
		// invent; the caller still learns why the message was refused.
		if (lifecycle === null) return result('ignored', 'no-generation', null, null, error);
		lifecycle.close(reason);
		return result('closed', 'generation-closed', generation, lifecycle.reason, error);
	};

	const returnTransfer = (packet: NativeRealtimeAudioMessage): NativeRealtimeTransfer<NativeRealtimeReturnMessage> => {
		returned.add(packet);
		return Object.freeze({
			message: Object.freeze({
				protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION, kind: 'return' as const, generation: packet.generation,
				packetId: packet.packetId, sequence: packet.sequence, channels: packet.channels,
			}),
			transfer: transferListForNativeRealtimeChannels(packet.channels),
		});
	};

	const openGeneration = (message: NativeRealtimeOpenMessage): NativeRealtimeAcceptResult => {
		if (generation !== null && message.generation <= generation) return discard('stale-open');
		// An open this end cannot honour never becomes a generation, so there is
		// nothing to close once; any running generation is left untouched.
		if (message.channelCount > maxChannels || message.frameCount > maxFrames || message.queueCapacity > maxQueue) return discard('rejected-open');
		lifecycle?.close('cancelled');
		// Accepted but never consumed is still borrowed, so the queue is handed
		// back rather than dropped: buffers the supersede kept would leave the
		// generation that replaced it permanently short of credit.
		const superseded = queue.length === 0 ? NOTHING_SUPERSEDED : Object.freeze(queue.map(returnTransfer));
		queue.length = 0;
		lifecycle = createCloseLifecycle(message.generation, options.onClose);
		generation = message.generation;
		channelCount = message.channelCount;
		packetFrames = message.frameCount;
		queueCapacity = message.queueCapacity;
		expectedSequence = 0;
		expectedFrame = message.startFrame;
		return result('opened', 'generation-opened', generation, null, null, superseded);
	};

	const acceptAudio = (message: NativeRealtimeAudioMessage): NativeRealtimeAcceptResult => {
		// The open negotiated the shape this end sized its render around, so a
		// packet outside it is refused even where the hard limits would allow it.
		if (message.channels.length !== channelCount || message.frameCount > packetFrames) {
			return closeWith('protocol-violation', fail('INVALID_FIELD', 'The packet shape does not match the open generation.', 'channels'));
		}
		if (message.sequence !== expectedSequence) {
			return closeWith('protocol-violation', fail('STALE_REPLAY', `Expected sequence ${expectedSequence}, received ${message.sequence}.`, 'sequence'));
		}
		if (message.startFrame !== expectedFrame) {
			return closeWith('non-contiguous', fail('INVALID_FIELD', `Expected frame ${expectedFrame}, received ${message.startFrame}.`, 'startFrame'));
		}
		if (queue.length >= queueCapacity) return closeWith('queue-overflow', null);
		issued.add(message);
		queue.push(message);
		expectedSequence += 1;
		expectedFrame += message.frameCount;
		return result('queued', `sequence-${message.sequence}`, message.generation, null, null);
	};

	return {
		get generation(): number | null { return generation; },
		get state(): 'idle' | 'open' | 'closed' { return lifecycle === null ? 'idle' : lifecycle.closed ? 'closed' : 'open'; },
		get closeReason(): NativeRealtimeCloseReason | null { return lifecycle?.reason ?? null; },
		get queuedPackets(): number { return queue.length; },
		get nextExpectedFrame(): number | null { return lifecycle === null ? null : expectedFrame; },
		get discardedPacketCount(): number { return discardedPacketCount; },
		accept(raw: unknown): NativeRealtimeAcceptResult {
			let message: NativeRealtimeMessage;
			try {
				message = validateNativeRealtimeMessage(raw);
			} catch (error) {
				return closeWith('protocol-violation', asProtocolError(error));
			}
			if (message.kind === 'open') return openGeneration(message);
			if (generation === null || message.generation !== generation) {
				return discard(message.generation < (generation ?? 0) ? 'stale-generation' : 'foreign-generation');
			}
			if (lifecycle?.closed) return result('ignored', 'closed-generation', generation, lifecycle.reason, null);
			if (message.kind === 'close') return closeWith(message.reason, null);
			if (message.kind === 'return') return closeWith('protocol-violation', fail('UNKNOWN_KIND', 'A receiver never accepts return messages.', 'kind'));
			return acceptAudio(message);
		},
		consume(): NativeRealtimeAudioMessage | null { return queue.shift() ?? null; },
		returnPacket(packet: NativeRealtimeAudioMessage): NativeRealtimeTransfer<NativeRealtimeReturnMessage> {
			if (!issued.has(packet) || returned.has(packet)) {
				throw fail('POOL_LEDGER', `Packet ${String(packet.packetId)} was not issued here or was already returned.`);
			}
			return returnTransfer(packet);
		},
		reportUnderrun(): NativeRealtimeCloseMessage | null {
			return lifecycle?.close('underrun') === true ? closeMessage(generation ?? 0, 'underrun') : null;
		},
		close(reason: NativeRealtimeCloseReason): NativeRealtimeCloseMessage | null {
			return lifecycle?.close(reason) === true ? closeMessage(generation ?? 0, reason) : null;
		},
	};
}

export type NativeRealtimeReceiver = ReturnType<typeof createNativeRealtimeReceiver>;

function result(
	status: NativeRealtimeAcceptResult['status'], detail: string, generation: number | null,
	reason: NativeRealtimeCloseReason | null, error: NativeRealtimeProtocolError | null,
	superseded: readonly NativeRealtimeTransfer<NativeRealtimeReturnMessage>[] = NOTHING_SUPERSEDED,
): NativeRealtimeAcceptResult {
	return Object.freeze({ status, detail, generation, reason, error, superseded });
}
