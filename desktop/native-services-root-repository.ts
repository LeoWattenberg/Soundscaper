/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join, normalize } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { assertNativeMediaRelativeDestination } from '../src/common/editor/native-media-atomic-publication.ts';
import {
	assertFramescaperNativeServicesWriterLease,
	type FramescaperNativeServicesLease,
} from './native-services-database.ts';

const OPAQUE_ID = /^[a-f0-9]{16,64}$/u;
const MAXIMUM_IDENTITY_LENGTH = 1_024;

export interface FramescaperNativeRootGrant {
	readonly grantId: string;
	readonly rootPath: string;
	readonly volumeIdentity: string;
	readonly directoryIdentity: string;
	readonly authorizedAtMs: number;
	readonly revokedAtMs: number | null;
}

export interface FramescaperNativeRootSelection {
	readonly grantId: string;
	readonly rootPath: string;
	readonly volumeIdentity: string;
	readonly directoryIdentity: string;
	readonly authorizedAtMs: number;
}

export interface FramescaperNativeRootObservation {
	readonly exists: boolean;
	readonly directory: boolean;
	readonly symbolicLink: boolean;
	readonly canonicalPath: string;
	readonly volumeIdentity: string;
	readonly directoryIdentity: string;
}

export type FramescaperNativeRootProbe = (
	grant: FramescaperNativeRootGrant,
) => Promise<FramescaperNativeRootObservation>;

export class FramescaperNativeRootRepository {
	readonly #database: DatabaseSync;

	constructor(database: DatabaseSync) {
		this.#database = database;
	}

	authorize(
		selection: FramescaperNativeRootSelection,
		lease: FramescaperNativeServicesLease,
		nowMs: number,
	): FramescaperNativeRootGrant {
		const grant = admitFramescaperNativeRootSelection(selection);
		return this.#mutation(lease, nowMs, () => {
			const existing = this.read(grant.grantId);
			if (existing !== null) {
				if (!sameGrant(existing, grant)) {
					throw new Error('A native durable-root grant id already names a different directory identity.');
				}
				if (existing.revokedAtMs !== null) {
					throw new Error('A revoked native durable-root grant id cannot be reused.');
				}
				return existing;
			}
			this.#database.prepare(`
				INSERT INTO durable_root_grants (
					grant_id, root_path, volume_identity, directory_identity, authorized_at_ms, revoked_at_ms
				) VALUES (?, ?, ?, ?, ?, NULL)
			`).run(
				grant.grantId, grant.rootPath, grant.volumeIdentity,
				grant.directoryIdentity, grant.authorizedAtMs,
			);
			return Object.freeze({ ...grant, revokedAtMs: null });
		});
	}

	read(grantId: string): FramescaperNativeRootGrant | null {
		const id = opaqueId(grantId, 'grant id');
		const row = this.#database.prepare(
			'SELECT * FROM durable_root_grants WHERE grant_id = ?',
		).get(id) as Record<string, unknown> | undefined;
		return row ? decodeGrant(row) : null;
	}

	list(): readonly FramescaperNativeRootGrant[] {
		const rows = this.#database.prepare(`
			SELECT * FROM durable_root_grants ORDER BY authorized_at_ms, grant_id
		`).all() as Record<string, unknown>[];
		return Object.freeze(rows.map(decodeGrant));
	}

	revoke(
		grantId: string,
		revokedAtMs: number,
		lease: FramescaperNativeServicesLease,
	): boolean {
		const id = opaqueId(grantId, 'grant id');
		const atMs = timestamp(revokedAtMs, 'revocation time');
		return this.#mutation(lease, atMs, () => {
			const grant = this.read(id);
			if (grant === null) return false;
			if (atMs < grant.authorizedAtMs) {
				throw new RangeError('A native durable-root grant cannot be revoked before it was authorized.');
			}
			if (grant.revokedAtMs !== null) {
				this.#database.prepare(
					'UPDATE watch_rules SET enabled = 0 WHERE grant_id = ? AND enabled = 1',
				).run(id);
				return grant.revokedAtMs === atMs;
			}
			const revoked = this.#database.prepare(`
				UPDATE durable_root_grants SET revoked_at_ms = ?
				WHERE grant_id = ? AND revoked_at_ms IS NULL
			`).run(atMs, id).changes === 1;
			if (!revoked) return false;
			// A watcher may never retain authority after its owning root is revoked.
			this.#database.prepare(
				'UPDATE watch_rules SET enabled = 0 WHERE grant_id = ? AND enabled = 1',
			).run(id);
			return true;
		});
	}

	async revalidate(grantId: string, probe: FramescaperNativeRootProbe): Promise<boolean> {
		const grant = this.requireActive(grantId);
		const observed = await probe(grant);
		return observed.exists
			&& observed.directory
			&& !observed.symbolicLink
			&& canonicalPath(observed.canonicalPath) === grant.rootPath
			&& identity(observed.volumeIdentity, 'observed volume identity') === grant.volumeIdentity
			&& identity(observed.directoryIdentity, 'observed directory identity') === grant.directoryIdentity;
	}

	resolveDestination(grantId: string, relativeDestination: unknown): string {
		const grant = this.requireActive(grantId);
		const relative = assertNativeMediaRelativeDestination(relativeDestination);
		return join(grant.rootPath, ...relative.split('/'));
	}

	requireActive(grantId: string): FramescaperNativeRootGrant {
		const grant = this.read(grantId);
		if (grant === null) throw new Error('The native durable-root grant does not exist.');
		if (grant.revokedAtMs !== null) throw new Error('The native durable-root grant was revoked.');
		return grant;
	}

	#mutation<Result>(
		lease: FramescaperNativeServicesLease,
		nowMs: number,
		operation: () => Result,
	): Result {
		this.#database.exec('BEGIN IMMEDIATE');
		try {
			assertFramescaperNativeServicesWriterLease(this.#database, lease, nowMs);
			const result = operation();
			this.#database.exec('COMMIT');
			return result;
		} catch (error) {
			this.#database.exec('ROLLBACK');
			throw error;
		}
	}
}

export function admitFramescaperNativeRootSelection(
	selection: FramescaperNativeRootSelection,
): FramescaperNativeRootSelection {
	return Object.freeze({
		grantId: opaqueId(selection.grantId, 'grant id'),
		rootPath: canonicalPath(selection.rootPath),
		volumeIdentity: identity(selection.volumeIdentity, 'volume identity'),
		directoryIdentity: identity(selection.directoryIdentity, 'directory identity'),
		authorizedAtMs: timestamp(selection.authorizedAtMs, 'authorization time'),
	});
}

function decodeGrant(row: Record<string, unknown>): FramescaperNativeRootGrant {
	const authorizedAtMs = timestamp(row.authorized_at_ms, 'stored authorization time');
	const revokedAtMs = row.revoked_at_ms === null
		? null
		: timestamp(row.revoked_at_ms, 'stored revocation time');
	if (revokedAtMs !== null && revokedAtMs < authorizedAtMs) {
		throw new Error('A stored native durable-root grant has an invalid revocation time.');
	}
	return Object.freeze({
		grantId: opaqueId(row.grant_id, 'stored grant id'),
		rootPath: canonicalPath(row.root_path),
		volumeIdentity: identity(row.volume_identity, 'stored volume identity'),
		directoryIdentity: identity(row.directory_identity, 'stored directory identity'),
		authorizedAtMs,
		revokedAtMs,
	});
}

function sameGrant(
	current: FramescaperNativeRootGrant,
	incoming: FramescaperNativeRootSelection,
): boolean {
	return current.rootPath === incoming.rootPath
		&& current.volumeIdentity === incoming.volumeIdentity
		&& current.directoryIdentity === incoming.directoryIdentity
		&& current.authorizedAtMs === incoming.authorizedAtMs;
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
		throw new TypeError(`A native durable-root ${label} must be a bounded opaque identifier.`);
	}
	return value;
}

function canonicalPath(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 32_768
		|| value.includes('\0') || !isAbsolute(value)) {
		throw new TypeError('A native durable root must be an absolute canonical path.');
	}
	const canonical = normalize(value);
	if (canonical !== value) {
		throw new TypeError('A native durable root must already be in canonical path form.');
	}
	return canonical;
}

function identity(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0
		|| value.length > MAXIMUM_IDENTITY_LENGTH || value.includes('\0')) {
		throw new TypeError(`A native durable-root ${label} is invalid.`);
	}
	return value;
}

function timestamp(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new RangeError(`A native durable-root ${label} must be a non-negative safe integer.`);
	}
	return value as number;
}
