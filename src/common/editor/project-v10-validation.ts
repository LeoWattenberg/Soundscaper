/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateAdmProjectChannelCount, validateAdmProjectMetadata } from './adm-project-metadata.ts';
import { normalizeCartMetadata, type CartMetadataInput } from './cart-metadata.ts';
import { normalizeIxmlMetadata, type IxmlMetadataInput } from './ixml.ts';
import { validateProjectBextMetadata } from './project-bext-metadata.ts';
import { reconcileProjectOwnedFeatureRequirements } from './project-owned-feature-requirements.ts';
import { validateProjectV10Foundation } from './project-v10-foundation-validation.ts';
import { normalizeProjectFeatureRequirements, type ProjectFeatureRequirementsManifest } from './project-feature-requirements.ts';
import { validateProjectV9Document } from './project-v9-document-validation.ts';
import { projectRecord } from './project-v9-validation-primitives.ts';
import {
	admitAudioEditorProjectV9ValidationStructure,
	resolveAudioEditorProjectV9ValidationLimits,
	type AudioEditorProjectV9ValidationLimits,
} from './project-v9-validation-budget.ts';
import type { HoldTempoMap } from './timeline-time.ts';

export const AUDIO_EDITOR_PROJECT_V10_SCHEMA_VERSION = 10 as const;

export interface AudioEditorProjectV10ValidationOptions {
	readonly limits?: Partial<AudioEditorProjectV9ValidationLimits>;
}

export interface AudioEditorProjectV10 extends Record<string, unknown> {
	readonly schemaVersion: 10;
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
}

export function validateAudioEditorProjectV10(
	project: unknown,
	options: AudioEditorProjectV10ValidationOptions = {},
): project is AudioEditorProjectV10 {
	if (!options || typeof options !== 'object' || Array.isArray(options)) {
		throw new TypeError('Audio editor project V10 validation options must be an object.');
	}
	for (const name of Object.keys(options)) if (name !== 'limits') {
		throw new TypeError(`Unsupported audio editor project V10 validation option: ${name}.`);
	}
	const limits = resolveAudioEditorProjectV9ValidationLimits(options.limits ?? {});
	admitAudioEditorProjectV9ValidationStructure(project, limits);
	const candidate = projectRecord(project, 'project');
	if (candidate.schemaVersion !== AUDIO_EDITOR_PROJECT_V10_SCHEMA_VERSION) {
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
	if (reconcileProjectOwnedFeatureRequirements(candidate, featureRequirements) !== featureRequirements) {
		throw new RangeError('Project state and owned feature requirements must agree.');
	}
	return true;
}
