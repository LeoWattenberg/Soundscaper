/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PROJECT_OWNED_FEATURE_REQUIREMENT_IDS,
} from '../common/editor/project-owned-feature-requirements.ts';
import type { ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV28,
} from './editor-project-feature-requirements-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import type { FramescaperProjectV28 } from './editor-project-v28.ts';

/** Detach F31-only custody before asking exact selected F28 authorities. */
export function framescaperProjectV28FoundationShapeV31(project: unknown): FramescaperProjectV28 {
	const foundation = structuredClone(record(project, 'Framescaper F31 project'));
	foundation.schemaVersion = 28;
	delete foundation.assistanceAssets;
	const manifest = record(foundation.featureRequirements, 'featureRequirements');
	const requirements = records(manifest.requirements, 'featureRequirements.requirements').filter((row) => (
		row.id !== PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.assistanceAssets
	));
	foundation.featureRequirements = { ...manifest, requirements } as unknown as ProjectFeatureRequirementsManifest;
	foundation.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		foundation,
	);
	return foundation as unknown as FramescaperProjectV28;
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
