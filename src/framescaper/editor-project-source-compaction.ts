/* SPDX-License-Identifier: AGPL-3.0-only */

import { compactProjectSourceMetadata } from '../common/editor/retention.js';
import { reconcileFramescaperProjectFeatureRequirementsAssistance } from './editor-project-feature-requirements-assistance.ts';
import { validateFramescaperProject, type FramescaperProject } from './editor-project.ts';

/** Source retirement and its feature declaration must be published together. */
export function compactFramescaperProjectSourceMetadata(
	profile: unknown,
	project: unknown,
	options: Readonly<{ preserveSourceIds?: Iterable<string> }> = {},
): FramescaperProject {
	validateFramescaperProject(profile, project);
	const compacted = compactProjectSourceMetadata(project as FramescaperProject, options);
	if (compacted === project) return compacted;
	const reconciled = { ...compacted,
		featureRequirements: reconcileFramescaperProjectFeatureRequirementsAssistance(profile, compacted) };
	validateFramescaperProject(profile, reconciled);
	return reconciled;
}
