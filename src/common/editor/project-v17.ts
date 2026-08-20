/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeProjectFeatureRequirements } from './project-feature-requirements.ts';
import { reconcileProjectOwnedFeatureRequirements } from './project-owned-feature-requirements.ts';
import { AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION } from './project-schema-version.ts';
import {
	createProjectFoundation,
	type ProjectFoundationOptions,
} from './project-foundation-factory.ts';
import {
	createProjectRetimeFoundation,
	type ProjectRetimeFoundationOptions,
} from './project-retime-factory.ts';
import {
	createProjectStructureFoundation,
	type ProjectStructureFoundationOptions,
} from './project-structure-factory.ts';
import {
	validateAudioEditorProjectV17,
	type AudioEditorProjectV17,
} from './project-v17-validation.ts';
import { createTakeCompDocumentGroupsV17 } from './take-comp-document-v17.ts';

export { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-schema-version.ts';
export const AUDIO_EDITOR_PROJECT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION;
export {
	AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION,
	validateAudioEditorProjectV17,
	type AudioEditorProjectV17,
} from './project-v17-validation.ts';

export interface AudioEditorProjectV17Options
	extends ProjectFoundationOptions, ProjectStructureFoundationOptions, ProjectRetimeFoundationOptions {
	readonly takeGroups?: readonly unknown[];
}

/** Create the exact current document with canonical take/comp ownership. */
export function createAudioEditorProjectV17(
	options: AudioEditorProjectV17Options = {},
): AudioEditorProjectV17 {
	const { takeGroups: takeGroupInput = [], ...foundationOptions } = options;
	const foundation = createProjectRetimeFoundation(
		foundationOptions,
		(retimeOptions) => createProjectStructureFoundation(
			retimeOptions,
			createProjectFoundation,
		),
	) as unknown as Record<string, unknown>;
	const draft: Record<string, unknown> = {
		...foundation,
		schemaVersion: AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION,
		takeGroups: [],
	};
	draft.takeGroups = createTakeCompDocumentGroupsV17(takeGroupInput, draft);
	const sources = recordArray(draft.sources, 'project.sources');
	const clips = recordArray(draft.clips, 'project.clips');
	const tracks = recordArray(draft.tracks, 'project.tracks');
	const sequences = recordArray(draft.sequences, 'project.sequences');
	const featureRequirements = normalizeProjectFeatureRequirements(draft.featureRequirements, {
		sources,
		clips,
		tracks,
		schemaVersion: draft.schemaVersion,
		sampleRate: draft.sampleRate,
		sequences,
		primarySequenceId: draft.primarySequenceId,
	});
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(draft, featureRequirements);
	validateAudioEditorProjectV17(draft);
	return draft as unknown as AudioEditorProjectV17;
}

export function cloneAudioEditorProjectV17(project: AudioEditorProjectV17): AudioEditorProjectV17 {
	validateAudioEditorProjectV17(project);
	return clone(project);
}

export function loadAudioEditorProjectV17(value: unknown): {
	project: AudioEditorProjectV17 | Record<string, unknown>;
	readOnly: boolean;
	reason: 'newer-schema' | null;
} {
	const candidate = dataRecord(value, 'saved project');
	const schemaVersion = candidate.schemaVersion;
	if (!Number.isSafeInteger(schemaVersion)) {
		throw new RangeError('Saved project schema version must be a safe integer.');
	}
	if (Number(schemaVersion) > AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION) {
		return { project: clone(candidate), readOnly: true, reason: 'newer-schema' };
	}
	validateAudioEditorProjectV17(candidate);
	return { project: clone(candidate), readOnly: false, reason: null };
}

function recordArray(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => dataRecord(candidate, `${name}[${String(index)}]`));
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
