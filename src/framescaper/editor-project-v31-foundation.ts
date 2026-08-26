/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PROJECT_OWNED_FEATURE_REQUIREMENT_IDS,
} from '../common/editor/project-owned-feature-requirements.ts';
import type { ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV30,
} from './editor-project-feature-requirements-v30.ts';
import { framescaperProjectV28FoundationShapeV30 } from './editor-project-v30-foundation.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v30.ts';
import type { FramescaperProjectV30 } from './editor-project-v30.ts';
import type { FramescaperProjectV28 } from './editor-project-v28.ts';

/** Detach F31-only assistance custody while retaining authenticated V30 image authority. */
export function framescaperProjectV30FoundationShapeV31(project: unknown): FramescaperProjectV30 {
	const foundation = structuredClone(record(project, 'Framescaper F31 project'));
	foundation.schemaVersion = 30;
	delete foundation.assistanceAssets;
	const manifest = record(foundation.featureRequirements, 'featureRequirements');
	const requirements = records(manifest.requirements, 'featureRequirements.requirements').filter((row) => (
		row.id !== PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.assistanceAssets
	));
	foundation.featureRequirements = { ...manifest, requirements } as unknown as ProjectFeatureRequirementsManifest;
	foundation.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV30(
		FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE,
		foundation,
	);
	return foundation as unknown as FramescaperProjectV30;
}

/** Detach both F31 assistance and V30 image authority for immutable V28 consumers. */
export function framescaperProjectV28FoundationShapeV31(project: unknown): FramescaperProjectV28 {
	return framescaperProjectV28FoundationShapeV30(framescaperProjectV30FoundationShapeV31(project));
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
