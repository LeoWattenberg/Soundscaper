/* SPDX-License-Identifier: AGPL-3.0-only */

/** Explicit menu-session composition over authenticated disposable search custody. */

import {
	createAssistanceAsyncSearchCoordinator,
	validateAssistanceSemanticSearchSession,
	type AssistanceAsyncSearchCoordinator,
	type AssistanceAsyncSearchProvider,
	type AssistanceAsyncSearchRequest,
	type AssistanceSemanticSearchSession,
} from './async-search-provider.ts';
import {
	createAssistanceSemanticIndexSearchProviderV1,
	type AssistanceSemanticIndexV1,
	type AssistanceSemanticQueryEmbeddingRequestV1,
} from './semantic-search-index-v1.ts';

const SHA256 = /^[a-f\d]{64}$/u;
const ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const CUSTODY_FIELDS = Object.freeze([
	'custodyVersion', 'disposition', 'projectId', 'projectRevision', 'records', 'index',
]);
const RECORD_FIELDS = Object.freeze(['kind', 'identitySha256', 'payloadSha256']);
const RECORD_KINDS = Object.freeze(['embeddings', 'recognized-text', 'visual-index'] as const);

export interface AssistanceSemanticSearchProjectAuthorityV1 {
	readonly projectId: string;
	readonly projectRevision: number;
}

export interface AssistanceSemanticSearchSessionPortV1 {
	open(authority: AssistanceSemanticSearchProjectAuthorityV1): Promise<unknown>;
	authorize(value: Readonly<{
		readonly session: AssistanceSemanticSearchSession;
		readonly projectId: string;
		readonly projectRevision: number;
	}>): Promise<unknown>;
	revoke(sessionId: string): Promise<boolean>;
}

export interface AssistanceAuthenticatedSemanticIndexCustodyPortV1 {
	loadAuthenticated(
		authority: AssistanceSemanticSearchProjectAuthorityV1,
		signal: AbortSignal,
	): Promise<unknown>;
}

export interface AssistanceSemanticSearchMenuSessionV1 {
	readonly coordinator: AssistanceAsyncSearchCoordinator;
	dispose(): Promise<void>;
}

export interface AssistanceSemanticSearchMenuSourceV1 {
	open(
		authority: AssistanceSemanticSearchProjectAuthorityV1,
	): Promise<AssistanceSemanticSearchMenuSessionV1>;
}

export type AssistanceSemanticSearchUnavailableReason =
	| 'desktop-unavailable' | 'index-unavailable' | 'query-models-unavailable';

export class AssistanceSemanticSearchUnavailableError extends Error {
	readonly reason: AssistanceSemanticSearchUnavailableReason;

	constructor(reason: AssistanceSemanticSearchUnavailableReason, message: string) {
		super(message);
		this.name = 'AssistanceSemanticSearchUnavailableError';
		this.reason = reason;
	}
}

export function createAssistanceSemanticSearchMenuSourceV1(options: Readonly<{
	readonly sessions: AssistanceSemanticSearchSessionPortV1;
	readonly custody: AssistanceAuthenticatedSemanticIndexCustodyPortV1;
	readonly embedInstalledQuery: (
		request: AssistanceSemanticQueryEmbeddingRequestV1,
	) => Promise<ArrayLike<number>>;
	readonly now?: () => number;
}>): AssistanceSemanticSearchMenuSourceV1 {
	if (!options || typeof options !== 'object' || !options.sessions
		|| typeof options.sessions.open !== 'function'
		|| typeof options.sessions.authorize !== 'function'
		|| typeof options.sessions.revoke !== 'function' || !options.custody
		|| typeof options.custody.loadAuthenticated !== 'function'
		|| typeof options.embedInstalledQuery !== 'function'
		|| options.now !== undefined && typeof options.now !== 'function') {
		throw new TypeError('Semantic-search menu activation requires exact session, custody, and model ports.');
	}
	const now = options.now ?? Date.now;
	return Object.freeze({ async open(authorityValue: AssistanceSemanticSearchProjectAuthorityV1) {
		const authority = projectAuthority(authorityValue);
		const opening = new AbortController();
		const custodyValue = await options.custody.loadAuthenticated(authority, opening.signal);
		if (custodyValue === null) {
			throw new AssistanceSemanticSearchUnavailableError(
				'index-unavailable',
				'Indexed search is unavailable until a reviewed disposable index is created.',
			);
		}
		const custody = reviewCustody(custodyValue, authority);
		const provider = createAssistanceSemanticIndexSearchProviderV1({
			index: custody.index,
			embedQuery: options.embedInstalledQuery,
			now,
		});
		let session: AssistanceSemanticSearchSession | null = null;
		try {
			session = validateAssistanceSemanticSearchSession(
				await options.sessions.open(authority), now(),
			);
			assertSessionAuthority(session, authority);
			const authorizedProvider: AssistanceAsyncSearchProvider = Object.freeze({
				search: async (request: AssistanceAsyncSearchRequest) => {
					const authorized = validateAssistanceSemanticSearchSession(
						await options.sessions.authorize({
							session: request.session,
							projectId: authority.projectId,
							projectRevision: authority.projectRevision,
						}), now(),
					);
					if (!sameSession(request.session, authorized)) {
						throw new Error('Main changed semantic-search bearer authority during a query.');
					}
					return await provider.search({ ...request, session: authorized });
				},
			});
			const coordinator = createAssistanceAsyncSearchCoordinator({
				session, provider: authorizedProvider, now,
			});
			let disposed = false;
			return Object.freeze({ coordinator, async dispose(): Promise<void> {
				if (disposed) return;
				disposed = true;
				opening.abort(new DOMException('Semantic-search menu session closed.', 'AbortError'));
				coordinator.dispose();
				await options.sessions.revoke(session!.sessionId);
			} });
		} catch (error) {
			opening.abort(new DOMException('Semantic-search menu opening failed.', 'AbortError'));
			if (session) await options.sessions.revoke(session.sessionId).catch(() => false);
			throw error;
		}
	} });
}

function reviewCustody(
	value: unknown,
	authority: AssistanceSemanticSearchProjectAuthorityV1,
): Readonly<{ readonly index: AssistanceSemanticIndexV1 }> {
	const row = exactRecord(value, CUSTODY_FIELDS, 'authenticated semantic-index custody');
	if (row.custodyVersion !== 1 || row.disposition !== 'authenticated-disposable') {
		throw new TypeError('Semantic-index custody is not an authenticated disposable grant.');
	}
	const claimedAuthority = projectAuthority(row);
	if (claimedAuthority.projectId !== authority.projectId
		|| claimedAuthority.projectRevision !== authority.projectRevision) {
		throw new Error('Semantic-index custody disagrees with current project revision authority.');
	}
	if (!Array.isArray(row.records) || row.records.length < 1
		|| row.records.length > RECORD_KINDS.length) {
		throw new RangeError('Authenticated semantic-index custody record inventory is invalid.');
	}
	let prior = -1;
	const kinds = new Set(row.records.map((value, index) => {
		const record = exactRecord(value, RECORD_FIELDS, `semantic-index custody record ${String(index)}`);
		const kindIndex = RECORD_KINDS.indexOf(record.kind as typeof RECORD_KINDS[number]);
		if (kindIndex <= prior || !SHA256.test(String(record.identitySha256))
			|| !SHA256.test(String(record.payloadSha256))) {
			throw new TypeError('Authenticated semantic-index custody records are invalid or non-canonical.');
		}
		prior = kindIndex;
		return RECORD_KINDS[kindIndex]!;
	}));
	const index = row.index as AssistanceSemanticIndexV1;
	const indexAuthority = projectAuthority({
		projectId: index?.projectId, projectRevision: index?.projectRevision,
	});
	if (indexAuthority.projectId !== authority.projectId
		|| indexAuthority.projectRevision !== authority.projectRevision) {
		throw new Error('Semantic index disagrees with authenticated project revision authority.');
	}
	if (hasRows(index, 'transcript') && !kinds.has('embeddings')) {
		throw new Error('Authenticated transcript search requires its embeddings custody record.');
	}
	if ((hasRows(index, 'visual') || hasRows(index, 'ocr')) && !kinds.has('visual-index')) {
		throw new Error('Authenticated visual/OCR search requires its visual-index custody record.');
	}
	return Object.freeze({ index });
}

function hasRows(index: unknown, provider: 'transcript' | 'visual' | 'ocr'): boolean {
	if (!index || typeof index !== 'object') return false;
	const value = (index as Readonly<Record<string, unknown>>)[provider];
	if (provider === 'ocr') return Array.isArray(value) && value.length > 0;
	return Boolean(value && typeof value === 'object'
		&& Array.isArray((value as Readonly<Record<string, unknown>>).rows)
		&& ((value as Readonly<Record<string, unknown>>).rows as readonly unknown[]).length > 0);
}

function projectAuthority(value: unknown): AssistanceSemanticSearchProjectAuthorityV1 {
	if (!value || typeof value !== 'object') {
		throw new TypeError('Semantic-search project authority is invalid.');
	}
	const row = value as Readonly<Record<string, unknown>>;
	if (typeof row.projectId !== 'string' || !ID.test(row.projectId)
		|| !Number.isSafeInteger(row.projectRevision) || Number(row.projectRevision) < 0) {
		throw new TypeError('Semantic-search project authority is invalid.');
	}
	return Object.freeze({ projectId: row.projectId, projectRevision: Number(row.projectRevision) });
}

function assertSessionAuthority(
	session: AssistanceSemanticSearchSession,
	authority: AssistanceSemanticSearchProjectAuthorityV1,
): void {
	if (session.projectId !== authority.projectId
		|| session.projectRevision !== authority.projectRevision) {
		throw new Error('Main semantic-search session disagrees with current project authority.');
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

function exactRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const row = value as Readonly<Record<string, unknown>>;
	const keys = Reflect.ownKeys(row);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return row;
}
