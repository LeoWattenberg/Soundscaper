/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeProjectFeatureRequirements } from './project-feature-requirements.ts';
import { reconcileProjectOwnedFeatureRequirements } from './project-owned-feature-requirements.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-schema-version.ts';
import { reconcileProjectV10CommandResult } from './project-v10-command-projection.ts';
import { validateAudioEditorProjectV10 } from './project-v10-validation.ts';
import {
	resolveRuntimeProjectProjection,
	type RuntimeClipProject,
} from './runtime-clip-projection.ts';

type DataRecord = Record<string, unknown>;

/** Resolve authoritative project timing into the transient coordinates shared consumers expect. */
export function projectForRuntimeConsumers(project: RuntimeClipProject): RuntimeClipProject {
	return project.runtimeProjectionVersion
		? project
		: resolveRuntimeProjectProjection(project);
}

/** Restore authoritative coordinates and owned capability declarations after a command mutation. */
export function preparePersistedProjectCommandDraft(draft: DataRecord, persistedBase: DataRecord): void {
	if (draft.schemaVersion === AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		reconcileProjectV10CommandResult(draft, persistedBase);
	}
	if (Number(draft.schemaVersion) < 9) return;
	const sources = recordArray(draft.sources, 'project.sources');
	const clips = recordArray(draft.clips, 'project.clips');
	const tracks = recordArray(draft.tracks, 'project.tracks');
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		normalizeProjectFeatureRequirements(draft.featureRequirements, { sources, clips, tracks }),
	);
}

/** Validate the current project generation while allowing legacy validators to handle older schemas. */
export function validateCurrentAudioEditorProject(project: unknown): boolean {
	if (!project || typeof project !== 'object' || Array.isArray(project)) return false;
	const candidate = project as Readonly<Record<string, unknown>>;
	return candidate.schemaVersion === AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION
		? validateAudioEditorProjectV10(candidate)
		: false;
}

export function validateLegacyProjectFeatureRequirements(project: Readonly<Record<string, unknown>>): boolean {
	const sources = recordArray(project.sources, 'project.sources');
	const clips = recordArray(project.clips, 'project.clips');
	const tracks = recordArray(project.tracks, 'project.tracks');
	normalizeProjectFeatureRequirements(project.featureRequirements, { sources, clips, tracks });
	return true;
}

function recordArray(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError(`${name}[${String(index)}] must be an object.`);
		}
		return candidate as DataRecord;
	});
}
