/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomBytes } from 'node:crypto';
import {
	chmod,
	lstat,
	mkdir,
	open,
	readFile,
	statfs,
	type FileHandle,
} from 'node:fs/promises';
import { join } from 'node:path';

import { parseScapeProjectDocument, serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { throwIfAborted } from './project-library-abort.ts';
import {
	availableStorageBytes,
	type DesktopLibraryMediaStatfs,
} from './project-library-media-capacity.ts';
import {
	createDesktopLibraryProjectMetadataFile,
	DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
	MAX_LIBRARY_PROJECT_DOCUMENT_BYTES,
	MAX_LIBRARY_PROJECT_ID_BYTES,
	type DesktopLibraryLease,
	type DesktopLibraryMetadata,
	type DesktopLibraryMedia,
	type DesktopLibraryProduct,
	type DesktopLibraryProject,
	validateDesktopLibraryMetadata,
} from './project-library-contract.ts';
import { SharedDesktopProjectLibrary } from './project-library.ts';
import { createDesktopLibraryProjectStageFile } from './project-library-stage-inventory.ts';

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export interface DesktopLibraryProjectStoreOptions {
	readonly maximumDocumentBytes?: number;
	readonly randomId?: () => string;
	readonly statfsImpl?: DesktopLibraryMediaStatfs;
}

export interface DesktopLibraryCommitProjectOptions {
	readonly lease: DesktopLibraryLease;
	readonly entryId: string;
	readonly name: string;
	readonly project: unknown;
	readonly preferredProduct: DesktopLibraryProduct;
	readonly updatedAtMs: number;
	readonly signal?: AbortSignal;
}

export interface DesktopLibraryCommitProjectByIdOptions extends Omit<DesktopLibraryCommitProjectOptions, 'entryId'> {
	readonly createEntryId: () => string;
}

export interface DesktopLibraryDeleteProjectByIdOptions {
	readonly lease: DesktopLibraryLease;
	readonly projectId: string;
	readonly signal?: AbortSignal;
}

export interface DesktopLibraryLoadedProject {
	readonly catalog: DesktopLibraryProject;
	readonly project: Readonly<Record<string, unknown>>;
}

export interface DesktopLibraryLoadedProjectBundle extends DesktopLibraryLoadedProject {
	readonly media: readonly DesktopLibraryMedia[];
}

interface CurrentProjectRoot extends Record<string, unknown> {
	readonly schemaVersion: typeof DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION;
	readonly id: string;
	readonly title: string;
	readonly revision: number;
}

interface PreparedProjectDocument {
	readonly bytes: Uint8Array;
	readonly project: CurrentProjectRoot;
	readonly sha256: string;
}

/**
 * Main-process-only project-file owner. It validates the canonical persistence
 * envelope and root identity; the main-owned identity service applies strict
 * maintained-domain current-schema validation before calling or returning from
 * this lower store boundary. No filesystem path is returned.
 */
export class DesktopLibraryProjectStore {
	#library: SharedDesktopProjectLibrary;
	#maximumDocumentBytes: number;
	#randomId: () => string;
	#statfs: DesktopLibraryMediaStatfs;

	constructor(library: SharedDesktopProjectLibrary, options: DesktopLibraryProjectStoreOptions = {}) {
		if (!(library instanceof SharedDesktopProjectLibrary)) {
			throw new TypeError('Desktop project store requires a shared desktop library');
		}
		this.#library = library;
		this.#maximumDocumentBytes = maximumDocumentBytes(options.maximumDocumentBytes);
		this.#randomId = options.randomId ?? (() => randomBytes(16).toString('hex'));
		this.#statfs = options.statfsImpl ?? statfs;
	}

	readCatalog(): DesktopLibraryMetadata {
		return this.#library.readMetadata();
	}

	async readProject(entryId: string, signal?: AbortSignal): Promise<DesktopLibraryLoadedProject | null> {
		if (typeof entryId !== 'string') throw new TypeError('Desktop library entry id must be a string');
		throwIfAborted(signal);
		const catalog = this.#library.readMetadata().projects.find(({ id }) => id === entryId);
		if (!catalog) return null;
		const project = await this.#readDocument(catalog, signal);
		return freezeLoadedProject(catalog, project);
	}

	async readProjectById(projectId: string, signal?: AbortSignal): Promise<DesktopLibraryLoadedProject | null> {
		throwIfAborted(signal);
		const catalog = projectByIdentity(this.#library.readMetadata(), projectId);
		if (!catalog) return null;
		const project = await this.#readDocument(catalog, signal);
		return freezeLoadedProject(catalog, project);
	}

	async readProjectBundleById(
		projectId: string,
		signal?: AbortSignal,
	): Promise<DesktopLibraryLoadedProjectBundle | null> {
		throwIfAborted(signal);
		const metadata = this.#library.readMetadata();
		const catalog = projectByIdentity(metadata, projectId);
		if (!catalog) return null;
		const project = await this.#readDocument(catalog, signal);
		return Object.freeze({ catalog, project, media: metadata.media });
	}

	async commitProject(options: DesktopLibraryCommitProjectOptions): Promise<DesktopLibraryLoadedProject> {
		throwIfAborted(options.signal);
		this.#library.assertLease(options.lease);
		return this.#commitPrepared(options, this.#prepareDocument(options.project));
	}

	async commitProjectById(options: DesktopLibraryCommitProjectByIdOptions): Promise<DesktopLibraryLoadedProject> {
		throwIfAborted(options.signal);
		this.#library.assertLease(options.lease);
		const prepared = this.#prepareDocument(options.project);
		const current = this.#library.readMetadata();
		const existing = projectByIdentity(current, prepared.project.id);
		const entryId = existing?.id ?? options.createEntryId();
		return this.#commitPrepared({ ...options, entryId }, prepared, current);
	}

	async deleteProjectById(options: DesktopLibraryDeleteProjectByIdOptions): Promise<boolean> {
		throwIfAborted(options.signal);
		this.#library.assertLease(options.lease);
		const current = this.#library.readMetadata();
		const existing = projectByIdentity(current, options.projectId);
		if (!existing) return false;
		const next = validateDesktopLibraryMetadata({
			schemaVersion: current.schemaVersion,
			revision: current.revision + 1,
			projects: current.projects.filter(({ id }) => id !== existing.id),
			media: current.media,
		});
		throwIfAborted(options.signal);
		this.#library.assertLease(options.lease);
		await this.#library.publishMetadata({ lease: options.lease, metadata: next, signal: options.signal });
		return true;
	}

	async #commitPrepared(
		options: DesktopLibraryCommitProjectOptions,
		prepared: PreparedProjectDocument,
		current: DesktopLibraryMetadata = this.#library.readMetadata(),
	): Promise<DesktopLibraryLoadedProject> {
		const { bytes, project, sha256 } = prepared;
		const existing = current.projects.find(({ id }) => id === options.entryId);
		assertRevisionCanAdvance(existing, project, sha256);
		if (existing && project.revision === existing.projectRevision) {
			const persisted = await this.#readDocument(existing, options.signal);
			return freezeLoadedProject(existing, persisted);
		}
		const candidate = {
			id: options.entryId,
			projectId: project.id,
			name: options.name,
			metadataFile: createDesktopLibraryProjectMetadataFile(options.entryId, project.revision, sha256),
			preferredProduct: options.preferredProduct,
			updatedAtMs: options.updatedAtMs,
			projectSchemaVersion: DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
			projectRevision: project.revision,
			byteLength: bytes.byteLength,
			sha256,
		};
		const next = validateDesktopLibraryMetadata({
			schemaVersion: current.schemaVersion,
			revision: current.revision + 1,
			projects: upsertProject(current.projects, candidate),
			media: current.media,
		});
		const catalog = requiredProject(next, options.entryId);
		await this.#ensureDocument(catalog, bytes, options.lease, options.signal);
		throwIfAborted(options.signal);
		this.#library.assertLease(options.lease);
		await this.#library.publishMetadata({ lease: options.lease, metadata: next, signal: options.signal });
		return freezeLoadedProject(catalog, project);
	}

	#prepareDocument(value: unknown): PreparedProjectDocument {
		const documentJson = serializeScapeProjectDocument(value);
		const bytes = Buffer.from(documentJson, 'utf8');
		this.#assertDocumentBytes(bytes.byteLength);
		return {
			bytes,
			project: currentProjectRoot(parseScapeProjectDocument(documentJson)),
			sha256: digest(bytes),
		};
	}

	async #ensureDocument(
		catalog: DesktopLibraryProject,
		bytes: Uint8Array,
		lease: DesktopLibraryLease,
		signal?: AbortSignal,
	): Promise<void> {
		try {
			await this.#readDocument(catalog, signal);
			this.#library.reserveProjectFile({ lease, metadataFile: catalog.metadataFile });
			this.#library.materializeProjectFile({ lease, metadataFile: catalog.metadataFile, stageFile: null });
			return;
		} catch (error) {
			if (!isMissingFile(error)) throw error;
		}
		await this.#assertAvailableStorage(bytes.byteLength, signal);
		const directory = join(this.#library.paths.projectsRoot, catalog.id);
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const directoryMetadata = await lstat(directory);
		if (!directoryMetadata.isDirectory()) {
			throw new TypeError('Desktop library project scope is not a directory');
		}
		await chmod(directory, 0o700);
		throwIfAborted(signal);
		const stageFile = createDesktopLibraryProjectStageFile(catalog.metadataFile, this.#randomId());
		const stagePath = join(this.#library.paths.projectsRoot, ...stageFile.split('/'));
		let handle: FileHandle | null = null;
		let stageExists = false;
		this.#library.reserveProjectFile({ lease, metadataFile: catalog.metadataFile, stageFile });
		try {
			handle = await open(stagePath, 'wx', 0o600);
			stageExists = true;
			await chmod(stagePath, 0o600);
			await handle.writeFile(bytes, { signal });
			await handle.sync();
			await handle.close();
			handle = null;
			throwIfAborted(signal);
			this.#library.materializeProjectFile({ lease, metadataFile: catalog.metadataFile, stageFile });
			stageExists = false;
		} catch (error) {
			await throwAfterStageCleanup(error, handle, () => this.#library.discardProjectStageFile({
				lease,
				metadataFile: catalog.metadataFile,
				removeFile: stageExists,
				stageFile,
			}));
		}
		await this.#readDocument(catalog, signal);
	}

	async #readDocument(
		catalog: DesktopLibraryProject,
		signal?: AbortSignal,
	): Promise<CurrentProjectRoot> {
		this.#assertDocumentBytes(catalog.byteLength);
		const path = join(this.#library.paths.projectsRoot, ...catalog.metadataFile.split('/'));
		const metadata = await lstat(path);
		if (!metadata.isFile()) throw new TypeError('Desktop library project document is not a regular file');
		if (metadata.size !== catalog.byteLength) {
			throw new Error('Desktop library project document byte length does not match its catalog');
		}
		throwIfAborted(signal);
		const bytes = await readFile(path, { signal });
		if (bytes.byteLength !== catalog.byteLength) {
			throw new Error('Desktop library project document byte length changed while reading');
		}
		if (digest(bytes) !== catalog.sha256) {
			throw new Error('Desktop library project document digest does not match its catalog');
		}
		const text = UTF8_DECODER.decode(bytes);
		const project = currentProjectRoot(parseScapeProjectDocument(text));
		if (project.id !== catalog.projectId
			|| project.schemaVersion !== catalog.projectSchemaVersion
			|| project.revision !== catalog.projectRevision) {
			throw new Error('Desktop library project document identity does not match its catalog');
		}
		return project;
	}

	#assertDocumentBytes(value: number): void {
		if (!Number.isSafeInteger(value) || value < 1 || value > this.#maximumDocumentBytes) {
			throw new RangeError('Desktop library project document exceeds its byte limit');
		}
	}

	/** Point-in-time fail-closed admission before project-document stage creation. */
	async #assertAvailableStorage(byteLength: number, signal?: AbortSignal): Promise<void> {
		let details: unknown;
		try {
			details = await this.#statfs(this.#library.paths.projectsRoot, { bigint: true });
		} catch (error) {
			throw new Error('Could not inspect filesystem capacity for the project document', { cause: error });
		}
		throwIfAborted(signal);
		let availableBytes: bigint;
		try {
			availableBytes = availableStorageBytes(details);
		} catch (error) {
			throw new Error('Project-document filesystem capacity information is invalid', { cause: error });
		}
		if (availableBytes < BigInt(byteLength)) {
			throw new RangeError('Available disk space is below the staged project document size');
		}
	}
}

function currentProjectRoot(value: unknown): CurrentProjectRoot {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('Desktop library project document must contain an object');
	}
	const project = value as Record<string, unknown>;
	if (project.schemaVersion !== DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION) {
		throw new RangeError('Desktop library accepts only the current project schema');
	}
	if (typeof project.id !== 'string' || !project.id.trim()) {
		throw new TypeError('Desktop library project id must be a non-empty string');
	}
	if (Buffer.byteLength(project.id, 'utf8') > MAX_LIBRARY_PROJECT_ID_BYTES) {
		throw new RangeError('Desktop library project id exceeds its byte limit');
	}
	if (typeof project.title !== 'string' || !project.title.trim()) {
		throw new TypeError('Desktop library project title must be a non-empty string');
	}
	if (!Number.isSafeInteger(project.revision) || (project.revision as number) < 0) {
		throw new RangeError('Desktop library project revision must be a non-negative safe integer');
	}
	return project as CurrentProjectRoot;
}

function assertRevisionCanAdvance(
	existing: DesktopLibraryProject | undefined,
	project: CurrentProjectRoot,
	sha256: string,
): void {
	if (!existing) return;
	if (existing.projectId !== project.id) {
		throw new Error('Desktop library entry cannot change project identity');
	}
	if (project.revision < existing.projectRevision) {
		throw new Error('Desktop library project revision cannot move backwards');
	}
	if (project.revision === existing.projectRevision && sha256 !== existing.sha256) {
		throw new Error('Desktop library commit has a divergent project revision');
	}
}

function upsertProject(
	projects: readonly DesktopLibraryProject[],
	candidate: Readonly<{ id: string }>,
): readonly unknown[] {
	const index = projects.findIndex(({ id }) => id === candidate.id);
	if (index < 0) return [...projects, candidate];
	return projects.map((project, projectIndex) => projectIndex === index ? candidate : project);
}

function requiredProject(metadata: DesktopLibraryMetadata, entryId: string): DesktopLibraryProject {
	const project = metadata.projects.find(({ id }) => id === entryId);
	if (!project) throw new Error('Validated desktop library project entry is missing');
	return project;
}

function projectByIdentity(
	metadata: DesktopLibraryMetadata,
	projectId: string,
): DesktopLibraryProject | undefined {
	if (typeof projectId !== 'string' || !projectId.trim()) {
		throw new TypeError('Desktop library project identity must be a non-empty string');
	}
	if (Buffer.byteLength(projectId, 'utf8') > MAX_LIBRARY_PROJECT_ID_BYTES) {
		throw new RangeError('Desktop library project identity exceeds its byte limit');
	}
	const matches = metadata.projects.filter((project) => project.projectId === projectId);
	if (matches.length > 1) throw new Error('Desktop library catalog has a duplicate project identity');
	return matches[0];
}

function maximumDocumentBytes(value: number | undefined): number {
	const maximum = value ?? MAX_LIBRARY_PROJECT_DOCUMENT_BYTES;
	if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_LIBRARY_PROJECT_DOCUMENT_BYTES) {
		throw new RangeError('Desktop project document byte limit must be positive and cannot exceed its hard limit');
	}
	return maximum;
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function freezeLoadedProject(
	catalog: DesktopLibraryProject,
	project: CurrentProjectRoot,
): DesktopLibraryLoadedProject {
	return Object.freeze({ catalog, project });
}

function isMissingFile(error: unknown): boolean {
	return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

async function throwAfterStageCleanup(
	primary: unknown,
	handle: FileHandle | null,
	cleanup: () => boolean,
): Promise<never> {
	const cleanupErrors: unknown[] = [];
	if (handle) {
		try {
			await handle.close();
		} catch (error) {
			cleanupErrors.push(error);
		}
	}
	try {
		cleanup();
	} catch (error) {
		cleanupErrors.push(error);
	}
	if (cleanupErrors.length > 0) {
		throw new AggregateError([primary, ...cleanupErrors], 'Desktop project write and staging cleanup failed');
	}
	throw primary;
}
