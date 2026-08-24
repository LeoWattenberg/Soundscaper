/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

export const SOUNDSCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION = 11 as const;
export const SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION = 29 as const;
export const SOUNDSCAPER_DESKTOP_LIBRARY_STORAGE_DATABASE_NAME = 'kw-media-soundscaper-editor-v29';
export const SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V11_APPLICATION_ID = 0x53534350;
export const DESKTOP_PROJECT_LIBRARY_V11_APPLICATION_ID =
	SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V11_APPLICATION_ID;
export const DESKTOP_PROJECT_LIBRARY_V11_DATABASE_VERSION = 13 as const;

const LIBRARY_SCOPE = Object.freeze(['kw.media', 'soundscaper-project-library', 'v11'] as const);
const PATH_FIELDS = Object.freeze([
	'libraryRoot', 'databasePath', 'projectsRoot', 'managedMediaRoot',
] as const);
const OWNER_FIELDS = Object.freeze(['product', 'processId', 'instanceId'] as const);
const HANDSHAKE_FIELDS = Object.freeze([
	'kind',
	'version',
	'owner',
	'projectSchemaVersion',
	'scapeFormatVersions',
	'attachedScapeFormatVersion',
	'storageDatabaseName',
	'desktopLibrarySchemaVersion',
	'desktopDatabaseUserVersion',
	'desktopLibraryScope',
] as const);
const OPAQUE_ID = /^[A-Za-z0-9_-]{8,128}$/u;

export interface SoundscaperDesktopProjectLibraryV11Paths {
	readonly libraryRoot: string;
	readonly databasePath: string;
	readonly projectsRoot: string;
	readonly managedMediaRoot: string;
}

export interface SoundscaperDesktopProjectLibraryV11Owner {
	readonly product: 'soundscaper';
	readonly processId: number;
	readonly instanceId: string;
}

export interface SoundscaperDesktopProjectLibraryV11Handshake {
	readonly kind: 'soundscaper-project-library-handshake';
	readonly version: 1;
	readonly owner: 'soundscaper';
	readonly projectSchemaVersion: 29;
	readonly scapeFormatVersions: readonly [1, 2];
	readonly attachedScapeFormatVersion: 2;
	readonly storageDatabaseName: typeof SOUNDSCAPER_DESKTOP_LIBRARY_STORAGE_DATABASE_NAME;
	readonly desktopLibrarySchemaVersion: 11;
	readonly desktopDatabaseUserVersion: 13;
	readonly desktopLibraryScope: readonly ['kw.media', 'soundscaper-project-library', 'v11'];
}

/** Derive the Soundscaper-only library without observing a product-specific userData path. */
export function createSoundscaperDesktopProjectLibraryV11Paths(
	appDataRoot: string,
): Readonly<SoundscaperDesktopProjectLibraryV11Paths> {
	if (typeof appDataRoot !== 'string' || appDataRoot.includes('\0')) {
		throw new TypeError('Soundscaper desktop V11 library requires an appData path without NUL bytes');
	}
	if (!isAbsolute(appDataRoot)) {
		throw new TypeError('Soundscaper desktop V11 library requires an absolute appData path');
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

export function validateSoundscaperDesktopProjectLibraryV11Paths(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryV11Paths> {
	const record = snapshotClosedRecord(value, PATH_FIELDS, 'Soundscaper desktop V11 library paths');
	const libraryRoot = absolutePath(record.libraryRoot, 'libraryRoot');
	const expected = Object.freeze({
		libraryRoot,
		databasePath: join(libraryRoot, 'library.sqlite3'),
		projectsRoot: join(libraryRoot, 'projects'),
		managedMediaRoot: join(libraryRoot, 'media'),
	});
	for (const field of PATH_FIELDS) {
		if (normalize(absolutePath(record[field], field)) !== expected[field]) {
			throw new TypeError(`Soundscaper desktop V11 library ${field} leaves its fixed scope`);
		}
	}
	return expected;
}

export function validateSoundscaperDesktopProjectLibraryV11Owner(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryV11Owner> {
	const record = snapshotClosedRecord(value, OWNER_FIELDS, 'Soundscaper desktop V11 owner');
	if (record.product !== 'soundscaper') {
		throw new TypeError('Soundscaper desktop V11 owner must be Soundscaper');
	}
	const processId = positiveSafeInteger(record.processId, 'owner processId');
	if (typeof record.instanceId !== 'string' || !OPAQUE_ID.test(record.instanceId)) {
		throw new TypeError('Soundscaper desktop V11 owner instanceId is invalid');
	}
	return Object.freeze({ product: 'soundscaper', processId, instanceId: record.instanceId });
}

export function createSoundscaperDesktopProjectLibraryV11Handshake():
	Readonly<SoundscaperDesktopProjectLibraryV11Handshake> {
	return freezeHandshake({
		kind: 'soundscaper-project-library-handshake',
		version: 1,
		owner: 'soundscaper',
		projectSchemaVersion: SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		storageDatabaseName: SOUNDSCAPER_DESKTOP_LIBRARY_STORAGE_DATABASE_NAME,
		desktopLibrarySchemaVersion: SOUNDSCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION,
		desktopDatabaseUserVersion: DESKTOP_PROJECT_LIBRARY_V11_DATABASE_VERSION,
		desktopLibraryScope: [...LIBRARY_SCOPE],
	});
}

export function validateSoundscaperDesktopProjectLibraryV11Handshake(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryV11Handshake> {
	const record = snapshotClosedRecord(
		value,
		HANDSHAKE_FIELDS,
		'Soundscaper desktop V11 handshake',
	);
	if (record.kind !== 'soundscaper-project-library-handshake'
		|| record.version !== 1
		|| record.owner !== 'soundscaper'
		|| record.projectSchemaVersion !== SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION
		|| record.attachedScapeFormatVersion !== 2
		|| record.storageDatabaseName !== SOUNDSCAPER_DESKTOP_LIBRARY_STORAGE_DATABASE_NAME
		|| record.desktopLibrarySchemaVersion !== SOUNDSCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION
		|| record.desktopDatabaseUserVersion !== DESKTOP_PROJECT_LIBRARY_V11_DATABASE_VERSION) {
		throw new TypeError('Soundscaper desktop V11 handshake identity is unsupported');
	}
	const scapeFormatVersions = exactDenseTuple(
		record.scapeFormatVersions,
		[1, 2],
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
		projectSchemaVersion: record.projectSchemaVersion,
		scapeFormatVersions,
		attachedScapeFormatVersion: record.attachedScapeFormatVersion,
		storageDatabaseName: record.storageDatabaseName,
		desktopLibrarySchemaVersion: record.desktopLibrarySchemaVersion,
		desktopDatabaseUserVersion: record.desktopDatabaseUserVersion,
		desktopLibraryScope,
	});
}

function freezeHandshake(value: SoundscaperDesktopProjectLibraryV11Handshake):
	Readonly<SoundscaperDesktopProjectLibraryV11Handshake> {
	return Object.freeze({
		...value,
		scapeFormatVersions: Object.freeze([...value.scapeFormatVersions]) as readonly [1, 2],
		desktopLibraryScope: Object.freeze([...value.desktopLibraryScope]) as
			readonly ['kw.media', 'soundscaper-project-library', 'v11'],
	});
}

function exactDenseTuple<const Expected extends readonly unknown[]>(
	value: unknown,
	expected: Expected,
	name: string,
): Expected {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`Soundscaper desktop V11 ${name} must be a plain dense array`);
	}
	const keys = Reflect.ownKeys(value);
	const expectedKeys = [...expected.keys()].map(String);
	if (keys.length !== expected.length + 1
		|| keys[keys.length - 1] !== 'length'
		|| expectedKeys.some((key, index) => keys[index] !== key)) {
		throw new TypeError(`Soundscaper desktop V11 ${name} must be an exact dense tuple`);
	}
	const result: unknown[] = [];
	for (const [index, expectedValue] of expected.entries()) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
			|| descriptor.value !== expectedValue) {
			throw new TypeError(`Soundscaper desktop V11 ${name} is unsupported`);
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
		throw new TypeError(`Soundscaper desktop V11 library ${field} must be an absolute path`);
	}
	return normalize(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new TypeError(`Soundscaper desktop V11 ${name} must be a positive safe integer`);
	}
	return value;
}

function assertDescendant(parent: string, child: string, name: string): void {
	const path = relative(parent, child);
	if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
		throw new TypeError(`Soundscaper desktop V11 ${name} must stay inside appData`);
	}
}
