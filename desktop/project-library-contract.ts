/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

export const DESKTOP_LIBRARY_SCHEMA_VERSION = 2 as const;
export const DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION = 9 as const;
export const MAX_LIBRARY_METADATA_BYTES = 4 * 1024 * 1024;
export const MAX_LIBRARY_PROJECT_DOCUMENT_BYTES = 256 * 1024 * 1024;
export const MAX_LIBRARY_PROJECT_ID_BYTES = 4 * 1024;
export const MAX_LIBRARY_PROJECTS = 10_000;
export const MAX_LIBRARY_MEDIA = 50_000;

const LIBRARY_SCOPE = Object.freeze(['kw.media', 'scape-project-library', 'v2']);
const PRODUCT_IDS = Object.freeze(['soundscaper', 'framescaper'] as const);
const EXACT_PATH_KEYS = Object.freeze(['libraryRoot', 'databasePath', 'projectsRoot', 'managedMediaRoot'] as const);
const METADATA_KEYS = Object.freeze(['schemaVersion', 'revision', 'projects', 'media']);
const PROJECT_KEYS = Object.freeze([
	'id',
	'projectId',
	'name',
	'metadataFile',
	'preferredProduct',
	'updatedAtMs',
	'projectSchemaVersion',
	'projectRevision',
	'byteLength',
	'sha256',
]);
const MEDIA_KEYS = Object.freeze(['id', 'relativeFile', 'byteLength', 'sha256']);
const OWNER_KEYS = Object.freeze(['product', 'processId', 'instanceId']);
const OPAQUE_ID = /^[A-Za-z0-9_-]{8,128}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const WINDOWS_DEVICE_BASENAME = /^(?:AUX|CON|NUL|PRN|COM[1-9]|LPT[1-9])$/iu;

export type DesktopLibraryProduct = typeof PRODUCT_IDS[number];

export interface DesktopProjectLibraryPaths {
	readonly libraryRoot: string;
	readonly databasePath: string;
	readonly projectsRoot: string;
	readonly managedMediaRoot: string;
}

export interface DesktopLibraryOwner {
	readonly product: DesktopLibraryProduct;
	readonly processId: number;
	readonly instanceId: string;
}

export interface DesktopLibraryProject {
	readonly id: string;
	readonly projectId: string;
	readonly name: string;
	readonly metadataFile: string;
	readonly preferredProduct: DesktopLibraryProduct;
	readonly updatedAtMs: number;
	readonly projectSchemaVersion: typeof DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION;
	readonly projectRevision: number;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface DesktopLibraryMedia {
	readonly id: string;
	readonly relativeFile: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface DesktopLibraryMetadata {
	readonly schemaVersion: typeof DESKTOP_LIBRARY_SCHEMA_VERSION;
	readonly revision: number;
	readonly projects: readonly DesktopLibraryProject[];
	readonly media: readonly DesktopLibraryMedia[];
}

export interface DesktopLibraryLease {
	readonly leaseId: string;
	readonly fencingToken: number;
	readonly owner: DesktopLibraryOwner;
	readonly acquiredAtMs: number;
	readonly expiresAtMs: number;
	readonly tookOverStaleLease: boolean;
}

/**
 * Derive the product-neutral library from Electron's `app.getPath('appData')`.
 * A product-specific `userData` path or Chromium session directory is not valid.
 */
export function createDesktopProjectLibraryPaths(appDataRoot: string): DesktopProjectLibraryPaths {
	if (typeof appDataRoot !== 'string' || appDataRoot.includes('\0')) {
		throw new TypeError('Desktop project library requires an appData path without NUL bytes');
	}
	if (!isAbsolute(appDataRoot)) throw new TypeError('Desktop project library requires an absolute appData path');
	const normalizedRoot = normalize(appDataRoot);
	const libraryRoot = resolve(normalizedRoot, ...LIBRARY_SCOPE);
	assertDescendant(normalizedRoot, libraryRoot, 'library root');
	return Object.freeze({
		libraryRoot,
		databasePath: join(libraryRoot, 'library.sqlite3'),
		projectsRoot: join(libraryRoot, 'projects'),
		managedMediaRoot: join(libraryRoot, 'media'),
	});
}

export function validateDesktopProjectLibraryPaths(value: unknown): DesktopProjectLibraryPaths {
	const record = strictRecord(value, EXACT_PATH_KEYS, 'desktop project library paths');
	const libraryRoot = absolutePath(record.libraryRoot, 'libraryRoot');
	const expected = Object.freeze({
		libraryRoot,
		databasePath: join(libraryRoot, 'library.sqlite3'),
		projectsRoot: join(libraryRoot, 'projects'),
		managedMediaRoot: join(libraryRoot, 'media'),
	});
	for (const key of EXACT_PATH_KEYS) {
		if (normalize(absolutePath(record[key], key)) !== expected[key]) {
			throw new TypeError(`Desktop project library ${key} leaves its fixed scope`);
		}
	}
	return expected;
}

export function validateDesktopLibraryOwner(value: unknown): DesktopLibraryOwner {
	const record = strictRecord(value, OWNER_KEYS, 'desktop library owner');
	const product = String(record.product);
	if (!isProduct(product)) throw new TypeError('Desktop library owner has an unsupported product');
	const processId = positiveSafeInteger(record.processId, 'owner processId');
	const instanceId = opaqueId(record.instanceId, 'owner instanceId');
	return Object.freeze({ product, processId, instanceId });
}

export function validateDesktopLibraryMetadata(value: unknown): DesktopLibraryMetadata {
	const record = strictRecord(value, METADATA_KEYS, 'desktop library metadata');
	if (record.schemaVersion !== DESKTOP_LIBRARY_SCHEMA_VERSION) {
		throw new TypeError('Desktop library metadata has an unsupported schema version');
	}
	const revision = nonNegativeSafeInteger(record.revision, 'metadata revision');
	if (!Array.isArray(record.projects) || record.projects.length > MAX_LIBRARY_PROJECTS) {
		throw new RangeError('Desktop library metadata has an invalid project count');
	}
	if (!Array.isArray(record.media) || record.media.length > MAX_LIBRARY_MEDIA) {
		throw new RangeError('Desktop library metadata has an invalid media count');
	}
	const projects = record.projects.map((project) => validateProject(project));
	const media = record.media.map((entry) => validateMedia(entry));
	assertUnique(projects.map(({ id }) => id), 'project id');
	assertUnique(projects.map(({ projectId }) => projectId), 'project identity');
	assertPortablePathUnique(projects.map(({ metadataFile }) => metadataFile), 'project metadata path');
	assertUnique(media.map(({ id }) => id), 'media id');
	assertPortablePathUnique(media.map(({ relativeFile }) => relativeFile), 'media path');
	const metadata = deepFreeze({
		schemaVersion: DESKTOP_LIBRARY_SCHEMA_VERSION,
		revision,
		projects,
		media,
	});
	if (Buffer.byteLength(JSON.stringify(metadata), 'utf8') > MAX_LIBRARY_METADATA_BYTES) {
		throw new RangeError('Desktop library metadata exceeds its byte limit');
	}
	return metadata;
}

export function emptyDesktopLibraryMetadata(): DesktopLibraryMetadata {
	return deepFreeze({ schemaVersion: DESKTOP_LIBRARY_SCHEMA_VERSION, revision: 0, projects: [], media: [] });
}

export function parseDesktopLibraryMetadataJson(value: unknown): DesktopLibraryMetadata {
	if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_LIBRARY_METADATA_BYTES) {
		throw new RangeError('Persisted desktop library metadata exceeds its byte limit');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(value) as unknown;
	} catch (error) {
		throw new TypeError('Persisted desktop library metadata is not valid JSON', { cause: error });
	}
	return validateDesktopLibraryMetadata(parsed);
}

export function scopedRelativePath(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 1_024 || value.includes('\\')) {
		throw new TypeError(`${label} must be a scoped relative path`);
	}
	const segments = value.split('/');
	if (segments.some((segment) => !PATH_SEGMENT.test(segment) || segment === '.' || segment === '..')) {
		throw new TypeError(`${label} must be a scoped relative path`);
	}
	if (segments.some((segment) => (
		segment.endsWith('.') || WINDOWS_DEVICE_BASENAME.test(segment.split('.')[0] ?? '')
	))) {
		throw new TypeError(`${label} must be a portable filesystem path`);
	}
	return segments.join('/');
}

export function createDesktopLibraryProjectMetadataFile(
	projectId: unknown,
	projectRevision: unknown,
	sha256: unknown,
): string {
	const id = opaqueId(projectId, 'project id');
	const revision = nonNegativeSafeInteger(projectRevision, 'project revision');
	const digest = String(sha256);
	if (!DIGEST.test(digest)) throw new TypeError('Desktop library project has an invalid SHA-256 digest');
	return `${id}/${String(revision)}-${digest}.json`;
}

function validateProject(value: unknown): DesktopLibraryProject {
	const record = strictRecord(value, PROJECT_KEYS, 'desktop library project');
	const preferredProduct = String(record.preferredProduct);
	if (!isProduct(preferredProduct)) throw new TypeError('Desktop library project has an unsupported preferred product');
	if (record.projectSchemaVersion !== DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION) {
		throw new TypeError('Desktop library project has an unsupported schema version');
	}
	const id = opaqueId(record.id, 'project id');
	const projectRevision = nonNegativeSafeInteger(record.projectRevision, 'project revision');
	const sha256 = String(record.sha256);
	if (!DIGEST.test(sha256)) throw new TypeError('Desktop library project has an invalid SHA-256 digest');
	const byteLength = positiveSafeInteger(record.byteLength, 'project byte length');
	if (byteLength > MAX_LIBRARY_PROJECT_DOCUMENT_BYTES) {
		throw new RangeError('Desktop library project byte length exceeds its limit');
	}
	const metadataFile = scopedRelativePath(record.metadataFile, 'project metadataFile');
	if (metadataFile !== createDesktopLibraryProjectMetadataFile(id, projectRevision, sha256)) {
		throw new TypeError('Desktop library project metadataFile does not match its immutable descriptor');
	}
	return Object.freeze({
		id,
		projectId: projectId(record.projectId),
		name: humanText(record.name, 'project name', 255),
		metadataFile,
		preferredProduct,
		updatedAtMs: nonNegativeSafeInteger(record.updatedAtMs, 'project updatedAtMs'),
		projectSchemaVersion: DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
		projectRevision,
		byteLength,
		sha256,
	});
}

function projectId(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new TypeError('Desktop library project identity must be a non-empty string');
	}
	if (Buffer.byteLength(value, 'utf8') > MAX_LIBRARY_PROJECT_ID_BYTES) {
		throw new RangeError('Desktop library project identity exceeds its byte limit');
	}
	return value;
}

function validateMedia(value: unknown): DesktopLibraryMedia {
	const record = strictRecord(value, MEDIA_KEYS, 'desktop library media');
	const sha256 = String(record.sha256);
	if (!DIGEST.test(sha256)) throw new TypeError('Desktop library media has an invalid SHA-256 digest');
	return Object.freeze({
		id: opaqueId(record.id, 'media id'),
		relativeFile: scopedRelativePath(record.relativeFile, 'media relativeFile'),
		byteLength: nonNegativeSafeInteger(record.byteLength, 'media byteLength'),
		sha256,
	});
}

function strictRecord<const Key extends string>(value: unknown, keys: readonly Key[], label: string): Record<Key, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`${label} must be a plain object`);
	}
	const actualKeys = Object.keys(value);
	if (actualKeys.length !== keys.length || actualKeys.some((key) => !keys.includes(key as Key))) {
		throw new TypeError(`${label} has unsupported fields`);
	}
	return value as Record<Key, unknown>;
}

function humanText(value: unknown, label: string, maximumLength: number): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError(`${label} is invalid`);
	}
	return value;
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) throw new TypeError(`${label} is invalid`);
	return value;
}

function absolutePath(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.includes('\0') || !isAbsolute(value)) {
		throw new TypeError(`Desktop project library ${label} must be an absolute path without NUL bytes`);
	}
	return normalize(value);
}

function assertDescendant(root: string, candidate: string, label: string): void {
	const child = relative(resolve(root), resolve(candidate));
	if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
		throw new TypeError(`Desktop project ${label} leaves appData`);
	}
}

function assertUnique(values: readonly string[], label: string): void {
	if (new Set(values).size !== values.length) throw new TypeError(`Desktop library metadata has a duplicate ${label}`);
}

function assertPortablePathUnique(values: readonly string[], label: string): void {
	assertUnique(values.map((value) => value.toLowerCase()), label);
}

function isProduct(value: string): value is DesktopLibraryProduct {
	return PRODUCT_IDS.some((product) => product === value);
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`);
	return value;
}

function positiveSafeInteger(value: unknown, label: string): number {
	const number = nonNegativeSafeInteger(value, label);
	if (number === 0) throw new RangeError(`${label} must be positive`);
	return number;
}

function deepFreeze<T extends DesktopLibraryMetadata>(value: T): T {
	for (const project of value.projects) Object.freeze(project);
	for (const media of value.media) Object.freeze(media);
	Object.freeze(value.projects);
	Object.freeze(value.media);
	return Object.freeze(value);
}
