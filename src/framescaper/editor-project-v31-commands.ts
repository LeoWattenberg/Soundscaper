/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	reconcileFramescaperProjectFeatureRequirementsV31,
} from './editor-project-feature-requirements-v31.ts';
import {
	applyFramescaperProjectCommandV28,
	snapshotFramescaperProjectCommandV28,
	type FramescaperProjectCommandOptionsV28,
	type FramescaperProjectCommandV28,
} from './editor-project-v28-commands.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import { framescaperProjectV28FoundationShapeV31 } from './editor-project-v31-foundation.ts';
import {
	validateFramescaperProjectV31,
	type FramescaperProjectV31,
} from './editor-project-v31.ts';

export type FramescaperProjectCommandV31 = FramescaperProjectCommandV28;
export type FramescaperProjectCommandOptionsV31 = FramescaperProjectCommandOptionsV28;
export const snapshotFramescaperProjectCommandV31 = snapshotFramescaperProjectCommandV28;

/** Execute exact inherited F28 semantics without allowing F31 custody to be dropped. */
export function applyFramescaperProjectCommandV31(
	profile: unknown,
	projectValue: unknown,
	commandValue: unknown,
	options: FramescaperProjectCommandOptionsV31 = {},
): FramescaperProjectV31 {
	assertFramescaperProjectV31Profile(profile);
	validateFramescaperProjectV31(profile, projectValue);
	const project = projectValue as FramescaperProjectV31;
	const applied = applyFramescaperProjectCommandV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV28FoundationShapeV31(project),
		commandValue,
		options,
	) as unknown as Record<string, unknown>;
	applied.schemaVersion = 31;
	applied.assistanceAssets = structuredClone(project.assistanceAssets);
	applied.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV31(profile, applied);
	validateFramescaperProjectV31(profile, applied);
	return applied as unknown as FramescaperProjectV31;
}
