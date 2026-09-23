-- SPDX-License-Identifier: AGPL-3.0-only

PRAGMA foreign_keys = ON;

CREATE TABLE freesound_oauth_grants (
	id TEXT PRIMARY KEY,
	freesound_user_id INTEGER NOT NULL UNIQUE,
	username TEXT NOT NULL,
	access_token_ciphertext TEXT NOT NULL,
	refresh_token_ciphertext TEXT NOT NULL,
	access_expires_at INTEGER NOT NULL,
	authorization_started_at INTEGER NOT NULL,
	refresh_generation INTEGER NOT NULL DEFAULT 0,
	refresh_lease_owner TEXT,
	refresh_lease_expires_at INTEGER,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE freesound_oauth_attempts (
	id TEXT PRIMARY KEY,
	state_hash TEXT NOT NULL UNIQUE,
	handoff_hash TEXT NOT NULL,
	client_kind TEXT NOT NULL CHECK (client_kind IN ('web', 'desktop')),
	status TEXT NOT NULL CHECK (status IN ('pending', 'exchanging', 'connected', 'denied', 'failed')),
	grant_id TEXT REFERENCES freesound_oauth_grants(id) ON DELETE CASCADE,
	error_code TEXT,
	session_token_hash TEXT,
	session_token_ciphertext TEXT,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	completed_at INTEGER
);

CREATE INDEX freesound_oauth_attempts_expiry_idx
	ON freesound_oauth_attempts(expires_at);

CREATE TABLE freesound_oauth_sessions (
	token_hash TEXT PRIMARY KEY,
	grant_id TEXT NOT NULL REFERENCES freesound_oauth_grants(id) ON DELETE CASCADE,
	client_kind TEXT NOT NULL CHECK (client_kind IN ('web', 'desktop')),
	created_at INTEGER NOT NULL,
	last_seen_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL
);

CREATE INDEX freesound_oauth_sessions_grant_idx
	ON freesound_oauth_sessions(grant_id);

CREATE INDEX freesound_oauth_sessions_expiry_idx
	ON freesound_oauth_sessions(expires_at);
