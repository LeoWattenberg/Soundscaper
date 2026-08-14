/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts'
import {
	evaluateProjectFeatureRequirements,
	type ProjectFeatureRequirementsReport,
} from '../common/editor/project-feature-requirements.ts'
import {
	SOUNDSCAPER_V21_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile-v21.ts'
import {
	SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
	type SoundscaperProjectV21,
} from './editor-project-v21.ts'
import { validateSoundscaperProjectV21 } from './editor-project-v21-validation.ts'

export interface SoundscaperProjectFeatureCompatibilityServiceV21 {
	readonly evaluate: (project: unknown) => ProjectFeatureRequirementsReport | null
}

/** Evaluate only exact V21 documents against the selected Soundscaper capability set. */
export function createSoundscaperProjectFeatureCompatibilityServiceV21():
Readonly<SoundscaperProjectFeatureCompatibilityServiceV21> {
	const capability = editorProjectFeatureCapabilityProfileDefinition(
		SOUNDSCAPER_V21_PROJECT_FEATURE_CAPABILITY_PROFILE,
	)
	const knownFeatureIds = new Set(capability.registrations.map(({ featureId }) => featureId))
	const availableFeatureIds = new Set(capability.registrations
		.filter(({ available }) => available)
		.map(({ featureId }) => featureId))
	return Object.freeze({ evaluate })

	function evaluate(project: unknown): ProjectFeatureRequirementsReport | null {
		if (!project || typeof project !== 'object' || Array.isArray(project)) return null
		const descriptor = Object.getOwnPropertyDescriptor(project, 'schemaVersion')
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
			|| descriptor.value !== SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION) return null
		validateSoundscaperProjectV21(project)
		const exact = project as SoundscaperProjectV21
		return evaluateProjectFeatureRequirements(exact.featureRequirements, {
			knownFeatureIds,
			availableFeatureIds,
			sources: exact.sources,
			clips: exact.clips,
			tracks: exact.tracks,
			schemaVersion: exact.schemaVersion,
			sampleRate: exact.sampleRate,
			sequences: exact.sequences,
			primarySequenceId: exact.primarySequenceId,
		})
	}
}
