/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AutomationLaneV21 } from '../common/editor/automation-lane-v21.ts'
import { readClosedDomainField } from '../common/editor/closed-domain-value.ts'
import {
	MASTERING_SEQUENCE_LIMITS,
	createMasteringSequenceV23,
	type MasteringSequenceV23,
} from '../common/editor/mastering-sequence.ts'
import type { MixerGraphV21 } from '../common/editor/mixer-graph-v21.ts'
import type { ProjectHierarchyDocument } from '../common/editor/project-hierarchy-document-validation.ts'
import { SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION } from '../common/editor/project-schema-version.ts'
import type { TakeCompDocumentGroup } from '../common/editor/take-comp-document-v17.ts'
import {
	SOUNDSCAPER_PRODUCTION_PROJECT_FIELDS,
	validateSoundscaperProductionProject,
} from './editor-project-production-validation.ts'
import { validateSoundscaperProjectFeatureRequirementsV29 } from './editor-project-feature-requirements-v29.ts'
import {
	normalizeSoundscaperNativePluginStatesV29,
	type SoundscaperNativePluginStateV29,
} from './editor-native-plugin-state-v29.ts'

export { SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION } from '../common/editor/project-schema-version.ts'

/**
 * The V29 document: V21 plus mastering sequences.
 *
 * The revision adds exactly one root field. Its whole reason for existing is
 * that adding persisted state requires a revision — the sequence semantics
 * themselves are schema-neutral and live in `mastering-sequence.ts`, so this
 * file decides only where the state lives and what makes it valid *inside a
 * document*: identity uniqueness, and that every sequence names a timeline
 * sequence the project actually has.
 *
 * What it deliberately does not check is whether each entry's region still
 * exists. That is a relationship between the document and its annotations which
 * changes as the operator edits, and a document that refused to load because a
 * region was deleted would be a project the user could not open to repair.
 * `validateMasteringSequenceV29` reports it instead, and delivery refuses on it.
 */
export const SOUNDSCAPER_V29_PROJECT_FIELDS = Object.freeze([
	...SOUNDSCAPER_PRODUCTION_PROJECT_FIELDS,
	'masteringSequences',
	'nativePluginStates',
] as const)

export interface SoundscaperProjectV29 extends ProjectHierarchyDocument {
	readonly schemaVersion: 29
	readonly automationLanes: readonly AutomationLaneV21[]
	readonly mixer: MixerGraphV21
	readonly takeGroups: readonly TakeCompDocumentGroup[]
	readonly masteringSequences: readonly MasteringSequenceV23[]
	readonly nativePluginStates: readonly Readonly<SoundscaperNativePluginStateV29>[]
}

/** Validate exact Soundscaper V29 authority. */
export function validateSoundscaperProjectV29(project: unknown): project is SoundscaperProjectV29 {
	validateSoundscaperProductionProject(project, {
		schemaVersion: SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION,
		label: 'Soundscaper V29 project',
		projectFields: SOUNDSCAPER_V29_PROJECT_FIELDS,
		validateAdditions: validateV29Additions,
		validateFeatureRequirements: validateSoundscaperProjectFeatureRequirementsV29,
	})
	return true
}

/** Normalize the persisted collection, refusing anything the document model rejects. */
export function normalizeMasteringSequencesV29(value: unknown): readonly MasteringSequenceV23[] {
	if (!Array.isArray(value)) throw new TypeError('project.masteringSequences must be an array')
	if (value.length > MASTERING_SEQUENCE_LIMITS.maximumEntries) {
		throw new RangeError('project.masteringSequences exceeds its maximum count')
	}
	const sequences = value.map((sequence) => createMasteringSequenceV23(sequence))
	const seen = new Set<string>()
	for (const sequence of sequences) {
		if (seen.has(sequence.id)) {
			throw new RangeError(`Mastering sequence ${sequence.id} is listed more than once`)
		}
		seen.add(sequence.id)
	}
	return Object.freeze(sequences)
}

function validateV29Additions(project: Record<string, unknown>): void {
	validateMasteringSequences(project)
	normalizeSoundscaperNativePluginStatesV29(
		readClosedDomainField(project, 'nativePluginStates', 'Soundscaper V29 project'),
	)
}

function validateMasteringSequences(project: Record<string, unknown>): void {
	const sequences = normalizeMasteringSequencesV29(
		readClosedDomainField(project, 'masteringSequences', 'Soundscaper V29 project'),
	)
	if (sequences.length === 0) return
	const timelineSequenceIds = new Set(
		recordArray(project.sequences, 'project.sequences').map((sequence) => String(sequence.id)),
	)
	for (const sequence of sequences) {
		if (timelineSequenceIds.has(sequence.sequenceId)) continue
		throw new ReferenceError(
			`Mastering sequence ${sequence.id} references missing timeline sequence ${sequence.sequenceId}`,
		)
	}
}

function recordArray(value: unknown, name: string): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`)
	return value.map((candidate, index) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError(`${name}[${index}] must be an object`)
		}
		return candidate as Readonly<Record<string, unknown>>
	})
}
