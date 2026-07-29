/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';

import {
	DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
	MAX_LIBRARY_PROJECT_DOCUMENT_BYTES,
	MAX_LIBRARY_PROJECT_ID_BYTES,
	type DesktopLibraryProject,
} from './project-library-contract.ts';
import type { DesktopProjectLibraryHost } from './project-library-host.ts';
import type { DesktopLibraryLoadedProject } from './project-library-projects.ts';
import {
	parseScapeProjectDocument,
	serializeScapeProjectDocument,
} from '../src/common/editor/scape-project-document.ts';
import { validateAudioEditorProjectV9 } from '../src/common/editor/project-v9-validation.ts';

const ENTRY_ID = /^[A-Za-z0-9_-]{8,128}$/u;

export interface DesktopSharedProjectDescriptor {
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly updatedAt: string;
}

export interface DesktopSharedProjectLibraryServiceOptions {
	readonly createEntryId?: () => string;
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
	| 'readCatalog'
	| 'readProjectById'
	| 'snapshot'>;

/**
 * Main-process facade for the editor's canonical-text project boundary.
 * Catalog implementation details and filesystem capabilities never cross it.
 */
export class DesktopSharedProjectLibraryService {
	#createEntryId: () => string;
	#host: DesktopSharedProjectLibraryHost;
	#now: () => number;

	constructor(
		host: DesktopSharedProjectLibraryHost,
		options: DesktopSharedProjectLibraryServiceOptions = {},
	) {
		assertHost(host);
		this.#host = host;
		this.#createEntryId = options.createEntryId ?? (() => randomBytes(18).toString('base64url'));
		this.#now = options.now ?? Date.now;
	}

	listSharedProjects(): readonly DesktopSharedProjectDescriptor[] {
		return Object.freeze(this.#host.readCatalog().projects.map(projectDescriptor));
	}

	async readSharedProject(projectId: string, signal?: AbortSignal): Promise<string | null> {
		const loaded = await this.#host.readProjectById(projectId, signal);
		if (!loaded) return null;
		return canonicalLoadedProject(loaded);
	}

	async commitSharedProject(canonicalDocument: string, signal?: AbortSignal): Promise<string> {
		const project = parseCurrentProject(canonicalDocument);
		const updatedAtMs = validTimestamp(this.#now());
		const preferredProduct = this.#host.snapshot().owner.product;
		const loaded = await this.#host.commitProjectById({
			createEntryId: () => validEntryId(this.#createEntryId()),
			name: project.title,
			preferredProduct,
			project,
			signal,
			updatedAtMs,
		});
		return canonicalLoadedProject(loaded);
	}

	deleteSharedProject(projectId: string, signal?: AbortSignal): Promise<boolean> {
		return this.#host.deleteProjectById({ projectId, signal });
	}
}

function parseCurrentProject(canonicalDocument: string): CurrentDesktopProjectRoot {
	if (typeof canonicalDocument !== 'string') {
		throw new TypeError('A canonical Scape project document is required');
	}
	const byteLength = Buffer.byteLength(canonicalDocument, 'utf8');
	if (byteLength < 1 || byteLength > MAX_LIBRARY_PROJECT_DOCUMENT_BYTES) {
		throw new RangeError('Canonical Scape project document exceeds its byte limit');
	}
	return currentProjectRoot(parseScapeProjectDocument(canonicalDocument));
}

function canonicalLoadedProject(loaded: DesktopLibraryLoadedProject): string {
	return serializeScapeProjectDocument(currentProjectRoot(loaded.project));
}

function currentProjectRoot(value: unknown): CurrentDesktopProjectRoot {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('Desktop shared project document must contain an object');
	}
	const project = value as Record<string, unknown>;
	if (project.schemaVersion !== DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION) {
		throw new RangeError('Desktop shared project service accepts only the current project schema');
	}
	sharedProjectId(project.id);
	humanText(project.title, 'title', 255);
	if (!Number.isSafeInteger(project.revision) || Number(project.revision) < 0) {
		throw new RangeError('Desktop shared project revision must be a non-negative safe integer');
	}
	validateAudioEditorProjectV9(project);
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
		'readCatalog',
		'readProjectById',
		'snapshot',
	] as const) {
		if (typeof value[method] !== 'function') {
			throw new TypeError('Desktop shared project service requires a library host');
		}
	}
}
