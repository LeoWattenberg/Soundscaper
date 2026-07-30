/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	closeSync,
	fsyncSync,
	lstatSync,
	openSync,
	renameSync,
	unlinkSync,
} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { basename, dirname, join } from 'node:path';

import {
	type DesktopLibraryDiscardProjectStageFileOptions,
} from './project-library-api.ts';
import {
	type DesktopLibraryLease,
	type DesktopProjectLibraryPaths,
} from './project-library-contract.ts';
import { validateProjectMetadataFile } from './project-library-file-inventory.ts';
import { LEASE_ID_PATTERN } from './project-library-persistence.ts';

const STAGE_ID = /^[a-f0-9]{32}$/u;

export interface DesktopLibraryProjectStageRegistrationOptions {
	readonly lease: DesktopLibraryLease;
	readonly metadataFile: string;
	readonly registeredAtMs: number;
	readonly stageFile: string;
}

export interface DesktopLibraryProjectStageMaterializationOptions {
	readonly lease: DesktopLibraryLease;
	readonly metadataFile: string;
	readonly stageFile: string | null;
}

export interface DesktopLibraryProjectStageInventoryRow {
	readonly fencingToken: number;
	readonly id: number;
	readonly leaseId: string;
	readonly metadataFile: string;
	readonly stageFile: string;
}

export interface DesktopLibraryProjectStageInventoryBatch {
	readonly complete: boolean;
	readonly rows: readonly DesktopLibraryProjectStageInventoryRow[];
}

export type DesktopLibraryProjectReclamationKind = 'project' | 'stage';

interface StageReclamationState {
	readonly cycleHighWaterId: number;
	readonly lastInventoryId: number;
}

export function initializeDesktopLibraryProjectStageInventory(database: DatabaseSync): void {
	database.exec(`
		CREATE TABLE IF NOT EXISTS project_stage_inventory (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			stage_file TEXT NOT NULL UNIQUE,
			portable_key TEXT NOT NULL UNIQUE,
			metadata_file TEXT NOT NULL,
			lease_id TEXT NOT NULL,
			fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
			registered_at_ms INTEGER NOT NULL CHECK (registered_at_ms >= 0),
			CHECK (length(stage_file) BETWEEN 1 AND 1024),
			CHECK (length(portable_key) BETWEEN 1 AND 1024),
			FOREIGN KEY (metadata_file) REFERENCES project_file_inventory(metadata_file)
				ON DELETE RESTRICT
		) STRICT;
		CREATE INDEX IF NOT EXISTS project_stage_inventory_metadata
			ON project_stage_inventory (metadata_file, id);
		CREATE TABLE IF NOT EXISTS project_stage_reclamation (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			last_inventory_id INTEGER NOT NULL CHECK (last_inventory_id >= 0),
			cycle_high_water_id INTEGER NOT NULL CHECK (cycle_high_water_id >= last_inventory_id)
		) STRICT;
		INSERT OR IGNORE INTO project_stage_reclamation
			(singleton, last_inventory_id, cycle_high_water_id) VALUES (1, 0, 0);
		CREATE TABLE IF NOT EXISTS project_reclamation_schedule (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			next_kind TEXT NOT NULL CHECK (next_kind IN ('project', 'stage')),
			project_rescan_required INTEGER NOT NULL
				CHECK (project_rescan_required IN (0, 1))
		) STRICT;
		INSERT OR IGNORE INTO project_reclamation_schedule
			(singleton, next_kind, project_rescan_required) VALUES (1, 'stage', 0);
	`);
}

export function validateDesktopLibraryProjectStageInventory(database: DatabaseSync): void {
	readStageReclamationState(database);
	readDesktopLibraryProjectReclamationKind(database);
	readDesktopLibraryProjectRescanRequired(database);
}

export function readDesktopLibraryProjectReclamationKind(
	database: DatabaseSync,
): DesktopLibraryProjectReclamationKind {
	const raw = database.prepare(`
		SELECT next_kind AS nextKind FROM project_reclamation_schedule WHERE singleton = 1
	`).get();
	if (raw?.nextKind !== 'project' && raw?.nextKind !== 'stage') {
		throw new Error('Desktop project reclamation schedule is invalid');
	}
	return raw.nextKind;
}

export function setDesktopLibraryProjectReclamationKind(
	database: DatabaseSync,
	nextKind: DesktopLibraryProjectReclamationKind,
): void {
	if (nextKind !== 'project' && nextKind !== 'stage') {
		throw new TypeError('Desktop project reclamation kind is invalid');
	}
	database.prepare(`
		UPDATE project_reclamation_schedule SET next_kind = ? WHERE singleton = 1
	`).run(nextKind);
}

export function markDesktopLibraryProjectRescanRequired(database: DatabaseSync): void {
	database.prepare(`
		UPDATE project_reclamation_schedule SET project_rescan_required = 1 WHERE singleton = 1
	`).run();
}

export function consumeDesktopLibraryProjectRescanRequired(database: DatabaseSync): boolean {
	if (!readDesktopLibraryProjectRescanRequired(database)) return false;
	const result = database.prepare(`
		UPDATE project_reclamation_schedule SET project_rescan_required = 0
		WHERE singleton = 1 AND project_rescan_required = 1
	`).run();
	if (result.changes !== 1) throw new Error('Desktop project reclamation rescan state changed');
	return true;
}

export function createDesktopLibraryProjectStageFile(metadataFile: string, stageId: string): string {
	const validated = validateProjectMetadataFile(metadataFile);
	if (!STAGE_ID.test(stageId)) throw new TypeError('Desktop project stage id is invalid');
	return `${dirname(validated)}/.${stageId}.stage`;
}

export function registerDesktopLibraryProjectStageFile(
	database: DatabaseSync,
	options: DesktopLibraryProjectStageRegistrationOptions,
): void {
	const metadataFile = validateProjectMetadataFile(options.metadataFile);
	const stageFile = validateProjectStageFile(options.stageFile, metadataFile);
	const portableKey = portablePathKey(stageFile);
	const leaseId = validateLeaseId(options.lease.leaseId);
	const fencingToken = positiveInteger(options.lease.fencingToken, 'project stage fencing token');
	const registeredAtMs = nonNegativeInteger(options.registeredAtMs, 'project stage registration time');
	const project = requiredProjectReservation(database, metadataFile);
	if (project.leaseId !== leaseId || project.fencingToken !== fencingToken) {
		throw new Error('Desktop project stage reservation belongs to another lease');
	}
	database.prepare(`
		INSERT INTO project_stage_inventory
			(stage_file, portable_key, metadata_file, lease_id, fencing_token, registered_at_ms)
		VALUES (?, ?, ?, ?, ?, ?)
	`).run(stageFile, portableKey, metadataFile, leaseId, fencingToken, registeredAtMs);
}

export function materializeDesktopLibraryProjectStageFile(
	database: DatabaseSync,
	paths: DesktopProjectLibraryPaths,
	options: DesktopLibraryProjectStageMaterializationOptions,
): void {
	const metadataFile = validateProjectMetadataFile(options.metadataFile);
	const project = requiredProjectReservation(database, metadataFile);
	if (project.leaseId !== options.lease.leaseId || project.fencingToken !== options.lease.fencingToken) {
		throw new Error('Desktop project file reservation belongs to another lease');
	}
	const finalPath = join(paths.projectsRoot, ...metadataFile.split('/'));
	const directory = dirname(finalPath);
	assertRealDirectory(paths.projectsRoot, 'Desktop project inventory root');
	assertRealDirectory(directory, 'Desktop project inventory scope');
	let stageId: number | null = null;
	if (options.stageFile === null) {
		if (currentLeaseStageExists(database, metadataFile, options.lease)) {
			throw new Error('Desktop project inventory has an outstanding stage reservation');
		}
		if (lstatSync(finalPath, { throwIfNoEntry: false })?.isFile() !== true) {
			throw new TypeError('Desktop project inventory final file is not a regular file');
		}
	} else {
		const stageFile = validateProjectStageFile(options.stageFile, metadataFile);
		const stage = requiredStageRow(database, stageFile);
		if (stage.metadataFile !== metadataFile
			|| stage.leaseId !== options.lease.leaseId
			|| stage.fencingToken !== options.lease.fencingToken) {
			throw new Error('Desktop project stage reservation belongs to another lease or project');
		}
		const stagePath = join(paths.projectsRoot, ...stageFile.split('/'));
		if (lstatSync(stagePath, { throwIfNoEntry: false })?.isFile() !== true) {
			throw new TypeError('Desktop project inventory stage is not a regular file');
		}
		if (lstatSync(finalPath, { throwIfNoEntry: false }) !== undefined) {
			throw new Error('Desktop project inventory final path already exists');
		}
		renameSync(stagePath, finalPath);
		syncDirectory(directory);
		stageId = stage.id;
	}
	const updated = database.prepare(`
		UPDATE project_file_inventory SET state = 'materialized'
		WHERE id = ? AND metadata_file = ?
	`).run(project.id, project.metadataFile);
	if (updated.changes !== 1) throw new Error('Desktop project file inventory changed during materialization');
	if (stageId !== null) removeStageRow(database, stageId);
}

export function discardDesktopLibraryProjectStageFile(
	database: DatabaseSync,
	paths: DesktopProjectLibraryPaths,
	options: DesktopLibraryDiscardProjectStageFileOptions,
): boolean {
	const metadataFile = validateProjectMetadataFile(options.metadataFile);
	const stageFile = validateProjectStageFile(options.stageFile, metadataFile);
	const raw = selectStageRow(database, stageFile);
	if (!raw) return false;
	const stage = validateStageRow(raw);
	if (stage.metadataFile !== metadataFile
		|| stage.leaseId !== options.lease.leaseId
		|| stage.fencingToken !== options.lease.fencingToken) return false;
	if (typeof options.removeFile !== 'boolean') throw new TypeError('Desktop project stage cleanup mode is invalid');
	if (options.removeFile) {
		assertRealDirectory(paths.projectsRoot, 'Desktop project stage cleanup root');
		const stagePath = join(paths.projectsRoot, ...stageFile.split('/'));
		const directory = dirname(stagePath);
		const directoryMetadata = lstatSync(directory, { throwIfNoEntry: false });
		if (directoryMetadata && !directoryMetadata.isDirectory()) {
			throw new TypeError('Desktop project stage cleanup scope is not a direct filesystem directory');
		}
		const stageMetadata = lstatSync(stagePath, { throwIfNoEntry: false });
		if (stageMetadata && !stageMetadata.isFile()) {
			throw new TypeError('Desktop project stage cleanup target is not a regular file');
		}
		if (stageMetadata) {
			unlinkSync(stagePath);
			syncDirectory(directory);
		}
	}
	removeStageRow(database, stage.id);
	return true;
}

export function ensureDesktopLibraryProjectStageReclamationCycle(database: DatabaseSync): void {
	const state = readStageReclamationState(database);
	if (state.cycleHighWaterId !== 0) return;
	const row = database.prepare('SELECT MAX(id) AS highWater FROM project_stage_inventory').get();
	const highWater = row?.highWater === null
		? 0
		: nonNegativeInteger(row?.highWater, 'project stage inventory high-water id');
	database.prepare(`
		UPDATE project_stage_reclamation
		SET last_inventory_id = 0, cycle_high_water_id = ? WHERE singleton = 1
	`).run(highWater);
}

export function readDesktopLibraryProjectStageInventoryBatch(
	database: DatabaseSync,
	maximum: number,
): DesktopLibraryProjectStageInventoryBatch {
	const limit = positiveInteger(maximum, 'project stage inventory batch limit');
	const state = readStageReclamationState(database);
	if (state.cycleHighWaterId === 0) return Object.freeze({ complete: true, rows: Object.freeze([]) });
	const rawRows = database.prepare(`
		SELECT id, stage_file AS stageFile, portable_key AS portableKey,
			metadata_file AS metadataFile, lease_id AS leaseId,
			fencing_token AS fencingToken, registered_at_ms AS registeredAtMs
		FROM project_stage_inventory
		WHERE id > ? AND id <= ? ORDER BY id LIMIT ?
	`).all(state.lastInventoryId, state.cycleHighWaterId, limit);
	const rows = rawRows.map((raw) => stageCandidate(validateStageRow(raw)));
	const lastId = rows.at(-1)?.id ?? state.lastInventoryId;
	const complete = rawRows.length < limit || database.prepare(`
		SELECT 1 AS pending FROM project_stage_inventory
		WHERE id > ? AND id <= ? LIMIT 1
	`).get(lastId, state.cycleHighWaterId) === undefined;
	return Object.freeze({ complete, rows: Object.freeze(rows) });
}

export function advanceDesktopLibraryProjectStageReclamation(
	database: DatabaseSync,
	lastInventoryId: number,
	complete: boolean,
): void {
	const state = readStageReclamationState(database);
	const lastId = nonNegativeInteger(lastInventoryId, 'project stage reclamation cursor');
	if (complete) {
		database.prepare(`
			UPDATE project_stage_reclamation
			SET last_inventory_id = 0, cycle_high_water_id = 0 WHERE singleton = 1
		`).run();
		return;
	}
	if (lastId <= state.lastInventoryId || lastId > state.cycleHighWaterId) {
		throw new Error('Desktop project stage reclamation cursor cannot advance outside its cycle');
	}
	database.prepare(`
		UPDATE project_stage_reclamation SET last_inventory_id = ? WHERE singleton = 1
	`).run(lastId);
}

export function removeDesktopLibraryProjectStageInventoryRow(database: DatabaseSync, id: number): void {
	removeStageRow(database, positiveInteger(id, 'project stage inventory id'));
}

export function hasDesktopLibraryProjectStageInventoryRows(
	database: DatabaseSync,
	metadataFile: string,
): boolean {
	return database.prepare(`
		SELECT 1 AS registered FROM project_stage_inventory WHERE metadata_file = ? LIMIT 1
	`).get(validateProjectMetadataFile(metadataFile)) !== undefined;
}

function requiredProjectReservation(database: DatabaseSync, metadataFile: string) {
	const raw = database.prepare(`
		SELECT id, metadata_file AS metadataFile, state,
			lease_id AS leaseId, fencing_token AS fencingToken
		FROM project_file_inventory WHERE metadata_file = ?
	`).get(metadataFile);
	if (!raw) throw new Error('Desktop project file inventory reservation is missing');
	const id = positiveInteger(raw.id, 'project file inventory id');
	if (raw.metadataFile !== metadataFile || raw.state !== 'planned') {
		throw new Error('Desktop project file inventory reservation is not planned');
	}
	return Object.freeze({
		id,
		metadataFile,
		leaseId: validateLeaseId(raw.leaseId),
		fencingToken: positiveInteger(raw.fencingToken, 'project file fencing token'),
	});
}

function currentLeaseStageExists(
	database: DatabaseSync,
	metadataFile: string,
	lease: DesktopLibraryLease,
): boolean {
	return database.prepare(`
		SELECT 1 AS registered FROM project_stage_inventory
		WHERE metadata_file = ? AND lease_id = ? AND fencing_token = ? LIMIT 1
	`).get(metadataFile, lease.leaseId, lease.fencingToken) !== undefined;
}

function requiredStageRow(database: DatabaseSync, stageFile: string) {
	const raw = selectStageRow(database, stageFile);
	if (!raw) throw new Error('Desktop project stage inventory reservation is missing');
	return validateStageRow(raw);
}

function selectStageRow(database: DatabaseSync, stageFile: string) {
	return database.prepare(`
		SELECT id, stage_file AS stageFile, portable_key AS portableKey,
			metadata_file AS metadataFile, lease_id AS leaseId,
			fencing_token AS fencingToken, registered_at_ms AS registeredAtMs
		FROM project_stage_inventory WHERE stage_file = ?
	`).get(stageFile);
}

function validateStageRow(raw: Record<string, unknown>) {
	const id = positiveInteger(raw.id, 'project stage inventory id');
	const metadataFile = validateProjectMetadataFile(raw.metadataFile);
	const stageFile = validateProjectStageFile(raw.stageFile, metadataFile);
	const portableKey = stringValue(raw.portableKey, 'project stage portable key');
	if (portableKey !== portablePathKey(stageFile)) throw new Error('Desktop project stage portable key is invalid');
	return Object.freeze({
		id,
		stageFile,
		portableKey,
		metadataFile,
		leaseId: validateLeaseId(raw.leaseId),
		fencingToken: positiveInteger(raw.fencingToken, 'project stage fencing token'),
		registeredAtMs: nonNegativeInteger(raw.registeredAtMs, 'project stage registration time'),
	});
}

function stageCandidate(row: ReturnType<typeof validateStageRow>): DesktopLibraryProjectStageInventoryRow {
	return Object.freeze({
		fencingToken: row.fencingToken,
		id: row.id,
		leaseId: row.leaseId,
		metadataFile: row.metadataFile,
		stageFile: row.stageFile,
	});
}

function validateProjectStageFile(value: unknown, metadataFile: string): string {
	if (typeof value !== 'string' || value.includes('\\')) {
		throw new TypeError('Desktop project stage file is invalid');
	}
	const fileName = basename(value);
	const stageId = fileName.startsWith('.') && fileName.endsWith('.stage')
		? fileName.slice(1, -'.stage'.length)
		: '';
	if (createDesktopLibraryProjectStageFile(metadataFile, stageId) !== value) {
		throw new TypeError('Desktop project stage file is not canonical');
	}
	return value;
}

function readStageReclamationState(database: DatabaseSync): StageReclamationState {
	const raw = database.prepare(`
		SELECT last_inventory_id AS lastInventoryId,
			cycle_high_water_id AS cycleHighWaterId
		FROM project_stage_reclamation WHERE singleton = 1
	`).get();
	if (!raw) throw new Error('Desktop project stage reclamation state is missing');
	const lastInventoryId = nonNegativeInteger(raw.lastInventoryId, 'project stage reclamation cursor');
	const cycleHighWaterId = nonNegativeInteger(raw.cycleHighWaterId, 'project stage reclamation high-water id');
	if (lastInventoryId > cycleHighWaterId || (cycleHighWaterId === 0 && lastInventoryId !== 0)) {
		throw new Error('Desktop project stage reclamation state is invalid');
	}
	return Object.freeze({ lastInventoryId, cycleHighWaterId });
}

function readDesktopLibraryProjectRescanRequired(database: DatabaseSync): boolean {
	const raw = database.prepare(`
		SELECT project_rescan_required AS required
		FROM project_reclamation_schedule WHERE singleton = 1
	`).get();
	if (raw?.required !== 0 && raw?.required !== 1) {
		throw new Error('Desktop project reclamation rescan state is invalid');
	}
	return raw.required === 1;
}

function removeStageRow(database: DatabaseSync, id: number): void {
	const result = database.prepare('DELETE FROM project_stage_inventory WHERE id = ?').run(id);
	if (result.changes !== 1) throw new Error('Desktop project stage inventory changed during cleanup');
}

function assertRealDirectory(path: string, label: string): void {
	if (lstatSync(path, { throwIfNoEntry: false })?.isDirectory() !== true) {
		throw new TypeError(`${label} is not a direct filesystem directory`);
	}
}

function syncDirectory(directory: string): void {
	if (process.platform === 'win32') return;
	const descriptor = openSync(directory, 'r');
	try {
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
}

function validateLeaseId(value: unknown): string {
	const leaseId = stringValue(value, 'project stage lease id');
	if (!LEASE_ID_PATTERN.test(leaseId)) throw new TypeError('Project stage lease id is invalid');
	return leaseId;
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
