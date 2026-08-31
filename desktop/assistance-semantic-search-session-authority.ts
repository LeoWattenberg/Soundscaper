/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned issuance and revocation for short-lived semantic-search bearer sessions. */

import { randomBytes as nodeRandomBytes } from 'node:crypto';

import {
	ASSISTANCE_SEMANTIC_SEARCH_MAXIMUM_SESSION_LIFETIME_MS,
	validateAssistanceSemanticSearchSession,
	type AssistanceSemanticSearchSession,
} from '../src/common/editor/assistance/async-search-provider.ts';
import {
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
	type ProjectSchemaFamily,
} from '../src/common/editor/project-schema-identity.ts';

const DEFAULT_SESSION_LIFETIME_MS = 5 * 60 * 1_000;
const SESSION_BYTES = 20;
const MAXIMUM_ID_ATTEMPTS = 8;
const SESSION_ID = /^[a-f\d]{40}$/u;
const PROJECT_ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const OPEN_FIELDS = Object.freeze([
	'schemaFamily', 'schemaVersion', 'projectId', 'projectRevision', 'lifetimeMs',
]);
const EXPECTED_FIELDS = Object.freeze([
	'schemaFamily', 'schemaVersion', 'projectId', 'projectRevision',
]);
const PROJECT_FIELDS = Object.freeze(['schemaFamily', 'schemaVersion', 'projectId']);

export interface AssistanceSemanticSearchSessionAuthorityOptions {
	readonly now?: () => number;
	readonly randomBytes?: (size: number) => Uint8Array;
	readonly defaultLifetimeMs?: number;
}

export interface AssistanceSemanticSearchSessionOpenRequest {
	readonly schemaFamily: ProjectSchemaFamily;
	readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly lifetimeMs?: number;
}

export interface AssistanceSemanticSearchProjectAuthority {
	readonly schemaFamily: ProjectSchemaFamily;
	readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
	readonly projectId: string;
	readonly projectRevision: number;
}

export class AssistanceSemanticSearchSessionAuthority {
	readonly #now: () => number;
	readonly #randomBytes: (size: number) => Uint8Array;
	readonly #defaultLifetimeMs: number;
	readonly #active = new Map<string, AssistanceSemanticSearchSession>();

	constructor(options: AssistanceSemanticSearchSessionAuthorityOptions = {}) {
		if (!options || typeof options !== 'object' || Array.isArray(options)
			|| options.now !== undefined && typeof options.now !== 'function'
			|| options.randomBytes !== undefined && typeof options.randomBytes !== 'function') {
			throw new TypeError('Semantic-search session authority options are invalid.');
		}
		this.#now = options.now ?? Date.now;
		this.#randomBytes = options.randomBytes ?? nodeRandomBytes;
		this.#defaultLifetimeMs = lifetime(options.defaultLifetimeMs ?? DEFAULT_SESSION_LIFETIME_MS);
	}

	open(value: AssistanceSemanticSearchSessionOpenRequest): AssistanceSemanticSearchSession {
		const fields = Object.hasOwn(value ?? {}, 'lifetimeMs') ? OPEN_FIELDS : EXPECTED_FIELDS;
		const identity = currentIdentity(value, 'semantic-search session opening');
		const row = exactRecord(value, fields, 'semantic-search session opening');
		const projectId = projectIdValue(row.projectId);
		const projectRevision = revision(row.projectRevision);
		const lifetimeMs = lifetime(row.lifetimeMs ?? this.#defaultLifetimeMs);
		const now = timestamp(this.#now());
		this.#prune(now);
		let sessionId: string | null = null;
		for (let attempt = 0; attempt < MAXIMUM_ID_ATTEMPTS; attempt += 1) {
			const bytes = this.#randomBytes(SESSION_BYTES);
			if (!(bytes instanceof Uint8Array) || bytes.byteLength !== SESSION_BYTES) {
				throw new TypeError('Semantic-search session entropy is invalid.');
			}
			const candidate = Buffer.from(bytes).toString('hex');
			if (!this.#active.has(candidate)) { sessionId = candidate; break; }
		}
		if (sessionId === null) throw new Error('Semantic-search session entropy repeatedly collided.');
		const session = validateAssistanceSemanticSearchSession({
			sessionVersion: 1, sessionId, ...identity, projectId, projectRevision,
			expiresAtEpochMs: now + lifetimeMs,
		}, now);
		this.#active.set(sessionId, session);
		return session;
	}

	authorize(
		value: unknown,
		expectedValue: AssistanceSemanticSearchProjectAuthority,
	): AssistanceSemanticSearchSession {
		const expected = exactRecord(expectedValue, EXPECTED_FIELDS,
			'semantic-search project authority');
		const identity = currentIdentity(expectedValue, 'semantic-search project authority');
		const projectId = projectIdValue(expected.projectId);
		const projectRevision = revision(expected.projectRevision);
		const now = timestamp(this.#now());
		this.#prune(now);
		const session = validateAssistanceSemanticSearchSession(value, now);
		const active = this.#active.get(session.sessionId);
		if (!active || !sameSession(active, session)) {
			throw new Error('The semantic-search bearer session is not active or was revoked.');
		}
		if (session.schemaFamily !== identity.schemaFamily
			|| session.schemaVersion !== identity.schemaVersion
			|| session.projectId !== projectId || session.projectRevision !== projectRevision) {
			this.#active.delete(session.sessionId);
			throw new Error('The semantic-search session is stale against current project revision authority.');
		}
		return session;
	}

	revoke(sessionIdValue: string): boolean {
		if (typeof sessionIdValue !== 'string' || !SESSION_ID.test(sessionIdValue)) {
			throw new TypeError('The semantic-search session ID is invalid.');
		}
		this.#prune(timestamp(this.#now()));
		return this.#active.delete(sessionIdValue);
	}

	revokeProject(value: Readonly<Pick<AssistanceSemanticSearchProjectAuthority,
		'schemaFamily' | 'schemaVersion' | 'projectId'>>): number {
		const identity = currentIdentity(value, 'semantic-search project revocation');
		const row = exactRecord(value, PROJECT_FIELDS, 'semantic-search project revocation');
		const projectId = projectIdValue(row.projectId);
		this.#prune(timestamp(this.#now()));
		let revoked = 0;
		for (const [sessionId, session] of this.#active) {
			if (session.schemaFamily !== identity.schemaFamily || session.projectId !== projectId) continue;
			this.#active.delete(sessionId);
			revoked += 1;
		}
		return revoked;
	}

	pruneExpired(): readonly string[] {
		return Object.freeze(this.#prune(timestamp(this.#now())));
	}

	#prune(now: number): string[] {
		const expired: string[] = [];
		for (const [sessionId, session] of this.#active) {
			if (session.expiresAtEpochMs > now) continue;
			this.#active.delete(sessionId);
			expired.push(sessionId);
		}
		return expired;
	}
}

function sameSession(left: AssistanceSemanticSearchSession, right: AssistanceSemanticSearchSession): boolean {
	return left.sessionVersion === right.sessionVersion && left.sessionId === right.sessionId
		&& left.schemaFamily === right.schemaFamily && left.schemaVersion === right.schemaVersion
		&& left.projectId === right.projectId && left.projectRevision === right.projectRevision
		&& left.expiresAtEpochMs === right.expiresAtEpochMs;
}

function currentIdentity(
	value: unknown,
	label: string,
): Readonly<{ schemaFamily: ProjectSchemaFamily; schemaVersion: typeof PROJECT_SCHEMA_VERSION }> {
	const identity = readProjectSchemaIdentity(value);
	if (identity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new RangeError(`The ${label} requires a current project schema.`);
	}
	return Object.freeze({ schemaFamily: identity.schemaFamily, schemaVersion: PROJECT_SCHEMA_VERSION });
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

function projectIdValue(value: unknown): string {
	if (typeof value !== 'string' || !PROJECT_ID.test(value)) {
		throw new TypeError('The semantic-search project ID is invalid.');
	}
	return value;
}

function revision(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError('The semantic-search project revision is invalid.');
	}
	return Number(value);
}

function lifetime(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1
		|| Number(value) > ASSISTANCE_SEMANTIC_SEARCH_MAXIMUM_SESSION_LIFETIME_MS) {
		throw new RangeError('The semantic-search session lifetime exceeds its short-lived bound.');
	}
	return Number(value);
}

function timestamp(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0
		|| Number(value) > 8_640_000_000_000_000) {
		throw new RangeError('The semantic-search authority clock is invalid.');
	}
	return Number(value);
}
