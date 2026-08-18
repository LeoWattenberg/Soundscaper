/* SPDX-License-Identifier: AGPL-3.0-only */

import { snapshotInertJsonValue } from '../common/editor/inert-json-snapshot.ts'
import {
	SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION,
} from '../common/editor/project-schema-version.ts'
import { reconcileProjectOwnedFeatureRequirements } from '../common/editor/project-owned-feature-requirements.ts'
import {
	createSoundscaperProjectV21,
	cloneSoundscaperProjectV21,
	type SoundscaperProjectV21Options,
} from './editor-project-v21.ts'
import {
	normalizeMasteringSequencesV23,
	validateSoundscaperProjectV23,
	type SoundscaperProjectV23,
} from './editor-project-v23-validation.ts'
import { reconcileSoundscaperProjectFeatureRequirementsV23 } from './editor-project-feature-requirements-v23.ts'

export {
	SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION,
	validateSoundscaperProjectV23,
	type SoundscaperProjectV23,
} from './editor-project-v23-validation.ts'

/**
 * The exact V23 document: V21 plus mastering sequences.
 *
 * It is composed on V21's factory the same way V21 is composed on V17's, so the
 * revision owns the one field it adds and inherits everything else by
 * construction rather than by a copy that can drift.
 */

export interface SoundscaperProjectV23Options extends SoundscaperProjectV21Options {
	readonly masteringSequences?: readonly unknown[]
}

export interface LoadedSoundscaperProjectV23 {
	readonly project: SoundscaperProjectV23 | Readonly<Record<string, unknown>>
	readonly readOnly: boolean
	readonly intrinsicReadOnly: boolean
	readonly reason: 'newer-schema' | null
}

export class SoundscaperProjectV23ReimportRequiredError extends RangeError {
	readonly sourceSchemaVersion: number
	readonly currentSchemaVersion = SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION

	constructor(sourceSchemaVersion: number) {
		super(`Soundscaper schema V${sourceSchemaVersion} requires re-import into exact V23 authority`)
		this.name = 'SoundscaperProjectV23ReimportRequiredError'
		this.sourceSchemaVersion = sourceSchemaVersion
	}
}

export function createSoundscaperProjectV23(
	options: SoundscaperProjectV23Options = {},
): SoundscaperProjectV23 {
	const { masteringSequences: sequenceValues = [], ...productionOptions } = options
	const foundation = createSoundscaperProjectV21(productionOptions) as unknown as Record<string, unknown>
	foundation.schemaVersion = SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION
	foundation.masteringSequences = normalizeMasteringSequencesV23(sequenceValues)
	return reconcile(foundation)
}

/** Clone an exact V23 document while re-establishing normalized leaf identities. */
export function cloneSoundscaperProjectV23(project: SoundscaperProjectV23 | unknown): SoundscaperProjectV23 {
	validateSoundscaperProjectV23(project)
	const draft = structuredClone(project) as Record<string, unknown>
	// V21's clone re-normalizes the production leaves, but it validates as V21 on
	// the way in and out, so the schema number and the new field are lent to it
	// and taken back. The alternative is a second copy of the lane, mixer and
	// freeze normalization, which is exactly the drift this revision avoids
	// everywhere else.
	draft.schemaVersion = 21
	const sequences = draft.masteringSequences
	delete draft.masteringSequences
	// The mastering-sequence requirement is derived from the field, and the field
	// is deliberately absent for the borrowed pass — so the manifest is reconciled
	// down to match the state V21 is about to validate, or the two disagree and
	// V21 refuses a document that is in fact valid.
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	)
	const production = cloneSoundscaperProjectV21(draft) as unknown as Record<string, unknown>
	production.schemaVersion = SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION
	production.masteringSequences = normalizeMasteringSequencesV23(sequences)
	return reconcile(production)
}

/**
 * Load exact V23, retain future data opaquely, and refuse pre-release re-imports.
 *
 * V21 is not pre-release — it is the other schema `isSoundscaperProductionProjectSchema`
 * still recognizes as carrying the production authority, and it is what every
 * project saved before the V23 bootstrap flip actually has on disk. Refusing it
 * the same way genuinely stale, pre-V21 documents are refused would make every
 * such project unopenable, so a V21 document is upgraded in place instead: the
 * same V21-plus-one-field relationship `createSoundscaperProjectV23` already
 * relies on.
 */
export function loadSoundscaperProjectV23(value: unknown): LoadedSoundscaperProjectV23 {
	const version = schemaVersion(value)
	if (version === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION) {
		return Object.freeze({
			project: upgradeSoundscaperProjectV21ToV23(value),
			readOnly: false,
			intrinsicReadOnly: false,
			reason: null,
		})
	}
	if (version < SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION) {
		throw new SoundscaperProjectV23ReimportRequiredError(version)
	}
	if (version > SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION) {
		const snapshot = snapshotInertJsonValue(value, 'future Soundscaper project', {
			maximumArrayLength: 100_000,
			maximumNodes: 2_000_000,
		})
		return Object.freeze({
			project: structuredClone(snapshot) as Readonly<Record<string, unknown>>,
			readOnly: true,
			intrinsicReadOnly: true,
			reason: 'newer-schema',
		})
	}
	return Object.freeze({
		project: cloneSoundscaperProjectV23(value),
		readOnly: false,
		intrinsicReadOnly: false,
		reason: null,
	})
}

/** Upgrade a validated V21 document into V23 by adding the empty mastering-sequence field. */
function upgradeSoundscaperProjectV21ToV23(value: unknown): SoundscaperProjectV23 {
	const draft = cloneSoundscaperProjectV21(value) as unknown as Record<string, unknown>
	draft.schemaVersion = SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION
	draft.masteringSequences = normalizeMasteringSequencesV23([])
	return reconcile(draft)
}

function reconcile(draft: Record<string, unknown>): SoundscaperProjectV23 {
	// Reconciled twice for the same reason V21 does it: the foundation pass claims
	// the requirements a document's own state implies — including the mastering
	// sequence one — and the product pass then owns its freeze requirements.
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	)
	draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirementsV23(
		draft,
		draft.featureRequirements as never,
	)
	validateSoundscaperProjectV23(draft)
	return draft as unknown as SoundscaperProjectV23
}

function schemaVersion(value: unknown): number {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('saved Soundscaper project must be an object')
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion')
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !Number.isSafeInteger(descriptor.value)) {
		throw new RangeError('Saved Soundscaper project schemaVersion must be an own safe integer')
	}
	return Number(descriptor.value)
}
