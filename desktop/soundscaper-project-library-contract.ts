/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

export const SOUNDSCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION = 1 as const;
export const SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY = 'soundscaper' as const;
export const SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION = 1 as const;
export const SOUNDSCAPER_DESKTOP_LIBRARY_STORAGE_DATABASE_NAME = 'kw-media-soundscaper-editor-v1';
export const SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_APPLICATION_ID = 0x53534350;
export const DESKTOP_PROJECT_LIBRARY_APPLICATION_ID =
	SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_APPLICATION_ID;
export const DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION = 1 as const;

const LIBRARY_SCOPE = Object.freeze(['kw.media', 'soundscaper-project-library', 'v1'] as const);
const PATH_FIELDS = Object.freeze([
	'libraryRoot', 'databasePath', 'projectsRoot', 'managedMediaRoot',
] as const);
const OWNER_FIELDS = Object.freeze(['product', 'processId', 'instanceId'] as const);
const HANDSHAKE_FIELDS = Object.freeze([
	'kind',
	'version',
	'owner',
	'schemaFamily',
	'schemaVersion',
	'scapeFormatVersions',
	'attachedScapeFormatVersion',
	'storageDatabaseName',
	'desktopLibrarySchemaVersion',
	'desktopDatabaseUserVersion',
	'desktopLibraryScope',
] as const);
const OPAQUE_ID = /^[A-Za-z0-9_-]{8,128}$/u;

export interface SoundscaperDesktopProjectLibraryPaths {
	readonly libraryRoot: string;
	readonly databasePath: string;
	readonly projectsRoot: string;
	readonly managedMediaRoot: string;
}

export interface SoundscaperDesktopProjectLibraryOwner {
	readonly product: 'soundscaper';
	readonly processId: number;
	readonly instanceId: string;
}

export interface SoundscaperDesktopProjectLibraryHandshake {
	readonly kind: 'soundscaper-project-library-handshake';
	readonly version: 1;
	readonly owner: 'soundscaper';
	readonly schemaFamily: typeof SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY;
	readonly schemaVersion: 1;
	readonly scapeFormatVersions: readonly [1];
	readonly attachedScapeFormatVersion: 1;
	readonly storageDatabaseName: typeof SOUNDSCAPER_DESKTOP_LIBRARY_STORAGE_DATABASE_NAME;
	readonly desktopLibrarySchemaVersion: 1;
	readonly desktopDatabaseUserVersion: 1;
	readonly desktopLibraryScope: readonly ['kw.media', 'soundscaper-project-library', 'v1'];
}

/** Derive the Soundscaper-only library without observing a product-specific userData path. */
export function createSoundscaperDesktopProjectLibraryPaths(
	appDataRoot: string,
): Readonly<SoundscaperDesktopProjectLibraryPaths> {
	if (typeof appDataRoot !== 'string' || appDataRoot.includes('\0')) {
		throw new TypeError('Soundscaper desktop baseline library requires an appData path without NUL bytes');
	}
	if (!isAbsolute(appDataRoot)) {
		throw new TypeError('Soundscaper desktop baseline library requires an absolute appData path');
	}
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

export function validateSoundscaperDesktopProjectLibraryPaths(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryPaths> {
	const record = snapshotClosedRecord(value, PATH_FIELDS, 'Soundscaper desktop baseline library paths');
	const libraryRoot = absolutePath(record.libraryRoot, 'libraryRoot');
	const expected = Object.freeze({
		libraryRoot,
		databasePath: join(libraryRoot, 'library.sqlite3'),
		projectsRoot: join(libraryRoot, 'projects'),
		managedMediaRoot: join(libraryRoot, 'media'),
	});
	for (const field of PATH_FIELDS) {
		if (normalize(absolutePath(record[field], field)) !== expected[field]) {
			throw new TypeError(`Soundscaper desktop baseline library ${field} leaves its fixed scope`);
		}
	}
	return expected;
}

export function validateSoundscaperDesktopProjectLibraryOwner(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryOwner> {
	const record = snapshotClosedRecord(value, OWNER_FIELDS, 'Soundscaper desktop baseline owner');
	if (record.product !== 'soundscaper') {
		throw new TypeError('Soundscaper desktop baseline owner must be Soundscaper');
	}
	const processId = positiveSafeInteger(record.processId, 'owner processId');
	if (typeof record.instanceId !== 'string' || !OPAQUE_ID.test(record.instanceId)) {
		throw new TypeError('Soundscaper desktop baseline owner instanceId is invalid');
	}
	return Object.freeze({ product: 'soundscaper', processId, instanceId: record.instanceId });
}

export function createSoundscaperDesktopProjectLibraryHandshake():
	Readonly<SoundscaperDesktopProjectLibraryHandshake> {
	return freezeHandshake({
		kind: 'soundscaper-project-library-handshake',
		version: 1,
		owner: 'soundscaper',
		schemaFamily: SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY,
		schemaVersion: SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
		scapeFormatVersions: [1],
		attachedScapeFormatVersion: 1,
		storageDatabaseName: SOUNDSCAPER_DESKTOP_LIBRARY_STORAGE_DATABASE_NAME,
		desktopLibrarySchemaVersion: SOUNDSCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION,
		desktopDatabaseUserVersion: DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION,
		desktopLibraryScope: [...LIBRARY_SCOPE],
	});
}

export function validateSoundscaperDesktopProjectLibraryHandshake(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryHandshake> {
	const record = snapshotClosedRecord(
		value,
		HANDSHAKE_FIELDS,
		'Soundscaper desktop baseline handshake',
	);
	if (record.kind !== 'soundscaper-project-library-handshake'
		|| record.version !== 1
		|| record.owner !== 'soundscaper'
		|| record.schemaFamily !== SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY
		|| record.schemaVersion !== SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION
		|| record.attachedScapeFormatVersion !== 1
		|| record.storageDatabaseName !== SOUNDSCAPER_DESKTOP_LIBRARY_STORAGE_DATABASE_NAME
		|| record.desktopLibrarySchemaVersion !== SOUNDSCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION
		|| record.desktopDatabaseUserVersion !== DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION) {
		throw new TypeError('Soundscaper desktop baseline handshake identity is unsupported');
	}
	const scapeFormatVersions = exactDenseTuple(
		record.scapeFormatVersions,
		[1],
		'Scape format versions',
	);
	const desktopLibraryScope = exactDenseTuple(
		record.desktopLibraryScope,
		LIBRARY_SCOPE,
		'desktop library scope',
	);
	return freezeHandshake({
		kind: record.kind,
		version: record.version,
		owner: record.owner,
		schemaFamily: record.schemaFamily,
		schemaVersion: record.schemaVersion,
		scapeFormatVersions,
		attachedScapeFormatVersion: record.attachedScapeFormatVersion,
		storageDatabaseName: record.storageDatabaseName,
		desktopLibrarySchemaVersion: record.desktopLibrarySchemaVersion,
		desktopDatabaseUserVersion: record.desktopDatabaseUserVersion,
		desktopLibraryScope,
	});
}

function freezeHandshake(value: SoundscaperDesktopProjectLibraryHandshake):
	Readonly<SoundscaperDesktopProjectLibraryHandshake> {
	return Object.freeze({
		...value,
		scapeFormatVersions: Object.freeze([...value.scapeFormatVersions]) as readonly [1],
		desktopLibraryScope: Object.freeze([...value.desktopLibraryScope]) as
			readonly ['kw.media', 'soundscaper-project-library', 'v1'],
	});
}

function exactDenseTuple<const Expected extends readonly unknown[]>(
	value: unknown,
	expected: Expected,
	name: string,
): Expected {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`Soundscaper desktop baseline ${name} must be a plain dense array`);
	}
	const keys = Reflect.ownKeys(value);
	const expectedKeys = [...expected.keys()].map(String);
	if (keys.length !== expected.length + 1
		|| keys[keys.length - 1] !== 'length'
		|| expectedKeys.some((key, index) => keys[index] !== key)) {
		throw new TypeError(`Soundscaper desktop baseline ${name} must be an exact dense tuple`);
	}
	const result: unknown[] = [];
	for (const [index, expectedValue] of expected.entries()) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
			|| descriptor.value !== expectedValue) {
			throw new TypeError(`Soundscaper desktop baseline ${name} is unsupported`);
		}
		result.push(descriptor.value);
	}
	return Object.freeze(result) as unknown as Expected;
}

function snapshotClosedRecord<const Field extends string>(
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

function absolutePath(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.includes('\0') || !isAbsolute(value)) {
		throw new TypeError(`Soundscaper desktop baseline library ${field} must be an absolute path`);
	}
	return normalize(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new TypeError(`Soundscaper desktop baseline ${name} must be a positive safe integer`);
	}
	return value;
}

function assertDescendant(parent: string, child: string, name: string): void {
	const path = relative(parent, child);
	if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
		throw new TypeError(`Soundscaper desktop baseline ${name} must stay inside appData`);
	}
}
