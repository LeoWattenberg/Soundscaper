/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Structured-clone-safe failure transport shared by the request/response worker
 * backends. Workers flatten thrown errors into plain objects that survive
 * `postMessage`, and clients rebuild them as `Error` instances on the far side.
 *
 * Only `name`, `message` and `stack` cross every backend. Anything else a
 * backend wants to carry — WavPack's `code`, Nyquist's `code` and `output` — is
 * declared per call site as `extraFields` so the wire shape stays explicit
 * instead of being rediscovered in each copy of these helpers.
 */

export interface SerializedWorkerError {
	readonly name: string;
	readonly message: string;
	readonly stack: string;
	readonly [field: string]: string;
}

type UnknownRecord = { readonly [field: string]: unknown };

export function serializeWorkerError(
	error: unknown,
	extraFields: readonly string[] = [],
): SerializedWorkerError {
	const source = error as UnknownRecord | null | undefined;
	const serialized: Record<string, string> = {
		name: typeof source?.name === 'string' ? source.name : 'Error',
		message: typeof source?.message === 'string' ? source.message : String(error),
		stack: typeof source?.stack === 'string' ? source.stack : '',
	};
	for (const field of extraFields) {
		const value = source?.[field];
		serialized[field] = typeof value === 'string' ? value : '';
	}
	return serialized as SerializedWorkerError;
}

export function deserializeWorkerError(
	value: unknown,
	fallbackMessage: string,
	extraFields: readonly string[] = [],
): Error {
	const source = value as UnknownRecord | null | undefined;
	const error = new Error(typeof source?.message === 'string' ? source.message : fallbackMessage);
	error.name = typeof source?.name === 'string' ? source.name : 'Error';
	if (typeof source?.stack === 'string' && source.stack) error.stack = source.stack;
	for (const field of extraFields) {
		const carried = source?.[field];
		if (typeof carried === 'string' && carried) (error as unknown as Record<string, unknown>)[field] = carried;
	}
	return error;
}

export function createWorkerAbortError(message: string): Error {
	const error = new Error(message);
	error.name = 'AbortError';
	return error;
}
