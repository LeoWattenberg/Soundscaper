/* SPDX-License-Identifier: AGPL-3.0-only */
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
	framescaperDesktopProjectLibraryExactGenerationMetadataRevision as metadataRevision,
	initializeFramescaperDesktopProjectLibraryExactGenerationDatabase as initializeDatabase,
	setFramescaperDesktopProjectLibraryExactGenerationMetadataRevision as setMetadataRevision,
} from './project-library-exact-generation-database.ts';
import type {
	FramescaperDesktopProjectLibraryExactGenerationOwner,
	FramescaperDesktopProjectLibraryExactGenerationPaths,
} from './project-library-exact-generation-contract.ts';
import type {
	FramescaperDesktopProjectLibraryExactGenerationExtension,
	FramescaperDesktopProjectLibraryExactGenerationLifecycle,
} from './project-library-exact-generation-lifecycle.ts';
import {
	framescaperDesktopExactConfiguredBodies as configuredBodies,
	framescaperDesktopExactConfiguredBody as configuredBody,
	type ExactGenerationProject,
	type FramescaperDesktopProjectLibraryExactGenerationBodyConfiguration,
} from './project-library-exact-generation-body-configuration.ts';
import { DesktopProjectLibrarySessionAdmission } from './project-library-session-admission.ts';
import {
	framescaperDesktopProjectLibraryBinary as binary,
	framescaperDesktopProjectLibraryClosedRecord as closedRecord,
	framescaperDesktopProjectLibraryNonNegative as nonNegative,
	framescaperDesktopProjectLibraryPositive as positive,
	framescaperDesktopProjectLibraryPublicationId as exactPublicationId,
	framescaperDesktopProjectLibrarySha256 as sha256,
	framescaperDesktopProjectLibraryText as text,
} from './framescaper-project-library-values.ts';
import {
	assertFramescaperDesktopExactExpectedProject as assertExpected,
	framescaperDesktopExactMediaPath as mediaPath,
	framescaperDesktopExactProjectRow as projectRow,
	framescaperDesktopExactProjectTimestamp as instant,
	framescaperDesktopExactStoredExpectedProject as expectedProjectRecord,
	parseFramescaperDesktopExactBodies as parseBodies,
	persistFramescaperDesktopExactPublication as persistPublication,
	validateFramescaperDesktopExactBody as validateBody,
	type FramescaperDesktopExactBodyDescriptor as BodyDescriptor,
	type FramescaperDesktopExactPublication as Publication,
	type FramescaperDesktopExactStoredProjectRow as StoredProjectRow,
} from './project-library-exact-generation-storage.ts';
import { ProjectLibraryVerifiedBodyReader } from './project-library-native-body-materialization.ts';
const START_FIELDS = ['appDataPath', 'owner', 'handshake'] as const;
const BEGIN_FIELDS = ['publicationId', 'expectedMetadataRevision', 'expectedProject', 'project', 'bodies'] as const;
const CHUNK_FIELDS = ['publicationId', 'bodyIndex', 'offset', 'bytes'] as const;
const COMPLETION_FIELDS = ['publicationId'] as const;
const DUPLICATE_FIELDS = [
	'sourceProjectId', 'copyProjectId', 'title', 'timestamp',
	'expectedMetadataRevision', 'expectedSource',
] as const;
const MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;
export interface FramescaperDesktopProjectLibraryExactGenerationConfiguration extends FramescaperDesktopProjectLibraryExactGenerationBodyConfiguration {
	readonly label: string;
	readonly schemaFamily?: 'framescaper';
	readonly librarySchemaVersion: number;
	readonly schemaVersion: number;
	readonly databaseUserVersion: number;
	readonly createHandshake: () => unknown;
	readonly validateHandshake: (value: unknown) => unknown;
	readonly createPaths: (appDataPath: string) => Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>;
	readonly validateOwner: (value: unknown) => Readonly<FramescaperDesktopProjectLibraryExactGenerationOwner>;
	readonly validateProject: (value: unknown) => unknown;
}
export interface FramescaperDesktopProjectLibraryExactGenerationMainSnapshot {
	readonly closed: boolean;
	readonly fenced: boolean;
	readonly owner: Readonly<FramescaperDesktopProjectLibraryExactGenerationOwner>;
	readonly activeSessions: number;
	readonly activePublication: boolean;
	readonly writer?: unknown;
}
export interface FramescaperDesktopProjectLibraryExactGenerationMainSession {
	listProjects(): Promise<unknown>;
	readProjectBundle(projectId: string): Promise<unknown>;
	readBodyChunk(value: unknown): Promise<Uint8Array>;
	beginPublication(value: unknown): Promise<unknown>;
	writePublicationChunk(value: unknown): Promise<unknown>;
	finishPublication(value: unknown): Promise<unknown>;
	abortPublication(value: unknown): Promise<boolean>;
	deleteProject(value: unknown): Promise<unknown>;
	duplicateProject(value: unknown): Promise<unknown>;
	revoke(): Promise<void>;
	close(): Promise<void>;
}
/** Parameterized persistence core; generation data never crosses the base desktop bridge. */
export class FramescaperDesktopProjectLibraryExactGenerationMain {
	readonly localHandshake: unknown;
	readonly #configuration: FramescaperDesktopProjectLibraryExactGenerationConfiguration;
	readonly #database: DatabaseSync;
	readonly #owner: Readonly<FramescaperDesktopProjectLibraryExactGenerationOwner>;
	readonly #paths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>;
	readonly #lifecycle: FramescaperDesktopProjectLibraryExactGenerationLifecycle | null;
	readonly #sessions = new Set<ExactGenerationSession>();
	readonly #activeProjects = new Map<ExactGenerationSession, string>();
	#closed = false;
	private constructor(
		configuration: FramescaperDesktopProjectLibraryExactGenerationConfiguration,
		paths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>,
		database: DatabaseSync,
		owner: Readonly<FramescaperDesktopProjectLibraryExactGenerationOwner>,
		lifecycle: FramescaperDesktopProjectLibraryExactGenerationLifecycle | null,
	) {
		this.#configuration = configuration;
		this.localHandshake = configuration.createHandshake();
		this.#paths = paths;
		this.#database = database;
		this.#owner = owner;
		this.#lifecycle = lifecycle;
	}
	static async start(
		configuration: FramescaperDesktopProjectLibraryExactGenerationConfiguration,
		value: unknown,
		extension: FramescaperDesktopProjectLibraryExactGenerationExtension | null = null,
	): Promise<FramescaperDesktopProjectLibraryExactGenerationMain> {
		const options = closedRecord(value, START_FIELDS, `${configuration.label} main options`);
		if (typeof options.appDataPath !== 'string') {
			throw new TypeError(`${configuration.label} main appDataPath must be a string`);
		}
		configuration.validateHandshake(options.handshake);
		const owner = configuration.validateOwner(options.owner);
		const paths = configuration.createPaths(options.appDataPath);
		await mkdir(paths.projectsRoot, { recursive: true, mode: 0o700 });
		await mkdir(paths.managedMediaRoot, { recursive: true, mode: 0o700 });
		const database = new DatabaseSync(paths.databasePath, {
			allowExtension: false,
			enableDoubleQuotedStringLiterals: false,
			enableForeignKeyConstraints: true,
			timeout: 50,
		});
		try {
			initializeDatabase(database, configuration);
			await chmod(paths.databasePath, 0o600);
			const lifecycle = extension ? await extension.start({
				appDataPath: options.appDataPath,
				database,
				owner,
				paths,
			}) : null;
			return new FramescaperDesktopProjectLibraryExactGenerationMain(
				configuration, paths, database, owner, lifecycle,
			);
		} catch (error) {
			database.close();
			throw error;
		}
	}
	snapshot(): Readonly<FramescaperDesktopProjectLibraryExactGenerationMainSnapshot> {
		return Object.freeze({
			closed: this.#closed,
			fenced: false,
			owner: this.#owner,
			activeSessions: this.#sessions.size,
			activePublication: [...this.#sessions].some((session) => session.activePublication),
			...(this.#lifecycle?.snapshot() ?? {}),
		});
	}

	openSession(value: unknown): FramescaperDesktopProjectLibraryExactGenerationMainSession {
		this.#assertOpen();
		this.#lifecycle?.assertCanUse();
		this.#configuration.validateHandshake(value);
		const session = new ExactGenerationSession(
			this.#configuration,
			this.#database,
			this.#paths,
			this.#lifecycle,
			(projectId) => {
				if (projectId === null) this.#activeProjects.delete(session);
				else this.#activeProjects.set(session, projectId);
			},
			() => {
				this.#activeProjects.delete(session);
				this.#sessions.delete(session);
			},
		);
		this.#sessions.add(session);
		return session;
	}

	nativeProjectState(projectIdValue: string): Readonly<{ open: boolean; writable: boolean }> {
		const projectId = text(projectIdValue, 'project id');
		const open = [...this.#activeProjects.values()].some((active) => active === projectId);
		return Object.freeze({ open, writable: open && !this.#closed });
	}

	nativeProjectRecord(projectIdValue: string): Readonly<{
		schemaFamily: 'framescaper';
		schemaVersion: number;
		projectId: string;
		projectRevision: number;
		projectSha256: string;
		bodies: readonly Readonly<BodyDescriptor>[];
	}> | null {
		this.#assertOpen();
		const projectId = text(projectIdValue, 'project id');
		const row = this.#database.prepare(`
			SELECT project_id, project_revision, sha256, bodies_json
			FROM projects WHERE project_id = ?
		`).get(projectId) as Record<string, unknown> | undefined;
		if (!row) return null;
		return Object.freeze({
			schemaFamily: this.#configuration.schemaFamily ?? 'framescaper',
			schemaVersion: this.#configuration.schemaVersion,
			projectId: text(row.project_id, 'project id'),
			projectRevision: nonNegative(row.project_revision, 'project revision'),
			projectSha256: digestValue(row.sha256),
			bodies: parseBodies(row.bodies_json, this.#configuration.label, this.#configuration.validateBodyDescriptor ?? validateBody, this.#configuration.maximumBodies),
		});
	}

	async readNativeProjectBundle(projectId: string): Promise<unknown> {
		this.#assertOpen();
		const session = new ExactGenerationSession(
			this.#configuration, this.#database, this.#paths, this.#lifecycle,
			() => undefined, () => undefined,
		);
		try { return await session.readProjectBundle(projectId); }
		finally { await session.close(); }
	}

	async readNativeBody(value: unknown): Promise<Uint8Array> {
		this.#assertOpen();
		const body = configuredBody(this.#configuration, value);
		const chunks: Uint8Array[] = [];
		const session = new ExactGenerationSession(
			this.#configuration, this.#database, this.#paths, this.#lifecycle,
			() => undefined, () => undefined,
		);
		try {
			for (let offset = 0; offset < body.byteLength; offset += MAXIMUM_CHUNK_BYTES) {
				chunks.push(await session.readBodyChunk({
					body, offset, length: Math.min(MAXIMUM_CHUNK_BYTES, body.byteLength - offset),
				}));
			}
			const output = new Uint8Array(body.byteLength);
			let offset = 0;
			for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
			return output;
		} finally { await session.close(); }
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		const sessions = [...this.#sessions];
		const failures: unknown[] = [];
		const settled = await Promise.allSettled(sessions.map((session) => session.close()));
		for (const result of settled) if (result.status === 'rejected') failures.push(result.reason);
		if (this.#lifecycle) {
			try { await this.#lifecycle.close(); } catch (error) { failures.push(error); }
		}
		try { this.#database.close(); } catch (error) { failures.push(error); }
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, `${this.#configuration.label} close failed`);
	}

	#assertOpen(): void {
		if (this.#closed) throw new Error(`${this.#configuration.label} main is closed`);
		this.#lifecycle?.assertCanUse();
	}
}

class ExactGenerationSession implements FramescaperDesktopProjectLibraryExactGenerationMainSession {
	readonly #configuration: FramescaperDesktopProjectLibraryExactGenerationConfiguration;
	readonly #database: DatabaseSync;
	readonly #paths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>;
	readonly #lifecycle: FramescaperDesktopProjectLibraryExactGenerationLifecycle | null;
	readonly #onActiveProject: (projectId: string | null) => void;
	readonly #onClose: () => void;
	readonly #admission: DesktopProjectLibrarySessionAdmission;
	readonly #bodyReader = new ProjectLibraryVerifiedBodyReader();
	#publication: Publication | null = null;

	constructor(
		configuration: FramescaperDesktopProjectLibraryExactGenerationConfiguration,
		database: DatabaseSync,
		paths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>,
		lifecycle: FramescaperDesktopProjectLibraryExactGenerationLifecycle | null,
		onActiveProject: (projectId: string | null) => void,
		onClose: () => void,
	) {
		this.#configuration = configuration;
		this.#database = database;
		this.#paths = paths;
		this.#lifecycle = lifecycle;
		this.#onActiveProject = onActiveProject;
		this.#onClose = onClose;
		this.#admission = new DesktopProjectLibrarySessionAdmission(configuration.label);
	}

	get activePublication(): boolean { return this.#publication !== null; }

	async listProjects(): Promise<unknown> {
		this.#assertOpen();
		const rows = this.#database.prepare(`
			SELECT project_id, title, project_revision, updated_at_ms
			FROM projects ORDER BY updated_at_ms DESC, project_id ASC
		`).all() as Record<string, unknown>[];
		return Object.freeze({
			metadataRevision: metadataRevision(this.#database),
			projects: Object.freeze(rows.map((row) => Object.freeze({
				id: text(row.project_id, 'project id'),
				title: text(row.title, 'project title'),
				revision: nonNegative(row.project_revision, 'project revision'),
				updatedAt: new Date(nonNegative(row.updated_at_ms, 'project timestamp')).toISOString(),
			}))),
		});
	}

	readProjectBundle(projectId: string): Promise<unknown> {
		return this.#admit(async () => {
			const row = this.#row(projectId);
			if (!row) return null;
			const bundle = await this.#bundle(row);
			this.#onActiveProject(projectId);
			return bundle;
		});
	}

	readBodyChunk(value: unknown): Promise<Uint8Array> {
		return this.#admit(async () => {
			const record = value as Record<string, unknown>;
			const body = configuredBody(this.#configuration, record?.body);
			const offset = nonNegative(record?.offset, 'body offset');
			const length = positive(record?.length, 'body length');
			if (length > MAXIMUM_CHUNK_BYTES || offset > body.byteLength - length) {
				throw new RangeError(`${this.#configuration.label} body read leaves its declared range`);
			}
			return this.#bodyReader.read(mediaPath(this.#paths, body), body, offset, length,
				MAXIMUM_CHUNK_BYTES);
		});
	}

	async beginPublication(value: unknown): Promise<unknown> {
		this.#assertOpen();
		if (this.#publication) throw new Error(`${this.#configuration.label} session already owns a publication`);
		const record = closedRecord(value, BEGIN_FIELDS, `${this.#configuration.label} publication begin`);
		const publicationId = exactPublicationId(record.publicationId);
		const expectedMetadataRevision = nonNegative(record.expectedMetadataRevision, 'metadata revision');
		if (expectedMetadataRevision !== metadataRevision(this.#database)) {
			throw new Error(`${this.#configuration.label} metadata revision failed compare-and-swap`);
		}
		const projectValue = structuredClone(record.project);
		this.#configuration.validateProject(projectValue);
		const project = exactGenerationProject(projectValue, this.#configuration.label);
		const expectedProject = expectedProjectRecord(record.expectedProject, this.#configuration.label);
		const current = this.#row(String(project.id));
		assertExpected(current, expectedProject, this.#configuration.label);
		if (current && project.revision <= nonNegative(current.project_revision, 'project revision')) {
			throw new Error(`${this.#configuration.label} publication requires a strictly higher project revision`);
		}
		const document = JSON.stringify(project);
		const bodies = configuredBodies(this.#configuration, project, sha256(document), record.bodies);
		this.#publication = {
			publicationId,
			expectedMetadataRevision,
			expectedProject,
			project,
			document,
			bodies: Object.freeze(bodies),
			chunks: bodies.map(() => []),
			offsets: bodies.map(() => 0),
		};
		return Object.freeze({ publicationId, maximumChunkBytes: MAXIMUM_CHUNK_BYTES, bodyCount: bodies.length });
	}

	async writePublicationChunk(value: unknown): Promise<unknown> {
		this.#assertOpen();
		const publication = this.#active(value, CHUNK_FIELDS);
		const record = closedRecord(value, CHUNK_FIELDS, `${this.#configuration.label} publication chunk`);
		const bodyIndex = nonNegative(record.bodyIndex, 'body index');
		const bytes = binary(record.bytes);
		if (bytes.byteLength < 1 || bytes.byteLength > MAXIMUM_CHUNK_BYTES || !publication.bodies[bodyIndex]) {
			throw new RangeError(`${this.#configuration.label} publication chunk is invalid`);
		}
		const offset = nonNegative(record.offset, 'body offset');
		if (offset !== publication.offsets[bodyIndex]) {
			throw new Error(`${this.#configuration.label} publication chunks must be sequential`);
		}
		const nextOffset = offset + bytes.byteLength;
		if (nextOffset > publication.bodies[bodyIndex]!.byteLength) {
			throw new RangeError(`${this.#configuration.label} publication exceeds its declared body`);
		}
		publication.chunks[bodyIndex]!.push(bytes);
		publication.offsets[bodyIndex] = nextOffset;
		return Object.freeze({
			bodyIndex,
			nextOffset,
			complete: nextOffset === publication.bodies[bodyIndex]!.byteLength,
		});
	}

	finishPublication(value: unknown): Promise<unknown> {
		return this.#admit(async () => {
			const publication = this.#active(value, COMPLETION_FIELDS);
			if (publication.bodies.some((body, index) => publication.offsets[index] !== body.byteLength)) {
				throw new Error(`${this.#configuration.label} publication bodies are incomplete`);
			}
			try {
				const bundle = await persistPublication(
					this.#configuration, this.#database, this.#paths, publication, this.#lifecycle,
					() => this.#assertCurrent(publication.publicationId),
				);
				this.#publication = null;
				this.#onActiveProject(String(publication.project.id));
				return bundle;
			} catch (error) {
				this.#publication = null;
				try { await this.#lifecycle?.abortPublication(publication.publicationId); }
				catch (cleanupError) {
					throw new AggregateError(
						[error, cleanupError], `${this.#configuration.label} publication cleanup failed`,
					);
				}
				throw error;
			}
		});
	}

	abortPublication(value: unknown): Promise<boolean> {
		return this.#admit(async () => {
			const publication = this.#active(value, COMPLETION_FIELDS);
			this.#publication = null;
			await this.#lifecycle?.abortPublication(publication.publicationId);
			return true;
		});
	}

	async deleteProject(value: unknown): Promise<unknown> {
		this.#assertOpen();
		const record = value as Record<string, unknown>;
		const projectId = text(record?.projectId, 'project id');
		const expectedMetadataRevision = nonNegative(record?.expectedMetadataRevision, 'metadata revision');
		if (expectedMetadataRevision !== metadataRevision(this.#database)) {
			throw new Error(`${this.#configuration.label} metadata CAS failed`);
		}
		assertExpected(
			this.#row(projectId),
			expectedProjectRecord(record?.expectedProject, this.#configuration.label),
			this.#configuration.label,
		);
		this.#database.exec('BEGIN IMMEDIATE');
		try {
			this.#lifecycle?.assertLeaseInTransaction(this.#database);
			this.#database.prepare('DELETE FROM projects WHERE project_id = ?').run(projectId);
			setMetadataRevision(this.#database, expectedMetadataRevision + 1, this.#configuration.label);
			this.#database.exec('COMMIT');
		} catch (error) { this.#database.exec('ROLLBACK'); throw error; }
		this.#onActiveProject(null);
		return Object.freeze({ projectId, metadataRevision: expectedMetadataRevision + 1, deleted: true });
	}

	duplicateProject(value: unknown): Promise<unknown> {
		return this.#admit(async () => {
			if (this.#publication) throw new Error(`${this.#configuration.label} session already owns a publication`);
			const request = closedRecord(value, DUPLICATE_FIELDS, `${this.#configuration.label} duplicate request`);
			const sourceProjectId = text(request.sourceProjectId, 'source project id');
			const copyProjectId = text(request.copyProjectId, 'copy project id');
			if (sourceProjectId === copyProjectId || this.#row(copyProjectId)) {
				throw new Error(`${this.#configuration.label} duplicate destination is occupied`);
			}
			const expectedMetadataRevision = nonNegative(request.expectedMetadataRevision, 'metadata revision');
			if (metadataRevision(this.#database) !== expectedMetadataRevision) {
				throw new Error(`${this.#configuration.label} duplicate metadata changed`);
			}
			const sourceRow = this.#row(sourceProjectId);
			assertExpected(
				sourceRow,
				expectedProjectRecord(request.expectedSource, this.#configuration.label),
				this.#configuration.label,
			);
			if (!sourceRow) throw new Error(`${this.#configuration.label} duplicate source is unavailable`);
			const sourceBundle = await this.#bundle(sourceRow) as Readonly<{
				document: string; bodies: readonly Readonly<BodyDescriptor>[];
			}>;
			const project = structuredClone(JSON.parse(sourceBundle.document) as Record<string, unknown>);
			project.id = copyProjectId;
			project.title = text(request.title, 'copy project title');
			project.revision = 0;
			project.createdAt = instant(request.timestamp, 'copy timestamp', this.#configuration.label);
			project.updatedAt = project.createdAt;
			if (Array.isArray(project.multicameraGroups)) {
				project.multicameraGroups = project.multicameraGroups.map((item) => ({
					...(item as Record<string, unknown>), projectId: copyProjectId,
				}));
			}
			this.#configuration.validateProject(project);
			const admitted = exactGenerationProject(project, this.#configuration.label);
			const document = JSON.stringify(admitted);
			const bodies = configuredBodies(this.#configuration, admitted, sha256(document), sourceBundle.bodies);
			return persistPublication(this.#configuration, this.#database, this.#paths, {
				publicationId: randomBytes(24).toString('hex'),
				expectedMetadataRevision,
				expectedProject: null,
				project: admitted,
				document,
				bodies,
				chunks: bodies.map(() => []),
				offsets: bodies.map(({ byteLength }) => byteLength),
			}, this.#lifecycle, () => this.#assertAdmitted());
		});
	}

	close(): Promise<void> { return this.#retire(false); }
	revoke(): Promise<void> { return this.#retire(true); }
	#retire(invalidateBeforeDrain: boolean): Promise<void> {
		const publicationId = this.#publication?.publicationId ?? null;
		if (invalidateBeforeDrain) this.#publication = null;
		return this.#admission.close(async () => {
			this.#publication = null;
			if (publicationId) await this.#lifecycle?.abortPublication(publicationId);
			await this.#bodyReader.close();
			this.#onActiveProject(null);
			this.#onClose();
		});
	}
	#active(value: unknown, fields: readonly string[]): Publication {
		this.#lifecycle?.assertCanUse();
		const record = closedRecord(value, fields, `${this.#configuration.label} publication operation`);
		const id = exactPublicationId(record.publicationId);
		if (!this.#publication || this.#publication.publicationId !== id) {
			throw new Error(`${this.#configuration.label} publication is not active`);
		}
		return this.#publication;
	}

	#assertCurrent(publicationId: string): void {
		this.#assertAdmitted();
		if (this.#publication?.publicationId !== publicationId) {
			throw new Error(`${this.#configuration.label} publication ownership changed`);
		}
	}

	#row(projectIdValue: string): StoredProjectRow | null {
		const projectId = text(projectIdValue, 'project id');
		return (this.#database.prepare(`
			SELECT entry_id, project_id, title, updated_at_ms, project_revision,
				document_file, byte_length, sha256, bodies_json
			FROM projects WHERE project_id = ?
		`).get(projectId) as StoredProjectRow | undefined) ?? null;
	}

	async #bundle(row: StoredProjectRow): Promise<unknown> {
		const project = projectRow(
			row,
			this.#configuration.schemaFamily ?? 'framescaper',
			this.#configuration.schemaVersion,
		);
		const document = await readFile(join(this.#paths.projectsRoot, text(row.document_file, 'document file')), 'utf8');
		if (new TextEncoder().encode(document).byteLength !== project.byteLength || sha256(document) !== project.sha256) {
			throw new Error(`${this.#configuration.label} project document failed integrity validation`);
		}
		const parsed = JSON.parse(document) as unknown;
		this.#configuration.validateProject(parsed);
		return Object.freeze({
			metadataRevision: metadataRevision(this.#database),
			project,
			document,
			bodies: configuredBodies(this.#configuration, parsed, project.sha256, JSON.parse(text(row.bodies_json, 'body inventory')) as unknown),
		});
	}

	#assertOpen(): void { this.#admission.assertOpen(); this.#assertAdmitted(); }

	#admit<Result>(operation: () => Promise<Result>): Promise<Result> {
		this.#lifecycle?.assertCanUse();
		return this.#admission.run(operation);
	}

	#assertAdmitted(): void { this.#lifecycle?.assertCanUse(); }
}

function exactGenerationProject(value: unknown, label: string): ExactGenerationProject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} project must be a record`);
	}
	const project = value as Record<string, unknown>;
	text(project.id, 'project id');
	text(project.title, 'project title');
	nonNegative(project.revision, 'project revision');
	instant(project.updatedAt, 'updatedAt', label);
	return project as ExactGenerationProject;
}

function digestValue(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError('An exact-generation project digest is invalid');
	}
	return value;
}
