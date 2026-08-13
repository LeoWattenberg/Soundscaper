/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectFeatureCapabilityProfileDefinition,
	type EditorProjectFeatureCapabilityProfile,
} from './project-feature-capability-profile.ts';
import {
	editorProjectRuntimeProfilePrerequisiteDefinition,
	type EditorProjectRuntimeProfilePrerequisite,
} from './project-runtime-profile-prerequisite.ts';

export interface EditorProjectRuntimeProfileDefinition {
	readonly prerequisite: EditorProjectRuntimeProfilePrerequisite;
	readonly capabilityProfile: EditorProjectFeatureCapabilityProfile;
}

declare const editorProjectRuntimeProfileIdentity: unique symbol;

export type EditorProjectRuntimeProfile = Readonly<{
	readonly [editorProjectRuntimeProfileIdentity]: true;
}>;

const DEFINITION_FIELDS = ['prerequisite', 'capabilityProfile'] as const;
const PROFILE_DEFINITIONS = new WeakMap<
	EditorProjectRuntimeProfile,
	Readonly<EditorProjectRuntimeProfileDefinition>
>();

export function createEditorProjectRuntimeProfile(
	definition: unknown,
): EditorProjectRuntimeProfile {
	const snapshot = snapshotDefinition(definition);
	const profile = Object.freeze(Object.create(null)) as EditorProjectRuntimeProfile;
	PROFILE_DEFINITIONS.set(profile, snapshot);
	return profile;
}

export function editorProjectRuntimeProfileDefinition(
	profile: unknown,
): Readonly<EditorProjectRuntimeProfileDefinition> {
	const definition = PROFILE_DEFINITIONS.get(profile as EditorProjectRuntimeProfile);
	if (!definition) {
		throw new TypeError('An authentic editor project runtime profile is required.');
	}
	return definition;
}

function snapshotDefinition(
	value: unknown,
): Readonly<EditorProjectRuntimeProfileDefinition> {
	if (value === null || typeof value !== 'object') {
		throw new TypeError('Editor project runtime profile must be a plain record.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Editor project runtime profile must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== DEFINITION_FIELDS.length || keys.some(
		(key) => typeof key !== 'string'
			|| !DEFINITION_FIELDS.includes(key as (typeof DEFINITION_FIELDS)[number]),
	)) {
		throw new TypeError('Editor project runtime profile has invalid fields.');
	}
	const prerequisiteDescriptor = Object.getOwnPropertyDescriptor(value, 'prerequisite');
	const capabilityDescriptor = Object.getOwnPropertyDescriptor(value, 'capabilityProfile');
	if (!prerequisiteDescriptor?.enumerable
		|| !Object.hasOwn(prerequisiteDescriptor, 'value')) {
		throw new TypeError(
			'Editor project runtime profile prerequisite must be an own enumerable data property.',
		);
	}
	if (!capabilityDescriptor?.enumerable || !Object.hasOwn(capabilityDescriptor, 'value')) {
		throw new TypeError(
			'Editor project runtime profile capabilityProfile must be an own enumerable data property.',
		);
	}
	const prerequisite = prerequisiteDescriptor.value as EditorProjectRuntimeProfilePrerequisite;
	const capabilityProfile = capabilityDescriptor.value as EditorProjectFeatureCapabilityProfile;
	const prerequisiteDefinition = editorProjectRuntimeProfilePrerequisiteDefinition(prerequisite);
	const capabilityDefinition = editorProjectFeatureCapabilityProfileDefinition(capabilityProfile);
	if (prerequisiteDefinition.owner !== capabilityDefinition.owner) {
		throw new TypeError('Editor project runtime profile child owners must match.');
	}
	return Object.freeze({ prerequisite, capabilityProfile });
}
