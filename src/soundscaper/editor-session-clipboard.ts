/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ControllerTrackDuplicateCarrier,
	ControllerTrackDuplicateRequest,
} from '../common/editor/controller/project-runtime.ts'
import type { SoundscaperProject } from './editor-project.ts'
import { validateSoundscaperProject } from './editor-project-validation.ts'

export const SOUNDSCAPER_SESSION_CLIPBOARD_SCHEMA_VERSION_V8 = 8 as const

const CARRIER_FIELDS = [
	'schemaVersion', 'kind', 'originProjectId', 'originRevision', 'sourceTrackId', 'effectIds',
] as const
const REQUEST_FIELDS = ['sourceTrackId', 'targetTrackId', 'effectIds'] as const
const EFFECT_MAPPING_FIELDS = ['sourceId', 'targetId'] as const

export interface SoundscaperTrackDuplicateClipboardV8 {
	readonly schemaVersion: typeof SOUNDSCAPER_SESSION_CLIPBOARD_SCHEMA_VERSION_V8;
	readonly kind: 'track-duplicate';
	readonly originProjectId: string;
	readonly originRevision: number;
	readonly sourceTrackId: string;
	readonly effectIds: readonly string[];
}

type SoundscaperClipboardProject = SoundscaperProject

/** Capture only the identity authority needed to remap one exact track duplicate. */
export function createSoundscaperTrackDuplicateClipboardV8(
	projectValue: SoundscaperClipboardProject | unknown,
	sourceTrackIdValue: unknown,
): Readonly<SoundscaperTrackDuplicateClipboardV8> {
	validateSoundscaperClipboardAuthority(projectValue)
	const project = projectValue as SoundscaperClipboardProject
	const sourceTrackId = canonicalId(sourceTrackIdValue, 'clipboard source track ID')
	const sourceTrack = project.tracks.find(({ id }) => id === sourceTrackId)
	if (!sourceTrack) throw new ReferenceError(`Unknown clipboard source track: ${sourceTrackId}.`)
	const effectIds = trackEffectIds(sourceTrack, 'clipboard source track')
	return Object.freeze({
		schemaVersion: SOUNDSCAPER_SESSION_CLIPBOARD_SCHEMA_VERSION_V8,
		kind: 'track-duplicate' as const,
		originProjectId: canonicalId(project.id, 'clipboard origin project ID'),
		originRevision: nonNegativeSafeInteger(project.revision, 'clipboard origin revision'),
		sourceTrackId,
		effectIds: Object.freeze(effectIds),
	})
}

/** Admit a detached, closed V8 carrier; older wires require an explicit recopy. */
export function normalizeSoundscaperTrackDuplicateClipboardV8(
	value: unknown,
): Readonly<SoundscaperTrackDuplicateClipboardV8> {
	const candidate = plainExactRecord(value, CARRIER_FIELDS, 'Soundscaper track duplicate clipboard')
	if (candidate.schemaVersion !== SOUNDSCAPER_SESSION_CLIPBOARD_SCHEMA_VERSION_V8) {
		throw new RangeError('Soundscaper production track duplication requires clipboard V8; recopy the track.')
	}
	if (candidate.kind !== 'track-duplicate') {
		throw new RangeError('Soundscaper clipboard V8 has an unsupported carrier kind.')
	}
	const effectIds = denseArray(candidate.effectIds, 'Soundscaper clipboard V8 effectIds')
		.map((id) => canonicalId(id, 'Soundscaper clipboard V8 effect ID'))
	if (new Set(effectIds).size !== effectIds.length) {
		throw new RangeError('Soundscaper clipboard V8 effect IDs must be unique.')
	}
	return Object.freeze({
		schemaVersion: SOUNDSCAPER_SESSION_CLIPBOARD_SCHEMA_VERSION_V8,
		kind: 'track-duplicate' as const,
		originProjectId: canonicalId(candidate.originProjectId, 'clipboard origin project ID'),
		originRevision: nonNegativeSafeInteger(candidate.originRevision, 'clipboard origin revision'),
		sourceTrackId: canonicalId(candidate.sourceTrackId, 'clipboard source track ID'),
		effectIds: Object.freeze(effectIds),
	})
}

/** Consume V8 only against its exact source revision and caller-allocated fresh identities. */
export function prepareSoundscaperTrackDuplicateCarrierV8(
	projectValue: SoundscaperClipboardProject | unknown,
	clipboardValue: SoundscaperTrackDuplicateClipboardV8 | unknown,
	requestValue: ControllerTrackDuplicateRequest | unknown,
): Readonly<ControllerTrackDuplicateCarrier> {
	validateSoundscaperClipboardAuthority(projectValue)
	const project = projectValue as SoundscaperClipboardProject
	const clipboard = normalizeSoundscaperTrackDuplicateClipboardV8(clipboardValue)
	if (clipboard.originProjectId !== project.id || clipboard.originRevision !== project.revision) {
		throw new RangeError('Soundscaper clipboard V8 is stale for the current project revision.')
	}
	const request = normalizeRequest(requestValue)
	if (request.sourceTrackId !== clipboard.sourceTrackId) {
		throw new RangeError('Soundscaper clipboard V8 changed its source track identity.')
	}
	if (request.targetTrackId === request.sourceTrackId
		|| project.tracks.some(({ id }) => id === request.targetTrackId)) {
		throw new RangeError('Soundscaper clipboard V8 requires one fresh target track identity.')
	}
	const sourceTrack = project.tracks.find(({ id }) => id === clipboard.sourceTrackId)
	if (!sourceTrack) throw new ReferenceError('Soundscaper clipboard V8 source track is unavailable.')
	const currentEffectIds = trackEffectIds(sourceTrack, 'clipboard source track')
	if (!sameStrings(currentEffectIds, clipboard.effectIds)
		|| !sameStrings(request.effectIds.map(({ sourceId }) => sourceId), clipboard.effectIds)) {
		throw new RangeError('Soundscaper clipboard V8 source effects changed; recopy the track.')
	}
	const occupiedEffectIds = new Set(project.tracks.flatMap((track) => (
		trackEffectIds(track, `project track ${track.id}`)
	)))
	for (const { targetId } of request.effectIds) {
		if (occupiedEffectIds.has(targetId)) {
			throw new RangeError('Soundscaper clipboard V8 target effect identity is already in use.')
		}
	}
	return Object.freeze({
		sourceTrackId: clipboard.sourceTrackId,
		effectIds: Object.freeze(request.effectIds.map((entry) => Object.freeze({ ...entry }))),
	})
}

/** Create and consume one V8 carrier within the real controller duplicate preparation. */
export function prepareCurrentSoundscaperTrackDuplicateCarrierV8(
	project: SoundscaperClipboardProject | unknown,
	request: ControllerTrackDuplicateRequest | unknown,
): Readonly<ControllerTrackDuplicateCarrier> {
	const normalizedRequest = normalizeRequest(request)
	return prepareSoundscaperTrackDuplicateCarrierV8(
		project,
		createSoundscaperTrackDuplicateClipboardV8(project, normalizedRequest.sourceTrackId),
		normalizedRequest,
	)
}

function normalizeRequest(value: unknown): Readonly<ControllerTrackDuplicateRequest> {
	const candidate = plainExactRecord(value, REQUEST_FIELDS, 'track duplicate remap request')
	const mappings = denseArray(candidate.effectIds, 'track duplicate effect mappings').map((entry, index) => {
		const mapping = plainExactRecord(
			entry,
			EFFECT_MAPPING_FIELDS,
			`track duplicate effect mapping ${String(index)}`,
		)
		return Object.freeze({
			sourceId: canonicalId(mapping.sourceId, 'track duplicate source effect ID'),
			targetId: canonicalId(mapping.targetId, 'track duplicate target effect ID'),
		})
	})
	if (new Set(mappings.map(({ sourceId }) => sourceId)).size !== mappings.length
		|| new Set(mappings.map(({ targetId }) => targetId)).size !== mappings.length) {
		throw new RangeError('Track duplicate effect mappings must be one-to-one.')
	}
	return Object.freeze({
		sourceTrackId: canonicalId(candidate.sourceTrackId, 'track duplicate source track ID'),
		targetTrackId: canonicalId(candidate.targetTrackId, 'track duplicate target track ID'),
		effectIds: Object.freeze(mappings),
	})
}

/**
 * Validate the production authority regardless of which live revision it is.
 *
 * This carrier is shared by both the V21 and the V23 project runtime
 * selections — asking the canonical project validator alone would refuse
 * every V23 document (it carries `masteringSequences`, a field V21's closed
 * domain does not know), which is exactly what silently broke track
 * duplication once the app started booting the V23 selection by default.
 */
function validateSoundscaperClipboardAuthority(project: unknown): void {
	validateSoundscaperProject(project)
}

function plainExactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain record.`)
	}
	const prototype = Object.getPrototypeOf(value)
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain record with no custom prototype.`)
	}
	const keys = Reflect.ownKeys(value)
	if (keys.length !== fields.length || keys.some((key) => (
		typeof key !== 'string' || !fields.includes(key as Field)
	))) throw new TypeError(`${name} must contain its exact fields.`)
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field)
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property.`)
		}
	}
	return value as Record<Field, unknown>
}

function denseArray(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must be an array.`)
	}
	for (let index = 0; index < value.length; index += 1) {
		if (!Object.hasOwn(value, index)) throw new TypeError(`${name} must be dense.`)
	}
	if (Reflect.ownKeys(value).some((key) => key !== 'length'
		&& (typeof key === 'symbol' || !/^(0|[1-9]\d*)$/u.test(key)))) {
		throw new TypeError(`${name} contains an unsupported property.`)
	}
	return value
}

function canonicalId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value || value !== value.trim()) {
		throw new TypeError(`${name} must be a canonical non-empty string.`)
	}
	return value
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`)
	}
	return Number(value)
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index])
}

function trackEffectIds(track: Readonly<Record<string, unknown>>, name: string): readonly string[] {
	const effects = denseArray(track.effects, `${name}.effects`)
	return effects.map((value, index) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new TypeError(`${name}.effects[${String(index)}] must be a record.`)
		}
		return canonicalId(
			(value as Readonly<Record<string, unknown>>).id,
			`${name}.effects[${String(index)}].id`,
		)
	})
}
