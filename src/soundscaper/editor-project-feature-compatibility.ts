/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts'
import {
	evaluateProjectFeatureRequirements,
	type ProjectFeatureRequirementsReport,
} from '../common/editor/project-feature-requirements.ts'
import {
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	isCurrentProjectSchemaIdentity,
} from '../common/editor/project-schema-identity.ts'
import {
	SOUNDSCAPER_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile.ts'
import {
	type SoundscaperProject,
} from './editor-project.ts'
import { validateSoundscaperProject } from './editor-project-validation.ts'
import { nativePluginCapabilitySets } from './editor-native-plugin-playback.ts'

export interface SoundscaperProjectFeatureCompatibilityService {
	readonly evaluate: (project: unknown) => ProjectFeatureRequirementsReport | null
}

/** Evaluate only exact baseline documents against the selected Soundscaper capability set. */
export function createSoundscaperProjectFeatureCompatibilityService():
Readonly<SoundscaperProjectFeatureCompatibilityService> {
	const capability = editorProjectFeatureCapabilityProfileDefinition(
		SOUNDSCAPER_PROJECT_FEATURE_CAPABILITY_PROFILE,
	)
	const knownFeatureIds = new Set(capability.registrations.map(({ featureId }) => featureId))
	const availableFeatureIds = new Set(capability.registrations
		.filter(({ available }) => available)
		.map(({ featureId }) => featureId))
	return Object.freeze({ evaluate })

	function evaluate(project: unknown): ProjectFeatureRequirementsReport | null {
		if (!isCurrentProjectSchemaIdentity(project, SOUNDSCAPER_PROJECT_SCHEMA_FAMILY)) return null
		validateSoundscaperProject(project)
		const exact = project as SoundscaperProject
		const native = nativePluginCapabilitySets(exact as unknown as Readonly<Record<string, unknown>>)
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
