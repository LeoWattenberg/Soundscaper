/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
} from '../src/common/editor/project-schema-identity.ts';
import { FRAMESCAPER_PROJECT_WATCH_BIN_ID } from '../src/common/editor/native-watch-target.ts';
import type { WatchRuleV1 } from '../src/common/editor/native-watch-rule.ts';
import type { FramescaperNativeWatchEntry } from './native-services-watch-repository.ts';

const OPAQUE_ID = /^[a-f0-9]{16,64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

interface FramescaperProjectIdentity {
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
}

export interface FramescaperNativeWatchLinkedLocator {
	readonly locatorId: string;
	readonly locatorRevision: string;
	readonly name: string;
	readonly size: number;
	readonly mimeType: string;
	readonly lastModified: number;
}

export interface FramescaperNativeWatchProjectWitness extends FramescaperProjectIdentity {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly open: boolean;
	readonly writable: boolean;
	readonly binId: typeof FRAMESCAPER_PROJECT_WATCH_BIN_ID;
}

export interface FramescaperNativeWatchImportedWitness extends FramescaperProjectIdentity {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly binId: typeof FRAMESCAPER_PROJECT_WATCH_BIN_ID;
	readonly sourceId: string;
	readonly contentSha256: string;
	readonly proxyAttached: boolean;
}

export interface FramescaperNativeWatchImportClaimRequest extends FramescaperProjectIdentity {
	readonly projectId: string;
	readonly projectRevision: number;
}

export interface FramescaperNativeWatchImportClaim
	extends FramescaperProjectIdentity, FramescaperNativeWatchLinkedLocator {
	readonly claimId: string;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly binId: typeof FRAMESCAPER_PROJECT_WATCH_BIN_ID;
	readonly generateProxies: boolean;
	readonly existingSourceId: string | null;
	readonly importMode: 'link' | 'copy';
	readonly contentSha256: string;
}

export interface FramescaperNativeWatchImportCompletionRequest extends FramescaperProjectIdentity {
	readonly claimId: string;
	readonly projectId: string;
	readonly binId: typeof FRAMESCAPER_PROJECT_WATCH_BIN_ID;
	readonly sourceId: string | null;
	readonly contentSha256: string;
	readonly expectedProjectRevision: number;
	readonly committedProjectRevision: number;
	readonly success: boolean;
}

export interface FramescaperNativeWatchImportOffer {
	readonly rule: WatchRuleV1;
	readonly entry: FramescaperNativeWatchEntry;
	readonly contentSha256: string;
}

export function framescaperNativeWatchImportOffer(
	value: FramescaperNativeWatchImportOffer,
): FramescaperNativeWatchImportOffer {
	currentIdentity(value?.rule, 'watch-import rule');
	if (!value?.rule || !value.entry || !SHA256.test(value.contentSha256)) {
		throw new TypeError('A watch-import offer requires an exact rule, entry, and SHA-256.');
	}
	return value;
}

export function framescaperNativeWatchRuleAdmitted(
	rule: WatchRuleV1,
	project: FramescaperNativeWatchProjectWitness,
): boolean {
	return rule.enabled && !rule.recursive
		&& (rule.importMode === 'link' || rule.importMode === 'copy')
		&& rule.schemaFamily === FRAMESCAPER_PROJECT_SCHEMA_FAMILY
		&& rule.schemaVersion === PROJECT_SCHEMA_VERSION
		&& project.schemaFamily === FRAMESCAPER_PROJECT_SCHEMA_FAMILY
		&& project.schemaVersion === PROJECT_SCHEMA_VERSION
		&& project.binId === FRAMESCAPER_PROJECT_WATCH_BIN_ID
		&& rule.binId === project.binId;
}

export function framescaperNativeWatchUsableProject(
	value: FramescaperNativeWatchProjectWitness | null,
	projectId: string,
): value is FramescaperNativeWatchProjectWitness {
	if (value === null) return false;
	try { currentIdentity(value, 'watch project witness'); }
	catch { return false; }
	return value.projectId === projectId && value.open && value.writable
		&& Number.isSafeInteger(value.projectRevision) && value.projectRevision >= 0
		&& value.binId === FRAMESCAPER_PROJECT_WATCH_BIN_ID;
}

export function framescaperNativeWatchLinkedLocator(
	value: FramescaperNativeWatchLinkedLocator,
): FramescaperNativeWatchLinkedLocator {
	const record = closedRecord(value, [
		'locatorId', 'locatorRevision', 'name', 'size', 'mimeType', 'lastModified',
	], 'watch-import locator');
	if (!OPAQUE_ID.test(String(record.locatorId)) || !OPAQUE_ID.test(String(record.locatorRevision))
		|| typeof record.name !== 'string' || !record.name || record.name.length > 255
		|| !Number.isSafeInteger(record.size) || Number(record.size) < 1
		|| typeof record.mimeType !== 'string' || !record.mimeType.startsWith('video/')
		|| !Number.isSafeInteger(record.lastModified) || Number(record.lastModified) < 0) {
		throw new TypeError('A watch-import locator is not an exact pathless video locator.');
	}
	return Object.freeze({
		locatorId: String(record.locatorId), locatorRevision: String(record.locatorRevision),
		name: record.name, size: Number(record.size), mimeType: record.mimeType,
		lastModified: Number(record.lastModified),
	});
}

export function framescaperNativeWatchImportClaimRequest(
	value: unknown,
): FramescaperNativeWatchImportClaimRequest {
	const identity = currentIdentity(value, 'watch-import claim request');
	const record = closedRecord(value, [
		'schemaFamily', 'schemaVersion', 'projectId', 'projectRevision',
	], 'watch-import claim request');
	return Object.freeze({
		...identity,
		projectId: identifier(record.projectId, 'watch-import project id'),
		projectRevision: nonNegativeInteger(record.projectRevision, 'watch-import project revision'),
	});
}

export function framescaperNativeWatchImportCompletionRequest(
	value: unknown,
): FramescaperNativeWatchImportCompletionRequest {
	const identity = currentIdentity(value, 'watch-import completion request');
	const record = closedRecord(value, [
		'schemaFamily', 'schemaVersion', 'claimId', 'projectId', 'binId', 'sourceId',
		'contentSha256', 'expectedProjectRevision', 'committedProjectRevision', 'success',
	], 'watch-import completion request');
	const success = boolean(record.success, 'watch-import success');
	const sourceId = record.sourceId === null ? null
		: identifier(record.sourceId, 'watch-import source id');
	if (success && sourceId === null) throw new TypeError('A completed watch import requires its source id.');
	return Object.freeze({
		...identity,
		claimId: opaqueId(record.claimId, 'watch-import claim id'),
		projectId: identifier(record.projectId, 'watch-import project id'),
		binId: selectedBin(record.binId), sourceId,
		contentSha256: digest(record.contentSha256),
		expectedProjectRevision: nonNegativeInteger(record.expectedProjectRevision, 'expected project revision'),
		committedProjectRevision: nonNegativeInteger(record.committedProjectRevision, 'committed project revision'),
		success,
	});
}

export function framescaperNativeWatchImportClaim(
	value: unknown,
): FramescaperNativeWatchImportClaim {
	const identity = currentIdentity(value, 'watch-import claim');
	const record = closedRecord(value, [
		'schemaFamily', 'schemaVersion', 'claimId', 'projectId', 'projectRevision', 'binId',
		'generateProxies', 'existingSourceId', 'importMode', 'locatorId', 'locatorRevision',
		'name', 'size', 'mimeType', 'lastModified', 'contentSha256',
	], 'watch-import claim');
	if (record.importMode !== 'link' && record.importMode !== 'copy') {
		throw new TypeError('Invalid watch-import mode.');
	}
	const locator = framescaperNativeWatchLinkedLocator({
		locatorId: record.locatorId as string, locatorRevision: record.locatorRevision as string,
		name: record.name as string, size: record.size as number, mimeType: record.mimeType as string,
		lastModified: record.lastModified as number,
	});
	return Object.freeze({
		...identity,
		claimId: opaqueId(record.claimId, 'watch-import claim id'),
		projectId: identifier(record.projectId, 'watch-import project id'),
		projectRevision: nonNegativeInteger(record.projectRevision, 'watch-import project revision'),
		binId: selectedBin(record.binId),
		generateProxies: boolean(record.generateProxies, 'watch-import proxy choice'),
		existingSourceId: record.existingSourceId === null ? null
			: identifier(record.existingSourceId, 'watch-import source id'),
		importMode: record.importMode,
		...locator,
		contentSha256: digest(record.contentSha256),
	});
}

export function framescaperNativeWatchImportedWitness(
	value: unknown,
): FramescaperNativeWatchImportedWitness | null {
	if (value === null) return null;
	const identity = currentIdentity(value, 'watch-import project witness');
	const record = closedRecord(value, [
		'schemaFamily', 'schemaVersion', 'projectId', 'projectRevision', 'binId',
		'sourceId', 'contentSha256', 'proxyAttached',
	], 'watch-import project witness');
	return Object.freeze({
		...identity,
		projectId: identifier(record.projectId, 'watch-import project id'),
		projectRevision: nonNegativeInteger(record.projectRevision, 'watch-import project revision'),
		binId: selectedBin(record.binId),
		sourceId: identifier(record.sourceId, 'watch-import source id'),
		contentSha256: digest(record.contentSha256),
		proxyAttached: boolean(record.proxyAttached, 'watch-import proxy attachment'),
	});
}

function currentIdentity(value: unknown, label: string): FramescaperProjectIdentity {
	const identity = readProjectSchemaIdentity(value);
	if (identity.schemaFamily !== FRAMESCAPER_PROJECT_SCHEMA_FAMILY
		|| identity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new TypeError(`${label} requires the exact Framescaper v1 project identity.`);
	}
	return Object.freeze({
		schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
		schemaVersion: PROJECT_SCHEMA_VERSION,
	});
}

function closedRecord<const Field extends string>(
	value: unknown, fields: readonly Field[], label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${label} has missing or unsupported fields.`);
	}
	const result = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${field} must be an own enumerable data property.`);
		}
		result[field] = descriptor.value;
	}
	return result;
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) throw new TypeError(`Invalid ${label}.`);
	return value;
}

function identifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !PROJECT_ID.test(value)) throw new TypeError(`Invalid ${label}.`);
	return value;
}

function selectedBin(value: unknown): typeof FRAMESCAPER_PROJECT_WATCH_BIN_ID {
	if (value !== FRAMESCAPER_PROJECT_WATCH_BIN_ID) throw new TypeError('Invalid watch-import project bin.');
	return value;
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError('Invalid watch-import content digest.');
	return value;
}

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean.`);
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`Invalid ${label}.`);
	return Number(value);
}
