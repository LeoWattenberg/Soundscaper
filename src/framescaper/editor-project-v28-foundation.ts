/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../common/editor/project-feature-capabilities.ts';
import { PROJECT_OWNED_FEATURE_REQUIREMENT_IDS } from '../common/editor/project-owned-feature-requirements.ts';
import { reconcileFramescaperProjectFeatureRequirementsV27 } from './editor-project-feature-requirements-v27.ts';
import { framescaperVideoSourceCharacteristicsV24ProjectionV25 } from './editor-project-v25-foundation.ts';
import { FRAMESCAPER_V26_OPENFX_REQUIREMENT } from './editor-project-feature-requirements-v26.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v27.ts';
import type { FramescaperProjectV27 } from './editor-project-v27.ts';

/** Detach V28-only authority before asking the immutable selected V27 validator. */
export function framescaperProjectV27FoundationShapeV28(project: unknown): FramescaperProjectV27 {
	const foundation = structuredClone(record(project, 'Framescaper V28 project'));
	foundation.schemaVersion = 27;
	delete foundation.ofxEffects;
	foundation.sources = records(foundation.sources, 'sources').map((source) => {
		if (source.kind !== 'video') return source;
		delete source.imageSequence;
		source.characteristics = framescaperVideoSourceCharacteristicsV24ProjectionV25(source);
		return source;
	});
	const manifest = record(foundation.featureRequirements, 'featureRequirements');
	const requirements = records(manifest.requirements, 'featureRequirements.requirements').filter((row) => (
		row.id !== PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.sourceCharacteristics
		&& row.featureId !== PROJECT_FEATURE_CAPABILITY_IDS.sourceCharacteristics
		&& row.id !== FRAMESCAPER_V26_OPENFX_REQUIREMENT.id
		&& row.featureId !== FRAMESCAPER_V26_OPENFX_REQUIREMENT.featureId
	));
	foundation.featureRequirements = { ...manifest, requirements };
	foundation.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV27(
		FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
		foundation,
	);
	return foundation as unknown as FramescaperProjectV27;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
