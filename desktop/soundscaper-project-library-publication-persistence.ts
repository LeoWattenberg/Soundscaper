/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import {
	freezeRelativeFileForSoundscaperDesktopLibraryBinding,
} from './soundscaper-project-library-media-binding.ts';
import type {
	SoundscaperDesktopProjectLibraryPublicationPlan,
	SoundscaperDesktopProjectLibraryPlannedBody,
} from './soundscaper-project-library-publication-contract.ts';
import type {
	SoundscaperDesktopProjectLibraryPublicationStage,
} from './soundscaper-project-library-publication-files.ts';
import {
	parseSoundscaperDesktopLibraryMetadataJson,
	type SoundscaperDesktopLibraryMetadata,
} from './soundscaper-project-library-metadata.ts';
import {
	encodeSoundscaperDesktopProjectLibraryMetadataRow,
	sameSoundscaperDesktopProjectLibraryLease,
	type SoundscaperDesktopProjectLibraryLease,
	type SoundscaperDesktopProjectLibraryMetadataRow,
	validateSoundscaperDesktopProjectLibraryLeaseToken,
	validateSoundscaperDesktopProjectLibraryMetadataIntegrity,
	validateSoundscaperDesktopProjectLibraryMetadataRow,
} from './soundscaper-project-library-persistence-codecs.ts';
import {
	validateSoundscaperDesktopProjectLibraryTransferBody,
	validateSoundscaperDesktopProjectLibraryTransferBundle,
	type SoundscaperDesktopProjectLibraryTransferBody,
	type SoundscaperDesktopProjectLibraryTransferBundle,
} from './soundscaper-project-library-transfer-contract.ts';

export type SoundscaperDesktopProjectLibraryPublicationJournalState =
	| 'prepared'
	| 'materialized'
	| 'committed'
	| 'complete';

export interface SoundscaperDesktopProjectLibraryPersistedBody {
	readonly bodyId: string;
	readonly mediaRelativeFile: string;
	readonly descriptor: Readonly<SoundscaperDesktopProjectLibraryTransferBody>;
}

export interface SoundscaperDesktopProjectLibraryPersistedPublication {
	readonly transactionId: string;
	readonly state: SoundscaperDesktopProjectLibraryPublicationJournalState;
	readonly expectedMetadataRevision: number;
	readonly previousMetadata: Readonly<SoundscaperDesktopLibraryMetadata>;
	readonly nextMetadata: Readonly<SoundscaperDesktopLibraryMetadata>;
	readonly bundle: Readonly<SoundscaperDesktopProjectLibraryTransferBundle>;
	readonly document: string;
	readonly entryId: string;
	readonly projectRelativeFile: string;
	readonly bodies: readonly Readonly<SoundscaperDesktopProjectLibraryPersistedBody>[];
	readonly stages: readonly Readonly<SoundscaperDesktopProjectLibraryPublicationStage>[];
}

const BODY_FIELDS = ['bodyId', 'mediaRelativeFile', 'descriptor'] as const;
const STAGE_FIELDS = [
	'role', 'bodyId', 'stageRelativeFile', 'finalRelativeFile', 'byteLength', 'sha256',
] as const;
const DIGEST = /^[a-f0-9]{64}$/u;
const TRANSACTION_ID = /^[a-f0-9]{48}$/u;
const MAXIMUM_BODIES = 4_094;
const MAXIMUM_RETAINED_PUBLICATIONS = 32;

export function readSoundscaperDesktopProjectLibraryMetadataSnapshot(
	database: DatabaseSync,
): Readonly<{
	readonly row: SoundscaperDesktopProjectLibraryMetadataRow;
	readonly metadata: Readonly<SoundscaperDesktopLibraryMetadata>;
}> {
	const value = database.prepare(`
		SELECT revision, json, digest, published_at_ms AS publishedAtMs
		FROM library_metadata WHERE singleton = 1
	`).get();
	if (!value) throw new Error('Soundscaper desktop baseline metadata row is missing');
	const row = validateSoundscaperDesktopProjectLibraryMetadataRow(
		value as Record<string, unknown>,
		'Soundscaper desktop baseline publication metadata',
	);
	return Object.freeze({
		row,
		metadata: validateSoundscaperDesktopProjectLibraryMetadataIntegrity(
			row,
			'Soundscaper desktop baseline publication metadata',
		),
	});
}

export function assertSoundscaperDesktopProjectLibraryPublicationLease(
	database: DatabaseSync,
	value: SoundscaperDesktopProjectLibraryLease,
	now: number,
): SoundscaperDesktopProjectLibraryLease {
	const lease = validateSoundscaperDesktopProjectLibraryLeaseToken(value);
	const row = database.prepare(`
		SELECT active, lease_id AS leaseId, fencing_token AS fencingToken,
			owner_product AS ownerProduct, owner_process_id AS ownerProcessId,
			owner_instance_id AS ownerInstanceId, acquired_at_ms AS acquiredAtMs,
			expires_at_ms AS expiresAtMs, took_over AS tookOver
		FROM library_lease WHERE singleton = 1
	`).get() as Record<string, unknown> | undefined;
	if (!row || row.active !== 1) throw leaseLost();
	const current = validateSoundscaperDesktopProjectLibraryLeaseToken({
		leaseId: row.leaseId,
		fencingToken: row.fencingToken,
		owner: {
			product: row.ownerProduct,
			processId: row.ownerProcessId,
			instanceId: row.ownerInstanceId,
		},
		acquiredAtMs: row.acquiredAtMs,
		expiresAtMs: row.expiresAtMs,
		tookOverStaleLease: row.tookOver === 1,
	} as SoundscaperDesktopProjectLibraryLease);
	if (current.expiresAtMs <= now || !sameSoundscaperDesktopProjectLibraryLease(current, lease)) {
		throw leaseLost();
	}
	return current;
}

export function prepareSoundscaperDesktopProjectLibraryPublication(
	database: DatabaseSync,
	transactionId: string,
	plan: Readonly<SoundscaperDesktopProjectLibraryPublicationPlan>,
	stages: readonly Readonly<SoundscaperDesktopProjectLibraryPublicationStage>[],
	now: number,
): void {
	if (!TRANSACTION_ID.test(transactionId)) {
		throw new TypeError('Soundscaper desktop baseline publication transaction id is invalid');
	}
	transaction(database, () => {
		assertSoundscaperDesktopProjectLibraryPublicationLease(database, plan.lease, now);
		const current = readSoundscaperDesktopProjectLibraryMetadataSnapshot(database);
		assertMetadataSnapshot(current.metadata, plan.previousMetadata, 'changed before journal preparation');
		if (current.row.revision !== plan.expectedMetadataRevision) {
			throw new Error('Soundscaper desktop baseline metadata revision changed before journal preparation');
		}
		if (database.prepare(`
			SELECT 1 AS pending FROM publication_journal
			WHERE state IN ('prepared', 'materialized', 'committed') LIMIT 1
		`).get()) throw new Error('Soundscaper desktop baseline publication recovery is required');
		if (database.prepare(`
			SELECT 1 AS pending FROM metadata_journal
			WHERE state IN ('prepared', 'committed') LIMIT 1
		`).get()) throw new Error('Soundscaper desktop baseline metadata recovery is required before body publication');
		if (database.prepare(`
			SELECT 1 AS occupied FROM project_revisions
			WHERE project_id = ? AND project_revision = ?
		`).get(plan.bundle.project.projectId, plan.bundle.project.projectRevision)) {
			throw new Error('Soundscaper desktop baseline next project revision is occupied');
		}
		const previousJson = current.row.json;
		const next = encodeSoundscaperDesktopProjectLibraryMetadataRow(plan.nextMetadata, now);
		database.prepare(`
			INSERT INTO publication_journal (
				transaction_id, state, expected_metadata_revision,
				previous_metadata_json, previous_metadata_digest,
				next_metadata_json, next_metadata_digest,
				project_id, project_revision, project_sha256, entry_id,
				project_relative_file, project_byte_length, project_json,
				bodies_json, stages_json, lease_id, fencing_token, created_at_ms
			) VALUES (?, 'prepared', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			transactionId,
			plan.expectedMetadataRevision,
			previousJson,
			current.row.digest,
			next.json,
			next.digest,
			plan.bundle.project.projectId,
			plan.bundle.project.projectRevision,
			plan.bundle.project.sha256,
			plan.entryId,
			plan.projectRelativeFile,
			plan.bundle.project.byteLength,
			plan.document,
			JSON.stringify(plan.bodies.map(persistedBody)),
			JSON.stringify(stages),
			plan.lease.leaseId,
			plan.lease.fencingToken,
			now,
		);
	});
}

export function markSoundscaperDesktopProjectLibraryPublicationMaterialized(
	database: DatabaseSync,
	transactionId: string,
	lease: SoundscaperDesktopProjectLibraryLease,
	now: number,
): void {
	transaction(database, () => {
		const current = assertSoundscaperDesktopProjectLibraryPublicationLease(database, lease, now);
		const result = database.prepare(`
			UPDATE publication_journal
			SET state = 'materialized', lease_id = ?, fencing_token = ?
			WHERE transaction_id = ? AND state = 'prepared'
		`).run(current.leaseId, current.fencingToken, transactionId);
		if (result.changes !== 1) throw new Error('Soundscaper desktop baseline prepared publication is unavailable');
	});
}

export function commitSoundscaperDesktopProjectLibraryPublication(
	database: DatabaseSync,
	publication: Readonly<SoundscaperDesktopProjectLibraryPersistedPublication>,
	lease: SoundscaperDesktopProjectLibraryLease,
	now: number,
): void {
	transaction(database, () => {
		const currentLease = assertSoundscaperDesktopProjectLibraryPublicationLease(database, lease, now);
		const current = readSoundscaperDesktopProjectLibraryMetadataSnapshot(database);
		assertMetadataSnapshot(current.metadata, publication.previousMetadata, 'changed before publication commit');
		if (current.row.revision !== publication.expectedMetadataRevision) {
			throw new Error('Soundscaper desktop baseline metadata revision changed before publication commit');
		}
		const result = database.prepare(`
			INSERT INTO project_revisions (
				project_id, project_revision, project_sha256, entry_id, relative_file,
				byte_length, document_json, published_at_ms
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			publication.bundle.project.projectId,
			publication.bundle.project.projectRevision,
			publication.bundle.project.sha256,
			publication.entryId,
			publication.projectRelativeFile,
			publication.bundle.project.byteLength,
			publication.document,
			now,
		);
		if (result.changes !== 1) throw new Error('Soundscaper desktop baseline project revision could not publish');
		for (const [ordinal, body] of publication.bodies.entries()) {
			publishBody(database, body, now);
			database.prepare(`
				INSERT INTO project_revision_bodies
				(project_id, project_revision, ordinal, body_id) VALUES (?, ?, ?, ?)
			`).run(
				publication.bundle.project.projectId,
				publication.bundle.project.projectRevision,
				ordinal,
				body.bodyId,
			);
		}
		const next = encodeSoundscaperDesktopProjectLibraryMetadataRow(publication.nextMetadata, now);
		const metadata = database.prepare(`
			UPDATE library_metadata SET revision = ?, json = ?, digest = ?, published_at_ms = ?
			WHERE singleton = 1 AND revision = ? AND json = ? AND digest = ?
		`).run(
			next.revision, next.json, next.digest, now,
			current.row.revision, current.row.json, current.row.digest,
		);
		if (metadata.changes !== 1) throw new Error('Soundscaper desktop baseline publication lost metadata compare-and-swap');
		const journal = database.prepare(`
			UPDATE publication_journal
			SET state = 'committed', lease_id = ?, fencing_token = ?
			WHERE transaction_id = ? AND state = 'materialized'
		`).run(currentLease.leaseId, currentLease.fencingToken, publication.transactionId);
		if (journal.changes !== 1) throw new Error('Soundscaper desktop baseline publication journal could not commit');
	});
}

export function settleSoundscaperDesktopProjectLibraryPublication(
	database: DatabaseSync,
	transactionId: string,
	lease: SoundscaperDesktopProjectLibraryLease,
	now: number,
): void {
	transaction(database, () => {
		assertSoundscaperDesktopProjectLibraryPublicationLease(database, lease, now);
		const result = database.prepare(`
			UPDATE publication_journal SET state = 'complete', completed_at_ms = ?
			WHERE transaction_id = ? AND state = 'committed'
		`).run(now, transactionId);
		if (result.changes !== 1) throw new Error('Soundscaper desktop baseline publication journal could not complete');
		database.prepare(`
			DELETE FROM publication_journal WHERE transaction_id IN (
				SELECT transaction_id FROM publication_journal WHERE state = 'complete'
				ORDER BY completed_at_ms DESC, transaction_id DESC LIMIT -1 OFFSET ?
			)
		`).run(MAXIMUM_RETAINED_PUBLICATIONS);
	});
}

export function readSoundscaperDesktopProjectLibraryPendingPublication(
	database: DatabaseSync,
): Readonly<SoundscaperDesktopProjectLibraryPersistedPublication> | null {
	const rows = database.prepare(`
		SELECT * FROM publication_journal
		WHERE state IN ('prepared', 'materialized', 'committed')
		ORDER BY created_at_ms, transaction_id LIMIT 2
	`).all() as Record<string, unknown>[];
	if (rows.length > 1) throw new Error('Soundscaper desktop baseline has conflicting pending publications');
	return rows.length === 0 ? null : parsePublicationRow(rows[0]!);
}

export function readSoundscaperDesktopProjectLibraryPublicationById(
	database: DatabaseSync,
	transactionId: string,
): Readonly<SoundscaperDesktopProjectLibraryPersistedPublication> {
	const row = database.prepare('SELECT * FROM publication_journal WHERE transaction_id = ?')
		.get(transactionId) as Record<string, unknown> | undefined;
	if (!row) throw new Error('Soundscaper desktop baseline publication journal is missing');
	return parsePublicationRow(row);
}

function parsePublicationRow(
	row: Record<string, unknown>,
): Readonly<SoundscaperDesktopProjectLibraryPersistedPublication> {
	const transactionId = stringValue(row.transaction_id, 'publication transaction id');
	if (!TRANSACTION_ID.test(transactionId)) throw new TypeError('Soundscaper desktop baseline publication id is invalid');
	const state = publicationState(row.state);
	const expectedMetadataRevision = nonNegativeInteger(
		row.expected_metadata_revision,
		'expected metadata revision',
	);
	const previousJson = stringValue(row.previous_metadata_json, 'previous metadata JSON');
	const previousDigest = digest(row.previous_metadata_digest, 'previous metadata');
	if (createHash('sha256').update(previousJson, 'utf8').digest('hex') !== previousDigest) {
		throw new Error('Soundscaper desktop baseline previous metadata journal digest is invalid');
	}
	const nextJson = stringValue(row.next_metadata_json, 'next metadata JSON');
	const nextDigest = digest(row.next_metadata_digest, 'next metadata');
	if (createHash('sha256').update(nextJson, 'utf8').digest('hex') !== nextDigest) {
		throw new Error('Soundscaper desktop baseline next metadata journal digest is invalid');
	}
	const previousMetadata = parseSoundscaperDesktopLibraryMetadataJson(previousJson);
	const nextMetadata = parseSoundscaperDesktopLibraryMetadataJson(nextJson);
	if (previousMetadata.revision !== expectedMetadataRevision
		|| nextMetadata.revision !== expectedMetadataRevision + 1) {
		throw new Error('Soundscaper desktop baseline publication journal metadata revisions are invalid');
	}
	const projectId = stringValue(row.project_id, 'publication project id');
	const projectRevision = nonNegativeInteger(row.project_revision, 'publication project revision');
	const projectSha256 = digest(row.project_sha256, 'publication project');
	const document = stringValue(row.project_json, 'publication project JSON');
	const projectByteLength = positiveInteger(row.project_byte_length, 'publication project byte length');
	if (new TextEncoder().encode(document).byteLength !== projectByteLength
		|| createHash('sha256').update(document, 'utf8').digest('hex') !== projectSha256) {
		throw new Error('Soundscaper desktop baseline publication project journal integrity is invalid');
	}
	const bodies = parseBodies(row.bodies_json);
	const project = nextMetadata.projects.find((candidate) => candidate.projectId === projectId);
	if (!project || project.projectRevision !== projectRevision || project.sha256 !== projectSha256) {
		throw new Error('Soundscaper desktop baseline publication project disagrees with next metadata');
	}
	const bundle = validateSoundscaperDesktopProjectLibraryTransferBundle({
		metadataRevision: nextMetadata.revision,
		project,
		document,
		bodies: bodies.map(({ descriptor }) => descriptor),
	}, projectId);
	const entryId = stringValue(row.entry_id, 'publication entry id');
	const projectRelativeFile = stringValue(row.project_relative_file, 'publication project file');
	if (project.id !== entryId || project.metadataFile !== projectRelativeFile) {
		throw new Error('Soundscaper desktop baseline publication project path disagrees with metadata');
	}
	const stages = parseStages(
		row.stages_json,
		transactionId,
		projectRelativeFile,
		project.byteLength,
		project.sha256,
		bodies,
	);
	return Object.freeze({
		transactionId,
		state,
		expectedMetadataRevision,
		previousMetadata,
		nextMetadata,
		bundle,
		document,
		entryId,
		projectRelativeFile,
		bodies,
		stages,
	});
}

function parseBodies(value: unknown): readonly Readonly<SoundscaperDesktopProjectLibraryPersistedBody>[] {
	const parsed = parseJson(value, 'publication bodies');
	if (!Array.isArray(parsed) || parsed.length > MAXIMUM_BODIES) {
		throw new TypeError('Soundscaper desktop baseline publication bodies are invalid');
	}
	return Object.freeze(parsed.map((value) => {
		const record = closedRecord(value, BODY_FIELDS, 'publication body');
		const descriptor = validateSoundscaperDesktopProjectLibraryTransferBody(record.descriptor);
		const bodyId = stringValue(record.bodyId, 'publication body id');
		const expectedBodyId = descriptor.bindingId;
		if (bodyId !== expectedBodyId) throw new Error('Soundscaper desktop baseline publication body id is invalid');
		const mediaRelativeFile = stringValue(record.mediaRelativeFile, 'publication media file');
		const expectedFile = freezeRelativeFileForSoundscaperDesktopLibraryBinding(descriptor.bindingId);
		if (mediaRelativeFile !== expectedFile) {
			throw new Error('Soundscaper desktop baseline publication media path is invalid');
		}
		return Object.freeze({ bodyId, mediaRelativeFile, descriptor });
	}));
}

function parseStages(
	value: unknown,
	transactionId: string,
	projectRelativeFile: string,
	projectByteLength: number,
	projectSha256: string,
	bodies: readonly Readonly<SoundscaperDesktopProjectLibraryPersistedBody>[],
): readonly Readonly<SoundscaperDesktopProjectLibraryPublicationStage>[] {
	const parsed = parseJson(value, 'publication stages');
	if (!Array.isArray(parsed) || parsed.length !== bodies.length + 1) {
		throw new TypeError('Soundscaper desktop baseline publication stages are incomplete');
	}
	return Object.freeze(parsed.map((value, index) => {
		const record = closedRecord(value, STAGE_FIELDS, 'publication stage');
		const expectedBody = index === 0 ? null : bodies[index - 1]!;
		const role = index === 0 ? 'project' : 'body';
		const bodyId = expectedBody?.bodyId ?? null;
		const finalRelativeFile = index === 0
			? `projects/${projectRelativeFile}`
			: `media/${expectedBody!.mediaRelativeFile}`;
		const byteLength = index === 0 ? projectByteLength : expectedBody!.descriptor.byteLength;
		const sha256 = index === 0 ? projectSha256 : expectedBody!.descriptor.sha256;
		const expectedStage = `stage/${transactionId}-${String(index).padStart(4, '0')}.stage`;
		if (record.role !== role || record.bodyId !== bodyId
			|| record.stageRelativeFile !== expectedStage || record.finalRelativeFile !== finalRelativeFile
			|| record.byteLength !== byteLength || record.sha256 !== sha256) {
			throw new Error('Soundscaper desktop baseline publication stage identity is invalid');
		}
		return Object.freeze({
			role,
			bodyId,
			stageRelativeFile: expectedStage,
			finalRelativeFile,
			byteLength,
			sha256,
		});
	}));
}

function publishBody(
	database: DatabaseSync,
	body: Readonly<SoundscaperDesktopProjectLibraryPersistedBody>,
	now: number,
): void {
	const descriptorJson = JSON.stringify(body.descriptor);
	const existing = database.prepare('SELECT * FROM managed_bodies WHERE body_id = ?').get(
		body.bodyId,
	) as Record<string, unknown> | undefined;
	if (existing) {
		if (existing.kind !== body.descriptor.kind || existing.encoding !== body.descriptor.encoding
			|| existing.binding_id !== body.descriptor.bindingId
			|| existing.source_id !== body.descriptor.sourceId || existing.storage_key !== body.descriptor.storageKey
			|| existing.relative_file !== body.mediaRelativeFile || existing.mime_type !== body.descriptor.mimeType
			|| existing.byte_length !== body.descriptor.byteLength || existing.sha256 !== body.descriptor.sha256
			|| existing.descriptor_json !== descriptorJson || existing.state !== 'published') {
			throw new Error('Soundscaper desktop baseline managed body identity conflicts with existing publication');
		}
		return;
	}
	database.prepare(`
		INSERT INTO managed_bodies (
			body_id, kind, encoding, binding_id, source_id, storage_key, relative_file,
			mime_type, byte_length, sha256, descriptor_json, state, published_at_ms
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)
	`).run(
		body.bodyId,
		body.descriptor.kind,
		body.descriptor.encoding,
		body.descriptor.bindingId,
		body.descriptor.sourceId,
		body.descriptor.storageKey,
		body.mediaRelativeFile,
		body.descriptor.mimeType,
		body.descriptor.byteLength,
		body.descriptor.sha256,
		descriptorJson,
		now,
	);
}

function persistedBody(
	body: Readonly<SoundscaperDesktopProjectLibraryPlannedBody>,
): SoundscaperDesktopProjectLibraryPersistedBody {
	return {
		bodyId: body.bodyId,
		mediaRelativeFile: body.mediaRelativeFile,
		descriptor: body.descriptor,
	};
}

function assertMetadataSnapshot(
	left: Readonly<SoundscaperDesktopLibraryMetadata>,
	right: Readonly<SoundscaperDesktopLibraryMetadata>,
	message: string,
): void {
	if (JSON.stringify(left) !== JSON.stringify(right)) {
		throw new Error(`Soundscaper desktop baseline metadata ${message}`);
	}
}

function transaction<Result>(database: DatabaseSync, operation: () => Result): Result {
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

function publicationState(value: unknown): SoundscaperDesktopProjectLibraryPublicationJournalState {
	if (value !== 'prepared' && value !== 'materialized' && value !== 'committed' && value !== 'complete') {
		throw new TypeError('Soundscaper desktop baseline publication journal state is invalid');
	}
	return value;
}

function parseJson(value: unknown, label: string): unknown {
	const text = stringValue(value, label);
	try { return JSON.parse(text) as unknown; }
	catch (error) { throw new TypeError(`Soundscaper desktop baseline ${label} JSON is invalid`, { cause: error }); }
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`Soundscaper desktop baseline ${label} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`Soundscaper desktop baseline ${label} has invalid fields`);
	const record = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Soundscaper desktop baseline ${label}.${field} must be a data property`);
		}
		record[field] = descriptor.value;
	}
	return record;
}

function digest(value: unknown, label: string): string {
	const result = stringValue(value, `${label} digest`);
	if (!DIGEST.test(result)) throw new TypeError(`Soundscaper desktop baseline ${label} digest is invalid`);
	return result;
}

function stringValue(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError(`Soundscaper desktop baseline ${label} is invalid`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Soundscaper desktop baseline ${label} must be a non-negative safe integer`);
	}
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	const result = nonNegativeInteger(value, label);
	if (result === 0) throw new RangeError(`Soundscaper desktop baseline ${label} must be positive`);
	return result;
}

function leaseLost(): Error {
	return new Error('Soundscaper desktop baseline publication writer lease no longer owns its fence');
}
