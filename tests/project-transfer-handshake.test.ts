/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	PROJECT_TRANSFER_MAX_ENTRIES,
	PROJECT_TRANSFER_MAX_PENDING_MESSAGES,
	PROJECT_TRANSFER_PROTOCOL_ID,
	PROJECT_TRANSFER_PROTOCOL_VERSION,
	ProjectTransferProtocolError,
	type ProjectTransferClock,
	type ProjectTransferEntry,
	type ProjectTransferInboundMessage,
	type ProjectTransferPort,
	admitProjectTransferMessage,
	receiveProjectTransfer,
	sendProjectTransfer,
} from '../src/common/transfer/project-transfer-handshake.ts';

const SENDER_ORIGIN = 'https://soundscaper.org';
const RECEIVER_ORIGIN = 'https://framescaper.org';
const HOSTILE_ORIGIN = 'https://scape-thief.example';
const SESSION = 'session-1';

type Listener = (message: ProjectTransferInboundMessage) => void;
type WireMessage = Record<string, unknown>;

interface Wire {
	readonly senderPort: ProjectTransferPort;
	readonly receiverPort: ProjectTransferPort;
	deliverToSender(origin: string, data: unknown): void;
	deliverToReceiver(origin: string, data: unknown): void;
}

/**
 * A fake of the only window behaviour the protocol depends on: a post names
 * one target origin and is dropped unless the peer document is on it, and a
 * delivery carries the posting document's origin, not one the payload claims.
 */
function createWire(): Wire {
	const senderListeners = new Set<Listener>();
	const receiverListeners = new Set<Listener>();
	const deliver = (listeners: Set<Listener>, origin: string, data: unknown): void => {
		queueMicrotask(() => {
			for (const listener of [...listeners]) listener({ origin, data });
		});
	};
	const port = (selfOrigin: string, peerOrigin: string, own: Set<Listener>, peer: Set<Listener>): ProjectTransferPort => ({
		post(message: unknown, targetOrigin: string): void {
			if (targetOrigin !== peerOrigin) return;
			deliver(peer, selfOrigin, message);
		},
		subscribe(listener: Listener): () => void {
			own.add(listener);
			return () => own.delete(listener);
		},
	});
	return {
		senderPort: port(SENDER_ORIGIN, RECEIVER_ORIGIN, senderListeners, receiverListeners),
		receiverPort: port(RECEIVER_ORIGIN, SENDER_ORIGIN, receiverListeners, senderListeners),
		deliverToSender: (origin, data) => deliver(senderListeners, origin, data),
		deliverToReceiver: (origin, data) => deliver(receiverListeners, origin, data),
	};
}

interface ManualClock extends ProjectTransferClock {
	pending(): number;
	fire(): void;
}

/** No real timers, so every await bound is exercised on demand. */
function createManualClock(): ManualClock {
	const timers = new Map<number, () => void>();
	let nextHandle = 1;
	return {
		setTimeout(callback: () => void): unknown {
			const handle = nextHandle;
			nextHandle += 1;
			timers.set(handle, callback);
			return handle;
		},
		clearTimeout(handle: unknown): void {
			timers.delete(handle as number);
		},
		pending: () => timers.size,
		fire(): void {
			const callbacks = [...timers.values()];
			timers.clear();
			for (const callback of callbacks) callback();
		},
	};
}

interface Peer {
	readonly inbox: WireMessage[];
	post(data: WireMessage): void;
	next(): Promise<WireMessage>;
}

/** A hand-driven peer, so one side of the protocol can be made to misbehave. */
function createPeer(port: ProjectTransferPort, targetOrigin: string): Peer {
	const inbox: WireMessage[] = [];
	let notify: (() => void) | null = null;
	port.subscribe((message) => {
		inbox.push(message.data as WireMessage);
		const waiting = notify;
		notify = null;
		waiting?.();
	});
	return {
		inbox,
		post: (data) => port.post(data, targetOrigin),
		async next(): Promise<WireMessage> {
			while (inbox.length === 0) {
				await new Promise<void>((resolve) => {
					notify = resolve;
				});
			}
			return inbox.shift() as WireMessage;
		},
	};
}

function envelope(sessionId = SESSION, protocolVersion = PROJECT_TRANSFER_PROTOCOL_VERSION) {
	return { protocol: PROJECT_TRANSFER_PROTOCOL_ID, protocolVersion, sessionId };
}

function readyMessage(maxEntries = 4, maxEntryBytes = 1024): WireMessage {
	return { ...envelope(), kind: 'ready', maxEntries, maxEntryBytes };
}

function entryMessage(
	sequence: number,
	entryId: string,
	byteLength = 1,
	payload: Uint8Array<ArrayBufferLike> = new Uint8Array(byteLength),
): WireMessage {
	return {
		...envelope(), kind: 'entry', sequence, entryId, name: `${entryId}.scape`, byteLength, payload,
		conversionReportSidecar: null,
	};
}

function ackMessage(sequence: number, entryId: string, status = 'stored'): WireMessage {
	return { ...envelope(), kind: 'ack', sequence, entryId, status, reason: '' };
}

function entry(entryId: string, byte: number, byteLength = 4): ProjectTransferEntry {
	const payload = new Uint8Array(byteLength).fill(byte);
	return { entryId, name: `${entryId}.scape`, byteLength, payload, conversionReportSidecar: null };
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

/** Asserts the promise failed as a protocol error and hands it over. */
async function failureFrom(promise: Promise<unknown>): Promise<ProjectTransferProtocolError> {
	const [result] = await Promise.allSettled([promise]);
	assert.equal(result.status, 'rejected', 'the transfer was expected to fail');
	const reason = (result as PromiseRejectedResult).reason as unknown;
	assert.ok(reason instanceof ProjectTransferProtocolError, `not a protocol error: ${String(reason)}`);
	return reason;
}

interface RoleOptions {
	readonly entries?: readonly ProjectTransferEntry[];
	readonly acceptEntry?: (entry: ProjectTransferEntry) => Promise<void> | void;
	readonly senderSignal?: AbortSignal;
	readonly receiverSignal?: AbortSignal;
	readonly maxEntries?: number;
	readonly maxEntryBytes?: number;
	readonly timeoutMilliseconds?: number;
}

function startSender(wire: Wire, clock: ProjectTransferClock, options: RoleOptions = {}) {
	return sendProjectTransfer({
		port: wire.senderPort,
		targetOrigin: RECEIVER_ORIGIN,
		allowedOrigins: [RECEIVER_ORIGIN],
		entries: options.entries ?? [entry('alpha', 1)],
		timeoutMilliseconds: options.timeoutMilliseconds,
		clock,
		signal: options.senderSignal ?? null,
	});
}

function startReceiver(wire: Wire, clock: ProjectTransferClock, options: RoleOptions, stored: ProjectTransferEntry[] = []) {
	return receiveProjectTransfer({
		port: wire.receiverPort,
		targetOrigin: SENDER_ORIGIN,
		allowedOrigins: [SENDER_ORIGIN],
		sessionId: SESSION,
		maxEntries: options.maxEntries,
		maxEntryBytes: options.maxEntryBytes,
		clock,
		signal: options.receiverSignal ?? null,
		acceptEntry: async (received) => {
			if (options.acceptEntry) await options.acceptEntry(received);
			stored.push(received);
		},
	});
}

/** The sender under test, talking to a peer the test drives by hand. */
function senderAgainstPeer(options: RoleOptions = {}) {
	const wire = createWire();
	const clock = createManualClock();
	const peer = createPeer(wire.receiverPort, SENDER_ORIGIN);
	return { wire, clock, peer, sender: startSender(wire, clock, options) };
}

/** The receiver under test, talking to a peer the test drives by hand. */
function receiverAgainstPeer(options: RoleOptions = {}) {
	const wire = createWire();
	const clock = createManualClock();
	const peer = createPeer(wire.senderPort, RECEIVER_ORIGIN);
	return { wire, clock, peer, receiver: startReceiver(wire, clock, options) };
}

function bothRoles(options: RoleOptions) {
	const wire = createWire();
	const clock = createManualClock();
	const stored: ProjectTransferEntry[] = [];
	const sender = startSender(wire, clock, options);
	return { wire, clock, stored, sender, receiver: startReceiver(wire, clock, options, stored) };
}

test('a full round trip carries every entry and both sides agree on the report', async () => {
	const offered = [entry('alpha', 1), entry('beta', 2, 9), entry('gamma', 3)];
	const { clock, stored, sender, receiver } = bothRoles({ entries: offered });
	const [senderReport, receiverReport] = await Promise.all([sender, receiver]);

	assert.deepEqual(stored.map((held) => held.entryId), ['alpha', 'beta', 'gamma']);
	assert.deepEqual([...stored[1].payload], [2, 2, 2, 2, 2, 2, 2, 2, 2]);
	assert.equal(stored[1].name, 'beta.scape');
	assert.equal(senderReport.sessionId, SESSION);
	assert.equal(senderReport.protocolVersion, PROJECT_TRANSFER_PROTOCOL_VERSION);
	assert.equal(senderReport.entryCount, 3);
	assert.equal(senderReport.storedCount, 3);
	assert.equal(senderReport.failedCount, 0);
	assert.deepEqual(senderReport.entries.map((held) => held.status), ['stored', 'stored', 'stored']);
	assert.deepEqual(senderReport.entries, receiverReport.entries);
	assert.equal(clock.pending(), 0, 'both roles cleared their awaits');
});

test('a completed transfer carries per-entry failures back to the sender', async () => {
	const { sender, receiver } = bothRoles({
		entries: [entry('alpha', 1), entry('beta', 2), entry('gamma', 3)],
		acceptEntry: (received) => {
			if (received.entryId === 'beta') throw new Error('The project store is full.');
		},
	});
	const [senderReport, receiverReport] = await Promise.all([sender, receiver]);

	assert.equal(senderReport.entryCount, 3);
	assert.equal(senderReport.storedCount, 2);
	assert.equal(senderReport.failedCount, 1);
	assert.equal(senderReport.entries[1].entryId, 'beta');
	assert.equal(senderReport.entries[1].status, 'failed');
	assert.equal(senderReport.entries[1].reason, 'The project store is full.');
	assert.equal(senderReport.entries[1].name, 'beta.scape');
	assert.equal(receiverReport.failedCount, 1);
});

test('the sender refuses a protocol version it does not implement', async () => {
	const { peer, sender } = senderAgainstPeer();
	const unsupported = PROJECT_TRANSFER_PROTOCOL_VERSION + 1;
	peer.post({ ...envelope(SESSION, unsupported), kind: 'ready', maxEntries: 4, maxEntryBytes: 1024 });

	const failure = await failureFrom(sender);
	assert.equal(failure.code, 'PROTOCOL_VERSION');
	assert.match(failure.message, new RegExp(`version ${String(unsupported)}`, 'u'));
	const told = await peer.next();
	assert.equal(told.kind, 'abort');
	assert.match(String(told.reason), /PROTOCOL_VERSION/u);
	assert.equal(peer.inbox.length, 0, 'no entry was offered to an unknown protocol');
});

test('the receiver refuses a sender speaking an unnegotiated version', async () => {
	const { peer, receiver } = receiverAgainstPeer();
	assert.equal((await peer.next()).kind, 'ready');
	peer.post({ ...envelope(SESSION, 7), kind: 'begin', entryCount: 1 });

	assert.equal((await failureFrom(receiver)).code, 'PROTOCOL_VERSION');
});

test('messages from outside the origin allowlist are dropped in silence', async () => {
	const { wire, sender, receiver } = bothRoles({ entries: [entry('alpha', 1)] });
	// A hostile document that guesses the session cannot end the transfer,
	// cannot acknowledge for the peer, and is never answered.
	wire.deliverToSender(HOSTILE_ORIGIN, { ...envelope(), kind: 'abort', reason: 'stop' });
	wire.deliverToReceiver(HOSTILE_ORIGIN, { ...envelope(), kind: 'complete' });
	wire.deliverToSender(HOSTILE_ORIGIN, ackMessage(1, 'alpha', 'failed'));

	const [senderReport] = await Promise.all([sender, receiver]);
	assert.equal(senderReport.storedCount, 1);
	assert.equal(senderReport.entries[0].status, 'stored');
});

test('an allowlisted origin posting foreign traffic is ignored, not refused', async () => {
	const { wire, sender, receiver } = bothRoles({ entries: [entry('alpha', 1)] });
	wire.deliverToSender(RECEIVER_ORIGIN, { source: 'react-devtools-bridge' });
	wire.deliverToSender(RECEIVER_ORIGIN, 'vite:hmr');
	wire.deliverToReceiver(SENDER_ORIGIN, null);

	const [senderReport] = await Promise.all([sender, receiver]);
	assert.equal(senderReport.storedCount, 1);
});

test('a wildcard or inexact origin is refused before any window is addressed', async () => {
	const wire = createWire();
	const entries = [entry('alpha', 1)];
	const base = { port: wire.senderPort, allowedOrigins: [RECEIVER_ORIGIN], entries, clock: createManualClock() };
	const refusesOrigin = (error: ProjectTransferProtocolError) => error.code === 'INVALID_ORIGIN';
	await assert.rejects(sendProjectTransfer({ ...base, targetOrigin: '*' }), refusesOrigin);
	await assert.rejects(
		sendProjectTransfer({ ...base, allowedOrigins: ['*'], targetOrigin: RECEIVER_ORIGIN }),
		refusesOrigin,
	);
	await assert.rejects(
		sendProjectTransfer({ ...base, targetOrigin: `${RECEIVER_ORIGIN}/framescaper/` }),
		refusesOrigin,
	);
	await assert.rejects(
		sendProjectTransfer({ ...base, allowedOrigins: [], targetOrigin: RECEIVER_ORIGIN }),
		refusesOrigin,
	);
	await assert.rejects(
		sendProjectTransfer({ ...base, targetOrigin: 'https://elsewhere.example' }),
		(error: ProjectTransferProtocolError) => /not one of the permitted origins/u.test(error.message),
	);
});

test('an out-of-order acknowledgement ends the transfer', async () => {
	const { peer, sender } = senderAgainstPeer({ entries: [entry('alpha', 1), entry('beta', 2)] });
	peer.post(readyMessage());
	assert.equal((await peer.next()).kind, 'begin');
	assert.equal((await peer.next()).kind, 'entry');
	peer.post(ackMessage(2, 'alpha'));

	const failure = await failureFrom(sender);
	assert.equal(failure.code, 'SEQUENCE_MISMATCH');
	assert.match(failure.message, /entry 1 \(alpha\), received 2/u);
});

test('a repeated acknowledgement ends the transfer', async () => {
	const { peer, sender } = senderAgainstPeer({ entries: [entry('alpha', 1), entry('beta', 2)] });
	peer.post(readyMessage());
	assert.equal((await peer.next()).kind, 'begin');
	assert.equal((await peer.next()).kind, 'entry');
	peer.post(ackMessage(1, 'alpha'));
	peer.post(ackMessage(1, 'alpha'));

	const failure = await failureFrom(sender);
	assert.equal(failure.code, 'SEQUENCE_MISMATCH');
	assert.match(failure.message, /entry 2 \(beta\), received 1/u);
});

test('an acknowledgement naming another entry ends the transfer', async () => {
	const { peer, sender } = senderAgainstPeer();
	peer.post(readyMessage());
	await peer.next();
	await peer.next();
	peer.post(ackMessage(1, 'omega'));

	assert.equal((await failureFrom(sender)).code, 'SEQUENCE_MISMATCH');
});

test('a re-sent entry id and an out-of-order entry both end the transfer', async () => {
	// In sequence but already stored, then a skipped sequence: the receiver
	// must never store one archive twice and never accept a gap.
	for (const [sequence, code] of [[2, 'INVALID_FIELD'], [3, 'SEQUENCE_MISMATCH']] as const) {
		const { peer, receiver } = receiverAgainstPeer();
		await peer.next();
		peer.post({ ...envelope(), kind: 'begin', entryCount: 2 });
		peer.post(entryMessage(1, 'alpha'));
		assert.equal((await peer.next()).kind, 'ack');
		peer.post(entryMessage(sequence, 'alpha'));

		assert.equal((await failureFrom(receiver)).code, code);
	}
});

test('a session the receiver did not open ends the transfer', async () => {
	const { peer, receiver } = receiverAgainstPeer();
	await peer.next();
	peer.post({ ...envelope('session-2'), kind: 'begin', entryCount: 1 });

	assert.equal((await failureFrom(receiver)).code, 'SESSION_MISMATCH');
});

test('the sender refuses to offer more entries than the peer accepts', async () => {
	const { peer, sender } = senderAgainstPeer({ entries: [entry('alpha', 1), entry('beta', 2)] });
	peer.post(readyMessage(1));

	assert.equal((await failureFrom(sender)).code, 'TOO_MANY_ENTRIES');
	assert.equal((await peer.next()).kind, 'abort');
});

test('the sender refuses an entry larger than the peer accepts', async () => {
	const { peer, sender } = senderAgainstPeer({ entries: [entry('alpha', 1, 64)] });
	peer.post(readyMessage(4, 16));

	const failure = await failureFrom(sender);
	assert.equal(failure.code, 'PAYLOAD_TOO_LARGE');
	assert.match(failure.message, /the peer accepts 16/u);
});

test('an offer beyond the hard entry ceiling is refused before the channel opens', async () => {
	const entries = Array.from(
		{ length: PROJECT_TRANSFER_MAX_ENTRIES + 1 },
		(_, index) => entry(`project-${index}`, 1, 1),
	);
	assert.equal((await failureFrom(senderAgainstPeer({ entries }).sender)).code, 'TOO_MANY_ENTRIES');
	const repeated = senderAgainstPeer({ entries: [entry('alpha', 1), entry('alpha', 2)] });
	assert.match((await failureFrom(repeated.sender)).message, /offered twice/u);
});

test('the receiver refuses an offer and an entry beyond what it announced', async () => {
	for (const overrun of ['count', 'bytes'] as const) {
		const { peer, receiver } = receiverAgainstPeer({ maxEntries: 2, maxEntryBytes: 8 });
		const ready = await peer.next();
		assert.equal(ready.maxEntries, 2);
		assert.equal(ready.maxEntryBytes, 8);
		peer.post({ ...envelope(), kind: 'begin', entryCount: overrun === 'count' ? 3 : 1 });
		if (overrun === 'bytes') peer.post(entryMessage(1, 'alpha', 32));

		const failure = await failureFrom(receiver);
		assert.equal(failure.code, overrun === 'count' ? 'TOO_MANY_ENTRIES' : 'PAYLOAD_TOO_LARGE');
	}
});

test('a payload that contradicts its declared byte length is refused', async () => {
	const { peer, receiver } = receiverAgainstPeer();
	await peer.next();
	peer.post({ ...envelope(), kind: 'begin', entryCount: 1 });
	peer.post(entryMessage(1, 'alpha', 8, new Uint8Array(4)));

	const failure = await failureFrom(receiver);
	assert.equal(failure.code, 'INVALID_FIELD');
	assert.match(failure.message, /declares 8/u);
});

test('a peer that floods unanswered messages overruns the bounded mailbox', async () => {
	let release: (() => void) | null = null;
	const { peer, receiver } = receiverAgainstPeer({
		acceptEntry: () => new Promise<void>((resolve) => {
			release = resolve;
		}),
	});
	await peer.next();
	peer.post({ ...envelope(), kind: 'begin', entryCount: 2 });
	peer.post(entryMessage(1, 'alpha'));
	await settle();
	assert.ok(release, 'the receiver is inside acceptEntry with nothing awaited');
	for (let index = 0; index <= PROJECT_TRANSFER_MAX_PENDING_MESSAGES; index += 1) {
		peer.post({ ...envelope(), kind: 'complete' });
	}
	await settle();
	(release as () => void)();

	assert.equal((await failureFrom(receiver)).code, 'QUEUE_OVERFLOW');
});

test('a stalled peer fails the transfer on the await timeout', async () => {
	const { clock, peer, sender } = senderAgainstPeer({ timeoutMilliseconds: 250 });
	await settle();
	assert.equal(clock.pending(), 1, 'the sender is waiting on a bounded await');
	clock.fire();

	const failure = await failureFrom(sender);
	assert.equal(failure.code, 'TIMEOUT');
	assert.match(failure.message, /within 250 ms/u);
	assert.equal((await peer.next()).kind, 'abort');
});

test('a SharedArrayBuffer payload is refused on both sides of the wire', async () => {
	const shared = new Uint8Array(new SharedArrayBuffer(4));
	const offered = senderAgainstPeer({
		entries: [{
			entryId: 'alpha', name: 'alpha.scape', byteLength: 4, payload: shared,
			conversionReportSidecar: null,
		}],
	});
	assert.equal((await failureFrom(offered.sender)).code, 'SHARED_MEMORY_FORBIDDEN');

	const { peer, receiver } = receiverAgainstPeer();
	await peer.next();
	peer.post({ ...envelope(), kind: 'begin', entryCount: 1 });
	peer.post(entryMessage(1, 'alpha', 4, shared));

	assert.equal((await failureFrom(receiver)).code, 'SHARED_MEMORY_FORBIDDEN');
});

test('a payload that only views part of its buffer is refused', () => {
	const backing = new Uint8Array(64);
	assert.throws(
		() => admitProjectTransferMessage(entryMessage(1, 'alpha', 4, backing.subarray(0, 4))),
		(error: ProjectTransferProtocolError) => /tightly cover/u.test(error.message),
	);
});

test('unknown kinds, unknown keys and accessor fields are refused', () => {
	assert.equal(admitProjectTransferMessage({ kind: 'ready' }), null, 'an untagged message is not ours');
	assert.throws(
		() => admitProjectTransferMessage({ ...envelope(), kind: 'steal' }),
		(error: ProjectTransferProtocolError) => error.code === 'UNKNOWN_KIND',
	);
	assert.throws(
		() => admitProjectTransferMessage({ ...envelope(), kind: 'complete', extra: 1 }),
		(error: ProjectTransferProtocolError) => error.code === 'UNKNOWN_KEY',
	);
	const trap = { ...envelope(), kind: 'complete' };
	let reads = 0;
	Object.defineProperty(trap, 'sessionId', {
		configurable: true,
		enumerable: true,
		get() {
			reads += 1;
			return SESSION;
		},
	});
	assert.throws(
		() => admitProjectTransferMessage(trap),
		(error: ProjectTransferProtocolError) => /not an accessor/u.test(error.message),
	);
	assert.equal(reads, 0, 'a peer getter is never invoked');
});

test('the sender aborting ends both sides cleanly', async () => {
	const controller = new AbortController();
	const { clock, sender, receiver } = bothRoles({
		entries: [entry('alpha', 1), entry('beta', 2)],
		senderSignal: controller.signal,
		acceptEntry: (received) => {
			if (received.entryId === 'alpha') controller.abort();
		},
	});
	const [senderFailure, receiverFailure] = [await failureFrom(sender), await failureFrom(receiver)];

	assert.equal(senderFailure.code, 'ABORTED');
	assert.equal(receiverFailure.code, 'PEER_ABORTED');
	assert.equal(clock.pending(), 0, 'no await outlives an abort');
});

test('the receiver aborting ends both sides cleanly', async () => {
	const controller = new AbortController();
	const { sender, receiver } = bothRoles({
		entries: [entry('alpha', 1), entry('beta', 2)],
		receiverSignal: controller.signal,
		acceptEntry: (received) => {
			if (received.entryId === 'alpha') controller.abort();
		},
	});
	const [receiverFailure, senderFailure] = [await failureFrom(receiver), await failureFrom(sender)];

	assert.equal(receiverFailure.code, 'ABORTED');
	assert.equal(senderFailure.code, 'PEER_ABORTED');
});

test('a signal already aborted refuses the transfer without offering anything', async () => {
	const { peer, sender } = senderAgainstPeer({ senderSignal: AbortSignal.abort() });

	assert.equal((await failureFrom(sender)).code, 'ABORTED');
	assert.equal((await peer.next()).kind, 'abort');
	assert.equal(peer.inbox.length, 0);
});

test('a final report that contradicts its own acknowledgements is refused', async () => {
	const { peer, sender } = senderAgainstPeer();
	peer.post(readyMessage());
	await peer.next();
	await peer.next();
	peer.post(ackMessage(1, 'alpha'));
	assert.equal((await peer.next()).kind, 'complete');
	peer.post({
		...envelope(),
		kind: 'report',
		outcomes: [{ entryId: 'alpha', name: 'alpha.scape', byteLength: 4, status: 'failed', reason: '' }],
	});

	const failure = await failureFrom(sender);
	assert.equal(failure.code, 'INVALID_FIELD');
	assert.match(failure.message, /after acknowledging it as stored/u);
});

test('a final report that covers the wrong entries is refused', async () => {
	const { peer, sender } = senderAgainstPeer();
	peer.post(readyMessage());
	await peer.next();
	await peer.next();
	peer.post(ackMessage(1, 'alpha'));
	await peer.next();
	peer.post({ ...envelope(), kind: 'report', outcomes: [] });

	const failure = await failureFrom(sender);
	assert.equal(failure.code, 'INVALID_FIELD');
	assert.match(failure.message, /covers 0 entries/u);
});
