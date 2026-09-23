/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FreesoundOAuthRepository,
	OAuthAttemptRecord,
	OAuthGrantRecord,
	OAuthGrantWrite,
	OAuthSessionRecord,
} from '../../functions/api/freesound/_shared/oauth-repository.ts';

interface SessionRow {
	readonly tokenHash: string;
	readonly grantId: string;
	readonly clientKind: 'web' | 'desktop';
	readonly createdAt: number;
	expiresAt: number;
}

export class MemoryFreesoundOAuthRepository implements FreesoundOAuthRepository {
	public readonly attempts = new Map<string, OAuthAttemptRecord>();
	public readonly grants = new Map<string, OAuthGrantRecord>();
	public readonly sessions = new Map<string, SessionRow>();

	public cleanupExpired(now: number): Promise<void> {
		for (const [id, attempt] of this.attempts) {
			if (attempt.expiresAt <= now) this.attempts.delete(id);
		}
		for (const [tokenHash, session] of this.sessions) {
			if (session.expiresAt <= now) this.sessions.delete(tokenHash);
		}
		for (const grantId of this.grants.keys()) {
			if (![...this.sessions.values()].some((session) => session.grantId === grantId)
				&& ![...this.attempts.values()].some((attempt) => attempt.grantId === grantId)) {
				this.grants.delete(grantId);
			}
		}
		return Promise.resolve();
	}

	public createAttempt(attempt: OAuthAttemptRecord): Promise<void> {
		if (this.attempts.has(attempt.id)) return Promise.reject(new Error('Duplicate attempt.'));
		this.attempts.set(attempt.id, attempt);
		return Promise.resolve();
	}

	public findAttemptById(id: string): Promise<OAuthAttemptRecord | null> {
		return Promise.resolve(this.attempts.get(id) ?? null);
	}

	public findAttemptByStateHash(stateHash: string): Promise<OAuthAttemptRecord | null> {
		return Promise.resolve(
			[...this.attempts.values()].find((attempt) => attempt.stateHash === stateHash) ?? null,
		);
	}

	public claimAttempt(id: string, now: number): Promise<boolean> {
		const attempt = this.attempts.get(id);
		if (attempt === undefined || attempt.status !== 'pending' || attempt.expiresAt <= now) {
			return Promise.resolve(false);
		}
		this.attempts.set(id, { ...attempt, status: 'exchanging' });
		return Promise.resolve(true);
	}

	public completeAttempt(id: string, grant: OAuthGrantWrite): Promise<boolean> {
		const attempt = this.attempts.get(id);
		if (attempt === undefined || attempt.status !== 'exchanging') return Promise.resolve(false);
		const previous = this.grants.get(grant.id);
		this.grants.set(grant.id, {
			...grant,
			refreshGeneration: (previous?.refreshGeneration ?? -1) + 1,
			refreshLeaseOwner: null,
			refreshLeaseExpiresAt: null,
		});
		this.attempts.set(id, { ...attempt, status: 'connected', grantId: grant.id });
		return Promise.resolve(true);
	}

	public failAttempt(
		id: string,
		status: 'denied' | 'failed',
		errorCode: string,
	): Promise<void> {
		const attempt = this.attempts.get(id);
		if (attempt !== undefined && (attempt.status === 'pending' || attempt.status === 'exchanging')) {
			this.attempts.set(id, { ...attempt, status, errorCode });
		}
		return Promise.resolve();
	}

	public claimAttemptSession(id: string, tokenHash: string, tokenCiphertext: string): Promise<boolean> {
		const attempt = this.attempts.get(id);
		if (attempt === undefined || attempt.status !== 'connected' || attempt.sessionTokenHash !== null) {
			return Promise.resolve(false);
		}
		this.attempts.set(id, {
			...attempt,
			sessionTokenHash: tokenHash,
			sessionTokenCiphertext: tokenCiphertext,
		});
		return Promise.resolve(true);
	}

	public ensureSession(input: SessionRow): Promise<void> {
		if (!this.sessions.has(input.tokenHash)) this.sessions.set(input.tokenHash, { ...input });
		return Promise.resolve();
	}

	public findSession(tokenHash: string, now: number): Promise<OAuthSessionRecord | null> {
		const session = this.sessions.get(tokenHash);
		if (session === undefined || session.expiresAt <= now) return Promise.resolve(null);
		const grant = this.grants.get(session.grantId);
		if (grant === undefined) return Promise.resolve(null);
		return Promise.resolve({ ...session, grant });
	}

	public touchSession(tokenHash: string, _now: number, expiresAt: number): Promise<void> {
		const session = this.sessions.get(tokenHash);
		if (session !== undefined) session.expiresAt = expiresAt;
		return Promise.resolve();
	}

	public deleteSessionAndOrphanGrant(tokenHash: string): Promise<void> {
		const session = this.sessions.get(tokenHash);
		if (session === undefined) return Promise.resolve();
		this.sessions.delete(tokenHash);
		if (![...this.sessions.values()].some((candidate) => candidate.grantId === session.grantId)) {
			this.grants.delete(session.grantId);
			for (const [id, attempt] of this.attempts) {
				if (attempt.grantId === session.grantId) this.attempts.delete(id);
			}
		}
		return Promise.resolve();
	}

	public findGrant(id: string): Promise<OAuthGrantRecord | null> {
		return Promise.resolve(this.grants.get(id) ?? null);
	}

	public acquireRefreshLease(input: Readonly<{
		grantId: string;
		generation: number;
		owner: string;
		now: number;
		expiresAt: number;
	}>): Promise<boolean> {
		const grant = this.grants.get(input.grantId);
		if (grant === undefined || grant.refreshGeneration !== input.generation
			|| (grant.refreshLeaseExpiresAt !== null && grant.refreshLeaseExpiresAt > input.now)) {
			return Promise.resolve(false);
		}
		this.grants.set(input.grantId, {
			...grant,
			refreshLeaseOwner: input.owner,
			refreshLeaseExpiresAt: input.expiresAt,
		});
		return Promise.resolve(true);
	}

	public completeRefresh(input: Readonly<{
		grantId: string;
		generation: number;
		owner: string;
		accessTokenCiphertext: string;
		refreshTokenCiphertext: string;
		accessExpiresAt: number;
		now: number;
	}>): Promise<boolean> {
		const grant = this.grants.get(input.grantId);
		if (grant === undefined || grant.refreshGeneration !== input.generation
			|| grant.refreshLeaseOwner !== input.owner) return Promise.resolve(false);
		this.grants.set(input.grantId, {
			...grant,
			accessTokenCiphertext: input.accessTokenCiphertext,
			refreshTokenCiphertext: input.refreshTokenCiphertext,
			accessExpiresAt: input.accessExpiresAt,
			refreshGeneration: grant.refreshGeneration + 1,
			refreshLeaseOwner: null,
			refreshLeaseExpiresAt: null,
		});
		return Promise.resolve(true);
	}

	public releaseRefreshLease(grantId: string, generation: number, owner: string): Promise<void> {
		const grant = this.grants.get(grantId);
		if (grant !== undefined && grant.refreshGeneration === generation && grant.refreshLeaseOwner === owner) {
			this.grants.set(grantId, { ...grant, refreshLeaseOwner: null, refreshLeaseExpiresAt: null });
		}
		return Promise.resolve();
	}
}
