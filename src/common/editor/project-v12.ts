/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAudioEditorProjectV11,
	type AudioEditorProjectV11Options,
} from './project-v11.ts';
import { normalizeProjectFeatureRequirements } from './project-feature-requirements.ts';
import { reconcileProjectOwnedFeatureRequirements } from './project-owned-feature-requirements.ts';
import {
	AUDIO_EDITOR_PROJECT_V12_SCHEMA_VERSION,
	validateAudioEditorProjectV12,
	type AudioEditorProjectV12,
} from './project-v12-validation.ts';
import { createTrackFoldersV12 } from './track-folder-v12.ts';
import {
	createTrackHierarchyV12,
	createTrackNodesV12,
} from './track-hierarchy-v12.ts';

export { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-schema-version.ts';
export const AUDIO_EDITOR_PROJECT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_V12_SCHEMA_VERSION;
export {
	AUDIO_EDITOR_PROJECT_V12_SCHEMA_VERSION,
	validateAudioEditorProjectV12,
	type AudioEditorProjectV12,
} from './project-v12-validation.ts';

export interface AudioEditorProjectV12Options extends AudioEditorProjectV11Options {
	readonly trackFolders?: readonly unknown[];
}

/** Create the exact current document with V11 annotations and V12 folder hierarchy. */
export function createAudioEditorProjectV12(
	options: AudioEditorProjectV12Options = {},
): AudioEditorProjectV12 {
	const input = options as AudioEditorProjectV12Options & Readonly<Record<string, unknown>>;
	const {
		trackFolders: folderInput = [],
		sequences: sequenceInput,
		...foundationInput
	} = input;
	const sequenceSnapshots = snapshotSequenceInputs(sequenceInput);
	const foundationSequences = prepareFoundationSequences(sequenceSnapshots);
	const foundation = createAudioEditorProjectV11({
		...foundationInput,
		...(foundationSequences === undefined ? {} : { sequences: foundationSequences }),
	});
	const trackFolders = createTrackFoldersV12(folderInput);
	const hierarchy = createTrackHierarchyV12(
		createHierarchyInput(foundation.sequences, sequenceSnapshots),
		{
			trackFolders,
			tracks: foundation.tracks.map((track) => ({
				id: track.id,
				type: track.type,
				...(Object.hasOwn(track, 'laneGroupId') ? { laneGroupId: track.laneGroupId } : {}),
			})),
		},
	);
	const hierarchyBySequenceId = new Map(hierarchy.map((sequence) => [sequence.id, sequence]));
	const sequences = foundation.sequences.map((sequence) => {
		const projection = hierarchyBySequenceId.get(String(sequence.id));
		if (!projection) throw new ReferenceError(`Missing V12 hierarchy for sequence ${String(sequence.id)}.`);
		return {
			...sequence,
			trackNodes: projection.trackNodes,
			trackIds: projection.trackIds,
		};
	});
	const project = {
		...foundation,
		schemaVersion: AUDIO_EDITOR_PROJECT_V12_SCHEMA_VERSION,
		trackFolders,
		sequences,
	} as unknown as AudioEditorProjectV12;
	const featureRequirements = normalizeProjectFeatureRequirements(
		foundation.featureRequirements,
		{
			sources: project.sources,
			clips: project.clips,
			tracks: project.tracks,
			schemaVersion: project.schemaVersion,
			sampleRate: project.sampleRate,
			sequences: project.sequences,
			primarySequenceId: project.primarySequenceId,
		},
	);
	const result = {
		...project,
		featureRequirements: reconcileProjectOwnedFeatureRequirements(project, featureRequirements),
	} as AudioEditorProjectV12;
	validateAudioEditorProjectV12(result);
	return result;
}

export function cloneAudioEditorProjectV12(project: AudioEditorProjectV12): AudioEditorProjectV12 {
	validateAudioEditorProjectV12(project);
	return clone(project);
}

export function loadAudioEditorProjectV12(value: unknown): {
	project: AudioEditorProjectV12 | Record<string, unknown>;
	readOnly: boolean;
	reason: 'newer-schema' | null;
} {
	const candidate = object(value, 'saved project');
	const schemaVersion = projectSchemaVersion(candidate.schemaVersion);
	if (schemaVersion > AUDIO_EDITOR_PROJECT_V12_SCHEMA_VERSION) {
		return { project: clone(candidate), readOnly: true, reason: 'newer-schema' };
	}
	validateAudioEditorProjectV12(candidate);
	return { project: clone(candidate) as AudioEditorProjectV12, readOnly: false, reason: null };
}

function prepareFoundationSequences(
	value: readonly Readonly<Record<string, unknown>>[] | undefined,
): readonly Readonly<Record<string, unknown>>[] | undefined {
	if (value === undefined) return undefined;
	return value.map((sequence) => {
		const { trackNodes, ...foundationSequence } = sequence;
		if (trackNodes === undefined) return foundationSequence;
		const nodes = createTrackNodesV12(trackNodes);
		return {
			...foundationSequence,
			trackIds: nodes.filter(({ kind }) => kind === 'track').map(({ id }) => id),
		};
	});
}

function createHierarchyInput(
	foundationSequences: readonly Readonly<Record<string, unknown>>[],
	inputSequences: readonly Readonly<Record<string, unknown>>[] | undefined,
): readonly Readonly<Record<string, unknown>>[] {
	return foundationSequences.map((foundation, index) => {
		const input = inputSequences && index < inputSequences.length
			? inputSequences[index]!
			: {};
		const trackNodes = Object.hasOwn(input, 'trackNodes')
			? input.trackNodes
			: (foundation.trackIds as readonly string[]).map((id) => ({
				kind: 'track',
				id,
				parentFolderId: null,
			}));
		return {
			id: foundation.id,
			trackNodes,
			...(Object.hasOwn(input, 'trackIds') ? { trackIds: input.trackIds } : {}),
		};
	});
}

function snapshotSequenceInputs(
	value: unknown,
): readonly Readonly<Record<string, unknown>>[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new TypeError('project.sequences must be an array.');
	return value.map((entry, index) => snapshotSequence(entry, `project.sequences[${String(index)}]`));
}

function snapshotSequence(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) {
		throw new TypeError(`${name} must be a plain data object.`);
	}
	const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError(`${name} contains an unsupported field: ${String(key)}.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
		snapshot[key] = descriptor.value;
	}
	return snapshot;
}

function projectSchemaVersion(value: unknown): number {
	if (!Number.isSafeInteger(value)) throw new RangeError('Saved project schema version must be a safe integer.');
	return Number(value);
}

function object(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
