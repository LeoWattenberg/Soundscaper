/* SPDX-License-Identifier: AGPL-3.0-only */

/** Window-owned IPC for short-lived, prompt-free semantic-search authorization. */

import type { AssistanceSemanticSearchSession } from
	'../src/common/editor/assistance/async-search-provider.ts';
import {
	AssistanceSemanticSearchSessionAuthority,
} from './assistance-semantic-search-session-authority.ts';

export const ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS = Object.freeze({
	open: 'soundscaper:v1:assistance:semantic-search:open',
	authorize: 'soundscaper:v1:assistance:semantic-search:authorize',
	revoke: 'soundscaper:v1:assistance:semantic-search:revoke',
} as const);

type Handler = (event: unknown, value?: unknown) => unknown;

interface AssistanceSemanticSearchMainIpcOptions {
	readonly handle: (channel: string, handler: Handler) => void;
	readonly removeHandler: (channel: string) => void;
	readonly ownerFor: (event: unknown) => object | null;
	readonly authority?: AssistanceSemanticSearchSessionAuthority;
}

export interface AssistanceSemanticSearchMainIpcRegistration {
	revokeOwner(owner: object): number;
	dispose(): void;
}

export function registerAssistanceSemanticSearchMainIpc(
	options: AssistanceSemanticSearchMainIpcOptions,
): AssistanceSemanticSearchMainIpcRegistration {
	if (!options || typeof options !== 'object' || typeof options.handle !== 'function'
		|| typeof options.removeHandler !== 'function' || typeof options.ownerFor !== 'function') {
		throw new TypeError('Semantic-search IPC requires exact registration and ownership ports.');
	}
	const authority = options.authority ?? new AssistanceSemanticSearchSessionAuthority();
	const sessionsByOwner = new Map<object, Set<string>>();
	const ownersBySession = new Map<string, object>();
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
			return authority.authorize(request.session, {
				projectId: request.projectId, projectRevision: request.projectRevision,
			});
		} catch (error) {
			forget(request.session.sessionId);
			throw error;
		}
	});
	options.handle(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.revoke, (event, value) => {
		const currentOwner = owner(event);
		const sessionId = sessionIdValue(value);
		if (ownersBySession.get(sessionId) !== currentOwner) return false;
		forget(sessionId);
		return authority.revoke(sessionId);
	});

	const revokeOwner = (value: object): number => {
		if (!value || typeof value !== 'object') {
			throw new TypeError('Semantic-search renderer owner is invalid.');
		}
		const ids = [...(sessionsByOwner.get(value) ?? [])];
		let revoked = 0;
		for (const sessionId of ids) {
			forget(sessionId);
			if (authority.revoke(sessionId)) revoked += 1;
		}
		return revoked;
	};
	return Object.freeze({ revokeOwner, dispose(): void {
		if (disposed) return;
		disposed = true;
		for (const value of [...sessionsByOwner.keys()]) revokeOwner(value);
		for (const channel of Object.values(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS)) {
			options.removeHandler(channel);
		}
	} });
}

function authorizationRequest(value: unknown): Readonly<{
	readonly session: AssistanceSemanticSearchSession;
	readonly projectId: string;
	readonly projectRevision: number;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length !== 3
		|| !Object.hasOwn(value, 'session') || !Object.hasOwn(value, 'projectId')
		|| !Object.hasOwn(value, 'projectRevision')) {
		throw new TypeError('Semantic-search authorization request fields are invalid.');
	}
	const row = value as Readonly<Record<string, unknown>>;
	return Object.freeze({
		session: row.session as AssistanceSemanticSearchSession,
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
