/* SPDX-License-Identifier: AGPL-3.0-only */

export function throwIfAborted(signal: AbortSignal | undefined): void {
	if (!signal?.aborted) return;
	throw abortError(signal.reason);
}

export function abortableDelay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
	throwIfAborted(signal);
	return new Promise((resolvePromise, reject) => {
		const onAbort = (): void => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
			reject(abortError(signal?.reason));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolvePromise();
		}, milliseconds);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

function abortError(reason: unknown): Error {
	const error = new Error('Desktop library operation was aborted', { cause: reason });
	error.name = 'AbortError';
	return error;
}
