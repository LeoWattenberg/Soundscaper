/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import {
	type SoundscaperDesktopProjectLibraryOwner,
	validateSoundscaperDesktopProjectLibraryOwner,
} from './soundscaper-project-library-contract.ts';
import {
	parseSoundscaperDesktopLibraryMetadataJson,
	type SoundscaperDesktopLibraryMetadata,
} from './soundscaper-project-library-metadata.ts';

const LEASE_FIELDS = [
	'leaseId', 'fencingToken', 'owner', 'acquiredAtMs', 'expiresAtMs', 'tookOverStaleLease',
] as const;
const LEASE_ID_PATTERN = /^[a-f0-9]{48}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const JOURNAL_STATES = Object.freeze(['prepared', 'committed', 'complete', 'recovered'] as const);

export interface SoundscaperDesktopProjectLibraryLease {
	readonly leaseId: string;
	readonly fencingToken: number;
	readonly owner: Readonly<SoundscaperDesktopProjectLibraryOwner>;
	readonly acquiredAtMs: number;
	readonly expiresAtMs: number;
	readonly tookOverStaleLease: boolean;
}

export interface SoundscaperDesktopProjectLibraryMetadataRow {
	readonly revision: number;
	readonly json: string;
	readonly digest: string;
	readonly publishedAtMs: number;
}

export interface SoundscaperDesktopProjectLibraryJournalRow {
	readonly transactionId: string;
	readonly state: typeof JOURNAL_STATES[number];
	readonly previous: Omit<SoundscaperDesktopProjectLibraryMetadataRow, 'publishedAtMs'>;
	readonly next: Omit<SoundscaperDesktopProjectLibraryMetadataRow, 'publishedAtMs'>;
	readonly leaseId: string;
	readonly fencingToken: number;
}

export function encodeSoundscaperDesktopProjectLibraryMetadataRow(
	metadata: Readonly<SoundscaperDesktopLibraryMetadata>,
	publishedAtMs: number,
): SoundscaperDesktopProjectLibraryMetadataRow {
	const json = JSON.stringify(metadata);
	return Object.freeze({
		revision: metadata.revision,
		json,
		digest: digestMetadataJson(json),
		publishedAtMs,
	});
}

export function validateSoundscaperDesktopProjectLibraryMetadataRow(
	row: Record<string, unknown>,
	label: string,
): SoundscaperDesktopProjectLibraryMetadataRow {
	const json = stringValue(row.json, `${label} JSON`);
	const digest = digestValue(row.digest, `${label} digest`);
	return Object.freeze({
		revision: nonNegativeInteger(row.revision, `${label} revision`),
		json,
		digest,
		publishedAtMs: nonNegativeInteger(row.publishedAtMs, `${label} publication time`),
	});
}

export function validateSoundscaperDesktopProjectLibraryMetadataIntegrity(
	row: Omit<SoundscaperDesktopProjectLibraryMetadataRow, 'publishedAtMs'>,
	label: string,
): Readonly<SoundscaperDesktopLibraryMetadata> {
	const metadata = parseSoundscaperDesktopLibraryMetadataJson(row.json);
	if (metadata.revision !== row.revision || digestMetadataJson(row.json) !== row.digest) {
		throw new Error(`${label} failed digest and revision integrity validation`);
	}
	return metadata;
}

export function validateSoundscaperDesktopProjectLibraryJournalRow(
	row: Record<string, unknown>,
): SoundscaperDesktopProjectLibraryJournalRow {
	const transactionId = validateSoundscaperDesktopProjectLibraryOpaqueId(
		row.transaction_id,
		'persisted baseline journal transaction id',
	);
	const stateValue = stringValue(row.state, 'persisted baseline journal state');
	const state = JOURNAL_STATES.find((candidate) => candidate === stateValue);
	if (!state) throw new TypeError('Persisted Soundscaper desktop baseline journal state is invalid');
	const previous = metadataSnapshot(row, 'previous');
	const next = metadataSnapshot(row, 'next');
	validateSoundscaperDesktopProjectLibraryMetadataIntegrity(
		previous,
		'Soundscaper desktop baseline journal previous metadata',
	);
	validateSoundscaperDesktopProjectLibraryMetadataIntegrity(
		next,
		'Soundscaper desktop baseline journal next metadata',
	);
	if (next.revision !== increment(previous.revision, 'persisted baseline journal revision')) {
		throw new Error('Persisted Soundscaper desktop baseline journal revisions are not sequential');
	}
	const createdAtMs = nonNegativeInteger(row.created_at_ms, 'persisted baseline journal creation time');
	if (state === 'prepared' || state === 'committed') {
		if (row.completed_at_ms !== null) throw new TypeError('Pending Soundscaper desktop baseline journal has a completion time');
	} else if (nonNegativeInteger(row.completed_at_ms, 'persisted baseline journal completion time') < createdAtMs) {
		throw new TypeError('Completed Soundscaper desktop baseline journal predates its creation');
	}
	return Object.freeze({
		transactionId,
		state,
		previous,
		next,
		leaseId: validateSoundscaperDesktopProjectLibraryOpaqueId(
			row.lease_id,
			'persisted baseline journal lease id',
		),
		fencingToken: positiveInteger(row.fencing_token, 'persisted baseline journal fencing token'),
	});
}

export function validateSoundscaperDesktopProjectLibraryLeaseToken(
	value: SoundscaperDesktopProjectLibraryLease,
): SoundscaperDesktopProjectLibraryLease {
	const record = snapshotClosedRecord(value, LEASE_FIELDS, 'Soundscaper desktop baseline lease token');
	const acquiredAtMs = nonNegativeInteger(record.acquiredAtMs, 'baseline lease acquisition time');
	const expiresAtMs = nonNegativeInteger(record.expiresAtMs, 'baseline lease expiry');
	if (expiresAtMs <= acquiredAtMs) throw new TypeError('Soundscaper desktop baseline lease expiry is invalid');
	if (typeof record.tookOverStaleLease !== 'boolean') {
		throw new TypeError('Soundscaper desktop baseline lease takeover flag is invalid');
	}
	return freezeSoundscaperDesktopProjectLibraryLease({
		leaseId: validateSoundscaperDesktopProjectLibraryOpaqueId(record.leaseId, 'baseline lease token id'),
		fencingToken: positiveInteger(record.fencingToken, 'baseline lease token fencing token'),
		owner: validateSoundscaperDesktopProjectLibraryOwner(record.owner),
		acquiredAtMs,
		expiresAtMs,
		tookOverStaleLease: record.tookOverStaleLease,
	});
}

export function freezeSoundscaperDesktopProjectLibraryLease(
	value: SoundscaperDesktopProjectLibraryLease,
): SoundscaperDesktopProjectLibraryLease {
	return Object.freeze({ ...value, owner: Object.freeze({ ...value.owner }) });
}

export function sameSoundscaperDesktopProjectLibraryLease(
	left: SoundscaperDesktopProjectLibraryLease,
	right: SoundscaperDesktopProjectLibraryLease,
): boolean {
	return left.leaseId === right.leaseId
		&& left.fencingToken === right.fencingToken
		&& left.owner.product === right.owner.product
		&& left.owner.processId === right.owner.processId
		&& left.owner.instanceId === right.owner.instanceId;
}

export function sameSoundscaperDesktopProjectLibraryMetadataSnapshot(
	left: Omit<SoundscaperDesktopProjectLibraryMetadataRow, 'publishedAtMs'>,
	right: Omit<SoundscaperDesktopProjectLibraryMetadataRow, 'publishedAtMs'>,
): boolean {
	return left.revision === right.revision && left.json === right.json && left.digest === right.digest;
}

export function validateSoundscaperDesktopProjectLibraryOpaqueId(
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
): Omit<SoundscaperDesktopProjectLibraryMetadataRow, 'publishedAtMs'> {
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
