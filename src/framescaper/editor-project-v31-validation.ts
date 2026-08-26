/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeAssistanceAssetReferencesV1,
	validateAssistanceAssetSourceBindingsV1,
	type AssistanceAssetReferenceV1,
} from '../common/editor/assistance/assistance-asset-reference-v1.ts';
import { readClosedDomainField } from '../common/editor/closed-domain-value.ts';
import { FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION } from '../common/editor/project-schema-version.ts';
import {
	validateFramescaperProjectFeatureRequirementsV31,
} from './editor-project-feature-requirements-v31.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import {
	FRAMESCAPER_V30_PROJECT_FIELDS,
	validateFramescaperProjectV30,
	type FramescaperProjectV30,
} from './editor-project-v30-validation.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v30.ts';
import { framescaperProjectV30FoundationShapeV31 } from './editor-project-v31-foundation.ts';

export { FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION } from '../common/editor/project-schema-version.ts';

export const FRAMESCAPER_V31_PROJECT_FIELDS = Object.freeze([
	...FRAMESCAPER_V30_PROJECT_FIELDS,
	'assistanceAssets',
] as const);

export interface FramescaperProjectV31 extends Omit<FramescaperProjectV30,
	'schemaVersion' | 'featureRequirements'> {
	readonly schemaVersion: 31;
	readonly featureRequirements: FramescaperProjectV30['featureRequirements'];
	readonly assistanceAssets: readonly Readonly<AssistanceAssetReferenceV1>[];
}

/** Validate exact F31 assistance over its authenticated V30 image foundation. */
export function validateFramescaperProjectV31(
	profile: unknown,
	project: unknown,
): project is FramescaperProjectV31 {
	assertFramescaperProjectV31Profile(profile);
	const candidate = exactProject(project);
	if (candidate.schemaVersion !== FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION) {
		throw new RangeError(
			`Unsupported Framescaper project schema version: ${String(candidate.schemaVersion)}.`,
		);
	}
	validateFramescaperProjectV30(
		FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV30FoundationShapeV31(candidate),
	);
	const assets = normalizeAssistanceAssetReferencesV1(
		readClosedDomainField(candidate, 'assistanceAssets', 'Framescaper F31 project'),
	);
	validateAssistanceAssetSourceBindingsV1(assets, candidate.sources);
	validateFramescaperProjectFeatureRequirementsV31(profile, candidate);
	return true;
}

function exactProject(value: unknown): Record<string, unknown> {
	const project = record(value, 'Framescaper F31 project');
	const expected = new Set(FRAMESCAPER_V31_PROJECT_FIELDS);
	const keys = Reflect.ownKeys(project);
	if (keys.length !== expected.size || keys.some((key) => (
		typeof key !== 'string' || !expected.has(key as (typeof FRAMESCAPER_V31_PROJECT_FIELDS)[number])
	))) {
		const unexpected = keys.find((key) => (
			typeof key !== 'string'
			|| !expected.has(key as (typeof FRAMESCAPER_V31_PROJECT_FIELDS)[number])
		));
		throw new TypeError(`Framescaper F31 project contains unsupported field ${String(unexpected)}.`);
	}
	for (const field of FRAMESCAPER_V31_PROJECT_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(project, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${field} must be data.`);
		}
	}
	return project;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}
