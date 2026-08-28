/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
	classifyProjectSchemaIdentity,
	type ProjectSchemaDisposition,
} from '../common/editor/project-schema-identity.ts';
import {
	FRAMESCAPER_ASSISTANCE_PROJECT_FIELDS,
	validateFramescaperProjectAssistance,
	type FramescaperProjectAssistance,
} from './editor-project-assistance-validation.ts';
import {
	cloneFramescaperProjectAssistance,
	createFramescaperProjectAssistance,
	type FramescaperProjectAssistanceOptions,
} from './editor-project-assistance.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
	assertFramescaperProjectRuntimeProfile,
} from './editor-project-runtime-profile.ts';

export { FRAMESCAPER_PROJECT_SCHEMA_FAMILY, PROJECT_SCHEMA_VERSION } from
	'../common/editor/project-schema-identity.ts';

export const FRAMESCAPER_PROJECT_FIELDS = Object.freeze([
	...FRAMESCAPER_ASSISTANCE_PROJECT_FIELDS,
] as const);

export interface FramescaperProject extends Omit<FramescaperProjectAssistance, 'schemaVersion'> {
	readonly schemaFamily: typeof FRAMESCAPER_PROJECT_SCHEMA_FAMILY;
	readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
}

export type FramescaperProjectOptions = FramescaperProjectAssistanceOptions;

export interface LoadedFramescaperProject {
	readonly project: FramescaperProject | Readonly<Record<string, unknown>>;
	readonly readOnly: boolean;
	readonly intrinsicReadOnly: boolean;
	readonly reason: 'foreign-family' | 'newer-schema' | null;
}

export function createFramescaperProject(
	profile: unknown = FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
	options: FramescaperProjectOptions = {},
): FramescaperProject {
	assertFramescaperProjectRuntimeProfile(profile);
	const project = createFramescaperProjectAssistance(profile, options);
	exactBaselineProject(project);
	return project;
}

export function cloneFramescaperProject(
	profile: unknown,
	project: unknown,
): FramescaperProject {
	assertFramescaperProjectRuntimeProfile(profile);
	validateFramescaperProject(profile, project);
	const clone = cloneFramescaperProjectAssistance(profile, project);
	exactBaselineProject(clone);
	return clone;
}

/** Validate only the current Framescaper family. Foreign domains are rejected before traversal. */
export function validateFramescaperProject(
	profile: unknown,
	project: unknown,
): project is FramescaperProject {
	assertFramescaperProjectRuntimeProfile(profile);
	const classification = classifyProjectSchemaIdentity(
		project,
		FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	);
	if (classification.disposition !== 'current') {
		throw new RangeError(`Framescaper cannot validate a ${classification.disposition} project domain.`);
	}
	exactBaselineProject(project);
	validateFramescaperProjectAssistance(profile, project);
	return true;
}

/**
 * Admit exact v1 as writable and retain known foreign/future identities as
 * opaque read-only custody. Pre-release numeric-only documents are rejected by
 * the shared identity reader with `REIMPORT_REQUIRED`.
 */
export function loadFramescaperProject(
	profile: unknown,
	value: unknown,
): LoadedFramescaperProject {
	assertFramescaperProjectRuntimeProfile(profile);
	const classification = classifyProjectSchemaIdentity(
		value,
		FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	);
	if (classification.disposition === 'current') return Object.freeze({
		project: cloneFramescaperProject(profile, value),
		readOnly: false,
		intrinsicReadOnly: false,
		reason: null,
	});
	return Object.freeze({
		// Do not enumerate or interpret a foreign domain. Its archive bytes remain
		// the Save Copy authority; this reference is only opaque in-memory custody.
		project: value as Readonly<Record<string, unknown>>,
		readOnly: true,
		intrinsicReadOnly: true,
		reason: custodyReason(classification.disposition),
	});
}

function exactBaselineProject(value: unknown): Record<string, unknown> {
	const project = plainRecord(value, 'Framescaper project');
	const expected = new Set<string>(FRAMESCAPER_PROJECT_FIELDS);
	const keys = Reflect.ownKeys(project);
	if (keys.length !== expected.size || keys.some((key) => (
		typeof key !== 'string' || !expected.has(key)
	))) {
		const unexpected = keys.find((key) => typeof key !== 'string' || !expected.has(key));
		throw new TypeError(`Framescaper project contains unsupported field ${String(unexpected)}.`);
	}
	for (const field of FRAMESCAPER_PROJECT_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(project, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${field} must be an own enumerable data property.`);
		}
	}
	return project;
}

function custodyReason(
	disposition: Exclude<ProjectSchemaDisposition, 'current'>,
): 'foreign-family' | 'newer-schema' {
	return disposition === 'foreign' ? 'foreign-family' : 'newer-schema';
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype
			&& Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}
