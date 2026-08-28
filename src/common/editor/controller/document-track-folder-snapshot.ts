/* SPDX-License-Identifier: AGPL-3.0-only */

import { isActiveAudioEditorProjectSchema } from '../project-schema-version.ts';
import {
	deriveTrackFolderStateProjectionV12,
	type TrackFolderStateNodeV12,
} from '../track-folder-state-projection.ts';

export interface DocumentTrackFolderSequenceSnapshot {
	readonly sequenceId: string;
	readonly rows: readonly TrackFolderStateNodeV12[];
}

export interface DocumentTrackFolderSnapshot {
	readonly structuralSoloActive: boolean;
	readonly sequences: readonly DocumentTrackFolderSequenceSnapshot[];
}

const EMPTY_SNAPSHOT: DocumentTrackFolderSnapshot = Object.freeze({
	structuralSoloActive: false,
	sequences: Object.freeze([]),
});

/**
 * UI-facing folder rows for active audio-authoring schemas: per-sequence flattened
 * hierarchy state carrying depth, ancestors, collapse suppression, audio
 * descendants, and effective audibility. Older, future, or hostile documents
 * yield the empty snapshot without traversing any folder state.
 */
export function createDocumentTrackFolderSnapshot(value: unknown): DocumentTrackFolderSnapshot {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_SNAPSHOT;
	const candidate = value as Readonly<{
		schemaVersion?: unknown;
		trackFolders?: unknown;
		tracks?: unknown;
		sequences?: unknown;
	}>;
	if (!isActiveAudioEditorProjectSchema(candidate)) return EMPTY_SNAPSHOT;
	if (!Array.isArray(candidate.trackFolders) || candidate.trackFolders.length === 0) return EMPTY_SNAPSHOT;
	if (!Array.isArray(candidate.sequences) || !Array.isArray(candidate.tracks)) return EMPTY_SNAPSHOT;
	const projection = deriveTrackFolderStateProjectionV12(
		candidate.sequences.map((sequence) => {
			const record = sequence as Readonly<Record<string, unknown>>;
			return { id: record.id, trackNodes: record.trackNodes, trackIds: record.trackIds };
		}),
		{ trackFolders: candidate.trackFolders, tracks: candidate.tracks },
	);
	return Object.freeze({
		structuralSoloActive: projection.structuralSoloActive,
		sequences: Object.freeze(projection.sequences.map((sequence) => Object.freeze({
			sequenceId: sequence.sequenceId,
			rows: sequence.nodes,
		}))),
	});
}
