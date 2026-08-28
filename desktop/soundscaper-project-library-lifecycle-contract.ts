/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY,
	SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
} from './soundscaper-project-library-contract.ts';
import {
	validateSoundscaperDesktopProjectLibraryProjectId,
} from './soundscaper-project-library-transfer-contract.ts';

const CATALOG_FIELDS = ['metadataRevision', 'projects'] as const;
const SUMMARY_FIELDS = ['schemaFamily', 'schemaVersion', 'id', 'title', 'revision', 'updatedAt'] as const;
const DELETE_FIELDS = ['projectId', 'expectedMetadataRevision', 'expectedProject'] as const;
const DELETE_RESULT_FIELDS = ['projectId', 'metadataRevision', 'deleted'] as const;
const DUPLICATE_FIELDS = [
	'sourceProjectId', 'copyProjectId', 'title', 'timestamp',
	'expectedMetadataRevision', 'expectedSource',
] as const;
const EXPECTED_FIELDS = ['projectRevision', 'projectSha256'] as const;
const MAXIMUM_PROJECTS = 10_000;
const MAXIMUM_TITLE_BYTES = 1_024;

export interface SoundscaperDesktopProjectLibraryProjectSummary {
	readonly schemaFamily: typeof SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY;
	readonly schemaVersion: typeof SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION;
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly updatedAt: string;
}

export interface SoundscaperDesktopProjectLibraryCatalogSnapshot {
	readonly metadataRevision: number;
	readonly projects: readonly Readonly<SoundscaperDesktopProjectLibraryProjectSummary>[];
}

export interface SoundscaperDesktopProjectLibraryExpectedProject {
	readonly projectRevision: number;
	readonly projectSha256: string;
}

export interface SoundscaperDesktopProjectLibraryDeleteRequest {
	readonly projectId: string;
	readonly expectedMetadataRevision: number;
	readonly expectedProject: Readonly<SoundscaperDesktopProjectLibraryExpectedProject>;
}

export interface SoundscaperDesktopProjectLibraryDeleteResult {
	readonly projectId: string;
	readonly metadataRevision: number;
	readonly deleted: true;
}

export interface SoundscaperDesktopProjectLibraryDuplicateRequest {
	readonly sourceProjectId: string;
	readonly copyProjectId: string;
	readonly title: string;
	readonly timestamp: string;
	readonly expectedMetadataRevision: number;
	readonly expectedSource: Readonly<SoundscaperDesktopProjectLibraryExpectedProject>;
}

export function validateSoundscaperDesktopProjectLibraryCatalogSnapshot(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryCatalogSnapshot> {
	const raw = closedRecord(value, CATALOG_FIELDS, 'Soundscaper desktop baseline catalog snapshot');
	const projects = denseArray(raw.projects, 'Soundscaper desktop baseline project summaries', MAXIMUM_PROJECTS)
		.map(projectSummary);
	if (new Set(projects.map(({ id }) => id)).size !== projects.length) {
		throw new TypeError('Soundscaper desktop baseline project summaries contain duplicate identities');
	}
	return Object.freeze({
		metadataRevision: nonNegativeInteger(raw.metadataRevision, 'metadata revision'),
		projects: Object.freeze(projects),
	});
}

export function validateSoundscaperDesktopProjectLibraryDeleteRequest(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryDeleteRequest> {
	const raw = closedRecord(value, DELETE_FIELDS, 'Soundscaper desktop baseline delete request');
	return Object.freeze({
		projectId: validateSoundscaperDesktopProjectLibraryProjectId(raw.projectId),
		expectedMetadataRevision: nonNegativeInteger(raw.expectedMetadataRevision, 'expected metadata revision'),
		expectedProject: expectedProject(raw.expectedProject),
	});
}

export function validateSoundscaperDesktopProjectLibraryDeleteResult(
	value: unknown,
	expectedProjectId?: string,
): Readonly<SoundscaperDesktopProjectLibraryDeleteResult> {
	const raw = closedRecord(value, DELETE_RESULT_FIELDS, 'Soundscaper desktop baseline delete result');
	const projectId = validateSoundscaperDesktopProjectLibraryProjectId(raw.projectId);
	if (expectedProjectId !== undefined
		&& projectId !== validateSoundscaperDesktopProjectLibraryProjectId(expectedProjectId)) {
		throw new Error('Soundscaper desktop baseline delete returned another project identity');
	}
	if (raw.deleted !== true) throw new TypeError('Soundscaper desktop baseline delete result is invalid');
	return Object.freeze({
		projectId,
		metadataRevision: nonNegativeInteger(raw.metadataRevision, 'metadata revision'),
		deleted: true,
	});
}

export function validateSoundscaperDesktopProjectLibraryDuplicateRequest(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryDuplicateRequest> {
	const raw = closedRecord(value, DUPLICATE_FIELDS, 'Soundscaper desktop baseline duplicate request');
	return Object.freeze({
		sourceProjectId: validateSoundscaperDesktopProjectLibraryProjectId(raw.sourceProjectId),
		copyProjectId: validateSoundscaperDesktopProjectLibraryProjectId(raw.copyProjectId),
		title: boundedTitle(raw.title),
		timestamp: canonicalTimestamp(raw.timestamp),
		expectedMetadataRevision: nonNegativeInteger(raw.expectedMetadataRevision, 'expected metadata revision'),
		expectedSource: expectedProject(raw.expectedSource),
	});
}

function projectSummary(value: unknown): Readonly<SoundscaperDesktopProjectLibraryProjectSummary> {
	const raw = closedRecord(value, SUMMARY_FIELDS, 'Soundscaper desktop baseline project summary');
	if (raw.schemaFamily !== SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY
		|| raw.schemaVersion !== SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION) {
		throw new TypeError('Soundscaper desktop baseline project summary has an unsupported identity');
	}
	return Object.freeze({
		schemaFamily: SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY,
		schemaVersion: SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
		id: validateSoundscaperDesktopProjectLibraryProjectId(raw.id),
		title: boundedTitle(raw.title),
		revision: nonNegativeInteger(raw.revision, 'project revision'),
		updatedAt: canonicalTimestamp(raw.updatedAt),
	});
}

function expectedProject(value: unknown): Readonly<SoundscaperDesktopProjectLibraryExpectedProject> {
	const raw = closedRecord(value, EXPECTED_FIELDS, 'Soundscaper desktop baseline expected project');
	return Object.freeze({
		projectRevision: nonNegativeInteger(raw.projectRevision, 'expected project revision'),
		projectSha256: digest(raw.projectSha256, 'expected project'),
	});
}

function closedRecord<const Field extends string>(value: unknown, fields: readonly Field[], name: string) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${name} has missing or unsupported fields`);
	const result = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property`);
		}
		result[field] = descriptor.value;
	}
	return result;
}

function denseArray(value: unknown, name: string, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`${name} must be a bounded plain dense array`);
	}
	return value.map((_, index) => {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must contain only data elements`);
		}
		return descriptor.value;
	});
}

function boundedTitle(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()
		|| new TextEncoder().encode(value).byteLength > MAXIMUM_TITLE_BYTES) {
		throw new TypeError('Soundscaper desktop baseline project title is invalid');
	}
	return value;
}

function canonicalTimestamp(value: unknown): string {
	if (typeof value !== 'string') throw new TypeError('Soundscaper desktop baseline project timestamp is invalid');
	const time = Date.parse(value);
	if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
		throw new TypeError('Soundscaper desktop baseline project timestamp is invalid');
	}
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Soundscaper desktop baseline ${label} must be a non-negative safe integer`);
	}
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError(`Soundscaper desktop baseline ${label} digest is invalid`);
	}
	return value;
}
