/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PROJECT_OWNED_FEATURE_REQUIREMENT_IDS,
} from '../common/editor/project-owned-feature-requirements.ts';
import type { ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsTimelineImage,
} from './editor-project-feature-requirements-timeline-image.ts';
import { framescaperProjectNativeMediaFoundationShapeTimelineImage } from './editor-project-timeline-image-foundation.ts';
import { FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import type { FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import type { FramescaperProjectNativeMedia } from './editor-project-native-media.ts';

/** Detach assistance-only assistance custody while retaining authenticated timelineImage image authority. */
export function framescaperProjectTimelineImageFoundationShapeAssistance(project: unknown): FramescaperProjectTimelineImage {
	const foundation = structuredClone(record(project, 'Framescaper assistance project'));
	foundation.schemaVersion =  1;
	delete foundation.assistanceAssets;
	const manifest = record(foundation.featureRequirements, 'featureRequirements');
	const requirements = records(manifest.requirements, 'featureRequirements.requirements').filter((row) => (
		row.id !== PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.assistanceAssets
	));
	foundation.featureRequirements = { ...manifest, requirements } as unknown as ProjectFeatureRequirementsManifest;
	foundation.featureRequirements = reconcileFramescaperProjectFeatureRequirementsTimelineImage(
		FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
		foundation,
	);
	return foundation as unknown as FramescaperProjectTimelineImage;
}

/** Detach both assistance assistance and timelineImage image authority for immutable nativeMedia consumers. */
export function framescaperProjectNativeMediaFoundationShapeAssistance(project: unknown): FramescaperProjectNativeMedia {
	return framescaperProjectNativeMediaFoundationShapeTimelineImage(framescaperProjectTimelineImageFoundationShapeAssistance(project));
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
