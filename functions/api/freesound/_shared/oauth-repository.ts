/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FreesoundOAuthClientKind, FreesoundOAuthUser } from './oauth-contracts.ts';

export type OAuthAttemptStatus = 'pending' | 'exchanging' | 'connected' | 'denied' | 'failed';

export interface OAuthAttemptRecord {
	readonly id: string;
	readonly stateHash: string;
	readonly handoffHash: string;
	readonly clientKind: FreesoundOAuthClientKind;
	readonly status: OAuthAttemptStatus;
	readonly grantId: string | null;
	readonly errorCode: string | null;
	readonly sessionTokenHash: string | null;
	readonly sessionTokenCiphertext: string | null;
	readonly createdAt: number;
	readonly expiresAt: number;
}

export interface OAuthGrantRecord {
	readonly id: string;
	readonly user: FreesoundOAuthUser;
	readonly accessTokenCiphertext: string;
	readonly refreshTokenCiphertext: string;
	readonly accessExpiresAt: number;
	readonly refreshGeneration: number;
	readonly refreshLeaseOwner: string | null;
	readonly refreshLeaseExpiresAt: number | null;
}

export interface OAuthSessionRecord {
	readonly tokenHash: string;
	readonly grantId: string;
	readonly clientKind: FreesoundOAuthClientKind;
	readonly createdAt: number;
	readonly expiresAt: number;
	readonly grant: OAuthGrantRecord;
}

export interface OAuthGrantWrite {
	readonly id: string;
	readonly user: FreesoundOAuthUser;
	readonly accessTokenCiphertext: string;
	readonly refreshTokenCiphertext: string;
	readonly accessExpiresAt: number;
}

export interface FreesoundOAuthRepository {
	cleanupExpired(now: number): Promise<void>;
	createAttempt(attempt: OAuthAttemptRecord): Promise<void>;
	findAttemptById(id: string): Promise<OAuthAttemptRecord | null>;
	findAttemptByStateHash(stateHash: string): Promise<OAuthAttemptRecord | null>;
	claimAttempt(id: string, now: number): Promise<boolean>;
	completeAttempt(id: string, grant: OAuthGrantWrite, now: number): Promise<boolean>;
	failAttempt(id: string, status: 'denied' | 'failed', errorCode: string, now: number): Promise<void>;
	claimAttemptSession(id: string, tokenHash: string, tokenCiphertext: string): Promise<boolean>;
	ensureSession(input: Readonly<{
		tokenHash: string;
		grantId: string;
		clientKind: FreesoundOAuthClientKind;
		createdAt: number;
		expiresAt: number;
	}>): Promise<void>;
	findSession(tokenHash: string, now: number): Promise<OAuthSessionRecord | null>;
	touchSession(tokenHash: string, now: number, expiresAt: number): Promise<void>;
	deleteSessionAndOrphanGrant(tokenHash: string, now: number): Promise<void>;
	findGrant(id: string): Promise<OAuthGrantRecord | null>;
	acquireRefreshLease(input: Readonly<{
		grantId: string;
		generation: number;
		owner: string;
		now: number;
		expiresAt: number;
	}>): Promise<boolean>;
	completeRefresh(input: Readonly<{
		grantId: string;
		generation: number;
		owner: string;
		accessTokenCiphertext: string;
		refreshTokenCiphertext: string;
		accessExpiresAt: number;
		now: number;
	}>): Promise<boolean>;
	releaseRefreshLease(grantId: string, generation: number, owner: string): Promise<void>;
}

export interface D1ResultLike {
	readonly meta: Readonly<{ readonly changes?: number }>;
}

export interface D1PreparedStatementLike {
	bind(...values: unknown[]): D1PreparedStatementLike;
	first<T = Record<string, unknown>>(): Promise<T | null>;
	run(): Promise<D1ResultLike>;
}

export interface D1DatabaseSessionLike {
	prepare(query: string): D1PreparedStatementLike;
}

export interface D1DatabaseLike extends D1DatabaseSessionLike {
	batch(statements: D1PreparedStatementLike[]): Promise<D1ResultLike[]>;
	withSession(constraint?: 'first-primary' | 'first-unconstrained' | string): D1DatabaseSessionLike;
}

type D1Reader = Pick<D1DatabaseSessionLike, 'prepare'>;

export class D1FreesoundOAuthRepository implements FreesoundOAuthRepository {
	readonly #database: D1DatabaseLike;

	public constructor(database: D1DatabaseLike) {
		this.#database = database;
	}

	// A new primary-backed session for each read observes root-database writes
	// made between calls; a long-lived D1 bookmark would not.
	private get reader(): D1Reader {
		return this.#database.withSession('first-primary');
	}

	public async cleanupExpired(now: number): Promise<void> {
		await this.#database.batch([
			this.#database.prepare('DELETE FROM freesound_oauth_attempts WHERE expires_at <= ?').bind(now),
			this.#database.prepare('DELETE FROM freesound_oauth_sessions WHERE expires_at <= ?').bind(now),
			this.#database.prepare(`
				DELETE FROM freesound_oauth_grants
				WHERE NOT EXISTS (
					SELECT 1 FROM freesound_oauth_sessions s
					WHERE s.grant_id = freesound_oauth_grants.id AND s.expires_at > ?
				) AND NOT EXISTS (
					SELECT 1 FROM freesound_oauth_attempts a
					WHERE a.grant_id = freesound_oauth_grants.id AND a.expires_at > ?
				)
			`).bind(now, now),
		]);
	}

	public async createAttempt(attempt: OAuthAttemptRecord): Promise<void> {
		await this.#database.prepare(`
			INSERT INTO freesound_oauth_attempts (
				id, state_hash, handoff_hash, client_kind, status, created_at, expires_at
			) VALUES (?, ?, ?, ?, 'pending', ?, ?)
		`).bind(
			attempt.id,
			attempt.stateHash,
			attempt.handoffHash,
			attempt.clientKind,
			attempt.createdAt,
			attempt.expiresAt,
		).run();
	}

	public async findAttemptById(id: string): Promise<OAuthAttemptRecord | null> {
		return attemptRecord(await this.reader.prepare(`
			SELECT id, state_hash, handoff_hash, client_kind, status, grant_id, error_code,
				session_token_hash, session_token_ciphertext, created_at, expires_at
			FROM freesound_oauth_attempts WHERE id = ?
		`).bind(id).first());
	}

	public async findAttemptByStateHash(stateHash: string): Promise<OAuthAttemptRecord | null> {
		return attemptRecord(await this.reader.prepare(`
			SELECT id, state_hash, handoff_hash, client_kind, status, grant_id, error_code,
				session_token_hash, session_token_ciphertext, created_at, expires_at
			FROM freesound_oauth_attempts WHERE state_hash = ?
		`).bind(stateHash).first());
	}

	public async claimAttempt(id: string, now: number): Promise<boolean> {
		const result = await this.#database.prepare(`
			UPDATE freesound_oauth_attempts SET status = 'exchanging'
			WHERE id = ? AND status = 'pending' AND expires_at > ?
		`).bind(id, now).run();
		return changes(result) === 1;
	}

	public async completeAttempt(id: string, grant: OAuthGrantWrite, now: number): Promise<boolean> {
		const results = await this.#database.batch([
			this.#database.prepare(`
				INSERT INTO freesound_oauth_grants (
					id, freesound_user_id, username, access_token_ciphertext, refresh_token_ciphertext,
					access_expires_at, authorization_started_at, refresh_generation, created_at, updated_at
				) SELECT ?, ?, ?, ?, ?, ?, a.created_at, 0, ?, ?
				FROM freesound_oauth_attempts a WHERE a.id = ? AND a.status = 'exchanging'
				ON CONFLICT(freesound_user_id) DO UPDATE SET
					-- Grant IDs are canonical freesound-user-ID values, so reconnects retain
					-- the primary key already referenced by other device sessions.
					username = excluded.username,
					access_token_ciphertext = excluded.access_token_ciphertext,
					refresh_token_ciphertext = excluded.refresh_token_ciphertext,
					access_expires_at = excluded.access_expires_at,
					authorization_started_at = excluded.authorization_started_at,
					refresh_generation = freesound_oauth_grants.refresh_generation + 1,
					refresh_lease_owner = NULL,
					refresh_lease_expires_at = NULL,
					updated_at = excluded.updated_at
				WHERE excluded.authorization_started_at > freesound_oauth_grants.authorization_started_at
			`).bind(
				grant.id,
				grant.user.id,
				grant.user.username,
				grant.accessTokenCiphertext,
				grant.refreshTokenCiphertext,
				grant.accessExpiresAt,
				now,
				now,
				id,
			),
			this.#database.prepare(`
				UPDATE freesound_oauth_attempts
				SET status = 'connected', grant_id = ?, completed_at = ?
				WHERE id = ? AND status = 'exchanging'
			`).bind(grant.id, now, id),
		]);
		return changes(results[1]) === 1;
	}

	public async failAttempt(
		id: string,
		status: 'denied' | 'failed',
		errorCode: string,
		now: number,
	): Promise<void> {
		await this.#database.prepare(`
			UPDATE freesound_oauth_attempts
			SET status = ?, error_code = ?, completed_at = ?
			WHERE id = ? AND status IN ('pending', 'exchanging')
		`).bind(status, errorCode, now, id).run();
	}

	public async claimAttemptSession(id: string, tokenHash: string, tokenCiphertext: string): Promise<boolean> {
		const result = await this.#database.prepare(`
			UPDATE freesound_oauth_attempts
			SET session_token_hash = ?, session_token_ciphertext = ?
			WHERE id = ? AND status = 'connected' AND session_token_hash IS NULL
		`).bind(tokenHash, tokenCiphertext, id).run();
		return changes(result) === 1;
	}

	public async ensureSession(input: Readonly<{
		tokenHash: string;
		grantId: string;
		clientKind: FreesoundOAuthClientKind;
		createdAt: number;
		expiresAt: number;
	}>): Promise<void> {
		await this.#database.prepare(`
			INSERT OR IGNORE INTO freesound_oauth_sessions (
				token_hash, grant_id, client_kind, created_at, last_seen_at, expires_at
			) VALUES (?, ?, ?, ?, ?, ?)
		`).bind(
			input.tokenHash,
			input.grantId,
			input.clientKind,
			input.createdAt,
			input.createdAt,
			input.expiresAt,
		).run();
	}

	public async findSession(tokenHash: string, now: number): Promise<OAuthSessionRecord | null> {
		return sessionRecord(await this.reader.prepare(`
			SELECT s.token_hash, s.grant_id, s.client_kind, s.created_at AS session_created_at,
				s.expires_at AS session_expires_at, g.freesound_user_id, g.username,
				g.access_token_ciphertext, g.refresh_token_ciphertext, g.access_expires_at,
				g.refresh_generation, g.refresh_lease_owner, g.refresh_lease_expires_at
			FROM freesound_oauth_sessions s
			JOIN freesound_oauth_grants g ON g.id = s.grant_id
			WHERE s.token_hash = ? AND s.expires_at > ?
		`).bind(tokenHash, now).first());
	}

	public async touchSession(tokenHash: string, now: number, expiresAt: number): Promise<void> {
		await this.#database.prepare(`
			UPDATE freesound_oauth_sessions SET last_seen_at = ?, expires_at = ?
			WHERE token_hash = ? AND expires_at > ?
		`).bind(now, expiresAt, tokenHash, now).run();
	}

	public async deleteSessionAndOrphanGrant(tokenHash: string, now: number): Promise<void> {
		const session = await this.reader.prepare(`
			SELECT grant_id FROM freesound_oauth_sessions WHERE token_hash = ?
		`).bind(tokenHash).first<{ grant_id: string }>();
		if (session === null) return;
		await this.#database.batch([
			this.#database.prepare(`
				DELETE FROM freesound_oauth_attempts WHERE session_token_hash = ?
			`).bind(tokenHash),
			this.#database.prepare('DELETE FROM freesound_oauth_sessions WHERE token_hash = ?').bind(tokenHash),
			this.#database.prepare(`
				DELETE FROM freesound_oauth_grants WHERE id = ?
				AND NOT EXISTS (
					SELECT 1 FROM freesound_oauth_sessions s
					WHERE s.grant_id = ? AND s.token_hash <> ? AND s.expires_at > ?
				) AND NOT EXISTS (
					SELECT 1 FROM freesound_oauth_attempts a
					WHERE a.grant_id = ? AND a.status = 'connected'
					AND a.session_token_hash IS NULL AND a.expires_at > ?
				)
			`).bind(session.grant_id, session.grant_id, tokenHash, now, session.grant_id, now),
		]);
	}

	public async findGrant(id: string): Promise<OAuthGrantRecord | null> {
		return grantRecord(await this.reader.prepare(`
			SELECT id, freesound_user_id, username, access_token_ciphertext,
				refresh_token_ciphertext, access_expires_at, refresh_generation,
				refresh_lease_owner, refresh_lease_expires_at
			FROM freesound_oauth_grants WHERE id = ?
		`).bind(id).first());
	}

	public async acquireRefreshLease(input: Readonly<{
		grantId: string;
		generation: number;
		owner: string;
		now: number;
		expiresAt: number;
	}>): Promise<boolean> {
		const result = await this.#database.prepare(`
			UPDATE freesound_oauth_grants
			SET refresh_lease_owner = ?, refresh_lease_expires_at = ?
			WHERE id = ? AND refresh_generation = ?
				AND (refresh_lease_expires_at IS NULL OR refresh_lease_expires_at <= ?)
		`).bind(input.owner, input.expiresAt, input.grantId, input.generation, input.now).run();
		return changes(result) === 1;
	}

	public async completeRefresh(input: Readonly<{
		grantId: string;
		generation: number;
		owner: string;
		accessTokenCiphertext: string;
		refreshTokenCiphertext: string;
		accessExpiresAt: number;
		now: number;
	}>): Promise<boolean> {
		const result = await this.#database.prepare(`
			UPDATE freesound_oauth_grants SET
				access_token_ciphertext = ?, refresh_token_ciphertext = ?, access_expires_at = ?,
				refresh_generation = refresh_generation + 1, refresh_lease_owner = NULL,
				refresh_lease_expires_at = NULL, updated_at = ?
			WHERE id = ? AND refresh_generation = ? AND refresh_lease_owner = ?
		`).bind(
			input.accessTokenCiphertext,
			input.refreshTokenCiphertext,
			input.accessExpiresAt,
			input.now,
			input.grantId,
			input.generation,
			input.owner,
		).run();
		return changes(result) === 1;
	}

	public async releaseRefreshLease(grantId: string, generation: number, owner: string): Promise<void> {
		await this.#database.prepare(`
			UPDATE freesound_oauth_grants
			SET refresh_lease_owner = NULL, refresh_lease_expires_at = NULL
			WHERE id = ? AND refresh_generation = ? AND refresh_lease_owner = ?
		`).bind(grantId, generation, owner).run();
	}
}

function attemptRecord(row: Record<string, unknown> | null): OAuthAttemptRecord | null {
	if (row === null) return null;
	return {
		id: stringField(row, 'id'),
		stateHash: stringField(row, 'state_hash'),
		handoffHash: stringField(row, 'handoff_hash'),
		clientKind: clientKind(row.client_kind),
		status: attemptStatus(row.status),
		grantId: nullableString(row.grant_id),
		errorCode: nullableString(row.error_code),
		sessionTokenHash: nullableString(row.session_token_hash),
		sessionTokenCiphertext: nullableString(row.session_token_ciphertext),
		createdAt: integerField(row, 'created_at'),
		expiresAt: integerField(row, 'expires_at'),
	};
}

function grantRecord(row: Record<string, unknown> | null): OAuthGrantRecord | null {
	if (row === null) return null;
	return {
		id: stringField(row, 'id'),
		user: {
			id: integerField(row, 'freesound_user_id'),
			username: stringField(row, 'username'),
		},
		accessTokenCiphertext: stringField(row, 'access_token_ciphertext'),
		refreshTokenCiphertext: stringField(row, 'refresh_token_ciphertext'),
		accessExpiresAt: integerField(row, 'access_expires_at'),
		refreshGeneration: integerField(row, 'refresh_generation'),
		refreshLeaseOwner: nullableString(row.refresh_lease_owner),
		refreshLeaseExpiresAt: nullableInteger(row.refresh_lease_expires_at),
	};
}

function sessionRecord(row: Record<string, unknown> | null): OAuthSessionRecord | null {
	if (row === null) return null;
	const grant = grantRecord({ ...row, id: row.grant_id });
	if (grant === null) throw new Error('The Freesound OAuth grant is missing.');
	return {
		tokenHash: stringField(row, 'token_hash'),
		grantId: stringField(row, 'grant_id'),
		clientKind: clientKind(row.client_kind),
		createdAt: integerField(row, 'session_created_at'),
		expiresAt: integerField(row, 'session_expires_at'),
		grant,
	};
}

function changes(result: D1ResultLike | undefined): number {
	const value = result?.meta.changes;
	return typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;
}

function stringField(row: Record<string, unknown>, key: string): string {
	const value = row[key];
	if (typeof value !== 'string') throw new Error(`Invalid Freesound OAuth database field: ${key}.`);
	return value;
}

function integerField(row: Record<string, unknown>, key: string): number {
	const value = row[key];
	if (!Number.isSafeInteger(value)) throw new Error(`Invalid Freesound OAuth database field: ${key}.`);
	return value as number;
}

function nullableString(value: unknown): string | null {
	if (value === null) return null;
	if (typeof value !== 'string') throw new Error('Invalid Freesound OAuth nullable string.');
	return value;
}

function nullableInteger(value: unknown): number | null {
	if (value === null) return null;
	if (!Number.isSafeInteger(value)) throw new Error('Invalid Freesound OAuth nullable integer.');
	return value as number;
}

function clientKind(value: unknown): FreesoundOAuthClientKind {
	if (value !== 'web' && value !== 'desktop') throw new Error('Invalid Freesound OAuth client kind.');
	return value;
}

function attemptStatus(value: unknown): OAuthAttemptStatus {
	if (!['pending', 'exchanging', 'connected', 'denied', 'failed'].includes(String(value))) {
		throw new Error('Invalid Freesound OAuth attempt status.');
	}
	return value as OAuthAttemptStatus;
}
