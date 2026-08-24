/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertNativeMediaRelativeDestination } from './native-media-atomic-publication.ts';
import {
	NATIVE_MEDIA_PLAN_CANONICAL_MAXIMUM_BYTES,
	canonicalizeNativeMediaPlan,
	fingerprintNativeMediaPlan,
} from './native-media-plan-canonical-form.ts';
import { createNativeMediaPlanEnvelopeV2 } from './native-media-plan-envelope-v2.ts';
import type {
	NativeQueueInputFingerprintV1,
	NativeQueueRecordV1,
	NativeQueueRecordV2,
	NativeQueueRecoveryClass,
	NativeQueueReservationsV1,
	NativeQueueTaskKind,
} from './native-queue-record.ts';
import {
	NATIVE_QUEUE_CHECKPOINTABLE_TASK_KINDS,
	NATIVE_QUEUE_RECOVERY_CLASSES,
	NATIVE_QUEUE_STATES,
	NATIVE_QUEUE_TASK_KINDS,
	assertNativeQueueRecordV2,
} from './native-queue-record.ts';
import { assertUnifiedExactRenderPlanWithDeferredTimingReferences, type UnifiedExactRenderTimingSidecars } from './unified-exact-render-plan.ts';

export const NATIVE_QUEUE_RECORD_V3_VERSION = 3 as const;
export const NATIVE_QUEUE_V3_CUSTODY_PLAN_VERSIONS = Object.freeze([6, 7, 8, 9, 10, 11, 12, 13] as const);
export const NATIVE_QUEUE_V3_ACTIVE_PLAN_VERSIONS = Object.freeze([14] as const);
export type NativeQueuePlanVersionV3 = 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface NativeQueueRecordV3 extends Omit<NativeQueueRecordV1, 'planVersion'> {
	readonly recordVersion: typeof NATIVE_QUEUE_RECORD_V3_VERSION;
	readonly planVersion: NativeQueuePlanVersionV3;
}

const RECORD_FIELDS = Object.freeze([
	'jobId', 'recordVersion', 'taskKind', 'planVersion', 'planFingerprint', 'planPayload',
	'projectId', 'projectRevision', 'inputFingerprints', 'rootGrantId', 'relativeDestination',
	'reservations', 'recoveryClass', 'state', 'position', 'progress', 'attempt',
	'lastFailureCode', 'createdAtMs', 'updatedAtMs',
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const JOB_ID = /^[a-f0-9]{40}$/u;
const OPAQUE_ID = /^[a-f0-9]{16,64}$/u;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const FAILURE = /^[a-z][a-z0-9-]{0,63}$/u;

export function createNativeQueueRecordV3(input: Readonly<{
	readonly jobId: string;
	readonly taskKind: NativeQueueTaskKind;
	readonly plan: unknown;
	readonly timingSidecars?: UnifiedExactRenderTimingSidecars;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly inputFingerprints: readonly NativeQueueInputFingerprintV1[];
	readonly rootGrantId: string;
	readonly relativeDestination: string;
	readonly reservations: NativeQueueReservationsV1;
	readonly recoveryClass?: NativeQueueRecoveryClass;
	readonly position: number;
	readonly createdAtMs: number;
}>): NativeQueueRecordV3 {
	const envelope = createNativeMediaPlanEnvelopeV2(input.plan, input.timingSidecars);
	if (envelope.planVersion !== 14) throw new RangeError('New native queue V3 work must use selected plan V14.');
	const record: NativeQueueRecordV3 = Object.freeze({
		recordVersion: NATIVE_QUEUE_RECORD_V3_VERSION,
		jobId: input.jobId, taskKind: input.taskKind, planVersion: 14,
		planFingerprint: envelope.fingerprint,
		planPayload: canonicalizeNativeMediaPlan(envelope.plan),
		projectId: input.projectId, projectRevision: input.projectRevision,
		inputFingerprints: Object.freeze(input.inputFingerprints.map((row) => Object.freeze({ ...row }))),
		rootGrantId: input.rootGrantId, relativeDestination: input.relativeDestination,
		reservations: Object.freeze({ ...input.reservations }),
		recoveryClass: input.recoveryClass ?? 'atomic-restart',
		state: 'queued', position: input.position, progress: null, attempt: 0,
		lastFailureCode: null, createdAtMs: input.createdAtMs, updatedAtMs: input.createdAtMs,
	});
	assertNativeQueueRecordV3(record);
	return record;
}

export function migrateNativeQueueRecordV2ToV3(value: NativeQueueRecordV2): NativeQueueRecordV3 {
	assertNativeQueueRecordV2(value);
	const settled = value.state === 'completed' || value.state === 'cancelled';
	const migrated = Object.freeze({
		...value,
		recordVersion: NATIVE_QUEUE_RECORD_V3_VERSION,
		planVersion: value.planVersion as NativeQueuePlanVersionV3,
		state: settled ? value.state : 'blocked',
		progress: settled ? value.progress : null,
		lastFailureCode: value.state === 'completed' ? value.lastFailureCode : 'unsupported-plan-version',
	}) as NativeQueueRecordV3;
	assertNativeQueueRecordV3(migrated);
	return migrated;
}

export function assertNativeQueueRecordV3(value: unknown): asserts value is NativeQueueRecordV3 {
	const row = record(value, 'native queue V3 record');
	exactKeys(row, RECORD_FIELDS);
	if (row.recordVersion !== NATIVE_QUEUE_RECORD_V3_VERSION) throw new TypeError('Native queue recordVersion must be 3.');
	text(row.jobId, JOB_ID, 'jobId');
	member(row.taskKind, NATIVE_QUEUE_TASK_KINDS, 'taskKind');
	if (![...NATIVE_QUEUE_V3_CUSTODY_PLAN_VERSIONS, ...NATIVE_QUEUE_V3_ACTIVE_PLAN_VERSIONS].includes(row.planVersion as never)) {
		throw new RangeError('Native queue V3 planVersion is unsupported.');
	}
	text(row.planFingerprint, SHA256, 'planFingerprint');
	text(row.projectId, PROJECT_ID, 'projectId');
	integer(row.projectRevision, 'projectRevision');
	inputFingerprints(row.inputFingerprints);
	text(row.rootGrantId, OPAQUE_ID, 'rootGrantId');
	assertNativeMediaRelativeDestination(row.relativeDestination);
	reservations(row.reservations);
	const recoveryClass = member(row.recoveryClass, NATIVE_QUEUE_RECOVERY_CLASSES, 'recoveryClass');
	const taskKind = row.taskKind as NativeQueueTaskKind;
	if (recoveryClass === 'verified-frame-checkpoint' && !NATIVE_QUEUE_CHECKPOINTABLE_TASK_KINDS.includes(taskKind)) {
		throw new RangeError('Only an image sequence may use verified frame checkpoints.');
	}
	const state = member(row.state, NATIVE_QUEUE_STATES, 'state');
	integer(row.position, 'position');
	if (row.progress !== null && (typeof row.progress !== 'number' || !Number.isFinite(row.progress)
		|| row.progress < 0 || row.progress > 1)) throw new RangeError('Native queue progress must be null or a ratio.');
	integer(row.attempt, 'attempt');
	if (row.lastFailureCode !== null) text(row.lastFailureCode, FAILURE, 'lastFailureCode');
	if (state === 'failed' && row.lastFailureCode === null) throw new TypeError('A failed queue row requires a failure code.');
	const created = integer(row.createdAtMs, 'createdAtMs');
	if (integer(row.updatedAtMs, 'updatedAtMs') < created) throw new RangeError('Queue update precedes creation.');
	assertStoredPlan(row as unknown as NativeQueueRecordV3);
	assertCustodyBlocked(row as unknown as NativeQueueRecordV3);
}

export function isNativeQueueRecordV3Dispatchable(recordValue: NativeQueueRecordV3): boolean {
	assertNativeQueueRecordV3(recordValue);
	return recordValue.planVersion === 14;
}

function assertStoredPlan(row: NativeQueueRecordV3): void {
	if (typeof row.planPayload !== 'string' || row.planPayload.length === 0
		|| row.planPayload.length > NATIVE_MEDIA_PLAN_CANONICAL_MAXIMUM_BYTES) {
		throw new RangeError('Native queue V3 plan payload is absent or exceeds its ceiling.');
	}
	let plan: unknown;
	try { plan = JSON.parse(row.planPayload) as unknown; } catch { throw new TypeError('Native queue V3 plan is not JSON.'); }
	const fingerprint = fingerprintNativeMediaPlan(plan);
	if (fingerprint.canonical !== row.planPayload || fingerprint.sha256 !== row.planFingerprint
		|| record(plan, 'native queue plan').version !== row.planVersion) {
		throw new Error('Native queue V3 plan payload and fingerprint disagree.');
	}
	if (row.planVersion === 13 || row.planVersion === 14) {
		try { createNativeMediaPlanEnvelopeV2(plan); }
		catch { assertUnifiedExactRenderPlanWithDeferredTimingReferences(plan); }
	}
}

function assertCustodyBlocked(row: NativeQueueRecordV3): void {
	if (row.planVersion === 14 || row.state === 'completed') return;
	if ((row.state !== 'blocked' && row.state !== 'cancelled')
		|| row.lastFailureCode !== 'unsupported-plan-version') {
		throw new Error('A V6-V13 custody row must remain visibly blocked.');
	}
}

function inputFingerprints(value: unknown): void {
	if (!Array.isArray(value) || value.length > 4_096) throw new RangeError('Input fingerprints are invalid.');
	const ids = new Set<string>();
	for (const item of value) {
		const row = record(item, 'input fingerprint'); exactKeys(row, ['sourceId', 'sha256']);
		const id = text(row.sourceId, PROJECT_ID, 'sourceId'); text(row.sha256, SHA256, 'sha256');
		if (ids.has(id)) throw new RangeError('Input fingerprint source IDs must be unique.'); ids.add(id);
	}
}
function reservations(value: unknown): void {
	const row = record(value, 'reservations');
	exactKeys(row, ['cpuCores', 'processTreeRssBytes', 'scratchBytes', 'minimumFreeBytes', 'hardwareBackend']);
	if (integer(row.cpuCores, 'cpuCores') < 1 || Number(row.cpuCores) > 1_024) throw new RangeError('CPU reservation is invalid.');
	for (const key of ['processTreeRssBytes', 'scratchBytes', 'minimumFreeBytes'] as const) integer(row[key], key);
	if (row.hardwareBackend !== null) text(row.hardwareBackend, FAILURE, 'hardwareBackend');
}
function exactKeys(row: Record<string, unknown>, fields: readonly string[]): void {
	const keys = Reflect.ownKeys(row);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('Native queue V3 record has missing or unsupported fields.');
	}
}
function member<Value extends string>(value: unknown, values: readonly Value[], name: string): Value {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) throw new TypeError(`${name} is invalid.`);
	return value as Value;
}
function integer(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative integer.`);
	return Number(value);
}
function text(value: unknown, pattern: RegExp, name: string): string {
	if (typeof value !== 'string' || !pattern.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}
function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}
