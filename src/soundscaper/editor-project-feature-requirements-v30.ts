/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectFeatureRequirementsManifest,
} from '../common/editor/project-feature-requirements.ts';
import {
	rebindSoundscaperProjectFreezeSourceIdentitiesV29,
	reconcileSoundscaperProjectFeatureRequirementsV29,
	soundscaperAudioTrackFreezeRequirementIdV29,
} from './editor-project-feature-requirements-v29.ts';
import {
	validateSoundscaperProjectFeatureRequirementsV21,
} from './editor-project-feature-requirements-v21.ts';

type DataRecord = Readonly<Record<string, unknown>>;

const LABEL = 'Soundscaper V30 project';

/** V30 adds a foundation-owned requirement; product-owned native/freeze state is inherited. */
export function reconcileSoundscaperProjectFeatureRequirementsV30(
	project: DataRecord,
	manifest: ProjectFeatureRequirementsManifest,
): ProjectFeatureRequirementsManifest {
	return reconcileSoundscaperProjectFeatureRequirementsV29(project, manifest);
}

export function validateSoundscaperProjectFeatureRequirementsV30(project: DataRecord): true {
	validateSoundscaperProjectFeatureRequirementsV21(project, LABEL);
	const reconciled = reconcileSoundscaperProjectFeatureRequirementsV30(
		project,
		project.featureRequirements as ProjectFeatureRequirementsManifest,
	);
	if (JSON.stringify(project.featureRequirements) !== JSON.stringify(reconciled)) {
		throw new RangeError(`${LABEL} native plug-in requirements are not in exact reconciled form.`);
	}
	return true;
}

export const soundscaperAudioTrackFreezeRequirementIdV30 =
	soundscaperAudioTrackFreezeRequirementIdV29;

export const rebindSoundscaperProjectFreezeSourceIdentitiesV30 =
	rebindSoundscaperProjectFreezeSourceIdentitiesV29;
