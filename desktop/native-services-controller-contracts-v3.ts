/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	DurableRootGrantProjectionV1, DurableRootGrantV1,
} from '../src/common/editor/native-durable-root-grant.ts';
import type {
	NativeQueueState, NativeQueueTaskKind,
} from '../src/common/editor/native-queue-record.ts';
import {
	FRAMESCAPER_NATIVE_QUEUE_RENDERER_ACTIONS,
	type FramescaperNativeQueueRendererAction,
} from './native-services-carrier-recovery-v3.ts';
import type { FramescaperNativeRootGrant } from './native-services-root-repository.ts';
import {
	assertFramescaperNativeWatchProjection,
	type FramescaperNativeWatchProjection,
} from './native-services-watch-controller-contract.ts';
import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
} from '../src/common/editor/project-schema-identity.ts';

export const FRAMESCAPER_NATIVE_SERVICES_SNAPSHOT_VERSION = 1;
export const FRAMESCAPER_NATIVE_SERVICE_PREFERENCES = Object.freeze([
	'native-media', 'hardware-decode', 'hardware-encode', 'ofx-consent',
] as const);

export type FramescaperNativeServicePreference =
	(typeof FRAMESCAPER_NATIVE_SERVICE_PREFERENCES)[number];
export interface FramescaperNativeServicePreferences {
	readonly nativeMediaEnabled: boolean;
	readonly hardwareDecodeEnabled: boolean;
	readonly hardwareEncodeEnabled: boolean;
	readonly ofxConsentEnabled: boolean;
}

export interface FramescaperNativeQueueProjection {
	readonly jobId: string;
	readonly schemaFamily: typeof FRAMESCAPER_PROJECT_SCHEMA_FAMILY;
	readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
	readonly taskKind: NativeQueueTaskKind;
	readonly projectId: string;
	readonly relativeDestination: string;
	readonly state: NativeQueueState;
	readonly position: number;
	readonly progress: number | null;
	readonly attempt: number;
	readonly lastFailureCode: string | null;
}

export interface FramescaperNativeServicesSnapshot {
	readonly snapshotVersion: typeof FRAMESCAPER_NATIVE_SERVICES_SNAPSHOT_VERSION;
	readonly runtimeAvailable: boolean;
	readonly nativeMediaEnabled: boolean;
	readonly queue: readonly FramescaperNativeQueueProjection[];
	readonly roots: readonly DurableRootGrantProjectionV1[];
	readonly watchRules: readonly FramescaperNativeWatchProjection[];
}

export type FramescaperNativeQueueControlRequest = Readonly<{
	readonly jobId: string;
	readonly action: FramescaperNativeQueueRendererAction;
}>;
export type FramescaperNativeQueueRemoveRequest = Readonly<{ readonly jobId: string }>;
export type FramescaperNativeQueueReorderRequest = Readonly<{
	readonly jobId: string;
	readonly index: number;
}>;
export type FramescaperNativePreferenceRequest = Readonly<{
	readonly preference: FramescaperNativeServicePreference;
	readonly enabled: boolean;
}>;

export function framescaperNativeServicePreferences(
	value: unknown,
): FramescaperNativeServicePreferences {
	const preferences = closedRecord(value, [
		'nativeMediaEnabled', 'hardwareDecodeEnabled', 'hardwareEncodeEnabled', 'ofxConsentEnabled',
	], 'native-service preferences');
	for (const key of [
		'nativeMediaEnabled', 'hardwareDecodeEnabled', 'hardwareEncodeEnabled', 'ofxConsentEnabled',
	] as const) {
		if (typeof preferences[key] !== 'boolean') {
			throw new TypeError('A native-service preference must be boolean.');
		}
	}
	return Object.freeze(preferences as unknown as FramescaperNativeServicePreferences);
}

export function framescaperNativePreferenceRequest(
	value: unknown,
): FramescaperNativePreferenceRequest {
	const request = closedRecord(value, ['preference', 'enabled'], 'native-service preference request');
	if (typeof request.preference !== 'string'
		|| !(FRAMESCAPER_NATIVE_SERVICE_PREFERENCES as readonly string[]).includes(request.preference)) {
		throw new TypeError('A native-service preference request names an unsupported preference.');
	}
	if (typeof request.enabled !== 'boolean') {
		throw new TypeError('A native-service preference request requires a boolean value.');
	}
	return Object.freeze({
		preference: request.preference as FramescaperNativeServicePreference,
		enabled: request.enabled,
	});
}

export function framescaperNativeQueueControlRequest(value: unknown): FramescaperNativeQueueControlRequest {
	const request = closedRecord(value, ['jobId', 'action'], 'native queue control request');
	const action = request.action;
	if (typeof action !== 'string'
		|| !(FRAMESCAPER_NATIVE_QUEUE_RENDERER_ACTIONS as readonly string[]).includes(action)) {
		throw new TypeError('A native queue control request names an unsupported action.');
	}
	return Object.freeze({ jobId: exactJobId(request.jobId), action: action as FramescaperNativeQueueRendererAction });
}

export function framescaperNativeQueueRemoveRequest(value: unknown): FramescaperNativeQueueRemoveRequest {
	const request = closedRecord(value, ['jobId'], 'native queue remove request');
	return Object.freeze({ jobId: exactJobId(request.jobId) });
}

export function framescaperNativeQueueReorderRequest(value: unknown): FramescaperNativeQueueReorderRequest {
	const request = closedRecord(value, ['jobId', 'index'], 'native queue reorder request');
	if (!Number.isSafeInteger(request.index) || (request.index as number) < 0) {
		throw new RangeError('A native queue reorder request requires a non-negative index.');
	}
	return Object.freeze({ jobId: exactJobId(request.jobId), index: request.index as number });
}

export function assertFramescaperNativeServicesSnapshot(
	value: unknown,
): asserts value is FramescaperNativeServicesSnapshot {
	const snapshot = closedRecord(
		value,
		['snapshotVersion', 'runtimeAvailable', 'nativeMediaEnabled', 'queue', 'roots', 'watchRules'],
		'native services snapshot',
	);
	if (snapshot.snapshotVersion !== FRAMESCAPER_NATIVE_SERVICES_SNAPSHOT_VERSION
		|| typeof snapshot.runtimeAvailable !== 'boolean'
		|| typeof snapshot.nativeMediaEnabled !== 'boolean') {
		throw new TypeError('A native services snapshot has an invalid version or availability state.');
	}
	boundedArray(snapshot.queue, 100_000, 'native services queue').forEach(assertFramescaperNativeQueueProjection);
	boundedArray(snapshot.roots, 1_024, 'native services roots').forEach(assertFramescaperNativeRootProjection);
	boundedArray(snapshot.watchRules, 1_024, 'native services watch rules').forEach(assertFramescaperNativeWatchProjection);
}

export function framescaperNativeQueueProjection(record: Readonly<{
	jobId: string; schemaFamily: typeof FRAMESCAPER_PROJECT_SCHEMA_FAMILY;
	schemaVersion: typeof PROJECT_SCHEMA_VERSION;
	taskKind: NativeQueueTaskKind; projectId: string; relativeDestination: string;
	state: NativeQueueState; position: number; progress: number | null; attempt: number;
	lastFailureCode: string | null;
}>): FramescaperNativeQueueProjection {
	return Object.freeze({
		jobId: record.jobId, schemaFamily: record.schemaFamily, schemaVersion: record.schemaVersion,
		taskKind: record.taskKind, projectId: record.projectId,
		relativeDestination: record.relativeDestination, state: record.state,
		position: record.position, progress: record.progress, attempt: record.attempt,
		lastFailureCode: record.lastFailureCode,
	});
}

export function framescaperNativeCommonRootGrant(grant: FramescaperNativeRootGrant): DurableRootGrantV1 {
	return Object.freeze({
		grantId: grant.grantId, canonicalPath: grant.rootPath,
		volumeIdentity: grant.volumeIdentity, directoryIdentity: grant.directoryIdentity,
		authorizedAtMs: grant.authorizedAtMs, revokedAtMs: grant.revokedAtMs,
	});
}

export function assertFramescaperNativeQueueProjection(
	value: unknown,
): asserts value is FramescaperNativeQueueProjection {
	const identity = readProjectSchemaIdentity(value);
	if (identity.schemaFamily !== FRAMESCAPER_PROJECT_SCHEMA_FAMILY
		|| identity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new RangeError('A native queue projection requires the current Framescaper schema.');
	}
	const row = closedRecord(value, [
		'jobId', 'schemaFamily', 'schemaVersion', 'taskKind', 'projectId', 'relativeDestination', 'state',
		'position', 'progress', 'attempt', 'lastFailureCode',
	], 'native queue projection');
	exactJobId(row.jobId);
	for (const key of ['taskKind', 'projectId', 'relativeDestination', 'state'] as const) boundedText(row[key], key);
	for (const key of ['position', 'attempt'] as const) nonNegative(row[key], key);
	if (row.progress !== null && (typeof row.progress !== 'number'
		|| !Number.isFinite(row.progress) || row.progress < 0 || row.progress > 1)) {
		throw new TypeError('A native queue projection progress value is invalid.');
	}
	if (row.lastFailureCode !== null) boundedText(row.lastFailureCode, 'last failure code');
}

export function assertFramescaperNativeRootProjection(value: unknown): void {
	const root = closedRecord(value, ['grantId', 'displayName', 'revoked'], 'native root projection');
	boundedText(root.grantId, 'grant id');
	boundedText(root.displayName, 'display name');
	if (typeof root.revoked !== 'boolean') throw new TypeError('A native root projection revoked flag is invalid.');
}

function closedRecord<const Field extends string>(
	value: unknown, fields: readonly Field[], label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`A ${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`A ${label} has missing or unsupported fields.`);
	}
	return value as Readonly<Record<Field, unknown>>;
}

function boundedArray(value: unknown, maximum: number, label: string): readonly unknown[] {
	if (!Array.isArray(value) || value.length > maximum
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`A ${label} must be a bounded dense array.`);
	}
	return value;
}

function exactJobId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{40}$/u.test(value)) {
		throw new TypeError('A native queue request requires an exact job id.');
	}
	return value;
}

function boundedText(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 4_096 || value.includes('\0')) {
		throw new TypeError(`A native services ${label} value is invalid.`);
	}
	return value;
}

function nonNegative(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new RangeError(`A native services ${label} value is invalid.`);
	}
	return value as number;
}
