/* SPDX-License-Identifier: AGPL-3.0-only */

export interface EditorProjectFeatureCapabilityProfileDefinition {
	readonly owner: string;
	readonly registrations: readonly Readonly<{
		readonly key: string;
		readonly featureId: string;
		readonly available: boolean;
	}>[];
}

declare const editorProjectFeatureCapabilityProfileIdentity: unique symbol;

export type EditorProjectFeatureCapabilityProfile = Readonly<{
	readonly [editorProjectFeatureCapabilityProfileIdentity]: true;
}>;

const DEFINITION_FIELDS = ['owner', 'registrations'] as const;
const REGISTRATION_FIELDS = ['key', 'featureId', 'available'] as const;
const OWNER = /^[a-z][a-z0-9-]{0,63}$/u;
const REGISTRATION_KEY = /^[a-z][A-Za-z0-9]{0,63}$/u;
const FEATURE_ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u;
const PROFILE_DEFINITIONS = new WeakMap<
	EditorProjectFeatureCapabilityProfile,
	Readonly<EditorProjectFeatureCapabilityProfileDefinition>
>();

export function createEditorProjectFeatureCapabilityProfile(
	definition: unknown,
): EditorProjectFeatureCapabilityProfile {
	const snapshot = snapshotDefinition(definition);
	const profile = Object.freeze(Object.create(null)) as EditorProjectFeatureCapabilityProfile;
	PROFILE_DEFINITIONS.set(profile, snapshot);
	return profile;
}

export function editorProjectFeatureCapabilityProfileDefinition(
	profile: unknown,
): Readonly<EditorProjectFeatureCapabilityProfileDefinition> {
	const definition = PROFILE_DEFINITIONS.get(
		profile as EditorProjectFeatureCapabilityProfile,
	);
	if (!definition) {
		throw new TypeError('An authentic editor project feature capability profile is required.');
	}
	return definition;
}

function snapshotDefinition(
	value: unknown,
): Readonly<EditorProjectFeatureCapabilityProfileDefinition> {
	const raw = snapshotClosedRecord(value, DEFINITION_FIELDS, 'capability profile');
	if (typeof raw.owner !== 'string' || !OWNER.test(raw.owner)) {
		throw new TypeError('Editor project feature capability profile owner is invalid.');
	}
	const registrations = snapshotRegistrations(raw.registrations);
	return Object.freeze({ owner: raw.owner, registrations });
}

function snapshotRegistrations(
	value: unknown,
): EditorProjectFeatureCapabilityProfileDefinition['registrations'] {
	if (!Array.isArray(value)) {
		throw new TypeError('Editor project feature capability registrations must be a plain dense array.');
	}
	if (Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError('Editor project feature capability registrations must be a plain dense array.');
	}
	const keys = Reflect.ownKeys(value);
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	if (!lengthDescriptor || lengthDescriptor.enumerable || !Object.hasOwn(lengthDescriptor, 'value')) {
		throw new TypeError('Editor project feature capability registrations must have a canonical length.');
	}
	const length = lengthDescriptor.value;
	if (!Number.isSafeInteger(length) || Number(length) < 1 || Number(length) > 128) {
		throw new TypeError('Editor project feature capability registrations have an invalid length.');
	}
	const size = Number(length);
	const expectedKeys = new Set<PropertyKey>(['length']);
	for (let index = 0; index < size; index += 1) expectedKeys.add(String(index));
	if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) {
		throw new TypeError('Editor project feature capability registrations must be dense and have no extra keys.');
	}

	const elementValues: unknown[] = [];
	for (let index = 0; index < size; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError('Editor project feature capability registrations must contain enumerable data elements.');
		}
		elementValues.push(descriptor.value);
	}

	const registrations: Array<EditorProjectFeatureCapabilityProfileDefinition['registrations'][number]> = [];
	const featureIds = new Set<string>();
	let previousKey: string | null = null;
	for (const elementValue of elementValues) {
		const registration = snapshotRegistration(elementValue);
		if (previousKey !== null && registration.key <= previousKey) {
			throw new TypeError('Editor project feature capability registration keys must be sorted and unique.');
		}
		if (featureIds.has(registration.featureId)) {
			throw new TypeError('Editor project feature capability feature IDs must be unique.');
		}
		registrations.push(registration);
		previousKey = registration.key;
		featureIds.add(registration.featureId);
	}
	return Object.freeze(registrations);
}

function snapshotRegistration(
	value: unknown,
): EditorProjectFeatureCapabilityProfileDefinition['registrations'][number] {
	const raw = snapshotClosedRecord(value, REGISTRATION_FIELDS, 'capability registration');
	if (typeof raw.key !== 'string' || !REGISTRATION_KEY.test(raw.key)) {
		throw new TypeError('Editor project feature capability registration key is invalid.');
	}
	if (typeof raw.featureId !== 'string' || raw.featureId.length > 256
		|| !FEATURE_ID.test(raw.featureId)) {
		throw new TypeError('Editor project feature capability feature ID is invalid.');
	}
	if (typeof raw.available !== 'boolean') {
		throw new TypeError('Editor project feature capability availability must be boolean.');
	}
	return Object.freeze({
		key: raw.key,
		featureId: raw.featureId,
		available: raw.available,
	});
}

function snapshotClosedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Readonly<Record<Field, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`Editor project feature ${name} must be a plain record.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`Editor project feature ${name} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) {
		throw new TypeError(`Editor project feature ${name} has invalid fields.`);
	}
	const snapshot = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Editor project feature ${name} ${field} must be an own enumerable data property.`);
		}
		snapshot[field] = descriptor.value;
	}
	return snapshot;
}
