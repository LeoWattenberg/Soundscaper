/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What the sending page knows about its own wire, independently of the protocol.
 *
 * `sendProjectTransfer()` speaks the handshake and resolves with the peer's
 * final report - but only if it gets one. When the wire dies mid-run it rejects,
 * throwing away everything it had already learned, and the visitor is about to
 * abandon this origin: the one question they need answered, archive by archive,
 * is *is this project on the other origin now?*
 *
 * So the port is wrapped on the way past and both directions are read off it,
 * because between them they answer that question in three states rather than
 * two:
 *
 *   - **acknowledged** - the peer named an outcome for it. Believed only from an
 *     allowed origin, only for an archive this transfer offered, and only once.
 *   - **posted, unacknowledged** - it went out and no answer came back. The peer
 *     may have stored it and lost the wire before saying so, so this side
 *     genuinely does not know, and says so.
 *   - **never posted** - the protocol stopped before this archive reached the
 *     wire. It is *not* unknown: it definitely did not cross, and reporting it as
 *     uncertain is a page claiming ignorance about work it knows it never
 *     started. That is its own dishonesty - it sends a visitor hunting the other
 *     origin for an archive that provably never reached it, and it buries the one
 *     archive whose fate really is unknown among archives whose fate is not.
 *
 * The outbound half is what makes the third state knowable, and it is knowable
 * exactly: an entry is posted when, and only when, this side handed an `entry`
 * message for it to the port without the post throwing.
 */

import type * as Handshake from './project-transfer-handshake.ts';

/**
 * The buffer is small and fixed: once the protocol is listening it does its own
 * bounded queueing, and a peer that shouts more than a handshake's worth of
 * messages into a port nobody has subscribed to is not one this side should be
 * allocating for.
 */
const TRANSFER_PORT_BUFFER_LIMIT = 32;

/**
 * Which ports are already buffered, so wrapping one twice is a no-op.
 *
 * Both the page and the transports call `bufferTransferPort()` - the page
 * because it must, the transports because they cannot assume the page did - and
 * a second wrapper would subscribe to the first only after the awaits the first
 * exists to cover.
 */
const bufferedPorts = new WeakSet<object>();

/**
 * Hold what the peer says while this side is still reading its own store.
 *
 * **Call this synchronously, where the port is created.** The popup must be
 * opened inside the visitor's click - a `window.open()` on a later turn is
 * blocked - so the receiving document is loading, and announcing `ready`, while
 * this side is still awaiting its archive runtime, its store handle and its
 * first export. Every one of those is an unbounded await, and a window port
 * drops what arrives before anything has subscribed to it. A `ready` lost in
 * that window does not fail the transfer: it hangs it until the acknowledgement
 * timeout, minutes later, and tells the visitor their projects did not cross
 * while the other origin sits idle.
 */
export function bufferTransferPort(
	port: Handshake.ProjectTransferPort,
): Handshake.ProjectTransferPort {
	if (!port || typeof port.post !== 'function' || typeof port.subscribe !== 'function') {
		throw new TypeError('A transfer needs a port with post() and subscribe().');
	}
	if (bufferedPorts.has(port)) return port;
	const held: Handshake.ProjectTransferInboundMessage[] = [];
	let listener: ((message: Handshake.ProjectTransferInboundMessage) => void) | null = null;
	const stop = port.subscribe((message) => {
		if (listener) listener(message);
		else if (held.length < TRANSFER_PORT_BUFFER_LIMIT) held.push(message);
	});
	const buffered = Object.freeze({
		post: (message: unknown, targetOrigin: string) => port.post(message, targetOrigin),
		subscribe(next: (message: Handshake.ProjectTransferInboundMessage) => void): () => void {
			if (typeof next !== 'function') {
				throw new TypeError('A transfer port subscriber must be a function.');
			}
			listener = next;
			while (held.length > 0) next(held.shift() as Handshake.ProjectTransferInboundMessage);
			return () => {
				listener = null;
				stop();
			};
		},
	});
	bufferedPorts.add(buffered);
	return buffered;
}

/** An offered archive the peer never answered for. */
export interface TransferSendPending {
	readonly entryId: string;
	readonly name: string;
	readonly byteLength: number;
}

export interface TransferAcknowledgementWatch {
	readonly port: Handshake.ProjectTransferPort;
	readonly outcomes: readonly Handshake.ProjectTransferOutcome[];
	/** Posted, never answered for: the peer may still have stored it. */
	readonly unanswered: readonly TransferSendPending[];
	/** Never put on the wire at all, so it definitely did not cross. */
	readonly unsent: readonly TransferSendPending[];
	/** The session the peer named, once any acknowledgement has carried one. */
	readonly sessionId: string;
}

/**
 * Read both directions of the transfer off the port on its way past.
 *
 * Only an acknowledgement from an allowed origin, for an archive this transfer
 * actually offered, and the first one per archive, is believed. Anything the
 * protocol would refuse must not reach a report the visitor reads, and a status
 * that is not `stored` is recorded as a failure rather than guessed at.
 *
 * Outbound, only the protocol's `entry` messages are noted, and only after the
 * underlying `post()` has returned: a post that threw did not put the archive on
 * the wire, and counting it as sent is the same overstatement in miniature.
 */
export function observeTransferAcknowledgements(
	port: Handshake.ProjectTransferPort,
	entries: readonly Handshake.ProjectTransferEntry[],
	allowedOrigins: readonly string[],
): TransferAcknowledgementWatch {
	const offered = new Map(entries.map((entry) => [entry.entryId, entry]));
	const posted = new Set<string>();
	const outcomes: Handshake.ProjectTransferOutcome[] = [];
	let sessionId = '';
	const record = (message: Handshake.ProjectTransferInboundMessage): void => {
		if (!message || !allowedOrigins.includes(message.origin)) return;
		const ack = message.data as Partial<Handshake.ProjectTransferAckMessage> | null;
		if (!ack || typeof ack !== 'object' || ack.kind !== 'ack' || typeof ack.entryId !== 'string') return;
		const entry = offered.get(ack.entryId);
		if (!entry) return;
		offered.delete(ack.entryId);
		if (typeof ack.sessionId === 'string') sessionId = ack.sessionId;
		outcomes.push(Object.freeze({
			entryId: entry.entryId,
			name: entry.name,
			byteLength: entry.byteLength,
			status: ack.status === 'stored' ? 'stored' : 'failed',
			reason: typeof ack.reason === 'string' ? ack.reason : '',
		}));
	};
	const notePost = (message: unknown): void => {
		const sent = message as Partial<Handshake.ProjectTransferEntryMessage> | null;
		if (!sent || typeof sent !== 'object' || sent.kind !== 'entry') return;
		if (typeof sent.entryId === 'string') posted.add(sent.entryId);
	};
	const pending = (sent: boolean): readonly TransferSendPending[] => Object.freeze(
		[...offered.values()]
			.filter((entry) => posted.has(entry.entryId) === sent)
			.map((entry) => Object.freeze({
				entryId: entry.entryId,
				name: entry.name,
				byteLength: entry.byteLength,
			})),
	);
	const watched = Object.freeze({
		post: (message: unknown, targetOrigin: string) => {
			port.post(message, targetOrigin);
			notePost(message);
		},
		subscribe: (next: (message: Handshake.ProjectTransferInboundMessage) => void) => port.subscribe((message) => {
			record(message);
			next(message);
		}),
	});
	// Already buffered underneath, so a transport that wraps its port again
	// finds this one wrapped rather than subscribing a second listener to it.
	bufferedPorts.add(watched);
	return Object.freeze({
		port: watched,
		get outcomes() {
			return Object.freeze([...outcomes]);
		},
		get unanswered() {
			return pending(true);
		},
		get unsent() {
			return pending(false);
		},
		get sessionId() {
			return sessionId;
		},
	});
}
