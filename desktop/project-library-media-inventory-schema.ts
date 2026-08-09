/* SPDX-License-Identifier: AGPL-3.0-only */

import { DatabaseSync } from 'node:sqlite';

import type { DesktopLibraryLease, DesktopLibraryMedia } from './project-library-contract.ts';
import {
	createDesktopLibraryMediaBinding,
	DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
	DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING,
	DESKTOP_LIBRARY_VIDEO_TIMING_ENCODING,
	relativeFileForManagedMediaBinding,
	validatedManagedMediaBindingId,
	type DesktopLibraryManagedMediaEncoding,
} from './project-library-media-binding.ts';
import { LEASE_ID_PATTERN } from './project-library-persistence.ts';

const DIGEST = /^[a-f0-9]{64}$/u;
const STAGE_ID = /^[a-f0-9]{32}$/u;

export type DesktopLibraryManagedMediaInventoryState = 'planned' | 'materialized' | 'published';
export type DesktopLibraryManagedMediaStageKind = 'upload' | 'reuse';

export interface DesktopLibraryManagedMediaInventoryRow {
	readonly inventoryId: number;
	readonly bindingId: string;
	readonly relativeFile: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly encoding: DesktopLibraryManagedMediaEncoding;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly projectSha256: string;
	readonly storageKey: string;
	readonly state: DesktopLibraryManagedMediaInventoryState;
	readonly leaseId: string;
	readonly fencingToken: number;
	readonly registeredAtMs: number;
}

export interface DesktopLibraryManagedMediaStageInventoryRow {
	readonly id: number;
	readonly mediaInventoryId: number;
	readonly bindingId: string;
	readonly stageFile: string;
	readonly stageKind: DesktopLibraryManagedMediaStageKind;
	readonly leaseId: string;
	readonly fencingToken: number;
	readonly registeredAtMs: number;
}

export interface DesktopLibraryManagedMediaIdentity {
	readonly descriptor: DesktopLibraryMedia;
	readonly encoding: DesktopLibraryManagedMediaEncoding;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly projectSha256: string;
	readonly storageKey: string;
}

export interface DesktopLibraryManagedMediaLeaseFields {
	readonly leaseId: string;
	readonly fencingToken: number;
}

export function initializeDesktopLibraryManagedMediaInventorySchema(database: DatabaseSync): void {
	database.exec(`
		CREATE TABLE IF NOT EXISTS managed_media_inventory (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			binding_id TEXT NOT NULL UNIQUE,
			relative_file TEXT NOT NULL UNIQUE,
			portable_key TEXT NOT NULL UNIQUE,
			byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
			sha256 TEXT NOT NULL,
			encoding TEXT NOT NULL CHECK (encoding IN (
				'audio-f32le-chunks-v1',
				'video-original-v1',
				'soundscaper-video-timing-v1'
			)),
			project_id TEXT NOT NULL,
			project_revision INTEGER NOT NULL CHECK (project_revision >= 0),
			project_sha256 TEXT NOT NULL,
			storage_key TEXT NOT NULL,
			state TEXT NOT NULL CHECK (state IN ('planned', 'materialized', 'published')),
			lease_id TEXT NOT NULL,
			fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
			registered_at_ms INTEGER NOT NULL CHECK (registered_at_ms >= 0),
			CHECK (length(binding_id) = 65),
			CHECK (length(relative_file) BETWEEN 1 AND 1024),
			CHECK (length(portable_key) BETWEEN 1 AND 1024),
			CHECK (length(project_id) BETWEEN 1 AND 4096),
			CHECK (length(storage_key) BETWEEN 1 AND 4096)
		) STRICT;
		CREATE INDEX IF NOT EXISTS managed_media_inventory_project
			ON managed_media_inventory (project_id, project_revision, project_sha256, id);
		CREATE TABLE IF NOT EXISTS managed_media_stage_inventory (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			media_inventory_id INTEGER NOT NULL,
			stage_file TEXT NOT NULL UNIQUE,
			portable_key TEXT NOT NULL UNIQUE,
			kind TEXT NOT NULL CHECK (kind IN ('upload', 'reuse')),
			lease_id TEXT NOT NULL,
			fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
			registered_at_ms INTEGER NOT NULL CHECK (registered_at_ms >= 0),
			CHECK (length(stage_file) BETWEEN 1 AND 1024),
			CHECK (length(portable_key) BETWEEN 1 AND 1024),
			FOREIGN KEY (media_inventory_id) REFERENCES managed_media_inventory(id)
				ON DELETE RESTRICT
		) STRICT;
		CREATE INDEX IF NOT EXISTS managed_media_stage_inventory_media
			ON managed_media_stage_inventory (media_inventory_id, id);
		CREATE TABLE IF NOT EXISTS managed_media_reclamation (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			last_inventory_id INTEGER NOT NULL CHECK (last_inventory_id >= 0),
			cycle_high_water_id INTEGER NOT NULL CHECK (cycle_high_water_id >= last_inventory_id)
		) STRICT;
		INSERT OR IGNORE INTO managed_media_reclamation
			(singleton, last_inventory_id, cycle_high_water_id) VALUES (1, 0, 0);
		CREATE TABLE IF NOT EXISTS managed_media_stage_reclamation (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			last_inventory_id INTEGER NOT NULL CHECK (last_inventory_id >= 0),
			cycle_high_water_id INTEGER NOT NULL CHECK (cycle_high_water_id >= last_inventory_id)
		) STRICT;
		INSERT OR IGNORE INTO managed_media_stage_reclamation
			(singleton, last_inventory_id, cycle_high_water_id) VALUES (1, 0, 0);
		CREATE TABLE IF NOT EXISTS managed_media_reclamation_schedule (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			next_kind TEXT NOT NULL CHECK (next_kind IN ('media', 'stage')),
			media_rescan_required INTEGER NOT NULL CHECK (media_rescan_required IN (0, 1))
		) STRICT;
		INSERT OR IGNORE INTO managed_media_reclamation_schedule
			(singleton, next_kind, media_rescan_required) VALUES (1, 'stage', 0);
	`);
}

export function createDesktopLibraryManagedMediaStageFile(
	bindingId: string,
	stageId: string,
	stageKind: DesktopLibraryManagedMediaStageKind,
): string {
	const id = validatedManagedMediaBindingId(bindingId);
	if (!STAGE_ID.test(stageId)) throw new TypeError('Desktop library managed-media stage id is invalid');
	const kind = validateDesktopLibraryManagedMediaStageKind(stageKind);
	const relativeFile = relativeFileForManagedMediaBinding(id);
	const segments = relativeFile.split('/');
	const prefix = kind === 'upload' ? id : segments.at(-1) ?? '';
	return `${segments.slice(0, -1).join('/')}/.${prefix}.${stageId}.${kind === 'upload' ? 'stage' : 'reuse'}`;
}

export function validateDesktopLibraryManagedMediaStageFile(
	value: unknown,
	bindingId: string,
	stageKind: DesktopLibraryManagedMediaStageKind,
): string {
	if (typeof value !== 'string' || value.includes('\\')) {
		throw new TypeError('Desktop library managed-media stage file is invalid');
	}
	const canonicalBody = relativeFileForManagedMediaBinding(bindingId);
	const directory = canonicalBody.split('/').slice(0, -1).join('/');
	const fileName = value.startsWith(`${directory}/`) ? value.slice(directory.length + 1) : '';
	const prefix = stageKind === 'upload'
		? `.${bindingId}.`
		: `.${canonicalBody.split('/').at(-1) ?? ''}.`;
	const suffix = stageKind === 'upload' ? '.stage' : '.reuse';
	const stageId = fileName.startsWith(prefix) && fileName.endsWith(suffix)
		? fileName.slice(prefix.length, -suffix.length)
		: '';
	if (createDesktopLibraryManagedMediaStageFile(bindingId, stageId, stageKind) !== value) {
		throw new TypeError('Desktop library managed-media stage file is not canonical');
	}
	return value;
}

export function validateDesktopLibraryManagedMediaIdentity(
	descriptorValue: DesktopLibraryMedia,
	encodingValue: unknown,
	projectIdValue: unknown,
	projectRevisionValue: unknown,
	projectSha256Value: unknown,
	storageKeyValue: unknown,
): DesktopLibraryManagedMediaIdentity {
	const descriptor = validateDesktopLibraryManagedMediaDescriptor(descriptorValue);
	const encoding = validateEncoding(encodingValue);
	const projectId = stringValue(projectIdValue, 'managed-media project identity');
	const projectRevision = nonNegativeInteger(projectRevisionValue, 'managed-media project revision');
	const projectSha256 = digest(projectSha256Value, 'managed-media project digest');
	const storageKey = stringValue(storageKeyValue, 'managed-media storage key');
	const binding = createDesktopLibraryMediaBinding(
		encoding, projectId, storageKey, projectRevision, projectSha256,
	);
	if (binding.id !== descriptor.id || binding.relativeFile !== descriptor.relativeFile) {
		throw new Error('Desktop library managed-media descriptor does not match its provenance');
	}
	return Object.freeze({
		descriptor, encoding, projectId, projectRevision, projectSha256, storageKey,
	});
}

export function validateDesktopLibraryManagedMediaDescriptor(
	value: DesktopLibraryMedia,
): DesktopLibraryMedia {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop library managed-media descriptor is invalid');
	}
	const id = validatedManagedMediaBindingId(value.id);
	if (value.relativeFile !== relativeFileForManagedMediaBinding(id)) {
		throw new TypeError('Desktop library managed-media descriptor path is not canonical');
	}
	return Object.freeze({
		id,
		relativeFile: value.relativeFile,
		byteLength: nonNegativeInteger(value.byteLength, 'managed-media descriptor byte length'),
		sha256: digest(value.sha256, 'managed-media descriptor digest'),
	});
}

export function validateDesktopLibraryManagedMediaInventoryRow(
	raw: Record<string, unknown>,
): DesktopLibraryManagedMediaInventoryRow {
	const identity = validateDesktopLibraryManagedMediaIdentity(
		{
			id: stringValue(raw.bindingId, 'managed-media binding id'),
			relativeFile: stringValue(raw.relativeFile, 'managed-media relative file'),
			byteLength: raw.byteLength as number,
			sha256: stringValue(raw.sha256, 'managed-media descriptor digest'),
		},
		raw.encoding,
		raw.projectId,
		raw.projectRevision,
		raw.projectSha256,
		raw.storageKey,
	);
	const portableKey = stringValue(raw.portableKey, 'managed-media portable key');
	if (portableKey !== portablePathKey(identity.descriptor.relativeFile)) {
		throw new Error('Desktop library managed-media inventory portable key is invalid');
	}
	return Object.freeze({
		inventoryId: positiveInteger(raw.inventoryId, 'managed-media inventory id'),
		bindingId: identity.descriptor.id,
		relativeFile: identity.descriptor.relativeFile,
		byteLength: identity.descriptor.byteLength,
		sha256: identity.descriptor.sha256,
		encoding: identity.encoding,
		projectId: identity.projectId,
		projectRevision: identity.projectRevision,
		projectSha256: identity.projectSha256,
		storageKey: identity.storageKey,
		state: validateInventoryState(raw.state),
		leaseId: validateDesktopLibraryManagedMediaLeaseId(raw.leaseId, 'managed-media inventory'),
		fencingToken: positiveInteger(raw.fencingToken, 'managed-media inventory fencing token'),
		registeredAtMs: nonNegativeInteger(raw.registeredAtMs, 'managed-media registration time'),
	});
}

export function validateDesktopLibraryManagedMediaStageInventoryRow(
	raw: Record<string, unknown>,
): DesktopLibraryManagedMediaStageInventoryRow {
	const bindingId = validatedManagedMediaBindingId(raw.bindingId);
	if (raw.mediaState !== 'planned') {
		throw new Error('Desktop library managed-media stage inventory body is not planned');
	}
	const stageKind = validateDesktopLibraryManagedMediaStageKind(raw.stageKind);
	const stageFile = validateDesktopLibraryManagedMediaStageFile(raw.stageFile, bindingId, stageKind);
	if (stringValue(raw.portableKey, 'managed-media stage portable key') !== portablePathKey(stageFile)) {
		throw new Error('Desktop library managed-media stage portable key is invalid');
	}
	return Object.freeze({
		id: positiveInteger(raw.id, 'managed-media stage inventory id'),
		mediaInventoryId: positiveInteger(raw.mediaInventoryId, 'managed-media inventory id'),
		bindingId,
		stageFile,
		stageKind,
		leaseId: validateDesktopLibraryManagedMediaLeaseId(raw.leaseId, 'managed-media stage inventory'),
		fencingToken: positiveInteger(raw.fencingToken, 'managed-media stage fencing token'),
		registeredAtMs: nonNegativeInteger(raw.registeredAtMs, 'managed-media stage registration time'),
	});
}

export function validateDesktopLibraryManagedMediaLease(
	lease: DesktopLibraryLease,
	label: string,
): DesktopLibraryManagedMediaLeaseFields {
	if (!lease || typeof lease !== 'object') throw new TypeError(`Desktop library ${label} lease is invalid`);
	return Object.freeze({
		leaseId: validateDesktopLibraryManagedMediaLeaseId(lease.leaseId, label),
		fencingToken: positiveInteger(lease.fencingToken, `${label} fencing token`),
	});
}

export function validateDesktopLibraryManagedMediaStageKind(
	value: unknown,
): DesktopLibraryManagedMediaStageKind {
	if (value !== 'upload' && value !== 'reuse') {
		throw new TypeError('Desktop library managed-media stage kind is invalid');
	}
	return value;
}

export function selectDesktopLibraryManagedMediaRows(): string {
	return `SELECT media.id AS inventoryId, media.binding_id AS bindingId,
		media.relative_file AS relativeFile, media.portable_key AS portableKey,
		media.byte_length AS byteLength, media.sha256, media.encoding,
		media.project_id AS projectId, media.project_revision AS projectRevision,
		media.project_sha256 AS projectSha256, media.storage_key AS storageKey,
		media.state, media.lease_id AS leaseId, media.fencing_token AS fencingToken,
		media.registered_at_ms AS registeredAtMs FROM managed_media_inventory AS media`;
}

export function selectDesktopLibraryManagedMediaStageRows(): string {
	return `SELECT stage.id, stage.media_inventory_id AS mediaInventoryId,
		media.binding_id AS bindingId, media.state AS mediaState, stage.stage_file AS stageFile,
		stage.portable_key AS portableKey, stage.kind AS stageKind,
		stage.lease_id AS leaseId, stage.fencing_token AS fencingToken,
		stage.registered_at_ms AS registeredAtMs
		FROM managed_media_stage_inventory AS stage
		LEFT JOIN managed_media_inventory AS media ON media.id = stage.media_inventory_id`;
}

export function portablePathKey(value: string): string {
	return value.toLowerCase();
}

export function positiveInteger(value: unknown, label: string): number {
	const integer = nonNegativeInteger(value, label);
	if (integer === 0) throw new RangeError(`${label} must be positive`);
	return integer;
}

export function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${label} must be a non-negative safe integer`);
	}
	return value;
}

function validateEncoding(value: unknown): DesktopLibraryManagedMediaEncoding {
	if (value !== DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING
		&& value !== DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING
		&& value !== DESKTOP_LIBRARY_VIDEO_TIMING_ENCODING) {
		throw new TypeError('Desktop library managed-media encoding is unsupported');
	}
	return value;
}

function validateInventoryState(value: unknown): DesktopLibraryManagedMediaInventoryState {
	if (value !== 'planned' && value !== 'materialized' && value !== 'published') {
		throw new TypeError('Desktop library managed-media inventory state is invalid');
	}
	return value;
}

function validateDesktopLibraryManagedMediaLeaseId(value: unknown, label: string): string {
	const leaseId = stringValue(value, `${label} lease id`);
	if (!LEASE_ID_PATTERN.test(leaseId)) throw new TypeError(`Desktop library ${label} lease id is invalid`);
	return leaseId;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !DIGEST.test(value)) throw new TypeError(`${label} is invalid`);
	return value;
}

function stringValue(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is invalid`);
	return value;
}
