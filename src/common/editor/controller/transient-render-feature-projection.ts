/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../project-feature-capabilities.ts';
import type { ProjectFeatureRequirementsManifest } from '../project-feature-requirements.ts';
import { reconcileProjectOwnedFeatureRequirements } from '../project-owned-feature-requirements.ts';

export interface TransientRenderFeatureProject {
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
}

/**
 * Retire document-only freeze authority at the final engine-snapshot boundary.
 * Other publisher declarations survive; compatibility admission has already
 * happened, but an unrelated declaration does not become ours to discard.
 */
export function projectTransientRenderFeatures(project: TransientRenderFeatureProject): void {
	const mutable = project as {
		tracks: Readonly<Record<string, unknown>>[];
		featureRequirements: ProjectFeatureRequirementsManifest;
	};
	mutable.tracks = project.tracks.map((track) => {
		if (!Object.hasOwn(track, 'audioFreeze')) return track;
		const projected = { ...track };
		delete projected.audioFreeze;
		return projected;
	});
	const manifest = Object.freeze({
		schemaVersion: project.featureRequirements.schemaVersion,
		requirements: Object.freeze(project.featureRequirements.requirements.filter(({ featureId }) => (
			featureId !== PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze
		))),
	});
	mutable.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		project as unknown as Readonly<Record<string, unknown>>,
		manifest,
	);
}
