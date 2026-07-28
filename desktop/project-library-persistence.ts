/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import {
	MAX_LIBRARY_METADATA_BYTES,
	parseDesktopLibraryMetadataJson,
	type DesktopLibraryLease,
	type DesktopLibraryMetadata,
	validateDesktopLibraryMetadata,
	validateDesktopLibraryOwner,
} from './project-library-contract.ts';

export const LEASE_ID_PATTERN = /^[a-f0-9]{48}$/u;
export const JOURNAL_ID_PATTERN = /^[a-f0-9]{48}$/u;
const JOURNAL_STATES = Object.freeze(['prepared', 'committed', 'complete', 'recovered'] as const);

export interface MetadataRow {
	readonly revision: number;
	readonly json: string;
	readonly digest: string;
	readonly publishedAtMs: number;
}

export interface JournalRow {
	readonly transactionId: string;
	readonly state: typeof JOURNAL_STATES[number];
	readonly previous: MetadataRow;
	readonly next: MetadataRow;
}

export function encodeMetadataRow(metadata: DesktopLibraryMetadata, publishedAtMs: number): MetadataRow {
	const validated = validateDesktopLibraryMetadata(metadata);
	const json = JSON.stringify(validated);
	return Object.freeze({
		revision: validated.revision,
		json,
		digest: digestMetadataJson(json),
		publishedAtMs: nonNegativeInteger(publishedAtMs, 'metadata publication time'),
	});
}

export function validateMetadataRow(row: Record<string, unknown> | MetadataRow, label: string): MetadataRow {
	const revision = nonNegativeInteger(row.revision, `${label} revision`);
	const json = stringField(row.json, `${label} JSON`);
	if (Buffer.byteLength(json, 'utf8') > MAX_LIBRARY_METADATA_BYTES) throw new RangeError(`${label} JSON exceeds its byte limit`);
	const rowDigest = stringField(row.digest, `${label} digest`);
	if (!/^[a-f0-9]{64}$/u.test(rowDigest)) throw new TypeError(`${label} digest is invalid`);
	return Object.freeze({
		revision,
		json,
		digest: rowDigest,
		publishedAtMs: nonNegativeInteger(row.publishedAtMs, `${label} publication time`),
	});
}

export function validateJournalRow(row: Record<string, unknown>): JournalRow {
	const transactionId = stringField(row.transaction_id, 'journal transaction id');
	if (!JOURNAL_ID_PATTERN.test(transactionId)) throw new TypeError('Persisted metadata journal has an invalid transaction id');
	const stateValue = stringField(row.state, 'journal state');
	const state = JOURNAL_STATES.find((candidate) => candidate === stateValue);
	if (!state) throw new TypeError('Persisted metadata journal has an invalid state');
	const previous = validateMetadataRow({
		revision: row.previous_revision,
		json: row.previous_json,
		digest: row.previous_digest,
		publishedAtMs: row.previous_published_at_ms,
	}, 'journal previous metadata');
	const next = validateMetadataRow({
		revision: row.next_revision,
		json: row.next_json,
		digest: row.next_digest,
		publishedAtMs: row.published_at_ms,
	}, 'journal next metadata');
	validateMetadataIntegrity(previous, 'journal previous metadata');
	validateMetadataIntegrity(next, 'journal next metadata');
	if (next.revision !== previous.revision + 1) throw new Error('Persisted metadata journal revisions are not sequential');
	const leaseId = stringField(row.lease_id, 'journal lease id');
	if (!LEASE_ID_PATTERN.test(leaseId)) throw new TypeError('Persisted metadata journal has an invalid lease id');
	positiveInteger(row.fencing_token, 'journal fencing token');
	const createdAtMs = nonNegativeInteger(row.created_at_ms, 'journal creation time');
	if (state === 'prepared' || state === 'committed') {
		if (row.completed_at_ms !== null) throw new TypeError('Pending metadata journal has a completion time');
	} else if (nonNegativeInteger(row.completed_at_ms, 'journal completion time') < createdAtMs) {
		throw new TypeError('Completed metadata journal predates its creation');
	}
	return Object.freeze({ transactionId, state, previous, next });
}

export function validateMetadataIntegrity(row: MetadataRow, label: string): DesktopLibraryMetadata {
	const metadata = parseDesktopLibraryMetadataJson(row.json);
	if (metadata.revision !== row.revision || digestMetadataJson(row.json) !== row.digest) {
		throw new Error(`${label} failed integrity validation`);
	}
	return metadata;
}

export function validatePersistedLease(row: Record<string, unknown>, fencingToken: number): DesktopLibraryLease {
	const leaseId = stringField(row.leaseId, 'persisted lease id');
	if (!LEASE_ID_PATTERN.test(leaseId) || fencingToken === 0) throw new TypeError('Persisted desktop library lease is invalid');
	const owner = validateDesktopLibraryOwner({
		product: row.ownerProduct,
		processId: row.ownerProcessId,
		instanceId: row.ownerInstanceId,
	});
	const acquiredAtMs = nonNegativeInteger(row.acquiredAtMs, 'persisted lease acquisition time');
	const expiresAtMs = nonNegativeInteger(row.expiresAtMs, 'persisted lease expiry');
	if (expiresAtMs <= acquiredAtMs) throw new TypeError('Persisted desktop library lease expiry is invalid');
	return freezeLease({
		leaseId,
		fencingToken,
		owner,
		acquiredAtMs,
		expiresAtMs,
		tookOverStaleLease: booleanInteger(row.tookOver, 'persisted lease takeover flag'),
	});
}

export function validateLeaseToken(value: DesktopLibraryLease): DesktopLibraryLease {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Desktop library lease token is invalid');
	if (typeof value.leaseId !== 'string' || !LEASE_ID_PATTERN.test(value.leaseId)) {
		throw new TypeError('Desktop library lease token id is invalid');
	}
	if (typeof value.tookOverStaleLease !== 'boolean') throw new TypeError('Desktop library lease takeover flag is invalid');
	const owner = validateDesktopLibraryOwner(value.owner);
	const acquiredAtMs = nonNegativeInteger(value.acquiredAtMs, 'lease token acquisition time');
	const expiresAtMs = nonNegativeInteger(value.expiresAtMs, 'lease token expiry');
	if (expiresAtMs <= acquiredAtMs) throw new TypeError('Desktop library lease token expiry is invalid');
	return freezeLease({
		leaseId: value.leaseId,
		fencingToken: positiveInteger(value.fencingToken, 'lease token fencing token'),
		owner,
		acquiredAtMs,
		expiresAtMs,
		tookOverStaleLease: value.tookOverStaleLease === true,
	});
}

export function freezeLease(value: DesktopLibraryLease): DesktopLibraryLease {
	return Object.freeze({ ...value, owner: Object.freeze({ ...value.owner }) });
}

export function sameLease(left: DesktopLibraryLease, right: DesktopLibraryLease): boolean {
	return left.leaseId === right.leaseId
		&& left.fencingToken === right.fencingToken
		&& left.owner.product === right.owner.product
		&& left.owner.processId === right.owner.processId
		&& left.owner.instanceId === right.owner.instanceId;
}

export function sameMetadataRow(left: MetadataRow, right: MetadataRow): boolean {
	return left.revision === right.revision && left.json === right.json && left.digest === right.digest;
}

export function digestMetadataJson(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${label} must be a non-negative safe integer`);
	}
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	const number = nonNegativeInteger(value, label);
	if (number === 0) throw new RangeError(`${label} must be positive`);
	return number;
}

function stringField(value: unknown, label: string): string {
	if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
	return value;
}

function booleanInteger(value: unknown, label: string): boolean {
	if (value !== 0 && value !== 1) throw new TypeError(`${label} must be zero or one`);
	return value === 1;
}
