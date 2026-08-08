/* SPDX-License-Identifier: AGPL-3.0-only */

export const OPFS_SYNC_OPERATION_IDS = Object.freeze([
	'canonical-pcm-chunk-read',
	'canonical-pcm-chunk-write',
	'media-asset-chunk-read',
	'media-asset-chunk-write',
	'derivative-payload-read',
	'derivative-payload-write',
] as const);

export type OpfsSyncOperationId = typeof OPFS_SYNC_OPERATION_IDS[number];

const OPERATION_IDS = new Set<string>(OPFS_SYNC_OPERATION_IDS);
const MAXIMUM_OPFS_PATH_BYTES = 255;
export const MAXIMUM_OPFS_SYNC_CHUNK_BYTES = 16 * 1024 * 1024;

export function assertOpfsSyncOperationId(value: unknown): asserts value is OpfsSyncOperationId {
	if (typeof value !== 'string' || !OPERATION_IDS.has(value)) {
		throw new TypeError('A known OPFS operation id is required.');
	}
}

export function normalizeOpfsWorkerPath(value: unknown): string {
	if (typeof value !== 'string'
		|| !value
		|| value === '.'
		|| value === '..'
		|| value.includes('/')
		|| value.includes('\\')
		|| value.includes('\0')
		|| new TextEncoder().encode(value).byteLength > MAXIMUM_OPFS_PATH_BYTES) {
		throw new TypeError('A safe OPFS path is required.');
	}
	return value;
}

export function normalizeOpfsReadRange(
	offsetValue: unknown,
	lengthValue: unknown,
): Readonly<{ offset: number; length: number }> {
	const offset = Number(offsetValue);
	const length = Number(lengthValue);
	if (!Number.isSafeInteger(offset) || offset < 0
		|| !Number.isSafeInteger(length) || length < 0
		|| length > MAXIMUM_OPFS_SYNC_CHUNK_BYTES
		|| !Number.isSafeInteger(offset + length)) {
		throw new RangeError('A non-negative safe OPFS read range is required.');
	}
	return Object.freeze({ offset, length });
}

export function serializeOpfsWorkerError(error: unknown): Readonly<{
	name: string;
	message: string;
	code?: string;
}> {
	const candidate = error && typeof error === 'object'
		? error as { readonly name?: unknown; readonly message?: unknown; readonly code?: unknown }
		: null;
	return Object.freeze({
		name: typeof candidate?.name === 'string' && candidate.name ? candidate.name : 'Error',
		message: typeof candidate?.message === 'string' && candidate.message
			? candidate.message
			: String(error || 'OPFS worker failed.'),
		...(typeof candidate?.code === 'string' && candidate.code ? { code: candidate.code } : {}),
	});
}

export function deserializeOpfsWorkerError(value: unknown): Error {
	const candidate = value && typeof value === 'object'
		? value as { readonly name?: unknown; readonly message?: unknown; readonly code?: unknown }
		: null;
	const error = new Error(
		typeof candidate?.message === 'string' && candidate.message
			? candidate.message
			: 'OPFS worker failed.',
	);
	error.name = typeof candidate?.name === 'string' && candidate.name ? candidate.name : 'Error';
	if (typeof candidate?.code === 'string' && candidate.code) {
		(error as Error & { code?: string }).code = candidate.code;
	}
	return error;
}
