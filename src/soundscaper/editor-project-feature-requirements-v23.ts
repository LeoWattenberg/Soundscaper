/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectFeatureRequirementsManifest,
} from '../common/editor/project-feature-requirements.ts';
import {
	reconcileSoundscaperProjectFeatureRequirementsV21,
	validateSoundscaperProjectFeatureRequirementsV21,
} from './editor-project-feature-requirements-v21.ts';

/**
 * V23's product-owned feature requirements.
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

const LABEL = 'Soundscaper V23 project';

export function reconcileSoundscaperProjectFeatureRequirementsV23(
	project: DataRecord,
	manifest: ProjectFeatureRequirementsManifest,
): ProjectFeatureRequirementsManifest {
	return reconcileSoundscaperProjectFeatureRequirementsV21(project, manifest, LABEL);
}

export function validateSoundscaperProjectFeatureRequirementsV23(project: DataRecord): true {
	return validateSoundscaperProjectFeatureRequirementsV21(project, LABEL);
}
