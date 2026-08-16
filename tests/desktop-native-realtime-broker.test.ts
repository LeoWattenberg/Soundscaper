/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DesktopNativeRealtimeBroker,
	NATIVE_REALTIME_BROKER_CLOSE_REASONS,
	NATIVE_REALTIME_BROKER_REFUSALS,
	NATIVE_REALTIME_PORT_CHANNEL,
	type NativeRealtimeAuthorization,
	type NativeRealtimeBrokerCloseEvent,
	type NativeRealtimeBrokerOutcome,
	type NativeRealtimeOwnerTarget,
} from '../desktop/native-realtime-broker.ts';
import type {
	NativeRealtimeHandshake,
	NativeRealtimeTransferredPort,
} from '../src/common/editor/native-realtime-client.ts';

/**
 * Every property the broker touches on a transferred port is recorded, so the
 * milestone's load-bearing claim — main is present for setup and revocation and
 * absent from every block — is proven rather than asserted by inspection.
 */
interface PortProbe {
	readonly port: NativeRealtimeTransferredPort;
	readonly touched: readonly string[];
	readonly closeCount: () => number;
}

function createPort(): PortProbe {
	const touched: string[] = [];
	let closeCount = 0;
	const target = {
		close(): void { closeCount += 1; },
		postMessage(): void { throw new Error('main must never post on a brokered port'); },
		start(): void { throw new Error('main must never start a brokered port'); },
		addEventListener(): void { throw new Error('main must never listen on a brokered port'); },
		on(): void { throw new Error('main must never listen on a brokered port'); },
		set onmessage(_listener: unknown) { throw new Error('main must never read a brokered port'); },
	};
	const port = new Proxy(target, {
		get(object, key, receiver): unknown {
			touched.push(String(key));
			return Reflect.get(object, key, receiver) as unknown;
		},
		set(object, key, value, receiver): boolean {
			touched.push(`set:${String(key)}`);
			return Reflect.set(object, key, value, receiver);
		},
	}) as unknown as NativeRealtimeTransferredPort;
	return { port, touched, closeCount: () => closeCount };
}

interface OwnerProbe extends NativeRealtimeOwnerTarget {
	readonly deliveries: { channel: string; message: NativeRealtimeHandshake; transfer: readonly NativeRealtimeTransferredPort[] }[];
	fail: boolean;
	/** Runs inside `postMessage`, which is where a renderer's own teardown runs. */
	duringDelivery: (() => void) | null;
}

function createOwner(): OwnerProbe {
	const deliveries: OwnerProbe['deliveries'] = [];
	return {
		deliveries,
		fail: false,
		duringDelivery: null,
		postMessage(channel, message, transfer): void {
			if (this.fail) throw new Error('the renderer is gone');
			deliveries.push({ channel, message, transfer });
			this.duringDelivery?.();
		},
	};
}

interface Harness {
	readonly broker: DesktopNativeRealtimeBroker;
	readonly owner: OwnerProbe;
	readonly closes: NativeRealtimeBrokerCloseEvent[];
	setEnabled(value: boolean): void;
}

// Every reason and refusal the suite actually observes, so the last test can
// prove the published vocabulary is exactly the reachable one. A constant that
// only a deepEqual ever reads would pass against a broker that never used it.
const observedReasons = new Set<string>();
const observedRefusals = new Set<string>();

function createBroker(enabled = true, owner = createOwner()): Harness {
	const closes: NativeRealtimeBrokerCloseEvent[] = [];
	let current = enabled;
	const broker = new DesktopNativeRealtimeBroker({
		isEnabled: () => current,
		onClose: (event) => {
			observedReasons.add(event.reason);
			if (event.refusal !== null) observedRefusals.add(event.refusal);
			closes.push(event);
		},
	});
	return { broker, owner, closes, setEnabled: (value) => { current = value; } };
}

const FORMAT = Object.freeze({ sampleRate: 48_000, channelCount: 2, frameCount: 1_024, queueCapacity: 8 });

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

function authorized(outcome: NativeRealtimeAuthorization): number {
	assert.equal(outcome.status, 'authorized');
	if (outcome.status !== 'authorized') throw new Error('unreachable');
	return outcome.generation;
}

function refused(outcome: NativeRealtimeAuthorization | NativeRealtimeBrokerOutcome): string {
	assert.equal(outcome.status, 'refused');
	if (outcome.status !== 'refused') throw new Error('unreachable');
	assert.ok((NATIVE_REALTIME_BROKER_REFUSALS as readonly string[]).includes(outcome.refusal),
		`${outcome.refusal} is outside the published refusal vocabulary`);
	// A refusal main hands back must never carry the payload it refused, whatever
	// the helper put in the envelope: the reason is main's own text, not an echo.
	assert.ok(outcome.message.length <= 512, `a ${outcome.refusal} refusal echoed ${outcome.message.length} characters`);
	observedRefusals.add(outcome.refusal);
	return outcome.refusal;
}

/** Nothing but `close` may ever be named on a port main hands across. */
function assertNeverRead(probe: PortProbe): void {
	assert.deepEqual([...new Set(probe.touched)].sort(), ['close'],
		'the broker must only ever name close() on a transferred port');
}

test('a brokered port reaches exactly one renderer and main never reads it', () => {
	const { broker, owner } = createBroker();
	const generation = authorized(broker.authorize({ owner, ...FORMAT }));
	assert.equal(generation, 1);
	const probe = createPort();
	const outcome = broker.acceptHelperPort(offer(), [probe.port]);

	assert.deepEqual(outcome, { status: 'delivered', generation: 1 });
	assert.equal(owner.deliveries.length, 1);
	const [delivery] = owner.deliveries;
	assert.equal(delivery.channel, NATIVE_REALTIME_PORT_CHANNEL);
	// Compared by identity rather than deeply, because walking the port would be
	// the very property access this test exists to prove the broker never makes.
	assert.equal(delivery.transfer.length, 1);
	assert.equal(delivery.transfer[0], probe.port);
	assert.ok(!Object.values(delivery.message).includes(probe.port as never),
		'the port must ride the transfer list, never the message body');
	assert.deepEqual(delivery.message, {
		protocolVersion: 1, generation: 1, sampleFormat: 'f32-planar', sampleRate: 48_000,
		channelCount: 2, frameCount: 1_024, queueCapacity: 8, startFrame: 0,
	});
	assert.equal(probe.closeCount(), 0);
	assertNeverRead(probe);
	assert.deepEqual(broker.snapshot(), {
		enabled: true, owned: true, liveGeneration: 1, pendingGeneration: null, issuedGenerations: 1,
	});
});

test('one live port per owner per generation: a second port for the live generation is refused', () => {
	const { broker, owner, closes } = createBroker();
	broker.authorize({ owner, ...FORMAT });
	const first = createPort();
	assert.equal(broker.acceptHelperPort(offer(), [first.port]).status, 'delivered');

	const second = createPort();
	assert.equal(refused(broker.acceptHelperPort(offer(), [second.port])), 'generation-occupied');
	assert.equal(second.closeCount(), 1, 'a refused port is closed, never parked');
	assert.equal(first.closeCount(), 0, 'the live stream is not disturbed by a refused offer');
	assert.equal(owner.deliveries.length, 1);
	assert.deepEqual(closes, [{ generation: 1, reason: 'refused', refusal: 'generation-occupied' }]);
	assertNeverRead(second);
});

test('a new generation supersedes the previous one and closes its port exactly once', () => {
	const { broker, owner, closes } = createBroker();
	broker.authorize({ owner, ...FORMAT });
	const first = createPort();
	broker.acceptHelperPort(offer(), [first.port]);

	assert.equal(authorized(broker.authorize({ owner, ...FORMAT })), 2);
	assert.equal(first.closeCount(), 0, 'the running stream survives until its replacement lands');
	const second = createPort();
	assert.equal(broker.acceptHelperPort(offer({ generation: 2 }), [second.port]).status, 'delivered');
	assert.equal(first.closeCount(), 1);
	assert.deepEqual(closes, [{ generation: 1, reason: 'superseded', refusal: null }]);

	// The same port object offered again must not be closed a second time, and
	// must not be reported a second time either: the first cause a port ended
	// for is the one the surface keeps.
	assert.equal(refused(broker.acceptHelperPort(offer(), [first.port])), 'stale-generation');
	assert.equal(first.closeCount(), 1);

	broker.dispose();
	broker.dispose();
	assert.equal(second.closeCount(), 1);
	assert.deepEqual(closes.map(({ reason }) => reason), ['superseded', 'disposed']);
	assert.equal(owner.deliveries.length, 2);
});

test('owner loss closes the live port once and refuses the port the helper was still preparing', () => {
	const { broker, owner, closes } = createBroker();
	broker.authorize({ owner, ...FORMAT });
	const live = createPort();
	broker.acceptHelperPort(offer(), [live.port]);
	assert.equal(authorized(broker.authorize({ owner, ...FORMAT })), 2);

	broker.revokeOwner(owner);
	broker.revokeOwner(owner);
	assert.equal(live.closeCount(), 1);
	assert.deepEqual(closes, [{ generation: 1, reason: 'owner-revoked', refusal: null }]);
	assert.equal(broker.snapshot().owned, false);

	const late = createPort();
	assert.equal(refused(broker.acceptHelperPort(offer({ generation: 2 }), [late.port])), 'foreign-owner');
	assert.equal(late.closeCount(), 1);
	assert.equal(owner.deliveries.length, 1, 'a departed owner is never posted to again');

	// The surface is free, so another renderer may take it over.
	const next = createOwner();
	assert.equal(authorized(broker.authorize({ owner: next, ...FORMAT })), 3);
});

test('a helper exit closes the live port once and retires the generation it was serving', () => {
	const { broker, owner, closes } = createBroker();
	broker.authorize({ owner, ...FORMAT });
	const live = createPort();
	broker.acceptHelperPort(offer(), [live.port]);

	broker.notifyHelperExit();
	broker.notifyHelperExit();
	assert.equal(live.closeCount(), 1);
	assert.deepEqual(closes, [{ generation: 1, reason: 'helper-exit', refusal: null }]);
	assert.equal(broker.snapshot().liveGeneration, null);

	// A restarted helper cannot resurrect a generation that has already been
	// heard; it costs a fresh authorization from the owner that still holds the
	// surface.
	const zombie = createPort();
	assert.equal(refused(broker.acceptHelperPort(offer(), [zombie.port])), 'stale-generation');
	assert.equal(zombie.closeCount(), 1);
	assert.equal(authorized(broker.authorize({ owner, ...FORMAT })), 2);
	const restarted = createPort();
	assert.equal(broker.acceptHelperPort(offer({ generation: 2 }), [restarted.port]).status, 'delivered');
});

test('a disabled surface authorizes nothing and closes any port it is offered', () => {
	const off = createBroker(false);
	assert.equal(refused(off.broker.authorize({ owner: off.owner, ...FORMAT })), 'surface-disabled');
	const refusedPort = createPort();
	assert.equal(refused(off.broker.acceptHelperPort(offer(), [refusedPort.port])), 'surface-disabled');
	assert.equal(refusedPort.closeCount(), 1);
	assert.deepEqual(off.closes, [{ generation: null, reason: 'refused', refusal: 'surface-disabled' }]);
	assertNeverRead(refusedPort);

	// Turning the surface off between authorization and the helper's answer must
	// refuse the port too: every helper surface is off by default and stays off.
	const { broker, owner, setEnabled } = createBroker();
	broker.authorize({ owner, ...FORMAT });
	setEnabled(false);
	const late = createPort();
	assert.equal(refused(broker.acceptHelperPort(offer(), [late.port])), 'surface-disabled');
	assert.equal(late.closeCount(), 1);
	assert.equal(owner.deliveries.length, 0);
});

test('a stale or never-authorized generation is refused and closed rather than parked', () => {
	const { broker, owner } = createBroker();
	const unknown = createPort();
	assert.equal(refused(broker.acceptHelperPort(offer({ generation: 5 }), [unknown.port])), 'unknown-generation');
	assert.equal(unknown.closeCount(), 1);

	assert.equal(authorized(broker.authorize({ owner, ...FORMAT })), 1);
	// Re-authorizing withdraws the request the helper has not answered yet.
	assert.equal(authorized(broker.authorize({ owner, ...FORMAT })), 2);
	const stale = createPort();
	assert.equal(refused(broker.acceptHelperPort(offer({ generation: 1 }), [stale.port])), 'stale-generation');
	assert.equal(stale.closeCount(), 1);

	const ahead = createPort();
	assert.equal(refused(broker.acceptHelperPort(offer({ generation: 3 }), [ahead.port])), 'unknown-generation');
	assert.equal(ahead.closeCount(), 1);
	assert.equal(owner.deliveries.length, 0, 'nothing outside the ledger reaches a renderer');
});

test('a second renderer owner is refused and no port ever reaches it', () => {
	const { broker, owner } = createBroker();
	assert.equal(authorized(broker.authorize({ owner, ...FORMAT })), 1);
	const intruder = createOwner();
	assert.equal(refused(broker.authorize({ owner: intruder, ...FORMAT })), 'foreign-owner');

	const port = createPort();
	assert.equal(refused(broker.acceptHelperPort(offer({ generation: 2 }), [port.port])), 'unknown-generation');
	assert.equal(port.closeCount(), 1);
	assert.deepEqual(intruder.deliveries, []);
	assert.equal(broker.snapshot().issuedGenerations, 1);
});

test('a malformed offer is refused before main deserializes anything unbounded', () => {
	const { broker, owner } = createBroker();
	broker.authorize({ owner, ...FORMAT });
	const cases: Readonly<Record<string, unknown>> = {
		'unknown key': offer({ evil: 'x'.repeat(1_000_000) }),
		'wrong version': offer({ protocolVersion: 2 }),
		'wrong sample format': offer({ sampleFormat: 'f32-interleaved' }),
		'over-long sample format': offer({ sampleFormat: 'x'.repeat(20_000) }),
		'non-integer generation': offer({ generation: 1.5 }),
		'generation zero': offer({ generation: 0 }),
		'oversize channel count': offer({ channelCount: 4_096 }),
		'missing field': (() => { const value = offer(); delete value.startFrame; return value; })(),
		'not a record': 'f32-planar',
		'array': [1, 2, 3],
	};
	for (const [label, value] of Object.entries(cases)) {
		const probe = createPort();
		assert.equal(refused(broker.acceptHelperPort(value, [probe.port])), 'malformed-offer', label);
		assert.equal(probe.closeCount(), 1, label);
	}

	// An accessor would make main run the helper's code just by reading a field.
	const accessor = createPort();
	const trap = Object.defineProperty(offer(), 'channelCount', { get: () => 2, enumerable: true, configurable: true });
	assert.equal(refused(broker.acceptHelperPort(trap, [accessor.port])), 'malformed-offer');
	assert.equal(accessor.closeCount(), 1);

	// The one string the schema admits is the lever a helper would use to make
	// main copy a megabyte into the refusal it reports for the megabyte.
	const bloated = createPort();
	const outcome = broker.acceptHelperPort(offer({ sampleFormat: 'x'.repeat(200_000) }), [bloated.port]);
	assert.equal(refused(outcome), 'malformed-offer');
	assert.equal(bloated.closeCount(), 1);
	assert.equal(owner.deliveries.length, 0);
});

test('a transfer list entry that is not a port is refused without crashing main', () => {
	const { broker, owner, closes } = createBroker();
	broker.authorize({ owner, ...FORMAT });
	assert.equal(refused(broker.acceptHelperPort(offer(), [undefined as unknown as NativeRealtimeTransferredPort])), 'malformed-offer');
	assert.equal(refused(broker.acceptHelperPort(offer(), [{} as NativeRealtimeTransferredPort])), 'malformed-offer');

	// A helper that pads its transfer list must still lose every real port it
	// sent, and the padding must not be reported as a generation that ended.
	const real = createPort();
	assert.equal(refused(broker.acceptHelperPort(offer(), [null as unknown as NativeRealtimeTransferredPort, real.port])), 'malformed-offer');
	assert.equal(real.closeCount(), 1);
	assert.deepEqual(closes, [{ generation: null, reason: 'refused', refusal: 'malformed-offer' }]);
	assert.equal(owner.deliveries.length, 0);
	assert.equal(broker.snapshot().pendingGeneration, 1, 'a malformed offer does not retire the authorization it failed to answer');
});

test('a ledger that moves inside the hand-off refuses the port instead of recording it live', () => {
	const drifts: readonly [string, string, (broker: DesktopNativeRealtimeBroker, owner: OwnerProbe) => void][] = [
		['the owner is revoked', 'foreign-owner', (broker, owner) => { broker.revokeOwner(owner); }],
		['the surface is disposed', 'surface-disabled', (broker) => { broker.dispose(); }],
		['the helper exits', 'stale-generation', (broker) => { broker.notifyHelperExit(); }],
		['a newer generation is authorized', 'stale-generation', (broker, owner) => { broker.authorize({ owner, ...FORMAT }); }],
	];
	for (const [label, expected, act] of drifts) {
		const owner = createOwner();
		const { broker, closes } = createBroker(true, owner);
		broker.authorize({ owner, ...FORMAT });
		// `postMessage` runs the renderer's own code, so the ledger main read
		// before the hand-off can be stale by the time the hand-off returns.
		owner.duringDelivery = () => { act(broker, owner); };
		const probe = createPort();

		assert.equal(refused(broker.acceptHelperPort(offer(), [probe.port])), expected, label);
		assert.equal(probe.closeCount(), 1, `${label}: a port the ledger no longer covers is closed, never left live`);
		assert.equal(broker.snapshot().liveGeneration, null, label);
		assert.equal(owner.deliveries.length, 1, label);
		assert.deepEqual(closes.filter(({ reason }) => reason === 'refused'),
			[{ generation: 1, reason: 'refused', refusal: expected }], label);

		// The decisive part: nothing can be asked to close the port later, so a
		// port kept here would stay open for the life of the process.
		broker.revokeOwner(owner);
		broker.notifyHelperExit();
		broker.dispose();
		assert.equal(probe.closeCount(), 1, `${label}: the port is closed exactly once`);
	}
});

test('an offer that is not exactly one port is refused and every port it carried is closed', () => {
	const { broker, owner } = createBroker();
	broker.authorize({ owner, ...FORMAT });
	assert.equal(refused(broker.acceptHelperPort(offer(), [])), 'malformed-offer');

	const first = createPort();
	const second = createPort();
	assert.equal(refused(broker.acceptHelperPort(offer(), [first.port, second.port])), 'malformed-offer');
	assert.equal(first.closeCount(), 1);
	assert.equal(second.closeCount(), 1);
	assert.equal(refused(broker.acceptHelperPort(offer())), 'malformed-offer');
	assert.equal(owner.deliveries.length, 0);
});

test('a declared stream that differs from the authorized one is refused', () => {
	for (const override of [
		{ channelCount: 1 },
		{ frameCount: 512 },
		{ sampleRate: 44_100 },
		{ queueCapacity: 9 },
	]) {
		const { broker, owner } = createBroker();
		broker.authorize({ owner, ...FORMAT });
		const probe = createPort();
		assert.equal(refused(broker.acceptHelperPort(offer(override), [probe.port])), 'format-mismatch',
			JSON.stringify(override));
		assert.equal(probe.closeCount(), 1);
		assert.equal(owner.deliveries.length, 0);
	}
});

test('a renderer that cannot receive the port loses it rather than leaking it', () => {
	const { broker, owner, closes } = createBroker();
	broker.authorize({ owner, ...FORMAT });
	owner.fail = true;
	const probe = createPort();
	assert.equal(refused(broker.acceptHelperPort(offer(), [probe.port])), 'delivery-failed');
	assert.equal(probe.closeCount(), 1);
	assert.deepEqual(closes, [{ generation: 1, reason: 'refused', refusal: 'delivery-failed' }]);

	// The withdrawn authorization does not survive the failure, so a retry costs
	// a fresh generation rather than reusing one a renderer never received.
	owner.fail = false;
	const retry = createPort();
	assert.equal(refused(broker.acceptHelperPort(offer(), [retry.port])), 'stale-generation');
	assert.equal(retry.closeCount(), 1);
	assert.equal(broker.snapshot().liveGeneration, null);
});

test('an unauthorized format is refused before a generation is minted', () => {
	const { broker, owner } = createBroker();
	assert.equal(refused(broker.authorize({ owner, sampleRate: 7_999, channelCount: 2 })), 'format-mismatch');
	assert.equal(refused(broker.authorize({ owner, sampleRate: 48_000, channelCount: 0 })), 'format-mismatch');
	assert.equal(broker.snapshot().issuedGenerations, 0);
	assert.equal(broker.snapshot().owned, false);
});

test('disposal closes the live port once and refuses everything afterwards', () => {
	const { broker, owner, closes } = createBroker();
	broker.authorize({ owner, ...FORMAT });
	const live = createPort();
	broker.acceptHelperPort(offer(), [live.port]);

	broker.dispose();
	broker.dispose();
	assert.equal(live.closeCount(), 1);
	assert.deepEqual(closes, [{ generation: 1, reason: 'disposed', refusal: null }]);
	assert.equal(refused(broker.authorize({ owner, ...FORMAT })), 'surface-disabled');
	const late = createPort();
	assert.equal(refused(broker.acceptHelperPort(offer(), [late.port])), 'surface-disabled');
	assert.equal(late.closeCount(), 1);
	assert.deepEqual(broker.snapshot(), {
		enabled: false, owned: false, liveGeneration: null, pendingGeneration: null, issuedGenerations: 1,
	});
});

// Last on purpose: the collectors above are only complete once every
// behavioural test in this file has run.
test('every published broker reason and refusal is one the broker actually reaches', () => {
	assert.deepEqual([...observedReasons].sort(), [...NATIVE_REALTIME_BROKER_CLOSE_REASONS].sort(),
		'a close reason nothing reaches is vocabulary the surface does not have');
	assert.deepEqual([...observedRefusals].sort(), [...NATIVE_REALTIME_BROKER_REFUSALS].sort(),
		'a refusal nothing reaches is vocabulary the surface does not have');
});
