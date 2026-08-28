/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

export const FRAMESCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION = 1 as const;
export const FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY = 'framescaper' as const;
export const FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION = 1 as const;
export const FRAMESCAPER_DESKTOP_LIBRARY_STORAGE_DATABASE_NAME =
	'kw-media-framescaper-editor-v1' as const;
export const DESKTOP_PROJECT_LIBRARY_APPLICATION_ID = 0x46534350;
export const DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION = 1 as const;

const LIBRARY_SCOPE = Object.freeze([
	'kw.media', 'framescaper-project-library', 'v1',
] as const);
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

export interface FramescaperDesktopProjectLibraryPaths {
	readonly libraryRoot: string;
	readonly databasePath: string;
	readonly projectsRoot: string;
	readonly managedMediaRoot: string;
}

export interface FramescaperDesktopProjectLibraryOwner {
	readonly product: 'framescaper';
	readonly processId: number;
	readonly instanceId: string;
}

export interface FramescaperDesktopProjectLibraryHandshake {
	readonly kind: 'framescaper-project-library-handshake';
	readonly version: 1;
	readonly owner: 'framescaper';
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	readonly scapeFormatVersions: readonly [1];
	readonly attachedScapeFormatVersion: 1;
	readonly storageDatabaseName: typeof FRAMESCAPER_DESKTOP_LIBRARY_STORAGE_DATABASE_NAME;
	readonly desktopLibrarySchemaVersion: 1;
	readonly desktopDatabaseUserVersion: 1;
	readonly desktopLibraryScope: readonly [
		'kw.media', 'framescaper-project-library', 'v1',
	];
}

export function createFramescaperDesktopProjectLibraryPaths(
	appDataRoot: string,
): Readonly<FramescaperDesktopProjectLibraryPaths> {
	if (typeof appDataRoot !== 'string' || appDataRoot.includes('\0') || !isAbsolute(appDataRoot)) {
		throw new TypeError('Framescaper desktop project library requires an absolute appData path without NUL bytes');
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

export function validateFramescaperDesktopProjectLibraryPaths(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryPaths> {
	const record = snapshotClosedRecord(value, PATH_FIELDS, 'Framescaper desktop library paths');
	const libraryRoot = absolutePath(record.libraryRoot, 'libraryRoot');
	const expected = Object.freeze({
		libraryRoot,
		databasePath: join(libraryRoot, 'library.sqlite3'),
		projectsRoot: join(libraryRoot, 'projects'),
		managedMediaRoot: join(libraryRoot, 'media'),
	});
	for (const field of PATH_FIELDS) {
		if (normalize(absolutePath(record[field], field)) !== expected[field]) {
			throw new TypeError(`Framescaper desktop library ${field} leaves its fixed scope`);
		}
	}
	return expected;
}

export function validateFramescaperDesktopProjectLibraryOwner(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryOwner> {
	const record = snapshotClosedRecord(value, OWNER_FIELDS, 'Framescaper desktop library owner');
	if (record.product !== FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY) {
		throw new TypeError('Framescaper desktop library owner must be Framescaper');
	}
	const processId = positiveSafeInteger(record.processId, 'owner processId');
	if (typeof record.instanceId !== 'string' || !OPAQUE_ID.test(record.instanceId)) {
		throw new TypeError('Framescaper desktop library owner instanceId is invalid');
	}
	return Object.freeze({ product: 'framescaper', processId, instanceId: record.instanceId });
}

export function createFramescaperDesktopProjectLibraryHandshake():
	Readonly<FramescaperDesktopProjectLibraryHandshake> {
	return freezeHandshake({
		kind: 'framescaper-project-library-handshake',
		version: 1,
		owner: 'framescaper',
		schemaFamily: FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY,
		schemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
		scapeFormatVersions: [1],
		attachedScapeFormatVersion: 1,
		storageDatabaseName: FRAMESCAPER_DESKTOP_LIBRARY_STORAGE_DATABASE_NAME,
		desktopLibrarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION,
		desktopDatabaseUserVersion: DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION,
		desktopLibraryScope: [...LIBRARY_SCOPE],
	});
}

export function validateFramescaperDesktopProjectLibraryHandshake(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryHandshake> {
	const record = snapshotClosedRecord(value, HANDSHAKE_FIELDS, 'Framescaper desktop library handshake');
	if (record.kind !== 'framescaper-project-library-handshake'
		|| record.version !== 1
		|| record.owner !== 'framescaper'
		|| record.schemaFamily !== FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY
		|| record.schemaVersion !== FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION
		|| record.attachedScapeFormatVersion !== 1
		|| record.storageDatabaseName !== FRAMESCAPER_DESKTOP_LIBRARY_STORAGE_DATABASE_NAME
		|| record.desktopLibrarySchemaVersion !== FRAMESCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION
		|| record.desktopDatabaseUserVersion !== DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION) {
		throw new TypeError('Framescaper desktop library handshake identity is unsupported');
	}
	exactDenseTuple(record.scapeFormatVersions, [1], 'Scape format versions');
	exactDenseTuple(record.desktopLibraryScope, LIBRARY_SCOPE, 'desktop library scope');
	return createFramescaperDesktopProjectLibraryHandshake();
}

function freezeHandshake(
	value: FramescaperDesktopProjectLibraryHandshake,
): Readonly<FramescaperDesktopProjectLibraryHandshake> {
	return Object.freeze({
		...value,
		scapeFormatVersions: Object.freeze([1]) as readonly [1],
		desktopLibraryScope: Object.freeze([...LIBRARY_SCOPE]) as
			readonly ['kw.media', 'framescaper-project-library', 'v1'],
	});
}

function exactDenseTuple<const Expected extends readonly unknown[]>(
	value: unknown,
	expected: Expected,
	name: string,
): void {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`Framescaper desktop ${name} must be a plain dense array`);
	}
	const keys = Reflect.ownKeys(value);
	const expectedKeys = [...expected.keys()].map(String);
	if (keys.length !== expected.length + 1
		|| keys[keys.length - 1] !== 'length'
		|| expectedKeys.some((key, index) => keys[index] !== key)) {
		throw new TypeError(`Framescaper desktop ${name} must be an exact dense tuple`);
	}
	for (const [index, expectedValue] of expected.entries()) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
			|| descriptor.value !== expectedValue) {
			throw new TypeError(`Framescaper desktop ${name} is unsupported`);
		}
	}
}

function snapshotClosedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype
			&& Object.getPrototypeOf(value) !== null)) {
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

function absolutePath(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.includes('\0') || !isAbsolute(value)) {
		throw new TypeError(`Framescaper desktop library ${field} must be an absolute path`);
	}
	return normalize(value);
}

function positiveSafeInteger(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new TypeError(`Framescaper desktop library ${field} must be a positive safe integer`);
	}
	return value;
}

function assertDescendant(parent: string, child: string, field: string): void {
	const rel = relative(parent, child);
	if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
		throw new TypeError(`Framescaper desktop ${field} leaves appData`);
	}
}
