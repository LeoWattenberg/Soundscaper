/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts'
import {
	evaluateProjectFeatureRequirements,
	type ProjectFeatureRequirementsReport,
} from '../common/editor/project-feature-requirements.ts'
import {
	SOUNDSCAPER_V30_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile-v30.ts'
import {
	SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION,
	type SoundscaperProjectV30,
} from './editor-project-v30.ts'
import { validateSoundscaperProjectV30 } from './editor-project-v30-validation.ts'
import { nativePluginCapabilitySetsV30 } from './editor-native-plugin-playback-v30.ts'

export interface SoundscaperProjectFeatureCompatibilityServiceV30 {
	readonly evaluate: (project: unknown) => ProjectFeatureRequirementsReport | null
}

/** Evaluate only exact V30 documents against the selected Soundscaper capability set. */
export function createSoundscaperProjectFeatureCompatibilityServiceV30():
Readonly<SoundscaperProjectFeatureCompatibilityServiceV30> {
	const capability = editorProjectFeatureCapabilityProfileDefinition(
		SOUNDSCAPER_V30_PROJECT_FEATURE_CAPABILITY_PROFILE,
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
			|| descriptor.value !== SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION) return null
		validateSoundscaperProjectV30(project)
		const exact = project as SoundscaperProjectV30
		const native = nativePluginCapabilitySetsV30(exact as unknown as Readonly<Record<string, unknown>>)
		const exactKnown = new Set([...knownFeatureIds, ...native.known])
		const exactAvailable = new Set([...availableFeatureIds, ...native.available])
		return evaluateProjectFeatureRequirements(exact.featureRequirements, {
			knownFeatureIds: exactKnown,
			availableFeatureIds: exactAvailable,
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
