/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	NATIVE_REALTIME_CLIENT_REFUSALS,
	NATIVE_REALTIME_HANDSHAKE_KEYS,
	NATIVE_REALTIME_SAMPLE_FORMAT,
	createNativeRealtimeClient,
	describeNativeRealtimeFormatMismatch,
	normalizeNativeRealtimeFormat,
	validateNativeRealtimeHandshake,
	type NativeRealtimeClient,
	type NativeRealtimeClientOutcome,
	type NativeRealtimeTransferredPort,
	type NativeRealtimeWorkletTransport,
} from '../src/common/editor/native-realtime-client.ts';
import {
	NATIVE_REALTIME_MAX_QUEUE_PACKETS,
	NATIVE_REALTIME_PACKET_FRAMES,
	NativeRealtimeProtocolError,
} from '../src/common/editor/native-realtime-transport.ts';
import { PLATFORM_TRANSFER_HARD_LIMITS } from '../src/common/editor/platform/bounded-transfer.ts';

interface PortProbe {
	readonly port: NativeRealtimeTransferredPort;
	closeCount: number;
}

function createPort(): PortProbe {
	const probe: PortProbe = {
		closeCount: 0,
		port: { close(): void { probe.closeCount += 1; } },
	};
	return probe;
}

interface TransportProbe extends NativeRealtimeWorkletTransport {
	readonly attached: { port: NativeRealtimeTransferredPort; generation: number }[];
	readonly revocations: (string | undefined)[];
	peerLosses: number;
	disposals: number;
	failAttach: unknown;
}

function createTransport(): TransportProbe {
	const attached: TransportProbe['attached'] = [];
	const revocations: TransportProbe['revocations'] = [];
	return {
		attached,
		revocations,
		peerLosses: 0,
		disposals: 0,
		failAttach: null,
		attach(port, config): number {
			if (this.failAttach) throw this.failAttach;
			attached.push({ port, generation: config.generation });
			return config.generation;
		},
		revoke(reason): number {
			revocations.push(reason);
			return attached.at(-1)?.generation ?? 0;
		},
		notifyPeerLoss(): number {
			this.peerLosses += 1;
			return attached.at(-1)?.generation ?? 0;
		},
		dispose(): void { this.disposals += 1; },
	};
}

const REQUEST = Object.freeze({ sampleRate: 48_000, channelCount: 2, frameCount: 1_024, queueCapacity: 8 });

function offer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		protocolVersion: 1,
		generation: 1,
		sampleFormat: 'f32-planar',
		sampleRate: 48_000,
		channelCount: 2,
		frameCount: 1_024,
		queueCapacity: 8,
		startFrame: 0,
		...overrides,
	};
}

function createClient(request = REQUEST): Readonly<{ client: NativeRealtimeClient; transport: TransportProbe }> {
	const transport = createTransport();
	return { client: createNativeRealtimeClient({ transport, request }), transport };
}

function refusal(outcome: NativeRealtimeClientOutcome): string {
	assert.equal(outcome.status, 'refused');
	if (outcome.status !== 'refused') throw new Error('unreachable');
	return outcome.refusal;
}

test('the handshake schema is closed, bounded and shared with the broker', () => {
	assert.deepEqual([...NATIVE_REALTIME_HANDSHAKE_KEYS], [
		'channelCount', 'frameCount', 'generation', 'protocolVersion',
		'queueCapacity', 'sampleFormat', 'sampleRate', 'startFrame',
	]);
	const handshake = validateNativeRealtimeHandshake(offer({ startFrame: 4_096 }));
	assert.deepEqual({ ...handshake }, {
		protocolVersion: 1, generation: 1, sampleFormat: NATIVE_REALTIME_SAMPLE_FORMAT, sampleRate: 48_000,
		channelCount: 2, frameCount: 1_024, queueCapacity: 8, startFrame: 4_096,
	});
	assert.ok(Object.isFrozen(handshake));

	for (const [label, value, code] of [
		['unknown key', offer({ evil: 1 }), 'UNKNOWN_KEY'],
		['wrong version', offer({ protocolVersion: 0 }), 'PROTOCOL_VERSION'],
		['interleaved format', offer({ sampleFormat: 'f32-interleaved' }), 'INVALID_FIELD'],
		['generation zero', offer({ generation: 0 }), 'INVALID_FIELD'],
		['negative start frame', offer({ startFrame: -1 }), 'INVALID_FIELD'],
		['sample rate below the device window', offer({ sampleRate: 7_999 }), 'INVALID_FIELD'],
		['queue deeper than the wire allows', offer({ queueCapacity: NATIVE_REALTIME_MAX_QUEUE_PACKETS + 1 }), 'INVALID_FIELD'],
		['missing field', (() => { const value = offer(); delete value.startFrame; return value; })(), 'INVALID_FIELD'],
		['null', null, 'INVALID_FIELD'],
		['array', [], 'INVALID_FIELD'],
	] as const) {
		assert.throws(() => validateNativeRealtimeHandshake(value), (error: unknown) => {
			if (!(error instanceof NativeRealtimeProtocolError)) throw new Error(`${label} threw ${String(error)} rather than a protocol error`);
			assert.equal(error.code, code, label);
			return true;
		}, label);
	}

	// A class prototype or an accessor would let a peer run its own code on the
	// side that is only supposed to be reading eight numbers.
	class Forged { readonly protocolVersion = 1; }
	assert.throws(() => validateNativeRealtimeHandshake(new Forged()), NativeRealtimeProtocolError);
	const accessor = Object.defineProperty(offer(), 'frameCount', { get: () => 1_024, enumerable: true, configurable: true });
	assert.throws(() => validateNativeRealtimeHandshake(accessor), NativeRealtimeProtocolError);
	const symbolled = offer();
	Object.defineProperty(symbolled, Symbol('extra'), { value: 1, enumerable: true });
	assert.throws(() => validateNativeRealtimeHandshake(symbolled), NativeRealtimeProtocolError);

	// A null-prototype record is the one non-ordinary shape that is admitted: it
	// carries no inherited machinery for a peer to reach through.
	assert.equal(validateNativeRealtimeHandshake(Object.assign(Object.create(null) as object, offer())).generation, 1);
});

test('a handshake past the control envelope limit is refused without being echoed', () => {
	// The schema admits one string, which is the whole lever a peer has to make
	// either side carry more than the 64 KiB a control envelope is bounded at.
	const oversize = offer({ sampleFormat: 'x'.repeat(PLATFORM_TRANSFER_HARD_LIMITS.messageBytes) });
	assert.throws(() => validateNativeRealtimeHandshake(oversize), (error: unknown) => {
		if (!(error instanceof NativeRealtimeProtocolError)) throw new Error(`an oversize envelope threw ${String(error)}`);
		assert.equal(error.code, 'PAYLOAD_TOO_LARGE');
		assert.ok(error.message.length <= 512, `the refusal echoed ${error.message.length} characters of what it refused`);
		return true;
	});

	const { client, transport } = createClient();
	const probe = createPort();
	const outcome = client.receive(oversize, [probe.port]);
	assert.equal(refusal(outcome), 'malformed-handshake');
	assert.ok(outcome.status === 'refused' && outcome.message.length <= 512,
		'a typed refusal must not carry the payload it refused');
	assert.equal(probe.closeCount, 1);
	assert.deepEqual(transport.attached, []);

	// A value small enough to ride inside the envelope but far longer than the
	// ten-character literal it has to equal must still not become the size of the
	// refusal that names it.
	const wordy = offer({ sampleFormat: 'x'.repeat(20_000) });
	assert.throws(() => validateNativeRealtimeHandshake(wordy), (error: unknown) => {
		if (!(error instanceof NativeRealtimeProtocolError)) throw new Error(`a long sampleFormat threw ${String(error)}`);
		assert.equal(error.code, 'INVALID_FIELD');
		assert.equal(error.field, 'sampleFormat');
		assert.ok(error.message.length <= 256, `the refusal echoed ${error.message.length} characters of what it refused`);
		return true;
	});

	// A key explosion is charged the same way, so neither lever is unbounded.
	const keys: Record<string, unknown> = {};
	for (let index = 0; index < 20_000; index += 1) keys[`key-${index}`] = index;
	assert.throws(() => validateNativeRealtimeHandshake(keys), (error: unknown) => {
		if (!(error instanceof NativeRealtimeProtocolError)) throw new Error(`a key explosion threw ${String(error)}`);
		assert.equal(error.code, 'PAYLOAD_TOO_LARGE');
		return true;
	});
});

test('a requested format is normalized against the same bounds the wire enforces', () => {
	assert.deepEqual({ ...normalizeNativeRealtimeFormat({ sampleRate: 44_100, channelCount: 1 }) }, {
		sampleFormat: NATIVE_REALTIME_SAMPLE_FORMAT,
		sampleRate: 44_100,
		channelCount: 1,
		frameCount: NATIVE_REALTIME_PACKET_FRAMES,
		queueCapacity: NATIVE_REALTIME_MAX_QUEUE_PACKETS,
	});
	assert.throws(() => normalizeNativeRealtimeFormat({ sampleRate: 48_000, channelCount: 33 }), NativeRealtimeProtocolError);
	assert.throws(() => normalizeNativeRealtimeFormat({ sampleRate: 0, channelCount: 2 }), NativeRealtimeProtocolError);

	const expected = normalizeNativeRealtimeFormat(REQUEST);
	assert.equal(describeNativeRealtimeFormatMismatch(expected, expected), null);
	assert.match(
		describeNativeRealtimeFormatMismatch(expected, { ...expected, channelCount: 6 }) ?? '',
		/^channelCount was requested as 2 and declared as 6$/u,
	);
});

test('a matching offer is handed straight to the worklet with the port on the transfer list', () => {
	const { client, transport } = createClient();
	const probe = createPort();
	assert.deepEqual(client.receive(offer(), [probe.port]), { status: 'attached', generation: 1 });
	assert.equal(transport.attached.length, 1);
	assert.equal(transport.attached[0].port, probe.port);
	assert.equal(transport.attached[0].generation, 1);
	assert.equal(probe.closeCount, 0, 'an attached port belongs to the worklet, not to this thread');
	assert.equal(client.generation, 1);
	assert.deepEqual({ ...client.format }, {
		sampleFormat: NATIVE_REALTIME_SAMPLE_FORMAT, sampleRate: 48_000, channelCount: 2, frameCount: 1_024, queueCapacity: 8,
	});

	const next = createPort();
	assert.deepEqual(client.receive(offer({ generation: 2, startFrame: 1_024 }), [next.port]), { status: 'attached', generation: 2 });
	assert.equal(transport.attached.length, 2);
	assert.equal(client.generation, 2);
});

test('a handshake that disagrees with what the graph asked for is refused before the port moves', () => {
	for (const override of [
		{ channelCount: 1 },
		{ channelCount: 4 },
		{ frameCount: 512 },
		{ sampleRate: 44_100 },
		{ queueCapacity: 12 },
	]) {
		const { client, transport } = createClient();
		const probe = createPort();
		assert.equal(refusal(client.receive(offer(override), [probe.port])), 'format-mismatch', JSON.stringify(override));
		assert.equal(probe.closeCount, 1, 'a refused port is closed, never parked');
		assert.deepEqual(transport.attached, [], 'a mismatched stream must never reach the audio thread');
		assert.equal(client.generation, 0);
	}
});

test('a malformed handshake is refused and its port closed', () => {
	const { client, transport } = createClient();
	for (const value of [offer({ evil: 1 }), offer({ protocolVersion: 2 }), offer({ sampleFormat: 's16' }), 'handshake', null]) {
		const probe = createPort();
		assert.equal(refusal(client.receive(value, [probe.port])), 'malformed-handshake');
		assert.equal(probe.closeCount, 1);
	}
	assert.deepEqual(transport.attached, []);
});

test('an offer that does not carry exactly one port is refused and every port closed', () => {
	const { client, transport } = createClient();
	assert.equal(refusal(client.receive(offer(), [])), 'no-port');
	assert.equal(refusal(client.receive(offer())), 'no-port');

	const first = createPort();
	const second = createPort();
	assert.equal(refusal(client.receive(offer(), [first.port, second.port])), 'no-port');
	assert.equal(first.closeCount, 1);
	assert.equal(second.closeCount, 1);
	assert.equal(refusal(client.receive(offer(), [{} as NativeRealtimeTransferredPort])), 'no-port');
	assert.equal(refusal(client.receive(offer(), [undefined as unknown as NativeRealtimeTransferredPort])), 'no-port');
	assert.deepEqual(transport.attached, []);
});

test('a generation that has already been attached or retired cannot be replayed', () => {
	const { client, transport } = createClient();
	const first = createPort();
	client.receive(offer({ generation: 4 }), [first.port]);

	for (const generation of [4, 3, 1]) {
		const probe = createPort();
		assert.equal(refusal(client.receive(offer({ generation }), [probe.port])), 'stale-generation');
		assert.equal(probe.closeCount, 1);
	}
	assert.equal(transport.attached.length, 1);
	assert.equal(client.generation, 4);
});

test('a generation that has been revoked or lost can never be replayed into the worklet', () => {
	const { client, transport } = createClient();
	client.receive(offer({ generation: 2 }), [createPort().port]);
	assert.equal(client.revoke('cancelled'), 2);
	assert.equal(client.generation, 0);

	// Revocation frees the graph, not the ledger. A real-time generation has
	// already been heard by the time it could be offered again, which is why
	// NATIVE_REALTIME_REPLAY_POLICY.realtime is 'never' — re-attaching one would
	// play stale audio into the device.
	const replay = createPort();
	assert.equal(refusal(client.receive(offer({ generation: 2 }), [replay.port])), 'stale-generation');
	assert.equal(replay.closeCount, 1);
	assert.deepEqual(transport.attached.map(({ generation }) => generation), [2]);

	client.receive(offer({ generation: 3 }), [createPort().port]);
	assert.equal(client.notifyPeerLoss(), 3);
	const afterLoss = createPort();
	assert.equal(refusal(client.receive(offer({ generation: 3 }), [afterLoss.port])), 'stale-generation');
	assert.equal(refusal(client.receive(offer({ generation: 1 }), [createPort().port])), 'stale-generation');
	assert.equal(afterLoss.closeCount, 1);
	assert.deepEqual(transport.attached.map(({ generation }) => generation), [2, 3]);
	assert.equal(client.receive(offer({ generation: 4 }), [createPort().port]).status, 'attached');
});

test('a transport that disposes the client mid-attach never reports an attached generation', () => {
	const holder: { client: NativeRealtimeClient | null } = { client: null };
	let disposals = 0;
	const transport: NativeRealtimeWorkletTransport = {
		// A worklet node tears the graph down on its own errors, so `attach` can
		// dispose this client before it returns the generation it authorized.
		attach(_port, config): number { holder.client?.dispose(); return config.generation; },
		revoke(): number { return 0; },
		notifyPeerLoss(): number { return 0; },
		dispose(): void { disposals += 1; },
	};
	holder.client = createNativeRealtimeClient({ transport, request: REQUEST });
	const client = holder.client;
	const probe = createPort();

	assert.equal(refusal(client.receive(offer(), [probe.port])), 'client-disposed');
	assert.equal(probe.closeCount, 0, 'a port `attach` already transferred belongs to the worklet, not to this thread');
	assert.equal(client.disposed, true);
	assert.equal(client.generation, 0, 'a disposed client must not carry a live generation');
	assert.equal(disposals, 1);
	assert.equal(client.revoke(), 0);
});

test('a worklet that refuses the attach leaves the client without a generation', () => {
	const { client, transport } = createClient();
	transport.failAttach = new RangeError('a native realtime generation must increase');
	const probe = createPort();
	const outcome = client.receive(offer(), [probe.port]);
	assert.equal(refusal(outcome), 'attach-failed');
	assert.equal(outcome.status === 'refused' ? outcome.message : '', 'a native realtime generation must increase');
	assert.equal(probe.closeCount, 1);
	assert.equal(client.generation, 0);

	// A worklet that throws something that is not an Error still produces a
	// typed refusal rather than escaping into the offer handler.
	transport.failAttach = 'the processor is gone';
	const thrown = createPort();
	const nonError = client.receive(offer({ generation: 2 }), [thrown.port]);
	assert.equal(refusal(nonError), 'attach-failed');
	assert.equal(nonError.status === 'refused' ? nonError.message : '', 'the processor is gone');
	assert.equal(thrown.closeCount, 1);

	// The failure is not sticky: the next offer is judged on its own merits.
	transport.failAttach = null;
	const retry = createPort();
	assert.equal(client.receive(offer({ generation: 3 }), [retry.port]).status, 'attached');
	assert.equal(retry.closeCount, 0);
});

test('revocation and peer loss end the generation once and are inert without one', () => {
	const { client, transport } = createClient();
	assert.equal(client.revoke(), 0);
	assert.equal(client.notifyPeerLoss(), 0);
	assert.deepEqual(transport.revocations, []);
	assert.equal(transport.peerLosses, 0);

	client.receive(offer(), [createPort().port]);
	assert.equal(client.revoke('cancelled'), 1);
	assert.equal(client.revoke('cancelled'), 0);
	assert.deepEqual(transport.revocations, ['cancelled']);
	assert.equal(client.generation, 0);

	client.receive(offer({ generation: 2 }), [createPort().port]);
	assert.equal(client.notifyPeerLoss(), 2);
	assert.equal(client.notifyPeerLoss(), 0);
	assert.equal(transport.peerLosses, 1);
	assert.equal(client.generation, 0);
});

test('a transport that throws while ending a generation still ends it exactly once', () => {
	for (const seam of ['revoke', 'notifyPeerLoss'] as const) {
		const { client, transport } = createClient();
		client.receive(offer(), [createPort().port]);
		let calls = 0;
		transport[seam] = (): number => { calls += 1; throw new Error('the processor is gone'); };

		// The generation is over whether or not the worklet acknowledged it; a
		// caller that retries must not be able to revoke the same one twice.
		assert.throws(() => client[seam](), /the processor is gone/u, seam);
		assert.equal(client.generation, 0, seam);
		assert.equal(client[seam](), 0, seam);
		assert.equal(calls, 1, `${seam} ran twice for one generation`);
	}
});

test('a disposed client disposes the transport once and closes every later offer', () => {
	const { client, transport } = createClient();
	client.receive(offer(), [createPort().port]);
	client.dispose();
	client.dispose();
	assert.equal(transport.disposals, 1);
	assert.equal(client.disposed, true);
	assert.equal(client.generation, 0);
	assert.equal(client.revoke(), 0);
	assert.equal(client.notifyPeerLoss(), 0);

	const late = createPort();
	assert.equal(refusal(client.receive(offer({ generation: 2 }), [late.port])), 'client-disposed');
	assert.equal(late.closeCount, 1);
	assert.equal(transport.attached.length, 1);
});

test('a port whose close throws still counts as refused and is never closed twice', () => {
	const transport = createTransport();
	const closed: NativeRealtimeTransferredPort[] = [];
	const client = createNativeRealtimeClient({
		transport,
		request: REQUEST,
		closePort: (port) => {
			closed.push(port);
			throw new Error('the helper is already gone');
		},
	});
	const port: NativeRealtimeTransferredPort = { close(): void { /* unreachable */ } };
	assert.equal(refusal(client.receive(offer({ channelCount: 1 }), [port])), 'format-mismatch');
	assert.equal(refusal(client.receive(offer({ channelCount: 1 }), [port])), 'format-mismatch');
	assert.deepEqual(closed, [port]);
	assert.deepEqual([...NATIVE_REALTIME_CLIENT_REFUSALS].sort(), [
		'attach-failed', 'client-disposed', 'format-mismatch', 'malformed-handshake', 'no-port', 'stale-generation',
	]);
});
