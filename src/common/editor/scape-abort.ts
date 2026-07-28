/* SPDX-License-Identifier: AGPL-3.0-only */

export function throwIfScapeAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason instanceof Error) throw signal.reason;
	throw new DOMException('The .scape operation was cancelled.', 'AbortError');
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

export function aggregateScapeErrors(primary: unknown, cleanup: readonly unknown[], message: string): unknown {
	if (!cleanup.length) return primary;
	const aggregate = new AggregateError([primary, ...cleanup], message);
	if (primary instanceof Error && primary.name === 'AbortError') aggregate.name = 'AbortError';
	return aggregate;
}
