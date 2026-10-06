/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	SourcePcmChunk,
	SourcePcmReadSession,
	SourceReadOptions,
} from './source-read-repository.ts';
import { createAbortGuard } from '../abort-error.ts';

const NO_PRIMARY_FAILURE = Symbol('no source PCM read failure');
const throwIfAborted = createAbortGuard('Source PCM reading was cancelled.');

/**
 * Name carried by the rejection a released session answers reads with.
 *
 * Releasing a session is a lifetime event rather than a data fault: storage
 * maintenance and provider replacement both release live sessions while an
 * unrelated render is still reading through them. Callers that own a stable
 * source identity recognise this name and reopen instead of failing the render.
 */
export const SOURCE_PCM_READ_SESSION_RELEASED_ERROR_NAME = 'SourcePcmReadSessionReleasedError';

export function isSourcePcmReadSessionReleasedError(error: unknown): boolean {
	return typeof error === 'object' && error !== null
		&& (error as Readonly<{ name?: unknown }>).name === SOURCE_PCM_READ_SESSION_RELEASED_ERROR_NAME;
}

export interface SourcePcmReadSessionFactoryOptions {
	/** Two is reserved for independently bounded positional backend requests. */
	readonly maximumConcurrentReads?: number;
	readChunk(chunkIndex: number, signal?: AbortSignal): Promise<SourcePcmChunk>;
	release(): Promise<void>;
	onRelease(): void;
}

/** Read one exact source identity with bounded backend admission and local cancellation. */
export function createSourcePcmReadSession(
	options: SourcePcmReadSessionFactoryOptions,
): SourcePcmReadSession {
	const maximumConcurrentReads = options.maximumConcurrentReads ?? 1;
	if (maximumConcurrentReads !== 1 && maximumConcurrentReads !== 2) throw new RangeError('PCM sessions admit one or two independent reads.');
	const queues = Array.from({ length: maximumConcurrentReads }, () => Promise.resolve());
	const queuedCounts = Array.from({ length: maximumConcurrentReads }, () => 0);
	let closed = false;
	let primaryFailure: unknown = NO_PRIMARY_FAILURE;
	let releasePromise: Promise<void> | null = null;
	const closedError = new Error('The source PCM read session was released.');
	closedError.name = SOURCE_PCM_READ_SESSION_RELEASED_ERROR_NAME;
	const lifetime = new AbortController();
	const release = (): Promise<void> => {
		closed = true;
		if (!lifetime.signal.aborted) lifetime.abort(closedError);
		releasePromise ??= Promise.all(queues)
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
		let lane = 0;
		for (let index = 1; index < queues.length; index += 1) if (queuedCounts[index]! < queuedCounts[lane]!) lane = index;
		queuedCounts[lane]! += 1;
		const operation = queues[lane]!.then(async () => {
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
				// Backend AbortError may omit the maintenance-release reason; closed
				// without a primary failure identifies an intentional session release.
				if (closed && isAbortError(error)) throw primaryFailure === NO_PRIMARY_FAILURE ? closedError : primaryFailure;
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
		queues[lane] = operation.then(() => { queuedCounts[lane]! -= 1; }, () => { queuedCounts[lane]! -= 1; });
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
