/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';

import {
	computeNativeScratchQuota,
	nativeScratchDirectoryIsDeletable,
	nativeScratchReservationFits,
	nativeScratchRetention,
	type NativeScratchDirectoryClaimV1,
	type NativeScratchOutcome,
} from '../src/common/editor/native-scratch-policy.ts';
import {
	assertFramescaperNativeServicesWriterLease,
	type FramescaperNativeServicesLease,
} from './native-services-database.ts';
import { FramescaperNativeQueueRepository } from './native-services-queue-repository.ts';

const SHA256 = /^[a-f0-9]{64}$/u;
const DIRECTORY = /^job-[a-f0-9]{40}$/u;

export type FramescaperNativeScratchState = 'reserved' | 'released' | 'retained';

export interface FramescaperNativeScratchReservation {
	readonly jobId: string;
	readonly directoryName: string;
	readonly manifestDigest: string;
	readonly rootIdentity: string;
	readonly reservedBytes: number;
	readonly state: FramescaperNativeScratchState;
	readonly createdAtMs: number;
	readonly expiresAtMs: number | null;
}

export interface FramescaperNativeScratchVolume {
	readonly totalBytes: number;
	readonly freeBytes: number;
	readonly userCapBytes?: number;
}

export interface FramescaperNativeScratchReservationRequest {
	readonly jobId: string;
	readonly directoryName: string;
	readonly manifestDigest: string;
	readonly rootIdentity: string;
	readonly requestedBytes: number;
	readonly createdAtMs: number;
	readonly volume: FramescaperNativeScratchVolume;
}

export interface FramescaperNativeScratchCleanupPort {
	readonly inspect: (
		directoryName: string,
	) => Promise<Partial<NativeScratchDirectoryClaimV1> | null>;
	readonly remove: (directoryName: string) => Promise<void>;
}

export class FramescaperNativeScratchRepository {
	readonly #database: DatabaseSync;

	constructor(database: DatabaseSync) {
		this.#database = database;
	}

	reserve(
		request: FramescaperNativeScratchReservationRequest,
		lease: FramescaperNativeServicesLease,
		nowMs: number,
	): FramescaperNativeScratchReservation {
		const jobId = jobIdValue(request.jobId);
		const directoryName = directory(request.directoryName, jobId);
		const manifestDigest = digest(request.manifestDigest);
		const rootIdentity = identity(request.rootIdentity);
		const requestedBytes = byteCount(request.requestedBytes, 'requested bytes');
		const createdAtMs = timestamp(request.createdAtMs, 'creation time');
		const reservation: FramescaperNativeScratchReservation = Object.freeze({
			jobId, directoryName, manifestDigest, rootIdentity, reservedBytes: requestedBytes,
			state: 'reserved', createdAtMs, expiresAtMs: null,
		});
		return this.#mutation(lease, nowMs, () => {
			const job = new FramescaperNativeQueueRepository(this.#database).read(jobId);
			if (job === null) throw new Error('A native scratch reservation requires an existing queue job.');
			if (job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled') {
				throw new Error('A settled native queue job cannot reserve new scratch.');
			}
			if (requestedBytes > job.reservations.scratchBytes) {
				throw new RangeError('A native scratch request exceeds its queue job reservation.');
			}
			const existing = this.read(jobId);
			if (existing !== null) assertExactRetryReservation(existing, reservation);
			const creditedBytes = existing !== null
				&& (existing.state === 'reserved' || existing.state === 'retained')
				? existing.reservedBytes : 0;
			const managedBytes = this.#managedBytes() - creditedBytes;
			const quota = computeNativeScratchQuota({
				totalBytes: request.volume.totalBytes,
				freeBytes: request.volume.freeBytes,
				managedBytes,
				...(request.volume.userCapBytes === undefined
					? {} : { userCapBytes: request.volume.userCapBytes }),
			});
			if (!nativeScratchReservationFits(quota, requestedBytes)) {
				throw new RangeError('A native scratch request exceeds the current volume quota.');
			}
			if (existing !== null) {
				const result = this.#database.prepare(`
					UPDATE scratch_reservations SET state = 'reserved', created_at_ms = ?, expires_at_ms = NULL
					WHERE job_id = ? AND directory_name = ? AND manifest_digest = ?
						AND root_identity = ? AND reserved_bytes = ? AND state = ?
						AND created_at_ms = ? AND expires_at_ms IS ?
				`).run(
					createdAtMs, jobId, directoryName, manifestDigest, rootIdentity,
					requestedBytes, existing.state, existing.createdAtMs, existing.expiresAtMs,
				);
				if (result.changes !== 1) {
					throw new Error('The native scratch retry lost its durable reservation fence.');
				}
				return reservation;
			}
			this.#database.prepare(`
				INSERT INTO scratch_reservations (
					job_id, directory_name, manifest_digest, root_identity,
					reserved_bytes, state, created_at_ms, expires_at_ms
				) VALUES (?, ?, ?, ?, ?, 'reserved', ?, NULL)
			`).run(
				jobId, directoryName, manifestDigest, rootIdentity, requestedBytes, createdAtMs,
			);
			return reservation;
		});
	}

	read(jobId: string): FramescaperNativeScratchReservation | null {
		const row = this.#database.prepare(
			'SELECT * FROM scratch_reservations WHERE job_id = ?',
		).get(jobIdValue(jobId)) as Record<string, unknown> | undefined;
		return row ? decodeReservation(row) : null;
	}

	list(): readonly FramescaperNativeScratchReservation[] {
		const rows = this.#database.prepare(`
			SELECT * FROM scratch_reservations ORDER BY created_at_ms, job_id
		`).all() as Record<string, unknown>[];
		return Object.freeze(rows.map(decodeReservation));
	}

	async settle(
		jobId: string,
		outcome: NativeScratchOutcome,
		settledAtMs: number,
		cleanup: FramescaperNativeScratchCleanupPort,
		lease: FramescaperNativeServicesLease,
	): Promise<FramescaperNativeScratchState> {
		const current = this.read(jobId);
		if (current === null) throw new Error('The native scratch reservation does not exist.');
		if (current.state === 'released') return 'released';
		const atMs = timestamp(settledAtMs, 'settlement time');
		const retention = nativeScratchRetention(outcome, atMs);
		if (!retention.removeImmediately) {
			this.#setState(current, 'retained', retention.retainUntilMs, lease, atMs);
			return 'retained';
		}
		const observed = await cleanup.inspect(current.directoryName);
		if (!nativeScratchDirectoryIsDeletable(current, observed)) {
			this.#setState(current, 'retained', null, lease, atMs);
			return 'retained';
		}
		await cleanup.remove(current.directoryName);
		this.#setState(current, 'released', null, lease, atMs);
		return 'released';
	}

	async cleanupExpired(
		nowMs: number,
		cleanup: FramescaperNativeScratchCleanupPort,
		lease: FramescaperNativeServicesLease,
	): Promise<readonly string[]> {
		const atMs = timestamp(nowMs, 'cleanup time');
		const released: string[] = [];
		for (const current of this.list()) {
			if (current.state !== 'retained' || current.expiresAtMs === null || current.expiresAtMs > atMs) continue;
			const observed = await cleanup.inspect(current.directoryName);
			if (!nativeScratchDirectoryIsDeletable(current, observed)) continue;
			await cleanup.remove(current.directoryName);
			this.#setState(current, 'released', null, lease, atMs);
			released.push(current.jobId);
		}
		return Object.freeze(released);
	}

	/**
	 * Settle physical scratch before its owning terminal queue row is removed.
	 * A missing or mismatched manifest blocks metadata removal, preserving the
	 * only durable identity that could later authorize safe cleanup.
	 */
	async removeForQueueRemoval(
		jobId: string,
		cleanup: FramescaperNativeScratchCleanupPort,
		lease: FramescaperNativeServicesLease,
		nowMs: number,
	): Promise<void> {
		const current = this.read(jobId);
		if (current === null || current.state === 'released') return;
		const atMs = timestamp(nowMs, 'queue-removal time');
		const observed = await cleanup.inspect(current.directoryName);
		if (!nativeScratchDirectoryIsDeletable(current, observed)) {
			throw new Error('Native queue removal refuses unauthenticated physical scratch.');
		}
		await cleanup.remove(current.directoryName);
		this.#setState(current, 'released', null, lease, atMs);
	}

	#setState(
		current: FramescaperNativeScratchReservation,
		state: FramescaperNativeScratchState,
		expiresAtMs: number | null,
		lease: FramescaperNativeServicesLease,
		nowMs: number,
	): void {
		this.#mutation(lease, nowMs, () => {
			const result = this.#database.prepare(`
				UPDATE scratch_reservations SET state = ?, expires_at_ms = ?
				WHERE job_id = ? AND state = ? AND manifest_digest = ? AND root_identity = ?
			`).run(
				state, expiresAtMs, current.jobId, current.state,
				current.manifestDigest, current.rootIdentity,
			);
			if (result.changes !== 1) throw new Error('The native scratch reservation lost its durable fence.');
		});
	}

	#managedBytes(): number {
		const row = this.#database.prepare(`
			SELECT COALESCE(SUM(reserved_bytes), 0) AS bytes
			FROM scratch_reservations WHERE state IN ('reserved', 'retained')
		`).get() as Record<string, unknown>;
		return byteCount(Number(row.bytes), 'managed bytes');
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

function assertExactRetryReservation(
	current: FramescaperNativeScratchReservation,
	next: FramescaperNativeScratchReservation,
): void {
	if (current.directoryName !== next.directoryName
		|| current.manifestDigest !== next.manifestDigest
		|| current.rootIdentity !== next.rootIdentity
		|| current.reservedBytes !== next.reservedBytes) {
		throw new Error('A native scratch retry changed its authenticated manifest or reservation identity.');
	}
	if (next.createdAtMs < current.createdAtMs) {
		throw new Error('A native scratch retry cannot predate its durable reservation.');
	}
}

function decodeReservation(row: Record<string, unknown>): FramescaperNativeScratchReservation {
	const jobId = jobIdValue(row.job_id);
	const state = row.state;
	if (state !== 'reserved' && state !== 'released' && state !== 'retained') {
		throw new TypeError('A stored native scratch reservation has an invalid state.');
	}
	return Object.freeze({
		jobId,
		directoryName: directory(row.directory_name, jobId),
		manifestDigest: digest(row.manifest_digest),
		rootIdentity: identity(row.root_identity),
		reservedBytes: byteCount(row.reserved_bytes, 'stored reservation bytes'),
		state,
		createdAtMs: timestamp(row.created_at_ms, 'stored creation time'),
		expiresAtMs: row.expires_at_ms === null ? null : timestamp(row.expires_at_ms, 'stored expiry time'),
	});
}

function jobIdValue(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{40}$/u.test(value)) {
		throw new TypeError('A native scratch reservation requires an exact job id.');
	}
	return value;
}

function directory(value: unknown, jobId: string): string {
	if (typeof value !== 'string' || !DIRECTORY.test(value) || value !== `job-${jobId}`) {
		throw new TypeError('A native scratch directory must be the deterministic name for its job.');
	}
	return value;
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError('A native scratch reservation requires an exact manifest digest.');
	}
	return value;
}

function identity(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value.includes('\0')) {
		throw new TypeError('A native scratch reservation requires a bounded root identity.');
	}
	return value;
}

function byteCount(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new RangeError(`Native scratch ${label} must be a non-negative safe integer.`);
	}
	return value as number;
}

function timestamp(value: unknown, label: string): number {
	return byteCount(value, label);
}
