/* SPDX-License-Identifier: AGPL-3.0-only */

import { snapshotInertJsonValue } from '../common/editor/inert-json-snapshot.ts'
import {
	SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION,
} from '../common/editor/project-schema-version.ts'
import { reconcileProjectOwnedFeatureRequirements } from '../common/editor/project-owned-feature-requirements.ts'
import {
	createSoundscaperProjectV23,
	cloneSoundscaperProjectV23,
	type SoundscaperProjectV23Options,
} from './editor-project-v23.ts'
import { normalizeSoundscaperNativePluginStatesV29 } from './editor-native-plugin-state-v29.ts'
import {
	validateSoundscaperProjectV29,
	type SoundscaperProjectV29,
} from './editor-project-v29-validation.ts'
import { reconcileSoundscaperProjectFeatureRequirementsV29 } from './editor-project-feature-requirements-v29.ts'

export {
	SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION,
	validateSoundscaperProjectV29,
	type SoundscaperProjectV29,
} from './editor-project-v29-validation.ts'

/**
 * The exact V29 document: validated V23 plus content-addressed native state.
 *
 * It is composed on V23's factory, so the
 * revision owns the one field it adds and inherits everything else by
 * construction rather than by a copy that can drift.
 */

export interface SoundscaperProjectV29Options extends SoundscaperProjectV23Options {
	readonly nativePluginStates?: readonly unknown[]
}

export interface LoadedSoundscaperProjectV29 {
	readonly project: SoundscaperProjectV29 | Readonly<Record<string, unknown>>
	readonly readOnly: boolean
	readonly intrinsicReadOnly: boolean
	readonly reason: 'newer-schema' | null
}

export class SoundscaperProjectV29ReimportRequiredError extends RangeError {
	readonly sourceSchemaVersion: number
	readonly currentSchemaVersion = SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION

	constructor(sourceSchemaVersion: number) {
		super(`Soundscaper schema V${sourceSchemaVersion} requires re-import into exact V29 authority`)
		this.name = 'SoundscaperProjectV29ReimportRequiredError'
		this.sourceSchemaVersion = sourceSchemaVersion
	}
}

export function createSoundscaperProjectV29(
	options: SoundscaperProjectV29Options = {},
): SoundscaperProjectV29 {
	const { nativePluginStates: pluginStateValues = [], ...productionOptions } = options
	const foundation = createSoundscaperProjectV23(productionOptions) as unknown as Record<string, unknown>
	foundation.schemaVersion = SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION
	foundation.nativePluginStates = normalizeSoundscaperNativePluginStatesV29(pluginStateValues)
	return reconcile(foundation)
}

/** Clone an exact V29 document while re-establishing normalized leaf identities. */
export function cloneSoundscaperProjectV29(project: SoundscaperProjectV29 | unknown): SoundscaperProjectV29 {
	validateSoundscaperProjectV29(project)
	const draft = structuredClone(project) as Record<string, unknown>
	// V23's clone re-normalizes the production leaves, but it validates as V23 on
	// the way in and out, so the schema number and the new field are lent to it
	// and taken back. The alternative is a second copy of the lane, mixer and
	// freeze normalization, which is exactly the drift this revision avoids
	// everywhere else.
	draft.schemaVersion = SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION
	const pluginStates = draft.nativePluginStates
	delete draft.nativePluginStates
	// The mastering-sequence requirement is derived from the field, and the field
	// is deliberately absent for the borrowed pass — so the manifest is reconciled
	// down to match the state V21 is about to validate, or the two disagree and
	// V21 refuses a document that is in fact valid.
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	)
	const production = cloneSoundscaperProjectV23(draft) as unknown as Record<string, unknown>
	production.schemaVersion = SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION
	production.nativePluginStates = normalizeSoundscaperNativePluginStatesV29(pluginStates)
	return reconcile(production)
}

/**
 * Load exact V29, retain future data opaquely, and refuse pre-release re-imports.
 *
 * V23 is the formally validated predecessor. Earlier schemas require their
 * existing explicit import route rather than being silently accepted here.
 */
export function loadSoundscaperProjectV29(value: unknown): LoadedSoundscaperProjectV29 {
	const version = schemaVersion(value)
	if (version === SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION) {
		return Object.freeze({
			project: upgradeSoundscaperProjectV23ToV29(value),
			readOnly: false,
			intrinsicReadOnly: false,
			reason: null,
		})
	}
	if (version < SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION) {
		throw new SoundscaperProjectV29ReimportRequiredError(version)
	}
	if (version > SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION) {
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
		project: cloneSoundscaperProjectV29(value),
		readOnly: false,
		intrinsicReadOnly: false,
		reason: null,
	})
}

/** Upgrade validated V23 into V29 by adding an empty native plug-in-state collection. */
export function upgradeSoundscaperProjectV23ToV29(value: unknown): SoundscaperProjectV29 {
	const draft = cloneSoundscaperProjectV23(value) as unknown as Record<string, unknown>
	draft.schemaVersion = SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION
	draft.nativePluginStates = normalizeSoundscaperNativePluginStatesV29([])
	return reconcile(draft)
}

function reconcile(draft: Record<string, unknown>): SoundscaperProjectV29 {
	// Reconciled twice for the same reason V21 does it: the foundation pass claims
	// the requirements a document's own state implies — including the mastering
	// sequence one — and the product pass then owns its freeze requirements.
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	)
	draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirementsV29(
		draft,
		draft.featureRequirements as never,
	)
	validateSoundscaperProjectV29(draft)
	return draft as unknown as SoundscaperProjectV29
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
