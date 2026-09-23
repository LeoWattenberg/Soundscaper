/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import test from 'node:test';

import {
	D1FreesoundOAuthRepository,
	type D1DatabaseLike,
	type D1DatabaseSessionLike,
	type D1PreparedStatementLike,
	type D1ResultLike,
	type OAuthAttemptRecord,
} from '../functions/api/freesound/_shared/oauth-repository.ts';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);

class SqliteD1Statement implements D1PreparedStatementLike {
	readonly #statement: StatementSync;
	readonly #values: readonly unknown[];

	public constructor(statement: StatementSync, values: readonly unknown[] = []) {
		this.#statement = statement;
		this.#values = values;
	}

	public bind(...values: unknown[]): D1PreparedStatementLike {
		return new SqliteD1Statement(this.#statement, values);
	}

	public first<T = Record<string, unknown>>(): Promise<T | null> {
		const row = this.#statement.get(...this.#values.map(sqlValue));
		return Promise.resolve(row === undefined ? null : row as T);
	}

	public run(): Promise<D1ResultLike> {
		return Promise.resolve(this.runSync());
	}

	public runSync(): D1ResultLike {
		const result = this.#statement.run(...this.#values.map(sqlValue));
		return { meta: { changes: Number(result.changes) } };
	}
}

class SqliteD1Database implements D1DatabaseLike {
	readonly #database: DatabaseSync;

	public constructor(database: DatabaseSync) {
		this.#database = database;
	}

	public prepare(query: string): D1PreparedStatementLike {
		return new SqliteD1Statement(this.#database.prepare(query));
	}

	public batch(statements: D1PreparedStatementLike[]): Promise<D1ResultLike[]> {
		this.#database.exec('BEGIN IMMEDIATE');
		try {
			const results = statements.map((statement) => {
				if (!(statement instanceof SqliteD1Statement)) throw new TypeError('Unexpected statement adapter.');
				return statement.runSync();
			});
			this.#database.exec('COMMIT');
			return Promise.resolve(results);
		} catch (error) {
			this.#database.exec('ROLLBACK');
			return Promise.reject(error);
		}
	}

	public withSession(): D1DatabaseSessionLike {
		return this;
	}
}

function sqlValue(value: unknown): null | string | number | bigint | Uint8Array {
	if (value === null || typeof value === 'string' || typeof value === 'number'
		|| typeof value === 'bigint' || value instanceof Uint8Array) return value;
	throw new TypeError('The D1 test adapter received an unsupported value.');
}

function attempt(id: string, stateHash: string, createdAt = NOW): OAuthAttemptRecord {
	return {
		id,
		stateHash,
		handoffHash: `handoff-${id}`,
		clientKind: 'desktop',
		status: 'pending',
		grantId: null,
		errorCode: null,
		sessionTokenHash: null,
		sessionTokenCiphertext: null,
		createdAt,
		expiresAt: NOW + 600_000,
	};
}

test('the D1 migration and repository keep one canonical grant across reconnects', async () => {
	const database = new DatabaseSync(':memory:');
	try {
		database.exec(await readFile(new URL(
			'../migrations/freesound-oauth/0001_initial.sql',
			import.meta.url,
		), 'utf8'));
		const repository = new D1FreesoundOAuthRepository(new SqliteD1Database(database));
		await repository.createAttempt(attempt('attempt-1', 'state-1'));
		assert.equal(await repository.claimAttempt('attempt-1', NOW), true);
		assert.equal(await repository.completeAttempt('attempt-1', {
			id: 'freesound-user-42',
			user: { id: 42, username: 'recordist' },
			accessTokenCiphertext: 'access-v1',
			refreshTokenCiphertext: 'refresh-v1',
			accessExpiresAt: NOW + 86_400_000,
		}, NOW), true);

		await repository.createAttempt(attempt('attempt-2', 'state-2', NOW + 1));
		assert.equal(await repository.claimAttempt('attempt-2', NOW), true);
		assert.equal(await repository.completeAttempt('attempt-2', {
			id: 'freesound-user-42',
			user: { id: 42, username: 'renamed-recordist' },
			accessTokenCiphertext: 'access-v2',
			refreshTokenCiphertext: 'refresh-v2',
			accessExpiresAt: NOW + 86_400_000,
		}, NOW), true);

		const grant = await repository.findGrant('freesound-user-42');
		assert(grant);
		assert.equal(grant.user.username, 'renamed-recordist');
		assert.equal(grant.refreshGeneration, 1);
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM freesound_oauth_grants').get()?.count, 1);
		assert.equal((await repository.findAttemptById('attempt-1'))?.grantId, 'freesound-user-42');
		assert.equal((await repository.findAttemptById('attempt-2'))?.grantId, 'freesound-user-42');

		await repository.createAttempt(attempt('unclaimed', 'state-3'));
		assert.equal(await repository.completeAttempt('unclaimed', {
			id: 'freesound-user-99',
			user: { id: 99, username: 'must-not-persist' },
			accessTokenCiphertext: 'orphan-access',
			refreshTokenCiphertext: 'orphan-refresh',
			accessExpiresAt: NOW + 86_400_000,
		}, NOW), false);
		assert.equal(await repository.findGrant('freesound-user-99'), null);
	} finally {
		database.close();
	}
});

test('an older callback cannot replace a newer Freesound token pair', async () => {
	const database = new DatabaseSync(':memory:');
	try {
		database.exec(await readFile(new URL('../migrations/freesound-oauth/0001_initial.sql', import.meta.url), 'utf8'));
		const repository = new D1FreesoundOAuthRepository(new SqliteD1Database(database));
		await repository.createAttempt(attempt('older', 'older-state', NOW));
		await repository.createAttempt(attempt('newer', 'newer-state', NOW + 1));
		await repository.claimAttempt('older', NOW + 2);
		await repository.claimAttempt('newer', NOW + 2);
		const grant = (version: string) => ({
			id: 'freesound-user-42',
			user: { id: 42, username: 'recordist' },
			accessTokenCiphertext: `access-${version}`,
			refreshTokenCiphertext: `refresh-${version}`,
			accessExpiresAt: NOW + 86_400_000,
		});
		assert.equal(await repository.completeAttempt('newer', grant('newer'), NOW + 3), true);
		assert.equal(await repository.completeAttempt('older', grant('older'), NOW + 4), true);
		assert.equal((await repository.findGrant('freesound-user-42'))?.accessTokenCiphertext, 'access-newer');
		assert.equal((await repository.findGrant('freesound-user-42'))?.refreshTokenCiphertext, 'refresh-newer');
	} finally {
		database.close();
	}
});

test('disconnect preserves a grant until another completed callback is claimed', async () => {
	const database = new DatabaseSync(':memory:');
	try {
		database.exec(await readFile(new URL('../migrations/freesound-oauth/0001_initial.sql', import.meta.url), 'utf8'));
		const repository = new D1FreesoundOAuthRepository(new SqliteD1Database(database));
		await repository.createAttempt(attempt('first', 'first-state'));
		await repository.claimAttempt('first', NOW);
		await repository.completeAttempt('first', {
			id: 'freesound-user-42', user: { id: 42, username: 'recordist' },
			accessTokenCiphertext: 'access', refreshTokenCiphertext: 'refresh', accessExpiresAt: NOW + 86_400_000,
		}, NOW);
		await repository.claimAttemptSession('first', 'first-session', 'first-ciphertext');
		await repository.ensureSession({
			tokenHash: 'first-session', grantId: 'freesound-user-42', clientKind: 'desktop',
			createdAt: NOW, expiresAt: NOW + 86_400_000,
		});
		await repository.createAttempt(attempt('second', 'second-state'));
		await repository.claimAttempt('second', NOW);
		await repository.completeAttempt('second', {
			id: 'freesound-user-42', user: { id: 42, username: 'recordist' },
			accessTokenCiphertext: 'access-2', refreshTokenCiphertext: 'refresh-2', accessExpiresAt: NOW + 86_400_000,
		}, NOW);
		await repository.deleteSessionAndOrphanGrant('first-session', NOW);
		assert.equal(await repository.findAttemptById('first'), null);
		assert.equal((await repository.findAttemptById('second'))?.status, 'connected');
		assert(await repository.findGrant('freesound-user-42'));
		assert.equal(await repository.claimAttemptSession('second', 'second-session', 'second-ciphertext'), true);
		await repository.ensureSession({
			tokenHash: 'second-session', grantId: 'freesound-user-42', clientKind: 'desktop',
			createdAt: NOW, expiresAt: NOW + 86_400_000,
		});
		assert(await repository.findSession('second-session', NOW));
	} finally {
		database.close();
	}
});

test('the D1 repository fences refresh writes and removes the last session grant on disconnect', async () => {
	const database = new DatabaseSync(':memory:');
	try {
		database.exec(await readFile(new URL(
			'../migrations/freesound-oauth/0001_initial.sql',
			import.meta.url,
		), 'utf8'));
		const repository = new D1FreesoundOAuthRepository(new SqliteD1Database(database));
		await repository.createAttempt(attempt('attempt', 'state'));
		await repository.claimAttempt('attempt', NOW);
		await repository.completeAttempt('attempt', {
			id: 'freesound-user-42',
			user: { id: 42, username: 'recordist' },
			accessTokenCiphertext: 'access-v1',
			refreshTokenCiphertext: 'refresh-v1',
			accessExpiresAt: NOW - 1,
		}, NOW);
		assert.equal(await repository.claimAttemptSession('attempt', 'session-hash', 'session-ciphertext'), true);
		await repository.ensureSession({
			tokenHash: 'session-hash',
			grantId: 'freesound-user-42',
			clientKind: 'desktop',
			createdAt: NOW,
			expiresAt: NOW + 86_400_000,
		});

		assert.equal(await repository.acquireRefreshLease({
			grantId: 'freesound-user-42', generation: 0, owner: 'worker-a', now: NOW, expiresAt: NOW + 15_000,
		}), true);
		assert.equal(await repository.acquireRefreshLease({
			grantId: 'freesound-user-42', generation: 0, owner: 'worker-b', now: NOW, expiresAt: NOW + 15_000,
		}), false);
		assert.equal(await repository.completeRefresh({
			grantId: 'freesound-user-42',
			generation: 0,
			owner: 'worker-b',
			accessTokenCiphertext: 'bad-access',
			refreshTokenCiphertext: 'bad-refresh',
			accessExpiresAt: NOW + 86_400_000,
			now: NOW,
		}), false);
		assert.equal(await repository.completeRefresh({
			grantId: 'freesound-user-42',
			generation: 0,
			owner: 'worker-a',
			accessTokenCiphertext: 'access-v2',
			refreshTokenCiphertext: 'refresh-v2',
			accessExpiresAt: NOW + 86_400_000,
			now: NOW,
		}), true);
		assert.equal((await repository.findGrant('freesound-user-42'))?.refreshGeneration, 1);

		await repository.deleteSessionAndOrphanGrant('session-hash', NOW);
		assert.equal(await repository.findSession('session-hash', NOW), null);
		assert.equal(await repository.findGrant('freesound-user-42'), null);
		assert.equal(await repository.findAttemptById('attempt'), null);
	} finally {
		database.close();
	}
});
