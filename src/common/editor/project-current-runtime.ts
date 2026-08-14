/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeProjectFeatureRequirements } from './project-feature-requirements.ts';
import { reconcileProjectOwnedFeatureRequirements } from './project-owned-feature-requirements.ts';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
	isSourceCharacteristicsProjectSchema,
} from './project-schema-version.ts';
import {
	projectV10ForCommand,
	reconcileProjectV10CommandResult,
} from './project-v10-command-projection.ts';
import { reconcileVideoKeyframeCarriersAfterCommand } from './commands/video-keyframe-command-reconcile.ts';
import {
	AUDIO_EDITOR_PROJECT_V10_SCHEMA_VERSION,
	validateAudioEditorProjectV10,
} from './project-v10-validation.ts';
import { validateAudioEditorProjectV11 } from './project-v11-validation.ts';
import { validateAudioEditorProjectV17 } from './project-v17-validation.ts';
import { reconcileVideoSourceCharacteristicsV14 } from './source-characteristics-v14.ts';
import {
	isRuntimeProjectProjection,
	resolveRuntimeProjectProjection,
	type RuntimeClipProject,
} from './runtime-clip-projection.ts';

type DataRecord = Record<string, unknown>;

/** V10 introduced the authoritative foundation retained through product-owned V21. */
export function isFoundationProjectSchema(schemaVersion: unknown): boolean {
	return schemaVersion === AUDIO_EDITOR_PROJECT_V10_SCHEMA_VERSION
		|| schemaVersion === AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION
		|| schemaVersion === AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION
		|| schemaVersion === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION;
}

/** Resolve authoritative project timing into the transient coordinates shared consumers expect. */
export function projectForRuntimeConsumers(project: RuntimeClipProject): RuntimeClipProject {
	return isRuntimeProjectProjection(project)
		? project
		: resolveRuntimeProjectProjection(project);
}

/** Project the active authoring generation into the transient shape command consumers expect. */
export function projectForCommandConsumers<Project extends DataRecord | null | undefined>(project: Project): Project {
	return isFoundationProject(project)
		? projectV10ForCommand(project) as Project
		: project;
}

/** Restore authoritative coordinates and owned capability declarations after a command mutation. */
export function preparePersistedProjectCommandDraft(draft: DataRecord, persistedBase: DataRecord): void {
	if (isFoundationProject(draft)) {
		reconcileProjectV10CommandResult(draft, persistedBase);
		reconcileVideoKeyframeCarriersAfterCommand(draft, persistedBase);
	}
	if (isSourceCharacteristicsProjectSchema(draft.schemaVersion)) {
		reconcileVideoSourceCharacteristicsV14(draft);
	}
	if (Number(draft.schemaVersion) < 9) return;
	const sources = recordArray(draft.sources, 'project.sources');
	const clips = recordArray(draft.clips, 'project.clips');
	const tracks = recordArray(draft.tracks, 'project.tracks');
	const foundationContext = isFoundationProject(draft) ? {
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

/** Validate the current project generation while allowing legacy validators to handle older schemas. */
export function validateCurrentAudioEditorProject(project: unknown): boolean {
	if (!project || typeof project !== 'object' || Array.isArray(project)) return false;
	const candidate = project as Readonly<Record<string, unknown>>;
	return candidate.schemaVersion === AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION
		? validateAudioEditorProjectV17(candidate)
		: false;
}

export function validateLegacyProjectFeatureRequirements(project: Readonly<Record<string, unknown>>): boolean {
	if (project.schemaVersion === AUDIO_EDITOR_PROJECT_V10_SCHEMA_VERSION) {
		return validateAudioEditorProjectV10(project);
	}
	if (project.schemaVersion === AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION) {
		return validateAudioEditorProjectV11(project);
	}
	const sources = recordArray(project.sources, 'project.sources');
	const clips = recordArray(project.clips, 'project.clips');
	const tracks = recordArray(project.tracks, 'project.tracks');
	normalizeProjectFeatureRequirements(project.featureRequirements, { sources, clips, tracks });
	return true;
}

function isFoundationProject(project: DataRecord | null | undefined): project is DataRecord {
	return isFoundationProjectSchema(project?.schemaVersion);
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
