/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import {
	proxyRelativeFileForFramescaperDesktopLibraryBinding,
} from './project-library-v10-media-binding.ts';
import type {
	FramescaperDesktopProjectLibraryV10PublicationPlan,
	FramescaperDesktopProjectLibraryV10PlannedBody,
} from './project-library-v10-publication-contract.ts';
import type {
	FramescaperDesktopProjectLibraryV10PublicationStage,
} from './project-library-v10-publication-files.ts';
import {
	parseFramescaperDesktopLibraryV10MetadataJson,
	type FramescaperDesktopLibraryV10Metadata,
} from './project-library-v10-metadata.ts';
import {
	encodeFramescaperDesktopProjectLibraryV10MetadataRow,
	sameFramescaperDesktopProjectLibraryV10Lease,
	type FramescaperDesktopProjectLibraryV10Lease,
	type FramescaperDesktopProjectLibraryV10MetadataRow,
	validateFramescaperDesktopProjectLibraryV10LeaseToken,
	validateFramescaperDesktopProjectLibraryV10MetadataIntegrity,
	validateFramescaperDesktopProjectLibraryV10MetadataRow,
} from './project-library-v10-persistence-codecs.ts';
import {
	validateFramescaperDesktopProjectLibraryV10TransferBody,
	validateFramescaperDesktopProjectLibraryV10TransferBundle,
	type FramescaperDesktopProjectLibraryV10TransferBody,
	type FramescaperDesktopProjectLibraryV10TransferBundle,
} from './project-library-v10-transfer-contract.ts';

export type FramescaperDesktopProjectLibraryV10PublicationJournalState =
	| 'prepared'
	| 'materialized'
	| 'committed'
	| 'complete';

export interface FramescaperDesktopProjectLibraryV10PersistedBody {
	readonly bodyId: string;
	readonly mediaRelativeFile: string;
	readonly descriptor: Readonly<FramescaperDesktopProjectLibraryV10TransferBody>;
}

export interface FramescaperDesktopProjectLibraryV10PersistedPublication {
	readonly transactionId: string;
	readonly state: FramescaperDesktopProjectLibraryV10PublicationJournalState;
	readonly expectedMetadataRevision: number;
	readonly previousMetadata: Readonly<FramescaperDesktopLibraryV10Metadata>;
	readonly nextMetadata: Readonly<FramescaperDesktopLibraryV10Metadata>;
	readonly bundle: Readonly<FramescaperDesktopProjectLibraryV10TransferBundle>;
	readonly document: string;
	readonly entryId: string;
	readonly projectRelativeFile: string;
	readonly bodies: readonly Readonly<FramescaperDesktopProjectLibraryV10PersistedBody>[];
	readonly stages: readonly Readonly<FramescaperDesktopProjectLibraryV10PublicationStage>[];
}

const BODY_FIELDS = ['bodyId', 'mediaRelativeFile', 'descriptor'] as const;
const STAGE_FIELDS = [
	'role', 'bodyId', 'stageRelativeFile', 'finalRelativeFile', 'byteLength', 'sha256',
] as const;
const DIGEST = /^[a-f0-9]{64}$/u;
const TRANSACTION_ID = /^[a-f0-9]{48}$/u;
const MAXIMUM_BODIES = 4_094;
const MAXIMUM_RETAINED_PUBLICATIONS = 32;

export function readFramescaperDesktopProjectLibraryV10MetadataSnapshot(
	database: DatabaseSync,
): Readonly<{
	readonly row: FramescaperDesktopProjectLibraryV10MetadataRow;
	readonly metadata: Readonly<FramescaperDesktopLibraryV10Metadata>;
}> {
	const value = database.prepare(`
		SELECT revision, json, digest, published_at_ms AS publishedAtMs
		FROM library_metadata WHERE singleton = 1
	`).get();
	if (!value) throw new Error('Framescaper V10 metadata row is missing');
	const row = validateFramescaperDesktopProjectLibraryV10MetadataRow(
		value as Record<string, unknown>,
		'Framescaper V10 publication metadata',
	);
	return Object.freeze({
		row,
		metadata: validateFramescaperDesktopProjectLibraryV10MetadataIntegrity(
			row,
			'Framescaper V10 publication metadata',
		),
	});
}

export function assertFramescaperDesktopProjectLibraryV10PublicationLease(
	database: DatabaseSync,
	value: FramescaperDesktopProjectLibraryV10Lease,
	now: number,
): FramescaperDesktopProjectLibraryV10Lease {
	const lease = validateFramescaperDesktopProjectLibraryV10LeaseToken(value);
	const row = database.prepare(`
		SELECT active, lease_id AS leaseId, fencing_token AS fencingToken,
			owner_product AS ownerProduct, owner_process_id AS ownerProcessId,
			owner_instance_id AS ownerInstanceId, acquired_at_ms AS acquiredAtMs,
			expires_at_ms AS expiresAtMs, took_over AS tookOver
		FROM library_lease WHERE singleton = 1
	`).get() as Record<string, unknown> | undefined;
	if (!row || row.active !== 1) throw leaseLost();
	const current = validateFramescaperDesktopProjectLibraryV10LeaseToken({
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
	} as FramescaperDesktopProjectLibraryV10Lease);
	if (current.expiresAtMs <= now || !sameFramescaperDesktopProjectLibraryV10Lease(current, lease)) {
		throw leaseLost();
	}
	return current;
}

export function prepareFramescaperDesktopProjectLibraryV10Publication(
	database: DatabaseSync,
	transactionId: string,
	plan: Readonly<FramescaperDesktopProjectLibraryV10PublicationPlan>,
	stages: readonly Readonly<FramescaperDesktopProjectLibraryV10PublicationStage>[],
	now: number,
): void {
	if (!TRANSACTION_ID.test(transactionId)) {
		throw new TypeError('Framescaper V10 publication transaction id is invalid');
	}
	transaction(database, () => {
		assertFramescaperDesktopProjectLibraryV10PublicationLease(database, plan.lease, now);
		const current = readFramescaperDesktopProjectLibraryV10MetadataSnapshot(database);
		assertMetadataSnapshot(current.metadata, plan.previousMetadata, 'changed before journal preparation');
		if (current.row.revision !== plan.expectedMetadataRevision) {
			throw new Error('Framescaper V10 metadata revision changed before journal preparation');
		}
		if (database.prepare(`
			SELECT 1 AS pending FROM publication_journal
			WHERE state IN ('prepared', 'materialized', 'committed') LIMIT 1
		`).get()) throw new Error('Framescaper V10 publication recovery is required');
		if (database.prepare(`
			SELECT 1 AS pending FROM metadata_journal
			WHERE state IN ('prepared', 'committed') LIMIT 1
		`).get()) throw new Error('Framescaper V10 metadata recovery is required before body publication');
		if (database.prepare(`
			SELECT 1 AS occupied FROM project_revisions
			WHERE project_id = ? AND project_revision = ?
		`).get(plan.bundle.project.projectId, plan.bundle.project.projectRevision)) {
			throw new Error('Framescaper V10 next project revision is occupied');
		}
		const previousJson = current.row.json;
		const next = encodeFramescaperDesktopProjectLibraryV10MetadataRow(plan.nextMetadata, now);
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

export function markFramescaperDesktopProjectLibraryV10PublicationMaterialized(
	database: DatabaseSync,
	transactionId: string,
	lease: FramescaperDesktopProjectLibraryV10Lease,
	now: number,
): void {
	transaction(database, () => {
		const current = assertFramescaperDesktopProjectLibraryV10PublicationLease(database, lease, now);
		const result = database.prepare(`
			UPDATE publication_journal
			SET state = 'materialized', lease_id = ?, fencing_token = ?
			WHERE transaction_id = ? AND state = 'prepared'
		`).run(current.leaseId, current.fencingToken, transactionId);
		if (result.changes !== 1) throw new Error('Framescaper V10 prepared publication is unavailable');
	});
}

export function commitFramescaperDesktopProjectLibraryV10Publication(
	database: DatabaseSync,
	publication: Readonly<FramescaperDesktopProjectLibraryV10PersistedPublication>,
	lease: FramescaperDesktopProjectLibraryV10Lease,
	now: number,
): void {
	transaction(database, () => {
		const currentLease = assertFramescaperDesktopProjectLibraryV10PublicationLease(database, lease, now);
		const current = readFramescaperDesktopProjectLibraryV10MetadataSnapshot(database);
		assertMetadataSnapshot(current.metadata, publication.previousMetadata, 'changed before publication commit');
		if (current.row.revision !== publication.expectedMetadataRevision) {
			throw new Error('Framescaper V10 metadata revision changed before publication commit');
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
		if (result.changes !== 1) throw new Error('Framescaper V10 project revision could not publish');
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
		const next = encodeFramescaperDesktopProjectLibraryV10MetadataRow(publication.nextMetadata, now);
		const metadata = database.prepare(`
			UPDATE library_metadata SET revision = ?, json = ?, digest = ?, published_at_ms = ?
			WHERE singleton = 1 AND revision = ? AND json = ? AND digest = ?
		`).run(
			next.revision, next.json, next.digest, now,
			current.row.revision, current.row.json, current.row.digest,
		);
		if (metadata.changes !== 1) throw new Error('Framescaper V10 publication lost metadata compare-and-swap');
		const journal = database.prepare(`
			UPDATE publication_journal
			SET state = 'committed', lease_id = ?, fencing_token = ?
			WHERE transaction_id = ? AND state = 'materialized'
		`).run(currentLease.leaseId, currentLease.fencingToken, publication.transactionId);
		if (journal.changes !== 1) throw new Error('Framescaper V10 publication journal could not commit');
	});
}

export function settleFramescaperDesktopProjectLibraryV10Publication(
	database: DatabaseSync,
	transactionId: string,
	lease: FramescaperDesktopProjectLibraryV10Lease,
	now: number,
): void {
	transaction(database, () => {
		assertFramescaperDesktopProjectLibraryV10PublicationLease(database, lease, now);
		const result = database.prepare(`
			UPDATE publication_journal SET state = 'complete', completed_at_ms = ?
			WHERE transaction_id = ? AND state = 'committed'
		`).run(now, transactionId);
		if (result.changes !== 1) throw new Error('Framescaper V10 publication journal could not complete');
		database.prepare(`
			DELETE FROM publication_journal WHERE transaction_id IN (
				SELECT transaction_id FROM publication_journal WHERE state = 'complete'
				ORDER BY completed_at_ms DESC, transaction_id DESC LIMIT -1 OFFSET ?
			)
		`).run(MAXIMUM_RETAINED_PUBLICATIONS);
	});
}

export function readFramescaperDesktopProjectLibraryV10PendingPublication(
	database: DatabaseSync,
): Readonly<FramescaperDesktopProjectLibraryV10PersistedPublication> | null {
	const rows = database.prepare(`
		SELECT * FROM publication_journal
		WHERE state IN ('prepared', 'materialized', 'committed')
		ORDER BY created_at_ms, transaction_id LIMIT 2
	`).all() as Record<string, unknown>[];
	if (rows.length > 1) throw new Error('Framescaper V10 has conflicting pending publications');
	return rows.length === 0 ? null : parsePublicationRow(rows[0]!);
}

export function readFramescaperDesktopProjectLibraryV10PublicationById(
	database: DatabaseSync,
	transactionId: string,
): Readonly<FramescaperDesktopProjectLibraryV10PersistedPublication> {
	const row = database.prepare('SELECT * FROM publication_journal WHERE transaction_id = ?')
		.get(transactionId) as Record<string, unknown> | undefined;
	if (!row) throw new Error('Framescaper V10 publication journal is missing');
	return parsePublicationRow(row);
}

function parsePublicationRow(
	row: Record<string, unknown>,
): Readonly<FramescaperDesktopProjectLibraryV10PersistedPublication> {
	const transactionId = stringValue(row.transaction_id, 'publication transaction id');
	if (!TRANSACTION_ID.test(transactionId)) throw new TypeError('Framescaper V10 publication id is invalid');
	const state = publicationState(row.state);
	const expectedMetadataRevision = nonNegativeInteger(
		row.expected_metadata_revision,
		'expected metadata revision',
	);
	const previousJson = stringValue(row.previous_metadata_json, 'previous metadata JSON');
	const previousDigest = digest(row.previous_metadata_digest, 'previous metadata');
	if (createHash('sha256').update(previousJson, 'utf8').digest('hex') !== previousDigest) {
		throw new Error('Framescaper V10 previous metadata journal digest is invalid');
	}
	const nextJson = stringValue(row.next_metadata_json, 'next metadata JSON');
	const nextDigest = digest(row.next_metadata_digest, 'next metadata');
	if (createHash('sha256').update(nextJson, 'utf8').digest('hex') !== nextDigest) {
		throw new Error('Framescaper V10 next metadata journal digest is invalid');
	}
	const previousMetadata = parseFramescaperDesktopLibraryV10MetadataJson(previousJson);
	const nextMetadata = parseFramescaperDesktopLibraryV10MetadataJson(nextJson);
	if (previousMetadata.revision !== expectedMetadataRevision
		|| nextMetadata.revision !== expectedMetadataRevision + 1) {
		throw new Error('Framescaper V10 publication journal metadata revisions are invalid');
	}
	const projectId = stringValue(row.project_id, 'publication project id');
	const projectRevision = nonNegativeInteger(row.project_revision, 'publication project revision');
	const projectSha256 = digest(row.project_sha256, 'publication project');
	const document = stringValue(row.project_json, 'publication project JSON');
	const projectByteLength = positiveInteger(row.project_byte_length, 'publication project byte length');
	if (new TextEncoder().encode(document).byteLength !== projectByteLength
		|| createHash('sha256').update(document, 'utf8').digest('hex') !== projectSha256) {
		throw new Error('Framescaper V10 publication project journal integrity is invalid');
	}
	const bodies = parseBodies(row.bodies_json);
	const project = nextMetadata.projects.find((candidate) => candidate.projectId === projectId);
	if (!project || project.projectRevision !== projectRevision || project.sha256 !== projectSha256) {
		throw new Error('Framescaper V10 publication project disagrees with next metadata');
	}
	const bundle = validateFramescaperDesktopProjectLibraryV10TransferBundle({
		metadataRevision: nextMetadata.revision,
		project,
		document,
		bodies: bodies.map(({ descriptor }) => descriptor),
	}, projectId);
	const entryId = stringValue(row.entry_id, 'publication entry id');
	const projectRelativeFile = stringValue(row.project_relative_file, 'publication project file');
	if (project.id !== entryId || project.metadataFile !== projectRelativeFile) {
		throw new Error('Framescaper V10 publication project path disagrees with metadata');
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

function parseBodies(value: unknown): readonly Readonly<FramescaperDesktopProjectLibraryV10PersistedBody>[] {
	const parsed = parseJson(value, 'publication bodies');
	if (!Array.isArray(parsed) || parsed.length > MAXIMUM_BODIES) {
		throw new TypeError('Framescaper V10 publication bodies are invalid');
	}
	return Object.freeze(parsed.map((value) => {
		const record = closedRecord(value, BODY_FIELDS, 'publication body');
		const descriptor = validateFramescaperDesktopProjectLibraryV10TransferBody(record.descriptor);
		const bodyId = stringValue(record.bodyId, 'publication body id');
		const expectedBodyId = descriptor.kind === 'video-proxy' ? descriptor.bindingId : `t${descriptor.sha256}`;
		if (bodyId !== expectedBodyId) throw new Error('Framescaper V10 publication body id is invalid');
		const mediaRelativeFile = stringValue(record.mediaRelativeFile, 'publication media file');
		const expectedFile = descriptor.kind === 'video-proxy'
			? proxyRelativeFileForFramescaperDesktopLibraryBinding(descriptor.bindingId)
			: `timing/${descriptor.sha256.slice(0, 2)}/${descriptor.sha256}.scti`;
		if (mediaRelativeFile !== expectedFile) {
			throw new Error('Framescaper V10 publication media path is invalid');
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
	bodies: readonly Readonly<FramescaperDesktopProjectLibraryV10PersistedBody>[],
): readonly Readonly<FramescaperDesktopProjectLibraryV10PublicationStage>[] {
	const parsed = parseJson(value, 'publication stages');
	if (!Array.isArray(parsed) || parsed.length !== bodies.length + 1) {
		throw new TypeError('Framescaper V10 publication stages are incomplete');
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
			throw new Error('Framescaper V10 publication stage identity is invalid');
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
	body: Readonly<FramescaperDesktopProjectLibraryV10PersistedBody>,
	now: number,
): void {
	const descriptorJson = JSON.stringify(body.descriptor);
	const existing = database.prepare('SELECT * FROM managed_bodies WHERE body_id = ?').get(
		body.bodyId,
	) as Record<string, unknown> | undefined;
	if (existing) {
		if (existing.kind !== body.descriptor.kind || existing.encoding !== body.descriptor.encoding
			|| existing.binding_id !== (body.descriptor.kind === 'video-proxy' ? body.descriptor.bindingId : null)
			|| existing.source_id !== body.descriptor.sourceId || existing.storage_key !== body.descriptor.storageKey
			|| existing.relative_file !== body.mediaRelativeFile || existing.mime_type !== body.descriptor.mimeType
			|| existing.byte_length !== body.descriptor.byteLength || existing.sha256 !== body.descriptor.sha256
			|| existing.descriptor_json !== descriptorJson || existing.state !== 'published') {
			throw new Error('Framescaper V10 managed body identity conflicts with existing publication');
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
		body.descriptor.kind === 'video-proxy' ? body.descriptor.bindingId : null,
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
	body: Readonly<FramescaperDesktopProjectLibraryV10PlannedBody>,
): FramescaperDesktopProjectLibraryV10PersistedBody {
	return {
		bodyId: body.bodyId,
		mediaRelativeFile: body.mediaRelativeFile,
		descriptor: body.descriptor,
	};
}

function assertMetadataSnapshot(
	left: Readonly<FramescaperDesktopLibraryV10Metadata>,
	right: Readonly<FramescaperDesktopLibraryV10Metadata>,
	message: string,
): void {
	if (JSON.stringify(left) !== JSON.stringify(right)) {
		throw new Error(`Framescaper V10 metadata ${message}`);
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

function publicationState(value: unknown): FramescaperDesktopProjectLibraryV10PublicationJournalState {
	if (value !== 'prepared' && value !== 'materialized' && value !== 'committed' && value !== 'complete') {
		throw new TypeError('Framescaper V10 publication journal state is invalid');
	}
	return value;
}

function parseJson(value: unknown, label: string): unknown {
	const text = stringValue(value, label);
	try { return JSON.parse(text) as unknown; }
	catch (error) { throw new TypeError(`Framescaper V10 ${label} JSON is invalid`, { cause: error }); }
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`Framescaper V10 ${label} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`Framescaper V10 ${label} has invalid fields`);
	const record = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Framescaper V10 ${label}.${field} must be a data property`);
		}
		record[field] = descriptor.value;
	}
	return record;
}

function digest(value: unknown, label: string): string {
	const result = stringValue(value, `${label} digest`);
	if (!DIGEST.test(result)) throw new TypeError(`Framescaper V10 ${label} digest is invalid`);
	return result;
}

function stringValue(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError(`Framescaper V10 ${label} is invalid`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Framescaper V10 ${label} must be a non-negative safe integer`);
	}
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	const result = nonNegativeInteger(value, label);
	if (result === 0) throw new RangeError(`Framescaper V10 ${label} must be positive`);
	return result;
}

function leaseLost(): Error {
	return new Error('Framescaper V10 publication writer lease no longer owns its fence');
}
