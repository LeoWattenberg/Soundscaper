/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import {
	framescaperDesktopProjectLibraryExactGenerationMetadataRevision as metadataRevision,
	setFramescaperDesktopProjectLibraryExactGenerationMetadataRevision as setMetadataRevision,
} from './project-library-exact-generation-database.ts';
import type { FramescaperDesktopProjectLibraryExactGenerationPaths } from './project-library-exact-generation-contract.ts';
import type {
	FramescaperDesktopProjectLibraryExactGenerationLifecycle,
	FramescaperDesktopProjectLibraryExactPublicationDeclaration,
} from './project-library-exact-generation-lifecycle.ts';
import type { ExactGenerationProject } from './project-library-exact-generation-body-configuration.ts';
import type { FramescaperDesktopProjectLibraryExactGenerationConfiguration } from './project-library-exact-generation-main.ts';
import {
	concatenateFramescaperDesktopProjectLibraryV12Chunks as concatenate,
	framescaperDesktopProjectLibraryV12ClosedRecord as closedRecord,
	framescaperDesktopProjectLibraryV12DenseArray as denseArray,
	framescaperDesktopProjectLibraryV12Digest as digest,
	framescaperDesktopProjectLibraryV12NonNegative as nonNegative,
	framescaperDesktopProjectLibraryV12Positive as positive,
	framescaperDesktopProjectLibraryV12Sha256 as sha256,
	framescaperDesktopProjectLibraryV12Text as text,
} from './project-library-v12-values.ts';

const EXPECTED_FIELDS = ['projectRevision', 'projectSha256'] as const;
const BODY_FIELDS = ['kind', 'encoding', 'sourceId', 'storageKey', 'mimeType', 'byteLength', 'sha256'] as const;
const PROXY_BODY_FIELDS = ['kind', 'encoding', 'bindingId', 'sourceId', 'storageKey', 'mimeType', 'byteLength', 'sha256'] as const;
const MAXIMUM_BODIES = 4_094;

interface FramescaperDesktopExactProjectRow {
	readonly id: string;
	readonly projectId: string;
	readonly name: string;
	readonly metadataFile: string;
	readonly preferredProduct: 'framescaper';
	readonly updatedAtMs: number;
	readonly projectSchemaVersion: number;
	readonly projectRevision: number;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface FramescaperDesktopExactBodyDescriptor {
	readonly kind:
		| 'video-original' | 'video-proxy' | 'video-timing'
		| 'framescaper-still' | 'framescaper-freeze-render'
		| 'framescaper-cube-lut' | 'framescaper-motion-analysis'
		| 'image-sequence-inventory' | 'image-sequence-source-pack';
	readonly encoding: string;
	readonly bindingId?: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface FramescaperDesktopExactPublication {
	readonly publicationId: string;
	readonly expectedMetadataRevision: number;
	readonly expectedProject: Readonly<{ projectRevision: number; projectSha256: string }> | null;
	readonly project: ExactGenerationProject;
	readonly document: string;
	readonly bodies: readonly Readonly<FramescaperDesktopExactBodyDescriptor>[];
	readonly chunks: Uint8Array[][];
	readonly offsets: number[];
}

export interface FramescaperDesktopExactStoredProjectRow {
	readonly entry_id: unknown;
	readonly project_id: unknown;
	readonly title: unknown;
	readonly updated_at_ms: unknown;
	readonly project_revision: unknown;
	readonly document_file: unknown;
	readonly byte_length: unknown;
	readonly sha256: unknown;
	readonly bodies_json: unknown;
}

export async function persistFramescaperDesktopExactPublication(
	configuration: FramescaperDesktopProjectLibraryExactGenerationConfiguration,
	database: DatabaseSync,
	paths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>,
	publication: FramescaperDesktopExactPublication,
	lifecycle: FramescaperDesktopProjectLibraryExactGenerationLifecycle | null = null,
	assertCurrent: () => void = () => undefined,
): Promise<unknown> {
	const bytes = new TextEncoder().encode(publication.document);
	const contentDigest = sha256(bytes);
	const entryId = sha256(String(publication.project.id)).slice(0, 48);
	const projectDirectory = join(paths.projectsRoot, entryId);
	await mkdir(projectDirectory, { recursive: true, mode: 0o700 });
	const documentFile = `${entryId}/${String(publication.project.revision)}-${contentDigest}.json`;
	const documentPath = join(paths.projectsRoot, documentFile);
	const declaration: Readonly<FramescaperDesktopProjectLibraryExactPublicationDeclaration> = Object.freeze({
		publicationId: publication.publicationId,
		projectId: String(publication.project.id),
		projectRevision: publication.project.revision,
		projectSha256: contentDigest,
		documentFile,
		expectedMetadataRevision: publication.expectedMetadataRevision,
	});
	const temporaryDocument = `${documentPath}.tmp-${randomBytes(8).toString('hex')}`;
	const temporaryBodies: Array<Readonly<{ temporary: string; final: string }>> = [];
	try {
		assertCurrent();
		await lifecycle?.preparePublication(declaration);
		await writeFile(temporaryDocument, bytes, { mode: 0o600, flag: 'wx' });
		for (const [index, body] of publication.bodies.entries()) {
			const bodyBytes = concatenate(publication.chunks[index]!, body.byteLength);
			if (sha256(bodyBytes) !== body.sha256) {
				throw new Error(`${configuration.label} publication body digest changed`);
			}
			const final = framescaperDesktopExactMediaPath(paths, body);
			await mkdir(join(final, '..'), { recursive: true, mode: 0o700 });
			try {
				const existing = await stat(final);
				if (existing.size !== body.byteLength || sha256(await readFile(final)) !== body.sha256) {
					throw new Error(`${configuration.label} managed body conflicts with existing bytes`);
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
				const temporary = `${final}.tmp-${randomBytes(8).toString('hex')}`;
				await writeFile(temporary, bodyBytes, { mode: 0o600, flag: 'wx' });
				temporaryBodies.push({ temporary, final });
			}
		}
		for (const item of temporaryBodies) await rename(item.temporary, item.final);
		await rename(temporaryDocument, documentPath);
		assertCurrent();
		await lifecycle?.publicationMaterialized(declaration);
		const updatedAtMs = Date.parse(String(publication.project.updatedAt));
		if (!Number.isSafeInteger(updatedAtMs) || updatedAtMs < 0) {
			throw new TypeError(`${configuration.label} project timestamp is invalid`);
		}
		database.exec('BEGIN IMMEDIATE');
		try {
			assertCurrent();
			lifecycle?.assertCanCommit(database, declaration);
			if (metadataRevision(database) !== publication.expectedMetadataRevision) {
				throw new Error(`${configuration.label} metadata changed before publication`);
			}
			database.prepare(`
				INSERT INTO projects (
					entry_id, project_id, title, updated_at_ms, project_revision,
					document_file, byte_length, sha256, bodies_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(project_id) DO UPDATE SET
					title = excluded.title, updated_at_ms = excluded.updated_at_ms,
					project_revision = excluded.project_revision, document_file = excluded.document_file,
					byte_length = excluded.byte_length, sha256 = excluded.sha256,
					bodies_json = excluded.bodies_json
			`).run(
				entryId, String(publication.project.id), String(publication.project.title), updatedAtMs,
				publication.project.revision, documentFile, bytes.byteLength, contentDigest,
				JSON.stringify(publication.bodies),
			);
			setMetadataRevision(database, publication.expectedMetadataRevision + 1, configuration.label);
			database.exec('COMMIT');
		} catch (error) { database.exec('ROLLBACK'); throw error; }
		const result = Object.freeze({
			metadataRevision: publication.expectedMetadataRevision + 1,
			project: Object.freeze({
				id: entryId, projectId: String(publication.project.id), name: String(publication.project.title),
				metadataFile: documentFile, preferredProduct: 'framescaper', updatedAtMs,
				projectSchemaVersion: configuration.projectSchemaVersion,
				projectRevision: publication.project.revision, byteLength: bytes.byteLength,
				sha256: contentDigest,
			}),
			document: publication.document,
			bodies: publication.bodies,
		});
		await lifecycle?.publicationCommitted(declaration, result);
		await lifecycle?.publicationComplete(declaration);
		return result;
	} catch (error) {
		await rm(temporaryDocument, { force: true }).catch(() => undefined);
		await Promise.all(temporaryBodies.map(({ temporary }) => rm(temporary, { force: true })));
		throw error;
	}
}

export function framescaperDesktopExactProjectRow(
	row: FramescaperDesktopExactStoredProjectRow,
	projectSchemaVersion: number,
): Readonly<FramescaperDesktopExactProjectRow> {
	return Object.freeze({
		id: text(row.entry_id, 'entry id'), projectId: text(row.project_id, 'project id'),
		name: text(row.title, 'title'), metadataFile: text(row.document_file, 'document file'),
		preferredProduct: 'framescaper', updatedAtMs: nonNegative(row.updated_at_ms, 'timestamp'),
		projectSchemaVersion, projectRevision: nonNegative(row.project_revision, 'project revision'),
		byteLength: positive(row.byte_length, 'document byte length'), sha256: digest(row.sha256, 'document'),
	});
}

export function parseFramescaperDesktopExactBodies(
	value: unknown,
	label: string,
	validate: (
		value: unknown,
		label: string,
	) => Readonly<FramescaperDesktopExactBodyDescriptor> = validateFramescaperDesktopExactBody,
): readonly Readonly<FramescaperDesktopExactBodyDescriptor>[] {
	if (typeof value !== 'string') throw new TypeError(`${label} body inventory is invalid`);
	return Object.freeze(denseArray(JSON.parse(value) as unknown, MAXIMUM_BODIES, `${label} bodies`)
		.map((body) => validate(body, label)));
}

export function validateFramescaperDesktopExactBody(
	value: unknown,
	label: string,
): Readonly<FramescaperDesktopExactBodyDescriptor> {
	const kind = (value as Record<string, unknown> | null)?.kind;
	const fields = kind === 'video-proxy' ? PROXY_BODY_FIELDS : BODY_FIELDS;
	const record = closedRecord(value, fields, `${label} body descriptor`);
	if (kind !== 'video-original' && kind !== 'video-proxy' && kind !== 'video-timing') {
		throw new TypeError(`${label} body kind is unsupported`);
	}
	const encoding = text(record.encoding, 'body encoding');
	if ((kind === 'video-original' && encoding !== 'framescaper-video-original-v1')
		|| (kind === 'video-proxy' && encoding !== 'video-proxy-v1')
		|| (kind === 'video-timing' && encoding !== 'soundscaper-video-timing-v1')) {
		throw new TypeError(`${label} body encoding is unsupported`);
	}
	const result: FramescaperDesktopExactBodyDescriptor = {
		kind, encoding,
		...(kind === 'video-proxy' ? { bindingId: text(record.bindingId, 'binding id') } : {}),
		sourceId: text(record.sourceId, 'source id'), storageKey: text(record.storageKey, 'storage key'),
		mimeType: text(record.mimeType, 'MIME type'), byteLength: positive(record.byteLength, 'body length'),
		sha256: digest(record.sha256, 'body'),
	};
	if (result.sourceId !== result.storageKey) throw new TypeError(`${label} body identity is inconsistent`);
	return Object.freeze(result);
}

export function framescaperDesktopExactMediaPath(
	paths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>,
	body: FramescaperDesktopExactBodyDescriptor,
): string {
	const extension = body.kind === 'video-original' ? '.media'
		: body.kind === 'video-proxy' ? '.proxy'
			: body.kind === 'video-timing' ? '.scti'
				: body.kind === 'framescaper-cube-lut' ? '.cube'
					: body.kind === 'framescaper-motion-analysis' ? '.json'
						: body.kind === 'image-sequence-inventory' ? '.inventory.json'
							: body.kind === 'image-sequence-source-pack' ? '.sequence-pack' : '.image';
	return join(paths.managedMediaRoot, body.kind, body.sha256.slice(0, 2), `${body.sha256}${extension}`);
}

export function assertFramescaperDesktopExactExpectedProject(
	row: FramescaperDesktopExactStoredProjectRow | null,
	expected: Readonly<{ projectRevision: number; projectSha256: string }> | null,
	label: string,
): void {
	if (expected === null) {
		if (row) throw new Error(`${label} expected an absent project`);
		return;
	}
	if (!row || row.project_revision !== expected.projectRevision || row.sha256 !== expected.projectSha256) {
		throw new Error(`${label} expected project failed compare-and-swap`);
	}
}

export function framescaperDesktopExactStoredExpectedProject(
	value: unknown,
	label: string,
): Readonly<{ projectRevision: number; projectSha256: string }> | null {
	if (value === null) return null;
	const record = closedRecord(value, EXPECTED_FIELDS, `${label} expected project`);
	return Object.freeze({
		projectRevision: nonNegative(record.projectRevision, 'project revision'),
		projectSha256: digest(record.projectSha256, 'project'),
	});
}

export function framescaperDesktopExactProjectTimestamp(
	value: unknown,
	field: string,
	label: string,
): string {
	const result = text(value, field);
	if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) {
		throw new TypeError(`${label} ${field} is invalid`);
	}
	return result;
}
