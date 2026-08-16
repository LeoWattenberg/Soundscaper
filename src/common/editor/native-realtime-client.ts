/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	NATIVE_REALTIME_MAX_GENERATION,
	NATIVE_REALTIME_MAX_QUEUE_PACKETS,
	NATIVE_REALTIME_PACKET_FRAMES,
	NATIVE_REALTIME_PROTOCOL_VERSION,
	boundedNativeRealtimeInteger as boundedInteger,
	describeNativeRealtimeValue as describe,
	nativeRealtimeError as fail,
} from './native-realtime-protocol.ts';
import { PLATFORM_TRANSFER_HARD_LIMITS, type AudioTransferFormat } from './platform/bounded-transfer.ts';

/**
 * The renderer's whole share of the 5A-0c data plane: take the MessagePort main
 * brokered from the supervised helper, prove it is the port that was asked for,
 * and hand it straight into the AudioWorklet. Once `attach` returns, packets
 * travel helper -> worklet and this thread is out of the path until it revokes.
 *
 * The handshake schema lives here rather than beside the broker because the
 * renderer is the one side that may never import from `desktop/`, and both ends
 * validate the same closed schema: main so a helper cannot make it deserialize
 * unbounded control data, the renderer so a port never reaches the audio thread
 * declaring a shape the graph was not sized for. The wire vocabulary itself is
 * `native-realtime-protocol.ts`; nothing below invents a second one.
 */

export const NATIVE_REALTIME_SAMPLE_FORMAT: AudioTransferFormat['sampleFormat'] = 'f32-planar';

/** A device the addon can drive; the same window the helper results admit. */
export const NATIVE_REALTIME_SAMPLE_RATE_LIMITS = Object.freeze({ minimum: 8_000, maximum: 768_000 });

/**
 * A port only ever names `close()` on either side of the broker. Naming
 * `onmessage` or `addEventListener` in the type would put reading a packet one
 * edit away from a surface whose entire purpose is not to be in that path.
 */
export interface NativeRealtimeTransferredPort {
	close(): void;
}

/**
 * A transfer list is peer-supplied on both sides of the broker, so an entry that
 * is not a closable port has to be refused rather than crash the side doing the
 * refusing. Membership is decided on `close` alone, because that is the only
 * method either side may ever name on a brokered port.
 */
export function isNativeRealtimeTransferredPort(value: unknown): value is NativeRealtimeTransferredPort {
	return typeof value === 'object' && value !== null
		&& typeof (value as NativeRealtimeTransferredPort).close === 'function';
}

export interface NativeRealtimeFormat {
	readonly sampleFormat: AudioTransferFormat['sampleFormat'];
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly queueCapacity: number;
}

export type NativeRealtimeFormatRequest = Readonly<{
	sampleRate: number;
	channelCount: number;
	frameCount?: number;
	queueCapacity?: number;
}>;

/** What the helper declares over the port it is offering, and nothing else. */
export interface NativeRealtimeHandshake extends NativeRealtimeFormat {
	readonly protocolVersion: typeof NATIVE_REALTIME_PROTOCOL_VERSION;
	readonly generation: number;
	readonly startFrame: number;
}

export const NATIVE_REALTIME_FORMAT_KEYS = Object.freeze([
	'sampleFormat', 'sampleRate', 'channelCount', 'frameCount', 'queueCapacity',
] as const);

export const NATIVE_REALTIME_HANDSHAKE_KEYS = Object.freeze([
	'channelCount', 'frameCount', 'generation', 'protocolVersion',
	'queueCapacity', 'sampleFormat', 'sampleRate', 'startFrame',
] as const);

const HANDSHAKE_KEY_SET: ReadonlySet<string> = new Set<string>(NATIVE_REALTIME_HANDSHAKE_KEYS);

/**
 * Normalizes what a caller asks for into the shape both ends compare against.
 * Bounding the request as strictly as the wire means a renderer cannot ask for
 * a stream the protocol would refuse and then read the refusal as a helper
 * fault.
 */
export function normalizeNativeRealtimeFormat(request: NativeRealtimeFormatRequest): NativeRealtimeFormat {
	return Object.freeze({
		sampleFormat: NATIVE_REALTIME_SAMPLE_FORMAT,
		sampleRate: boundedInteger(request.sampleRate, 'sampleRate',
			NATIVE_REALTIME_SAMPLE_RATE_LIMITS.minimum, NATIVE_REALTIME_SAMPLE_RATE_LIMITS.maximum),
		channelCount: boundedInteger(request.channelCount, 'channelCount', 1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkChannels),
		frameCount: boundedInteger(request.frameCount ?? NATIVE_REALTIME_PACKET_FRAMES, 'frameCount', 1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames),
		queueCapacity: boundedInteger(request.queueCapacity ?? NATIVE_REALTIME_MAX_QUEUE_PACKETS, 'queueCapacity', 1, NATIVE_REALTIME_MAX_QUEUE_PACKETS),
	});
}

/**
 * Validates one brokered handshake against a closed schema of eight keys, seven
 * of them integers and one a single string literal. The envelope is charged
 * before any field is read, because the schema alone does not bound it: an
 * over-long value in the one string key, or a key explosion, would otherwise be
 * copied verbatim into the refusal that both processes report for it.
 */
export function validateNativeRealtimeHandshake(value: unknown): NativeRealtimeHandshake {
	const record = plainRecord(value);
	assertBoundedEnvelope(record);
	assertClosedKeys(record);
	const version = readField(record, 'protocolVersion');
	if (version !== NATIVE_REALTIME_PROTOCOL_VERSION) {
		throw fail('PROTOCOL_VERSION', `Unsupported native real-time protocol version ${describeBounded(version)}.`, 'protocolVersion');
	}
	const sampleFormat = readField(record, 'sampleFormat');
	if (sampleFormat !== NATIVE_REALTIME_SAMPLE_FORMAT) {
		throw fail('INVALID_FIELD', `sampleFormat must be ${JSON.stringify(NATIVE_REALTIME_SAMPLE_FORMAT)}, received ${describeBounded(sampleFormat)}.`, 'sampleFormat');
	}
	return Object.freeze({
		protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION,
		// Generation zero is the worklet node's "nothing authorized" value, so a
		// live generation starts at one and the two can never be confused.
		generation: boundedInteger(readField(record, 'generation'), 'generation', 1, NATIVE_REALTIME_MAX_GENERATION),
		sampleFormat: NATIVE_REALTIME_SAMPLE_FORMAT,
		sampleRate: boundedInteger(readField(record, 'sampleRate'), 'sampleRate',
			NATIVE_REALTIME_SAMPLE_RATE_LIMITS.minimum, NATIVE_REALTIME_SAMPLE_RATE_LIMITS.maximum),
		channelCount: boundedInteger(readField(record, 'channelCount'), 'channelCount', 1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkChannels),
		frameCount: boundedInteger(readField(record, 'frameCount'), 'frameCount', 1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames),
		queueCapacity: boundedInteger(readField(record, 'queueCapacity'), 'queueCapacity', 1, NATIVE_REALTIME_MAX_QUEUE_PACKETS),
		startFrame: boundedInteger(readField(record, 'startFrame'), 'startFrame', 0, Number.MAX_SAFE_INTEGER),
	});
}

/** Names the first field a declared stream disagrees on, or null if it matches. */
export function describeNativeRealtimeFormatMismatch(
	expected: NativeRealtimeFormat,
	declared: NativeRealtimeFormat,
): string | null {
	for (const key of NATIVE_REALTIME_FORMAT_KEYS) {
		if (expected[key] !== declared[key]) {
			return `${key} was requested as ${describe(expected[key])} and declared as ${describe(declared[key])}`;
		}
	}
	return null;
}

/**
 * The slice of the transport worklet node this client drives. It is the shape
 * `createNativeRealtimeWorkletNode` returns, injected so the client can be
 * proven without an AudioContext.
 */
export interface NativeRealtimeWorkletTransport {
	attach(port: NativeRealtimeTransferredPort, config: Readonly<{ generation: number }>): number;
	revoke(reason?: string): number;
	notifyPeerLoss(): number;
	dispose(): void;
}

export const NATIVE_REALTIME_CLIENT_REFUSALS = Object.freeze([
	'client-disposed', 'no-port', 'malformed-handshake', 'format-mismatch', 'stale-generation', 'attach-failed',
] as const);

export type NativeRealtimeClientRefusal = (typeof NATIVE_REALTIME_CLIENT_REFUSALS)[number];

export type NativeRealtimeClientOutcome =
	| Readonly<{ status: 'attached'; generation: number }>
	| Readonly<{ status: 'refused'; refusal: NativeRealtimeClientRefusal; message: string }>;

export interface NativeRealtimeClientOptions {
	readonly transport: NativeRealtimeWorkletTransport;
	readonly request: NativeRealtimeFormatRequest;
	/** Injected so a refusal can be observed; production closes the port itself. */
	readonly closePort?: (port: NativeRealtimeTransferredPort) => void;
}

export function createNativeRealtimeClient(options: NativeRealtimeClientOptions) {
	const transport = options.transport;
	const format = normalizeNativeRealtimeFormat(options.request);
	const closePort = options.closePort ?? ((port: NativeRealtimeTransferredPort) => port.close());
	const closed = new WeakSet<NativeRealtimeTransferredPort>();
	let attachedGeneration = 0;
	// The generation ledger is monotonic even while nothing is attached.
	// `attachedGeneration` falls back to zero on revocation and peer loss, so it
	// cannot also be the replay guard: NATIVE_REALTIME_REPLAY_POLICY.realtime is
	// 'never' because a real-time generation has already been heard by the time
	// it could be offered again, and re-attaching one plays stale audio out.
	let admittedGeneration = 0;
	let disposed = false;

	// A refused port is closed here and never stored: parking it would leave the
	// helper writing into a stream nothing will ever drain.
	const discard = (port: unknown): void => {
		if (!isNativeRealtimeTransferredPort(port) || closed.has(port)) return;
		closed.add(port);
		try {
			closePort(port);
		} catch {
			/* An already-entangled port is closed enough; the refusal still stands. */
		}
	};

	const refuse = (
		port: unknown,
		refusal: NativeRealtimeClientRefusal,
		message: string,
	): NativeRealtimeClientOutcome => {
		discard(port);
		return Object.freeze({ status: 'refused' as const, refusal, message });
	};

	return {
		get format(): NativeRealtimeFormat { return format; },
		get generation(): number { return attachedGeneration; },
		get disposed(): boolean { return disposed; },

		/**
		 * Takes one brokered offer. The handshake is proven before the port moves,
		 * because a transfer cannot be undone: once the port is in the worklet the
		 * only remedy for a stream the graph cannot play is to tear the generation
		 * down again, which the user hears.
		 */
		receive(offer: unknown, ports: readonly NativeRealtimeTransferredPort[] = []): NativeRealtimeClientOutcome {
			const port: unknown = ports.length === 1 ? ports[0] : null;
			if (disposed) {
				for (const offered of ports) discard(offered);
				return refusedByClient('client-disposed', 'The native real-time client is disposed.');
			}
			if (!isNativeRealtimeTransferredPort(port)) {
				for (const offered of ports) discard(offered);
				return refusedByClient('no-port', 'A native real-time offer must carry exactly one MessagePort.');
			}
			let handshake: NativeRealtimeHandshake;
			try {
				handshake = validateNativeRealtimeHandshake(offer);
			} catch (error) {
				return refuse(port, 'malformed-handshake', error instanceof Error ? error.message : String(error));
			}
			const mismatch = describeNativeRealtimeFormatMismatch(format, handshake);
			if (mismatch !== null) {
				return refuse(port, 'format-mismatch', `The offered stream does not match this graph: ${mismatch}.`);
			}
			if (handshake.generation <= admittedGeneration) {
				return refuse(port, 'stale-generation', `Generation ${handshake.generation} was already attached or retired.`);
			}
			let generation: number;
			try {
				generation = transport.attach(port, { generation: handshake.generation });
			} catch (error) {
				return refuse(port, 'attach-failed', error instanceof Error ? error.message : String(error));
			}
			// `attach` hands control to the worklet seam, which tears the graph
			// down on its own errors. Recording the generation after it disposed
			// this client would resurrect a stream that no longer exists; the port
			// itself is already the worklet's, so it is not closed here.
			if (disposed) return refusedByClient('client-disposed', 'The worklet disposed this client while it was attaching.');
			// The ledger advances on what this client authorized, so a transport
			// that answers with a lower number still cannot re-open a generation.
			admittedGeneration = handshake.generation;
			attachedGeneration = generation;
			return Object.freeze({ status: 'attached' as const, generation });
		},

		/**
		 * Main revoked, so the worklet — not this thread — narrows the reason. The
		 * ledger is cleared before the seam runs: a generation main has withdrawn
		 * is over whether or not the worklet acknowledges it, and a caller that
		 * retries after a throw must not revoke the same generation twice.
		 */
		revoke(reason?: string): number {
			if (disposed || attachedGeneration === 0) return 0;
			attachedGeneration = 0;
			return transport.revoke(reason);
		},

		/** Main supervises the helper and sees an exit the port may report later. */
		notifyPeerLoss(): number {
			if (disposed || attachedGeneration === 0) return 0;
			attachedGeneration = 0;
			return transport.notifyPeerLoss();
		},

		dispose(): void {
			if (disposed) return;
			disposed = true;
			attachedGeneration = 0;
			transport.dispose();
		},
	};
}

export type NativeRealtimeClient = ReturnType<typeof createNativeRealtimeClient>;

function refusedByClient(refusal: NativeRealtimeClientRefusal, message: string): NativeRealtimeClientOutcome {
	return Object.freeze({ status: 'refused' as const, refusal, message });
}

function plainRecord(value: unknown): Readonly<Record<string, unknown>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw fail('INVALID_FIELD', `A handshake must be a plain object, received ${describe(value)}.`);
	}
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw fail('INVALID_FIELD', 'A handshake must not carry a class prototype.');
	}
	return value as Readonly<Record<string, unknown>>;
}

/**
 * Names a rejected value without letting it become the size of the refusal. The
 * envelope bound already caps a handshake at 64 KiB, but the one string key it
 * admits has a ten-character legal value: quoting the rest of a 20 KB near-miss
 * back at both processes would put helper-controlled bulk in a control message.
 */
function describeBounded(value: unknown): string {
	const described = describe(value);
	return described.length <= 96 ? described : `${described.slice(0, 96)}…`;
}

/**
 * Charges the control envelope the way the wire validator does: every property
 * costs its worst-case UTF-8 size, which keeps a megabyte-long value and a key
 * explosion inside one limit stated in bytes. An accessor is charged as absent
 * rather than invoked, so nothing here runs a peer's code.
 */
function assertBoundedEnvelope(record: Readonly<Record<string, unknown>>): void {
	let bytes = 0;
	for (const key of Object.getOwnPropertyNames(record)) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		const held = descriptor && 'value' in descriptor ? descriptor.value : undefined;
		bytes += key.length * 3 + (typeof held === 'string' ? held.length * 3 : 8);
		if (bytes > PLATFORM_TRANSFER_HARD_LIMITS.messageBytes) {
			throw fail('PAYLOAD_TOO_LARGE', `A handshake may not exceed ${PLATFORM_TRANSFER_HARD_LIMITS.messageBytes} bytes.`, key);
		}
	}
}

function assertClosedKeys(record: Readonly<Record<string, unknown>>): void {
	if (Object.getOwnPropertySymbols(record).length > 0) {
		throw fail('UNKNOWN_KEY', 'A handshake must not carry symbol keys.');
	}
	for (const key of Object.getOwnPropertyNames(record)) {
		if (!HANDSHAKE_KEY_SET.has(key)) throw fail('UNKNOWN_KEY', `Unknown handshake key ${JSON.stringify(key)}.`, key);
	}
}

function readField(record: Readonly<Record<string, unknown>>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor) throw fail('INVALID_FIELD', `${key} is required.`, key);
	if (!('value' in descriptor)) throw fail('INVALID_FIELD', `${key} must be a data property, not an accessor.`, key);
	return descriptor.value;
}
