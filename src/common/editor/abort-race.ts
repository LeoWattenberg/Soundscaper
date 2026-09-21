/* SPDX-License-Identifier: AGPL-3.0-only */

export type AbortReasonSelector = (signal: AbortSignal) => unknown;
type AbortableReadInvocation = 'deferred' | 'immediate';

const signalAbortReason: AbortReasonSelector = (signal) => signal.reason;

/** Race a lazily started operation against cancellation. */
export function raceAbortableRead<Value>(
	read: () => PromiseLike<Value> | Value,
	signal?: AbortSignal,
	invocation: AbortableReadInvocation = 'deferred',
): Promise<Value> {
	return raceAbortable(read, signal, signalAbortReason, invocation);
}

/** Race an already-started operation against cancellation. */
export function raceAbortablePromise<Value>(
	operation: PromiseLike<Value>,
	signal?: AbortSignal,
	abortReason: AbortReasonSelector = signalAbortReason,
): Promise<Value> {
	if (!signal) return Promise.resolve(operation);
	return raceAbortable(() => operation, signal, abortReason, 'immediate');
}

function raceAbortable<Value>(
	read: () => PromiseLike<Value> | Value,
	signal: AbortSignal | undefined,
	abortReason: AbortReasonSelector,
	invocation: AbortableReadInvocation,
): Promise<Value> {
	if (!signal) return invokeWithoutSignal(read, invocation);
	if (signal.aborted) return rejectWithAbortReason(signal, abortReason);
	return new Promise<Value>((resolve, reject) => {
		let settled = false;
		const finish = (complete: () => void): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			complete();
		};
		const onAbort = (): void => finish(() => reject(selectedAbortReason(signal, abortReason)));
		signal.addEventListener('abort', onAbort, { once: true });
		if (signal.aborted) {
			onAbort();
			return;
		}
		let operation: PromiseLike<Value> | Value;
		try {
			operation = read();
		} catch (error) {
			finish(() => reject(error));
			return;
		}
		void Promise.resolve(operation).then(
			(value) => finish(() => resolve(value)),
			(error: unknown) => finish(() => reject(error)),
		);
	});
}

function invokeWithoutSignal<Value>(
	read: () => PromiseLike<Value> | Value,
	invocation: AbortableReadInvocation,
): Promise<Value> {
	if (invocation === 'deferred') return Promise.resolve().then(read);
	try {
		return Promise.resolve(read());
	} catch (error) {
		return Promise.reject(error);
	}
}

function rejectWithAbortReason<Value>(
	signal: AbortSignal,
	abortReason: AbortReasonSelector,
): Promise<Value> {
	return Promise.reject(selectedAbortReason(signal, abortReason));
}

function selectedAbortReason(signal: AbortSignal, abortReason: AbortReasonSelector): unknown {
	try {
		return abortReason(signal);
	} catch (error) {
		return error;
	}
}
