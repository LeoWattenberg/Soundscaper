/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import {
	type FramescaperDesktopProjectLibraryV10Owner,
	validateFramescaperDesktopProjectLibraryV10Owner,
} from './project-library-v10-contract.ts';
import {
	parseFramescaperDesktopLibraryV10MetadataJson,
	type FramescaperDesktopLibraryV10Metadata,
} from './project-library-v10-metadata.ts';

const LEASE_FIELDS = [
	'leaseId', 'fencingToken', 'owner', 'acquiredAtMs', 'expiresAtMs', 'tookOverStaleLease',
] as const;
const LEASE_ID_PATTERN = /^[a-f0-9]{48}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const JOURNAL_STATES = Object.freeze(['prepared', 'committed', 'complete', 'recovered'] as const);

export interface FramescaperDesktopProjectLibraryV10Lease {
	readonly leaseId: string;
	readonly fencingToken: number;
	readonly owner: Readonly<FramescaperDesktopProjectLibraryV10Owner>;
	readonly acquiredAtMs: number;
	readonly expiresAtMs: number;
	readonly tookOverStaleLease: boolean;
}

export interface FramescaperDesktopProjectLibraryV10MetadataRow {
	readonly revision: number;
	readonly json: string;
	readonly digest: string;
	readonly publishedAtMs: number;
}

export interface FramescaperDesktopProjectLibraryV10JournalRow {
	readonly transactionId: string;
	readonly state: typeof JOURNAL_STATES[number];
	readonly previous: Omit<FramescaperDesktopProjectLibraryV10MetadataRow, 'publishedAtMs'>;
	readonly next: Omit<FramescaperDesktopProjectLibraryV10MetadataRow, 'publishedAtMs'>;
	readonly leaseId: string;
	readonly fencingToken: number;
}

export function encodeFramescaperDesktopProjectLibraryV10MetadataRow(
	metadata: Readonly<FramescaperDesktopLibraryV10Metadata>,
	publishedAtMs: number,
): FramescaperDesktopProjectLibraryV10MetadataRow {
	const json = JSON.stringify(metadata);
	return Object.freeze({
		revision: metadata.revision,
		json,
		digest: digestMetadataJson(json),
		publishedAtMs,
	});
}

export function validateFramescaperDesktopProjectLibraryV10MetadataRow(
	row: Record<string, unknown>,
	label: string,
): FramescaperDesktopProjectLibraryV10MetadataRow {
	const json = stringValue(row.json, `${label} JSON`);
	const digest = digestValue(row.digest, `${label} digest`);
	return Object.freeze({
		revision: nonNegativeInteger(row.revision, `${label} revision`),
		json,
		digest,
		publishedAtMs: nonNegativeInteger(row.publishedAtMs, `${label} publication time`),
	});
}

export function validateFramescaperDesktopProjectLibraryV10MetadataIntegrity(
	row: Omit<FramescaperDesktopProjectLibraryV10MetadataRow, 'publishedAtMs'>,
	label: string,
): Readonly<FramescaperDesktopLibraryV10Metadata> {
	const metadata = parseFramescaperDesktopLibraryV10MetadataJson(row.json);
	if (metadata.revision !== row.revision || digestMetadataJson(row.json) !== row.digest) {
		throw new Error(`${label} failed digest and revision integrity validation`);
	}
	return metadata;
}

export function validateFramescaperDesktopProjectLibraryV10JournalRow(
	row: Record<string, unknown>,
): FramescaperDesktopProjectLibraryV10JournalRow {
	const transactionId = validateFramescaperDesktopProjectLibraryV10OpaqueId(
		row.transaction_id,
		'persisted V10 journal transaction id',
	);
	const stateValue = stringValue(row.state, 'persisted V10 journal state');
	const state = JOURNAL_STATES.find((candidate) => candidate === stateValue);
	if (!state) throw new TypeError('Persisted Framescaper V10 journal state is invalid');
	const previous = metadataSnapshot(row, 'previous');
	const next = metadataSnapshot(row, 'next');
	validateFramescaperDesktopProjectLibraryV10MetadataIntegrity(
		previous,
		'Framescaper V10 journal previous metadata',
	);
	validateFramescaperDesktopProjectLibraryV10MetadataIntegrity(
		next,
		'Framescaper V10 journal next metadata',
	);
	if (next.revision !== increment(previous.revision, 'persisted V10 journal revision')) {
		throw new Error('Persisted Framescaper V10 journal revisions are not sequential');
	}
	const createdAtMs = nonNegativeInteger(row.created_at_ms, 'persisted V10 journal creation time');
	if (state === 'prepared' || state === 'committed') {
		if (row.completed_at_ms !== null) throw new TypeError('Pending Framescaper V10 journal has a completion time');
	} else if (nonNegativeInteger(row.completed_at_ms, 'persisted V10 journal completion time') < createdAtMs) {
		throw new TypeError('Completed Framescaper V10 journal predates its creation');
	}
	return Object.freeze({
		transactionId,
		state,
		previous,
		next,
		leaseId: validateFramescaperDesktopProjectLibraryV10OpaqueId(
			row.lease_id,
			'persisted V10 journal lease id',
		),
		fencingToken: positiveInteger(row.fencing_token, 'persisted V10 journal fencing token'),
	});
}

export function validateFramescaperDesktopProjectLibraryV10LeaseToken(
	value: FramescaperDesktopProjectLibraryV10Lease,
): FramescaperDesktopProjectLibraryV10Lease {
	const record = snapshotClosedRecord(value, LEASE_FIELDS, 'Framescaper desktop V10 lease token');
	const acquiredAtMs = nonNegativeInteger(record.acquiredAtMs, 'V10 lease acquisition time');
	const expiresAtMs = nonNegativeInteger(record.expiresAtMs, 'V10 lease expiry');
	if (expiresAtMs <= acquiredAtMs) throw new TypeError('Framescaper desktop V10 lease expiry is invalid');
	if (typeof record.tookOverStaleLease !== 'boolean') {
		throw new TypeError('Framescaper desktop V10 lease takeover flag is invalid');
	}
	return freezeFramescaperDesktopProjectLibraryV10Lease({
		leaseId: validateFramescaperDesktopProjectLibraryV10OpaqueId(record.leaseId, 'V10 lease token id'),
		fencingToken: positiveInteger(record.fencingToken, 'V10 lease token fencing token'),
		owner: validateFramescaperDesktopProjectLibraryV10Owner(record.owner),
		acquiredAtMs,
		expiresAtMs,
		tookOverStaleLease: record.tookOverStaleLease,
	});
}

export function freezeFramescaperDesktopProjectLibraryV10Lease(
	value: FramescaperDesktopProjectLibraryV10Lease,
): FramescaperDesktopProjectLibraryV10Lease {
	return Object.freeze({ ...value, owner: Object.freeze({ ...value.owner }) });
}

export function sameFramescaperDesktopProjectLibraryV10Lease(
	left: FramescaperDesktopProjectLibraryV10Lease,
	right: FramescaperDesktopProjectLibraryV10Lease,
): boolean {
	return left.leaseId === right.leaseId
		&& left.fencingToken === right.fencingToken
		&& left.owner.product === right.owner.product
		&& left.owner.processId === right.owner.processId
		&& left.owner.instanceId === right.owner.instanceId;
}

export function sameFramescaperDesktopProjectLibraryV10MetadataSnapshot(
	left: Omit<FramescaperDesktopProjectLibraryV10MetadataRow, 'publishedAtMs'>,
	right: Omit<FramescaperDesktopProjectLibraryV10MetadataRow, 'publishedAtMs'>,
): boolean {
	return left.revision === right.revision && left.json === right.json && left.digest === right.digest;
}

export function validateFramescaperDesktopProjectLibraryV10OpaqueId(
	value: unknown,
	label: string,
): string {
	const result = stringValue(value, label);
	if (!LEASE_ID_PATTERN.test(result)) throw new TypeError(`${label} is invalid`);
	return result;
}

function metadataSnapshot(
	row: Record<string, unknown>,
	prefix: 'previous' | 'next',
): Omit<FramescaperDesktopProjectLibraryV10MetadataRow, 'publishedAtMs'> {
	return Object.freeze({
		revision: nonNegativeInteger(row[`${prefix}_revision`], `${prefix} metadata revision`),
		json: stringValue(row[`${prefix}_json`], `${prefix} metadata JSON`),
		digest: digestValue(row[`${prefix}_digest`], `${prefix} metadata digest`),
	});
}

function snapshotClosedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${name} has missing or unsupported fields`);
	const result = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property`);
		}
		result[field] = descriptor.value;
	}
	return result;
}

function digestMetadataJson(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function digestValue(value: unknown, label: string): string {
	const result = stringValue(value, label);
	if (!DIGEST_PATTERN.test(result)) throw new TypeError(`${label} is invalid`);
	return result;
}

function increment(value: number, label: string): number {
	if (value === Number.MAX_SAFE_INTEGER) throw new RangeError(`${label} cannot advance`);
	return value + 1;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${label} must be a non-negative safe integer`);
	}
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	const result = nonNegativeInteger(value, label);
	if (result === 0) throw new RangeError(`${label} must be positive`);
	return result;
}

function stringValue(value: unknown, label: string): string {
	if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
	return value;
}
