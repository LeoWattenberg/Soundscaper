/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AssistanceSemanticSearchSessionAuthority,
} from '../desktop/assistance-semantic-search-session-authority.ts';

test('main issues, admits, revokes, and expires exact project-bound search sessions', () => {
	let now = 1_800_000_000_000;
	let byte = 0xaa;
	const authority = new AssistanceSemanticSearchSessionAuthority({
		now: () => now,
		randomBytes: (size) => new Uint8Array(size).fill(byte++),
		defaultLifetimeMs: 60_000,
	});
	const session = authority.open({ projectId: 'project-1', projectRevision: 7 });
	assert.deepEqual(session, {
		sessionVersion: 1,
		sessionId: 'aa'.repeat(20),
		projectId: 'project-1',
		projectRevision: 7,
		expiresAtEpochMs: now + 60_000,
	});
	assert.deepEqual(authority.authorize(session, {
		projectId: 'project-1', projectRevision: 7,
	}), session);

	const revoked = authority.open({
		projectId: 'project-1', projectRevision: 7, lifetimeMs: 1_000,
	});
	assert.equal(authority.revoke(revoked.sessionId), true);
	assert.equal(authority.revoke(revoked.sessionId), false);
	assert.throws(() => authority.authorize(revoked, {
		projectId: 'project-1', projectRevision: 7,
	}), /revoked|active|session/iu);

	now = session.expiresAtEpochMs;
	assert.throws(() => authority.authorize(session, {
		projectId: 'project-1', projectRevision: 7,
	}), /expired/iu);
});

test('revision changes invalidate an issued bearer and project revocation is isolated', () => {
	let byte = 0xbb;
	const authority = new AssistanceSemanticSearchSessionAuthority({
		now: () => 1_800_000_000_000,
		randomBytes: (size) => new Uint8Array(size).fill(byte++),
	});
	const stale = authority.open({ projectId: 'project-1', projectRevision: 7 });
	assert.throws(() => authority.authorize(stale, {
		projectId: 'project-1', projectRevision: 8,
	}), /project|revision|stale/iu);
	assert.throws(() => authority.authorize(stale, {
		projectId: 'project-1', projectRevision: 7,
	}), /active|revoked|session/iu);

	const first = authority.open({ projectId: 'project-1', projectRevision: 8 });
	const second = authority.open({ projectId: 'project-2', projectRevision: 3 });
	assert.equal(authority.revokeProject('project-1'), 1);
	assert.throws(() => authority.authorize(first, {
		projectId: 'project-1', projectRevision: 8,
	}), /active|revoked|session/iu);
	assert.deepEqual(authority.authorize(second, {
		projectId: 'project-2', projectRevision: 3,
	}), second);
});

test('session authority rejects malformed opening bounds and forged bearer fields', () => {
	const authority = new AssistanceSemanticSearchSessionAuthority({
		now: () => 1_800_000_000_000,
		randomBytes: (size) => new Uint8Array(size).fill(0xcc),
	});
	assert.throws(() => authority.open({ projectId: '../escape', projectRevision: 1 }));
	assert.throws(() => authority.open({
		projectId: 'project-1', projectRevision: 1, lifetimeMs: 60 * 60 * 1_000 + 1,
	}), /lifetime|bound/iu);
	const session = authority.open({ projectId: 'project-1', projectRevision: 1 });
	assert.throws(() => authority.authorize({ ...session, expiresAtEpochMs: session.expiresAtEpochMs - 1 }, {
		projectId: 'project-1', projectRevision: 1,
	}), /active|bearer|session/iu);
});
