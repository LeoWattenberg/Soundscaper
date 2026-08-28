/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_PROJECT_SCHEMA_FAMILY, classifyProjectSchemaIdentity } from
	'../common/editor/project-schema-identity.ts';
import {
	createFramescaperProjectFeatureCompatibilityServiceAssistance,
	reconcileFramescaperProjectFeatureRequirementsAssistance,
} from './editor-project-feature-requirements-assistance.ts';
import { validateFramescaperProject } from './editor-project.ts';
import { assertFramescaperProjectRuntimeProfile } from './editor-project-runtime-profile.ts';

export function createFramescaperProjectFeatureCompatibilityService(profile: unknown) {
	assertFramescaperProjectRuntimeProfile(profile);
	const selected = createFramescaperProjectFeatureCompatibilityServiceAssistance(
		profile,
	);
	return Object.freeze({ evaluate(project: unknown) {
		let disposition: ReturnType<typeof classifyProjectSchemaIdentity>['disposition'];
		try {
			disposition = classifyProjectSchemaIdentity(
				project,
				FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
			).disposition;
		} catch {
			return null;
		}
		return disposition === 'current'
			? selected.evaluate(project)
			: null;
	} });
}

export function reconcileFramescaperProjectFeatureRequirements(
	profile: unknown,
	project: unknown,
) {
	assertFramescaperProjectRuntimeProfile(profile);
	return reconcileFramescaperProjectFeatureRequirementsAssistance(
		profile,
		project,
	);
}

export function validateFramescaperProjectFeatureRequirements(
	profile: unknown,
	project: unknown,
) {
	validateFramescaperProject(profile, project);
	return (project as Readonly<{ featureRequirements: unknown }>).featureRequirements;
}
