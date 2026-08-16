/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_EDITOR_STREAM_QUEUE_PACKET_LIMIT,
	AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
} from './chunk-stream.js';
import { PLATFORM_TRANSFER_HARD_LIMITS } from './platform/bounded-transfer.ts';

/**
 * The milestone 5A real-time data plane: a supervised native helper and an
 * AudioWorklet exchange planar float packets over a directly transferred
 * MessagePort, with renderer main present only for setup and revocation.
 * Nothing here allocates once the pool exists, because the consuming end runs
 * on the audio callback, and nothing reaches for SharedArrayBuffer, because the
 * browser build ships without cross-origin isolation and 5A does not add it.
 */

export const NATIVE_REALTIME_PROTOCOL_VERSION = 1;
export const NATIVE_REALTIME_PACKET_FRAMES: number = AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES;
export const NATIVE_REALTIME_MAX_QUEUE_PACKETS: number = AUDIO_EDITOR_STREAM_QUEUE_PACKET_LIMIT;
export const NATIVE_REALTIME_MAX_GENERATION = 0xffff_ffff;

const BYTES_PER_SAMPLE = Float32Array.BYTES_PER_ELEMENT;

export const NATIVE_REALTIME_CLOSE_REASONS = Object.freeze([
	'completed', 'cancelled', 'underrun', 'non-contiguous',
	'queue-overflow', 'pool-leak', 'peer-loss', 'protocol-violation',
] as const);

export const NATIVE_REALTIME_ERROR_CODES = Object.freeze([
	'CLOSED_GENERATION', 'INVALID_FIELD', 'PACKET_DETACHED', 'PAYLOAD_TOO_LARGE', 'POOL_LEDGER',
	'PROTOCOL_VERSION', 'SHARED_MEMORY_FORBIDDEN', 'STALE_REPLAY', 'UNKNOWN_KEY', 'UNKNOWN_KIND',
] as const);

/**
 * An offline render is compared before it is committed, so it may be retried
 * from the canonical plan. A real-time generation has already been heard by the
 * time a retry could run, so a late packet is dropped and its generation closes
 * rather than replaying stale audio into the device.
 */
export const NATIVE_REALTIME_REPLAY_POLICY = Object.freeze({ realtime: 'never', offline: 'retry-from-canonical-plan' } as const);

export type NativeRealtimeCloseReason = (typeof NATIVE_REALTIME_CLOSE_REASONS)[number];
export type NativeRealtimeErrorCode = (typeof NATIVE_REALTIME_ERROR_CODES)[number];
export type NativeRealtimeCloseEvent = Readonly<{ generation: number; reason: NativeRealtimeCloseReason }>;
export type NativeRealtimeTransfer<Message> = Readonly<{ message: Message; transfer: readonly ArrayBuffer[] }>;

export class NativeRealtimeProtocolError extends Error {
	readonly code: NativeRealtimeErrorCode;
	readonly field: string;

	constructor(code: NativeRealtimeErrorCode, message: string, field = '') {
		super(message);
		this.name = 'NativeRealtimeProtocolError';
		this.code = code;
		this.field = field;
	}
}

type Envelope = Readonly<{ protocolVersion: number; generation: number }>;
type Planes = Readonly<{ channels: readonly Float32Array[] }>;

export type NativeRealtimeOpenMessage = Envelope & Readonly<{ kind: 'open'; startFrame: number; channelCount: number; frameCount: number; queueCapacity: number }>;
export type NativeRealtimeAudioMessage = Envelope & Planes & Readonly<{ kind: 'audio'; packetId: number; sequence: number; startFrame: number; frameCount: number }>;
export type NativeRealtimeReturnMessage = Envelope & Planes & Readonly<{ kind: 'return'; packetId: number }>;
export type NativeRealtimeCloseMessage = Envelope & Readonly<{ kind: 'close'; reason: NativeRealtimeCloseReason }>;
export type NativeRealtimeMessage =
	NativeRealtimeOpenMessage | NativeRealtimeAudioMessage | NativeRealtimeReturnMessage | NativeRealtimeCloseMessage;

const MESSAGE_KEYS = Object.freeze({
	open: ['channelCount', 'frameCount', 'generation', 'kind', 'protocolVersion', 'queueCapacity', 'startFrame'],
	audio: ['channels', 'frameCount', 'generation', 'kind', 'packetId', 'protocolVersion', 'sequence', 'startFrame'],
	return: ['channels', 'generation', 'kind', 'packetId', 'protocolVersion'],
	close: ['generation', 'kind', 'protocolVersion', 'reason'],
} as const);

const NUMERIC_LIMITS: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
	generation: [0, NATIVE_REALTIME_MAX_GENERATION], packetId: [0, NATIVE_REALTIME_MAX_QUEUE_PACKETS - 1],
	startFrame: [0, Number.MAX_SAFE_INTEGER], sequence: [0, Number.MAX_SAFE_INTEGER],
	channelCount: [1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkChannels], queueCapacity: [1, NATIVE_REALTIME_MAX_QUEUE_PACKETS],
	frameCount: [1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames],
});

/**
 * Validates one wire message against a closed schema. Foreign prototypes,
 * accessor properties, unknown keys, non-finite numbers, shared memory and
 * oversize control payloads are all rejected before any field is trusted, so a
 * peer can neither run a getter on this side nor make it walk unbounded data.
 */
export function validateNativeRealtimeMessage(value: unknown): NativeRealtimeMessage {
	const record = asPlainRecord(value);
	assertControlPayloadSize(record);
	const version = readField(record, 'protocolVersion');
	if (version !== NATIVE_REALTIME_PROTOCOL_VERSION) {
		throw fail('PROTOCOL_VERSION', `Unsupported native real-time protocol version ${describe(version)}.`, 'protocolVersion');
	}
	const kind = readField(record, 'kind');
	if (!isMessageKind(kind)) throw fail('UNKNOWN_KIND', `Unknown message kind ${describe(kind)}.`, 'kind');
	assertClosedKeySet(record, MESSAGE_KEYS[kind]);
	const fields: Record<string, unknown> = { protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION, kind };
	for (const key of MESSAGE_KEYS[kind] as readonly string[]) {
		const limits = NUMERIC_LIMITS[key];
		if (limits) fields[key] = boundedInteger(readField(record, key), key, limits[0], limits[1]);
	}
	if (kind === 'close') {
		const reason = readField(record, 'reason');
		if (!isCloseReason(reason)) throw fail('INVALID_FIELD', `${describe(reason)} is not a close reason.`, 'reason');
		fields.reason = reason;
	} else if (kind !== 'open') {
		const frames = kind === 'audio' ? (fields.frameCount as number) : null;
		fields.channels = validateChannels(readField(record, 'channels'), frames);
	}
	// Safe by construction: the key set is closed to this kind's schema and
	// every one of its fields has just been bounded or narrowed above.
	return Object.freeze(fields) as unknown as NativeRealtimeMessage;
}

function asPlainRecord(value: unknown): Readonly<Record<string, unknown>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw fail('INVALID_FIELD', `A wire message must be a plain object, received ${describe(value)}.`);
	}
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw fail('INVALID_FIELD', 'A wire message must not carry a class prototype.');
	return value as Readonly<Record<string, unknown>>;
}

/**
 * Bounds the control half of a message before the schema is applied. PCM rides
 * its own bounded channel, so string cost is what matters; every property is
 * charged its worst-case UTF-8 size, which keeps both a megabyte-long field and
 * a key explosion out of a limit that is stated in bytes.
 */
function assertControlPayloadSize(record: Readonly<Record<string, unknown>>): void {
	let bytes = 0;
	for (const key of Object.getOwnPropertyNames(record)) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		const held = descriptor && 'value' in descriptor ? descriptor.value : undefined;
		bytes += key.length * 3 + (typeof held === 'string' ? held.length * 3 : 8);
		if (bytes > PLATFORM_TRANSFER_HARD_LIMITS.messageBytes) {
			throw fail('PAYLOAD_TOO_LARGE', `A control payload may not exceed ${PLATFORM_TRANSFER_HARD_LIMITS.messageBytes} bytes.`, key);
		}
	}
}

function assertClosedKeySet(record: Readonly<Record<string, unknown>>, expected: readonly string[]): void {
	if (Object.getOwnPropertySymbols(record).length > 0) throw fail('UNKNOWN_KEY', 'A wire message must not carry symbol keys.');
	const allowed = new Set(expected);
	for (const key of Object.getOwnPropertyNames(record)) {
		if (!allowed.delete(key)) throw fail('UNKNOWN_KEY', `Unknown wire message key ${JSON.stringify(key)}.`, key);
	}
	for (const missing of allowed) throw fail('INVALID_FIELD', `${missing} is required.`, missing);
}

function readField(record: Readonly<Record<string, unknown>>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor) throw fail('INVALID_FIELD', `${key} is required.`, key);
	if (!('value' in descriptor)) throw fail('INVALID_FIELD', `${key} must be a data property, not an accessor.`, key);
	return descriptor.value;
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw fail('INVALID_FIELD', `${field} must be a safe integer in [${minimum}, ${maximum}], received ${describe(value)}.`, field);
	}
	return value;
}

function validateChannels(value: unknown, frameCount: number | null): readonly Float32Array[] {
	const maxChannels = PLATFORM_TRANSFER_HARD_LIMITS.audioChunkChannels;
	if (!Array.isArray(value) || value.length < 1 || value.length > maxChannels) {
		throw fail('INVALID_FIELD', `channels must hold 1 to ${maxChannels} planar Float32Array channels.`, 'channels');
	}
	const planes = value as readonly unknown[];
	const head = planes[0];
	const frames = frameCount ?? (head instanceof Float32Array ? head.length : 0);
	if (frames < 1 || frames > PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames) {
		throw fail('INVALID_FIELD', `channels must hold 1 to ${PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames} frames.`, 'channels');
	}
	const channels: Float32Array[] = [];
	for (const [index, channel] of planes.entries()) {
		const field = `channels[${index}]`;
		if (!(channel instanceof Float32Array)) throw fail('INVALID_FIELD', `${field} must be a Float32Array.`, field);
		assertOrdinaryBuffer(channel.buffer, field);
		if (channel.length !== frames) throw fail('INVALID_FIELD', `${field} must hold exactly ${frames} frames.`, field);
		channels.push(channel);
	}
	return Object.freeze(channels);
}

function assertOrdinaryBuffer(buffer: ArrayBufferLike, field: string): void {
	if (buffer instanceof ArrayBuffer) return;
	if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) {
		throw fail('SHARED_MEMORY_FORBIDDEN', `${field} must not be backed by SharedArrayBuffer.`, field);
	}
	throw fail('INVALID_FIELD', `${field} must be backed by an ordinary ArrayBuffer.`, field);
}

function isMessageKind(value: unknown): value is keyof typeof MESSAGE_KEYS {
	return typeof value === 'string' && Object.hasOwn(MESSAGE_KEYS, value);
}

function isCloseReason(value: unknown): value is NativeRealtimeCloseReason {
	return typeof value === 'string' && (NATIVE_REALTIME_CLOSE_REASONS as readonly string[]).includes(value);
}

function fail(code: NativeRealtimeErrorCode, message: string, field = ''): NativeRealtimeProtocolError {
	return new NativeRealtimeProtocolError(code, message, field);
}

function describe(value: unknown): string {
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'object' && value !== null) return Object.prototype.toString.call(value);
	return String(value);
}

export interface NativeRealtimePacketLease {
	readonly packetId: number; readonly channelCount: number; readonly capacityFrames: number; readonly detached: boolean;
	/** Throws once the packet is transferred; ownership has left this end. */
	channels(): readonly Float32Array[];
}

export type NativeRealtimePacketPoolOptions = Readonly<{ capacity: number; channelCount: number; frameCount?: number }>;

interface MutableLease extends NativeRealtimePacketLease { detached: boolean }

interface PoolSlot {
	readonly packetId: number; channels: Float32Array[];
	state: 'free' | 'leased' | 'in-flight'; lease: MutableLease | null; sentAt: number;
}

interface PoolState {
	readonly slots: readonly PoolSlot[]; readonly free: number[];
	readonly capacityFrames: number; readonly channelCount: number;
	allocationCount: number; inFlightCount: number;
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
	let allocationCount = 0;
	for (let packetId = 0; packetId < capacity; packetId += 1) {
		const channels: Float32Array[] = [];
		for (let channel = 0; channel < channelCount; channel += 1) {
			channels.push(new Float32Array(new ArrayBuffer(capacityFrames * BYTES_PER_SAMPLE)));
			allocationCount += 1;
		}
		slots.push({ packetId, channels, state: 'free', lease: null, sentAt: 0 });
		free.push(packetId);
	}
	const state: PoolState = { slots, free, capacityFrames, channelCount, allocationCount, inFlightCount: 0 };
	const pool = {
		capacity,
		channelCount,
		frameCount: capacityFrames,
		get availableCount(): number { return state.free.length; },
		get inFlightCount(): number { return state.inFlightCount; },
		/** Buffers allocated over the pool's whole life; never more than capacity. */
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
		release(packetId: number, channels: readonly Float32Array[]): void {
			const slot = state.slots[boundedInteger(packetId, 'packetId', 0, capacity - 1)];
			if (slot.state !== 'in-flight') throw fail('POOL_LEDGER', `Packet ${packetId} was returned while it was not in flight.`, 'packetId');
			slot.channels = adoptReturnedChannels(channels, state);
			slot.state = 'free';
			slot.lease = null;
			state.inFlightCount -= 1;
			state.free.push(packetId);
		},
	};
	POOL_STATE.set(pool, state);
	return pool;
}

export type NativeRealtimePacketPool = ReturnType<typeof createNativeRealtimePacketPool>;

function createLease(slot: PoolSlot, channelCount: number, capacityFrames: number): MutableLease {
	const lease: MutableLease = {
		packetId: slot.packetId,
		channelCount,
		capacityFrames,
		detached: false,
		channels() {
			if (lease.detached) throw fail('PACKET_DETACHED', `Packet ${slot.packetId} was transferred; this end no longer owns its buffers.`);
			return slot.channels;
		},
	};
	return lease;
}

function slotForLease(state: PoolState, lease: NativeRealtimePacketLease, expected: PoolSlot['state']): PoolSlot {
	const slot = state.slots[lease.packetId];
	if (!slot || slot.lease !== lease || slot.state !== expected) {
		throw fail('POOL_LEDGER', `Packet ${String(lease.packetId)} is not ${expected} in this pool.`);
	}
	return slot;
}

/**
 * Re-adopts the buffers a peer handed back. A view that already spans its whole
 * buffer is kept as-is, so the steady state allocates nothing; only a short
 * final packet costs one view object, and never a new ArrayBuffer.
 */
function adoptReturnedChannels(channels: readonly Float32Array[], state: PoolState): Float32Array[] {
	if (channels.length !== state.channelCount) throw fail('POOL_LEDGER', `A returned packet must carry ${state.channelCount} channels.`, 'channels');
	const bytes = state.capacityFrames * BYTES_PER_SAMPLE;
	return channels.map((channel, index) => {
		const field = `channels[${index}]`;
		assertOrdinaryBuffer(channel.buffer, field);
		if (channel.buffer.byteLength !== bytes) throw fail('POOL_LEDGER', `${field} is not a pool buffer of ${bytes} bytes.`, field);
		return channel.byteOffset === 0 && channel.length === state.capacityFrames ? channel : new Float32Array(channel.buffer);
	});
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

export function transferListForNativeRealtimeChannels(channels: readonly Float32Array[]): readonly ArrayBuffer[] {
	const buffers: ArrayBuffer[] = [];
	for (const [index, channel] of channels.entries()) {
		assertOrdinaryBuffer(channel.buffer, `channels[${index}]`);
		const buffer = channel.buffer as ArrayBuffer;
		if (!buffers.includes(buffer)) buffers.push(buffer);
	}
	return Object.freeze(buffers);
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

	return {
		generation,
		replayPolicy: NATIVE_REALTIME_REPLAY_POLICY.realtime,
		get nextSequence(): number { return nextSequence; },
		get nextFrame(): number { return nextFrame; },
		get credit(): number { return lifecycle.closed ? 0 : pool.availableCount; },
		get inFlightCount(): number { return pool.inFlightCount; },
		get closed(): boolean { return lifecycle.closed; },
		get closeReason(): NativeRealtimeCloseReason | null { return lifecycle.reason; },
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
			state.inFlightCount += 1;
			nextSequence += 1;
			nextFrame += frames;
			return Object.freeze({ message, transfer });
		},
		acceptReturn(raw: unknown): void {
			let message: NativeRealtimeMessage;
			try {
				message = validateNativeRealtimeMessage(raw);
			} catch {
				return void lifecycle.close('protocol-violation');
			}
			if (message.kind !== 'return') return void lifecycle.close('protocol-violation');
			if (message.generation !== generation) return;
			try {
				pool.release(message.packetId, message.channels);
			} catch {
				// A return the ledger cannot account for means a pool buffer is
				// either lost or duplicated; neither is recoverable in real time.
				lifecycle.close('pool-leak');
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
}>;

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
	let expectedSequence = 0;
	let expectedFrame = 0;
	let discardedPacketCount = 0;

	const discard = (detail: string): NativeRealtimeAcceptResult => {
		discardedPacketCount += 1;
		return result('discarded', detail, generation, null, null);
	};

	const closeWith = (reason: NativeRealtimeCloseReason, error: NativeRealtimeProtocolError | null): NativeRealtimeAcceptResult => {
		lifecycle?.close(reason);
		return result('closed', 'generation-closed', generation, lifecycle?.reason ?? reason, error);
	};

	const openGeneration = (message: NativeRealtimeOpenMessage): NativeRealtimeAcceptResult => {
		if (generation !== null && message.generation <= generation) return discard('stale-open');
		// An open this end cannot honour never becomes a generation, so there is
		// nothing to close once; any running generation is left untouched.
		if (message.channelCount > maxChannels || message.frameCount > maxFrames || message.queueCapacity > maxQueue) return discard('rejected-open');
		lifecycle?.close('cancelled');
		queue.length = 0;
		lifecycle = createCloseLifecycle(message.generation, options.onClose);
		generation = message.generation;
		channelCount = message.channelCount;
		queueCapacity = message.queueCapacity;
		expectedSequence = 0;
		expectedFrame = message.startFrame;
		return result('opened', 'generation-opened', generation, null, null);
	};

	const acceptAudio = (message: NativeRealtimeAudioMessage): NativeRealtimeAcceptResult => {
		if (message.channels.length !== channelCount || message.frameCount > maxFrames) {
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
				return closeWith('protocol-violation', error instanceof NativeRealtimeProtocolError ? error : fail('INVALID_FIELD', String(error)));
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
			returned.add(packet);
			return Object.freeze({
				message: Object.freeze({
					protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION, kind: 'return' as const,
					generation: packet.generation, packetId: packet.packetId, channels: packet.channels,
				}),
				transfer: transferListForNativeRealtimeChannels(packet.channels),
			});
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

function result(status: NativeRealtimeAcceptResult['status'], detail: string, generation: number | null, reason: NativeRealtimeCloseReason | null, error: NativeRealtimeProtocolError | null): NativeRealtimeAcceptResult {
	return Object.freeze({ status, detail, generation, reason, error });
}
