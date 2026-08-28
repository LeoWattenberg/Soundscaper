/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AutomationLaneV21 } from '../common/editor/automation-lane-v21.ts';
import {
	normalizeAssistanceAssetReferencesV1,
	validateAssistanceAssetSourceBindingsV1,
	type AssistanceAssetReferenceV1,
} from '../common/editor/assistance/assistance-asset-reference-v1.ts';
import { readClosedDomainField } from '../common/editor/closed-domain-value.ts';
import {
	MASTERING_SEQUENCE_LIMITS,
	createMasteringSequenceV23,
	type MasteringSequenceV23,
} from '../common/editor/mastering-sequence.ts';
import type { MixerGraphV21 } from '../common/editor/mixer-graph-v21.ts';
import type { ProjectHierarchyDocument } from '../common/editor/project-hierarchy-document-validation.ts';
import {
	PROJECT_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	readProjectSchemaIdentity,
} from '../common/editor/project-schema-identity.ts';
import type { TakeCompDocumentGroup } from '../common/editor/take-comp-document-v17.ts';
import {
	normalizeSoundscaperNativePluginStates,
	type SoundscaperNativePluginState,
} from './editor-native-plugin-state.ts';
import {
	SOUNDSCAPER_PRODUCTION_PROJECT_FIELDS,
	validateSoundscaperProductionProject,
} from './editor-project-production-validation.ts';
import { validateSoundscaperProjectFeatureRequirements } from './editor-project-feature-requirements.ts';

export {
	PROJECT_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
} from '../common/editor/project-schema-identity.ts';

export const SOUNDSCAPER_PROJECT_FIELDS = Object.freeze([
	'schemaFamily',
	...SOUNDSCAPER_PRODUCTION_PROJECT_FIELDS,
	'masteringSequences',
	'nativePluginStates',
	'assistanceAssets',
] as const);

export interface SoundscaperProject extends ProjectHierarchyDocument {
	readonly schemaFamily: typeof SOUNDSCAPER_PROJECT_SCHEMA_FAMILY;
	readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
	readonly automationLanes: readonly AutomationLaneV21[];
	readonly mixer: MixerGraphV21;
	readonly takeGroups: readonly TakeCompDocumentGroup[];
	readonly masteringSequences: readonly MasteringSequenceV23[];
	readonly nativePluginStates: readonly Readonly<SoundscaperNativePluginState>[];
	readonly assistanceAssets: readonly Readonly<AssistanceAssetReferenceV1>[];
}

/** Validate the complete Soundscaper 1.0 project authority. */
export function validateSoundscaperProject(project: unknown): project is SoundscaperProject {
	const identity = readProjectSchemaIdentity(project);
	if (identity.schemaFamily !== SOUNDSCAPER_PROJECT_SCHEMA_FAMILY
		|| identity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new RangeError('The exact Soundscaper project schema identity is required.');
	}
	validateSoundscaperProductionProject(project, {
		schemaVersion: PROJECT_SCHEMA_VERSION,
		label: 'Soundscaper project',
		projectFields: SOUNDSCAPER_PROJECT_FIELDS,
		validateAdditions,
		validateFeatureRequirements: validateSoundscaperProjectFeatureRequirements,
	});
	return true;
}

/** Normalize the persisted mastering collection and its stable wire. */
export function normalizeSoundscaperMasteringSequences(value: unknown): readonly MasteringSequenceV23[] {
	if (!Array.isArray(value)) throw new TypeError('project.masteringSequences must be an array');
	if (value.length > MASTERING_SEQUENCE_LIMITS.maximumEntries) {
		throw new RangeError('project.masteringSequences exceeds its maximum count');
	}
	const sequences = value.map((sequence) => createMasteringSequenceV23(sequence));
	const seen = new Set<string>();
	for (const sequence of sequences) {
		if (seen.has(sequence.id)) {
			throw new RangeError(`Mastering sequence ${sequence.id} is listed more than once`);
		}
		seen.add(sequence.id);
	}
	return Object.freeze(sequences);
}

function validateAdditions(project: Record<string, unknown>): void {
	const masteringSequences = normalizeSoundscaperMasteringSequences(
		readClosedDomainField(project, 'masteringSequences', 'Soundscaper project'),
	);
	const timelineSequenceIds = new Set(
		recordArray(project.sequences, 'project.sequences').map((sequence) => String(sequence.id)),
	);
	for (const sequence of masteringSequences) {
		if (timelineSequenceIds.has(sequence.sequenceId)) continue;
		throw new ReferenceError(
			`Mastering sequence ${sequence.id} references missing timeline sequence ${sequence.sequenceId}`,
		);
	}
	normalizeSoundscaperNativePluginStates(
		readClosedDomainField(project, 'nativePluginStates', 'Soundscaper project'),
	);
	const assets = normalizeAssistanceAssetReferencesV1(
		readClosedDomainField(project, 'assistanceAssets', 'Soundscaper project'),
	);
	validateAssistanceAssetSourceBindingsV1(assets, project.sources);
}

function recordArray(value: unknown, name: string): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
	return value.map((candidate, index) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError(`${name}[${String(index)}] must be an object`);
		}
		return candidate as Readonly<Record<string, unknown>>;
	});
}
