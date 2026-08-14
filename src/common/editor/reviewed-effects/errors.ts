/* SPDX-License-Identifier: AGPL-3.0-only */

export type ReviewedEffectErrorCode =
	| 'ABI_INVALID'
	| 'CATALOG_MISMATCH'
	| 'FORBIDDEN_IMPORT'
	| 'HASH_MISMATCH'
	| 'INPUT_LIMIT'
	| 'MANIFEST_INVALID'
	| 'OUTPUT_LIMIT'
	| 'PACKAGE_NOT_FOUND'
	| 'PACKAGE_REVOKED'
	| 'PROCESSING_FAILED'
	| 'REALTIME_NOT_APPROVED'
	| 'REQUEST_ABORTED'
	| 'TIMEOUT'
	| 'WASM_LIMIT'
	| 'WORKER_PROTOCOL';

export class ReviewedEffectError extends Error {
	readonly code: ReviewedEffectErrorCode;

	constructor(code: ReviewedEffectErrorCode, message: string, options: ErrorOptions = {}) {
		super(message, options);
		this.name = 'ReviewedEffectError';
		this.code = code;
	}
}

const REVIEWED_EFFECT_ERROR_CODES: ReadonlySet<string> = new Set<ReviewedEffectErrorCode>([
	'ABI_INVALID',
	'CATALOG_MISMATCH',
	'FORBIDDEN_IMPORT',
	'HASH_MISMATCH',
	'INPUT_LIMIT',
	'MANIFEST_INVALID',
	'OUTPUT_LIMIT',
	'PACKAGE_NOT_FOUND',
	'PACKAGE_REVOKED',
	'PROCESSING_FAILED',
	'REALTIME_NOT_APPROVED',
	'REQUEST_ABORTED',
	'TIMEOUT',
	'WASM_LIMIT',
	'WORKER_PROTOCOL',
]);

export function isReviewedEffectErrorCode(value: unknown): value is ReviewedEffectErrorCode {
	return typeof value === 'string' && REVIEWED_EFFECT_ERROR_CODES.has(value);
}

export function reviewedEffectError(
	code: ReviewedEffectErrorCode,
	message: string,
	cause?: unknown,
): ReviewedEffectError {
	return new ReviewedEffectError(code, message, cause === undefined ? {} : { cause });
}
