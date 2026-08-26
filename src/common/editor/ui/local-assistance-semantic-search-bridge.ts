/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict renderer projection of the pathless semantic-search session API. */

import {
	validateAssistanceSemanticSearchSession,
	type AssistanceSemanticSearchSession,
} from '../assistance/async-search-provider.ts';
import type {
	AssistanceSemanticSearchProjectAuthorityV1,
	AssistanceSemanticSearchSessionPortV1,
} from '../assistance/semantic-search-runtime-v1.ts';

const METHODS = Object.freeze(['open', 'authorize', 'revoke'] as const);
const ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const SESSION_ID = /^[a-f\d]{40}$/u;

export function resolveLocalAssistanceSemanticSearchBridge(
	value: unknown,
): AssistanceSemanticSearchSessionPortV1 | null {
	if (!isRecord(value) || Reflect.ownKeys(value).length !== METHODS.length
		|| METHODS.some((method) => typeof value[method] !== 'function')) return null;
	const invoke = (method: typeof METHODS[number], argument: unknown): Promise<unknown> => (
		Promise.resolve((value[method] as (request: unknown) => unknown).call(value, argument))
	);
	return Object.freeze({
		async open(authorityValue: AssistanceSemanticSearchProjectAuthorityV1) {
			const authority = projectAuthority(authorityValue);
			const session = validateAssistanceSemanticSearchSession(
				await invoke('open', authority),
			);
			assertAuthority(session, authority);
			return session;
		},
		async authorize(
			requestValue: Parameters<AssistanceSemanticSearchSessionPortV1['authorize']>[0],
		) {
			const request = authorizationRequest(requestValue);
			const authorized = validateAssistanceSemanticSearchSession(
				await invoke('authorize', request),
			);
			if (!sameSession(request.session, authorized)) {
				throw new Error('Semantic-search reauthorization changed bearer authority.');
			}
			return authorized;
		},
		async revoke(sessionIdValue: string) {
			const sessionId = sessionIdValueOf(sessionIdValue);
			const result = await invoke('revoke', sessionId);
			if (typeof result !== 'boolean') {
				throw new TypeError('Semantic-search revocation must return a boolean.');
			}
			return result;
		},
	});
}

function authorizationRequest(value: unknown): Readonly<{
	readonly session: AssistanceSemanticSearchSession;
	readonly projectId: string;
	readonly projectRevision: number;
}> {
	const row = exactRecord(value, ['session', 'projectId', 'projectRevision'],
		'semantic-search authorization');
	const authority = projectAuthority({
		projectId: row.projectId, projectRevision: row.projectRevision,
	});
	const session = validateAssistanceSemanticSearchSession(row.session);
	assertAuthority(session, authority);
	return Object.freeze({ session, ...authority });
}

function projectAuthority(value: unknown): AssistanceSemanticSearchProjectAuthorityV1 {
	const row = exactRecord(value, ['projectId', 'projectRevision'],
		'semantic-search project authority');
	if (typeof row.projectId !== 'string' || !ID.test(row.projectId)
		|| !Number.isSafeInteger(row.projectRevision) || Number(row.projectRevision) < 0) {
		throw new TypeError('Semantic-search project authority is invalid.');
	}
	return Object.freeze({
		projectId: row.projectId,
		projectRevision: Number(row.projectRevision),
	});
}

function assertAuthority(
	session: AssistanceSemanticSearchSession,
	authority: AssistanceSemanticSearchProjectAuthorityV1,
): void {
	if (session.projectId !== authority.projectId
		|| session.projectRevision !== authority.projectRevision) {
		throw new Error('Semantic-search session disagrees with current project authority.');
	}
}

function sameSession(
	left: AssistanceSemanticSearchSession,
	right: AssistanceSemanticSearchSession,
): boolean {
	return left.sessionVersion === right.sessionVersion && left.sessionId === right.sessionId
		&& left.projectId === right.projectId && left.projectRevision === right.projectRevision
		&& left.expiresAtEpochMs === right.expiresAtEpochMs;
}

function sessionIdValueOf(value: unknown): string {
	if (typeof value !== 'string' || !SESSION_ID.test(value)) {
		throw new TypeError('Semantic-search session ID is invalid.');
	}
	return value;
}

function exactRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Readonly<Record<string, unknown>> {
	if (!isRecord(value) || Reflect.ownKeys(value).length !== fields.length
		|| Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value)
		&& !ArrayBuffer.isView(value) && Object.getPrototypeOf(value) === Object.prototype);
}
