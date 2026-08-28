/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeProjectFeatureRequirements } from './project-feature-requirements.ts';
import { reconcileProjectOwnedFeatureRequirements } from './project-owned-feature-requirements.ts';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	isBaselineFoundationProject,
	isFoundationProjectSchema,
	isSourceCharacteristicsProjectSchema,
} from './project-schema-version.ts';
import {
	projectForCommand,
	reconcileProjectCommandResult,
} from './project-command-projection.ts';
import { reconcileVideoKeyframeCarriersAfterCommand } from './commands/video-keyframe-command-reconcile.ts';
import { validateAudioEditorProjectV17 } from './project-v17-validation.ts';
import { reconcileVideoSourceCharacteristicsV14 } from './source-characteristics-v14.ts';
import {
	isRuntimeProjectProjection,
	resolveRuntimeProjectProjection,
	type RuntimeClipProject,
} from './runtime-clip-projection.ts';

type DataRecord = Record<string, unknown>;

/** Identify active product documents that carry the shared command foundation. */
export { isFoundationProjectSchema } from './project-schema-version.ts';

/** Resolve authoritative project timing into the transient coordinates shared consumers expect. */
export function projectForRuntimeConsumers(project: RuntimeClipProject): RuntimeClipProject {
	return isRuntimeProjectProjection(project)
		? project
		: resolveRuntimeProjectProjection(project);
}

/** Project the active authoring generation into the transient shape command consumers expect. */
export function projectForCommandConsumers<Project extends DataRecord | null | undefined>(project: Project): Project {
	return isFoundationProjectAuthority(project)
		? projectForCommand(project) as Project
		: project;
}

/** Restore authoritative coordinates and owned capability declarations after a command mutation. */
export function preparePersistedProjectCommandDraft(draft: DataRecord, persistedBase: DataRecord): void {
	if (isFoundationProjectAuthority(draft)) {
		reconcileProjectCommandResult(draft, persistedBase);
		reconcileVideoKeyframeCarriersAfterCommand(draft, persistedBase);
	}
	if (isSourceCharacteristicsProjectSchema(draft)) {
		reconcileVideoSourceCharacteristicsV14(draft);
	}
	const sources = recordArray(draft.sources, 'project.sources');
	const clips = recordArray(draft.clips, 'project.clips');
	const tracks = recordArray(draft.tracks, 'project.tracks');
	const foundationContext = isFoundationProjectAuthority(draft) ? {
		schemaVersion: draft.schemaVersion,
		sampleRate: draft.sampleRate,
		sequences: recordArray(draft.sequences, 'project.sequences'),
		primarySequenceId: draft.primarySequenceId,
	} : {};
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		normalizeProjectFeatureRequirements(draft.featureRequirements, {
			sources,
			clips,
			tracks,
			...foundationContext,
		}),
	);
}

/** Validate the exact current shared project generation. */
export function validateCurrentAudioEditorProject(project: unknown): boolean {
	if (!project || typeof project !== 'object' || Array.isArray(project)) return false;
	const candidate = project as Readonly<Record<string, unknown>>;
	return candidate.schemaVersion === AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION
		? validateAudioEditorProjectV17(candidate)
		: false;
}

export function isFoundationProjectAuthority(
	project: DataRecord | null | undefined,
): project is DataRecord {
	return isBaselineFoundationProject(project) || isFoundationProjectSchema(project);
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
