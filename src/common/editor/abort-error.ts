/* SPDX-License-Identifier: AGPL-3.0-only */

export type AbortGuard = (signal?: AbortSignal | null) => void;

/** Throw an owner's cancellation error while preserving any signal-supplied reason. */
export function throwIfAborted(
	signal: AbortSignal | null | undefined,
	message: string,
): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') throw new DOMException(message, 'AbortError');
	const error = new Error(message);
	error.name = 'AbortError';
	throw error;
}

/** Bind one owner's exact cancellation message without duplicating abort semantics. */
export function createAbortGuard(message: string): AbortGuard {
	return (signal) => throwIfAborted(signal, message);
}
