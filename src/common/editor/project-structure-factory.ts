/* SPDX-License-Identifier: AGPL-3.0-only */

import { reconcileFolderBusesV13 } from './folder-bus-v13.ts';
import { normalizeProjectFeatureRequirements } from './project-feature-requirements.ts';
import { reconcileProjectOwnedFeatureRequirements } from './project-owned-feature-requirements.ts';
import { reconcileVideoSourceCharacteristicsV14 } from './source-characteristics-v14.ts';
import {
	createTimelineAnnotationsV11,
	type TimelineAnnotationV11,
} from './timeline-annotation.ts';
import type { HoldTempoMap } from './timeline-time.ts';
import { createTrackFoldersV12, type TrackFolderV12 } from './track-folder-v12.ts';
import {
	createTrackHierarchyV12,
	createTrackNodesV12,
	type TrackNodeV12,
} from './track-hierarchy-v12.ts';

type DataRecord = Record<string, unknown>;

export interface ProjectStructureFoundationOptions extends Readonly<DataRecord> {
	readonly timelineAnnotations?: readonly unknown[];
	readonly trackFolders?: readonly unknown[];
	readonly selection?: Readonly<DataRecord> & {
		readonly annotationIds?: readonly string[];
	};
	readonly sequences?: readonly Readonly<DataRecord>[];
}

export interface ProjectStructureTrack extends Readonly<DataRecord> {
	readonly locked: boolean;
}

export interface ProjectStructureSequence extends Readonly<DataRecord> {
	readonly id: string;
	readonly trackIds: readonly string[];
	readonly trackNodes: readonly TrackNodeV12[];
}

export interface ProjectStructureSelection extends Readonly<DataRecord> {
	readonly annotationIds: readonly string[];
}

export interface ProjectStructureFoundation extends DataRecord {
	readonly schemaVersion: number;
	readonly sampleRate: number;
	readonly sources: readonly Readonly<DataRecord>[];
	readonly clips: readonly Readonly<DataRecord>[];
	readonly tracks: readonly ProjectStructureTrack[];
	readonly sequences: readonly ProjectStructureSequence[];
	readonly primarySequenceId: string;
	readonly tempoMap: HoldTempoMap & Readonly<DataRecord>;
	readonly featureRequirements: unknown;
	readonly selection: ProjectStructureSelection;
	readonly timelineAnnotations: readonly TimelineAnnotationV11[];
	readonly trackFolders: readonly TrackFolderV12[];
}

export type ProjectStructureFoundationFactory = (
	options: Readonly<DataRecord>,
) => Readonly<DataRecord>;

/**
 * Add current annotations, hierarchy, folder buses, source characteristics, and
 * track locks to a media/timing foundation without traversing retired schemas.
 */
export function createProjectStructureFoundation(
	options: ProjectStructureFoundationOptions = {},
	foundationFactory: ProjectStructureFoundationFactory,
): ProjectStructureFoundation {
	if (typeof foundationFactory !== 'function') {
		throw new TypeError('Project structure foundation factory must be a function.');
	}
	const input = dataRecord(options, 'project options');
	const annotationValue = optionalDataValue(input, 'timelineAnnotations', 'project options');
	const annotationInput = annotationValue === undefined ? [] : annotationValue;
	const folderValue = optionalDataValue(input, 'trackFolders', 'project options');
	const folderInput = folderValue === undefined ? [] : folderValue;
	const sequenceInput = optionalDataValue(input, 'sequences', 'project options');
	const sequenceSnapshots = snapshotSequenceInputs(sequenceInput);
	const foundationSequences = prepareFoundationSequences(sequenceSnapshots);
	const foundationOptions = withoutKeys(input, [
		'timelineAnnotations',
		'trackFolders',
		'sequences',
	]);
	if (foundationSequences !== undefined) foundationOptions.sequences = foundationSequences;
	const foundation = dataRecord(
		foundationFactory(foundationOptions),
		'project structure foundation',
	);
	const sequences = recordArray(
		dataValue(foundation, 'sequences', 'project'),
		'project.sequences',
	);
	const tracks = recordArray(dataValue(foundation, 'tracks', 'project'), 'project.tracks');
	const timelineAnnotations = createTimelineAnnotationsV11(annotationInput, {
		tempoMap: dataValue(foundation, 'tempoMap', 'project') as HoldTempoMap,
		sampleRate: Number(dataValue(foundation, 'sampleRate', 'project')),
		sequenceIds: sequences.map((sequence) => String(dataValue(sequence, 'id', 'sequence'))),
	});
	const selection = createAnnotationSelection(
		dataValue(foundation, 'selection', 'project'),
		optionalDataValue(input, 'selection', 'project options'),
		timelineAnnotations,
	);
	const trackFolders = createTrackFoldersV12(folderInput);
	const hierarchy = createTrackHierarchyV12(
		createHierarchyInput(sequences, sequenceSnapshots),
		{
			trackFolders,
			tracks: tracks.map((track) => ({
				id: dataValue(track, 'id', 'track'),
				type: dataValue(track, 'type', 'track'),
				...(Object.hasOwn(track, 'laneGroupId') ? { laneGroupId: track.laneGroupId } : {}),
			})),
		},
	);
	const hierarchyBySequenceId = new Map(hierarchy.map((sequence) => [sequence.id, sequence]));
	const structuredSequences = sequences.map((sequence) => {
		const id = String(dataValue(sequence, 'id', 'sequence'));
		const projection = hierarchyBySequenceId.get(id);
		if (!projection) throw new ReferenceError(`Missing project hierarchy for sequence ${id}.`);
		return {
			...sequence,
			trackNodes: projection.trackNodes,
			trackIds: projection.trackIds,
		};
	});
	const lockedTracks = tracks.map((track) => ({
		...track,
		locked: Object.hasOwn(track, 'locked') ? track.locked : false,
	}));
	const project: DataRecord = {
		...foundation,
		selection,
		timelineAnnotations,
		trackFolders,
		sequences: structuredSequences,
		tracks: lockedTracks,
	};
	reconcileFolderBusesV13(project);
	reconcileVideoSourceCharacteristicsV14(project);
	reconcileFeatureRequirements(project, input);
	return project as ProjectStructureFoundation;
}

function prepareFoundationSequences(
	value: readonly Readonly<DataRecord>[] | undefined,
): readonly Readonly<DataRecord>[] | undefined {
	if (value === undefined) return undefined;
	return value.map((sequence) => {
		const foundationSequence = withoutKeys(sequence, ['trackNodes']);
		if (!Object.hasOwn(sequence, 'trackNodes')) return foundationSequence;
		const nodes = createTrackNodesV12(sequence.trackNodes);
		return {
			...foundationSequence,
			trackIds: nodes.filter(({ kind }) => kind === 'track').map(({ id }) => id),
		};
	});
}

function createHierarchyInput(
	foundationSequences: readonly DataRecord[],
	inputSequences: readonly Readonly<DataRecord>[] | undefined,
): readonly Readonly<DataRecord>[] {
	return foundationSequences.map((foundation, index) => {
		const input = inputSequences && index < inputSequences.length
			? inputSequences[index]!
			: {};
		const foundationTrackIds = dataValue(foundation, 'trackIds', 'sequence');
		if (!Array.isArray(foundationTrackIds)) {
			throw new TypeError('sequence.trackIds must be an array.');
		}
		const trackNodes = Object.hasOwn(input, 'trackNodes')
			? input.trackNodes
			: foundationTrackIds.map((id) => ({
				kind: 'track',
				id,
				parentFolderId: null,
			}));
		return {
			id: dataValue(foundation, 'id', 'sequence'),
			trackNodes,
			...(Object.hasOwn(input, 'trackIds') ? { trackIds: input.trackIds } : {}),
		};
	});
}

function createAnnotationSelection(
	foundationValue: unknown,
	inputValue: unknown,
	annotations: readonly Readonly<{ readonly id: string }>[],
): ProjectStructureSelection {
	const foundation = dataRecord(foundationValue, 'project selection');
	const input = inputValue === undefined ? {} : dataRecord(inputValue, 'project selection');
	const value = optionalDataValue(input, 'annotationIds', 'project selection') ?? [];
	if (!Array.isArray(value)) throw new TypeError('selection.annotationIds must be an array.');
	const available = new Set(annotations.map(({ id }) => id));
	const annotationIds: string[] = [];
	const seen = new Set<string>();
	for (const [index, candidate] of value.entries()) {
		if (typeof candidate !== 'string' || !candidate.length) {
			throw new TypeError(
				`selection.annotationIds[${String(index)}] must be a non-empty string.`,
			);
		}
		if (seen.has(candidate)) {
			throw new RangeError('selection.annotationIds cannot contain duplicate IDs.');
		}
		if (!available.has(candidate)) {
			throw new ReferenceError(`Selection references missing annotation ${candidate}.`);
		}
		seen.add(candidate);
		annotationIds.push(candidate);
	}
	return { ...foundation, annotationIds } as ProjectStructureSelection;
}

function snapshotSequenceInputs(
	value: unknown,
): readonly Readonly<DataRecord>[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new TypeError('project.sequences must be an array.');
	return value.map((entry, index) => (
		snapshotSequence(entry, `project.sequences[${String(index)}]`)
	));
}

function snapshotSequence(value: unknown, name: string): Readonly<DataRecord> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) {
		throw new TypeError(`${name} must be a plain data object.`);
	}
	const snapshot: DataRecord = Object.create(null) as DataRecord;
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') {
			throw new TypeError(`${name} contains an unsupported field: ${String(key)}.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
		snapshot[key] = descriptor.value;
	}
	return snapshot;
}

function reconcileFeatureRequirements(project: DataRecord, input: DataRecord): void {
	const sources = recordArray(dataValue(project, 'sources', 'project'), 'project.sources');
	const clips = recordArray(dataValue(project, 'clips', 'project'), 'project.clips');
	const tracks = recordArray(dataValue(project, 'tracks', 'project'), 'project.tracks');
	const sequences = recordArray(dataValue(project, 'sequences', 'project'), 'project.sequences');
	const supplied = optionalDataValue(input, 'featureRequirements', 'project options');
	const featureRequirements = normalizeProjectFeatureRequirements(
		supplied ?? dataValue(project, 'featureRequirements', 'project'),
		{
			sources,
			clips,
			tracks,
			schemaVersion: dataValue(project, 'schemaVersion', 'project'),
			sampleRate: dataValue(project, 'sampleRate', 'project'),
			sequences,
			primarySequenceId: dataValue(project, 'primarySequenceId', 'project'),
		},
	);
	project.featureRequirements = reconcileProjectOwnedFeatureRequirements(project, featureRequirements);
}

function withoutKeys(value: Readonly<DataRecord>, keys: readonly string[]): DataRecord {
	const result = { ...value };
	for (const key of keys) delete result[key];
	return result;
}

function recordArray(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => dataRecord(candidate, `${name}[${String(index)}]`));
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as DataRecord;
}

function dataValue(value: DataRecord, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable data property.`);
	}
	return descriptor.value;
}

function optionalDataValue(value: DataRecord, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable data property.`);
	}
	return descriptor.value;
}
