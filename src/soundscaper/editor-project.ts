/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeAssistanceAssetReferencesV1,
} from '../common/editor/assistance/assistance-asset-reference-v1.ts'
import {
	normalizeAutomationLaneV21,
	type AutomationLaneV21,
} from '../common/editor/automation-lane-v21.ts'
import { normalizeAudioTrackFreezeV1 } from '../common/editor/audio-track-freeze-v21.ts'
import {
	createDefaultMixerGraphV21,
	defaultMixerChannelMapV21,
	normalizeMixerGraphV21,
	type MixerEdgeV21,
	type MixerGraphV21,
	type MixerStripV21,
} from '../common/editor/mixer-graph-v21.ts'
import { resolveTerminalChannelWidths } from '../common/editor/terminal-channel-widths.ts'
import {
	createAudioEditorProjectV17,
	type AudioEditorProjectV17Options,
} from '../common/editor/project-v17.ts'
import {
	PROJECT_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	classifyProjectSchemaIdentity,
} from '../common/editor/project-schema-identity.ts'
import { reconcileProjectOwnedFeatureRequirements } from '../common/editor/project-owned-feature-requirements.ts'
import { normalizeSoundscaperNativePluginStates } from './editor-native-plugin-state.ts'
import { normalizeSoundscaperMasteringSequences } from './editor-project-validation.ts'
import {
	validateSoundscaperProject,
	type SoundscaperProject,
} from './editor-project-validation.ts'
import { reconcileSoundscaperProjectFeatureRequirements } from './editor-project-feature-requirements.ts'

export {
	PROJECT_SCHEMA_VERSION,
	validateSoundscaperProject,
	type SoundscaperProject,
} from './editor-project-validation.ts'

export interface SoundscaperProjectOptions extends Omit<AudioEditorProjectV17Options, 'mixer'> {
	readonly automationLanes?: readonly unknown[]
	readonly mixer?: unknown
	readonly masteringSequences?: readonly unknown[]
	readonly nativePluginStates?: readonly unknown[]
	readonly assistanceAssets?: readonly unknown[]
}

export interface LoadedSoundscaperProject {
	readonly project: SoundscaperProject | Readonly<Record<string, unknown>>
	readonly readOnly: boolean
	readonly intrinsicReadOnly: boolean
	readonly reason: 'foreign-family' | 'newer-schema' | null
}

/** Create the baseline document from the maintained V17 editorial factory. */
export function createSoundscaperProject(
	options: SoundscaperProjectOptions = {},
): SoundscaperProject {
	const {
		automationLanes: laneValues = [],
		mixer: mixerValue,
		masteringSequences: masteringSequenceValues = [],
		nativePluginStates: nativePluginStateValues = [],
		assistanceAssets: assistanceAssetValues = [],
		...foundationOptions
	} = options
	const foundation = createAudioEditorProjectV17(foundationOptions) as unknown as Record<string, unknown>
	foundation.schemaFamily = SOUNDSCAPER_PROJECT_SCHEMA_FAMILY
	foundation.schemaVersion = PROJECT_SCHEMA_VERSION
	foundation.tracks = recordArray(foundation.tracks, 'project.tracks').map((track) => {
		const result = { ...track }
		if (result.type === 'audio') {
			delete result.envelope
			if (Object.hasOwn(result, 'audioFreeze')) {
				result.audioFreeze = normalizeAudioTrackFreezeV1(result.audioFreeze)
			}
		} else if (Object.hasOwn(result, 'audioFreeze')) {
			throw new RangeError('Only an audio track may own audioFreeze')
		}
		return result
	})
	const master = { ...dataRecord(foundation.master, 'project.master') }
	delete master.envelope
	foundation.master = master
	const automationLanes = normalizeLaneCollection(laneValues)
	const mixer = mixerValue === undefined
		? createFolderAwareDefaultMixerGraph(foundation)
		: normalizeMixerGraphV21(mixerValue)
	foundation.automationLanes = automationLanes
	foundation.mixer = mixer
	foundation.masteringSequences = normalizeSoundscaperMasteringSequences(masteringSequenceValues)
	foundation.nativePluginStates = normalizeSoundscaperNativePluginStates(nativePluginStateValues)
	foundation.assistanceAssets = normalizeAssistanceAssetReferencesV1(assistanceAssetValues)
	foundation.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		foundation,
		foundation.featureRequirements as never,
	)
	foundation.featureRequirements = reconcileSoundscaperProjectFeatureRequirements(
		foundation,
		foundation.featureRequirements as never,
	)
	validateSoundscaperProject(foundation)
	return foundation as SoundscaperProject
}

/** Clone an baseline document while re-establishing normalized leaf identities. */
export function cloneSoundscaperProject(project: SoundscaperProject | unknown): SoundscaperProject {
	validateSoundscaperProject(project)
	const draft = structuredClone(project) as Record<string, unknown>
	draft.automationLanes = normalizeLaneCollection(draft.automationLanes)
	draft.mixer = normalizeMixerGraphV21(draft.mixer)
	draft.masteringSequences = normalizeSoundscaperMasteringSequences(draft.masteringSequences)
	draft.nativePluginStates = normalizeSoundscaperNativePluginStates(draft.nativePluginStates)
	draft.assistanceAssets = normalizeAssistanceAssetReferencesV1(draft.assistanceAssets)
	draft.tracks = recordArray(draft.tracks, 'project.tracks').map((track) => {
		if (track.type !== 'audio' || !Object.hasOwn(track, 'audioFreeze')) return track
		return { ...track, audioFreeze: normalizeAudioTrackFreezeV1(track.audioFreeze) }
	})
	draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	)
	validateSoundscaperProject(draft)
	return draft as SoundscaperProject
}

/** Load baseline, retain future data opaquely, and refuse pre-release re-imports. */
export function loadSoundscaperProject(value: unknown): LoadedSoundscaperProject {
	const classification = classifyProjectSchemaIdentity(value, SOUNDSCAPER_PROJECT_SCHEMA_FAMILY)
	if (classification.disposition !== 'current') {
		return Object.freeze({
			// The archive bytes, not a traversed domain clone, remain Save Copy authority.
			project: value as Readonly<Record<string, unknown>>,
			readOnly: true,
			intrinsicReadOnly: true,
			reason: classification.disposition === 'foreign' ? 'foreign-family' : 'newer-schema',
		})
	}
	return Object.freeze({
		project: cloneSoundscaperProject(value),
		readOnly: false,
		intrinsicReadOnly: false,
		reason: null,
	})
}

function normalizeLaneCollection(value: unknown): readonly AutomationLaneV21[] {
	if (!Array.isArray(value) || value.length > 4_096) {
		throw new RangeError('project.automationLanes must contain at most 4096 lanes')
	}
	return Object.freeze(value.map((lane) => normalizeAutomationLaneV21(lane)))
}

function createFolderAwareDefaultMixerGraph(project: Record<string, unknown>): MixerGraphV21 {
	const tracks = recordArray(project.tracks, 'project.tracks')
		.filter((track) => track.type === 'audio')
	const masterChannels = Number(project.masterChannels)
	const trackWidths = resolveTerminalChannelWidths(project as never, masterChannels).tracks
	const base = createDefaultMixerGraphV21(tracks.map((track) => ({
		id: String(track.id),
		channelCount: trackWidths.get(String(track.id)) ?? masterChannels,
	})), masterChannels)
	const folders = recordArray(project.trackFolders, 'project.trackFolders')
	if (folders.length === 0) return base
	const folderName = new Map(folders.map((folder) => [String(folder.id), String(folder.name)]))
	const parentByFolder = new Map<string, string | null>()
	const parentByTrack = new Map<string, string | null>()
	for (const sequence of recordArray(project.sequences, 'project.sequences')) {
		for (const value of recordArray(sequence.trackNodes, 'sequence.trackNodes')) {
			const parent = value.parentFolderId === null ? null : String(value.parentFolderId)
			if (value.kind === 'folder') parentByFolder.set(String(value.id), parent)
			else if (value.kind === 'track') parentByTrack.set(String(value.id), parent)
		}
	}
	const owning = new Set<string>()
	for (const track of tracks) {
		let parent = parentByTrack.get(String(track.id)) ?? null
		while (parent !== null) {
			owning.add(parent)
			parent = parentByFolder.get(parent) ?? null
		}
	}
	const groups = Object.freeze(Array.from(owning, (id) => defaultFolderStrip(
		id,
		folderName.get(id) ?? id,
		Number(project.masterChannels),
	)))
	const edges: MixerEdgeV21[] = []
	for (const track of tracks) {
		const trackId = String(track.id)
		const parent = parentByTrack.get(trackId) ?? null
		edges.push(assignmentEdge(
			`assignment:track:${trackId}:${parent === null ? 'master' : `mixer-node:${parent}`}`,
			{ kind: 'track', id: trackId },
			parent === null ? { kind: 'master' } : { kind: 'mixer-node', id: parent },
			trackWidths.get(trackId) ?? masterChannels,
			masterChannels,
		))
	}
	for (const folderId of owning) {
		let parent = parentByFolder.get(folderId) ?? null
		while (parent !== null && !owning.has(parent)) parent = parentByFolder.get(parent) ?? null
		edges.push(assignmentEdge(
			`assignment:mixer-node:${folderId}:${parent === null ? 'master' : `mixer-node:${parent}`}`,
			{ kind: 'mixer-node', id: folderId },
			parent === null ? { kind: 'master' } : { kind: 'mixer-node', id: parent },
			masterChannels,
			masterChannels,
		))
	}
	edges.push(base.edges.at(-1)!)
	return Object.freeze({ ...base, groups, edges: Object.freeze(edges) })
}

function defaultFolderStrip(id: string, name: string, channelCount: number): MixerStripV21 {
	return Object.freeze({
		id, name, color: '#4f87c8', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: true, effectsActive: true, effects: Object.freeze([]), channelCount,
	})
}

function assignmentEdge(
	id: string,
	source: MixerEdgeV21['source'],
	destination: Exclude<MixerEdgeV21['destination'], { readonly kind: 'effect-sidechain' }>,
	sourceChannelCount: number,
	destinationChannelCount: number,
): MixerEdgeV21 {
	return Object.freeze({
		id,
		kind: 'assignment',
		source: Object.freeze(source),
		destination: Object.freeze(destination),
		position: 'post-fader',
		level: 1,
		enabled: true,
		channelMap: defaultMixerChannelMapV21(sourceChannelCount, destinationChannelCount),
	})
}

function recordArray(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`)
	return value.map((candidate, index) => dataRecord(candidate, `${name}[${index}]`))
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`)
	return value as Record<string, unknown>
}
