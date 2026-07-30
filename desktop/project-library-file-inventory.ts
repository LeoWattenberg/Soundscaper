/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { basename, dirname } from 'node:path';

import {
	createDesktopLibraryProjectMetadataFile,
	type DesktopLibraryLease,
} from './project-library-contract.ts';
import { LEASE_ID_PATTERN } from './project-library-persistence.ts';

const CANONICAL_FILE = /^(0|[1-9][0-9]*)-([a-f0-9]{64})\.json$/u;

export interface DesktopLibraryProjectFileReservationOptions {
	readonly lease: DesktopLibraryLease;
	readonly metadataFile: string;
	readonly registeredAtMs: number;
}

export interface DesktopLibraryProjectFileInventoryRow {
	readonly id: number;
	readonly fencingToken: number;
	readonly leaseId: string;
	readonly metadataFile: string;
	readonly portableKey: string;
	readonly state: 'planned' | 'materialized';
}

export interface DesktopLibraryProjectFileInventoryBatch {
	readonly complete: boolean;
	readonly rows: readonly DesktopLibraryProjectFileInventoryRow[];
}

interface ReclamationState {
	readonly lastInventoryId: number;
	readonly cycleHighWaterId: number;
}

export function initializeDesktopLibraryProjectFileInventory(database: DatabaseSync): void {
	database.exec(`
		CREATE TABLE IF NOT EXISTS project_file_inventory (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			metadata_file TEXT NOT NULL UNIQUE,
			portable_key TEXT NOT NULL,
			state TEXT NOT NULL CHECK (state IN ('planned', 'materialized')),
			lease_id TEXT NOT NULL,
			fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
			registered_at_ms INTEGER NOT NULL CHECK (registered_at_ms >= 0),
			CHECK (length(metadata_file) BETWEEN 1 AND 1024),
			CHECK (length(portable_key) BETWEEN 1 AND 1024)
		) STRICT;
		CREATE INDEX IF NOT EXISTS project_file_inventory_portable
			ON project_file_inventory (portable_key, metadata_file);
		CREATE TABLE IF NOT EXISTS project_file_reclamation (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			last_inventory_id INTEGER NOT NULL CHECK (last_inventory_id >= 0),
			cycle_high_water_id INTEGER NOT NULL CHECK (cycle_high_water_id >= last_inventory_id)
		) STRICT;
		INSERT OR IGNORE INTO project_file_reclamation
			(singleton, last_inventory_id, cycle_high_water_id) VALUES (1, 0, 0);
	`);
}

export function validateDesktopLibraryProjectFileInventory(database: DatabaseSync): void {
	readReclamationState(database);
}

export function assertDesktopLibraryProjectFilesMaterialized(
	database: DatabaseSync,
	metadataFiles: readonly string[],
): void {
	const lookup = database.prepare(`
		SELECT id, metadata_file AS metadataFile, portable_key AS portableKey,
			state, lease_id AS leaseId, fencing_token AS fencingToken,
			registered_at_ms AS registeredAtMs
		FROM project_file_inventory WHERE metadata_file = ?
	`);
	for (const value of metadataFiles) {
		const metadataFile = validateProjectMetadataFile(value);
		const raw = lookup.get(metadataFile);
		if (!raw || validateInventoryRow(raw).state !== 'materialized') {
			throw new Error('Desktop catalog project requires a materialized project file inventory row');
		}
	}
}

export function reserveDesktopLibraryProjectFile(
	database: DatabaseSync,
	options: DesktopLibraryProjectFileReservationOptions,
): void {
	const metadataFile = validateProjectMetadataFile(options.metadataFile);
	const registeredAtMs = nonNegativeInteger(options.registeredAtMs, 'project file registration time');
	if (!LEASE_ID_PATTERN.test(options.lease.leaseId)) throw new TypeError('Project file lease id is invalid');
	const fencingToken = positiveInteger(options.lease.fencingToken, 'project file fencing token');
	const portableKey = portablePathKey(metadataFile);
	const existing = database.prepare(`
		SELECT id, metadata_file AS metadataFile, portable_key AS portableKey,
			state, lease_id AS leaseId, fencing_token AS fencingToken,
			registered_at_ms AS registeredAtMs
		FROM project_file_inventory WHERE metadata_file = ?
	`).get(metadataFile);
	if (existing) validateInventoryRow(existing);
	database.prepare(`
		INSERT INTO project_file_inventory
			(metadata_file, portable_key, state, lease_id, fencing_token, registered_at_ms)
		VALUES (?, ?, 'planned', ?, ?, ?)
		ON CONFLICT(metadata_file) DO UPDATE SET
			portable_key = excluded.portable_key,
			state = 'planned',
			lease_id = excluded.lease_id,
			fencing_token = excluded.fencing_token,
			registered_at_ms = excluded.registered_at_ms
	`).run(metadataFile, portableKey, options.lease.leaseId, fencingToken, registeredAtMs);
}

export function ensureDesktopLibraryProjectFileReclamationCycle(database: DatabaseSync): void {
	const state = readReclamationState(database);
	if (state.cycleHighWaterId !== 0) return;
	restartDesktopLibraryProjectFileReclamationCycle(database);
}

export function restartDesktopLibraryProjectFileReclamationCycle(database: DatabaseSync): void {
	const row = database.prepare('SELECT MAX(id) AS highWater FROM project_file_inventory').get();
	const highWater = row?.highWater === null
		? 0
		: nonNegativeInteger(row?.highWater, 'project file inventory high-water id');
	database.prepare(`
		UPDATE project_file_reclamation
		SET last_inventory_id = 0, cycle_high_water_id = ? WHERE singleton = 1
	`).run(highWater);
}

export function readDesktopLibraryProjectFileInventoryBatch(
	database: DatabaseSync,
	maximum: number,
): DesktopLibraryProjectFileInventoryBatch {
	const limit = positiveInteger(maximum, 'project file inventory batch limit');
	const state = readReclamationState(database);
	if (state.cycleHighWaterId === 0) return Object.freeze({ complete: true, rows: Object.freeze([]) });
	const rawRows = database.prepare(`
		SELECT id, metadata_file AS metadataFile, portable_key AS portableKey,
			state, lease_id AS leaseId, fencing_token AS fencingToken,
			registered_at_ms AS registeredAtMs
		FROM project_file_inventory
		WHERE id > ? AND id <= ? ORDER BY id LIMIT ?
	`).all(state.lastInventoryId, state.cycleHighWaterId, limit);
	const rows = rawRows.map((row) => {
		const validated = validateInventoryRow(row);
		if (validated.id <= state.lastInventoryId || validated.id > state.cycleHighWaterId) {
			throw new Error('Desktop project file inventory batch leaves its reclamation cycle');
		}
		return inventoryCandidate(validated);
	});
	const lastId = rows.at(-1)?.id ?? state.lastInventoryId;
	const complete = rawRows.length < limit || database.prepare(`
		SELECT 1 AS pending FROM project_file_inventory
		WHERE id > ? AND id <= ? LIMIT 1
	`).get(lastId, state.cycleHighWaterId) === undefined;
	return Object.freeze({ complete, rows: Object.freeze(rows) });
}

export function advanceDesktopLibraryProjectFileReclamation(
	database: DatabaseSync,
	lastInventoryId: number,
	complete: boolean,
): void {
	const state = readReclamationState(database);
	const lastId = nonNegativeInteger(lastInventoryId, 'project file reclamation cursor');
	if (complete) {
		database.prepare(`
			UPDATE project_file_reclamation
			SET last_inventory_id = 0, cycle_high_water_id = 0 WHERE singleton = 1
		`).run();
		return;
	}
	if (lastId <= state.lastInventoryId || lastId > state.cycleHighWaterId) {
		throw new Error('Desktop project file reclamation cursor cannot advance outside its cycle');
	}
	database.prepare(`
		UPDATE project_file_reclamation SET last_inventory_id = ? WHERE singleton = 1
	`).run(lastId);
}

export function removeDesktopLibraryProjectFileInventoryRow(database: DatabaseSync, id: number): void {
	const inventoryId = positiveInteger(id, 'project file inventory id');
	database.prepare('DELETE FROM project_file_inventory WHERE id = ?').run(inventoryId);
}

export function createDesktopLibraryProjectQuarantineFile(metadataFile: string): string {
	const validated = validateProjectMetadataFile(metadataFile);
	const digest = createHash('sha256').update(portablePathKey(validated), 'utf8').digest('hex');
	return `${dirname(validated)}/.${digest}.orphan`;
}

export function validateProjectMetadataFile(value: unknown): string {
	if (typeof value !== 'string' || value.includes('\\')) {
		throw new TypeError('Desktop project inventory metadata file is invalid');
	}
	const segments = value.split('/');
	if (segments.length !== 2) throw new TypeError('Desktop project inventory metadata file is invalid');
	const [entryId, fileName] = segments;
	const match = CANONICAL_FILE.exec(fileName ?? '');
	if (!entryId || !match) throw new TypeError('Desktop project inventory metadata file is invalid');
	const revision = Number(match[1]);
	if (!Number.isSafeInteger(revision)) throw new RangeError('Desktop project inventory revision is invalid');
	const canonical = createDesktopLibraryProjectMetadataFile(entryId, revision, match[2]);
	if (canonical !== value || basename(canonical) !== fileName) {
		throw new TypeError('Desktop project inventory metadata file is not canonical');
	}
	return canonical;
}

function validateInventoryRow(raw: Record<string, unknown>) {
	const id = positiveInteger(raw.id, 'project file inventory id');
	const metadataFile = validateProjectMetadataFile(raw.metadataFile);
	const portableKey = stringValue(raw.portableKey, 'project file portable key');
	if (portableKey !== portablePathKey(metadataFile)) throw new Error('Desktop project file portable key is invalid');
	if (raw.state !== 'planned' && raw.state !== 'materialized') {
		throw new TypeError('Desktop project file inventory state is invalid');
	}
	const leaseId = stringValue(raw.leaseId, 'project file lease id');
	if (!LEASE_ID_PATTERN.test(leaseId)) throw new TypeError('Desktop project file lease id is invalid');
	const fencingToken = positiveInteger(raw.fencingToken, 'project file fencing token');
	const registeredAtMs = nonNegativeInteger(raw.registeredAtMs, 'project file registration time');
	return Object.freeze({ id, metadataFile, portableKey, state: raw.state, leaseId, fencingToken, registeredAtMs });
}

function inventoryCandidate(row: ReturnType<typeof validateInventoryRow>): DesktopLibraryProjectFileInventoryRow {
	return Object.freeze({
		id: row.id,
		fencingToken: row.fencingToken,
		leaseId: row.leaseId,
		metadataFile: row.metadataFile,
		portableKey: row.portableKey,
		state: row.state,
	});
}

function readReclamationState(database: DatabaseSync): ReclamationState {
	const raw = database.prepare(`
		SELECT last_inventory_id AS lastInventoryId,
			cycle_high_water_id AS cycleHighWaterId
		FROM project_file_reclamation WHERE singleton = 1
	`).get();
	if (!raw) throw new Error('Desktop project file reclamation state is missing');
	const lastInventoryId = nonNegativeInteger(raw.lastInventoryId, 'project file reclamation cursor');
	const cycleHighWaterId = nonNegativeInteger(raw.cycleHighWaterId, 'project file reclamation high-water id');
	if (lastInventoryId > cycleHighWaterId || (cycleHighWaterId === 0 && lastInventoryId !== 0)) {
		throw new Error('Desktop project file reclamation state is invalid');
	}
	return Object.freeze({ lastInventoryId, cycleHighWaterId });
}

function portablePathKey(value: string): string {
	return value.toLowerCase();
}

function stringValue(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is invalid`);
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	const integer = nonNegativeInteger(value, label);
	if (integer === 0) throw new RangeError(`${label} must be positive`);
	return integer;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${label} must be a non-negative safe integer`);
	}
	return value;
}
