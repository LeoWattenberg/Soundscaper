/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed, pathless renderer authority for one authenticated decoded sequence pack. */

const OPAQUE_ID = /^[a-f0-9]{40}$/u;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export type FramescaperNativeImageSequenceDecodeRequest =
	| Readonly<{
		readonly operation: 'decode';
		readonly requestId: string;
		readonly projectId: string;
		readonly projectRevision: number;
		readonly sourceId: string;
	}>
	| Readonly<{ readonly operation: 'cancel'; readonly requestId: string }>
	| Readonly<{
		readonly operation: 'read';
		readonly claimId: string;
		readonly offset: number;
		readonly length: number;
	}>
	| Readonly<{ readonly operation: 'release'; readonly claimId: string }>;

const FIELDS = Object.freeze({
	decode: ['operation', 'requestId', 'projectId', 'projectRevision', 'sourceId'],
	cancel: ['operation', 'requestId'],
	read: ['operation', 'claimId', 'offset', 'length'],
	release: ['operation', 'claimId'],
} as const);

export function assertFramescaperNativeImageSequenceDecodeRequest(
	value: unknown,
): asserts value is FramescaperNativeImageSequenceDecodeRequest {
	const record = exactRecord(value, 'decode request');
	const operation = record.operation;
	if (typeof operation !== 'string' || !Object.hasOwn(FIELDS, operation)) {
		throw new TypeError('The image-sequence decode operation is unsupported.');
	}
	const fields = FIELDS[operation as keyof typeof FIELDS];
	if (Reflect.ownKeys(record).length !== fields.length
		|| Reflect.ownKeys(record).some((key) => typeof key !== 'string' || !fields.includes(key as never))) {
		throw new TypeError('The image-sequence decode request has an inexact shape.');
	}
	if (operation === 'decode') {
		opaque(record.requestId, 'request ID');
		projectId(record.projectId, 'project ID');
		projectId(record.sourceId, 'source ID');
		integer(record.projectRevision, 0, Number.MAX_SAFE_INTEGER, 'project revision');
	} else if (operation === 'cancel') opaque(record.requestId, 'request ID');
	else if (operation === 'release') opaque(record.claimId, 'claim ID');
	else {
		opaque(record.claimId, 'claim ID');
		integer(record.offset, 0, Number.MAX_SAFE_INTEGER, 'read offset');
		integer(record.length, 1, 16 * 1024 * 1024, 'read length');
	}
}

function exactRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`An image-sequence ${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}

function opaque(value: unknown, label: string): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) throw new TypeError(`The image-sequence ${label} is invalid.`);
	return value;
}

function projectId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !PROJECT_ID.test(value)) throw new TypeError(`The image-sequence ${label} is invalid.`);
	return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The image-sequence ${label} is outside its bound.`);
	}
	return Number(value);
}
