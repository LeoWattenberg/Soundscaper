/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../common/editor/project-feature-capabilities.ts';
import { PROJECT_OWNED_FEATURE_REQUIREMENT_IDS } from '../common/editor/project-owned-feature-requirements.ts';
import { reconcileFramescaperProjectFeatureRequirementsFinishing } from './editor-project-feature-requirements-finishing.ts';
import { framescaperVideoSourceCharacteristicsVisualProjectionProfessionalMedia } from './editor-project-professional-media-foundation.ts';
import { FRAMESCAPER_OPENFX_OPENFX_REQUIREMENT } from './editor-project-feature-requirements-openfx.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import type { FramescaperProjectFinishing } from './editor-project-finishing.ts';

/** Detach nativeMedia-only authority before asking the immutable selected finishing validator. */
export function framescaperProjectFinishingFoundationShapeNativeMedia(project: unknown): FramescaperProjectFinishing {
	const foundation = structuredClone(record(project, 'Framescaper nativeMedia project'));
	foundation.schemaVersion =  1;
	delete foundation.ofxEffects;
	foundation.sources = records(foundation.sources, 'sources').map((source) => {
		if (source.kind !== 'video') return source;
		delete source.imageSequence;
		source.characteristics = framescaperVideoSourceCharacteristicsVisualProjectionProfessionalMedia(source);
		return source;
	});
	const manifest = record(foundation.featureRequirements, 'featureRequirements');
	const requirements = records(manifest.requirements, 'featureRequirements.requirements').filter((row) => (
		row.id !== PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.sourceCharacteristics
		&& row.featureId !== PROJECT_FEATURE_CAPABILITY_IDS.sourceCharacteristics
		&& row.id !== FRAMESCAPER_OPENFX_OPENFX_REQUIREMENT.id
		&& row.featureId !== FRAMESCAPER_OPENFX_OPENFX_REQUIREMENT.featureId
	));
	foundation.featureRequirements = { ...manifest, requirements };
	foundation.featureRequirements = reconcileFramescaperProjectFeatureRequirementsFinishing(
		FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		foundation,
	);
	return foundation as unknown as FramescaperProjectFinishing;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
