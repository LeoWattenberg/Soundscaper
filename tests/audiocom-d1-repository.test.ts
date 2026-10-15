/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import test from 'node:test';
import { parseStoredProviderBinding, type AudiocomOAuthProviderBinding } from '../functions/api/audiocom/_shared/oauth-provider-binding-contracts.ts';

import {
	D1AudiocomOAuthRepository,
	type D1DatabaseLike,
	type D1DatabaseSessionLike,
	type D1PreparedStatementLike,
	type D1ResultLike,
	type OAuthAttemptRecord,
} from '../functions/api/audiocom/_shared/oauth-repository.ts';

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
		pkceVerifierCiphertext: `pkce-${id}`,
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
		await migrate(database);
		const repository = new D1AudiocomOAuthRepository(new SqliteD1Database(database));
		await repository.createAttempt(attempt('attempt-1', 'state-1'));
		assert.equal(await repository.claimAttempt('attempt-1', NOW), true);
		assert.equal(await repository.completeAttempt('attempt-1', {
			id: 'audiocom-user-42',
			user: { id: '42', username: 'recordist' },
			accessTokenCiphertext: 'access-v1',
			refreshTokenCiphertext: 'refresh-v1',
			accessExpiresAt: NOW + 86_400_000,
		}, NOW), true);

		await repository.createAttempt(attempt('attempt-2', 'state-2', NOW + 1));
		assert.equal(await repository.claimAttempt('attempt-2', NOW), true);
		assert.equal(await repository.completeAttempt('attempt-2', {
			id: 'audiocom-user-42',
			user: { id: '42', username: 'renamed-recordist' },
			accessTokenCiphertext: 'access-v2',
			refreshTokenCiphertext: 'refresh-v2',
			accessExpiresAt: NOW + 86_400_000,
		}, NOW), true);

		const grant = await repository.findGrant('audiocom-user-42');
		assert(grant);
		assert.equal(grant.user.username, 'renamed-recordist');
		assert.equal(grant.refreshGeneration, 1);
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM audiocom_oauth_grants').get()?.count, 1);
		assert.equal((await repository.findAttemptById('attempt-1'))?.grantId, 'audiocom-user-42');
		assert.equal((await repository.findAttemptById('attempt-2'))?.grantId, 'audiocom-user-42');

		await repository.createAttempt(attempt('unclaimed', 'state-3'));
		assert.equal(await repository.completeAttempt('unclaimed', {
			id: 'audiocom-user-99',
			user: { id: '99', username: 'must-not-persist' },
			accessTokenCiphertext: 'orphan-access',
			refreshTokenCiphertext: 'orphan-refresh',
			accessExpiresAt: NOW + 86_400_000,
		}, NOW), false);
		assert.equal(await repository.findGrant('audiocom-user-99'), null);
	} finally {
		database.close();
	}
});

test('an older callback cannot replace a newer Audiocom token pair', async () => {
	const database = new DatabaseSync(':memory:');
	try {
		await migrate(database);
		const repository = new D1AudiocomOAuthRepository(new SqliteD1Database(database));
		await repository.createAttempt(attempt('older', 'older-state', NOW));
		await repository.createAttempt(attempt('newer', 'newer-state', NOW + 1));
		await repository.claimAttempt('older', NOW + 2);
		await repository.claimAttempt('newer', NOW + 2);
		const grant = (version: string) => ({
			id: 'audiocom-user-42',
			user: { id: '42', username: 'recordist' },
			accessTokenCiphertext: `access-${version}`,
			refreshTokenCiphertext: `refresh-${version}`,
			accessExpiresAt: NOW + 86_400_000,
		});
		assert.equal(await repository.completeAttempt('newer', grant('newer'), NOW + 3), true);
		assert.equal(await repository.completeAttempt('older', grant('older'), NOW + 4), true);
		assert.equal((await repository.findGrant('audiocom-user-42'))?.accessTokenCiphertext, 'access-newer');
		assert.equal((await repository.findGrant('audiocom-user-42'))?.refreshTokenCiphertext, 'refresh-newer');
	} finally {
		database.close();
	}
});

test('disconnect preserves a grant until another completed callback is claimed', async () => {
	const database = new DatabaseSync(':memory:');
	try {
		await migrate(database);
		const repository = new D1AudiocomOAuthRepository(new SqliteD1Database(database));
		await repository.createAttempt(attempt('first', 'first-state'));
		await repository.claimAttempt('first', NOW);
		await repository.completeAttempt('first', {
			id: 'audiocom-user-42', user: { id: '42', username: 'recordist' },
			accessTokenCiphertext: 'access', refreshTokenCiphertext: 'refresh', accessExpiresAt: NOW + 86_400_000,
		}, NOW);
		await repository.claimAttemptSession('first', 'first-session', 'first-ciphertext');
		await repository.ensureSession({
			tokenHash: 'first-session', grantId: 'audiocom-user-42', clientKind: 'desktop',
			createdAt: NOW, expiresAt: NOW + 86_400_000,
		});
		await repository.createAttempt(attempt('second', 'second-state'));
		await repository.claimAttempt('second', NOW);
		await repository.completeAttempt('second', {
			id: 'audiocom-user-42', user: { id: '42', username: 'recordist' },
			accessTokenCiphertext: 'access-2', refreshTokenCiphertext: 'refresh-2', accessExpiresAt: NOW + 86_400_000,
		}, NOW);
		await repository.deleteSessionAndOrphanGrant('first-session', NOW);
		assert.equal(await repository.findAttemptById('first'), null);
		assert.equal((await repository.findAttemptById('second'))?.status, 'connected');
		assert(await repository.findGrant('audiocom-user-42'));
		assert.equal(await repository.claimAttemptSession('second', 'second-session', 'second-ciphertext'), true);
		await repository.ensureSession({
			tokenHash: 'second-session', grantId: 'audiocom-user-42', clientKind: 'desktop',
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
		await migrate(database);
		const repository = new D1AudiocomOAuthRepository(new SqliteD1Database(database));
		await repository.createAttempt(attempt('attempt', 'state'));
		await repository.claimAttempt('attempt', NOW);
		await repository.completeAttempt('attempt', {
			id: 'audiocom-user-42',
			user: { id: '42', username: 'recordist' },
			accessTokenCiphertext: 'access-v1',
			refreshTokenCiphertext: 'refresh-v1',
			accessExpiresAt: NOW - 1,
		}, NOW);
		assert.equal(await repository.claimAttemptSession('attempt', 'session-hash', 'session-ciphertext'), true);
		await repository.ensureSession({
			tokenHash: 'session-hash',
			grantId: 'audiocom-user-42',
			clientKind: 'desktop',
			createdAt: NOW,
			expiresAt: NOW + 86_400_000,
		});

		assert.equal(await repository.acquireRefreshLease({
			grantId: 'audiocom-user-42', generation: 0, owner: 'worker-a', now: NOW, expiresAt: NOW + 15_000,
		}), true);
		assert.equal(await repository.acquireRefreshLease({
			grantId: 'audiocom-user-42', generation: 0, owner: 'worker-b', now: NOW, expiresAt: NOW + 15_000,
		}), false);
		assert.equal(await repository.completeRefresh({
			grantId: 'audiocom-user-42',
			generation: 0,
			owner: 'worker-b',
			accessTokenCiphertext: 'bad-access',
			refreshTokenCiphertext: 'bad-refresh',
			accessExpiresAt: NOW + 86_400_000,
			now: NOW,
		}), false);
		assert.equal(await repository.completeRefresh({
			grantId: 'audiocom-user-42',
			generation: 0,
			owner: 'worker-a',
			accessTokenCiphertext: 'access-v2',
			refreshTokenCiphertext: 'refresh-v2',
			accessExpiresAt: NOW + 86_400_000,
			now: NOW,
		}), true);
		assert.equal((await repository.findGrant('audiocom-user-42'))?.refreshGeneration, 1);

		await repository.deleteSessionAndOrphanGrant('session-hash', NOW);
		assert.equal(await repository.findSession('session-hash', NOW), null);
		assert.equal(await repository.findGrant('audiocom-user-42'), null);
		assert.equal(await repository.findAttemptById('attempt'), null);
	} finally {
		database.close();
	}
});


async function migrate(database: DatabaseSync): Promise<void> {
	for (const filename of ['0002_audiocom.sql', '0003_audiocom_provider_binding.sql']) {
		database.exec(await readFile(new URL(`../migrations/freesound-oauth/${filename}`, import.meta.url), 'utf8'));
	}
}

const CUSTOM_PROVIDER: AudiocomOAuthProviderBinding = {
	apiOrigin: 'https://audio.example.org', clientId: 'client_registered_here',
	redirectUri: 'https://soundscaper.org/api/audiocom/oauth/callback', scope: 'public projects',
};
const DEFAULT_PROVIDER: AudiocomOAuthProviderBinding = {
	apiOrigin: 'https://api.audio.com', clientId: '1879138787993593',
	redirectUri: 'https://soundscaper.org/api/audiocom/oauth/callback', scope: 'public',
};

test('D1 pins each provider registration through attempts, grants, sessions, and refresh rotation', async () => {
	const database = new DatabaseSync(':memory:');
	try {
		await migrate(database);
		const repository = new D1AudiocomOAuthRepository(new SqliteD1Database(database));
		for (const [index, provider] of [CUSTOM_PROVIDER, DEFAULT_PROVIDER].entries()) {
			const id = `provider-${index}`;
			await repository.createAttempt({ ...attempt(id, `state-${id}`), provider });
			assert.deepEqual((await repository.findAttemptById(id))?.provider, provider);
			assert.deepEqual((await repository.findAttemptByStateHash(`state-${id}`))?.provider, provider);
			assert.equal(await repository.claimAttempt(id, NOW), true);
			assert.equal(await repository.completeAttempt(id, {
				id, user: { id, username: '' }, provider,
				accessTokenCiphertext: 'access', refreshTokenCiphertext: 'refresh', accessExpiresAt: NOW - 1,
			}, NOW), true);
			assert.deepEqual((await repository.findGrant(id))?.provider, provider);
			await repository.ensureSession({ tokenHash: `session-${id}`, grantId: id, clientKind: 'desktop', createdAt: NOW, expiresAt: NOW + 86_400_000 });
			assert.deepEqual((await repository.findSession(`session-${id}`, NOW))?.grant.provider, provider);
			assert.equal(await repository.acquireRefreshLease({ grantId: id, generation: 0, owner: 'worker', now: NOW, expiresAt: NOW + 15_000 }), true);
			assert.equal(await repository.completeRefresh({
				grantId: id, generation: 0, owner: 'worker', now: NOW,
				accessTokenCiphertext: 'access-rotated', refreshTokenCiphertext: 'refresh-rotated', accessExpiresAt: NOW + 86_400_000,
			}), true);
			assert.deepEqual((await repository.findSession(`session-${id}`, NOW))?.grant.provider, provider);
		}
	} finally { database.close(); }
});

test('the additive binding migration preserves pre-existing authorizations with the legacy default', async () => {
	const database = new DatabaseSync(':memory:');
	try {
		database.exec(await readFile(new URL('../migrations/freesound-oauth/0002_audiocom.sql', import.meta.url), 'utf8'));
		database.prepare(`INSERT INTO audiocom_oauth_attempts
			(id, state_hash, pkce_verifier_ciphertext, handoff_hash, client_kind, status, created_at, expires_at)
			VALUES ('legacy', 'state', 'pkce', 'handoff', 'web', 'pending', ?, ?)`).run(NOW, NOW + 600_000);
		database.exec(await readFile(new URL('../migrations/freesound-oauth/0003_audiocom_provider_binding.sql', import.meta.url), 'utf8'));
		const repository = new D1AudiocomOAuthRepository(new SqliteD1Database(database));
		const legacy = await repository.findAttemptById('legacy');
		assert(legacy);
		assert.equal(Object.hasOwn(legacy, 'provider'), false);
		assert.equal(await repository.claimAttempt('legacy', NOW), true);
		await repository.completeAttempt('legacy', {
			id: 'legacy', user: { id: 'legacy', username: '' },
			accessTokenCiphertext: 'access', refreshTokenCiphertext: 'refresh', accessExpiresAt: NOW + 86_400_000,
		}, NOW);
		const grant = await repository.findGrant('legacy');
		assert(grant);
		assert.equal(Object.hasOwn(grant, 'provider'), false);
	} finally { database.close(); }
});

test('stored provider bindings reject malformed URLs, extra fields, and control characters', () => {
	assert.equal(parseStoredProviderBinding(null), undefined);
	assert.equal(parseStoredProviderBinding(undefined), undefined);
	assert.deepEqual(parseStoredProviderBinding(JSON.stringify(CUSTOM_PROVIDER)), CUSTOM_PROVIDER);
	assert.deepEqual(parseStoredProviderBinding({ ...CUSTOM_PROVIDER, apiOrigin: 'http://127.0.0.1:8091', redirectUri: 'http://localhost:4325/api/audiocom/oauth/callback' }), {
		...CUSTOM_PROVIDER, apiOrigin: 'http://127.0.0.1:8091', redirectUri: 'http://localhost:4325/api/audiocom/oauth/callback',
	});
	for (const invalid of [
		'not json', 'null', '{}', '[]',
		{ ...CUSTOM_PROVIDER, unexpected: 'field' },
		{ ...CUSTOM_PROVIDER, apiOrigin: 'https://audio.example.org/' },
		{ ...CUSTOM_PROVIDER, apiOrigin: 'https://user:password@audio.example.org' },
		{ ...CUSTOM_PROVIDER, apiOrigin: 'http://audio.example.org' },
		{ ...CUSTOM_PROVIDER, apiOrigin: 'https://audio.example.org/base' },
		{ ...CUSTOM_PROVIDER, apiOrigin: 'https://audio.example.org?query=1' },
		{ ...CUSTOM_PROVIDER, clientId: '' },
		{ ...CUSTOM_PROVIDER, clientId: 'client\nheader' },
		{ ...CUSTOM_PROVIDER, clientId: 'c'.repeat(257) },
		{ ...CUSTOM_PROVIDER, scope: 'all' },
		{ ...CUSTOM_PROVIDER, redirectUri: 'https://soundscaper.org/other' },
		{ ...CUSTOM_PROVIDER, redirectUri: 'https://soundscaper.org/api/audiocom/oauth/callback?query=1' },
		{ ...CUSTOM_PROVIDER, redirectUri: 'https://soundscaper.org/api/audiocom/oauth/callback#fragment' },
		{ ...CUSTOM_PROVIDER, redirectUri: 'https://soundscaper.org/api/audiocom/oauth/callback\n' },
	]) assert.throws(() => parseStoredProviderBinding(invalid), /provider binding/iu);
});

test('corrupt stored provider bindings stop authorization reads', async () => {
	const database = new DatabaseSync(':memory:');
	try {
		await migrate(database);
		const repository = new D1AudiocomOAuthRepository(new SqliteD1Database(database));
		await repository.createAttempt({ ...attempt('corrupt', 'state'), provider: CUSTOM_PROVIDER });
		database.prepare('UPDATE audiocom_oauth_attempts SET provider_binding = ? WHERE id = ?').run('{"apiOrigin":"https://evil.example.org"}', 'corrupt');
		await assert.rejects(repository.findAttemptById('corrupt'), /provider binding/iu);
	} finally { database.close(); }
});
