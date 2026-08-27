/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The mailbox both roles of the cross-origin project transfer stand on: one
 * bounded, origin-checked, timeout-bounded channel over an injected port.
 *
 * It is separate from the roles in project-transfer-handshake.ts because the
 * origin decision belongs in exactly one place. A message from an origin
 * outside the allowlist is dropped here in silence — never answered, never
 * raised to the caller as if a peer had spoken — and no role can bypass that
 * by reaching for the port itself.
 */

import {
	PROJECT_TRANSFER_DEFAULT_TIMEOUT_MILLISECONDS,
	PROJECT_TRANSFER_MAX_PENDING_MESSAGES,
	PROJECT_TRANSFER_PROTOCOL_ID,
	PROJECT_TRANSFER_PROTOCOL_VERSION,
	type ProjectTransferMessage,
	type ProjectTransferMessageKind,
	type ProjectTransferProtocolError,
	admitProjectTransferInteger,
	admitProjectTransferMessage,
	admitProjectTransferOrigin,
	admitProjectTransferOrigins,
	asProjectTransferError,
	describeProjectTransferReason,
	describeProjectTransferValue,
	projectTransferError,
} from './project-transfer-handshake-wire.ts';

/** The longest either role will wait on one peer answer. */
export const PROJECT_TRANSFER_MAX_TIMEOUT_MILLISECONDS = 3_600_000;

export interface ProjectTransferInboundMessage {
	readonly origin: string;
	readonly data: unknown;
}

/**
 * The window plumbing, reduced to what the protocol needs. `post` names the
 * target origin on every call because a transfer must never be posted to "*".
 */
export interface ProjectTransferPort {
	post(message: unknown, targetOrigin: string): void;
	subscribe(listener: (message: ProjectTransferInboundMessage) => void): () => void;
}

export interface ProjectTransferClock {
	setTimeout(callback: () => void, milliseconds: number): unknown;
	clearTimeout(handle: unknown): void;
}

export interface ProjectTransferChannelOptions {
	readonly port: ProjectTransferPort;
	readonly targetOrigin: string;
	readonly allowedOrigins: readonly string[];
	readonly timeoutMilliseconds?: number;
	readonly clock?: ProjectTransferClock;
	readonly signal?: AbortSignal | null;
}

export interface ProjectTransferChannelSettings {
	readonly port: ProjectTransferPort;
	readonly allowedOrigins: ReadonlySet<string>;
	readonly targetOrigin: string;
	readonly timeoutMilliseconds: number;
	readonly clock: ProjectTransferClock;
	readonly signal: AbortSignal | null;
}

export interface ProjectTransferChannel {
	expectVersion(version: number): void;
	expectSession(sessionId: string): void;
	next(): Promise<ProjectTransferMessage>;
	send(message: ProjectTransferMessage): void;
	endWith(error: ProjectTransferProtocolError): void;
	close(): void;
}

type MessageOfKind<Kind extends ProjectTransferMessageKind> =
	Extract<ProjectTransferMessage, { kind: Kind }>;

const DEFAULT_CLOCK: ProjectTransferClock = Object.freeze({
	setTimeout: (callback: () => void, milliseconds: number): unknown => setTimeout(callback, milliseconds),
	clearTimeout: (handle: unknown): void => {
		clearTimeout(handle as ReturnType<typeof setTimeout>);
	},
});

export function envelopeFor(sessionId: string) {
	return {
		protocol: PROJECT_TRANSFER_PROTOCOL_ID,
		protocolVersion: PROJECT_TRANSFER_PROTOCOL_VERSION,
		sessionId,
	} as const;
}

export function normalizeProjectTransferChannel(
	options: ProjectTransferChannelOptions,
): ProjectTransferChannelSettings {
	const port = options?.port;
	if (!port || typeof port.post !== 'function' || typeof port.subscribe !== 'function') {
		throw new TypeError('A project transfer requires a port with post() and subscribe().');
	}
	const allowedOrigins = admitProjectTransferOrigins(options.allowedOrigins, 'allowedOrigins');
	const targetOrigin = admitProjectTransferOrigin(options.targetOrigin, 'targetOrigin');
	if (!allowedOrigins.has(targetOrigin)) {
		throw projectTransferError(
			'INVALID_ORIGIN',
			`targetOrigin ${targetOrigin} is not one of the permitted origins.`,
			'targetOrigin',
		);
	}
	const clock = options.clock ?? DEFAULT_CLOCK;
	if (typeof clock.setTimeout !== 'function' || typeof clock.clearTimeout !== 'function') {
		throw new TypeError('A project transfer clock requires setTimeout() and clearTimeout().');
	}
	const signal = options.signal ?? null;
	if (signal !== null && (typeof signal.addEventListener !== 'function' || typeof signal.aborted !== 'boolean')) {
		throw new TypeError('A project transfer signal must be an AbortSignal.');
	}
	return Object.freeze({
		port,
		allowedOrigins,
		targetOrigin,
		timeoutMilliseconds: admitProjectTransferInteger(
			options.timeoutMilliseconds ?? PROJECT_TRANSFER_DEFAULT_TIMEOUT_MILLISECONDS,
			'timeoutMilliseconds', 1, PROJECT_TRANSFER_MAX_TIMEOUT_MILLISECONDS,
		),
		clock,
		signal,
	});
}

export function openProjectTransferChannel(
	settings: ProjectTransferChannelSettings,
): ProjectTransferChannel {
	const queued: ProjectTransferMessage[] = [];
	let waiter: {
		resolve: (message: ProjectTransferMessage) => void;
		reject: (error: ProjectTransferProtocolError) => void;
		timer: unknown;
	} | null = null;
	let failure: ProjectTransferProtocolError | null = null;
	let expectedVersion: number | null = null;
	let expectedSession: string | null = null;
	let abortSent = false;
	let closed = false;

	function fail(error: ProjectTransferProtocolError): void {
		if (failure === null) failure = error;
		const pending = waiter;
		if (pending === null) return;
		waiter = null;
		settings.clock.clearTimeout(pending.timer);
		pending.reject(failure);
	}

	function tellPeer(reason: string): void {
		if (abortSent || closed) return;
		abortSent = true;
		try {
			settings.port.post(
				{ ...envelopeFor(expectedSession ?? ''), kind: 'abort', reason },
				settings.targetOrigin,
			);
		} catch {
			// The peer window may already be closed; the local failure stands.
		}
	}

	function deliver(message: ProjectTransferMessage): void {
		const pending = waiter;
		if (pending !== null) {
			waiter = null;
			settings.clock.clearTimeout(pending.timer);
			pending.resolve(message);
			return;
		}
		if (queued.length >= PROJECT_TRANSFER_MAX_PENDING_MESSAGES) {
			fail(projectTransferError(
				'QUEUE_OVERFLOW',
				`A peer may not queue more than ${PROJECT_TRANSFER_MAX_PENDING_MESSAGES} unanswered messages.`,
			));
			return;
		}
		queued.push(message);
	}

	function receive(inbound: ProjectTransferInboundMessage): void {
		if (closed || failure !== null) return;
		if (typeof inbound?.origin !== 'string' || !settings.allowedOrigins.has(inbound.origin)) return;
		let message: ProjectTransferMessage | null = null;
		try {
			message = admitProjectTransferMessage(inbound.data);
		} catch (error) {
			fail(asProjectTransferError(error));
			return;
		}
		if (message === null) return;
		if (expectedVersion !== null && message.protocolVersion !== expectedVersion) {
			fail(projectTransferError(
				'PROTOCOL_VERSION',
				`The peer spoke protocol version ${message.protocolVersion}; this transfer negotiated ${expectedVersion}.`,
				'protocolVersion',
			));
			return;
		}
		const unboundAbort = message.kind === 'abort' && message.sessionId === '';
		if (expectedSession !== null && !unboundAbort && message.sessionId !== expectedSession) {
			fail(projectTransferError(
				'SESSION_MISMATCH',
				`A ${message.kind} message named session ${describeProjectTransferValue(message.sessionId)}, not the open one.`,
				'sessionId',
			));
			return;
		}
		if (message.kind === 'abort') {
			abortSent = true;
			fail(projectTransferError('PEER_ABORTED', `The peer ended the transfer: ${message.reason || 'no reason given'}`));
			return;
		}
		deliver(message);
	}

	function onLocalAbort(): void {
		tellPeer('The transfer was cancelled by the peer.');
		fail(projectTransferError('ABORTED', 'The transfer was cancelled.'));
	}

	const unsubscribe = settings.port.subscribe(receive);
	if (settings.signal !== null) {
		if (settings.signal.aborted) onLocalAbort();
		else settings.signal.addEventListener('abort', onLocalAbort, { once: true });
	}

	return Object.freeze({
		expectVersion(version: number): void {
			expectedVersion = version;
		},
		expectSession(sessionId: string): void {
			expectedSession = sessionId;
		},
		next(): Promise<ProjectTransferMessage> {
			if (failure !== null) return Promise.reject(failure);
			const held = queued.shift();
			if (held !== undefined) return Promise.resolve(held);
			if (closed) return Promise.reject(projectTransferError('ABORTED', 'The transfer channel is closed.'));
			if (waiter !== null) {
				return Promise.reject(projectTransferError('INVALID_FIELD', 'A transfer role may await only one message at a time.'));
			}
			return new Promise<ProjectTransferMessage>((resolve, reject) => {
				const timer = settings.clock.setTimeout(() => {
					fail(projectTransferError(
						'TIMEOUT',
						`The peer did not answer within ${settings.timeoutMilliseconds} ms.`,
					));
				}, settings.timeoutMilliseconds);
				waiter = { resolve, reject, timer };
			});
		},
		send(message: ProjectTransferMessage): void {
			if (failure !== null) throw failure;
			if (closed) throw projectTransferError('ABORTED', 'The transfer channel is closed.');
			settings.port.post(message, settings.targetOrigin);
		},
		endWith(error: ProjectTransferProtocolError): void {
			// A peer that has already aborted, and a local cancellation that
			// has already posted its own abort, are both told nothing further.
			if (error.code !== 'PEER_ABORTED' && error.code !== 'ABORTED') {
				tellPeer(describeProjectTransferReason(`${error.code}: ${error.message}`));
			}
			fail(error);
		},
		close(): void {
			if (closed) return;
			closed = true;
			const pending = waiter;
			if (pending !== null) {
				waiter = null;
				settings.clock.clearTimeout(pending.timer);
			}
			settings.signal?.removeEventListener('abort', onLocalAbort);
			try {
				unsubscribe();
			} catch {
				// A detached window has already dropped its listener.
			}
		},
	});
}

/** Runs one role to completion, telling the peer why if it ends badly. */
export async function runProjectTransferRole<Result>(
	channel: ProjectTransferChannel,
	body: () => Promise<Result>,
): Promise<Result> {
	try {
		return await body();
	} catch (error) {
		const raised = asProjectTransferError(error);
		channel.endWith(raised);
		throw raised;
	} finally {
		channel.close();
	}
}

export async function expectProjectTransferKind<Kind extends ProjectTransferMessageKind>(
	channel: ProjectTransferChannel,
	kind: Kind,
): Promise<MessageOfKind<Kind>> {
	const message = await channel.next();
	if (message.kind !== kind) {
		throw projectTransferError(
			'UNEXPECTED_MESSAGE',
			`Expected a ${kind} message, received ${message.kind}.`,
			'kind',
		);
	}
	return message as MessageOfKind<Kind>;
}
