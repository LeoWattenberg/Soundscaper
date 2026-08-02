/* SPDX-License-Identifier: AGPL-3.0-only */

import { DatabaseSync } from 'node:sqlite';

import {
	nonNegativeInteger,
	positiveInteger,
	selectDesktopLibraryManagedMediaRows,
	selectDesktopLibraryManagedMediaStageRows,
	validateDesktopLibraryManagedMediaInventoryRow,
	validateDesktopLibraryManagedMediaStageInventoryRow,
	type DesktopLibraryManagedMediaInventoryRow,
	type DesktopLibraryManagedMediaStageInventoryRow,
} from './project-library-media-inventory-schema.ts';

export type DesktopLibraryManagedMediaReclamationKind = 'media' | 'stage';

export interface DesktopLibraryManagedMediaInventoryBatch {
	readonly complete: boolean;
	readonly rows: readonly DesktopLibraryManagedMediaInventoryRow[];
}

export interface DesktopLibraryManagedMediaStageInventoryBatch {
	readonly complete: boolean;
	readonly rows: readonly DesktopLibraryManagedMediaStageInventoryRow[];
}

interface ReclamationState {
	readonly lastInventoryId: number;
	readonly cycleHighWaterId: number;
}

export function validateDesktopLibraryManagedMediaReclamationState(database: DatabaseSync): void {
	readReclamationState(database, 'managed_media_reclamation', 'managed-media');
	readReclamationState(database, 'managed_media_stage_reclamation', 'managed-media stage');
	readDesktopLibraryManagedMediaReclamationKind(database);
	readDesktopLibraryManagedMediaRescanRequired(database);
}

export function ensureDesktopLibraryManagedMediaReclamationCycle(database: DatabaseSync): void {
	if (readReclamationState(
		database,
		'managed_media_reclamation',
		'managed-media',
	).cycleHighWaterId === 0) restartDesktopLibraryManagedMediaReclamationCycle(database);
}

export function restartDesktopLibraryManagedMediaReclamationCycle(database: DatabaseSync): void {
	restartReclamationCycle(
		database,
		'managed_media_inventory',
		'managed_media_reclamation',
		'managed-media',
	);
}

export function ensureDesktopLibraryManagedMediaStageReclamationCycle(database: DatabaseSync): void {
	if (readReclamationState(
		database,
		'managed_media_stage_reclamation',
		'managed-media stage',
	).cycleHighWaterId === 0) restartDesktopLibraryManagedMediaStageReclamationCycle(database);
}

export function restartDesktopLibraryManagedMediaStageReclamationCycle(database: DatabaseSync): void {
	restartReclamationCycle(
		database,
		'managed_media_stage_inventory',
		'managed_media_stage_reclamation',
		'managed-media stage',
	);
}

export function readDesktopLibraryManagedMediaInventoryBatch(
	database: DatabaseSync,
	maximum: number,
): DesktopLibraryManagedMediaInventoryBatch {
	const batch = readRawBatch(
		database,
		'managed_media_inventory',
		'managed_media_reclamation',
		maximum,
		selectDesktopLibraryManagedMediaRows(),
		'media.id',
	);
	return Object.freeze({
		complete: batch.complete,
		rows: Object.freeze(batch.rows.map(validateDesktopLibraryManagedMediaInventoryRow)),
	});
}

export function readDesktopLibraryManagedMediaStageInventoryBatch(
	database: DatabaseSync,
	maximum: number,
): DesktopLibraryManagedMediaStageInventoryBatch {
	const batch = readRawBatch(
		database,
		'managed_media_stage_inventory',
		'managed_media_stage_reclamation',
		maximum,
		selectDesktopLibraryManagedMediaStageRows(),
		'stage.id',
	);
	return Object.freeze({
		complete: batch.complete,
		rows: Object.freeze(batch.rows.map(validateDesktopLibraryManagedMediaStageInventoryRow)),
	});
}

export function advanceDesktopLibraryManagedMediaReclamation(
	database: DatabaseSync,
	lastInventoryId: number,
	complete: boolean,
): void {
	advanceReclamation(database, 'managed_media_reclamation', lastInventoryId, complete, 'managed-media');
}

export function advanceDesktopLibraryManagedMediaStageReclamation(
	database: DatabaseSync,
	lastInventoryId: number,
	complete: boolean,
): void {
	advanceReclamation(
		database,
		'managed_media_stage_reclamation',
		lastInventoryId,
		complete,
		'managed-media stage',
	);
}

export function readDesktopLibraryManagedMediaReclamationKind(
	database: DatabaseSync,
): DesktopLibraryManagedMediaReclamationKind {
	const raw = database.prepare(`
		SELECT next_kind AS nextKind FROM managed_media_reclamation_schedule WHERE singleton = 1
	`).get();
	if (raw?.nextKind !== 'media' && raw?.nextKind !== 'stage') {
		throw new Error('Desktop library managed-media reclamation schedule is invalid');
	}
	return raw.nextKind;
}

export function setDesktopLibraryManagedMediaReclamationKind(
	database: DatabaseSync,
	nextKind: DesktopLibraryManagedMediaReclamationKind,
): void {
	if (nextKind !== 'media' && nextKind !== 'stage') {
		throw new TypeError('Desktop library managed-media reclamation kind is invalid');
	}
	database.prepare(`
		UPDATE managed_media_reclamation_schedule SET next_kind = ? WHERE singleton = 1
	`).run(nextKind);
}

export function markDesktopLibraryManagedMediaRescanRequired(database: DatabaseSync): void {
	database.prepare(`
		UPDATE managed_media_reclamation_schedule SET media_rescan_required = 1 WHERE singleton = 1
	`).run();
}

export function consumeDesktopLibraryManagedMediaRescanRequired(database: DatabaseSync): boolean {
	if (!readDesktopLibraryManagedMediaRescanRequired(database)) return false;
	const result = database.prepare(`
		UPDATE managed_media_reclamation_schedule SET media_rescan_required = 0
		WHERE singleton = 1 AND media_rescan_required = 1
	`).run();
	if (result.changes !== 1) throw new Error('Desktop library managed-media reclamation rescan state changed');
	return true;
}

function restartReclamationCycle(
	database: DatabaseSync,
	inventoryTable: string,
	stateTable: string,
	label: string,
): void {
	const raw = database.prepare(`SELECT MAX(id) AS highWater FROM ${inventoryTable}`).get();
	const highWater = raw?.highWater === null
		? 0
		: nonNegativeInteger(raw?.highWater, `${label} inventory high-water id`);
	database.prepare(`
		UPDATE ${stateTable} SET last_inventory_id = 0, cycle_high_water_id = ? WHERE singleton = 1
	`).run(highWater);
}

function readRawBatch(
	database: DatabaseSync,
	inventoryTable: string,
	stateTable: string,
	maximum: number,
	selection: string,
	qualifiedId: string,
): Readonly<{ complete: boolean; rows: Record<string, unknown>[] }> {
	const limit = positiveInteger(maximum, 'managed-media inventory batch limit');
	const state = readReclamationState(database, stateTable, 'managed-media');
	if (state.cycleHighWaterId === 0) return Object.freeze({ complete: true, rows: [] });
	const rows = database.prepare(`
		${selection} WHERE ${qualifiedId} > ? AND ${qualifiedId} <= ?
		ORDER BY ${qualifiedId} LIMIT ?
	`).all(state.lastInventoryId, state.cycleHighWaterId, limit);
	const lastId = rows.length === 0
		? state.lastInventoryId
		: positiveInteger(
			rows.at(-1)?.[inventoryTable === 'managed_media_inventory' ? 'inventoryId' : 'id'],
			'managed-media inventory id',
		);
	const complete = rows.length < limit || database.prepare(`
		SELECT 1 AS pending FROM ${inventoryTable} WHERE id > ? AND id <= ? LIMIT 1
	`).get(lastId, state.cycleHighWaterId) === undefined;
	return Object.freeze({ complete, rows });
}

function advanceReclamation(
	database: DatabaseSync,
	stateTable: string,
	lastInventoryId: number,
	complete: boolean,
	label: string,
): void {
	const state = readReclamationState(database, stateTable, label);
	const lastId = nonNegativeInteger(lastInventoryId, `${label} reclamation cursor`);
	if (typeof complete !== 'boolean') throw new TypeError(`${label} reclamation completion is invalid`);
	if (complete) {
		database.prepare(`
			UPDATE ${stateTable} SET last_inventory_id = 0, cycle_high_water_id = 0 WHERE singleton = 1
		`).run();
		return;
	}
	if (lastId <= state.lastInventoryId || lastId > state.cycleHighWaterId) {
		throw new Error(`Desktop library ${label} reclamation cursor cannot advance outside its cycle`);
	}
	database.prepare(`UPDATE ${stateTable} SET last_inventory_id = ? WHERE singleton = 1`).run(lastId);
}

function readReclamationState(database: DatabaseSync, table: string, label: string): ReclamationState {
	const raw = database.prepare(`
		SELECT last_inventory_id AS lastInventoryId, cycle_high_water_id AS cycleHighWaterId
		FROM ${table} WHERE singleton = 1
	`).get();
	if (!raw) throw new Error(`Desktop library ${label} reclamation state is missing`);
	const lastInventoryId = nonNegativeInteger(raw.lastInventoryId, `${label} reclamation cursor`);
	const cycleHighWaterId = nonNegativeInteger(raw.cycleHighWaterId, `${label} reclamation high-water id`);
	if (lastInventoryId > cycleHighWaterId || (cycleHighWaterId === 0 && lastInventoryId !== 0)) {
		throw new Error(`Desktop library ${label} reclamation state is invalid`);
	}
	return Object.freeze({ lastInventoryId, cycleHighWaterId });
}

function readDesktopLibraryManagedMediaRescanRequired(database: DatabaseSync): boolean {
	const raw = database.prepare(`
		SELECT media_rescan_required AS required
		FROM managed_media_reclamation_schedule WHERE singleton = 1
	`).get();
	if (raw?.required !== 0 && raw?.required !== 1) {
		throw new Error('Desktop library managed-media reclamation rescan state is invalid');
	}
	return raw.required === 1;
}
