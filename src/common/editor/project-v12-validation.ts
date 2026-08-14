/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateAdmProjectChannelCount, validateAdmProjectMetadata } from './adm-project-metadata.ts';
import { normalizeCartMetadata, type CartMetadataInput } from './cart-metadata.ts';
import { normalizeIxmlMetadata, type IxmlMetadataInput } from './ixml.ts';
import { validateProjectBextMetadata } from './project-bext-metadata.ts';
import { reconcileProjectOwnedFeatureRequirements } from './project-owned-feature-requirements.ts';
import { validateProjectV10Foundation } from './project-v10-foundation-validation.ts';
import {
	normalizeProjectFeatureRequirements,
	type ProjectFeatureRequirementsManifest,
} from './project-feature-requirements.ts';
import { AUDIO_EDITOR_PROJECT_V12_SCHEMA_VERSION } from './project-schema-version.ts';
import {
	validateProjectV9Document,
	type ProjectV9AudioAuthorityValidation,
} from './project-v9-document-validation.ts';
import { projectRecord, projectUniqueStrings } from './project-v9-validation-primitives.ts';
import {
	admitAudioEditorProjectV9ValidationStructure,
	resolveAudioEditorProjectV9ValidationLimits,
	type AudioEditorProjectV9ValidationLimits,
} from './project-v9-validation-budget.ts';
import {
	validateTimelineAnnotationsV11,
	type TimelineAnnotationV11,
} from './timeline-annotation.ts';
import type { HoldTempoMap } from './timeline-time.ts';
import { validateTrackFoldersV12, type TrackFolderV12 } from './track-folder-v12.ts';
import {
	validateTrackHierarchyV12,
	type TrackNodeV12,
} from './track-hierarchy-v12.ts';

export { AUDIO_EDITOR_PROJECT_V12_SCHEMA_VERSION } from './project-schema-version.ts';

export interface AudioEditorProjectV12ValidationOptions {
	readonly limits?: Partial<AudioEditorProjectV9ValidationLimits>;
}

export interface AudioEditorProjectSequenceV12 extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly trackIds: readonly string[];
	readonly trackNodes: readonly TrackNodeV12[];
}

export interface AudioEditorFolderHierarchyDocument extends Record<string, unknown> {
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly sampleRate: number;
	readonly masterChannels: number;
	readonly metadata: Readonly<Record<string, unknown>>;
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly clips: readonly Readonly<Record<string, unknown>>[];
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly trackFolders: readonly TrackFolderV12[];
	readonly projectBin: Readonly<Record<string, unknown>> & {
		readonly clips: readonly Readonly<Record<string, unknown>>[];
	};
	readonly sequences: readonly AudioEditorProjectSequenceV12[];
	readonly primarySequenceId: string;
	readonly tempoMap: HoldTempoMap & Readonly<Record<string, unknown>>;
	readonly signatureMap: Readonly<Record<string, unknown>>;
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
	readonly selection: Readonly<Record<string, unknown>> & {
		readonly annotationIds: readonly string[];
	};
	readonly timelineAnnotations: readonly TimelineAnnotationV11[];
}

export interface AudioEditorProjectV12 extends AudioEditorFolderHierarchyDocument {
	readonly schemaVersion: 12;
}

/** Validate the exact V12 persistence document and its authoritative folder hierarchy. */
export function validateAudioEditorProjectV12(
	project: unknown,
	options: AudioEditorProjectV12ValidationOptions = {},
): project is AudioEditorProjectV12 {
	if (!options || typeof options !== 'object' || Array.isArray(options)) {
		throw new TypeError('Audio editor project V12 validation options must be an object.');
	}
	for (const name of Object.keys(options)) if (name !== 'limits') {
		throw new TypeError(`Unsupported audio editor project V12 validation option: ${name}.`);
	}
	return validateAudioEditorFolderHierarchyDocument(
		project,
		AUDIO_EDITOR_PROJECT_V12_SCHEMA_VERSION,
		options,
	);
}

/**
 * Shared exact-document body for every schema revision built on the V12 folder
 * hierarchy. The caller supplies the exact version it accepts, so each revision
 * keeps its own exact-version gate without duplicating the document contract.
 */
export function validateAudioEditorFolderHierarchyDocument(
	project: unknown,
	expectedSchemaVersion: number,
	options: AudioEditorProjectV12ValidationOptions = {},
	audioAuthority: ProjectV9AudioAuthorityValidation = {},
): project is AudioEditorProjectV12 {
	const limits = resolveAudioEditorProjectV9ValidationLimits(options.limits ?? {});
	admitAudioEditorProjectV9ValidationStructure(project, limits);
	const candidate = projectRecord(project, 'project');
	if (candidate.schemaVersion !== expectedSchemaVersion) {
		throw new RangeError(`Unsupported audio editor schema version: ${String(candidate.schemaVersion)}.`);
	}
	if (Object.hasOwn(candidate, 'runtimeProjectionVersion')
		|| Object.hasOwn(candidate, 'trackFolderStateProjectionVersion')) {
		throw new RangeError('A persisted project cannot contain a runtime projection marker.');
	}
	const { metadata, media } = validateProjectV9Document(candidate, audioAuthority);
	validateProjectBextMetadata(metadata);
	if (metadata.ixml != null) normalizeIxmlMetadata(metadata.ixml as IxmlMetadataInput);
	if (metadata.cart != null) normalizeCartMetadata(metadata.cart as CartMetadataInput);
	validateAdmProjectMetadata(metadata);
	validateAdmProjectChannelCount(candidate);
	const sequences = candidate.sequences as readonly Readonly<Record<string, unknown>>[];
	const featureRequirements = normalizeProjectFeatureRequirements(candidate.featureRequirements, {
		sources: media.sources,
		clips: media.clips,
		tracks: media.tracks,
		schemaVersion: candidate.schemaVersion,
		sampleRate: candidate.sampleRate,
		sequences,
		primarySequenceId: candidate.primarySequenceId,
	});
	validateProjectV10Foundation(candidate, media);
	validateTrackFoldersV12(candidate.trackFolders);
	validateTrackHierarchyV12(sequenceHierarchyProjection(sequences), {
		trackFolders: candidate.trackFolders,
		tracks: media.tracks.map((track) => ({
			id: track.id,
			type: track.type,
			...(Object.hasOwn(track, 'laneGroupId') ? { laneGroupId: track.laneGroupId } : {}),
		})),
	});
	validateTimelineAnnotationsV11(candidate.timelineAnnotations, {
		tempoMap: candidate.tempoMap as HoldTempoMap,
		sampleRate: Number(candidate.sampleRate),
		sequenceIds: sequences.map((sequence) => String(sequence.id)),
	});
	validateAnnotationSelection(candidate.selection, candidate.timelineAnnotations as readonly TimelineAnnotationV11[]);
	if (reconcileProjectOwnedFeatureRequirements(candidate, featureRequirements) !== featureRequirements) {
		throw new RangeError('Project state and owned feature requirements must agree.');
	}
	return true;
}

function sequenceHierarchyProjection(
	sequences: readonly Readonly<Record<string, unknown>>[],
): readonly Readonly<Record<string, unknown>>[] {
	return sequences.map((sequence) => ({
		id: sequence.id,
		trackNodes: sequence.trackNodes,
		trackIds: sequence.trackIds,
	}));
}

function validateAnnotationSelection(value: unknown, annotations: readonly TimelineAnnotationV11[]): void {
	const selection = projectRecord(value, 'project.selection');
	const annotationIds = projectUniqueStrings(selection.annotationIds, 'selection.annotationIds');
	const available = new Set(annotations.map(({ id }) => id));
	for (const annotationId of annotationIds) {
		if (!available.has(annotationId)) {
			throw new ReferenceError(`Selection references missing annotation ${annotationId}.`);
		}
	}
}
