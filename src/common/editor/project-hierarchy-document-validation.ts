/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateAdmProjectChannelCount,
	validateAdmProjectMetadata,
	type AdmProjectMetadata,
} from './adm-project-metadata.ts';
import { normalizeCartMetadata, type CartMetadata, type CartMetadataInput } from './cart-metadata.ts';
import { normalizeIxmlMetadata, type IxmlMetadata, type IxmlMetadataInput } from './ixml.ts';
import {
	validateProjectBextMetadata,
	type ProjectBextMetadata,
} from './project-bext-metadata.ts';
import {
	validateProjectDocument,
	type ProjectAudioAuthorityValidation,
} from './project-document-validation.ts';
import { validateProjectFoundation } from './project-foundation-validation.ts';
import {
	normalizeProjectFeatureRequirements,
	type ProjectFeatureRequirementsManifest,
} from './project-feature-requirements.ts';
import { reconcileProjectOwnedFeatureRequirements } from './project-owned-feature-requirements.ts';
import {
	projectArray,
	projectRecord,
	projectUniqueStrings,
} from './project-validation-primitives.ts';
import type {
	MediaClipLeaf,
	MediaSourceLeaf,
	MediaTrackLeaf,
} from './project-media-types.ts';
import {
	admitAudioEditorProjectValidationStructure,
	resolveAudioEditorProjectValidationLimits,
	type AudioEditorProjectValidationLimits,
} from './project-validation-budget.ts';
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

export interface ProjectHierarchyDocumentValidationOptions {
	readonly limits?: Partial<AudioEditorProjectValidationLimits>;
}

export interface ProjectHierarchySequence extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly trackIds: readonly string[];
	readonly trackNodes: readonly TrackNodeV12[];
}

export interface ProjectHierarchyMetadata extends Readonly<Record<string, unknown>> {
	readonly title: string;
	readonly artist: string;
	readonly album: string;
	readonly trackNumber: string;
	readonly year: string;
	readonly comments: string;
	readonly tags: Readonly<Record<string, string>>;
	readonly bext: ProjectBextMetadata | null;
	readonly ixml?: IxmlMetadata;
	readonly cart?: CartMetadata;
	readonly adm: AdmProjectMetadata | null;
}

/** The schema-neutral document body shared by every current product revision. */
export interface ProjectHierarchyDocument extends Record<string, unknown> {
	readonly schemaVersion: number;
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly sampleRate: number;
	readonly masterChannels: number;
	readonly metadata: ProjectHierarchyMetadata;
	readonly sources: readonly MediaSourceLeaf[];
	readonly clips: readonly MediaClipLeaf[];
	readonly tracks: readonly MediaTrackLeaf[];
	readonly trackFolders: readonly TrackFolderV12[];
	readonly projectBin: Readonly<Record<string, unknown>> & {
		readonly clips: readonly MediaClipLeaf[];
	};
	readonly sequences: readonly ProjectHierarchySequence[];
	readonly primarySequenceId: string;
	readonly tempoMap: HoldTempoMap & Readonly<Record<string, unknown>>;
	readonly signatureMap: Readonly<Record<string, unknown>>;
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
	readonly selection: Readonly<Record<string, unknown>> & {
		readonly annotationIds: readonly string[];
	};
	readonly timelineAnnotations: readonly TimelineAnnotationV11[];
}

/**
 * Validate the exact schema selected by a product while sharing one hierarchy-aware
 * document body. Product validators retain ownership of the expected schema number
 * and any fields layered above this foundation.
 */
export function validateProjectHierarchyDocument(
	project: unknown,
	expectedSchemaVersion: number,
	options: ProjectHierarchyDocumentValidationOptions = {},
	audioAuthority: ProjectAudioAuthorityValidation = {},
): project is ProjectHierarchyDocument {
	if (!Number.isSafeInteger(expectedSchemaVersion) || expectedSchemaVersion < 1) {
		throw new RangeError('Expected project schema version must be a positive safe integer.');
	}
	const limits = resolveAudioEditorProjectValidationLimits(validationLimitOverrides(options));
	admitAudioEditorProjectValidationStructure(project, limits);
	const candidate = projectRecord(project, 'project');
	if (candidate.schemaVersion !== expectedSchemaVersion) {
		throw new RangeError(`Unsupported audio editor schema version: ${String(candidate.schemaVersion)}.`);
	}
	if (Object.hasOwn(candidate, 'runtimeProjectionVersion')
		|| Object.hasOwn(candidate, 'trackFolderStateProjectionVersion')) {
		throw new RangeError('A persisted project cannot contain a runtime projection marker.');
	}
	const { metadata, media } = validateProjectDocument(candidate, audioAuthority);
	validateProjectBextMetadata(metadata);
	if (metadata.ixml != null) normalizeIxmlMetadata(metadata.ixml as IxmlMetadataInput);
	if (metadata.cart != null) normalizeCartMetadata(metadata.cart as CartMetadataInput);
	validateAdmProjectMetadata(metadata);
	validateAdmProjectChannelCount(candidate);
	const sequences = recordArray(candidate.sequences, 'project.sequences');
	const featureRequirements = normalizeProjectFeatureRequirements(candidate.featureRequirements, {
		sources: media.sources,
		clips: media.clips,
		tracks: media.tracks,
		schemaVersion: candidate.schemaVersion,
		sampleRate: candidate.sampleRate,
		sequences,
		primarySequenceId: candidate.primarySequenceId,
	});
	validateProjectFoundation(candidate, media);
	validateTrackFoldersV12(candidate.trackFolders);
	validateTrackHierarchyV12(sequenceHierarchyProjection(sequences), {
		trackFolders: candidate.trackFolders as readonly TrackFolderV12[],
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

function validationLimitOverrides(
	options: ProjectHierarchyDocumentValidationOptions | unknown,
): unknown {
	const candidate = dataRecord(options, 'Project hierarchy validation options');
	for (const key of Object.keys(candidate)) {
		if (key !== 'limits') {
			throw new TypeError(`Unsupported project hierarchy validation option: ${key}.`);
		}
	}
	if (!Object.hasOwn(candidate, 'limits')) return {};
	return dataRecord(candidate.limits, 'Project hierarchy validation limits');
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

function recordArray(value: unknown, name: string): readonly Record<string, unknown>[] {
	return projectArray(value, name).map((entry, index) => (
		projectRecord(entry, `${name}[${String(index)}]`)
	));
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}
