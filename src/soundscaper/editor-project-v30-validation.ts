/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AutomationLaneV21 } from '../common/editor/automation-lane-v21.ts';
import {
	normalizeAssistanceAssetReferencesV1,
	validateAssistanceAssetSourceBindingsV1,
	type AssistanceAssetReferenceV1,
} from '../common/editor/assistance/assistance-asset-reference-v1.ts';
import { readClosedDomainField } from '../common/editor/closed-domain-value.ts';
import type { MasteringSequenceV23 } from '../common/editor/mastering-sequence.ts';
import type { MixerGraphV21 } from '../common/editor/mixer-graph-v21.ts';
import type { ProjectHierarchyDocument } from '../common/editor/project-hierarchy-document-validation.ts';
import { SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION } from '../common/editor/project-schema-version.ts';
import type { TakeCompDocumentGroup } from '../common/editor/take-comp-document-v17.ts';
import {
	normalizeSoundscaperNativePluginStatesV29,
	type SoundscaperNativePluginStateV29,
} from './editor-native-plugin-state-v29.ts';
import {
	validateSoundscaperProjectFeatureRequirementsV30,
} from './editor-project-feature-requirements-v30.ts';
import {
	SOUNDSCAPER_V29_PROJECT_FIELDS,
	normalizeMasteringSequencesV29,
} from './editor-project-v29-validation.ts';
import {
	validateSoundscaperProductionProject,
} from './editor-project-production-validation.ts';

export { SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION } from '../common/editor/project-schema-version.ts';

export const SOUNDSCAPER_V30_PROJECT_FIELDS = Object.freeze([
	...SOUNDSCAPER_V29_PROJECT_FIELDS,
	'assistanceAssets',
] as const);

export interface SoundscaperProjectV30 extends ProjectHierarchyDocument {
	readonly schemaVersion: 30;
	readonly automationLanes: readonly AutomationLaneV21[];
	readonly mixer: MixerGraphV21;
	readonly takeGroups: readonly TakeCompDocumentGroup[];
	readonly masteringSequences: readonly MasteringSequenceV23[];
	readonly nativePluginStates: readonly Readonly<SoundscaperNativePluginStateV29>[];
	readonly assistanceAssets: readonly Readonly<AssistanceAssetReferenceV1>[];
}

/** Validate exact Soundscaper V30 authority and every external-body source binding. */
export function validateSoundscaperProjectV30(project: unknown): project is SoundscaperProjectV30 {
	validateSoundscaperProductionProject(project, {
		schemaVersion: SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION,
		label: 'Soundscaper V30 project',
		projectFields: SOUNDSCAPER_V30_PROJECT_FIELDS,
		validateAdditions: validateV30Additions,
		validateFeatureRequirements: validateSoundscaperProjectFeatureRequirementsV30,
	});
	return true;
}

function validateV30Additions(project: Record<string, unknown>): void {
	validateMasteringSequenceBindings(project);
	normalizeSoundscaperNativePluginStatesV29(
		readClosedDomainField(project, 'nativePluginStates', 'Soundscaper V30 project'),
	);
	const assets = normalizeAssistanceAssetReferencesV1(
		readClosedDomainField(project, 'assistanceAssets', 'Soundscaper V30 project'),
	);
	validateAssistanceAssetSourceBindingsV1(assets, project.sources);
}

function validateMasteringSequenceBindings(project: Record<string, unknown>): void {
	const masteringSequences = normalizeMasteringSequencesV29(
		readClosedDomainField(project, 'masteringSequences', 'Soundscaper V30 project'),
	);
	if (masteringSequences.length === 0) return;
	const sequences = recordArray(project.sequences, 'project.sequences');
	const sequenceIds = new Set(sequences.map((sequence) => String(sequence.id)));
	for (const sequence of masteringSequences) {
		if (sequenceIds.has(sequence.sequenceId)) continue;
		throw new ReferenceError(
			`Mastering sequence ${sequence.id} references missing timeline sequence ${sequence.sequenceId}`,
		);
	}
}

function recordArray(
	value: unknown,
	name: string,
): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
	return value.map((candidate, index) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError(`${name}[${String(index)}] must be an object`);
		}
		return candidate as Readonly<Record<string, unknown>>;
	});
}
