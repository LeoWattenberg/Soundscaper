/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * One row of the persistent render queue.
 *
 * A queue row is a bounded *description* of work, never the work's material. It
 * carries no raw filesystem path and no media bytes: the destination root is an
 * opaque grant id whose real path stays main-private, the destination itself is
 * a validated relative path, and the sources are named by fingerprint. That is
 * what makes the queue safe to persist across restarts — nothing in it grants
 * authority on its own, and every capability it names has to be revalidated
 * before the row can run again.
 *
 * The canonical plan is stored whole and immutable. Re-deriving a plan at
 * recovery time from a project that has since been edited would silently change
 * what a queued job renders; storing the exact plan, its version, and its
 * fingerprint means a job either still matches the project it was queued from
 * or is refused.
 */

import {
	assertNativeMediaRelativeDestination,
} from './native-media-atomic-publication.ts';
import {
	NATIVE_MEDIA_PLAN_CANONICAL_MAXIMUM_BYTES,
} from './native-media-plan-canonical-form.ts';
import {
	createNativeValidators,
	NATIVE_SHA256_HEX_PATTERN,
} from './native-validation.ts';

export const NATIVE_QUEUE_TASK_KINDS = Object.freeze([
	'encoded-export',
	'image-sequence-export',
	'proxy-generation',
] as const);

export type NativeQueueTaskKind = (typeof NATIVE_QUEUE_TASK_KINDS)[number];

export const NATIVE_QUEUE_RECOVERY_CLASSES = Object.freeze([
	'atomic-restart',
	'verified-frame-checkpoint',
] as const);

export type NativeQueueRecoveryClass = (typeof NATIVE_QUEUE_RECOVERY_CLASSES)[number];

export const NATIVE_QUEUE_STATES = Object.freeze([
	'queued',
	'running',
	'paused',
	'blocked',
	'needs-authorization',
	'completed',
	'failed',
	'cancelled',
] as const);

export type NativeQueueState = (typeof NATIVE_QUEUE_STATES)[number];

/**
 * Only an image sequence may checkpoint. An encoded container has no verifiable
 * partial state — resuming one would mean claiming container-byte resume, which
 * the milestone-6 exit gate explicitly forbids mislabelling.
 */
export const NATIVE_QUEUE_CHECKPOINTABLE_TASK_KINDS: readonly NativeQueueTaskKind[] =
	Object.freeze(['image-sequence-export']);

export const NATIVE_QUEUE_MAXIMUM_INPUT_FINGERPRINTS = 4_096;
export const NATIVE_QUEUE_MAXIMUM_ATTEMPTS = 1_000;

export interface NativeQueueInputFingerprintV1 {
	readonly sourceId: string;
	readonly sha256: string;
}

export interface NativeQueueReservationsV1 {
	readonly cpuCores: number;
	readonly processTreeRssBytes: number;
	readonly scratchBytes: number;
	readonly minimumFreeBytes: number;
	readonly hardwareBackend: string | null;
}

export interface NativeQueueRecordV1 {
	readonly jobId: string;
	readonly taskKind: NativeQueueTaskKind;
	readonly planVersion: number;
	readonly planFingerprint: string;
	readonly planPayload: string;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly inputFingerprints: readonly NativeQueueInputFingerprintV1[];
	readonly rootGrantId: string;
	readonly relativeDestination: string;
	readonly reservations: NativeQueueReservationsV1;
	readonly recoveryClass: NativeQueueRecoveryClass;
	readonly state: NativeQueueState;
	readonly position: number;
	readonly progress: number | null;
	readonly attempt: number;
	readonly lastFailureCode: string | null;
	readonly createdAtMs: number;
	readonly updatedAtMs: number;
}

export class NativeQueueRecordError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NativeQueueRecordError';
	}
}

const RECORD_KEYS = Object.freeze([
	'jobId', 'taskKind', 'planVersion', 'planFingerprint', 'planPayload',
	'projectId', 'projectRevision', 'inputFingerprints', 'rootGrantId',
	'relativeDestination', 'reservations', 'recoveryClass', 'state', 'position',
	'progress', 'attempt', 'lastFailureCode', 'createdAtMs', 'updatedAtMs',
]);
const RESERVATION_KEYS = Object.freeze([
	'cpuCores', 'processTreeRssBytes', 'scratchBytes', 'minimumFreeBytes', 'hardwareBackend',
]);
const FINGERPRINT_KEYS = Object.freeze(['sourceId', 'sha256']);
const JOB_ID_PATTERN = /^[a-f0-9]{40}$/u;
const OPAQUE_ID_PATTERN = /^[a-f0-9]{16,64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const FAILURE_CODE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const MAXIMUM_CPU_CORES = 1_024;
const MAXIMUM_RESERVATION_BYTES = 2 ** 53 - 1;

const { digest, exactKeys, nonNegativeInteger, pattern, plainRecord } = createNativeValidators({
	subject: 'A native queue record',
	raise: (message: string): never => {
		throw new NativeQueueRecordError(message);
	},
});

/** Admit one queue row, whether newly enqueued or read back from the database. */
export function assertNativeQueueRecordV1(value: unknown): asserts value is NativeQueueRecordV1 {
	const record = plainRecord(value, 'native queue record');
	exactKeys(record, RECORD_KEYS, 'native queue record');
	const taskKind = member(record.taskKind, NATIVE_QUEUE_TASK_KINDS, 'taskKind');
	const recoveryClass = member(record.recoveryClass, NATIVE_QUEUE_RECOVERY_CLASSES, 'recoveryClass');
	if (recoveryClass === 'verified-frame-checkpoint'
		&& !NATIVE_QUEUE_CHECKPOINTABLE_TASK_KINDS.includes(taskKind)) {
		throw new NativeQueueRecordError(
			`A ${taskKind} job restarts atomically; only an image sequence may declare a verified frame checkpoint.`,
		);
	}
	pattern(record.jobId, JOB_ID_PATTERN, 'jobId');
	digest(record.planFingerprint, 'planFingerprint');
	planVersion(record.planVersion);
	planPayload(record.planPayload, record.planFingerprint as string);
	pattern(record.projectId, IDENTIFIER_PATTERN, 'projectId');
	nonNegativeInteger(record.projectRevision, 'projectRevision');
	inputFingerprints(record.inputFingerprints);
	pattern(record.rootGrantId, OPAQUE_ID_PATTERN, 'rootGrantId');
	relativeDestination(record.relativeDestination);
	reservations(record.reservations);
	member(record.state, NATIVE_QUEUE_STATES, 'state');
	nonNegativeInteger(record.position, 'position');
	progress(record.progress);
	attempt(record.attempt);
	failureCode(record.lastFailureCode, record.state as NativeQueueState);
	const createdAtMs = nonNegativeInteger(record.createdAtMs, 'createdAtMs');
	if (nonNegativeInteger(record.updatedAtMs, 'updatedAtMs') < createdAtMs) {
		throw new NativeQueueRecordError('A native queue record cannot be updated before it was created.');
	}
}

/** Build a freshly enqueued row in its canonical initial state. */
export function createNativeQueueRecordV1(input: Readonly<{
	jobId: string;
	taskKind: NativeQueueTaskKind;
	planVersion: number;
	planFingerprint: string;
	planPayload: string;
	projectId: string;
	projectRevision: number;
	inputFingerprints: readonly NativeQueueInputFingerprintV1[];
	rootGrantId: string;
	relativeDestination: string;
	reservations: NativeQueueReservationsV1;
	recoveryClass?: NativeQueueRecoveryClass;
	position: number;
	createdAtMs: number;
}>): NativeQueueRecordV1 {
	const record: NativeQueueRecordV1 = Object.freeze({
		jobId: input.jobId,
		taskKind: input.taskKind,
		planVersion: input.planVersion,
		planFingerprint: input.planFingerprint,
		planPayload: input.planPayload,
		projectId: input.projectId,
		projectRevision: input.projectRevision,
		inputFingerprints: Object.freeze(input.inputFingerprints.map((entry) => Object.freeze({
			sourceId: entry.sourceId,
			sha256: entry.sha256,
		}))),
		rootGrantId: input.rootGrantId,
		relativeDestination: input.relativeDestination,
		reservations: Object.freeze({ ...input.reservations }),
		recoveryClass: input.recoveryClass ?? 'atomic-restart',
		state: 'queued',
		position: input.position,
		progress: null,
		attempt: 0,
		lastFailureCode: null,
		createdAtMs: input.createdAtMs,
		updatedAtMs: input.createdAtMs,
	});
	assertNativeQueueRecordV1(record);
	return record;
}

/** Nothing in a row may look like a filesystem path or embedded media body. */
export function nativeQueueRecordCarriesNoPathAuthority(record: NativeQueueRecordV1): boolean {
	const suspects = [record.rootGrantId, record.projectId, record.jobId];
	return suspects.every((value) => (
		!value.includes('/') && !value.includes('\\') && !/^[A-Za-z]:/u.test(value)
	));
}

function planVersion(value: unknown): number {
	if (value !== 6 && value !== 7) {
		throw new NativeQueueRecordError('A native queue record must name an exact canonical plan version.');
	}
	return value;
}

function planPayload(value: unknown, fingerprint: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new NativeQueueRecordError('A native queue record must carry its canonical plan payload.');
	}
	if (value.length > NATIVE_MEDIA_PLAN_CANONICAL_MAXIMUM_BYTES) {
		throw new NativeQueueRecordError('A native queue plan payload exceeds the canonical transfer ceiling.');
	}
	if (!NATIVE_SHA256_HEX_PATTERN.test(fingerprint)) {
		throw new NativeQueueRecordError('A native queue plan payload requires its canonical fingerprint.');
	}
	return value;
}

function inputFingerprints(value: unknown): void {
	if (!Array.isArray(value)) {
		throw new NativeQueueRecordError('A native queue record must list its input fingerprints.');
	}
	if (value.length > NATIVE_QUEUE_MAXIMUM_INPUT_FINGERPRINTS) {
		throw new NativeQueueRecordError('A native queue record exceeds its input-fingerprint ceiling.');
	}
	const seen = new Set<string>();
	for (const entry of value as readonly unknown[]) {
		const fingerprint = plainRecord(entry, 'native queue input fingerprint');
		exactKeys(fingerprint, FINGERPRINT_KEYS, 'native queue input fingerprint');
		const sourceId = pattern(fingerprint.sourceId, IDENTIFIER_PATTERN, 'inputFingerprints[].sourceId');
		digest(fingerprint.sha256, 'inputFingerprints[].sha256');
		if (seen.has(sourceId)) {
			throw new NativeQueueRecordError('A native queue record names the same input source twice.');
		}
		seen.add(sourceId);
	}
}

function reservations(value: unknown): void {
	const record = plainRecord(value, 'native queue reservations');
	exactKeys(record, RESERVATION_KEYS, 'native queue reservations');
	const cpuCores = record.cpuCores;
	if (!Number.isSafeInteger(cpuCores) || (cpuCores as number) < 1 || (cpuCores as number) > MAXIMUM_CPU_CORES) {
		throw new NativeQueueRecordError('A native queue reservation must declare at least one bounded CPU core.');
	}
	for (const key of ['processTreeRssBytes', 'scratchBytes', 'minimumFreeBytes'] as const) {
		const bytes = record[key];
		if (!Number.isSafeInteger(bytes) || (bytes as number) < 0 || (bytes as number) > MAXIMUM_RESERVATION_BYTES) {
			throw new NativeQueueRecordError(`A native queue reservation ${key} must be a bounded byte count.`);
		}
	}
	if (record.hardwareBackend !== null) {
		pattern(record.hardwareBackend, FAILURE_CODE_PATTERN, 'reservations.hardwareBackend');
	}
}

function relativeDestination(value: unknown): string {
	try {
		return assertNativeMediaRelativeDestination(value);
	} catch (error) {
		throw new NativeQueueRecordError(error instanceof Error ? error.message : String(error));
	}
}

function progress(value: unknown): number | null {
	if (value === null) return null;
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new NativeQueueRecordError('A native queue progress value must be null or a ratio in [0, 1].');
	}
	return value;
}

function attempt(value: unknown): number {
	const count = nonNegativeInteger(value, 'attempt');
	if (count > NATIVE_QUEUE_MAXIMUM_ATTEMPTS) {
		throw new NativeQueueRecordError('A native queue record exceeds its attempt ceiling.');
	}
	return count;
}

function failureCode(value: unknown, state: NativeQueueState): string | null {
	if (value === null) {
		if (state === 'failed') {
			throw new NativeQueueRecordError('A failed native queue record must name why it failed.');
		}
		return null;
	}
	return pattern(value, FAILURE_CODE_PATTERN, 'lastFailureCode');
}

function member<Value extends string>(
	value: unknown,
	values: readonly Value[],
	label: string,
): Value {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		throw new NativeQueueRecordError(`A native queue record ${label} must be a known member value.`);
	}
	return value as Value;
}
