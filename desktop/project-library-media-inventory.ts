/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import {
	closeSync,
	fsyncSync,
	lstatSync,
	openSync,
	renameSync,
	unlinkSync,
} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';

import type { DesktopLibraryLease, DesktopLibraryMedia } from './project-library-contract.ts';
import {
	initializeDesktopLibraryManagedMediaInventorySchema,
	nonNegativeInteger,
	portablePathKey,
	positiveInteger,
	selectDesktopLibraryManagedMediaRows,
	selectDesktopLibraryManagedMediaStageRows,
	validateDesktopLibraryManagedMediaDescriptor,
	validateDesktopLibraryManagedMediaIdentity,
	validateDesktopLibraryManagedMediaInventoryRow,
	validateDesktopLibraryManagedMediaLease,
	validateDesktopLibraryManagedMediaStageFile,
	validateDesktopLibraryManagedMediaStageInventoryRow,
	validateDesktopLibraryManagedMediaStageKind,
	type DesktopLibraryManagedMediaInventoryRow,
	type DesktopLibraryManagedMediaLeaseFields,
	type DesktopLibraryManagedMediaStageInventoryRow,
	type DesktopLibraryManagedMediaStageKind,
} from './project-library-media-inventory-schema.ts';
import {
	validateDesktopLibraryManagedMediaReclamationState,
} from './project-library-media-inventory-reclamation.ts';
import {
	relativeFileForManagedMediaBinding,
	validatedManagedMediaBindingId,
	type DesktopLibraryManagedMediaEncoding,
} from './project-library-media-binding.ts';

export {
	consumeDesktopLibraryManagedMediaRescanRequired,
	ensureDesktopLibraryManagedMediaReclamationCycle,
	ensureDesktopLibraryManagedMediaStageReclamationCycle,
	advanceDesktopLibraryManagedMediaReclamation,
	advanceDesktopLibraryManagedMediaStageReclamation,
	markDesktopLibraryManagedMediaRescanRequired,
	readDesktopLibraryManagedMediaInventoryBatch,
	readDesktopLibraryManagedMediaReclamationKind,
	readDesktopLibraryManagedMediaStageInventoryBatch,
	restartDesktopLibraryManagedMediaReclamationCycle,
	restartDesktopLibraryManagedMediaStageReclamationCycle,
	setDesktopLibraryManagedMediaReclamationKind,
} from './project-library-media-inventory-reclamation.ts';
export { createDesktopLibraryManagedMediaStageFile } from './project-library-media-inventory-schema.ts';
export type {
	DesktopLibraryManagedMediaInventoryBatch,
	DesktopLibraryManagedMediaReclamationKind,
	DesktopLibraryManagedMediaStageInventoryBatch,
} from './project-library-media-inventory-reclamation.ts';
export type {
	DesktopLibraryManagedMediaInventoryRow,
	DesktopLibraryManagedMediaInventoryState,
	DesktopLibraryManagedMediaStageInventoryRow,
	DesktopLibraryManagedMediaStageKind,
} from './project-library-media-inventory-schema.ts';

export interface DesktopLibraryManagedMediaReservationOptions {
	readonly lease: DesktopLibraryLease;
	readonly descriptor: DesktopLibraryMedia;
	readonly encoding: DesktopLibraryManagedMediaEncoding;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly projectSha256: string;
	readonly storageKey: string;
	readonly registeredAtMs: number;
	readonly stageFile: string;
	readonly stageKind: DesktopLibraryManagedMediaStageKind;
}

export interface DesktopLibraryManagedMediaStageOperationOptions {
	readonly lease: DesktopLibraryLease;
	readonly descriptor: DesktopLibraryMedia;
	readonly stageFile: string;
	readonly stageKind: DesktopLibraryManagedMediaStageKind;
}

export interface DesktopLibraryManagedMediaStageDiscardOptions
	extends DesktopLibraryManagedMediaStageOperationOptions {
	readonly removeFile: boolean;
}

export interface DesktopLibraryManagedMediaPublicationOptions {
	readonly lease: DesktopLibraryLease;
	readonly descriptor: DesktopLibraryMedia;
}

export function initializeDesktopLibraryManagedMediaInventory(database: DatabaseSync): void {
	initializeDesktopLibraryManagedMediaInventorySchema(database);
}

export function validateDesktopLibraryManagedMediaInventory(database: DatabaseSync): void {
	validateDesktopLibraryManagedMediaReclamationState(database);
}

export function reserveDesktopLibraryManagedMediaFile(
	database: DatabaseSync,
	options: DesktopLibraryManagedMediaReservationOptions,
): DesktopLibraryManagedMediaInventoryRow {
	const reservation = validateReservation(options);
	return withImmediateTransaction(database, () => {
		const existing = readDesktopLibraryManagedMediaInventoryRow(
			database,
			reservation.descriptor.id,
		);
		if (existing) return retryExistingReservation(database, existing, reservation);
		database.prepare(`
			INSERT INTO managed_media_inventory
				(binding_id, relative_file, portable_key, byte_length, sha256, encoding,
				project_id, project_revision, project_sha256, storage_key, state,
				lease_id, fencing_token, registered_at_ms)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?)
		`).run(
			reservation.descriptor.id,
			reservation.descriptor.relativeFile,
			portablePathKey(reservation.descriptor.relativeFile),
			reservation.descriptor.byteLength,
			reservation.descriptor.sha256,
			reservation.encoding,
			reservation.projectId,
			reservation.projectRevision,
			reservation.projectSha256,
			reservation.storageKey,
			reservation.leaseId,
			reservation.fencingToken,
			reservation.registeredAtMs,
		);
		const media = requiredMediaRow(database, reservation.descriptor.id);
		insertStageRow(database, media.inventoryId, reservation);
		return media;
	});
}

export function discardDesktopLibraryManagedMediaStageFile(
	database: DatabaseSync,
	managedMediaRoot: string,
	options: DesktopLibraryManagedMediaStageDiscardOptions,
): boolean {
	if (typeof options.removeFile !== 'boolean') {
		throw new TypeError('Desktop library managed-media stage cleanup mode is invalid');
	}
	const operation = validateStageOperation(options);
	return withImmediateTransaction(database, () => {
		const stage = readStageRow(database, operation.stageFile);
		if (!stage) return false;
		const media = requiredMediaRowById(database, stage.mediaInventoryId);
		if (!sameDescriptor(media, operation.descriptor)
			|| stage.bindingId !== media.bindingId
			|| stage.stageKind !== operation.stageKind
			|| !sameLeaseFields(stage, operation)
			|| !sameLeaseFields(media, operation)) return false;
		if (options.removeFile) removeRegisteredStageFile(managedMediaRoot, stage.stageFile);
		removeStageRow(database, stage.id);
		return true;
	});
}

export function materializeDesktopLibraryManagedMediaStageFile(
	database: DatabaseSync,
	managedMediaRoot: string,
	options: DesktopLibraryManagedMediaStageOperationOptions,
): void {
	const operation = validateStageOperation(options);
	withImmediateTransaction(database, () => {
		const media = requiredMediaRow(database, operation.descriptor.id);
		if (!sameDescriptor(media, operation.descriptor)) {
			throw new Error('Desktop library managed-media inventory descriptor does not match materialization');
		}
		if (media.state !== 'planned') {
			throw new Error('Desktop library managed-media inventory reservation is not planned');
		}
		if (!sameLeaseFields(media, operation)) {
			throw new Error('Desktop library managed-media inventory reservation belongs to another lease');
		}
		const stage = requiredStageRow(database, operation.stageFile);
		if (stage.mediaInventoryId !== media.inventoryId || stage.bindingId !== media.bindingId
			|| stage.stageKind !== operation.stageKind || !sameLeaseFields(stage, operation)) {
			throw new Error('Desktop library managed-media stage reservation belongs to another lease or body');
		}
		const { directory, finalPath, stagePath } = inventoryPaths(
			managedMediaRoot,
			media.relativeFile,
			stage.stageFile,
		);
		assertManagedMediaDirectories(managedMediaRoot, media.relativeFile);
		if (lstatSync(stagePath, { throwIfNoEntry: false })?.isFile() !== true) {
			throw new TypeError('Desktop library managed-media inventory stage is not a regular file');
		}
		if (lstatSync(finalPath, { throwIfNoEntry: false }) !== undefined) {
			throw new Error('Desktop library managed-media inventory final path already exists');
		}
		renameSync(stagePath, finalPath);
		syncDirectory(directory);
		const updated = database.prepare(`
			UPDATE managed_media_inventory SET state = 'materialized'
			WHERE id = ? AND state = 'planned' AND lease_id = ? AND fencing_token = ?
		`).run(media.inventoryId, operation.leaseId, operation.fencingToken);
		if (updated.changes !== 1) {
			throw new Error('Desktop library managed-media inventory changed during materialization');
		}
		removeStageRow(database, stage.id);
	});
}

export function assertDesktopLibraryManagedMediaMaterialized(
	database: DatabaseSync,
	descriptorValue: DesktopLibraryMedia,
): void {
	const descriptor = validateDesktopLibraryManagedMediaDescriptor(descriptorValue);
	const media = readDesktopLibraryManagedMediaInventoryRow(database, descriptor.id);
	if (!media) throw publicationInventoryError();
	if (!sameDescriptor(media, descriptor)) {
		throw new Error('Desktop library managed-media publication descriptor conflicts with its inventory row');
	}
	if (media.state !== 'materialized' && media.state !== 'published') throw publicationInventoryError();
}

export function markDesktopLibraryManagedMediaPublished(
	database: DatabaseSync,
	options: DesktopLibraryManagedMediaPublicationOptions,
): void {
	const descriptor = validateDesktopLibraryManagedMediaDescriptor(options.descriptor);
	validateDesktopLibraryManagedMediaLease(options.lease, 'managed-media publication');
	withImmediateTransaction(database, () => {
		const media = requiredMediaRow(database, descriptor.id);
		if (!sameDescriptor(media, descriptor)) {
			throw new Error('Desktop library managed-media publication descriptor conflicts with its inventory row');
		}
		if (media.state === 'published') return;
		if (media.state !== 'materialized') throw publicationInventoryError();
		const updated = database.prepare(`
			UPDATE managed_media_inventory SET state = 'published'
			WHERE id = ? AND state = 'materialized'
		`).run(media.inventoryId);
		if (updated.changes !== 1) {
			throw new Error('Desktop library managed-media inventory changed during publication');
		}
	});
}

export function readDesktopLibraryManagedMediaInventoryRow(
	database: DatabaseSync,
	bindingId: string,
): DesktopLibraryManagedMediaInventoryRow | null {
	const descriptorId = validatedManagedMediaBindingId(bindingId);
	const raw = database.prepare(`
		${selectDesktopLibraryManagedMediaRows()} WHERE media.binding_id = ?
	`).get(descriptorId);
	return raw ? validateDesktopLibraryManagedMediaInventoryRow(raw) : null;
}

export function hasDesktopLibraryManagedMediaStageInventoryRows(
	database: DatabaseSync,
	mediaInventoryId: number,
): boolean {
	return database.prepare(`
		SELECT 1 AS registered FROM managed_media_stage_inventory
		WHERE media_inventory_id = ? LIMIT 1
	`).get(positiveInteger(mediaInventoryId, 'managed-media inventory id')) !== undefined;
}

export function removeDesktopLibraryManagedMediaInventoryRow(database: DatabaseSync, id: number): void {
	database.prepare('DELETE FROM managed_media_inventory WHERE id = ?')
		.run(positiveInteger(id, 'managed-media inventory id'));
}

export function removeDesktopLibraryManagedMediaStageInventoryRow(database: DatabaseSync, id: number): void {
	removeStageRow(database, positiveInteger(id, 'managed-media stage inventory id'));
}

export function createDesktopLibraryManagedMediaQuarantineFile(relativeFile: string): string {
	const bindingId = validatedManagedMediaBindingId(bindingIdForRelativeFile(relativeFile));
	if (relativeFileForManagedMediaBinding(bindingId) !== relativeFile) {
		throw new TypeError('Desktop library managed-media inventory file is not canonical');
	}
	const segments = relativeFile.split('/');
	const digest = createHash('sha256').update(portablePathKey(relativeFile), 'utf8').digest('hex');
	return `${segments.slice(0, -1).join('/')}/.${digest}.orphan`;
}

function retryExistingReservation(
	database: DatabaseSync,
	existing: DesktopLibraryManagedMediaInventoryRow,
	reservation: ReturnType<typeof validateReservation>,
): DesktopLibraryManagedMediaInventoryRow {
	assertSameIdentity(existing, reservation);
	if (existing.state !== 'planned') {
		if (hasDesktopLibraryManagedMediaStageInventoryRows(database, existing.inventoryId)) {
			throw new Error('Desktop library managed-media materialized retry has an outstanding stage');
		}
		database.prepare(`
			UPDATE managed_media_inventory
			SET lease_id = ?, fencing_token = ?, registered_at_ms = ? WHERE id = ?
		`).run(
			reservation.leaseId,
			reservation.fencingToken,
			reservation.registeredAtMs,
			existing.inventoryId,
		);
		return requiredMediaRowById(database, existing.inventoryId);
	}
	if (!sameLeaseFields(existing, reservation)) {
		throw new Error('Desktop library managed-media planned retry belongs to another lease');
	}
	if (hasDesktopLibraryManagedMediaStageInventoryRows(database, existing.inventoryId)) {
		throw new Error('Desktop library managed-media planned retry has an outstanding stage');
	}
	insertStageRow(database, existing.inventoryId, reservation);
	return existing;
}

function insertStageRow(
	database: DatabaseSync,
	mediaInventoryId: number,
	reservation: ReturnType<typeof validateReservation>,
): void {
	database.prepare(`
		INSERT INTO managed_media_stage_inventory
			(media_inventory_id, stage_file, portable_key, kind,
			lease_id, fencing_token, registered_at_ms)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`).run(
		mediaInventoryId,
		reservation.stageFile,
		portablePathKey(reservation.stageFile),
		reservation.stageKind,
		reservation.leaseId,
		reservation.fencingToken,
		reservation.registeredAtMs,
	);
}

function validateReservation(options: DesktopLibraryManagedMediaReservationOptions) {
	const identity = validateDesktopLibraryManagedMediaIdentity(
		options.descriptor,
		options.encoding,
		options.projectId,
		options.projectRevision,
		options.projectSha256,
		options.storageKey,
	);
	const stageKind = validateDesktopLibraryManagedMediaStageKind(options.stageKind);
	return Object.freeze({
		...identity,
		stageKind,
		stageFile: validateDesktopLibraryManagedMediaStageFile(
			options.stageFile,
			identity.descriptor.id,
			stageKind,
		),
		...validateDesktopLibraryManagedMediaLease(options.lease, 'managed-media reservation'),
		registeredAtMs: nonNegativeInteger(options.registeredAtMs, 'managed-media registration time'),
	});
}

function validateStageOperation(options: DesktopLibraryManagedMediaStageOperationOptions) {
	const descriptor = validateDesktopLibraryManagedMediaDescriptor(options.descriptor);
	const stageKind = validateDesktopLibraryManagedMediaStageKind(options.stageKind);
	return Object.freeze({
		descriptor,
		stageKind,
		stageFile: validateDesktopLibraryManagedMediaStageFile(
			options.stageFile,
			descriptor.id,
			stageKind,
		),
		...validateDesktopLibraryManagedMediaLease(options.lease, 'managed-media stage'),
	});
}

function requiredMediaRow(
	database: DatabaseSync,
	bindingId: string,
): DesktopLibraryManagedMediaInventoryRow {
	const row = readDesktopLibraryManagedMediaInventoryRow(database, bindingId);
	if (!row) throw new Error('Desktop library managed-media inventory reservation is missing');
	return row;
}

function requiredMediaRowById(
	database: DatabaseSync,
	inventoryId: number,
): DesktopLibraryManagedMediaInventoryRow {
	const raw = database.prepare(`
		${selectDesktopLibraryManagedMediaRows()} WHERE media.id = ?
	`).get(inventoryId);
	if (!raw) throw new Error('Desktop library managed-media inventory reservation is missing');
	return validateDesktopLibraryManagedMediaInventoryRow(raw);
}

function readStageRow(
	database: DatabaseSync,
	stageFile: string,
): DesktopLibraryManagedMediaStageInventoryRow | null {
	const raw = database.prepare(`
		${selectDesktopLibraryManagedMediaStageRows()} WHERE stage.stage_file = ?
	`).get(stageFile);
	return raw ? validateDesktopLibraryManagedMediaStageInventoryRow(raw) : null;
}

function requiredStageRow(
	database: DatabaseSync,
	stageFile: string,
): DesktopLibraryManagedMediaStageInventoryRow {
	const row = readStageRow(database, stageFile);
	if (!row) throw new Error('Desktop library managed-media stage inventory reservation is missing');
	return row;
}

function removeRegisteredStageFile(rootValue: string, stageFile: string): void {
	const root = absoluteRoot(rootValue);
	const stagePath = scopedPath(root, stageFile);
	const segments = stageFile.split('/');
	assertInventoryDirectories(root, segments);
	const metadata = lstatSync(stagePath, { throwIfNoEntry: false });
	if (metadata && !metadata.isFile()) {
		throw new TypeError('Desktop library managed-media stage cleanup target is not a regular file');
	}
	if (!metadata) return;
	unlinkSync(stagePath);
	syncDirectory(scopedPath(root, segments.slice(0, -1).join('/')));
}

function inventoryPaths(rootValue: string, relativeFile: string, stageFile: string) {
	const root = absoluteRoot(rootValue);
	const segments = relativeFile.split('/');
	return Object.freeze({
		directory: scopedPath(root, segments.slice(0, -1).join('/')),
		finalPath: scopedPath(root, relativeFile),
		stagePath: scopedPath(root, stageFile),
	});
}

function assertManagedMediaDirectories(rootValue: string, relativeFile: string): void {
	const root = absoluteRoot(rootValue);
	assertInventoryDirectories(root, relativeFile.split('/'));
}

function assertInventoryDirectories(root: string, segments: string[]): void {
	for (const relativeDirectory of ['', segments[0] ?? '', segments.slice(0, 2).join('/')]) {
		const path = relativeDirectory ? scopedPath(root, relativeDirectory) : root;
		if (lstatSync(path, { throwIfNoEntry: false })?.isDirectory() !== true) {
			throw new TypeError('Desktop library managed-media inventory scope is not a direct filesystem directory');
		}
	}
}

function assertSameIdentity(
	actual: DesktopLibraryManagedMediaInventoryRow,
	expected: ReturnType<typeof validateReservation>,
): void {
	if (!sameDescriptor(actual, expected.descriptor)
		|| actual.encoding !== expected.encoding
		|| actual.projectId !== expected.projectId
		|| actual.projectRevision !== expected.projectRevision
		|| actual.projectSha256 !== expected.projectSha256
		|| actual.storageKey !== expected.storageKey) {
		throw new Error('Desktop library immutable managed-media inventory conflict');
	}
}

function sameDescriptor(actual: DesktopLibraryManagedMediaInventoryRow, expected: DesktopLibraryMedia): boolean {
	return actual.bindingId === expected.id && actual.relativeFile === expected.relativeFile
		&& actual.byteLength === expected.byteLength && actual.sha256 === expected.sha256;
}

function sameLeaseFields(
	actual: DesktopLibraryManagedMediaLeaseFields,
	expected: DesktopLibraryManagedMediaLeaseFields,
): boolean {
	return actual.leaseId === expected.leaseId && actual.fencingToken === expected.fencingToken;
}

function withImmediateTransaction<Result>(database: DatabaseSync, operation: () => Result): Result {
	if (database.isTransaction) return operation();
	database.exec('BEGIN IMMEDIATE');
	try {
		const result = operation();
		database.exec('COMMIT');
		return result;
	} catch (error) {
		if (database.isTransaction) database.exec('ROLLBACK');
		throw error;
	}
}

function removeStageRow(database: DatabaseSync, id: number): void {
	const result = database.prepare('DELETE FROM managed_media_stage_inventory WHERE id = ?').run(id);
	if (result.changes !== 1) throw new Error('Desktop library managed-media stage inventory changed during cleanup');
}

function publicationInventoryError(): Error {
	return new Error('Desktop library publication requires a materialized managed-media inventory row');
}

function bindingIdForRelativeFile(relativeFile: string): string {
	if (typeof relativeFile !== 'string' || relativeFile.includes('\\')) {
		throw new TypeError('Desktop library managed-media inventory file is invalid');
	}
	const name = relativeFile.split('/').at(-1) ?? '';
	return name.endsWith('.f32c') ? name.slice(0, -'.f32c'.length)
		: name.endsWith('.bin') ? name.slice(0, -'.bin'.length) : '';
}

function absoluteRoot(value: unknown): string {
	if (typeof value !== 'string' || value.includes('\0') || !isAbsolute(value)) {
		throw new TypeError('Desktop library managed-media inventory root must be an absolute path');
	}
	return normalize(value);
}

function scopedPath(root: string, relativeFile: string): string {
	const path = resolve(root, ...relativeFile.split('/'));
	const child = relative(root, path);
	if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
		throw new TypeError('Desktop library managed-media inventory path leaves its fixed scope');
	}
	return path;
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
