/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-only, one-shot authority created after one exact workflow prompt. */

import { randomBytes } from 'node:crypto';

import {
	normalizeAssistanceWorkflowId,
	validateAssistanceWorkflow,
	type AssistanceWorkflowId,
	type AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';

export const ASSISTANCE_WORKFLOW_CONSENT_GRANT_VERSION = 1;
export const ASSISTANCE_WORKFLOW_CONSENT_TTL_MS = 30_000;

export interface AssistanceWorkflowConsentGrantV1 {
	readonly grantVersion: typeof ASSISTANCE_WORKFLOW_CONSENT_GRANT_VERSION;
	readonly grantId: string;
	readonly jobId: string;
	readonly workflowId: AssistanceWorkflowId;
	readonly expiresAtMs: number;
}

interface OwnedGrant {
	readonly projection: AssistanceWorkflowConsentGrantV1;
	readonly owner: object;
	readonly request: AssistanceWorkflowV1;
}

export interface AssistanceWorkflowConsentAuthorityOptions {
	readonly now?: () => number;
	readonly mintGrantId?: () => string;
	readonly ttlMs?: number;
}

export function createAssistanceWorkflowConsentAuthority(
	options: AssistanceWorkflowConsentAuthorityOptions = {},
) {
	const now = options.now ?? Date.now;
	const mintGrantId = options.mintGrantId ?? (() => randomBytes(20).toString('hex'));
	const ttlMs = positiveInteger(options.ttlMs ?? ASSISTANCE_WORKFLOW_CONSENT_TTL_MS, 'consent TTL');
	const grants = new Map<string, OwnedGrant>();
	let disposed = false;

	function issue(ownerValue: unknown, requestValue: unknown): AssistanceWorkflowConsentGrantV1 {
		if (disposed) throw new Error('The assistance workflow consent authority is disposed.');
		const owner = reference(ownerValue);
		const request = validateAssistanceWorkflow(requestValue);
		const issuedAtMs = timestamp(now());
		purge(issuedAtMs);
		if (grants.size >= 64) throw new Error('The assistance workflow consent grant bound is exhausted.');
		const grantId = opaqueId(mintGrantId());
		if (grants.has(grantId)) throw new Error('The assistance workflow consent grant identity was reused.');
		const projection = Object.freeze({
			grantVersion: ASSISTANCE_WORKFLOW_CONSENT_GRANT_VERSION,
			grantId,
			jobId: request.jobId,
			workflowId: request.workflowId,
			expiresAtMs: expiry(issuedAtMs, ttlMs),
		});
		grants.set(grantId, Object.freeze({ projection, owner, request }));
		return projection;
	}

	function consume(ownerValue: unknown, grantValue: unknown, requestValue: unknown): boolean {
		if (disposed) return false;
		const grant = optionalGrant(grantValue);
		if (!grant) return false;
		const owned = grants.get(grant.grantId);
		grants.delete(grant.grantId);
		if (!owned || !sameGrant(owned.projection, grant) || optionalReference(ownerValue) !== owned.owner) {
			return false;
		}
		const consumedAtMs = optionalTimestamp(now());
		if (consumedAtMs === null || consumedAtMs >= owned.projection.expiresAtMs) return false;
		let request: AssistanceWorkflowV1;
		try { request = validateAssistanceWorkflow(requestValue); }
		catch { return false; }
		return JSON.stringify(request) === JSON.stringify(owned.request);
	}

	function purge(nowMs: number): void {
		for (const [grantId, owned] of grants) {
			if (owned.projection.expiresAtMs <= nowMs) grants.delete(grantId);
		}
	}

	return Object.freeze({
		issue,
		consume,
		dispose(): void {
			if (disposed) return;
			disposed = true;
			grants.clear();
		},
	});
}

function optionalGrant(value: unknown): AssistanceWorkflowConsentGrantV1 | null {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) return null;
	const record = value as Record<string, unknown>;
	const fields = ['grantVersion', 'grantId', 'jobId', 'workflowId', 'expiresAtMs'];
	if (Object.keys(record).length !== fields.length || Object.keys(record).some((key) => !fields.includes(key))
		|| record.grantVersion !== ASSISTANCE_WORKFLOW_CONSENT_GRANT_VERSION) return null;
	if (typeof record.jobId !== 'string' || !/^[a-f\d]{40}$/u.test(record.jobId)
		|| !Number.isSafeInteger(record.expiresAtMs) || Number(record.expiresAtMs) < 1) return null;
	let workflowId: AssistanceWorkflowId;
	try { workflowId = normalizeAssistanceWorkflowId(record.workflowId); }
	catch { return null; }
	return Object.freeze({
		grantVersion: ASSISTANCE_WORKFLOW_CONSENT_GRANT_VERSION,
		grantId: opaqueId(record.grantId),
		jobId: record.jobId,
		workflowId,
		expiresAtMs: Number(record.expiresAtMs),
	});
}

function sameGrant(left: AssistanceWorkflowConsentGrantV1, right: AssistanceWorkflowConsentGrantV1): boolean {
	return left.grantVersion === right.grantVersion && left.grantId === right.grantId
		&& left.jobId === right.jobId && left.workflowId === right.workflowId
		&& left.expiresAtMs === right.expiresAtMs;
}

function reference(value: unknown): object {
	const owner = optionalReference(value);
	if (!owner) throw new TypeError('Assistance workflow consent requires a renderer owner.');
	return owner;
}

function optionalReference(value: unknown): object | null {
	return value && (typeof value === 'object' || typeof value === 'function') ? value : null;
}

function opaqueId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f\d]{40}$/u.test(value)) {
		throw new TypeError('The assistance workflow consent grant ID is invalid.');
	}
	return value;
}

function timestamp(value: unknown): number {
	const result = optionalTimestamp(value);
	if (result === null) throw new RangeError('The assistance workflow consent clock is invalid.');
	return result;
}

function optionalTimestamp(value: unknown): number | null {
	return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`The assistance workflow ${label} is invalid.`);
	}
	return Number(value);
}

function expiry(nowMs: number, ttlMs: number): number {
	if (nowMs > Number.MAX_SAFE_INTEGER - ttlMs) {
		throw new RangeError('The assistance workflow consent expiry is invalid.');
	}
	return nowMs + ttlMs;
}
