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
import { validateProjectV9Document } from './project-v9-document-validation.ts';
import { AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION } from './project-schema-version.ts';
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

export { AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION } from './project-schema-version.ts';

export interface AudioEditorProjectV11ValidationOptions {
	readonly limits?: Partial<AudioEditorProjectV9ValidationLimits>;
}

export interface AudioEditorProjectV11 extends Record<string, unknown> {
	readonly schemaVersion: 11;
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
	readonly projectBin: Readonly<Record<string, unknown>> & {
		readonly clips: readonly Readonly<Record<string, unknown>>[];
	};
	readonly sequences: readonly Readonly<Record<string, unknown>>[];
	readonly primarySequenceId: string;
	readonly tempoMap: HoldTempoMap & Readonly<Record<string, unknown>>;
	readonly signatureMap: Readonly<Record<string, unknown>>;
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
	readonly selection: Readonly<Record<string, unknown>> & {
		readonly annotationIds: readonly string[];
	};
	readonly timelineAnnotations: readonly TimelineAnnotationV11[];
}

/** Validate the exact V11 persistence document without constructing runtime projections. */
export function validateAudioEditorProjectV11(
	project: unknown,
	options: AudioEditorProjectV11ValidationOptions = {},
): project is AudioEditorProjectV11 {
	if (!options || typeof options !== 'object' || Array.isArray(options)) {
		throw new TypeError('Audio editor project V11 validation options must be an object.');
	}
	for (const name of Object.keys(options)) if (name !== 'limits') {
		throw new TypeError(`Unsupported audio editor project V11 validation option: ${name}.`);
	}
	const limits = resolveAudioEditorProjectV9ValidationLimits(options.limits ?? {});
	admitAudioEditorProjectV9ValidationStructure(project, limits);
	const candidate = projectRecord(project, 'project');
	if (candidate.schemaVersion !== AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported audio editor schema version: ${String(candidate.schemaVersion)}.`);
	}
	if (Object.hasOwn(candidate, 'runtimeProjectionVersion')) {
		throw new RangeError('A persisted project cannot contain a runtime projection marker.');
	}
	const { metadata, media } = validateProjectV9Document(candidate);
	validateProjectBextMetadata(metadata);
	if (metadata.ixml != null) normalizeIxmlMetadata(metadata.ixml as IxmlMetadataInput);
	if (metadata.cart != null) normalizeCartMetadata(metadata.cart as CartMetadataInput);
	validateAdmProjectMetadata(metadata);
	validateAdmProjectChannelCount(candidate);
	const featureRequirements = normalizeProjectFeatureRequirements(candidate.featureRequirements, {
		sources: media.sources,
		clips: media.clips,
		tracks: media.tracks,
		schemaVersion: candidate.schemaVersion,
		sampleRate: candidate.sampleRate,
		sequences: candidate.sequences as readonly Readonly<Record<string, unknown>>[],
		primarySequenceId: candidate.primarySequenceId,
	});
	validateProjectV10Foundation(candidate, media);
	const sequences = candidate.sequences as readonly Readonly<Record<string, unknown>>[];
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
