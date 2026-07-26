/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnknownRecord } from './types.ts';

export function createAbortError(): Error | DOMException {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted', 'AbortError')
		: Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}

export function throwIfAborted(signal: AbortSignal | null | undefined): void {
	if (signal?.aborted) throw createAbortError();
}

export function abortable<Value>(
	promise: PromiseLike<Value> | Value,
	signal: AbortSignal | null | undefined,
): Promise<Value> {
	if (!signal) return Promise.resolve(promise);
	if (signal.aborted) return Promise.reject(createAbortError());
	return new Promise((resolve, reject) => {
		const abort = (): void => reject(createAbortError());
		signal.addEventListener('abort', abort, { once: true });
		Promise.resolve(promise).then(
			(value) => {
				signal.removeEventListener('abort', abort);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener('abort', abort);
				reject(error);
			},
		);
	});
}

export function longSourceError(message: string): Error & { code: string } {
	return Object.assign(new Error(message), { code: 'LONG_SOURCE_RENDER_REQUIRED' });
}

export type ParametricEqProcessingError = Error & {
	readonly status?: unknown;
	readonly effectId?: unknown;
};

export function parametricEqProcessingError(value: unknown): ParametricEqProcessingError {
	const details = value && typeof value === 'object' ? value as UnknownRecord : {};
	return Object.assign(
		new Error(typeof details.message === 'string' && details.message
			? details.message
			: 'The parametric EQ processor failed during rendering.'),
		{
			name: 'ParametricEqProcessingError',
			...(details.status != null ? { status: details.status } : {}),
			...(details.effectId ? { effectId: details.effectId } : {}),
		},
	);
}
