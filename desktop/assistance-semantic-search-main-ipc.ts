/* SPDX-License-Identifier: AGPL-3.0-only */

/** Window-owned IPC for short-lived, prompt-free semantic-search authorization. */

import type { AssistanceSemanticSearchSession } from
	'../src/common/editor/assistance/async-search-provider.ts';
import {
	AssistanceSemanticSearchSessionAuthority,
} from './assistance-semantic-search-session-authority.ts';
import type {
	AssistanceSemanticQueryExecutorResultV1,
	AssistanceSemanticQueryExecutorV1,
} from './assistance-semantic-query-executor.ts';
import {
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
	type ProjectSchemaFamily,
} from '../src/common/editor/project-schema-identity.ts';

// These names restate `IPC` in desktop/constants.js on purpose: this module is staged into
// the project-library runtime, whose expected file set does not include constants.js, so
// importing it there would drag an unstaged member into the runtime graph. The preload
// restates them for the same reason. `tests/desktop-assistance-semantic-search-main-ipc.ts`
// holds all three tables to the same strings.
export const ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS = Object.freeze({
	open: 'soundscaper:v1:assistance:semantic-search:open',
	authorize: 'soundscaper:v1:assistance:semantic-search:authorize',
	revoke: 'soundscaper:v1:assistance:semantic-search:revoke',
	query: 'soundscaper:v1:assistance:semantic-search:query',
	cancelQuery: 'soundscaper:v1:assistance:semantic-search:cancel-query',
} as const);

const QUERY_FIELDS = Object.freeze([
	'queryVersion', 'queryId', 'session', 'schemaFamily', 'schemaVersion',
	'projectId', 'projectRevision', 'provider', 'query',
]);
const QUERY_ID = /^[a-f\d]{40}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const EMBEDDING_DIMENSIONS = 768;
const MAXIMUM_ACTIVE_QUERIES_PER_OWNER = 8;

type Handler = (event: unknown, value?: unknown) => unknown;

interface AssistanceSemanticSearchMainIpcOptions {
	readonly handle: (channel: string, handler: Handler) => void;
	readonly removeHandler: (channel: string) => void;
	readonly ownerFor: (event: unknown) => object | null;
	readonly authority?: AssistanceSemanticSearchSessionAuthority;
	readonly query: AssistanceSemanticQueryExecutorV1;
}

export interface AssistanceSemanticSearchMainIpcRegistration {
	revokeOwner(owner: object): Promise<number>;
	dispose(): Promise<void>;
}

interface ActiveQuery {
	readonly owner: object;
	readonly sessionId: string;
	readonly controller: AbortController;
	readonly completion: Promise<void>;
}

export function registerAssistanceSemanticSearchMainIpc(
	options: AssistanceSemanticSearchMainIpcOptions,
): AssistanceSemanticSearchMainIpcRegistration {
	if (!options || typeof options !== 'object' || typeof options.handle !== 'function'
		|| typeof options.removeHandler !== 'function' || typeof options.ownerFor !== 'function'
		|| !options.query || typeof options.query.embed !== 'function') {
		throw new TypeError('Semantic-search IPC requires exact registration and ownership ports.');
	}
	const authority = options.authority ?? new AssistanceSemanticSearchSessionAuthority();
	const sessionsByOwner = new Map<object, Set<string>>();
	const ownersBySession = new Map<string, object>();
	const activeQueries = new Map<string, ActiveQuery>();
	let disposed = false;

	const owner = (event: unknown): object => {
		if (disposed) throw new Error('Semantic-search IPC is disposed.');
		const value = options.ownerFor(event);
		if (!value || typeof value !== 'object') {
			throw new Error('Semantic-search IPC requires an active renderer owner.');
		}
		return value;
	};
	const remember = (value: object, session: AssistanceSemanticSearchSession): void => {
		let ids = sessionsByOwner.get(value);
		if (!ids) { ids = new Set(); sessionsByOwner.set(value, ids); }
		ids.add(session.sessionId);
		ownersBySession.set(session.sessionId, value);
	};
	const forget = (sessionId: string): void => {
		const value = ownersBySession.get(sessionId);
		ownersBySession.delete(sessionId);
		if (!value) return;
		const ids = sessionsByOwner.get(value);
		ids?.delete(sessionId);
		if (ids?.size === 0) sessionsByOwner.delete(value);
	};
	const owns = (value: object, sessionId: string): void => {
		if (ownersBySession.get(sessionId) !== value) {
			throw new Error('The semantic-search session does not belong to this renderer owner.');
		}
	};
	const abortSession = async (sessionId: string, reason: DOMException): Promise<void> => {
		const active = [...activeQueries.values()].filter((query) => query.sessionId === sessionId);
		for (const query of active) query.controller.abort(reason);
		await Promise.all(active.map(({ completion }) => completion));
	};

	options.handle(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.open, (event, value) => {
		const currentOwner = owner(event);
		const session = authority.open(value as never);
		remember(currentOwner, session);
		return session;
	});
	options.handle(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.authorize, (event, value) => {
		const currentOwner = owner(event);
		const request = authorizationRequest(value);
		owns(currentOwner, request.session.sessionId);
		try {
			return authority.authorize(request.session, request.authority);
		} catch (error) {
			forget(request.session.sessionId);
			void abortSession(request.session.sessionId, new DOMException(
				'Semantic-search authority became stale.', 'AbortError',
			));
			throw error;
		}
	});
	options.handle(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.revoke, (event, value) => {
		const currentOwner = owner(event);
		const sessionId = sessionIdValue(value);
		if (ownersBySession.get(sessionId) !== currentOwner) return false;
		forget(sessionId);
		const revoked = authority.revoke(sessionId);
		return abortSession(sessionId, new DOMException(
			'Semantic-search session revoked.', 'AbortError',
		)).then(() => revoked);
	});
	options.handle(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.query, async (event, value) => {
		const currentOwner = owner(event);
		const request = queryRequest(value);
		owns(currentOwner, request.session.sessionId);
		try {
			authority.authorize(request.session, request.authority);
		} catch (error) {
			forget(request.session.sessionId);
			await abortSession(request.session.sessionId, new DOMException(
				'Semantic-search authority became stale.', 'AbortError',
			));
			throw error;
		}
		if (activeQueries.has(request.queryId)) {
			throw new Error('The semantic-search query ID is already active.');
		}
		if ([...activeQueries.values()].filter(({ owner: value }) => value === currentOwner).length
			>= MAXIMUM_ACTIVE_QUERIES_PER_OWNER) {
			throw new RangeError('The renderer has too many active semantic-search queries.');
		}
		const controller = new AbortController();
		let complete!: () => void;
		const completion = new Promise<void>((resolve) => { complete = resolve; });
		activeQueries.set(request.queryId, Object.freeze({
			owner: currentOwner, sessionId: request.session.sessionId, controller, completion,
		}));
		try {
			const result = await options.query.embed(Object.freeze({
				provider: request.provider, query: request.query, signal: controller.signal,
			}));
			controller.signal.throwIfAborted();
			return queryResult(request.queryId, request.provider, result);
		} finally {
			activeQueries.delete(request.queryId);
			complete();
		}
	});
	options.handle(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.cancelQuery, async (event, value) => {
		const currentOwner = owner(event);
		const queryId = queryIdValue(value);
		const active = activeQueries.get(queryId);
		if (!active || active.owner !== currentOwner) return false;
		active.controller.abort(new DOMException('Semantic-search query cancelled.', 'AbortError'));
		await active.completion;
		return true;
	});

	const revokeOwner = async (value: object): Promise<number> => {
		if (!value || typeof value !== 'object') {
			throw new TypeError('Semantic-search renderer owner is invalid.');
		}
		const ids = [...(sessionsByOwner.get(value) ?? [])];
		let revoked = 0;
		for (const sessionId of ids) {
			forget(sessionId);
			if (authority.revoke(sessionId)) revoked += 1;
		}
		await Promise.all(ids.map((sessionId) => abortSession(sessionId, new DOMException(
			'Semantic-search renderer owner retired.', 'AbortError',
		))));
		return revoked;
	};
	return Object.freeze({ revokeOwner, async dispose(): Promise<void> {
		if (disposed) return;
		disposed = true;
		for (const channel of Object.values(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS)) {
			options.removeHandler(channel);
		}
		await Promise.all([...sessionsByOwner.keys()].map(revokeOwner));
	} });
}

function queryRequest(value: unknown): Readonly<{
	readonly queryId: string;
	readonly session: AssistanceSemanticSearchSession;
	readonly authority: Readonly<{
		readonly schemaFamily: ProjectSchemaFamily;
		readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
		readonly projectId: string;
		readonly projectRevision: number;
	}>;
	readonly schemaFamily: ProjectSchemaFamily;
	readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly provider: 'transcript' | 'visual';
	readonly query: string;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length !== QUERY_FIELDS.length
		|| Reflect.ownKeys(value).some((key) => typeof key !== 'string'
			|| !QUERY_FIELDS.includes(key))) {
		throw new TypeError('Semantic-search query request fields are invalid.');
	}
	const row = value as Readonly<Record<string, unknown>>;
	if (row.queryVersion !== 1 || row.provider !== 'transcript' && row.provider !== 'visual'
		|| typeof row.query !== 'string' || row.query.trim() === '' || row.query.length > 512
		|| CONTROL.test(row.query)) {
		throw new TypeError('Semantic-search query request is invalid.');
	}
	const authorization = authorizationRequest({
		session: row.session, schemaFamily: row.schemaFamily, schemaVersion: row.schemaVersion,
		projectId: row.projectId, projectRevision: row.projectRevision,
	});
	return Object.freeze({
		queryId: queryIdValue(row.queryId), ...authorization,
		provider: row.provider, query: row.query,
	});
}

function queryResult(
	queryId: string,
	provider: 'transcript' | 'visual',
	value: AssistanceSemanticQueryExecutorResultV1,
): Readonly<Record<string, unknown>> {
	if (!value || value.queryResultVersion !== 1) {
		throw new TypeError('The semantic-query executor returned a foreign result version.');
	}
	if (value.outcome === 'unavailable') {
		if (value.reason !== 'model-unavailable' && value.reason !== 'runtime-unavailable') {
			throw new TypeError('The semantic-query executor unavailable reason is invalid.');
		}
		return Object.freeze({
			queryVersion: 1, queryId, outcome: 'unavailable', reason: value.reason,
		});
	}
	if (value.outcome !== 'completed' || value.provider !== provider
		|| !Array.isArray(value.embedding) || value.embedding.length !== EMBEDDING_DIMENSIONS
		|| value.embedding.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
		throw new TypeError('The semantic-query executor result is malformed or uncorrelated.');
	}
	return Object.freeze({
		queryVersion: 1, queryId, outcome: 'completed', provider,
		embedding: Object.freeze([...value.embedding]),
	});
}

function authorizationRequest(value: unknown): Readonly<{
	readonly session: AssistanceSemanticSearchSession;
	readonly authority: Readonly<{
		readonly schemaFamily: ProjectSchemaFamily;
		readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
		readonly projectId: string;
		readonly projectRevision: number;
	}>;
	readonly schemaFamily: ProjectSchemaFamily;
	readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
	readonly projectId: string;
	readonly projectRevision: number;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length !== 5
		|| !Object.hasOwn(value, 'session') || !Object.hasOwn(value, 'projectId')
		|| !Object.hasOwn(value, 'projectRevision') || !Object.hasOwn(value, 'schemaFamily')
		|| !Object.hasOwn(value, 'schemaVersion')) {
		throw new TypeError('Semantic-search authorization request fields are invalid.');
	}
	const identity = readProjectSchemaIdentity(value);
	if (identity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new RangeError('Semantic-search authorization requires a current project schema.');
	}
	const row = value as Readonly<Record<string, unknown>>;
	const authority = Object.freeze({ schemaFamily: identity.schemaFamily,
		schemaVersion: PROJECT_SCHEMA_VERSION, projectId: row.projectId as string,
		projectRevision: row.projectRevision as number });
	return Object.freeze({
		session: row.session as AssistanceSemanticSearchSession,
		authority,
		schemaFamily: authority.schemaFamily,
		schemaVersion: authority.schemaVersion,
		projectId: row.projectId as string,
		projectRevision: row.projectRevision as number,
	});
}

function sessionIdValue(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f\d]{40}$/u.test(value)) {
		throw new TypeError('The semantic-search session ID is invalid.');
	}
	return value;
}

function queryIdValue(value: unknown): string {
	if (typeof value !== 'string' || !QUERY_ID.test(value)) {
		throw new TypeError('The semantic-search query ID is invalid.');
	}
	return value;
}
