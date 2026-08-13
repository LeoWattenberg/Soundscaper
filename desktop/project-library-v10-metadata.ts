/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION,
} from './project-library-v10-contract.ts';
import {
	isFramescaperDesktopLibraryProxyMediaBindingId,
	proxyRelativeFileForFramescaperDesktopLibraryBinding,
} from './project-library-v10-media-binding.ts';

const METADATA_FIELDS = ['schemaVersion', 'revision', 'projects', 'media'] as const;
const PROJECT_FIELDS = [
	'id', 'projectId', 'name', 'metadataFile', 'preferredProduct', 'updatedAtMs',
	'projectSchemaVersion', 'projectRevision', 'byteLength', 'sha256',
] as const;
const MEDIA_FIELDS = ['id', 'relativeFile', 'category', 'byteLength', 'sha256'] as const;
const OPAQUE_ID = /^[A-Za-z0-9_-]{8,128}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const MAXIMUM_METADATA_BYTES = 4 * 1024 * 1024;
const MAXIMUM_PROJECT_DOCUMENT_BYTES = 256 * 1024 * 1024;
const MAXIMUM_PROJECT_ID_BYTES = 4 * 1024;
const MAXIMUM_PROJECTS = 10_000;
const MAXIMUM_MEDIA = 50_000;

export interface FramescaperDesktopLibraryV10Project {
	readonly id: string;
	readonly projectId: string;
	readonly name: string;
	readonly metadataFile: string;
	readonly preferredProduct: 'framescaper';
	readonly updatedAtMs: number;
	readonly projectSchemaVersion: 18;
	readonly projectRevision: number;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface FramescaperDesktopLibraryV10Media {
	readonly id: string;
	readonly relativeFile: string;
	readonly category: 'proxy';
	readonly byteLength: number;
	readonly sha256: string;
}

export interface FramescaperDesktopLibraryV10Metadata {
	readonly schemaVersion: 10;
	readonly revision: number;
	readonly projects: readonly Readonly<FramescaperDesktopLibraryV10Project>[];
	readonly media: readonly Readonly<FramescaperDesktopLibraryV10Media>[];
}

export function emptyFramescaperDesktopLibraryV10Metadata():
	Readonly<FramescaperDesktopLibraryV10Metadata> {
	return deepFreeze({
		schemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION,
		revision: 0,
		projects: [],
		media: [],
	});
}

export function validateFramescaperDesktopLibraryV10Metadata(
	value: unknown,
): Readonly<FramescaperDesktopLibraryV10Metadata> {
	const record = closedRecord(value, METADATA_FIELDS, 'Framescaper desktop V10 metadata');
	if (record.schemaVersion !== FRAMESCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION) {
		throw new TypeError('Framescaper desktop V10 metadata has an unsupported schema version');
	}
	const revision = nonNegativeSafeInteger(record.revision, 'metadata revision');
	const projects = denseArray(record.projects, 'metadata projects', MAXIMUM_PROJECTS)
		.map((project) => validateProject(project));
	const media = denseArray(record.media, 'metadata media', MAXIMUM_MEDIA)
		.map((entry) => validateMedia(entry));
	assertUnique(projects.map(({ id }) => id), 'project id');
	assertUnique(projects.map(({ projectId }) => projectId), 'project identity');
	assertUnique(projects.map(({ metadataFile }) => metadataFile.toLowerCase()), 'project path');
	assertUnique(media.map(({ id }) => id), 'media id');
	assertUnique(media.map(({ relativeFile }) => relativeFile.toLowerCase()), 'media path');
	const metadata = deepFreeze({
		schemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION,
		revision,
		projects,
		media,
	});
	if (Buffer.byteLength(JSON.stringify(metadata), 'utf8') > MAXIMUM_METADATA_BYTES) {
		throw new RangeError('Framescaper desktop V10 metadata exceeds its byte limit');
	}
	return metadata;
}

export function parseFramescaperDesktopLibraryV10MetadataJson(
	value: unknown,
): Readonly<FramescaperDesktopLibraryV10Metadata> {
	if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAXIMUM_METADATA_BYTES) {
		throw new RangeError('Persisted Framescaper desktop V10 metadata exceeds its byte limit');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(value) as unknown;
	} catch (error) {
		throw new TypeError('Persisted Framescaper desktop V10 metadata is not valid JSON', { cause: error });
	}
	return validateFramescaperDesktopLibraryV10Metadata(parsed);
}

function validateProject(value: unknown): Readonly<FramescaperDesktopLibraryV10Project> {
	const record = closedRecord(value, PROJECT_FIELDS, 'Framescaper desktop V10 project');
	if (record.preferredProduct !== 'framescaper') {
		throw new TypeError('Framescaper desktop V10 project must be owned by Framescaper');
	}
	if (record.projectSchemaVersion !== FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION) {
		throw new TypeError('Framescaper desktop V10 project has an unsupported schema version');
	}
	const id = opaqueId(record.id, 'project id');
	const projectId = boundedText(record.projectId, 'project identity', MAXIMUM_PROJECT_ID_BYTES);
	const name = boundedText(record.name, 'project name', 1_024);
	const projectRevision = nonNegativeSafeInteger(record.projectRevision, 'project revision');
	const sha256 = digest(record.sha256, 'project');
	const byteLength = positiveSafeInteger(record.byteLength, 'project byte length');
	if (byteLength > MAXIMUM_PROJECT_DOCUMENT_BYTES) {
		throw new RangeError('Framescaper desktop V10 project exceeds its document byte limit');
	}
	const metadataFile = `${id}/${String(projectRevision)}-${sha256}.json`;
	if (record.metadataFile !== metadataFile) {
		throw new TypeError('Framescaper desktop V10 project metadataFile does not match its descriptor');
	}
	return Object.freeze({
		id,
		projectId,
		name,
		metadataFile,
		preferredProduct: 'framescaper',
		updatedAtMs: nonNegativeSafeInteger(record.updatedAtMs, 'project updatedAtMs'),
		projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
		projectRevision,
		byteLength,
		sha256,
	});
}

function validateMedia(value: unknown): Readonly<FramescaperDesktopLibraryV10Media> {
	const record = closedRecord(value, MEDIA_FIELDS, 'Framescaper desktop V10 media');
	if (record.category !== 'proxy' || !isFramescaperDesktopLibraryProxyMediaBindingId(record.id)) {
		throw new TypeError('Framescaper desktop V10 media must be an exact proxy binding');
	}
	const relativeFile = proxyRelativeFileForFramescaperDesktopLibraryBinding(record.id);
	if (record.relativeFile !== relativeFile) {
		throw new TypeError('Framescaper desktop V10 media path does not match its proxy binding');
	}
	return Object.freeze({
		id: record.id,
		relativeFile,
		category: 'proxy',
		byteLength: positiveSafeInteger(record.byteLength, 'media byte length'),
		sha256: digest(record.sha256, 'media'),
	});
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${name} has missing or unsupported fields`);
	const snapshot = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property`);
		}
		snapshot[field] = descriptor.value;
	}
	return snapshot;
}

function denseArray(value: unknown, name: string, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > maximum) throw new TypeError(`${name} must be a bounded plain dense array`);
	const keys = Reflect.ownKeys(value);
	if (keys.length !== value.length + 1 || keys[keys.length - 1] !== 'length') {
		throw new TypeError(`${name} must be a bounded plain dense array`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		if (keys[index] !== String(index)) throw new TypeError(`${name} must be a bounded plain dense array`);
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must contain only data elements`);
		}
		result.push(descriptor.value);
	}
	return result;
}

function opaqueId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
		throw new TypeError(`Framescaper desktop V10 ${name} is invalid`);
	}
	return value;
}

function boundedText(value: unknown, name: string, maximumBytes: number): string {
	if (typeof value !== 'string' || value.length === 0 || !value.trim()
		|| Buffer.byteLength(value, 'utf8') > maximumBytes) {
		throw new TypeError(`Framescaper desktop V10 ${name} is invalid`);
	}
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !DIGEST.test(value)) {
		throw new TypeError(`Framescaper desktop V10 ${name} digest is invalid`);
	}
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`Framescaper desktop V10 ${name} must be a non-negative safe integer`);
	}
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	const result = nonNegativeSafeInteger(value, name);
	if (result === 0) throw new TypeError(`Framescaper desktop V10 ${name} must be positive`);
	return result;
}

function assertUnique(values: readonly string[], name: string): void {
	if (new Set(values).size !== values.length) {
		throw new TypeError(`Framescaper desktop V10 metadata has a duplicate ${name}`);
	}
}

function deepFreeze<Value>(value: Value): Readonly<Value> {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
