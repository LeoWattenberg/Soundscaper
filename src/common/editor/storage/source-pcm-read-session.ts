/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	SourcePcmChunk,
	SourcePcmReadSession,
	SourceReadOptions,
} from './source-read-repository.ts';

const NO_PRIMARY_FAILURE = Symbol('no source PCM read failure');

export interface SourcePcmReadSessionFactoryOptions {
	readChunk(chunkIndex: number, signal?: AbortSignal): Promise<SourcePcmChunk>;
	release(): Promise<void>;
	onRelease(): void;
}

/** Serialize one exact source identity while keeping request cancellation local. */
export function createSourcePcmReadSession(
	options: SourcePcmReadSessionFactoryOptions,
): SourcePcmReadSession {
	let queue = Promise.resolve();
	let closed = false;
	let primaryFailure: unknown = NO_PRIMARY_FAILURE;
	let releasePromise: Promise<void> | null = null;
	const closedError = new Error('The source PCM read session was released.');
	const lifetime = new AbortController();
	const release = (): Promise<void> => {
		closed = true;
		if (!lifetime.signal.aborted) lifetime.abort(closedError);
		releasePromise ??= queue
			.then(() => releaseSession(options.release, primaryFailure))
			.then(options.onRelease);
		return releasePromise;
	};
	const chunk = (
		chunkIndex: number,
		{ signal }: SourceReadOptions = {},
	): Promise<SourcePcmChunk> => {
		if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
			return Promise.reject(new RangeError('Source chunk index must be a non-negative integer.'));
		}
		if (closed) return Promise.reject(closedError);
		const operation = queue.then(async () => {
			if (closed) throw closedError;
			const readSignals = combineSourceReadAbortSignals(lifetime.signal, signal);
			try {
				const value = await options.readChunk(chunkIndex, readSignals.signal);
				throwIfAborted(readSignals.signal);
				if (closed) throw closedError;
				return value;
			} catch (error) {
				if (isRequestCancellation(error, signal)) {
					throw requestCancellationReason(error, signal);
				}
				if (!closed) {
					closed = true;
					primaryFailure = error;
					lifetime.abort(error);
				}
				throw error;
			} finally {
				readSignals.dispose();
			}
		});
		queue = operation.then(() => undefined, () => undefined);
		return operation.catch(async (error: unknown) => {
			if (isRequestCancellation(error, signal)) {
				throw requestCancellationReason(error, signal);
			}
			try {
				await release();
			} catch (cleanupError) {
				if (primaryFailure === error) throw cleanupError;
				throw new AggregateError(
					[error, cleanupError],
					'Source PCM session reading and cleanup both failed.',
					{ cause: error },
				);
			}
			throw error;
		});
	};
	return Object.freeze({ chunk, release });
}

export function combineSourceReadAbortSignals(
	lifetime: AbortSignal,
	request?: AbortSignal,
): Readonly<{ signal: AbortSignal; dispose(): void }> {
	if (!request || request === lifetime) {
		return Object.freeze({ signal: lifetime, dispose: () => undefined });
	}
	const controller = new AbortController();
	const forwardLifetime = () => controller.abort(lifetime.reason);
	const forwardRequest = () => controller.abort(request.reason);
	if (lifetime.aborted) forwardLifetime();
	else if (request.aborted) forwardRequest();
	else {
		lifetime.addEventListener('abort', forwardLifetime, { once: true });
		request.addEventListener('abort', forwardRequest, { once: true });
	}
	return Object.freeze({
		signal: controller.signal,
		dispose() {
			lifetime.removeEventListener('abort', forwardLifetime);
			request.removeEventListener('abort', forwardRequest);
		},
	});
}

async function releaseSession(
	release: () => Promise<void>,
	primaryFailure: unknown,
): Promise<void> {
	try {
		await release();
	} catch (cleanupError) {
		if (primaryFailure !== NO_PRIMARY_FAILURE) {
			throw new AggregateError(
				[primaryFailure, cleanupError],
				'Source PCM session reading and cleanup both failed.',
				{ cause: primaryFailure },
			);
		}
		throw cleanupError;
	}
}

function isRequestCancellation(error: unknown, signal?: AbortSignal): boolean {
	return Boolean(signal?.aborted && (
		error === signal.reason
		|| isAbortError(error)
	));
}

function isAbortError(error: unknown): boolean {
	return typeof error === 'object'
		&& error !== null
		&& 'name' in error
		&& error.name === 'AbortError';
}

function requestCancellationReason(error: unknown, signal?: AbortSignal): unknown {
	return signal?.reason === undefined ? error : signal.reason;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') {
		throw new DOMException('Source PCM reading was cancelled.', 'AbortError');
	}
	const error = new Error('Source PCM reading was cancelled.');
	error.name = 'AbortError';
	throw error;
}
