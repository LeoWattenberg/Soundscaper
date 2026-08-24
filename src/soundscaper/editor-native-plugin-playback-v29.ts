/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type {
	ProjectFeatureRequirement,
	ProjectFeatureRequirementsManifest,
	ProjectFeatureRequirementsReport,
} from '../common/editor/project-feature-requirements.ts'
import { nativePluginRuntimeAvailable } from '../common/editor/native-plugin-realtime-node.js'
import type {
	SoundscaperNativePluginFormatV29,
	SoundscaperNativePluginStateV29,
} from './editor-native-plugin-state-v29.ts'

export const SOUNDSCAPER_NATIVE_PLUGIN_REQUIREMENT_PREFIX = 'soundscaper.native-plugin.'
export const SOUNDSCAPER_NATIVE_PLUGIN_FEATURE_PREFIX = 'org.soundscaper.native-plugin.'

type DataRecord = Readonly<Record<string, unknown>>

const TEXT_ENCODER = new TextEncoder()

export function soundscaperNativePluginRequirementIdV29(instanceId: string): string {
	return `${SOUNDSCAPER_NATIVE_PLUGIN_REQUIREMENT_PREFIX}${instanceDigest(instanceId)}`
}

export function soundscaperNativePluginFeatureIdV29(
	instanceId: string,
	format: SoundscaperNativePluginFormatV29,
): string {
	return `${SOUNDSCAPER_NATIVE_PLUGIN_FEATURE_PREFIX}${format}.${instanceDigest(instanceId)}`
}

/** Own one bypass requirement per persisted native instance. */
export function reconcileSoundscaperNativePluginRequirementsV29(
	project: DataRecord,
	manifest: ProjectFeatureRequirementsManifest,
): ProjectFeatureRequirementsManifest {
	const states = nativeStates(project)
	const expected = states.map(nativeRequirement)
	const byId = new Map(expected.map((requirement) => [requirement.id, requirement]))
	const retained: ProjectFeatureRequirement[] = []
	for (const requirement of manifest.requirements) {
		const reservedId = requirement.id.startsWith(SOUNDSCAPER_NATIVE_PLUGIN_REQUIREMENT_PREFIX)
		const reservedFeature = requirement.featureId.startsWith(SOUNDSCAPER_NATIVE_PLUGIN_FEATURE_PREFIX)
		if (!reservedId && !reservedFeature) {
			retained.push(requirement)
			continue
		}
		const exact = byId.get(requirement.id)
		if (!exact || !sameRequirement(requirement, exact)) {
			throw new TypeError('A reserved native plug-in requirement conflicts with V29 project state.')
		}
	}
	return Object.freeze({
		schemaVersion: 2 as const,
		requirements: Object.freeze([...retained, ...expected]),
	})
}

export function nativePluginCapabilitySetsV29(
	project: DataRecord,
): Readonly<{ known: ReadonlySet<string>; available: ReadonlySet<string> }> {
	const known = new Set<string>()
	const available = new Set<string>()
	for (const state of nativeStates(project)) {
		const featureId = soundscaperNativePluginFeatureIdV29(state.instanceId, state.format)
		known.add(featureId)
		if (nativePluginRuntimeAvailable(state.instanceId, state.format)) available.add(featureId)
	}
	return Object.freeze({ known, available })
}

/**
 * A missing exact host never executes as live. The canonical document and its
 * opaque state remain untouched; this projection bypasses only the affected
 * rack slots, or marks continuity frozen when a verified track render already
 * replaced that whole rack for playback.
 */
export function projectNativePluginPlaybackV29<Project extends object>(
	project: Project,
	report: ProjectFeatureRequirementsReport | null,
	frozenTrackId: string | null = null,
	canonicalProject: object = project,
): Project {
	const record = project as DataRecord
	const canonical = canonicalProject as DataRecord
	const states = nativeStates(record)
	const unavailable = new Set((report?.items ?? []).flatMap((item) => (
		item.featureId.startsWith(SOUNDSCAPER_NATIVE_PLUGIN_FEATURE_PREFIX)
			&& item.availability !== 'available'
			&& item.declaredDisposition === 'bypass'
			&& item.disposition === 'bypassed'
			? [item.requirementId] : []
	)))
	if (unavailable.size === 0) return project
	const stateByInstance = new Map(states.map((state) => [state.instanceId, state]))
	const affected = new Set(states.filter((state) => (
		unavailable.has(soundscaperNativePluginRequirementIdV29(state.instanceId))
	)).map((state) => state.instanceId))
	const frozen = new Set<string>()
	if (frozenTrackId !== null) {
		const target = dataArray(canonical.tracks).find((track) => track.id === frozenTrackId)
		if (target) for (const instanceId of rackNativeInstanceIds(target)) {
			if (affected.has(instanceId)) frozen.add(instanceId)
		}
	}
	const tracks = dataArray(record.tracks).map((track) => {
		if (track.type !== 'audio') return track
		const projected = projectRack(track, affected)
		return projected
	})
	const mixer = dataRecord(record.mixer)
	const projectedMixer = mixer ? Object.freeze({
		...mixer,
		groups: Object.freeze(dataArray(mixer.groups).map((owner) => projectRack(owner, affected))),
		sends: Object.freeze(dataArray(mixer.sends).map((owner) => projectRack(owner, affected))),
		cues: Object.freeze(dataArray(mixer.cues).map((owner) => projectRack(owner, affected))),
	}) : record.mixer
	const projectedStates = states.map((state) => {
		if (!affected.has(state.instanceId)) return state
		return Object.freeze({
			...state,
			bypassed: !frozen.has(state.instanceId),
			continuity: frozen.has(state.instanceId) ? 'frozen' as const : 'bypass' as const,
		})
	})
	for (const instanceId of affected) {
		if (!stateByInstance.has(instanceId)) throw new Error('Native plug-in playback state lost its identity.')
	}
	return Object.freeze({
		...record,
		tracks: Object.freeze(tracks),
		mixer: projectedMixer,
		master: projectRack(dataRecord(record.master) ?? {}, affected),
		nativePluginStates: Object.freeze(projectedStates),
	}) as Project
}

function nativeRequirement(state: SoundscaperNativePluginStateV29): ProjectFeatureRequirement {
	return Object.freeze({
		id: soundscaperNativePluginRequirementIdV29(state.instanceId),
		featureId: soundscaperNativePluginFeatureIdV29(state.instanceId, state.format),
		displayName: `Native ${state.format.toUpperCase()} plug-in`,
		disposition: 'bypass' as const,
		fallback: null,
	})
}

function nativeStates(project: DataRecord): readonly SoundscaperNativePluginStateV29[] {
	return Array.isArray(project.nativePluginStates)
		? project.nativePluginStates as readonly SoundscaperNativePluginStateV29[]
		: Object.freeze([])
}

function projectRack(owner: DataRecord, affected: ReadonlySet<string>): DataRecord {
	if (!Array.isArray(owner.effects)) return owner
	let changed = false
	const effects = owner.effects.map((candidate) => {
		const effect = dataRecord(candidate)
		const instanceId = effect?.type === 'native-plugin' ? effect.params : null
		const id = dataRecord(instanceId)?.instanceId
		if (typeof id !== 'string' || !affected.has(id) || effect?.bypassed === true) return candidate
		changed = true
		return Object.freeze({ ...effect, bypassed: true })
	})
	return changed ? Object.freeze({ ...owner, effects: Object.freeze(effects) }) : owner
}

function rackNativeInstanceIds(owner: DataRecord): readonly string[] {
	return dataArray(owner.effects).flatMap((effect) => {
		if (effect.type !== 'native-plugin') return []
		const instanceId = dataRecord(effect.params)?.instanceId
		return typeof instanceId === 'string' ? [instanceId] : []
	})
}

function dataArray(value: unknown): readonly DataRecord[] {
	if (!Array.isArray(value)) return []
	const output: DataRecord[] = []
	for (const candidate of value) {
		const record = dataRecord(candidate)
		if (record) output.push(record)
	}
	return output
}

function dataRecord(value: unknown): DataRecord | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null
}

function instanceDigest(instanceId: string): string {
	return bytesToHex(sha256(TEXT_ENCODER.encode(instanceId)))
}

function sameRequirement(left: ProjectFeatureRequirement, right: ProjectFeatureRequirement): boolean {
	return JSON.stringify(left) === JSON.stringify(right)
}
