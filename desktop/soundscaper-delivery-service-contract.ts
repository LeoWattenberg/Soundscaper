/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	SoundscaperDeliveryDescriptionV1,
	SoundscaperDeliveryProjectIdentityV1,
	SoundscaperDeliveryResultV1,
} from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import type { DeliveryReport } from '../src/common/editor/delivery-report.ts';
import { parseSoundscaperDeliveryPlanV1 } from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import { fingerprintSoundscaperDeliveryPlanV1 } from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import {
	validateSoundscaperPersistentDeliveryBatchMemberV1,
} from '../src/common/editor/soundscaper-persistent-delivery-plan-v1.ts';
import type { SoundscaperDeliveryRootObservation } from './soundscaper-delivery-root.ts';
import type { SoundscaperDeliveryFilesystemAuthority } from './soundscaper-delivery-filesystem-authority.ts';

export type SoundscaperDeliveryPersistedState =
	| 'queued' | 'running' | 'needs-authorization' | 'stale'
	| 'completed' | 'failed' | 'cancelled';
export type SoundscaperDeliveryVisibleState =
	| SoundscaperDeliveryPersistedState | 'waiting-for-project';

export interface SoundscaperDeliverySummary {
	readonly jobId: string;
	readonly label: string;
	readonly state: SoundscaperDeliveryVisibleState;
	readonly attempt: number;
	readonly progress: number | null;
	readonly lastFailureCode: string | null;
	readonly projectIdentity: SoundscaperDeliveryProjectIdentityV1;
	readonly planFingerprint: string;
	readonly destinationGrantId: string;
	readonly batchId: string | null;
	readonly batchMember: Readonly<Record<string, unknown>> | null;
	readonly report: DeliveryReport | null;
	readonly reportHistory: readonly SoundscaperDeliveryAttemptReport[];
	readonly result: SoundscaperDeliveryResultV1 | null;
}

export interface SoundscaperDeliveryAttemptReport {
	readonly attempt: number;
	readonly outcome: 'completed' | 'failed';
	readonly failureCode: string | null;
	readonly report: DeliveryReport;
}

export interface SoundscaperDeliveryAttemptReportRow extends Record<string, unknown> {
	attempt: number;
	outcome: 'completed' | 'failed';
	failure_code: string | null;
	report_json: string;
}

export interface SoundscaperDeliveryClaim {
	readonly jobId: string;
	readonly claimId: string;
	readonly description: SoundscaperDeliveryDescriptionV1;
	readonly plan: unknown;
}

export interface SoundscaperDeliveryEvent {
	readonly sequence: number;
	readonly type: string;
	readonly jobId: string | null;
	readonly state: SoundscaperDeliveryPersistedState | null;
	readonly createdAtMs: number;
}

export interface SoundscaperDeliverySavedAdmission {
	readonly projectIdentity: SoundscaperDeliveryProjectIdentityV1;
	/** One independently re-derived fingerprint in exact batch-member order. */
	readonly planFingerprints: readonly string[];
	readonly saved: true;
	readonly clean: true;
	readonly named: true;
}

export interface SoundscaperDeliveryStartOptions {
	readonly databasePath: string;
	readonly readProjectIdentity: (
		projectId: string,
	) => PromiseLike<SoundscaperDeliveryProjectIdentityV1 | null>
		| SoundscaperDeliveryProjectIdentityV1 | null;
	readonly instanceId?: string;
	readonly processId?: number;
	readonly now?: () => number;
	readonly observeRoot?: (path: unknown) => Promise<SoundscaperDeliveryRootObservation>;
	/** Test/composition hook invoked after file I/O and immediately before the lease fence. */
	readonly beforeFileFence?: (operation: string) => void;
	readonly filesystem: SoundscaperDeliveryFilesystemAuthority;
}

export interface SoundscaperDeliveryQueueRow extends Record<string, unknown> {
	job_id: string;
	description_json: string;
	label: string;
	project_id: string;
	project_revision: number;
	project_sha256: string;
	destination_grant_id: string;
	batch_id: string | null;
	batch_member_json: string | null;
	state: SoundscaperDeliveryPersistedState;
	position: number;
	attempt: number;
	progress: number | null;
	claim_id: string | null;
	staging_name: string | null;
	staging_volume_identity: string | null;
	staging_file_identity: string | null;
	staging_recovery_token: string | null;
	final_name: string | null;
	staged_byte_length: number | null;
	staged_sha256: string | null;
	last_failure_code: string | null;
	report_json: string | null;
	result_json: string | null;
}

export function sameSoundscaperDeliveryProject(
	left: SoundscaperDeliveryProjectIdentityV1,
	right: SoundscaperDeliveryProjectIdentityV1,
): boolean {
	return left.projectId === right.projectId && left.projectRevision === right.projectRevision
		&& left.projectSha256 === right.projectSha256;
}

export function soundscaperDeliveryId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{48}$/u.test(value)) {
		throw new TypeError(`A Soundscaper delivery ${label} id is invalid.`);
	}
	return value;
}

export function soundscaperDeliveryNonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`The Soundscaper delivery ${label} is invalid.`);
	}
	return Number(value);
}

export function soundscaperDeliveryPageLimit(value: unknown): number {
	const limit = soundscaperDeliveryNonNegativeInteger(value, 'page limit');
	if (limit < 1 || limit > 1_000) throw new RangeError('A Soundscaper delivery page contains 1 through 1000 rows.');
	return limit;
}

export function soundscaperDeliveryCursor(value: unknown): number {
	if (typeof value !== 'string' || !/^\d+$/u.test(value)) throw new TypeError('The delivery cursor is invalid.');
	return soundscaperDeliveryNonNegativeInteger(Number(value), 'queue cursor');
}

export function soundscaperDeliveryFailureCode(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
		throw new TypeError('The Soundscaper delivery failure code is invalid.');
	}
	return value;
}

export function waitingSoundscaperDeliveryState(
	state: SoundscaperDeliveryPersistedState,
	expected: SoundscaperDeliveryProjectIdentityV1,
	current: SoundscaperDeliveryProjectIdentityV1 | null,
): SoundscaperDeliveryVisibleState {
	if (state !== 'queued') return state;
	if (!current || current.projectId !== expected.projectId) return 'waiting-for-project';
	return sameSoundscaperDeliveryProject(expected, current) ? 'queued' : 'stale';
}

export function admitSoundscaperDeliverySavedAdmission(
	value: unknown,
): SoundscaperDeliverySavedAdmission {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Persistent delivery requires exact saved project admission.');
	}
	const admission = value as Partial<SoundscaperDeliverySavedAdmission>;
	if (admission.saved !== true || admission.clean !== true || admission.named !== true
		|| !admission.projectIdentity || !Array.isArray(admission.planFingerprints)) {
		throw new Error('Persistent delivery requires one saved, clean, named project revision.');
	}
	return admission as SoundscaperDeliverySavedAdmission;
}

export function assertSoundscaperDeliveryBatchPlan(
	description: SoundscaperDeliveryDescriptionV1,
	batch: Readonly<{ batchId: string; member: Readonly<Record<string, unknown>> }>,
): void {
	const plan = parseSoundscaperDeliveryPlanV1(description) as Readonly<{
		settings?: unknown;
		batch?: Readonly<{
			batchId?: unknown; memberId?: unknown; presetId?: unknown;
			target?: unknown; mode?: unknown;
		}>;
	}>;
	const member = validateSoundscaperPersistentDeliveryBatchMemberV1(batch.member);
	if (typeof batch.batchId !== 'string' || !batch.batchId
		|| plan.batch?.batchId !== batch.batchId
		|| plan.batch.memberId !== member.memberId
		|| plan.batch.presetId !== member.presetId
		|| plan.batch.mode !== member.mode
		|| description.label !== member.label
		|| canonical(plan.batch.target) !== canonical(member.target)
		|| canonical(plan.settings) !== canonical(member.settings)) {
		throw new Error('Persistent delivery batch authority must be sealed inside each member plan.');
	}
}

function canonical(value: unknown): string {
	return fingerprintSoundscaperDeliveryPlanV1(value).canonical;
}
