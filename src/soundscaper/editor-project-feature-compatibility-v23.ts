/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts'
import {
	evaluateProjectFeatureRequirements,
	type ProjectFeatureRequirementsReport,
} from '../common/editor/project-feature-requirements.ts'
import {
	SOUNDSCAPER_V23_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile-v23.ts'
import {
	SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION,
	type SoundscaperProjectV23,
} from './editor-project-v23.ts'
import { validateSoundscaperProjectV23 } from './editor-project-v23-validation.ts'

export interface SoundscaperProjectFeatureCompatibilityServiceV23 {
	readonly evaluate: (project: unknown) => ProjectFeatureRequirementsReport | null
}

/** Evaluate only exact V23 documents against the selected Soundscaper capability set. */
export function createSoundscaperProjectFeatureCompatibilityServiceV23():
Readonly<SoundscaperProjectFeatureCompatibilityServiceV23> {
	const capability = editorProjectFeatureCapabilityProfileDefinition(
		SOUNDSCAPER_V23_PROJECT_FEATURE_CAPABILITY_PROFILE,
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
			|| descriptor.value !== SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION) return null
		validateSoundscaperProjectV23(project)
		const exact = project as SoundscaperProjectV23
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
