/* SPDX-License-Identifier: AGPL-3.0-only */

export const EDITOR_WORKER_PROTOCOL_VERSION = 1 as const;
export const WORKER_TIMEOUT_CODE = 'WORKER_INACTIVITY_TIMEOUT' as const;
export const WORKER_CANCELLED_CODE = 'WORKER_CANCELLED' as const;
export const WORKER_PROTOCOL_FAILURE_CODE = 'WORKER_PROTOCOL_FAILURE' as const;
export const WORKER_BROKER_DISPOSED_CODE = 'WORKER_BROKER_DISPOSED' as const;

export type EditorWorkerProtocolVersion = typeof EDITOR_WORKER_PROTOCOL_VERSION;
export type EditorWorkerRequestId = `${string}:v${EditorWorkerProtocolVersion}:${string}`;

export interface EditorWorkerRequest<MessageType extends string = string, Payload = unknown> {
	readonly protocolVersion: EditorWorkerProtocolVersion;
	readonly requestId: EditorWorkerRequestId;
	readonly type: MessageType;
	readonly payload: Payload;
}

export interface EditorWorkerProgress<Payload = unknown> {
	readonly protocolVersion: EditorWorkerProtocolVersion;
	readonly requestId: EditorWorkerRequestId;
	readonly type: 'progress';
	readonly payload: Payload;
}

export type EditorWorkerResponse<Result = unknown, Failure = unknown> =
	| Readonly<{
		protocolVersion: EditorWorkerProtocolVersion;
		requestId: EditorWorkerRequestId;
		type: 'result';
		result: Result;
	}>
	| Readonly<{
		protocolVersion: EditorWorkerProtocolVersion;
		requestId: EditorWorkerRequestId;
		type: 'error';
		error: Failure;
	}>
	| EditorWorkerProgress;

export class WorkerRequestTimeoutError extends Error {
	readonly code = WORKER_TIMEOUT_CODE;
	readonly timeoutMs: number;

	constructor(timeoutMs: number) {
		super(`Worker request received no activity for ${timeoutMs} milliseconds.`);
		this.name = 'TimeoutError';
		this.timeoutMs = timeoutMs;
	}
}

export class WorkerRequestCancelledError extends Error {
	readonly code = WORKER_CANCELLED_CODE;

	constructor(message = 'Worker request was cancelled.') {
		super(message);
		this.name = 'AbortError';
	}
}

export class WorkerProtocolError extends Error {
	readonly code = WORKER_PROTOCOL_FAILURE_CODE;

	constructor(message = 'The worker returned an invalid protocol message.', options?: ErrorOptions) {
		super(message, options);
		this.name = 'WorkerProtocolError';
	}
}

export class WorkerBrokerDisposedError extends Error {
	readonly code = WORKER_BROKER_DISPOSED_CODE;

	constructor() {
		super('The worker request broker has been disposed.');
		this.name = 'WorkerBrokerDisposedError';
	}
}

export function createWorkerRequestId(
	namespace: string,
	sequence: string | number,
): EditorWorkerRequestId {
	const normalizedNamespace = String(namespace).trim().replace(/[^a-z0-9_-]+/giu, '-');
	const normalizedSequence = String(sequence).trim().replace(/[^a-z0-9_-]+/giu, '-');
	if (!normalizedNamespace || !normalizedSequence) throw new TypeError('Worker request ids require a namespace and sequence.');
	return `${normalizedNamespace}:v${EDITOR_WORKER_PROTOCOL_VERSION}:${normalizedSequence}`;
}
