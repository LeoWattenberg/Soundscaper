/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';

import {
	DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
	MAX_LIBRARY_PROJECT_DOCUMENT_BYTES,
	MAX_LIBRARY_PROJECT_ID_BYTES,
	type DesktopLibraryProject,
} from './project-library-contract.ts';
import type { DesktopProjectLibraryHost } from './project-library-host.ts';
import {
	DesktopLibraryProjectConflictError,
	type DesktopLibraryLoadedProject,
} from './project-library-projects.ts';
import {
	DesktopSharedProjectMediaService,
	type DesktopSharedProjectBundle,
	type DesktopSharedSourceChunkWrite,
	type DesktopSharedSourceWriteAdmission,
	type DesktopSharedSourceWriteCompletion,
	type DesktopSharedSourceWriteDeclaration,
	type DesktopSharedManagedSourceDescriptor,
} from './project-library-editor-media-service.ts';
import {
	parseScapeProjectDocument,
	resolveScapeProjectBinaryLimits,
	type ScapeProjectBinaryLimits,
	serializeScapeProjectDocument,
} from '../src/common/editor/scape-project-document.ts';
import { validateAudioEditorProjectV14 } from '../src/common/editor/project-v14-validation.ts';

const ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;

export interface DesktopSharedProjectDescriptor {
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly updatedAt: string;
}

export interface DesktopSharedProjectCommitRequest {
	readonly document: string;
	readonly expectedRevision: number | null;
}

export type DesktopSharedProjectCommitResult =
	| Readonly<{ status: 'committed'; document: string }>
	| Readonly<{ status: 'conflict'; currentRevision: number }>;

export interface DesktopSharedProjectLibraryServiceOptions {
	readonly createEntryId?: () => string;
	readonly createWriteId?: () => string;
	readonly documentLimits?: Partial<ScapeProjectBinaryLimits>;
	readonly now?: () => number;
}

interface CurrentDesktopProjectRoot extends Record<string, unknown> {
	readonly schemaVersion: typeof DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION;
	readonly id: string;
	readonly title: string;
	readonly revision: number;
}

type DesktopSharedProjectLibraryHost = Pick<DesktopProjectLibraryHost,
	'commitProjectById'
	| 'deleteProjectById'
	| 'publishManagedMedia'
	| 'readCatalog'
	| 'readManagedMedia'
	| 'readProjectById'
	| 'readProjectBundleById'
	| 'snapshot'>;

/**
 * Main-process facade for the editor's canonical-text project boundary.
 * Strict maintained-domain current-schema validation runs before store mutation
 * or read return;
 * catalog implementation details and filesystem capabilities never cross it.
 */
export class DesktopSharedProjectLibraryService {
	#createEntryId: () => string;
	#documentLimits: Readonly<ScapeProjectBinaryLimits>;
	#host: DesktopSharedProjectLibraryHost;
	#media: DesktopSharedProjectMediaService;
	#now: () => number;

	constructor(
		host: DesktopSharedProjectLibraryHost,
		options: DesktopSharedProjectLibraryServiceOptions = {},
	) {
		assertHost(host);
		this.#host = host;
		this.#media = new DesktopSharedProjectMediaService(host, { randomId: options.createWriteId });
		this.#createEntryId = options.createEntryId ?? (() => `p${randomBytes(18).toString('base64url')}`);
		this.#documentLimits = resolveScapeProjectBinaryLimits(options.documentLimits ?? {});
		this.#now = options.now ?? Date.now;
	}

	listSharedProjects(): readonly DesktopSharedProjectDescriptor[] {
		return Object.freeze(this.#host.readCatalog().projects.map(projectDescriptor));
	}

	async readSharedProject(projectId: string, signal?: AbortSignal): Promise<string | null> {
		const loaded = await this.#host.readProjectById(projectId, signal);
		if (!loaded) return null;
		return canonicalLoadedProject(loaded, this.#documentLimits);
	}

	readSharedProjectBundle(projectId: string, signal?: AbortSignal): Promise<DesktopSharedProjectBundle | null> {
		return this.#media.readProjectBundle(projectId, signal);
	}

	beginSharedSourceWrite(
		declaration: DesktopSharedSourceWriteDeclaration,
		signal?: AbortSignal,
	): Promise<DesktopSharedSourceWriteAdmission> {
		return this.#media.beginSourceWrite(declaration, signal);
	}

	writeSharedSourceChunk(value: DesktopSharedSourceChunkWrite) {
		return this.#media.writeSourceChunk(value);
	}

	finishSharedSourceWrite(
		value: DesktopSharedSourceWriteCompletion,
	): Promise<DesktopSharedManagedSourceDescriptor> {
		return this.#media.finishSourceWrite(value);
	}

	abortSharedSourceWrite(writeId: string): Promise<boolean> {
		return this.#media.abortSourceWrite(writeId);
	}

	readSharedSourceChunk(
		bindingId: string,
		options: Readonly<{ offset: number; length: number; signal?: AbortSignal }>,
	): Promise<Uint8Array> {
		return this.#media.readSourceChunk(bindingId, options);
	}

	dispose(): Promise<void> {
		return this.#media.dispose();
	}

	async commitSharedProject(
		request: DesktopSharedProjectCommitRequest,
		signal?: AbortSignal,
	): Promise<DesktopSharedProjectCommitResult> {
		const commit = commitRequest(request);
		const project = parseCurrentProject(commit.document, this.#documentLimits);
		const updatedAtMs = validTimestamp(this.#now());
		const preferredProduct = this.#host.snapshot().owner.product;
		try {
			const loaded = await this.#host.commitProjectById({
				createEntryId: () => validEntryId(this.#createEntryId()),
				expectedRevision: commit.expectedRevision,
				name: project.title,
				preferredProduct,
				project,
				signal,
				updatedAtMs,
			});
			return Object.freeze({
				status: 'committed',
				document: canonicalLoadedProject(loaded, this.#documentLimits),
			});
		} catch (error) {
			if (!(error instanceof DesktopLibraryProjectConflictError)) throw error;
			return Object.freeze({ status: 'conflict', currentRevision: error.currentRevision });
		}
	}

	deleteSharedProject(projectId: string, signal?: AbortSignal): Promise<boolean> {
		return this.#host.deleteProjectById({ projectId, signal });
	}
}

function commitRequest(value: DesktopSharedProjectCommitRequest): DesktopSharedProjectCommitRequest {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared project commit request is required');
	}
	const expectedRevision = value.expectedRevision;
	if (expectedRevision !== null
		&& (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
		throw new RangeError('Desktop shared project expected revision must be null or a non-negative safe integer');
	}
	return value;
}

function parseCurrentProject(
	canonicalDocument: string,
	limits: Readonly<ScapeProjectBinaryLimits>,
): CurrentDesktopProjectRoot {
	if (typeof canonicalDocument !== 'string') {
		throw new TypeError('A canonical Scape project document is required');
	}
	const byteLength = Buffer.byteLength(canonicalDocument, 'utf8');
	if (byteLength < 1 || byteLength > MAX_LIBRARY_PROJECT_DOCUMENT_BYTES) {
		throw new RangeError('Canonical Scape project document exceeds its byte limit');
	}
	return currentProjectRoot(parseScapeProjectDocument(canonicalDocument, { limits }), limits);
}

function canonicalLoadedProject(
	loaded: DesktopLibraryLoadedProject,
	limits: Readonly<ScapeProjectBinaryLimits>,
): string {
	return serializeScapeProjectDocument(currentProjectRoot(loaded.project, limits), { limits });
}

function currentProjectRoot(
	value: unknown,
	limits: Readonly<ScapeProjectBinaryLimits>,
): CurrentDesktopProjectRoot {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('Desktop shared project document must contain an object');
	}
	const project = value as Record<string, unknown>;
	validateAudioEditorProjectV14(project, {
		limits: {
			maximumTraversalNodes: limits.maximumTraversalNodes,
			maximumTraversalDepth: limits.maximumTraversalDepth,
		},
	});
	if (project.schemaVersion !== DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION) {
		throw new RangeError('Desktop shared project service accepts only the current project schema');
	}
	sharedProjectId(project.id);
	humanText(project.title, 'title', 255);
	if (!Number.isSafeInteger(project.revision) || Number(project.revision) < 0) {
		throw new RangeError('Desktop shared project revision must be a non-negative safe integer');
	}
	return project as CurrentDesktopProjectRoot;
}

function sharedProjectId(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new TypeError('Desktop shared project id must be a non-empty string');
	}
	if (Buffer.byteLength(value, 'utf8') > MAX_LIBRARY_PROJECT_ID_BYTES) {
		throw new RangeError('Desktop shared project id exceeds its byte limit');
	}
	return value;
}

function humanText(value: unknown, label: string, maximumLength: number): string {
	if (typeof value !== 'string' || !value || value.length > maximumLength
		|| value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError(`Desktop shared project ${label} is invalid`);
	}
	return value;
}

function projectDescriptor(project: DesktopLibraryProject): DesktopSharedProjectDescriptor {
	return Object.freeze({
		id: project.projectId,
		title: project.name,
		revision: project.projectRevision,
		updatedAt: isoTimestamp(project.updatedAtMs),
	});
}

function isoTimestamp(value: number): string {
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) throw new RangeError('Desktop project update time is outside the ISO range');
	return date.toISOString();
}

function validTimestamp(value: number): number {
	if (!Number.isSafeInteger(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) {
		throw new RangeError('Desktop project update time must be a non-negative ISO timestamp');
	}
	return value;
}

function validEntryId(value: string): string {
	if (typeof value !== 'string' || !ENTRY_ID.test(value)) {
		throw new TypeError('Desktop shared project entry id generator returned an invalid value');
	}
	return value;
}

function assertHost(value: DesktopSharedProjectLibraryHost): void {
	if (!value || typeof value !== 'object') {
		throw new TypeError('Desktop shared project service requires a library host');
	}
	for (const method of [
		'commitProjectById',
		'deleteProjectById',
		'publishManagedMedia',
		'readCatalog',
		'readManagedMedia',
		'readProjectById',
		'readProjectBundleById',
		'snapshot',
	] as const) {
		if (typeof value[method] !== 'function') {
			throw new TypeError('Desktop shared project service requires a library host');
		}
	}
}
