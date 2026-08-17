/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUTOMATION_LANE_MAXIMUM_POINTS_V21,
	assertAutomationLaneIdentitiesUniqueV21,
	normalizeAutomationLaneV21,
	type AutomationLaneV21,
} from '../common/editor/automation-lane-v21.ts'
import {
	normalizeAudioTrackFreezeV1,
	type AudioTrackFreezeV1,
} from '../common/editor/audio-track-freeze-v21.ts'
import {
	effectParameterInventory,
	stripParameterDescriptor,
} from '../common/editor/effect-parameter-descriptors.ts'
import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../common/editor/closed-domain-value.ts'
import { validateFolderMixerGraphV21 } from '../common/editor/folder-mixer-graph-v21.ts'
import {
	normalizeMixerGraphV21,
	validateMixerGraphV21,
	type MixerGraphV21,
} from '../common/editor/mixer-graph-v21.ts'
import { canonicalParameterAddressKey, type ParameterDescriptor } from '../common/editor/parameter-address.ts'
import type { AudioEditorFolderHierarchyDocument } from '../common/editor/project-v12-validation.ts'
import { validateAudioEditorFolderHierarchyDocument } from '../common/editor/project-v12-validation.ts'
import { validateTrackLocksV15 } from '../common/editor/project-v15-validation.ts'
import { validateAudioWarpRuntimeAuthorityV17 } from '../common/editor/project-v17-validation.ts'
import { validateVideoSourceCharacteristicsV14 } from '../common/editor/source-characteristics-v14.ts'
import {
	validateTakeCompDocumentGroupsV17,
	type TakeCompDocumentGroup,
} from '../common/editor/take-comp-document-v17.ts'

/**
 * The Soundscaper production document, validated once for every revision that
 * carries it.
 *
 * V21 introduced this shape and V23 adds one field to it. Cloning two hundred
 * lines of relationship checks per revision is how two revisions quietly stop
 * agreeing about what a valid document is, so the revision-specific parts —
 * the schema number, the closed field list, and any checks the revision adds —
 * are parameters, and everything else is shared.
 */

export interface SoundscaperProductionProject extends AudioEditorFolderHierarchyDocument {
	readonly automationLanes: readonly AutomationLaneV21[]
	readonly mixer: MixerGraphV21
	readonly takeGroups: readonly TakeCompDocumentGroup[]
}

export interface SoundscaperProductionAudioTrack extends Readonly<Record<string, unknown>> {
	readonly type: 'audio'
	readonly audioFreeze?: AudioTrackFreezeV1
}

/** The V21 field set, which every later production revision extends rather than replaces. */
export const SOUNDSCAPER_PRODUCTION_PROJECT_FIELDS = [
	'schemaVersion', 'id', 'title', 'revision', 'createdAt', 'updatedAt', 'sampleRate',
	'masterChannels', 'tempo', 'snap', 'timeDisplay', 'metadata', 'selection', 'loop',
	'view', 'sources', 'clips', 'tracks', 'master', 'mixer', 'opaqueExtensions',
	'projectBin', 'featureRequirements', 'sequences', 'primarySequenceId', 'tempoMap',
	'signatureMap', 'timelineAnnotations', 'trackFolders', 'takeGroups', 'automationLanes',
] as const

export interface SoundscaperProductionValidationRevision {
	readonly schemaVersion: number
	readonly label: string
	readonly projectFields: readonly string[]
	/** Checks this revision adds on top of the shared production ones. */
	readonly validateAdditions?: (project: Record<string, unknown>) => void
	readonly validateFeatureRequirements: (project: Record<string, unknown>) => void
}

const AUDIO_TRACK_FIELDS = new Set([
	'id', 'type', 'name', 'gain', 'pan', 'mute', 'solo', 'armed', 'displayMode', 'color',
	'spectrogram', 'effectsActive', 'effects', 'clipIds', 'collapsed', 'height',
	'opaqueExtensions', 'laneGroupId', 'locked', 'audioFreeze',
])
const VIDEO_TRACK_FIELDS = new Set([
	'id', 'type', 'name', 'clipIds', 'mute', 'solo', 'hidden', 'collapsed', 'height',
	'laneGroupId', 'opaqueExtensions', 'locked',
])
const LABEL_TRACK_FIELDS = new Set([
	'id', 'type', 'name', 'labels', 'collapsed', 'height', 'opaqueExtensions',
	'laneGroupId', 'locked',
])

/** Validate one exact production revision without a lossy legacy mixer projection. */
export function validateSoundscaperProductionProject(
	project: unknown,
	revision: SoundscaperProductionValidationRevision,
): project is SoundscaperProductionProject {
	const candidate = readClosedDomainRecord(
		project,
		revision.label,
		revision.projectFields,
		revision.projectFields,
	) as Record<string, unknown>
	const graph = normalizeMixerGraphV21(readClosedDomainField(candidate, 'mixer', revision.label))
	validateAudioEditorFolderHierarchyDocument(
		candidate,
		revision.schemaVersion,
		{},
		{
			stripEnvelopeAuthority: 'forbidden',
			validateMixer: (_value, tracks) => validateMixerGraphV21(graph, {
				audioTracks: tracks.filter((track) => track.type === 'audio').map((track) => ({
					id: String(track.id),
					effects: effectArray(track.effects, `track ${String(track.id)}.effects`),
				})),
				masterEffects: effectArray(
					dataRecord(candidate.master, 'project.master').effects,
					'project.master.effects',
				),
				mixerNodeEffects: new Map(
					[...graph.groups, ...graph.sends, ...graph.cues].map((node) => [node.id, node.effects]),
				),
				masterChannels: Number(candidate.masterChannels),
			}),
		},
	)
	validateFolderMixerGraphV21(candidate as unknown as SoundscaperProductionProject, graph)
	validateVideoSourceCharacteristicsV14(candidate)
	validateTrackLocksV15(candidate as AudioEditorFolderHierarchyDocument)
	validateAudioWarpRuntimeAuthorityV17(candidate)
	validateTakeCompDocumentGroupsV17(
		readClosedDomainField(candidate, 'takeGroups', revision.label),
		candidate,
	)
	validateTrackFieldInventories(candidate)
	validateAutomationLanes(candidate, graph, revision.label)
	validateAudioFreezeRelationships(candidate)
	revision.validateAdditions?.(candidate)
	revision.validateFeatureRequirements(candidate)
	return true
}

function validateTrackFieldInventories(project: Record<string, unknown>): void {
	for (const [index, track] of recordArray(project.tracks, 'project.tracks').entries()) {
		const allowed = track.type === 'audio' ? AUDIO_TRACK_FIELDS
			: track.type === 'video' ? VIDEO_TRACK_FIELDS
				: track.type === 'label' ? LABEL_TRACK_FIELDS : null
		if (!allowed) continue
		for (const key of Object.keys(track)) {
			if (!allowed.has(key)) {
				throw new TypeError(`project.tracks[${String(index)}] has an unsupported field: ${key}`)
			}
		}
	}
}

function validateAudioFreezeRelationships(project: Record<string, unknown>): void {
	const tracks = recordArray(project.tracks, 'project.tracks')
	const sources = recordArray(project.sources, 'project.sources')
	const clips = recordArray(project.clips, 'project.clips')
	const projectBin = dataRecord(project.projectBin, 'project.projectBin')
	const binClips = recordArray(projectBin.clips, 'project.projectBin.clips')
	const derivedSourceIds = new Set<string>()
	for (const [index, track] of tracks.entries()) {
		if (!Object.hasOwn(track, 'audioFreeze')) continue
		if (track.type !== 'audio') throw new RangeError('Only an audio track may own audioFreeze')
		const freezeDescriptor = Object.getOwnPropertyDescriptor(track, 'audioFreeze')
		if (!freezeDescriptor?.enumerable || !Object.hasOwn(freezeDescriptor, 'value')) {
			throw new TypeError(`project.tracks[${String(index)}].audioFreeze must be an own data field`)
		}
		const freeze = normalizeAudioTrackFreezeV1(freezeDescriptor.value)
		if (derivedSourceIds.has(freeze.derivedSourceId)) {
			throw new RangeError('Every frozen audio track must own a distinct derived source')
		}
		derivedSourceIds.add(freeze.derivedSourceId)
		if (!Array.isArray(track.clipIds) || track.clipIds.length === 0) {
			throw new RangeError(`Frozen audio track ${String(track.id)} must retain editable clips`)
		}
		const matches = sources.filter((source) => source.id === freeze.derivedSourceId)
		if (matches.length !== 1) {
			throw new ReferenceError(`Frozen audio track ${String(track.id)} requires exactly one derived source`)
		}
		const source = matches[0]!
		if (source.kind !== 'audio') throw new RangeError('An audio freeze derived source must be audio')
		if (typeof source.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(source.contentSha256)) {
			throw new TypeError('An audio freeze derived source requires a lowercase contentSha256')
		}
		if (source.frameCount !== freeze.renderFrameCount || source.sampleRate !== project.sampleRate) {
			throw new RangeError('An audio freeze derived source geometry must match its render and project')
		}
		if ([...clips, ...binClips].some((clip) => clip.sourceId === freeze.derivedSourceId)) {
			throw new RangeError('A freeze derived source cannot replace retained editable clips in canonical state')
		}
		assertNoDocumentMediaBody(source, `freeze derived source ${freeze.derivedSourceId}`)
	}
}

function assertNoDocumentMediaBody(value: unknown, name: string): void {
	const forbidden = new Set([
		'audioBuffer', 'base64', 'blob', 'bytes', 'channelData', 'chunks', 'data', 'payload', 'pcm',
	])
	const pending: Array<readonly [unknown, string]> = [[value, name]]
	while (pending.length > 0) {
		const [candidate, path] = pending.pop()!
		if (candidate instanceof ArrayBuffer || ArrayBuffer.isView(candidate)
			|| (typeof Blob === 'function' && candidate instanceof Blob)) {
			throw new TypeError(`${path} cannot contain PCM or binary media bodies`)
		}
		if (Array.isArray(candidate)) {
			for (const [index, item] of candidate.entries()) pending.push([item, `${path}[${String(index)}]`])
			continue
		}
		if (!candidate || typeof candidate !== 'object') continue
		for (const key of Reflect.ownKeys(candidate)) {
			if (typeof key !== 'string') throw new TypeError(`${path} cannot contain symbol fields`)
			const descriptor = Object.getOwnPropertyDescriptor(candidate, key)
			if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError(`${path}.${key} must be an own enumerable data field`)
			}
			if (forbidden.has(key)) throw new TypeError(`${path}.${key} cannot contain PCM or media payloads`)
			pending.push([descriptor.value, `${path}.${key}`])
		}
	}
}

function validateAutomationLanes(project: Record<string, unknown>, graph: MixerGraphV21, label: string): void {
	const laneValues = readClosedDomainArray(
		readClosedDomainField(project, 'automationLanes', label),
		'project.automationLanes',
		0,
		AUTOMATION_LANE_MAXIMUM_POINTS_V21,
	)
	const lanes = laneValues.map((lane) => normalizeAutomationLaneV21(lane))
	assertAutomationLaneIdentitiesUniqueV21(lanes)
	const tracks = new Map(recordArray(project.tracks, 'project.tracks').map((track) => [String(track.id), track]))
	const nodes = new Map([...graph.groups, ...graph.sends, ...graph.cues].map((node) => [node.id, node]))
	const edges = new Set(graph.edges.map((edge) => edge.id))
	for (const lane of lanes) {
		if (lane.address.kind === 'edge') {
			if (!edges.has(lane.address.edgeId)) {
				throw new ReferenceError(`Automation lane ${lane.id} references missing mixer edge ${lane.address.edgeId}`)
			}
			validateLaneDescriptor(lane, stripParameterDescriptor(lane.address))
			continue
		}
		const strip = lane.address.strip
		const owner = strip.kind === 'master'
			? dataRecord(project.master, 'project.master')
			: strip.kind === 'track'
				? tracks.get(strip.id)
				: nodes.get(strip.id)
		if (!owner) throw new ReferenceError(`Automation lane ${lane.id} references missing ${strip.kind}`)
		if (lane.address.kind !== 'effect') {
			validateLaneDescriptor(lane, stripParameterDescriptor(lane.address))
			continue
		}
		const addressedEffectId = lane.address.effectId
		const effects = effectArray(owner.effects, `automation owner ${lane.id}.effects`)
		const effect = effects.find((candidate) => candidate.id === addressedEffectId)
		if (!effect) {
			throw new ReferenceError(`Automation lane ${lane.id} references missing effect ${addressedEffectId}`)
		}
		const descriptorKey = canonicalParameterAddressKey(lane.address)
		const descriptor = effectParameterInventory(strip, effect, {
			sampleRate: Number(project.sampleRate),
		}).descriptors.find(({ id }) => id === descriptorKey)
		if (!descriptor) {
			throw new ReferenceError(`Automation lane ${lane.id} references an unavailable effect parameter`)
		}
		validateLaneDescriptor(lane, descriptor)
	}
}

function validateLaneDescriptor(lane: AutomationLaneV21, descriptor: ParameterDescriptor): void {
	normalizeAutomationLaneV21(lane, { descriptor })
}

function effectArray(value: unknown, name: string): readonly Readonly<Record<string, unknown>>[] {
	return recordArray(value, name)
}

function recordArray(value: unknown, name: string): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`)
	return value.map((candidate, index) => dataRecord(candidate, `${name}[${index}]`))
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`)
	return value as Record<string, unknown>
}
