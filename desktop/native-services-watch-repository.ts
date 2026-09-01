/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';

import {
	createWatchRuleV1,
	watchRuleAdmitsEntry,
	type WatchRuleV1,
} from '../src/common/editor/native-watch-rule.ts';
import {
	decideWatchImport,
	trackWatchCandidate,
	type WatchCandidateStateV1,
} from '../src/common/editor/native-watch-reconciliation.ts';
import type {
	FramescaperNativeRootGrant,
} from './native-services-root-repository.ts';
import { FramescaperNativeRootRepository } from './native-services-root-repository.ts';
import {
	assertFramescaperNativeServicesWriterLease,
	FramescaperNativeServicesDatabaseError,
	type FramescaperNativeServicesLease,
} from './native-services-database.ts';

const MAXIMUM_RULES = 1_024;
const MAXIMUM_SWEEP_ENTRIES = 100_000;
const SHA256 = /^[a-f0-9]{64}$/u;

export interface FramescaperNativeWatchRuleInput {
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	readonly ruleId: string;
	readonly grantId: string;
	readonly projectId: string;
	readonly binId?: string | null;
	readonly extensions: readonly string[];
	readonly recursive?: boolean;
	readonly importMode?: 'link' | 'copy';
	readonly generateProxies?: boolean;
	readonly enabled?: boolean;
	readonly createdAtMs: number;
}

export interface FramescaperNativeWatchEntry {
	readonly name: string;
	readonly fileIdentity: string;
	readonly sizeBytes: number;
	readonly modifiedAtMs: number;
	readonly isDirectory: boolean;
	readonly symbolicLink: boolean;
}

export interface FramescaperNativeWatchProbeResult {
	readonly succeeded: boolean;
	readonly contentSha256: string | null;
}

export interface FramescaperNativeWatchProjectState {
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	readonly open: boolean;
	readonly writable: boolean;
	readonly binId: 'project-bin';
}

export interface FramescaperNativeWatchReconcilerOptions {
	readonly repository: FramescaperNativeWatchRepository;
	readonly roots: FramescaperNativeRootRepository;
	readonly scan: (
		rule: WatchRuleV1,
		root: FramescaperNativeRootGrant,
	) => Promise<readonly FramescaperNativeWatchEntry[]>;
	readonly probe: (entry: FramescaperNativeWatchEntry) => Promise<FramescaperNativeWatchProbeResult>;
	readonly projectState: (projectId: string) => FramescaperNativeWatchProjectState;
	readonly lease: () => FramescaperNativeServicesLease;
	readonly importFile: (request: Readonly<{
		rule: WatchRuleV1;
		entry: FramescaperNativeWatchEntry;
		contentSha256: string;
	}>) => Promise<boolean>;
	readonly importRecorded?: (request: Readonly<{
		rule: WatchRuleV1;
		entry: FramescaperNativeWatchEntry;
		contentSha256: string;
	}>) => Promise<void> | void;
	readonly onEntryError?: (error: unknown) => void;
}

export interface FramescaperNativeWatchSweepResult {
	readonly rules: number;
	readonly imports: number;
	readonly duplicates: number;
	readonly pending: number;
	readonly skippedSymlinks: number;
}

export class FramescaperNativeWatchRepository {
	readonly #database: DatabaseSync;

	constructor(database: DatabaseSync) {
		this.#database = database;
	}

	create(
		input: FramescaperNativeWatchRuleInput,
		lease: FramescaperNativeServicesLease,
		nowMs: number,
	): WatchRuleV1 {
		if (input.recursive === true) {
			throw new Error('Native watch recursion is disabled; each grant watches only its selected directory.');
		}
		if (this.list().length >= MAXIMUM_RULES) throw new RangeError('The native watch-rule registry is full.');
		const rule = createWatchRuleV1({ ...input, recursive: false });
		this.#mutation(lease, nowMs, () => {
			this.#database.prepare(`
				INSERT INTO watch_rules (
					rule_id, grant_id, project_id, bin_id, extensions, recursive,
					import_mode, generate_proxies, enabled, created_at_ms
				) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
			`).run(
				rule.ruleId, rule.grantId, rule.projectId, rule.binId,
				JSON.stringify(rule.extensions), rule.importMode,
				rule.generateProxies ? 1 : 0, rule.enabled ? 1 : 0, rule.createdAtMs,
			);
		});
		return rule;
	}

	read(ruleId: string): WatchRuleV1 | null {
		const row = this.#database.prepare(
			'SELECT * FROM watch_rules WHERE rule_id = ?',
		).get(ruleId) as Record<string, unknown> | undefined;
		return row ? decodeRule(row) : null;
	}

	list(): readonly WatchRuleV1[] {
		const rows = this.#database.prepare(`
			SELECT * FROM watch_rules ORDER BY created_at_ms, rule_id LIMIT ${String(MAXIMUM_RULES + 1)}
		`).all() as Record<string, unknown>[];
		if (rows.length > MAXIMUM_RULES) throw new RangeError('The native watch-rule registry exceeds its ceiling.');
		return Object.freeze(rows.map(decodeRule));
	}

	setEnabled(
		ruleId: string,
		enabled: boolean,
		lease: FramescaperNativeServicesLease,
		nowMs: number,
	): WatchRuleV1 {
		if (typeof enabled !== 'boolean') throw new TypeError('A native watch rule enabled value must be boolean.');
		const result = this.#mutation(lease, nowMs, () => {
			if (enabled) {
				const authority = this.#database.prepare(`
					SELECT roots.revoked_at_ms AS revoked_at_ms
					FROM watch_rules AS rules
					JOIN durable_root_grants AS roots ON roots.grant_id = rules.grant_id
					WHERE rules.rule_id = ?
				`).get(ruleId) as Record<string, unknown> | undefined;
				if (!authority || authority.revoked_at_ms !== null) {
					throw new Error('A native watch rule requires an active root grant.');
				}
			}
			return this.#database.prepare(
				'UPDATE watch_rules SET enabled = ? WHERE rule_id = ?',
			).run(enabled ? 1 : 0, ruleId);
		});
		if (result.changes !== 1) throw new Error('The native watch rule does not exist.');
		return this.read(ruleId)!;
	}

	remove(
		ruleId: string,
		lease: FramescaperNativeServicesLease,
		nowMs: number,
	): boolean {
		const rule = this.read(ruleId);
		if (rule === null) return false;
		if (rule.enabled) throw new Error('A native watch rule must be disabled before removal.');
		return this.#mutation(lease, nowMs, () => this.#database.prepare(
			'DELETE FROM watch_rules WHERE rule_id = ?',
		).run(ruleId).changes === 1);
	}

	hasImported(ruleId: string, fileIdentity: string, contentSha256: string): boolean {
		assertDigest(contentSha256);
		return Boolean(this.#database.prepare(`
			SELECT 1 AS found FROM watch_imports
			WHERE rule_id = ? AND file_identity = ? AND content_sha256 = ?
		`).get(ruleId, fileIdentity, contentSha256));
	}

	recordImport(
		ruleId: string,
		fileIdentity: string,
		contentSha256: string,
		importedAtMs: number,
		lease: FramescaperNativeServicesLease,
	): boolean {
		assertDigest(contentSha256);
		if (!Number.isSafeInteger(importedAtMs) || importedAtMs < 0) {
			throw new RangeError('A native watch import time must be a non-negative safe integer.');
		}
		return this.#mutation(lease, importedAtMs, () => this.#database.prepare(`
				INSERT OR IGNORE INTO watch_imports
					(rule_id, file_identity, content_sha256, imported_at_ms)
				VALUES (?, ?, ?, ?)
			`).run(ruleId, fileIdentity, contentSha256, importedAtMs).changes === 1);
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

export class FramescaperNativeWatchReconciler {
	readonly #repository: FramescaperNativeWatchRepository;
	readonly #roots: FramescaperNativeRootRepository;
	readonly #scan: FramescaperNativeWatchReconcilerOptions['scan'];
	readonly #probe: FramescaperNativeWatchReconcilerOptions['probe'];
	readonly #projectState: FramescaperNativeWatchReconcilerOptions['projectState'];
	readonly #lease: FramescaperNativeWatchReconcilerOptions['lease'];
	readonly #importFile: FramescaperNativeWatchReconcilerOptions['importFile'];
	readonly #importRecorded: FramescaperNativeWatchReconcilerOptions['importRecorded'];
	readonly #onEntryError: (error: unknown) => void;
	readonly #candidates = new Map<string, Map<string, WatchCandidateStateV1>>();

	constructor(options: FramescaperNativeWatchReconcilerOptions) {
		this.#repository = options.repository;
		this.#roots = options.roots;
		this.#scan = options.scan;
		this.#probe = options.probe;
		this.#projectState = options.projectState;
		this.#lease = options.lease;
		this.#importFile = options.importFile;
		this.#importRecorded = options.importRecorded;
		this.#onEntryError = options.onEntryError ?? (() => undefined);
	}

	async reconcile(nowMs: number): Promise<FramescaperNativeWatchSweepResult> {
		if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
			throw new RangeError('A native watch sweep time must be a non-negative safe integer.');
		}
		let imports = 0;
		let duplicates = 0;
		let pending = 0;
		let skippedSymlinks = 0;
		const rules = this.#repository.list().filter((rule) => rule.enabled);
		for (const rule of rules) {
			const root = this.#roots.read(rule.grantId);
			if (root === null || root.revokedAtMs !== null) {
				this.#candidates.delete(rule.ruleId);
				continue;
			}
			const entries = await this.#scan(rule, root);
			if (entries.length > MAXIMUM_SWEEP_ENTRIES) {
				throw new RangeError('A native watch reconciliation exceeds its entry ceiling.');
			}
			const candidates = this.#candidates.get(rule.ruleId) ?? new Map<string, WatchCandidateStateV1>();
			this.#candidates.set(rule.ruleId, candidates);
			const seen = new Set<string>();
			for (const entry of entries) {
				try {
					if (entry.symbolicLink) {
						skippedSymlinks += 1;
						continue;
					}
					if (!watchRuleAdmitsEntry(rule, {
						name: entry.name, depth: 0,
						isDirectory: entry.isDirectory, isSymbolicLink: entry.symbolicLink,
					})) continue;
					seen.add(entry.fileIdentity);
					const tracking = trackWatchCandidate(candidates, entry.fileIdentity, {
						atMs: nowMs, sizeBytes: entry.sizeBytes, modifiedAtMs: entry.modifiedAtMs,
					});
					if (tracking.candidate === null) continue;
					const probe = await this.#probeIfSettled(tracking.candidate, entry);
					const digest = probe.contentSha256;
					const alreadyImported = digest !== null
						&& this.#repository.hasImported(rule.ruleId, entry.fileIdentity, digest);
					const project = this.#projectState(rule.projectId);
					const decision = decideWatchImport({
						rule,
						candidate: tracking.candidate,
						probeSucceeded: probe.succeeded,
						contentSha256: digest,
						importedKeys: alreadyImported && digest !== null
							? new Set([`${rule.ruleId}|${entry.fileIdentity}|${digest}`])
							: new Set(),
						projectOpen: project.open,
						projectWritable: project.writable,
						nowMs,
					});
					if (decision.decision === 'skip-duplicate') {
						duplicates += 1;
						if (digest !== null) await this.#importRecorded?.({
							rule, entry, contentSha256: digest,
						});
						candidates.delete(entry.fileIdentity);
					} else if (decision.decision === 'pending-project-closed'
						|| decision.decision === 'pending-project-read-only') {
						pending += 1;
					} else if (decision.decision === 'import' && digest !== null) {
						if (await this.#importFile({ rule, entry, contentSha256: digest })) {
							this.#repository.recordImport(
								rule.ruleId, entry.fileIdentity, digest, nowMs, this.#lease(),
							);
							await this.#importRecorded?.({ rule, entry, contentSha256: digest });
							imports += 1;
							candidates.delete(entry.fileIdentity);
						}
					}
				} catch (error) {
					if (fatalWatchSweepError(error)) throw error;
					this.#onEntryError(error);
				}
			}
			for (const fileIdentity of candidates.keys()) {
				if (!seen.has(fileIdentity)) candidates.delete(fileIdentity);
			}
		}
		return Object.freeze({ rules: rules.length, imports, duplicates, pending, skippedSymlinks });
	}

	async #probeIfSettled(
		candidate: WatchCandidateStateV1,
		entry: FramescaperNativeWatchEntry,
	): Promise<FramescaperNativeWatchProbeResult> {
		if (candidate.unchangedObservations < 2
			|| candidate.lastObservedAtMs - candidate.firstUnchangedAtMs < 2_000) {
			return Object.freeze({ succeeded: false, contentSha256: null });
		}
		return this.#probe(entry);
	}
}

function fatalWatchSweepError(error: unknown): boolean {
	return error instanceof FramescaperNativeServicesDatabaseError
		|| Boolean(error && typeof error === 'object' && 'code' in error
			&& typeof error.code === 'string' && error.code.startsWith('ERR_SQLITE'));
}

function decodeRule(row: Record<string, unknown>): WatchRuleV1 {
	if (Number(row.recursive) !== 0) {
		throw new Error('A stored native watch rule violates the non-recursive service contract.');
	}
	return createWatchRuleV1({
		schemaFamily: 'framescaper', schemaVersion: 1,
		ruleId: row.rule_id as string,
		grantId: row.grant_id as string,
		projectId: row.project_id as string,
		binId: row.bin_id as string | null,
		extensions: parseExtensions(row.extensions),
		recursive: false,
		importMode: row.import_mode as 'link' | 'copy',
		generateProxies: Number(row.generate_proxies) === 1,
		enabled: Number(row.enabled) === 1,
		createdAtMs: row.created_at_ms as number,
	});
}

function parseExtensions(value: unknown): readonly string[] {
	if (typeof value !== 'string') throw new TypeError('Stored native watch extensions are not JSON text.');
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) throw new TypeError('not an array');
		return parsed as readonly string[];
	} catch {
		throw new TypeError('Stored native watch extensions are invalid JSON.');
	}
}

function assertDigest(value: unknown): asserts value is string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError('A native watch import requires an exact lowercase SHA-256 digest.');
	}
}
