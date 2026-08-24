/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateSoundscaperDesktopProjectLibraryV11ProjectId,
} from './soundscaper-project-library-v11-transfer-contract.ts';

const CATALOG_FIELDS = ['metadataRevision', 'projects'] as const;
const SUMMARY_FIELDS = ['id', 'title', 'revision', 'updatedAt'] as const;
const DELETE_FIELDS = ['projectId', 'expectedMetadataRevision', 'expectedProject'] as const;
const DELETE_RESULT_FIELDS = ['projectId', 'metadataRevision', 'deleted'] as const;
const DUPLICATE_FIELDS = [
	'sourceProjectId', 'copyProjectId', 'title', 'timestamp',
	'expectedMetadataRevision', 'expectedSource',
] as const;
const EXPECTED_FIELDS = ['projectRevision', 'projectSha256'] as const;
const MAXIMUM_PROJECTS = 10_000;
const MAXIMUM_TITLE_BYTES = 1_024;

export interface SoundscaperDesktopProjectLibraryV11ProjectSummary {
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly updatedAt: string;
}

export interface SoundscaperDesktopProjectLibraryV11CatalogSnapshot {
	readonly metadataRevision: number;
	readonly projects: readonly Readonly<SoundscaperDesktopProjectLibraryV11ProjectSummary>[];
}

export interface SoundscaperDesktopProjectLibraryV11ExpectedProject {
	readonly projectRevision: number;
	readonly projectSha256: string;
}

export interface SoundscaperDesktopProjectLibraryV11DeleteRequest {
	readonly projectId: string;
	readonly expectedMetadataRevision: number;
	readonly expectedProject: Readonly<SoundscaperDesktopProjectLibraryV11ExpectedProject>;
}

export interface SoundscaperDesktopProjectLibraryV11DeleteResult {
	readonly projectId: string;
	readonly metadataRevision: number;
	readonly deleted: true;
}

export interface SoundscaperDesktopProjectLibraryV11DuplicateRequest {
	readonly sourceProjectId: string;
	readonly copyProjectId: string;
	readonly title: string;
	readonly timestamp: string;
	readonly expectedMetadataRevision: number;
	readonly expectedSource: Readonly<SoundscaperDesktopProjectLibraryV11ExpectedProject>;
}

export function validateSoundscaperDesktopProjectLibraryV11CatalogSnapshot(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryV11CatalogSnapshot> {
	const raw = closedRecord(value, CATALOG_FIELDS, 'Soundscaper V11 catalog snapshot');
	const projects = denseArray(raw.projects, 'Soundscaper V11 project summaries', MAXIMUM_PROJECTS)
		.map(projectSummary);
	if (new Set(projects.map(({ id }) => id)).size !== projects.length) {
		throw new TypeError('Soundscaper V11 project summaries contain duplicate identities');
	}
	return Object.freeze({
		metadataRevision: nonNegativeInteger(raw.metadataRevision, 'metadata revision'),
		projects: Object.freeze(projects),
	});
}

export function validateSoundscaperDesktopProjectLibraryV11DeleteRequest(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryV11DeleteRequest> {
	const raw = closedRecord(value, DELETE_FIELDS, 'Soundscaper V11 delete request');
	return Object.freeze({
		projectId: validateSoundscaperDesktopProjectLibraryV11ProjectId(raw.projectId),
		expectedMetadataRevision: nonNegativeInteger(raw.expectedMetadataRevision, 'expected metadata revision'),
		expectedProject: expectedProject(raw.expectedProject),
	});
}

export function validateSoundscaperDesktopProjectLibraryV11DeleteResult(
	value: unknown,
	expectedProjectId?: string,
): Readonly<SoundscaperDesktopProjectLibraryV11DeleteResult> {
	const raw = closedRecord(value, DELETE_RESULT_FIELDS, 'Soundscaper V11 delete result');
	const projectId = validateSoundscaperDesktopProjectLibraryV11ProjectId(raw.projectId);
	if (expectedProjectId !== undefined
		&& projectId !== validateSoundscaperDesktopProjectLibraryV11ProjectId(expectedProjectId)) {
		throw new Error('Soundscaper V11 delete returned another project identity');
	}
	if (raw.deleted !== true) throw new TypeError('Soundscaper V11 delete result is invalid');
	return Object.freeze({
		projectId,
		metadataRevision: nonNegativeInteger(raw.metadataRevision, 'metadata revision'),
		deleted: true,
	});
}

export function validateSoundscaperDesktopProjectLibraryV11DuplicateRequest(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryV11DuplicateRequest> {
	const raw = closedRecord(value, DUPLICATE_FIELDS, 'Soundscaper V11 duplicate request');
	return Object.freeze({
		sourceProjectId: validateSoundscaperDesktopProjectLibraryV11ProjectId(raw.sourceProjectId),
		copyProjectId: validateSoundscaperDesktopProjectLibraryV11ProjectId(raw.copyProjectId),
		title: boundedTitle(raw.title),
		timestamp: canonicalTimestamp(raw.timestamp),
		expectedMetadataRevision: nonNegativeInteger(raw.expectedMetadataRevision, 'expected metadata revision'),
		expectedSource: expectedProject(raw.expectedSource),
	});
}

function projectSummary(value: unknown): Readonly<SoundscaperDesktopProjectLibraryV11ProjectSummary> {
	const raw = closedRecord(value, SUMMARY_FIELDS, 'Soundscaper V11 project summary');
	return Object.freeze({
		id: validateSoundscaperDesktopProjectLibraryV11ProjectId(raw.id),
		title: boundedTitle(raw.title),
		revision: nonNegativeInteger(raw.revision, 'project revision'),
		updatedAt: canonicalTimestamp(raw.updatedAt),
	});
}

function expectedProject(value: unknown): Readonly<SoundscaperDesktopProjectLibraryV11ExpectedProject> {
	const raw = closedRecord(value, EXPECTED_FIELDS, 'Soundscaper V11 expected project');
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
		throw new TypeError('Soundscaper V11 project title is invalid');
	}
	return value;
}

function canonicalTimestamp(value: unknown): string {
	if (typeof value !== 'string') throw new TypeError('Soundscaper V11 project timestamp is invalid');
	const time = Date.parse(value);
	if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
		throw new TypeError('Soundscaper V11 project timestamp is invalid');
	}
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Soundscaper V11 ${label} must be a non-negative safe integer`);
	}
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError(`Soundscaper V11 ${label} digest is invalid`);
	}
	return value;
}
