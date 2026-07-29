/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomBytes } from 'node:crypto';
import {
	chmod,
	lstat,
	mkdir,
	open,
	readFile,
	rename,
	unlink,
	type FileHandle,
} from 'node:fs/promises';
import { join } from 'node:path';

import { parseScapeProjectDocument, serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { throwIfAborted } from './project-library-abort.ts';
import {
	createDesktopLibraryProjectMetadataFile,
	DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
	MAX_LIBRARY_PROJECT_DOCUMENT_BYTES,
	MAX_LIBRARY_PROJECT_ID_BYTES,
	type DesktopLibraryLease,
	type DesktopLibraryMetadata,
	type DesktopLibraryProduct,
	type DesktopLibraryProject,
	validateDesktopLibraryMetadata,
} from './project-library-contract.ts';
import { SharedDesktopProjectLibrary } from './project-library.ts';

const STAGE_ID = /^[a-f0-9]{32}$/u;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export interface DesktopLibraryProjectStoreOptions {
	readonly maximumDocumentBytes?: number;
	readonly randomId?: () => string;
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

export interface DesktopLibraryLoadedProject {
	readonly catalog: DesktopLibraryProject;
	readonly project: Readonly<Record<string, unknown>>;
}

interface CurrentProjectRoot extends Record<string, unknown> {
	readonly schemaVersion: typeof DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION;
	readonly id: string;
	readonly title: string;
	readonly revision: number;
}

/**
 * Main-process-only project-file owner. It validates the canonical persistence
 * envelope and root identity; the editor remains responsible for full domain
 * validation before commit and activation. No filesystem path is returned.
 */
export class DesktopLibraryProjectStore {
	#library: SharedDesktopProjectLibrary;
	#maximumDocumentBytes: number;
	#randomId: () => string;

	constructor(library: SharedDesktopProjectLibrary, options: DesktopLibraryProjectStoreOptions = {}) {
		if (!(library instanceof SharedDesktopProjectLibrary)) {
			throw new TypeError('Desktop project store requires a shared desktop library');
		}
		this.#library = library;
		this.#maximumDocumentBytes = maximumDocumentBytes(options.maximumDocumentBytes);
		this.#randomId = options.randomId ?? (() => randomBytes(16).toString('hex'));
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

	async commitProject(options: DesktopLibraryCommitProjectOptions): Promise<DesktopLibraryLoadedProject> {
		throwIfAborted(options.signal);
		this.#library.assertLease(options.lease);
		const documentJson = serializeScapeProjectDocument(options.project);
		const bytes = Buffer.from(documentJson, 'utf8');
		this.#assertDocumentBytes(bytes.byteLength);
		const project = currentProjectRoot(parseScapeProjectDocument(documentJson));
		const sha256 = digest(bytes);
		const current = this.#library.readMetadata();
		const existing = current.projects.find(({ id }) => id === options.entryId);
		assertRevisionCanAdvance(existing, project, sha256);
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
		await this.#ensureDocument(catalog, bytes, options.signal);
		throwIfAborted(options.signal);
		this.#library.assertLease(options.lease);
		await this.#library.publishMetadata({ lease: options.lease, metadata: next, signal: options.signal });
		return freezeLoadedProject(catalog, project);
	}

	async #ensureDocument(
		catalog: DesktopLibraryProject,
		bytes: Uint8Array,
		signal?: AbortSignal,
	): Promise<void> {
		try {
			await this.#readDocument(catalog, signal);
			return;
		} catch (error) {
			if (!isMissingFile(error)) throw error;
		}
		const directory = join(this.#library.paths.projectsRoot, catalog.id);
		const finalPath = join(this.#library.paths.projectsRoot, ...catalog.metadataFile.split('/'));
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const directoryMetadata = await lstat(directory);
		if (!directoryMetadata.isDirectory()) {
			throw new TypeError('Desktop library project scope is not a directory');
		}
		await chmod(directory, 0o700);
		throwIfAborted(signal);
		const stageId = this.#randomId();
		if (!STAGE_ID.test(stageId)) throw new TypeError('Desktop project stage id generator returned an invalid value');
		const stagePath = join(directory, `.${stageId}.stage`);
		let handle: FileHandle | null = null;
		let stageExists = false;
		try {
			handle = await open(stagePath, 'wx', 0o600);
			stageExists = true;
			await chmod(stagePath, 0o600);
			await handle.writeFile(bytes, { signal });
			await handle.sync();
			await handle.close();
			handle = null;
			throwIfAborted(signal);
			await rename(stagePath, finalPath);
			stageExists = false;
			await syncDirectory(directory);
		} catch (error) {
			await throwAfterStageCleanup(error, handle, stageExists ? stagePath : null);
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

async function syncDirectory(directory: string): Promise<void> {
	if (process.platform === 'win32') return;
	const handle = await open(directory, 'r');
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function throwAfterStageCleanup(
	primary: unknown,
	handle: FileHandle | null,
	stagePath: string | null,
): Promise<never> {
	const cleanupErrors: unknown[] = [];
	if (handle) {
		try {
			await handle.close();
		} catch (error) {
			cleanupErrors.push(error);
		}
	}
	if (stagePath) {
		try {
			await unlink(stagePath);
		} catch (error) {
			if (!isMissingFile(error)) cleanupErrors.push(error);
		}
	}
	if (cleanupErrors.length > 0) {
		throw new AggregateError([primary, ...cleanupErrors], 'Desktop project write and staging cleanup failed');
	}
	throw primary;
}
