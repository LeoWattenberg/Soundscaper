/* SPDX-License-Identifier: AGPL-3.0-only */

import { brandRuntimeProjectProjection, type RuntimeClipProject } from '../common/editor/runtime-clip-projection.ts';
import {
	framescaperProjectForCommandConsumersTimelineImage,
	framescaperProjectForEditClipboardConsumersTimelineImage,
	framescaperProjectForRuntimeConsumersTimelineImage,
} from './editor-project-timeline-image-runtime.ts';
import { FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { assertFramescaperProjectAssistanceProfile } from './editor-domain-runtime-profile.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import {
	validateFramescaperProjectAssistance,
	type FramescaperProjectAssistance,
} from './editor-project-assistance.ts';

type DataRecord = Record<string, unknown>;

export function framescaperProjectForRuntimeConsumersAssistance(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	return projectForConsumers(profile, projectValue, 'runtime');
}

export function framescaperProjectForCommandConsumersAssistance(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	return projectForConsumers(profile, projectValue, 'command');
}

export function framescaperProjectForEditClipboardConsumersAssistance(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	assertFramescaperProjectAssistanceProfile(profile);
	validateFramescaperProjectAssistance(profile, projectValue);
	return framescaperProjectForEditClipboardConsumersTimelineImage(
		FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
		framescaperProjectTimelineImageFoundationShapeAssistance(projectValue),
	);
}

function projectForConsumers(
	profile: unknown,
	projectValue: unknown,
	kind: 'runtime' | 'command',
): Readonly<DataRecord> {
	assertFramescaperProjectAssistanceProfile(profile);
	validateFramescaperProjectAssistance(profile, projectValue);
	const project = projectValue as FramescaperProjectAssistance;
	const foundation = framescaperProjectTimelineImageFoundationShapeAssistance(project);
	const projected = structuredClone(kind === 'runtime'
		? framescaperProjectForRuntimeConsumersTimelineImage(FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE, foundation)
		: framescaperProjectForCommandConsumersTimelineImage(FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE, foundation)) as DataRecord;
	projected.assistanceAssets = structuredClone(project.assistanceAssets);
	projected.featureRequirements = structuredClone(project.featureRequirements);
	if (kind === 'runtime') {
		// Feature projection runs against this transient view before the outer
		// facade sees it, so retain the full tuple instead of restoring the family
		// only after identity-gated fallbacks and bypasses have already run.
		projected.schemaFamily = project.schemaFamily;
		projected.schemaVersion = 1;
	}
	return brandRuntimeProjectProjection(Object.freeze(projected) as RuntimeClipProject) as Readonly<DataRecord>;
}
