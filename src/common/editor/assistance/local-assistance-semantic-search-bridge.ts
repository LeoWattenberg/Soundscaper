/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict renderer projection of the pathless semantic-search session API. */

import {
	validateAssistanceSemanticSearchSession,
	type AssistanceSemanticSearchSession,
} from './async-search-provider.ts';
import type {
	AssistanceSemanticSearchProjectAuthorityV1,
	AssistanceSemanticSearchSessionPortV1,
} from './semantic-search-runtime-v1.ts';
import { AssistanceSemanticSearchUnavailableError } from
	'./semantic-search-runtime-v1.ts';
import {
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
} from '../project-schema-identity.ts';

const METHODS = Object.freeze(['open', 'authorize', 'revoke', 'query', 'cancelQuery'] as const);
const ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const SESSION_ID = /^[a-f\d]{40}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const EMBEDDING_DIMENSIONS = 768;

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
		async embedInstalledQuery(requestValue: Parameters<
			AssistanceSemanticSearchSessionPortV1['embedInstalledQuery']
		>[0]) {
			const request = embeddingRequest(requestValue);
			request.signal.throwIfAborted();
			const queryId = randomQueryId();
			const raw = Object.freeze({
				queryVersion: 1, queryId, session: request.session,
				schemaFamily: request.schemaFamily, schemaVersion: request.schemaVersion,
				projectId: request.projectId, projectRevision: request.projectRevision,
				provider: request.provider, query: request.query,
			});
			let rejectCancellation!: (reason: unknown) => void;
			const cancellation = new Promise<never>((_resolve, reject) => {
				rejectCancellation = reject;
			});
			const cancel = (): void => {
				void invoke('cancelQuery', queryId).catch(() => false);
				rejectCancellation(request.signal.reason ?? new DOMException(
					'Semantic-search query cancelled.', 'AbortError',
				));
			};
			request.signal.addEventListener('abort', cancel, { once: true });
			try {
				const result = await Promise.race([invoke('query', raw), cancellation]);
				request.signal.throwIfAborted();
				return embeddingResult(result, queryId, request.provider);
			} finally {
				request.signal.removeEventListener('abort', cancel);
			}
		},
	});
}

function embeddingRequest(value: unknown): Readonly<{
	readonly session: AssistanceSemanticSearchSession;
	readonly schemaFamily: AssistanceSemanticSearchProjectAuthorityV1['schemaFamily'];
	readonly schemaVersion: 1;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly provider: 'transcript' | 'visual';
	readonly query: string;
	readonly signal: AbortSignal;
}> {
	const row = exactRecord(value, [
		'session', 'schemaFamily', 'schemaVersion', 'projectId', 'projectRevision',
		'provider', 'query', 'signal',
	], 'semantic-search query embedding');
	const authorization = authorizationRequest({
		session: row.session, schemaFamily: row.schemaFamily, schemaVersion: row.schemaVersion,
		projectId: row.projectId, projectRevision: row.projectRevision,
	});
	if (row.provider !== 'transcript' && row.provider !== 'visual'
		|| typeof row.query !== 'string' || row.query.trim() === '' || row.query.length > 512
		|| CONTROL.test(row.query) || !(row.signal instanceof AbortSignal)) {
		throw new TypeError('The semantic-search query embedding request is invalid.');
	}
	return Object.freeze({
		...authorization, provider: row.provider, query: row.query, signal: row.signal,
	});
}

function embeddingResult(
	value: unknown,
	queryId: string,
	provider: 'transcript' | 'visual',
): readonly number[] {
	if (!isRecord(value) || value.queryVersion !== 1 || value.queryId !== queryId) {
		throw new TypeError('The semantic-search query result is foreign or uncorrelated.');
	}
	if (value.outcome === 'unavailable') {
		const row = exactRecord(value, ['queryVersion', 'queryId', 'outcome', 'reason'],
			'semantic-search unavailable query result');
		if (row.reason !== 'model-unavailable' && row.reason !== 'runtime-unavailable') {
			throw new TypeError('The semantic-search query unavailable reason is invalid.');
		}
		throw new AssistanceSemanticSearchUnavailableError(
			'query-models-unavailable',
			'Indexed search needs its explicitly installed query model and authenticated runtime.',
		);
	}
	const row = exactRecord(value,
		['queryVersion', 'queryId', 'outcome', 'provider', 'embedding'],
		'semantic-search completed query result');
	if (row.outcome !== 'completed' || row.provider !== provider
		|| !Array.isArray(row.embedding) || row.embedding.length !== EMBEDDING_DIMENSIONS
		|| row.embedding.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
		throw new TypeError('The semantic-search query result vector is invalid.');
	}
	return Object.freeze([...row.embedding]);
}

function randomQueryId(): string {
	const crypto = globalThis.crypto;
	if (!crypto || typeof crypto.getRandomValues !== 'function') {
		throw new Error('Cryptographic semantic-search query identities are unavailable.');
	}
	const bytes = crypto.getRandomValues(new Uint8Array(20));
	return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function authorizationRequest(value: unknown): Readonly<{
	readonly session: AssistanceSemanticSearchSession;
	readonly schemaFamily: AssistanceSemanticSearchProjectAuthorityV1['schemaFamily'];
	readonly schemaVersion: 1;
	readonly projectId: string;
	readonly projectRevision: number;
}> {
	const row = exactRecord(value, ['session', 'schemaFamily', 'schemaVersion', 'projectId', 'projectRevision'],
		'semantic-search authorization');
	const authority = projectAuthority({
		schemaFamily: row.schemaFamily, schemaVersion: row.schemaVersion,
		projectId: row.projectId, projectRevision: row.projectRevision,
	});
	const session = validateAssistanceSemanticSearchSession(row.session);
	assertAuthority(session, authority);
	return Object.freeze({ session, ...authority });
}

function projectAuthority(value: unknown): AssistanceSemanticSearchProjectAuthorityV1 {
	const identity = readProjectSchemaIdentity(value);
	if (identity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new RangeError('Semantic-search project authority requires a current project schema.');
	}
	const row = exactRecord(value, ['schemaFamily', 'schemaVersion', 'projectId', 'projectRevision'],
		'semantic-search project authority');
	if (typeof row.projectId !== 'string' || !ID.test(row.projectId)
		|| !Number.isSafeInteger(row.projectRevision) || Number(row.projectRevision) < 0) {
		throw new TypeError('Semantic-search project authority is invalid.');
	}
	return Object.freeze({
		schemaFamily: identity.schemaFamily,
		schemaVersion: PROJECT_SCHEMA_VERSION,
		projectId: row.projectId,
		projectRevision: Number(row.projectRevision),
	});
}

function assertAuthority(
	session: AssistanceSemanticSearchSession,
	authority: AssistanceSemanticSearchProjectAuthorityV1,
): void {
	if (session.schemaFamily !== authority.schemaFamily || session.schemaVersion !== authority.schemaVersion
		|| session.projectId !== authority.projectId
		|| session.projectRevision !== authority.projectRevision) {
		throw new Error('Semantic-search session disagrees with current project authority.');
	}
}

function sameSession(
	left: AssistanceSemanticSearchSession,
	right: AssistanceSemanticSearchSession,
): boolean {
	return left.sessionVersion === right.sessionVersion && left.sessionId === right.sessionId
		&& left.schemaFamily === right.schemaFamily && left.schemaVersion === right.schemaVersion
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
