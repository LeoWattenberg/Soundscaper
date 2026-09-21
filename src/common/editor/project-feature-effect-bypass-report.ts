/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from './project-feature-capabilities.ts';
import type { ProjectFeatureRequirementsReport } from './project-feature-requirement-types.ts';

export type ProjectFeatureEffectBypassCapabilityId =
	| typeof PROJECT_FEATURE_CAPABILITY_IDS.audioEffects
	| typeof PROJECT_FEATURE_CAPABILITY_IDS.videoEffects;

const MAXIMUM_REQUIREMENT_ID_LENGTH = 256;

/** Select the exact unavailable/bypass report entries that authorize effect bypass. */
export function qualifyingProjectFeatureEffectBypassRequirementIds(
	report: ProjectFeatureRequirementsReport | null | undefined,
	featureId: ProjectFeatureEffectBypassCapabilityId,
): string[] {
	if (report?.compatible !== false || report.format !== 'soundscaper-project' || !Array.isArray(report.items)) {
		return [];
	}
	const output: string[] = [];
	for (const item of report.items) {
		if (item.featureId !== featureId
			|| item.availability !== 'unavailable'
			|| item.declaredDisposition !== 'bypass'
			|| item.disposition !== 'bypassed') continue;
		output.push(boundedRequirementId(item.requirementId));
	}
	return output;
}

function boundedRequirementId(value: unknown): string {
	if (typeof value !== 'string' || !value || value.length > MAXIMUM_REQUIREMENT_ID_LENGTH) {
		throw new TypeError('feature requirement ID must be a non-empty bounded string.');
	}
	return value;
}
