/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared field ordering for Framescaper feature manifests; each owner supplies its admission reads. */

import {
	normalizeProjectFeatureRequirements,
	type NormalizeProjectFeatureRequirementsOptions,
	type ProjectFeatureRequirementsManifest,
} from '../common/editor/project-feature-requirements.ts';

export interface FramescaperFeatureManifestAccessors {
	readonly data: (project: Record<string, unknown>, key: string) => unknown;
	readonly records: (project: Record<string, unknown>, key: string) => readonly Record<string, unknown>[];
}

export function framescaperProjectFeatureManifestContext(
	project: Record<string, unknown>,
	accessors: FramescaperFeatureManifestAccessors,
): NormalizeProjectFeatureRequirementsOptions {
	return {
		sources: accessors.records(project, 'sources'),
		clips: accessors.records(project, 'clips'),
		tracks: accessors.records(project, 'tracks'),
		schemaVersion: accessors.data(project, 'schemaVersion'),
		sampleRate: accessors.data(project, 'sampleRate'),
		sequences: accessors.records(project, 'sequences'),
		primarySequenceId: accessors.data(project, 'primarySequenceId'),
	};
}

export function normalizeFramescaperProjectFeatureManifest(
	project: Record<string, unknown>,
	accessors: FramescaperFeatureManifestAccessors,
): ProjectFeatureRequirementsManifest {
	return normalizeProjectFeatureRequirements(
		accessors.data(project, 'featureRequirements'),
		framescaperProjectFeatureManifestContext(project, accessors),
	);
}
