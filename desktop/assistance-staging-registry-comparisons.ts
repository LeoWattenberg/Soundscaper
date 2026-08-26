/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pure comparisons and argument guards the staging registry re-checks with. */

import type {
	AssistanceOutputClaim,
	AssistanceOutputReservation,
	AssistanceStagedInputClaim,
} from './assistance-data-claims.ts';

const OPAQUE_ID = /^[a-f\d]{40}$/u;

export function sameInputClaim(
	left: AssistanceStagedInputClaim,
	right: AssistanceStagedInputClaim,
): boolean {
	return left.claimId === right.claimId && left.jobId === right.jobId && left.role === right.role
		&& left.mediaType === right.mediaType && left.byteLength === right.byteLength && left.sha256 === right.sha256;
}

export function sameReservation(
	left: AssistanceOutputReservation,
	right: AssistanceOutputReservation,
): boolean {
	return left.claimId === right.claimId && left.jobId === right.jobId && left.role === right.role
		&& left.mediaType === right.mediaType && left.maximumByteLength === right.maximumByteLength;
}

export function sameOutputClaim(
	left: AssistanceOutputClaim,
	right: AssistanceOutputClaim,
): boolean {
	return left.claimId === right.claimId && left.jobId === right.jobId && left.role === right.role
		&& left.mediaType === right.mediaType && left.byteLength === right.byteLength && left.sha256 === right.sha256;
}

export function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) throw new TypeError(
		`An assistance ${label} id must be 40 lowercase hexadecimal characters.`,
	);
	return value;
}

export function limit(value: unknown, fallback: number, maximum: number, label: string): number {
	const selected = value === undefined ? fallback : value;
	if (!Number.isSafeInteger(selected) || Number(selected) < 1 || Number(selected) > maximum) throw new RangeError(
		`The ${label} limit is outside its hard bound.`,
	);
	return Number(selected);
}

export function errorCode(error: unknown): string {
	return typeof error === 'object' && error !== null && 'code' in error
		? String((error as { code?: unknown }).code) : '';
}
