/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AutomationLaneV21 } from '../common/editor/automation-lane-v21.ts'
import type { AudioTrackFreezeV1 } from '../common/editor/audio-track-freeze-v21.ts'
import type { MixerGraphV21 } from '../common/editor/mixer-graph-v21.ts'
import type { AudioEditorFolderHierarchyDocument } from '../common/editor/project-v12-validation.ts'
import { SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION } from '../common/editor/project-schema-version.ts'
import type { TakeCompDocumentGroup } from '../common/editor/take-comp-document-v17.ts'
import {
	SOUNDSCAPER_PRODUCTION_PROJECT_FIELDS,
	validateSoundscaperProductionProject,
} from './editor-project-production-validation.ts'
import { validateSoundscaperProjectFeatureRequirementsV21 } from './editor-project-feature-requirements-v21.ts'

export { SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION } from '../common/editor/project-schema-version.ts'

export interface SoundscaperProjectV21 extends AudioEditorFolderHierarchyDocument {
	readonly schemaVersion: 21
	readonly automationLanes: readonly AutomationLaneV21[]
	readonly mixer: MixerGraphV21
	readonly takeGroups: readonly TakeCompDocumentGroup[]
}

export interface SoundscaperAudioTrackV21 extends Readonly<Record<string, unknown>> {
	readonly type: 'audio'
	readonly audioFreeze?: AudioTrackFreezeV1
}

/**
 * Validate exact Soundscaper V21 authority.
 *
 * Exact is the point: a V21 validator accepts V21 and nothing else, which is why
 * this names its revision while shared code asks
 * `isSoundscaperProductionProjectSchema` instead. The relationship checks
 * themselves live in the shared production validator so V21 and V23 cannot drift
 * apart about what a valid document is.
 */
export function validateSoundscaperProjectV21(project: unknown): project is SoundscaperProjectV21 {
	validateSoundscaperProductionProject(project, {
		schemaVersion: SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
		label: 'Soundscaper V21 project',
		projectFields: SOUNDSCAPER_PRODUCTION_PROJECT_FIELDS,
		validateFeatureRequirements: validateSoundscaperProjectFeatureRequirementsV21,
	})
	return true
}
