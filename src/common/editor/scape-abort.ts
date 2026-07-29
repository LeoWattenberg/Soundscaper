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

/** Race a read-only operation that is safe to abandon when its provider ignores cancellation. */
export function awaitScapeReadOperation<Value>(
	read: () => PromiseLike<Value> | Value,
	signal?: AbortSignal,
): Promise<Value> {
	if (!signal) return Promise.resolve().then(read);
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<Value>((resolve, reject) => {
		let settled = false;
		const finish = (complete: () => void): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			complete();
		};
		const onAbort = (): void => finish(() => reject(signal.reason));
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

export function aggregateScapeErrors(primary: unknown, cleanup: readonly unknown[], message: string): unknown {
	if (!cleanup.length) return primary;
	const aggregate = new AggregateError([primary, ...cleanup], message);
	if (primary instanceof Error && primary.name === 'AbortError') aggregate.name = 'AbortError';
	return aggregate;
}
