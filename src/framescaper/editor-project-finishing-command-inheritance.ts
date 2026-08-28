/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	reconcileFramescaperProjectFeatureRequirementsFinishing,
	FRAMESCAPER_FINISHING_STATE_FIELDS,
} from './editor-project-feature-requirements-finishing.ts';
import {
	applyFramescaperProjectCommandVisual,
	type FramescaperProjectCommandOptionsVisual,
} from './editor-project-visual-commands.ts';
import { FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	framescaperProjectVisualFoundationFinishing,
	normalizeFramescaperProjectFinishingStateFinishing,
	validateFramescaperProjectFinishing,
	type FramescaperProjectFinishing,
} from './editor-project-finishing-validation.ts';
import { reconcileInheritedFramescaperProjectStateFinishing } from './editor-project-finishing-inherited-state.ts';

/** Apply one maintained visual command without allowing it to observe or erase finishing state. */
export function applyInheritedFramescaperProjectCommandFinishing(
	profile: unknown,
	project: FramescaperProjectFinishing,
	command: unknown,
	options: FramescaperProjectCommandOptionsVisual,
): FramescaperProjectFinishing {
	validateFramescaperProjectFinishing(profile, project);
	const foundation = framescaperProjectVisualFoundationFinishing(profile, project);
	const applied = applyFramescaperProjectCommandVisual(
		FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE,
		foundation,
		command,
		options,
	) as unknown as Record<string, unknown>;
	applied.schemaVersion =  1;
	const finishing = project as unknown as Readonly<Record<string, unknown>>;
	for (const field of FRAMESCAPER_FINISHING_STATE_FIELDS) {
		applied[field] = structuredClone(finishing[field]);
	}
	reconcileInheritedFramescaperProjectStateFinishing(applied);
	normalizeFramescaperProjectFinishingStateFinishing(applied);
	applied.featureRequirements = reconcileFramescaperProjectFeatureRequirementsFinishing(profile, applied);
	validateFramescaperProjectFinishing(profile, applied);
	return applied as unknown as FramescaperProjectFinishing;
}
