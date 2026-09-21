/* SPDX-License-Identifier: AGPL-3.0-only */

import { raceAbortableRead } from './abort-race.ts';

const NORMALIZED_ABORT_REASONS = new WeakMap<DOMException, unknown>();
const NORMALIZED_ABORT_ERRORS = new WeakMap<AbortSignal, DOMException>();

export function throwIfScapeAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	throw scapeAbortReason(signal);
}

/** Returns one stable Error boundary for every aborted signal. */
export function scapeAbortReason(signal: AbortSignal): Error {
	if (!signal.aborted) throw new TypeError('A Scape abort reason requires an aborted signal.');
	if (signal.reason instanceof Error) return signal.reason;
	const retained = NORMALIZED_ABORT_ERRORS.get(signal);
	if (retained) return retained;
	const error = new DOMException('The Scape operation was cancelled.', 'AbortError');
	NORMALIZED_ABORT_ERRORS.set(signal, error);
	NORMALIZED_ABORT_REASONS.set(error, signal.reason);
	return error;
}

/** Restores only abort reasons wrapped by this module's Scape boundary. */
export function restoreNormalizedScapeAbortReason(error: unknown): unknown {
	if (error instanceof DOMException && NORMALIZED_ABORT_REASONS.has(error)) {
		return NORMALIZED_ABORT_REASONS.get(error);
	}
	return error;
}

export async function awaitScapeOperation<Value>(
	operation: PromiseLike<Value> | Value,
	signal?: AbortSignal,
): Promise<Value> {
	throwIfScapeAborted(signal);
	let value: Value;
	try {
		value = await operation;
	} catch (error) {
		throwIfScapeAborted(signal);
		throw error;
	}
	throwIfScapeAborted(signal);
	return value;
}

/** Race a read-only operation that is safe to abandon when its provider ignores cancellation. */
export function awaitScapeReadOperation<Value>(
	read: () => PromiseLike<Value> | Value,
	signal?: AbortSignal,
): Promise<Value> {
	return raceAbortableRead(read, signal);
}

export function aggregateScapeErrors(primary: unknown, cleanup: readonly unknown[], message: string): unknown {
	if (!cleanup.length) return primary;
	const aggregate = new AggregateError([primary, ...cleanup], message);
	if (primary instanceof Error && primary.name === 'AbortError') aggregate.name = 'AbortError';
	return aggregate;
}
