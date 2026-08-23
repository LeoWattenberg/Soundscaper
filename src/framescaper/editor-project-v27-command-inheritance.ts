/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	reconcileFramescaperProjectFeatureRequirementsV27,
	FRAMESCAPER_V27_STATE_FIELDS,
} from './editor-project-feature-requirements-v27.ts';
import {
	applyFramescaperProjectCommandV24,
	type FramescaperProjectCommandOptionsV24,
} from './editor-project-v24-commands.ts';
import { FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v24.ts';
import {
	framescaperProjectV24FoundationV27,
	normalizeFramescaperProjectFinishingStateV27,
	validateFramescaperProjectV27,
	type FramescaperProjectV27,
} from './editor-project-v27-validation.ts';
import { reconcileInheritedFramescaperProjectStateV27 } from './editor-project-v27-inherited-state.ts';

/** Apply one maintained V24 command without allowing it to observe or erase V27 state. */
export function applyInheritedFramescaperProjectCommandV27(
	profile: unknown,
	project: FramescaperProjectV27,
	command: unknown,
	options: FramescaperProjectCommandOptionsV24,
): FramescaperProjectV27 {
	validateFramescaperProjectV27(profile, project);
	const foundation = framescaperProjectV24FoundationV27(profile, project);
	const applied = applyFramescaperProjectCommandV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		foundation,
		command,
		options,
	) as unknown as Record<string, unknown>;
	applied.schemaVersion = 27;
	const finishing = project as unknown as Readonly<Record<string, unknown>>;
	for (const field of FRAMESCAPER_V27_STATE_FIELDS) {
		applied[field] = structuredClone(finishing[field]);
	}
	reconcileInheritedFramescaperProjectStateV27(applied);
	normalizeFramescaperProjectFinishingStateV27(applied);
	applied.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV27(profile, applied);
	validateFramescaperProjectV27(profile, applied);
	return applied as unknown as FramescaperProjectV27;
}
