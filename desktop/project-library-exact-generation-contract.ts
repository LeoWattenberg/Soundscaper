/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

const PATH_FIELDS = ['libraryRoot', 'databasePath', 'projectsRoot', 'managedMediaRoot'] as const;
const HANDSHAKE_FIELDS = [
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
] as const;

export interface FramescaperDesktopProjectLibraryExactGenerationIdentity<
	LibraryVersion extends number,
	DatabaseVersion extends number,
	StorageName extends string,
> {
	readonly librarySchemaVersion: LibraryVersion;
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	readonly databaseUserVersion: DatabaseVersion;
	readonly storageDatabaseName: StorageName;
}

export interface FramescaperDesktopProjectLibraryExactGenerationPaths {
	readonly libraryRoot: string;
	readonly databasePath: string;
	readonly projectsRoot: string;
	readonly managedMediaRoot: string;
}

export interface FramescaperDesktopProjectLibraryExactGenerationOwner {
	readonly product: 'framescaper';
	readonly processId: number;
	readonly instanceId: string;
}

export interface FramescaperDesktopProjectLibraryExactGenerationHandshake<
	LibraryVersion extends number,
	DatabaseVersion extends number,
	StorageName extends string,
> {
	readonly kind: 'framescaper-project-library-handshake';
	readonly version: 1;
	readonly owner: 'framescaper';
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	readonly scapeFormatVersions: readonly [1];
	readonly attachedScapeFormatVersion: 1;
	readonly storageDatabaseName: StorageName;
	readonly desktopLibrarySchemaVersion: LibraryVersion;
	readonly desktopDatabaseUserVersion: DatabaseVersion;
	readonly desktopLibraryScope: readonly ['kw.media', 'framescaper-project-library', 'v1'];
}

/** Parameterized core for exact-generation filesystem isolation. */
export function createFramescaperDesktopProjectLibraryExactGenerationPaths(
	appDataRoot: string,
	scopeVersion: string,
	label: string,
): Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths> {
	if (typeof appDataRoot !== 'string' || appDataRoot.includes('\0') || !isAbsolute(appDataRoot)) {
		throw new TypeError(`${label} requires an absolute appData path without NUL bytes`);
	}
	if (scopeVersion !== 'v1') {
		throw new TypeError(`${label} requires the frozen v1 baseline scope`);
	}
	const normalizedRoot = normalize(appDataRoot);
	const libraryRoot = resolve(normalizedRoot, 'kw.media', 'framescaper-project-library', 'v1');
	assertDescendant(normalizedRoot, libraryRoot, label);
	return Object.freeze({
		libraryRoot,
		databasePath: join(libraryRoot, 'library.sqlite3'),
		projectsRoot: join(libraryRoot, 'projects'),
		managedMediaRoot: join(libraryRoot, 'media'),
	});
}

/** Parameterized core for exact-generation authenticated handshakes. */
export function createFramescaperDesktopProjectLibraryExactGenerationHandshake<
	LibraryVersion extends number,
	DatabaseVersion extends number,
	StorageName extends string,
>(
	identity: FramescaperDesktopProjectLibraryExactGenerationIdentity<
		LibraryVersion, DatabaseVersion, StorageName
	>,
): Readonly<FramescaperDesktopProjectLibraryExactGenerationHandshake<
	LibraryVersion, DatabaseVersion, StorageName
>> {
	if (identity.schemaFamily !== 'framescaper' || identity.schemaVersion !== 1) {
		throw new TypeError('Framescaper desktop library identity must be the exact v1 baseline');
	}
	return freezeHandshake({
		kind: 'framescaper-project-library-handshake',
		version: 1,
		owner: 'framescaper',
		schemaFamily: 'framescaper',
		schemaVersion: 1,
		scapeFormatVersions: [1],
		attachedScapeFormatVersion: 1,
		storageDatabaseName: identity.storageDatabaseName,
		desktopLibrarySchemaVersion: identity.librarySchemaVersion,
		desktopDatabaseUserVersion: identity.databaseUserVersion,
		desktopLibraryScope: ['kw.media', 'framescaper-project-library', 'v1'],
	});
}

export function validateFramescaperDesktopProjectLibraryExactGenerationHandshake<
	LibraryVersion extends number,
	DatabaseVersion extends number,
	StorageName extends string,
>(
	value: unknown,
	identity: FramescaperDesktopProjectLibraryExactGenerationIdentity<
		LibraryVersion, DatabaseVersion, StorageName
	>,
	label: string,
): Readonly<FramescaperDesktopProjectLibraryExactGenerationHandshake<
	LibraryVersion, DatabaseVersion, StorageName
>> {
	const record = snapshotClosedRecord(value, HANDSHAKE_FIELDS, `${label} handshake`);
	if (record.kind !== 'framescaper-project-library-handshake'
		|| record.version !== 1
		|| record.owner !== 'framescaper'
		|| record.schemaFamily !== 'framescaper'
		|| record.schemaVersion !== 1
		|| identity.schemaFamily !== 'framescaper'
		|| identity.schemaVersion !== 1
		|| record.attachedScapeFormatVersion !== 1
		|| record.storageDatabaseName !== identity.storageDatabaseName
		|| record.desktopLibrarySchemaVersion !== identity.librarySchemaVersion
		|| record.desktopDatabaseUserVersion !== identity.databaseUserVersion) {
		throw new TypeError(`${label} handshake identity is unsupported`);
	}
	exactDenseTuple(record.scapeFormatVersions, [1], `${label} Scape format versions`);
	exactDenseTuple(
		record.desktopLibraryScope,
		['kw.media', 'framescaper-project-library', 'v1'],
		`${label} desktop library scope`,
	);
	return createFramescaperDesktopProjectLibraryExactGenerationHandshake(identity);
}

export function validateFramescaperDesktopProjectLibraryExactGenerationPaths(
	value: unknown,
	scopeVersion: string,
	label: string,
): Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths> {
	const record = snapshotClosedRecord(value, PATH_FIELDS, `${label} paths`);
	const libraryRoot = absolutePath(record.libraryRoot, label, 'libraryRoot');
	const parent = resolve(libraryRoot, '..', '..', '..');
	const expected = createFramescaperDesktopProjectLibraryExactGenerationPaths(
		parent,
		scopeVersion,
		label,
	);
	for (const field of PATH_FIELDS) {
		if (normalize(absolutePath(record[field], label, field)) !== expected[field]) {
			throw new TypeError(`${label} ${field} leaves its fixed scope`);
		}
	}
	return expected;
}

export function validateFramescaperDesktopProjectLibraryExactGenerationOwner(
	value: unknown,
	label: string,
): Readonly<FramescaperDesktopProjectLibraryExactGenerationOwner> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		|| Reflect.ownKeys(value).length !== 3) {
		throw new TypeError(`${label} owner must be an exact plain record`);
	}
	const owner = value as Record<string, unknown>;
	if (owner.product !== 'framescaper' || typeof owner.processId !== 'number'
		|| !Number.isSafeInteger(owner.processId) || owner.processId < 1
		|| typeof owner.instanceId !== 'string'
		|| !/^[A-Za-z0-9_-]{8,128}$/u.test(owner.instanceId)) {
		throw new TypeError(`${label} owner identity is invalid`);
	}
	return Object.freeze({
		product: 'framescaper',
		processId: owner.processId,
		instanceId: owner.instanceId,
	});
}

function freezeHandshake<
	LibraryVersion extends number,
	DatabaseVersion extends number,
	StorageName extends string,
>(
	value: FramescaperDesktopProjectLibraryExactGenerationHandshake<
		LibraryVersion, DatabaseVersion, StorageName
	>,
): Readonly<FramescaperDesktopProjectLibraryExactGenerationHandshake<
	LibraryVersion, DatabaseVersion, StorageName
>> {
	return Object.freeze({
		...value,
		scapeFormatVersions: Object.freeze([1]) as readonly [1],
		desktopLibraryScope: Object.freeze([...value.desktopLibraryScope]) as
			readonly ['kw.media', 'framescaper-project-library', 'v1'],
	});
}

function exactDenseTuple<const Expected extends readonly unknown[]>(
	value: unknown,
	expected: Expected,
	label: string,
): void {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${label} must be a plain dense array`);
	}
	const keys = Reflect.ownKeys(value);
	const expectedKeys = [...expected.keys()].map(String);
	if (keys.length !== expected.length + 1 || keys[keys.length - 1] !== 'length'
		|| expectedKeys.some((key, index) => keys[index] !== key)
		|| expected.some((expectedValue, index) => value[index] !== expectedValue)) {
		throw new TypeError(`${label} is unsupported`);
	}
}

function snapshotClosedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${label} has missing or unsupported fields`);
	const output = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${field} must be an own enumerable data property`);
		}
		output[field] = descriptor.value;
	}
	return output;
}

function absolutePath(value: unknown, label: string, field: string): string {
	if (typeof value !== 'string' || value.includes('\0') || !isAbsolute(value)) {
		throw new TypeError(`${label} ${field} must be an absolute path`);
	}
	return normalize(value);
}

function assertDescendant(parent: string, child: string, label: string): void {
	const path = relative(parent, child);
	if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
		throw new TypeError(`${label} scope must stay inside appData`);
	}
}
