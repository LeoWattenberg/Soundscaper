/* SPDX-License-Identifier: AGPL-3.0-only */

/** Typed refusals for the lazy Milestone 7 runtime families. */

import type { AssistanceRuntimeFamilyJobRequestV1 } from './assistance-runtime-family-job-contract.ts';
import {
	ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS,
	type AssistanceRuntimeFamilyId,
} from './assistance-runtime-family-manifest.ts';

export type AssistanceRuntimeFamilyErrorCode =
	| 'invalid-request'
	| 'unsupported-task'
	| 'unsupported-platform'
	| 'manifest-missing'
	| 'manifest-invalid'
	| 'payload-pending-external'
	| 'payload-missing'
	| 'payload-digest-mismatch'
	| 'insufficient-memory'
	| 'power-deferred'
	| 'quarantined'
	| 'busy'
	| 'cancelled'
	| 'cancellation-timeout'
	| 'runtime-exit'
	| 'worker-error'
	| 'malformed-message'
	| 'resource-violation'
	| 'disposed';

export class AssistanceRuntimeFamilyError extends Error {
	readonly code: AssistanceRuntimeFamilyErrorCode;
	readonly familyId: AssistanceRuntimeFamilyId;
	readonly jobId: string | null;

	constructor(
		code: AssistanceRuntimeFamilyErrorCode,
		familyId: AssistanceRuntimeFamilyId,
		message: string,
		jobId: string | null = null,
	) {
		super(message);
		this.name = 'AssistanceRuntimeFamilyError';
		this.code = code;
		this.familyId = familyId;
		this.jobId = jobId;
	}
}

export function assistanceRuntimeFamilyFailure(
	code: AssistanceRuntimeFamilyErrorCode,
	request: AssistanceRuntimeFamilyJobRequestV1,
	message: string,
): AssistanceRuntimeFamilyError {
	return new AssistanceRuntimeFamilyError(code, request.familyId, message, request.jobId);
}

export function inferredAssistanceRuntimeFamily(value: unknown): AssistanceRuntimeFamilyId {
	return plainRecord(value) && typeof value.familyId === 'string'
		&& Object.hasOwn(ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS, value.familyId)
		? value.familyId as AssistanceRuntimeFamilyId : 'onnxruntime-node';
}

export function inferredAssistanceJobId(value: unknown): string | null {
	return plainRecord(value) && typeof value.jobId === 'string' ? value.jobId : null;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function assistanceRuntimeErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
