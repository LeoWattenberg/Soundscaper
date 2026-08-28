/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeAssistanceAssetReferencesV1,
	validateAssistanceAssetSourceBindingsV1,
	type AssistanceAssetReferenceV1,
} from '../common/editor/assistance/assistance-asset-reference-v1.ts';
import { readClosedDomainField } from '../common/editor/closed-domain-value.ts';
import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
	classifyProjectSchemaIdentity,
} from '../common/editor/project-schema-identity.ts';
import {
	validateFramescaperProjectFeatureRequirementsAssistance,
} from './editor-project-feature-requirements-assistance.ts';
import { assertFramescaperProjectAssistanceProfile } from './editor-domain-runtime-profile.ts';
import {
	FRAMESCAPER_TIMELINE_IMAGE_PROJECT_FIELDS,
	validateFramescaperProjectTimelineImage,
	type FramescaperProjectTimelineImage,
} from './editor-project-timeline-image-validation.ts';
import { FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';

export const FRAMESCAPER_ASSISTANCE_PROJECT_FIELDS = Object.freeze([
	...FRAMESCAPER_TIMELINE_IMAGE_PROJECT_FIELDS,
	'assistanceAssets',
] as const);

export interface FramescaperProjectAssistance extends Omit<FramescaperProjectTimelineImage,
	'schemaVersion' | 'featureRequirements'> {
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	readonly featureRequirements: FramescaperProjectTimelineImage['featureRequirements'];
	readonly assistanceAssets: readonly Readonly<AssistanceAssetReferenceV1>[];
}

/** Validate exact assistance assistance over its authenticated timelineImage image foundation. */
export function validateFramescaperProjectAssistance(
	profile: unknown,
	project: unknown,
): project is FramescaperProjectAssistance {
	assertFramescaperProjectAssistanceProfile(profile);
	const classification = classifyProjectSchemaIdentity(
		project, FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	);
	if (classification.disposition !== 'current') {
		throw new RangeError(`Framescaper cannot validate a ${classification.disposition} assistance project.`);
	}
	const candidate = exactProject(project);
	if (candidate.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new RangeError(
			`Unsupported Framescaper project schema version: ${String(candidate.schemaVersion)}.`,
		);
	}
	validateFramescaperProjectTimelineImage(
		FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
		framescaperProjectTimelineImageFoundationShapeAssistance(candidate),
	);
	const assets = normalizeAssistanceAssetReferencesV1(
		readClosedDomainField(candidate, 'assistanceAssets', 'Framescaper assistance project'),
	);
	validateAssistanceAssetSourceBindingsV1(assets, candidate.sources);
	validateFramescaperProjectFeatureRequirementsAssistance(profile, candidate);
	return true;
}

function exactProject(value: unknown): Record<string, unknown> {
	const project = record(value, 'Framescaper assistance project');
	const expected = new Set(FRAMESCAPER_ASSISTANCE_PROJECT_FIELDS);
	const keys = Reflect.ownKeys(project);
	if (keys.length !== expected.size || keys.some((key) => (
		typeof key !== 'string' || !expected.has(key as (typeof FRAMESCAPER_ASSISTANCE_PROJECT_FIELDS)[number])
	))) {
		const unexpected = keys.find((key) => (
			typeof key !== 'string'
			|| !expected.has(key as (typeof FRAMESCAPER_ASSISTANCE_PROJECT_FIELDS)[number])
		));
		throw new TypeError(`Framescaper assistance project contains unsupported field ${String(unexpected)}.`);
	}
	for (const field of FRAMESCAPER_ASSISTANCE_PROJECT_FIELDS) {
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
