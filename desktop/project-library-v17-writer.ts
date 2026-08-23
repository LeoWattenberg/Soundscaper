/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { DatabaseSync } from 'node:sqlite';

import type {
	FramescaperDesktopProjectLibraryExactGenerationExtension,
	FramescaperDesktopProjectLibraryExactGenerationLifecycle,
	FramescaperDesktopProjectLibraryExactPublicationDeclaration,
	FramescaperDesktopProjectLibraryPublicationCheckpoint,
} from './project-library-exact-generation-lifecycle.ts';
import { initializeFramescaperDesktopProjectLibraryV17LifecycleDatabase } from './project-library-v17-database.ts';
import { importFramescaperDesktopProjectLibraryV12IntoV17 } from './project-library-v17-import.ts';

const PRODUCTION_LEASE_TTL_MS = 30_000;
const PRODUCTION_RENEW_INTERVAL_MS = 10_000;

export interface FramescaperDesktopProjectLibraryV17Qualification {
	readonly leaseTtlMs: number;
	readonly renewIntervalMs: number;
	readonly checkpoint: ((phase: FramescaperDesktopProjectLibraryPublicationCheckpoint) => void) | null;
	readonly importCheckpoint: ((completedProjects: number) => void) | null;
}

export interface FramescaperDesktopProjectLibraryV17WriterSnapshot {
	readonly leaseId: string;
	readonly fencingToken: number;
	readonly tookOverStaleLease: boolean;
	readonly recovery: Readonly<{
		outcome: 'clean' | 'committed' | 'discarded';
		publishedRevision: number | null;
	}>;
}

interface Lease {
	readonly leaseId: string;
	readonly fencingToken: number;
	readonly tookOverStaleLease: boolean;
	readonly expiresAtMs: number;
}

interface WriterOptions {
	readonly onLeaseLost: (error: unknown) => void;
	readonly qualification: Readonly<FramescaperDesktopProjectLibraryV17Qualification> | null;
}

export function createFramescaperDesktopProjectLibraryV17Extension(
	options: Readonly<WriterOptions>,
): FramescaperDesktopProjectLibraryExactGenerationExtension {
	const timing = timingOptions(options.qualification);
	return Object.freeze({
		async start(context: Parameters<FramescaperDesktopProjectLibraryExactGenerationExtension['start']>[0]) {
			initializeFramescaperDesktopProjectLibraryV17LifecycleDatabase(context.database);
			const writer = await FramescaperDesktopProjectLibraryV17Writer.acquire({
				...context,
				onLeaseLost: options.onLeaseLost,
				leaseTtlMs: timing.leaseTtlMs,
				renewIntervalMs: timing.renewIntervalMs,
				checkpoint: options.qualification?.checkpoint ?? null,
			});
			try {
				await writer.recover();
				await importFramescaperDesktopProjectLibraryV12IntoV17({
					appDataPath: context.appDataPath,
					database: context.database,
					destinationPaths: context.paths,
					assertLeaseInTransaction: (database) => writer.assertLeaseInTransaction(database),
					checkpoint: options.qualification?.importCheckpoint ?? null,
				});
				return writer;
			} catch (error) {
				try { await writer.close(); }
				catch (cleanupError) {
					throw new AggregateError([error, cleanupError], 'Framescaper V17 startup cleanup failed');
				}
				throw error;
			}
		},
	});
}

class FramescaperDesktopProjectLibraryV17Writer implements FramescaperDesktopProjectLibraryExactGenerationLifecycle {
	readonly #database: DatabaseSync;
	readonly #projectsRoot: string;
	readonly #onLeaseLost: (error: unknown) => void;
	readonly #leaseTtlMs: number;
	readonly #renewIntervalMs: number;
	readonly #checkpoint: ((phase: FramescaperDesktopProjectLibraryPublicationCheckpoint) => void) | null;
	#lease: Readonly<Lease>;
	#renewTimer: ReturnType<typeof setInterval> | null = null;
	#closed = false;
	#fenced: unknown = null;
	#activePublicationId: string | null = null;
	#recovery: FramescaperDesktopProjectLibraryV17WriterSnapshot['recovery'] = Object.freeze({
		outcome: 'clean', publishedRevision: null,
	});

	private constructor(value: Readonly<{
		database: DatabaseSync;
		projectsRoot: string;
		lease: Readonly<Lease>;
		onLeaseLost: (error: unknown) => void;
		leaseTtlMs: number;
		renewIntervalMs: number;
		checkpoint: ((phase: FramescaperDesktopProjectLibraryPublicationCheckpoint) => void) | null;
	}>) {
		this.#database = value.database;
		this.#projectsRoot = value.projectsRoot;
		this.#lease = value.lease;
		this.#onLeaseLost = value.onLeaseLost;
		this.#leaseTtlMs = value.leaseTtlMs;
		this.#renewIntervalMs = value.renewIntervalMs;
		this.#checkpoint = value.checkpoint;
		this.#renewTimer = setInterval(() => { this.#renew(); }, this.#renewIntervalMs);
		this.#renewTimer.unref?.();
	}

	static async acquire(value: Readonly<{
		database: DatabaseSync;
		paths: Readonly<{ projectsRoot: string }>;
		owner: Readonly<Record<string, unknown>>;
		onLeaseLost: (error: unknown) => void;
		leaseTtlMs: number;
		renewIntervalMs: number;
		checkpoint: ((phase: FramescaperDesktopProjectLibraryPublicationCheckpoint) => void) | null;
	}>): Promise<FramescaperDesktopProjectLibraryV17Writer> {
		const deadline = Date.now() + value.leaseTtlMs + 1_000;
		let lease: Readonly<Lease> | null = null;
		while (!lease) {
			const attempt = acquireLease(value.database, value.owner, value.leaseTtlMs);
			if (attempt.lease) lease = attempt.lease;
			else {
				const remaining = deadline - Date.now();
				if (remaining <= 0) throw new Error('Framescaper desktop V17 writer lease is busy');
				await delay(Math.min(remaining, Math.max(10, attempt.retryAtMs - Date.now() + 1)));
			}
		}
		return new FramescaperDesktopProjectLibraryV17Writer({
			database: value.database,
			projectsRoot: value.paths.projectsRoot,
			lease,
			onLeaseLost: value.onLeaseLost,
			leaseTtlMs: value.leaseTtlMs,
			renewIntervalMs: value.renewIntervalMs,
			checkpoint: value.checkpoint,
		});
	}

	assertCanUse(): void {
		if (this.#closed) throw new Error('Framescaper desktop V17 writer is closed');
		if (this.#fenced !== null) throw new Error('Framescaper desktop V17 writer is fenced', { cause: this.#fenced });
		if (Date.now() >= this.#lease.expiresAtMs) {
			const error = new Error('Framescaper desktop V17 writer lease expired before renewal');
			this.#fence(error);
			throw error;
		}
	}

	snapshot(): Readonly<{ fenced: boolean; writer: Readonly<FramescaperDesktopProjectLibraryV17WriterSnapshot> }> {
		return Object.freeze({
			fenced: this.#fenced !== null,
			writer: Object.freeze({
				leaseId: this.#lease.leaseId,
				fencingToken: this.#lease.fencingToken,
				tookOverStaleLease: this.#lease.tookOverStaleLease,
				recovery: this.#recovery,
			}),
		});
	}

	assertLeaseInTransaction(database: DatabaseSync): void {
		this.assertCanUse();
		if (database !== this.#database) throw new Error('Framescaper V17 lease checked against another database');
		const row = database.prepare(`
			SELECT active, lease_id AS leaseId, fencing_token AS fencingToken,
				expires_at_ms AS expiresAtMs FROM library_lease WHERE singleton = 1
		`).get() as Record<string, unknown> | undefined;
		if (row?.active !== 1 || row.leaseId !== this.#lease.leaseId
			|| row.fencingToken !== this.#lease.fencingToken
			|| !Number.isSafeInteger(row.expiresAtMs) || Number(row.expiresAtMs) <= Date.now()) {
			const error = new Error('Framescaper V17 publication writer lease no longer owns its fence');
			this.#fence(error);
			throw error;
		}
	}

	async preparePublication(value: Readonly<FramescaperDesktopProjectLibraryExactPublicationDeclaration>): Promise<void> {
		this.assertCanUse();
		if (this.#activePublicationId !== null && this.#activePublicationId !== value.publicationId) {
			throw new Error('Framescaper V17 already owns an active publication');
		}
		this.#transaction(() => {
			this.assertLeaseInTransaction(this.#database);
			this.#database.prepare(`
				INSERT INTO publication_journal (
					publication_id, state, project_id, project_revision, project_sha256,
					document_file, expected_metadata_revision, result_json,
					lease_id, fencing_token, created_at_ms, updated_at_ms
				) VALUES (?, 'prepared', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
			`).run(
				value.publicationId, value.projectId, value.projectRevision, value.projectSha256,
				value.documentFile, value.expectedMetadataRevision,
				this.#lease.leaseId, this.#lease.fencingToken, Date.now(), Date.now(),
			);
		});
		this.#activePublicationId = value.publicationId;
		this.#checkpoint?.('prepared');
	}

	async publicationMaterialized(value: Readonly<FramescaperDesktopProjectLibraryExactPublicationDeclaration>): Promise<void> {
		this.#updateJournal(value.publicationId, 'prepared', 'materialized', null);
		this.#checkpoint?.('materialized');
	}

	assertCanCommit(
		database: DatabaseSync,
		value: Readonly<FramescaperDesktopProjectLibraryExactPublicationDeclaration>,
	): void {
		this.assertLeaseInTransaction(database);
		const row = database.prepare(`
			SELECT state, lease_id AS leaseId, fencing_token AS fencingToken
			FROM publication_journal WHERE publication_id = ?
		`).get(value.publicationId) as Record<string, unknown> | undefined;
		if (row?.state !== 'materialized' || row.leaseId !== this.#lease.leaseId
			|| row.fencingToken !== this.#lease.fencingToken) {
			throw new Error('Framescaper V17 publication journal no longer owns its fence');
		}
	}

	async publicationCommitted(
		value: Readonly<FramescaperDesktopProjectLibraryExactPublicationDeclaration>,
		result: unknown,
	): Promise<void> {
		this.#updateJournal(value.publicationId, 'materialized', 'committed', JSON.stringify(result));
		this.#checkpoint?.('committed');
	}

	async publicationComplete(value: Readonly<FramescaperDesktopProjectLibraryExactPublicationDeclaration>): Promise<void> {
		this.#transaction(() => {
			this.assertLeaseInTransaction(this.#database);
			if (this.#database.prepare(`
				DELETE FROM publication_journal
				WHERE publication_id = ? AND state = 'committed' AND lease_id = ? AND fencing_token = ?
			`).run(value.publicationId, this.#lease.leaseId, this.#lease.fencingToken).changes !== 1) {
				throw new Error('Framescaper V17 publication journal could not complete');
			}
		});
		this.#activePublicationId = null;
		this.#checkpoint?.('complete');
	}

	async abortPublication(publicationId: string): Promise<void> {
		const row = this.#database.prepare(`
			SELECT state, document_file AS documentFile FROM publication_journal WHERE publication_id = ?
		`).get(publicationId) as Record<string, unknown> | undefined;
		if (!row || row.state === 'committed') return;
		this.#transaction(() => {
			this.assertLeaseInTransaction(this.#database);
			this.#database.prepare(`
				DELETE FROM publication_journal WHERE publication_id = ? AND state IN ('prepared', 'materialized')
			`).run(publicationId);
		});
		this.#activePublicationId = null;
		if (row.state === 'materialized' && typeof row.documentFile === 'string') {
			const path = containedDocument(this.#projectsRoot, row.documentFile);
			const referenced = this.#database.prepare('SELECT 1 FROM projects WHERE document_file = ?').get(row.documentFile);
			if (!referenced) await rm(path, { force: true });
		}
	}

	async recover(): Promise<void> {
		const rows = this.#database.prepare(`
			SELECT publication_id AS publicationId, state, project_id AS projectId,
				project_revision AS projectRevision, project_sha256 AS projectSha256,
				document_file AS documentFile
			FROM publication_journal ORDER BY created_at_ms ASC
		`).all() as Record<string, unknown>[];
		if (rows.length > 1) throw new Error('Framescaper V17 has conflicting publication recovery journals');
		if (!rows[0]) return;
		const journal = rows[0];
		const publicationId = sqlText(journal.publicationId, 'recovery publication id');
		const projectId = sqlText(journal.projectId, 'recovery project id');
		const projectRevision = sqlNonNegative(journal.projectRevision, 'recovery project revision');
		const projectSha256 = sqlText(journal.projectSha256, 'recovery project digest');
		const documentFile = sqlText(journal.documentFile, 'recovery document');
		const project = this.#database.prepare(`
			SELECT project_revision AS projectRevision, sha256, document_file AS documentFile
			FROM projects WHERE project_id = ?
		`).get(projectId) as Record<string, unknown> | undefined;
		const committed = project !== undefined && project.projectRevision === projectRevision
			&& project.sha256 === projectSha256 && project.documentFile === documentFile;
		this.#transaction(() => {
			this.assertLeaseInTransaction(this.#database);
			this.#database.prepare('DELETE FROM publication_journal WHERE publication_id = ?')
				.run(publicationId);
		});
		if (!committed) {
			await rm(containedDocument(this.#projectsRoot, documentFile), { force: true });
		}
		this.#recovery = Object.freeze({
			outcome: committed ? 'committed' : 'discarded',
			publishedRevision: committed ? projectRevision : null,
		});
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		if (this.#renewTimer) clearInterval(this.#renewTimer);
		this.#renewTimer = null;
		try {
			if (this.#fenced !== null) return;
			await this.recover();
			this.#transaction(() => {
				const released = this.#database.prepare(`
					UPDATE library_lease SET active = 0, lease_id = NULL, owner_json = NULL,
						expires_at_ms = NULL, took_over = 0
					WHERE singleton = 1 AND active = 1 AND lease_id = ? AND fencing_token = ?
				`).run(this.#lease.leaseId, this.#lease.fencingToken);
				if (released.changes !== 1) {
					throw new Error('Framescaper V17 writer lease release lost ownership');
				}
			});
		} finally { this.#closed = true; }
	}

	#updateJournal(publicationId: string, previous: string, next: string, result: string | null): void {
		this.#transaction(() => {
			this.assertLeaseInTransaction(this.#database);
			const updated = this.#database.prepare(`
				UPDATE publication_journal SET state = ?, result_json = ?, updated_at_ms = ?
				WHERE publication_id = ? AND state = ? AND lease_id = ? AND fencing_token = ?
			`).run(next, result, Date.now(), publicationId, previous, this.#lease.leaseId, this.#lease.fencingToken);
			if (updated.changes !== 1) throw new Error(`Framescaper V17 publication journal could not enter ${next}`);
		});
	}

	#renew(): void {
		if (this.#closed || this.#fenced !== null) return;
		try {
			const expiresAtMs = Date.now() + this.#leaseTtlMs;
			const renewed = this.#database.prepare(`
				UPDATE library_lease SET expires_at_ms = ?
				WHERE singleton = 1 AND active = 1 AND lease_id = ? AND fencing_token = ?
			`).run(expiresAtMs, this.#lease.leaseId, this.#lease.fencingToken);
			if (renewed.changes !== 1) throw new Error('Framescaper V17 writer lease renewal lost ownership');
			this.#lease = Object.freeze({ ...this.#lease, expiresAtMs });
		} catch (error) { this.#fence(error); }
	}

	#fence(error: unknown): void {
		if (this.#fenced !== null) return;
		this.#fenced = error;
		if (this.#renewTimer) clearInterval(this.#renewTimer);
		this.#renewTimer = null;
		try { this.#onLeaseLost(error); } catch { /* The fence remains authoritative. */ }
	}

	#transaction(operation: () => void): void {
		this.#database.exec('BEGIN IMMEDIATE');
		try { operation(); this.#database.exec('COMMIT'); }
		catch (error) { this.#database.exec('ROLLBACK'); throw error; }
	}
}

function acquireLease(
	database: DatabaseSync,
	owner: Readonly<Record<string, unknown>>,
	ttlMs: number,
): Readonly<{ lease: Readonly<Lease> | null; retryAtMs: number }> {
	database.exec('BEGIN IMMEDIATE');
	try {
		const now = Date.now();
		const row = database.prepare(`
			SELECT active, fencing_token AS fencingToken, expires_at_ms AS expiresAtMs
			FROM library_lease WHERE singleton = 1
		`).get() as Record<string, unknown>;
		const held = row.active === 1 && Number.isSafeInteger(row.expiresAtMs) && Number(row.expiresAtMs) > now;
		if (held) {
			database.exec('COMMIT');
			return Object.freeze({ lease: null, retryAtMs: Number(row.expiresAtMs) });
		}
		const fencingToken = Number(row.fencingToken) + 1;
		if (!Number.isSafeInteger(fencingToken) || fencingToken < 1) throw new Error('Framescaper V17 fencing token overflow');
		const leaseId = randomBytes(24).toString('hex');
		const expiresAtMs = now + ttlMs;
		const tookOverStaleLease = row.active === 1;
		const previousFencingToken = sqlNonNegative(row.fencingToken, 'stored fencing token');
		const ownerJson = JSON.stringify(owner);
		if (typeof ownerJson !== 'string') throw new Error('Framescaper V17 writer owner is not serializable');
		if (database.prepare(`
			UPDATE library_lease SET active = 1, lease_id = ?, fencing_token = ?, owner_json = ?,
				expires_at_ms = ?, took_over = ? WHERE singleton = 1 AND fencing_token = ?
		`).run(
			leaseId, fencingToken, ownerJson, expiresAtMs, tookOverStaleLease ? 1 : 0,
			previousFencingToken,
		).changes !== 1) throw new Error('Framescaper V17 writer lease acquisition raced');
		database.exec('COMMIT');
		return Object.freeze({
			lease: Object.freeze({ leaseId, fencingToken, tookOverStaleLease, expiresAtMs }),
			retryAtMs: expiresAtMs,
		});
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}

function timingOptions(qualification: Readonly<FramescaperDesktopProjectLibraryV17Qualification> | null) {
	if (!qualification) return Object.freeze({
		leaseTtlMs: PRODUCTION_LEASE_TTL_MS, renewIntervalMs: PRODUCTION_RENEW_INTERVAL_MS,
	});
	const leaseTtlMs = lowerOnly(qualification.leaseTtlMs, PRODUCTION_LEASE_TTL_MS, 'lease TTL');
	const renewIntervalMs = lowerOnly(
		qualification.renewIntervalMs, PRODUCTION_RENEW_INTERVAL_MS, 'renewal interval',
	);
	if (renewIntervalMs >= leaseTtlMs) throw new RangeError('Framescaper V17 renewal must precede lease expiry');
	return Object.freeze({ leaseTtlMs, renewIntervalMs });
}

function lowerOnly(value: unknown, ceiling: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > ceiling) {
		throw new RangeError(`Framescaper V17 qualification ${label} is outside its lower-only range`);
	}
	return Number(value);
}

function sqlText(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1) throw new Error(`Framescaper V17 ${label} is invalid`);
	return value;
}

function sqlNonNegative(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new Error(`Framescaper V17 ${label} is invalid`);
	}
	return Number(value);
}

function containedDocument(root: string, value: string): string {
	if (!value || value.includes('\0')) throw new Error('Framescaper V17 journal document is invalid');
	const result = resolve(root, value);
	const relation = relative(resolve(root), result);
	if (!relation || relation === '..' || relation.startsWith(`..${sep}`)) {
		throw new Error('Framescaper V17 journal document leaves its root');
	}
	return result;
}
