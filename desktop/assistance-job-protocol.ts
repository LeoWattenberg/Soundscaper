/* SPDX-License-Identifier: AGPL-3.0-only */

/** Assistance façade over the shared Milestone-5 helper control contract. */

import {
	validateAssistanceSpeechJobGrant,
	type AssistanceSpeechJobGrant,
} from './assistance-speech-job-contract.ts';
import { HELPER_CANCELLATION_BUDGET_MS } from './helper-contract.ts';

export const ASSISTANCE_JOB_PROTOCOL_VERSION = 2;
export const ASSISTANCE_JOB_KINDS = Object.freeze(['speech'] as const);
export const ASSISTANCE_CANCELLATION_BUDGET_MS = HELPER_CANCELLATION_BUDGET_MS;
const JOB_ID = /^[a-f0-9]{40}$/u;
const KEYS = Object.freeze(['protocolVersion', 'jobId', 'kind', 'grant']);

export interface AssistanceJobRequest {
	readonly protocolVersion: typeof ASSISTANCE_JOB_PROTOCOL_VERSION;
	readonly jobId: string;
	readonly kind: 'speech';
	readonly grant: AssistanceSpeechJobGrant;
}

export function validateAssistanceJobRequest(value: unknown): AssistanceJobRequest {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('An assistance job request must be a plain record.');
	}
	const record = value as Record<string, unknown>;
	const present = Object.keys(record);
	if (present.length !== KEYS.length || present.some((key) => !KEYS.includes(key))) {
		throw new TypeError('An assistance job request must carry exactly its schema keys.');
	}
	if (record.protocolVersion !== ASSISTANCE_JOB_PROTOCOL_VERSION) {
		throw new Error('The assistance job protocol version is unsupported.');
	}
	if (record.kind !== 'speech') throw new TypeError('An assistance job kind is unrecognised.');
	if (typeof record.jobId !== 'string' || !JOB_ID.test(record.jobId)) {
		throw new TypeError('An assistance job id must be 40 lowercase hexadecimal characters.');
	}
	return Object.freeze({
		protocolVersion: ASSISTANCE_JOB_PROTOCOL_VERSION,
		jobId: record.jobId,
		kind: 'speech',
		grant: validateAssistanceSpeechJobGrant(record.grant),
	});
}
