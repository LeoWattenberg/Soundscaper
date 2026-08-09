/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateAdmProjectChannelCount,
	validateAdmProjectMetadata,
	type AdmProjectMetadata,
} from './adm-project-metadata.ts';
import { type ProjectBextMetadata, validateProjectBextMetadata } from './project-bext-metadata.ts';
import { normalizeCartMetadata, type CartMetadata, type CartMetadataInput } from './cart-metadata.ts';
import { normalizeIxmlMetadata, type IxmlMetadata, type IxmlMetadataInput } from './ixml.ts';
import {
	normalizeProjectFeatureRequirements,
	type ProjectFeatureRequirementsManifest,
} from './project-feature-requirements.ts';
import { validateProjectV9Document } from './project-v9-document-validation.ts';
import { projectRecord } from './project-v9-validation-primitives.ts';
import {
	admitAudioEditorProjectV9ValidationStructure,
	resolveAudioEditorProjectV9ValidationLimits,
	type AudioEditorProjectV9ValidationLimits,
} from './project-v9-validation-budget.ts';

export {
	AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS,
	resolveAudioEditorProjectV9ValidationLimits,
	type AudioEditorProjectV9ValidationLimits,
} from './project-v9-validation-budget.ts';

export interface AudioEditorProjectV9ValidationOptions {
	readonly limits?: Partial<AudioEditorProjectV9ValidationLimits>;
}

export interface AudioEditorProjectMetadataV9 {
	readonly title: string;
	readonly artist: string;
	readonly album: string;
	readonly trackNumber: string;
	readonly year: string;
	readonly comments: string;
	readonly tags: Readonly<Record<string, string>>;
	readonly bext: ProjectBextMetadata | null;
	readonly ixml?: IxmlMetadata | null;
	readonly cart?: CartMetadata | null;
	readonly adm: AdmProjectMetadata | null;
}

export interface AudioEditorProjectV9 extends Record<string, unknown> {
	readonly schemaVersion: 9;
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly sampleRate: number;
	readonly masterChannels: number;
	readonly metadata: AudioEditorProjectMetadataV9;
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly clips: readonly Readonly<Record<string, unknown>>[];
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly projectBin: Readonly<Record<string, unknown>> & {
		readonly clips: readonly Readonly<Record<string, unknown>>[];
	};
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
}

/**
 * Validate the exact current persistence domain without loading migration or
 * editor-runtime factories. This entry is shared by renderer and desktop main.
 */
export function validateAudioEditorProjectV9(
	project: unknown,
	options: AudioEditorProjectV9ValidationOptions = {},
): project is AudioEditorProjectV9 {
	const limits = validationLimits(options);
	admitAudioEditorProjectV9ValidationStructure(project, limits);
	const candidate = projectRecord(project, 'project');
	if (candidate.schemaVersion !== 9) {
		throw new RangeError(`Unsupported audio editor schema version: ${String(candidate.schemaVersion)}.`);
	}
	const { metadata, media } = validateProjectV9Document(candidate);
	validateProjectBextMetadata(metadata);
	if (metadata.ixml != null) normalizeIxmlMetadata(metadata.ixml as IxmlMetadataInput);
	if (metadata.cart != null) normalizeCartMetadata(metadata.cart as CartMetadataInput);
	validateAdmProjectMetadata(metadata);
	validateAdmProjectChannelCount(candidate);
	normalizeProjectFeatureRequirements(candidate.featureRequirements, {
		sources: media.sources,
		clips: media.clips,
		tracks: media.tracks,
	});
	return true;
}

function validationLimits(
	options: AudioEditorProjectV9ValidationOptions,
): Readonly<AudioEditorProjectV9ValidationLimits> {
	if (!options || typeof options !== 'object' || Array.isArray(options)) {
		throw new TypeError('Audio editor project V9 validation options must be an object.');
	}
	for (const name of Object.keys(options)) {
		if (name !== 'limits') {
			throw new TypeError(`Unsupported audio editor project V9 validation option: ${name}.`);
		}
	}
	return resolveAudioEditorProjectV9ValidationLimits(options.limits ?? {});
}
