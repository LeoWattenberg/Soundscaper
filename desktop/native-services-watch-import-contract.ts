/* SPDX-License-Identifier: AGPL-3.0-only */

import type { WatchRuleV1 } from '../src/common/editor/native-watch-rule.ts';
import type { FramescaperNativeWatchEntry } from './native-services-watch-repository.ts';

const OPAQUE_ID = /^[a-f0-9]{16,64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SELECTED_V28_BIN_ID = 'project-bin';

export interface FramescaperNativeWatchLinkedLocator {
	readonly locatorId: string;
	readonly locatorRevision: string;
	readonly name: string;
	readonly size: number;
	readonly mimeType: string;
	readonly lastModified: number;
}

export interface FramescaperNativeWatchProjectWitness {
	readonly schemaVersion: 20 | 28 | 31;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly open: boolean;
	readonly writable: boolean;
	readonly binId?: string | null;
}

export interface FramescaperNativeWatchImportedWitness {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly binId: string;
	readonly sourceId: string;
	readonly contentSha256: string;
	readonly proxyAttached: boolean;
}

export interface FramescaperNativeWatchImportClaimRequest {
	readonly projectId: string;
	readonly projectRevision: number;
}

interface FramescaperNativeWatchImportClaimBase extends FramescaperNativeWatchLinkedLocator {
	readonly claimId: string;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly importMode: 'link' | 'copy';
	readonly contentSha256: string;
}

export type FramescaperNativeWatchImportClaimV20 = FramescaperNativeWatchImportClaimBase;

export interface FramescaperNativeWatchImportClaimV28
	extends FramescaperNativeWatchImportClaimBase {
	readonly projectSchemaVersion: 28 | 31;
	readonly binId: string;
	readonly generateProxies: boolean;
	readonly existingSourceId: string | null;
}

export type FramescaperNativeWatchImportClaim =
	| FramescaperNativeWatchImportClaimV20
	| FramescaperNativeWatchImportClaimV28;

interface FramescaperNativeWatchImportCompletionBase {
	readonly claimId: string;
	readonly projectId: string;
	readonly expectedProjectRevision: number;
	readonly committedProjectRevision: number;
	readonly success: boolean;
}

export type FramescaperNativeWatchImportCompletionRequestV20 =
	FramescaperNativeWatchImportCompletionBase;

export interface FramescaperNativeWatchImportCompletionRequestV28
	extends FramescaperNativeWatchImportCompletionBase {
	readonly projectSchemaVersion: 28 | 31;
	readonly binId: string;
	readonly sourceId: string | null;
	readonly contentSha256: string;
}

export type FramescaperNativeWatchImportCompletionRequest =
	| FramescaperNativeWatchImportCompletionRequestV20
	| FramescaperNativeWatchImportCompletionRequestV28;

export interface FramescaperNativeWatchImportOffer {
	readonly rule: WatchRuleV1;
	readonly entry: FramescaperNativeWatchEntry;
	readonly contentSha256: string;
}

export function framescaperNativeWatchImportOffer(
	value: FramescaperNativeWatchImportOffer,
): FramescaperNativeWatchImportOffer {
	if (!value?.rule || !value.entry || !SHA256.test(value.contentSha256)) {
		throw new TypeError('A watch-import offer requires an exact rule, entry, and SHA-256.');
	}
	return value;
}

export function framescaperNativeWatchRuleAdmitted(
	rule: WatchRuleV1,
	project: FramescaperNativeWatchProjectWitness,
): boolean {
	if (!rule.enabled || rule.recursive
		|| (rule.importMode !== 'link' && rule.importMode !== 'copy')) return false;
	if (project.schemaVersion === 20) return !rule.generateProxies && rule.binId === null;
	return project.binId === SELECTED_V28_BIN_ID && rule.binId === project.binId;
}

export function framescaperNativeWatchUsableProject(
	value: FramescaperNativeWatchProjectWitness | null,
	projectId: string,
): value is FramescaperNativeWatchProjectWitness {
	return (value?.schemaVersion === 20 || value?.schemaVersion === 28 || value?.schemaVersion === 31)
		&& value.projectId === projectId && value.open && value.writable
		&& Number.isSafeInteger(value.projectRevision) && value.projectRevision >= 0
		&& (value.schemaVersion === 20 || value.binId === SELECTED_V28_BIN_ID);
}

export function framescaperNativeWatchLinkedLocator(
	value: FramescaperNativeWatchLinkedLocator,
): FramescaperNativeWatchLinkedLocator {
	if (!value || Reflect.ownKeys(value).length !== 6
		|| !OPAQUE_ID.test(value.locatorId) || !OPAQUE_ID.test(value.locatorRevision)
		|| typeof value.name !== 'string' || !value.name || value.name.length > 255
		|| !Number.isSafeInteger(value.size) || value.size < 1
		|| typeof value.mimeType !== 'string' || !value.mimeType.startsWith('video/')
		|| !Number.isSafeInteger(value.lastModified) || value.lastModified < 0) {
		throw new TypeError('A watch-import locator is not an exact pathless video locator.');
	}
	return Object.freeze({ ...value });
}

export function framescaperNativeWatchImportClaimRequest(
	value: unknown,
): FramescaperNativeWatchImportClaimRequest {
	const record = closedRecord(value, ['projectId', 'projectRevision'], 'watch-import claim request');
	return Object.freeze({
		projectId: identifier(record.projectId, 'watch-import project id'),
		projectRevision: nonNegativeInteger(record.projectRevision, 'watch-import project revision'),
	});
}

export function framescaperNativeWatchImportCompletionRequest(
	value: unknown,
): FramescaperNativeWatchImportCompletionRequest {
	if (hasOwn(value, 'projectSchemaVersion')) return completionRequestV28(value);
	const record = closedRecord(value, [
		'claimId', 'projectId', 'expectedProjectRevision', 'committedProjectRevision', 'success',
	], 'watch-import completion request');
	return Object.freeze({
		claimId: opaqueId(record.claimId, 'watch-import claim id'),
		projectId: identifier(record.projectId, 'watch-import project id'),
		expectedProjectRevision: nonNegativeInteger(record.expectedProjectRevision, 'expected project revision'),
		committedProjectRevision: nonNegativeInteger(record.committedProjectRevision, 'committed project revision'),
		success: boolean(record.success, 'watch-import success'),
	});
}

export function framescaperNativeWatchImportClaim(
	value: unknown,
): FramescaperNativeWatchImportClaim {
	if (hasOwn(value, 'projectSchemaVersion')) return claimV28(value);
	const record = claimRecord(value, [
		'claimId', 'projectId', 'projectRevision', 'importMode',
		'locatorId', 'locatorRevision', 'name', 'size', 'mimeType',
		'lastModified', 'contentSha256',
	]);
	return Object.freeze({ ...claimBase(record) });
}

export function framescaperNativeWatchImportedWitness(
	value: unknown,
): FramescaperNativeWatchImportedWitness | null {
	if (value === null) return null;
	const record = closedRecord(value, [
		'projectId', 'projectRevision', 'binId', 'sourceId', 'contentSha256', 'proxyAttached',
	], 'watch-import project witness');
	const contentSha256 = digest(record.contentSha256);
	return Object.freeze({
		projectId: identifier(record.projectId, 'watch-import project id'),
		projectRevision: nonNegativeInteger(record.projectRevision, 'watch-import project revision'),
		binId: selectedBin(record.binId),
		sourceId: identifier(record.sourceId, 'watch-import source id'),
		contentSha256,
		proxyAttached: boolean(record.proxyAttached, 'watch-import proxy attachment'),
	});
}

function claimV28(value: unknown): FramescaperNativeWatchImportClaimV28 {
	const record = claimRecord(value, [
		'claimId', 'projectId', 'projectRevision', 'projectSchemaVersion', 'binId',
		'generateProxies', 'existingSourceId', 'importMode', 'locatorId', 'locatorRevision',
		'name', 'size', 'mimeType', 'lastModified', 'contentSha256',
	]);
	const projectSchemaVersion = selectedProjectSchema(record.projectSchemaVersion);
	return Object.freeze({
		...claimBase(record), projectSchemaVersion, binId: selectedBin(record.binId),
		generateProxies: boolean(record.generateProxies, 'watch-import proxy choice'),
		existingSourceId: record.existingSourceId === null ? null
			: identifier(record.existingSourceId, 'watch-import source id'),
	});
}

function completionRequestV28(value: unknown): FramescaperNativeWatchImportCompletionRequestV28 {
	const record = closedRecord(value, [
		'claimId', 'projectId', 'projectSchemaVersion', 'binId', 'sourceId', 'contentSha256',
		'expectedProjectRevision', 'committedProjectRevision', 'success',
	], 'watch-import completion request');
	const projectSchemaVersion = selectedProjectSchema(record.projectSchemaVersion);
	const success = boolean(record.success, 'watch-import success');
	const sourceId = record.sourceId === null ? null : identifier(record.sourceId, 'watch-import source id');
	if (success && sourceId === null) throw new TypeError('A completed watch import requires its source id.');
	return Object.freeze({
		claimId: opaqueId(record.claimId, 'watch-import claim id'),
		projectId: identifier(record.projectId, 'watch-import project id'),
		projectSchemaVersion, binId: selectedBin(record.binId), sourceId,
		contentSha256: digest(record.contentSha256),
		expectedProjectRevision: nonNegativeInteger(record.expectedProjectRevision, 'expected project revision'),
		committedProjectRevision: nonNegativeInteger(record.committedProjectRevision, 'committed project revision'),
		success,
	});
}

function claimRecord<const Field extends string>(value: unknown, fields: readonly Field[]) {
	const record = closedRecord(value, fields, 'watch-import claim') as Readonly<Record<string, unknown>>;
	if (record['importMode'] !== 'link' && record['importMode'] !== 'copy') {
		throw new TypeError('Invalid watch-import mode.');
	}
	return record;
}

function claimBase(record: Readonly<Record<string, unknown>>): FramescaperNativeWatchImportClaimBase {
	const locator = framescaperNativeWatchLinkedLocator({
		locatorId: record.locatorId as string, locatorRevision: record.locatorRevision as string,
		name: record.name as string, size: record.size as number, mimeType: record.mimeType as string,
		lastModified: record.lastModified as number,
	});
	return {
		claimId: opaqueId(record.claimId, 'watch-import claim id'),
		projectId: identifier(record.projectId, 'watch-import project id'),
		projectRevision: nonNegativeInteger(record.projectRevision, 'watch-import project revision'),
		importMode: record.importMode as 'link' | 'copy', ...locator,
		contentSha256: digest(record.contentSha256),
	};
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
	return value as Readonly<Record<Field, unknown>>;
}

function hasOwn(value: unknown, field: string): boolean {
	return !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, field);
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) throw new TypeError(`Invalid ${label}.`);
	return value;
}

function identifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !PROJECT_ID.test(value)) throw new TypeError(`Invalid ${label}.`);
	return value;
}

function selectedBin(value: unknown): string {
	if (value !== SELECTED_V28_BIN_ID) throw new TypeError('Invalid selected watch-import bin.');
	return value;
}

function selectedProjectSchema(value: unknown): 28 | 31 {
	if (value !== 28 && value !== 31) throw new TypeError('Invalid watch-import project schema.');
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
