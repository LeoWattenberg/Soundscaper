/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectFeatureRequirementsManifest,
} from '../common/editor/project-feature-requirements.ts';
import {
	rebindSoundscaperProjectFreezeSourceIdentitiesV21,
	soundscaperAudioTrackFreezeRequirementIdV21,
	reconcileSoundscaperProjectFeatureRequirementsV21,
	validateSoundscaperProjectFeatureRequirementsV21,
} from './editor-project-feature-requirements-v21.ts';
import {
	reconcileSoundscaperNativePluginRequirementsV29,
} from './editor-native-plugin-playback-v29.ts'

/**
 * V29's product-owned feature requirements.
 *
 * They are V21's. The audio-freeze requirements a Soundscaper document owns did
 * not change when mastering sequences were added, so this delegates rather than
 * restating them — two copies of a reconciler that must agree exactly is how
 * they stop agreeing.
 *
 * The mastering-sequence requirement itself is not here: it is a *foundation*
 * owned requirement, derived from the document by
 * `reconcileProjectOwnedFeatureRequirements`, because holding a mastering
 * sequence demands the capability regardless of which product owns the file.
 */

type DataRecord = Readonly<Record<string, unknown>>;

const LABEL = 'Soundscaper V29 project';

export function reconcileSoundscaperProjectFeatureRequirementsV29(
	project: DataRecord,
	manifest: ProjectFeatureRequirementsManifest,
): ProjectFeatureRequirementsManifest {
	return reconcileSoundscaperNativePluginRequirementsV29(
		project,
		reconcileSoundscaperProjectFeatureRequirementsV21(project, manifest, LABEL),
	)
}

export function validateSoundscaperProjectFeatureRequirementsV29(project: DataRecord): true {
	validateSoundscaperProjectFeatureRequirementsV21(project, LABEL)
	const reconciled = reconcileSoundscaperProjectFeatureRequirementsV29(
		project,
		project.featureRequirements as ProjectFeatureRequirementsManifest,
	)
	if (JSON.stringify(project.featureRequirements) !== JSON.stringify(reconciled)) {
		throw new RangeError(`${LABEL} native plug-in requirements are not in exact reconciled form.`)
	}
	return true
}

/** Freeze requirement identity and rebinding are unchanged by the revision. */
export const soundscaperAudioTrackFreezeRequirementIdV29 =
	soundscaperAudioTrackFreezeRequirementIdV21;


export const rebindSoundscaperProjectFreezeSourceIdentitiesV29 =
	rebindSoundscaperProjectFreezeSourceIdentitiesV21;
