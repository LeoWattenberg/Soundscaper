/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectStorageProfileNames,
	type EditorProjectStorageProfile,
} from './storage/project-storage-profile.ts';

export interface EditorProjectRuntimeProfilePrerequisiteDefinition {
	readonly owner: string;
	readonly projectSchemaVersion: number;
	readonly storageProfile: EditorProjectStorageProfile;
	readonly priorSchemaPolicy: 'reimport-required';
	readonly futureSchemaPolicy: 'opaque-read-only';
	readonly scapeFormatVersions: readonly number[];
	readonly attachedScapeFormatVersion: number;
	readonly desktopLibrarySchemaVersion: number;
	readonly desktopProjectSchemaVersion: number;
	readonly desktopDatabaseUserVersion: number;
	readonly desktopLibraryScope: readonly string[];
}

declare const editorProjectRuntimeProfilePrerequisiteIdentity: unique symbol;

export type EditorProjectRuntimeProfilePrerequisite = Readonly<{
	readonly [editorProjectRuntimeProfilePrerequisiteIdentity]: true;
}>;

const DEFINITION_FIELDS = [
	'owner',
	'projectSchemaVersion',
	'storageProfile',
	'priorSchemaPolicy',
	'futureSchemaPolicy',
	'scapeFormatVersions',
	'attachedScapeFormatVersion',
	'desktopLibrarySchemaVersion',
	'desktopProjectSchemaVersion',
	'desktopDatabaseUserVersion',
	'desktopLibraryScope',
] as const;
const OWNER = /^[a-z][a-z0-9-]{0,63}$/u;
const DESKTOP_SCOPE_SEGMENT = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const PROFILE_DEFINITIONS = new WeakMap<
	EditorProjectRuntimeProfilePrerequisite,
	Readonly<EditorProjectRuntimeProfilePrerequisiteDefinition>
>();

export function createEditorProjectRuntimeProfilePrerequisite(
	definition: unknown,
): EditorProjectRuntimeProfilePrerequisite {
	const snapshot = snapshotDefinition(definition);
	const profile = Object.freeze(Object.create(null)) as EditorProjectRuntimeProfilePrerequisite;
	PROFILE_DEFINITIONS.set(profile, snapshot);
	return profile;
}

export function editorProjectRuntimeProfilePrerequisiteDefinition(
	profile: unknown,
): Readonly<EditorProjectRuntimeProfilePrerequisiteDefinition> {
	const definition = PROFILE_DEFINITIONS.get(
		profile as EditorProjectRuntimeProfilePrerequisite,
	);
	if (!definition) {
		throw new TypeError('An authentic editor project runtime profile prerequisite is required.');
	}
	return definition;
}

function snapshotDefinition(
	value: unknown,
): Readonly<EditorProjectRuntimeProfilePrerequisiteDefinition> {
	const raw = snapshotClosedDefinition(value);
	const storageProfile = raw.storageProfile as EditorProjectStorageProfile;
	editorProjectStorageProfileNames(storageProfile);

	const owner = profileOwner(raw.owner);
	const projectSchemaVersion = positiveSafeInteger(
		raw.projectSchemaVersion,
		'projectSchemaVersion',
	);
	const priorSchemaPolicy = exactPolicy(
		raw.priorSchemaPolicy,
		'reimport-required',
		'priorSchemaPolicy',
	);
	const futureSchemaPolicy = exactPolicy(
		raw.futureSchemaPolicy,
		'opaque-read-only',
		'futureSchemaPolicy',
	);
	const scapeFormatVersions = scapeFormats(raw.scapeFormatVersions);
	const attachedScapeFormatVersion = positiveSafeInteger(
		raw.attachedScapeFormatVersion,
		'attachedScapeFormatVersion',
	);
	if (!scapeFormatVersions.includes(attachedScapeFormatVersion)) {
		throw new TypeError('attachedScapeFormatVersion must name a supported Scape format.');
	}
	const desktopLibrarySchemaVersion = positiveSafeInteger(
		raw.desktopLibrarySchemaVersion,
		'desktopLibrarySchemaVersion',
	);
	const desktopProjectSchemaVersion = positiveSafeInteger(
		raw.desktopProjectSchemaVersion,
		'desktopProjectSchemaVersion',
	);
	if (desktopProjectSchemaVersion !== projectSchemaVersion) {
		throw new TypeError('desktopProjectSchemaVersion must equal projectSchemaVersion.');
	}
	const desktopDatabaseUserVersion = positiveSafeInteger(
		raw.desktopDatabaseUserVersion,
		'desktopDatabaseUserVersion',
	);
	const desktopLibraryScope = desktopScope(raw.desktopLibraryScope);

	return Object.freeze({
		owner,
		projectSchemaVersion,
		storageProfile,
		priorSchemaPolicy,
		futureSchemaPolicy,
		scapeFormatVersions,
		attachedScapeFormatVersion,
		desktopLibrarySchemaVersion,
		desktopProjectSchemaVersion,
		desktopDatabaseUserVersion,
		desktopLibraryScope,
	});
}

function snapshotClosedDefinition(value: unknown): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Editor project runtime profile prerequisite must be a plain record.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Editor project runtime profile prerequisite must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== DEFINITION_FIELDS.length || keys.some(
		(key) => typeof key !== 'string'
			|| !DEFINITION_FIELDS.includes(key as (typeof DEFINITION_FIELDS)[number]),
	)) {
		throw new TypeError('Editor project runtime profile prerequisite has invalid fields.');
	}
	const snapshot = Object.create(null) as Record<string, unknown>;
	for (const field of DEFINITION_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(
				`Editor project runtime profile prerequisite ${field} must be an own enumerable data property.`,
			);
		}
		snapshot[field] = descriptor.value;
	}
	return snapshot;
}

function scapeFormats(value: unknown): readonly number[] {
	const values = snapshotDenseArray(value, 'scapeFormatVersions', 1, 16);
	const formats: number[] = [];
	let previous = 0;
	for (const [index, candidate] of values.entries()) {
		const format = positiveSafeInteger(candidate, `scapeFormatVersions[${String(index)}]`);
		if (format <= previous) {
			throw new TypeError('scapeFormatVersions must be strictly increasing and unique.');
		}
		formats.push(format);
		previous = format;
	}
	return Object.freeze(formats);
}

function desktopScope(value: unknown): readonly string[] {
	const values = snapshotDenseArray(value, 'desktopLibraryScope', 1, 8);
	const scope: string[] = [];
	for (const candidate of values) {
		if (typeof candidate !== 'string' || !DESKTOP_SCOPE_SEGMENT.test(candidate)) {
			throw new TypeError('desktopLibraryScope contains an invalid segment.');
		}
		scope.push(candidate);
	}
	return Object.freeze(scope);
}

function snapshotDenseArray(
	value: unknown,
	name: string,
	minimum: number,
	maximum: number,
): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be a plain dense array.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Array.prototype) throw new TypeError(`${name} must be a plain dense array.`);
	const keys = Reflect.ownKeys(value);
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	if (!lengthDescriptor || lengthDescriptor.enumerable || !Object.hasOwn(lengthDescriptor, 'value')) {
		throw new TypeError(`${name} must have a canonical length data property.`);
	}
	const length = lengthDescriptor.value;
	if (!Number.isSafeInteger(length) || Number(length) < minimum || Number(length) > maximum) {
		throw new TypeError(`${name} has an invalid length.`);
	}
	const size = Number(length);
	const expectedKeys = new Set<PropertyKey>(['length']);
	for (let index = 0; index < size; index += 1) expectedKeys.add(String(index));
	if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) {
		throw new TypeError(`${name} must be dense and have no extra keys.`);
	}
	const snapshot: unknown[] = [];
	for (let index = 0; index < size; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must contain only enumerable data elements.`);
		}
		snapshot.push(descriptor.value);
	}
	return Object.freeze(snapshot);
}

function profileOwner(value: unknown): string {
	if (typeof value !== 'string' || !OWNER.test(value)) {
		throw new TypeError('Editor project runtime profile prerequisite owner is invalid.');
	}
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new TypeError(`${name} must be a positive safe integer.`);
	}
	return value;
}

function exactPolicy<const Value extends 'reimport-required' | 'opaque-read-only'>(
	value: unknown,
	expected: Value,
	name: string,
): Value {
	if (value !== expected) throw new TypeError(`${name} is unsupported.`);
	return expected;
}
