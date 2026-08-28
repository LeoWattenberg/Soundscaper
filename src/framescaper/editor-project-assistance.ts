/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeAssistanceAssetReferencesV1,
} from '../common/editor/assistance/assistance-asset-reference-v1.ts';
import { PROJECT_SCHEMA_VERSION } from '../common/editor/project-schema-identity.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsAssistance,
} from './editor-project-feature-requirements-assistance.ts';
import { assertFramescaperProjectAssistanceProfile } from './editor-domain-runtime-profile.ts';
import {
	createFramescaperProjectTimelineImage,
	type FramescaperProjectTimelineImageOptions,
} from './editor-project-timeline-image.ts';
import { FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	validateFramescaperProjectAssistance,
	type FramescaperProjectAssistance,
} from './editor-project-assistance-validation.ts';

export {
	validateFramescaperProjectAssistance,
	type FramescaperProjectAssistance,
} from './editor-project-assistance-validation.ts';

export type FramescaperProjectAssistanceOptions = FramescaperProjectTimelineImageOptions & Readonly<{
	readonly assistanceAssets?: readonly unknown[];
}>;

export function createFramescaperProjectAssistance(
	profile: unknown,
	options: FramescaperProjectAssistanceOptions = {},
): FramescaperProjectAssistance {
	assertFramescaperProjectAssistanceProfile(profile);
	const { assistanceAssets: assetValues = [], ...v32Options } = options;
	const foundation = createFramescaperProjectTimelineImage(
		FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
		v32Options,
	) as unknown as Record<string, unknown>;
	foundation.schemaVersion = PROJECT_SCHEMA_VERSION;
	foundation.assistanceAssets = normalizeAssistanceAssetReferencesV1(assetValues);
	return reconcile(profile, foundation);
}

export function cloneFramescaperProjectAssistance(
	profile: unknown,
	project: unknown,
): FramescaperProjectAssistance {
	validateFramescaperProjectAssistance(profile, project);
	const draft = structuredClone(project) as Record<string, unknown>;
	draft.assistanceAssets = normalizeAssistanceAssetReferencesV1(draft.assistanceAssets);
	return reconcile(profile, draft);
}

function reconcile(profile: unknown, draft: Record<string, unknown>): FramescaperProjectAssistance {
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsAssistance(profile, draft);
	validateFramescaperProjectAssistance(profile, draft);
	return draft as unknown as FramescaperProjectAssistance;
}
