/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from './closed-domain-value.ts'
import {
	normalizeStripRef,
	type StripRef,
} from './parameter-address.ts'
import { snapshotInertJsonValue } from './inert-json-snapshot.ts'
import { assertAcyclicRoutingV21 } from './routing-cycle-v21.ts'

export const MIXER_GRAPH_V21_SCHEMA_VERSION = 1 as const
export const MIXER_GRAPH_V21_MAX_ITEMS = 4096

export type MixerNodeKindV21 = 'group' | 'send' | 'cue'
export type MixerOutputRoleV21 = 'main' | 'cue' | 'control-room' | 'auxiliary'
export type MixerEdgeKindV21 = 'assignment' | 'send' | 'sidechain'
export type MixerEdgePositionV21 = 'pre-fader' | 'post-fader'

export interface MixerStripV21 {
	readonly id: string
	readonly name: string
	readonly color: string
	readonly gain: number
	readonly pan: number
	readonly mute: boolean
	readonly solo: boolean
	readonly collapsed: boolean
	readonly effectsActive: boolean
	readonly effects: readonly Readonly<Record<string, unknown>>[]
	readonly channelCount: number
}

export interface MixerVcaV21 {
	readonly id: string
	readonly name: string
	readonly gain: number
	readonly mute: boolean
	readonly members: readonly StripRef[]
}

export interface MixerOutputV21 {
	readonly id: string
	readonly name: string
	readonly role: MixerOutputRoleV21
	readonly channelCount: number
}

export type MixerEndpointV21 =
	| { readonly kind: 'track'; readonly id: string }
	| { readonly kind: 'mixer-node'; readonly id: string }
	| { readonly kind: 'master' }
	| { readonly kind: 'output'; readonly id: string }

export interface MixerEffectSidechainEndpointV21 {
	readonly kind: 'effect-sidechain'
	readonly strip: StripRef
	readonly effectId: string
}

export interface MixerEdgeV21 {
	readonly id: string
	readonly kind: MixerEdgeKindV21
	readonly source: Exclude<MixerEndpointV21, { readonly kind: 'output' }>
	readonly destination: Exclude<MixerEndpointV21, { readonly kind: 'track' }> | MixerEffectSidechainEndpointV21
	readonly position: MixerEdgePositionV21
	readonly level: number
	readonly enabled: boolean
	readonly channelMap: readonly number[]
}

export interface MixerGraphV21 {
	readonly schemaVersion: typeof MIXER_GRAPH_V21_SCHEMA_VERSION
	readonly groups: readonly MixerStripV21[]
	readonly sends: readonly MixerStripV21[]
	readonly cues: readonly MixerStripV21[]
	readonly vcas: readonly MixerVcaV21[]
	readonly outputs: readonly MixerOutputV21[]
	readonly edges: readonly MixerEdgeV21[]
}

export interface MixerGraphValidationContextV21 {
	readonly audioTracks: readonly {
		readonly id: string
		readonly effects?: readonly { readonly id?: unknown }[]
		/** Resolved from clip content by the caller. Absent means the width is unknown. */
		readonly channelCount?: number
	}[]
	readonly masterEffects?: readonly { readonly id?: unknown }[]
	readonly masterChannels?: number
	/** Authoring surfaces only: reject a map longer than its declared destination. */
	readonly strictChannelMapLength?: boolean
	readonly mixerNodeEffects?: ReadonlyMap<string, readonly { readonly id?: unknown }[]>
}

const TOP_FIELDS = [
	'schemaVersion',
	'groups',
	'sends',
	'cues',
	'vcas',
	'outputs',
	'edges',
] as const
const STRIP_FIELDS = [
	'id',
	'name',
	'color',
	'gain',
	'pan',
	'mute',
	'solo',
	'collapsed',
	'effectsActive',
	'effects',
	'channelCount',
] as const
const VCA_FIELDS = ['id', 'name', 'gain', 'mute', 'members'] as const
const OUTPUT_FIELDS = ['id', 'name', 'role', 'channelCount'] as const
const EDGE_FIELDS = [
	'id',
	'kind',
	'source',
	'destination',
	'position',
	'level',
	'enabled',
	'channelMap',
] as const

function normalizeIdentifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
		throw new TypeError(`${name} must be a non-empty string of at most 256 characters`)
	}
	return value
}

function normalizeLabel(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length > 1024) {
		throw new TypeError(`${name} must be a string of at most 1024 characters`)
	}
	return value
}

function normalizeFiniteNumber(
	value: unknown,
	name: string,
	minimum: number,
	maximum: number,
): number {
	if (
		typeof value !== 'number'
		|| !Number.isFinite(value)
		|| Object.is(value, -0)
		|| value < minimum
		|| value > maximum
	) {
		throw new TypeError(`${name} must be a canonical number from ${minimum} through ${maximum}`)
	}
	return value
}

function normalizePositiveInteger(value: unknown, name: string, maximum = 32): number {
	if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
		throw new TypeError(`${name} must be an integer from 1 through ${maximum}`)
	}
	return value as number
}

function normalizeBoolean(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') {
		throw new TypeError(`${name} must be a boolean`)
	}
	return value
}

function normalizeEffect(value: unknown, name: string): Readonly<Record<string, unknown>> {
	const snapshot = snapshotInertJsonValue(value, name, {
		maximumArrayLength: MIXER_GRAPH_V21_MAX_ITEMS,
		maximumNodes: 16_384,
	})
	if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
		throw new TypeError(`${name} must be an effect record`)
	}
	normalizeIdentifier((snapshot as Record<string, unknown>).id, `${name}.id`)
	return snapshot as Readonly<Record<string, unknown>>
}

function normalizeStrip(value: unknown, name: string): MixerStripV21 {
	const record = readClosedDomainRecord(value, name, STRIP_FIELDS)
	const effects = readClosedDomainArray(
		readClosedDomainField(record, 'effects', name),
		`${name}.effects`,
		0,
		256,
	).map((effect, index) => normalizeEffect(effect, `${name}.effects[${index}]`))
	return Object.freeze({
		id: normalizeIdentifier(readClosedDomainField(record, 'id', name), `${name}.id`),
		name: normalizeLabel(readClosedDomainField(record, 'name', name), `${name}.name`),
		color: normalizeLabel(readClosedDomainField(record, 'color', name), `${name}.color`),
		gain: normalizeFiniteNumber(readClosedDomainField(record, 'gain', name), `${name}.gain`, 0, 4),
		pan: normalizeFiniteNumber(readClosedDomainField(record, 'pan', name), `${name}.pan`, -1, 1),
		mute: normalizeBoolean(readClosedDomainField(record, 'mute', name), `${name}.mute`),
		solo: normalizeBoolean(readClosedDomainField(record, 'solo', name), `${name}.solo`),
		collapsed: normalizeBoolean(readClosedDomainField(record, 'collapsed', name), `${name}.collapsed`),
		effectsActive: normalizeBoolean(
			readClosedDomainField(record, 'effectsActive', name),
			`${name}.effectsActive`,
		),
		effects: Object.freeze(effects),
		channelCount: normalizePositiveInteger(
			readClosedDomainField(record, 'channelCount', name),
			`${name}.channelCount`,
		),
	})
}

function normalizeEndpoint(value: unknown, name: string, source: boolean): MixerEndpointV21 | MixerEffectSidechainEndpointV21 {
	const kindRecord = readClosedDomainRecord(
		value,
		name,
		['kind', 'id', 'strip', 'effectId'] as const,
		['kind'] as const,
	)
	const kind = readClosedDomainField(kindRecord, 'kind', name)
	if (kind === 'master') {
		readClosedDomainRecord(value, name, ['kind'] as const)
		return Object.freeze({ kind: 'master' })
	}
	if (kind === 'effect-sidechain') {
		if (source) throw new TypeError(`${name} cannot source audio from an effect sidechain`)
		const record = readClosedDomainRecord(value, name, ['kind', 'strip', 'effectId'] as const)
		return Object.freeze({
			kind,
			strip: Object.freeze(normalizeStripRef(readClosedDomainField(record, 'strip', name))),
			effectId: normalizeIdentifier(readClosedDomainField(record, 'effectId', name), `${name}.effectId`),
		})
	}
	if (kind !== 'track' && kind !== 'mixer-node' && kind !== 'output') {
		throw new TypeError(`${name}.kind is unsupported`)
	}
	if (source && kind === 'output') throw new TypeError(`${name} cannot source audio from an output`)
	if (!source && kind === 'track') throw new TypeError(`${name} cannot route into a track`)
	const record = readClosedDomainRecord(value, name, ['kind', 'id'] as const)
	return Object.freeze({
		kind,
		id: normalizeIdentifier(readClosedDomainField(record, 'id', name), `${name}.id`),
	}) as MixerEndpointV21
}

function normalizeEdge(value: unknown, name: string): MixerEdgeV21 {
	const record = readClosedDomainRecord(value, name, EDGE_FIELDS)
	const kind = readClosedDomainField(record, 'kind', name)
	if (kind !== 'assignment' && kind !== 'send' && kind !== 'sidechain') {
		throw new TypeError(`${name}.kind is unsupported`)
	}
	const position = readClosedDomainField(record, 'position', name)
	if (position !== 'pre-fader' && position !== 'post-fader') {
		throw new TypeError(`${name}.position is unsupported`)
	}
	const channelMap = readClosedDomainArray(
		readClosedDomainField(record, 'channelMap', name),
		`${name}.channelMap`,
		0,
		32,
	).map((entry, index) => {
		if (!Number.isSafeInteger(entry) || (entry as number) < -1 || (entry as number) > 31) {
			throw new TypeError(`${name}.channelMap[${index}] must be an integer from -1 through 31`)
		}
		return entry as number
	})
	return Object.freeze({
		id: normalizeIdentifier(readClosedDomainField(record, 'id', name), `${name}.id`),
		kind,
		source: normalizeEndpoint(
			readClosedDomainField(record, 'source', name),
			`${name}.source`,
			true,
		) as MixerEdgeV21['source'],
		destination: normalizeEndpoint(
			readClosedDomainField(record, 'destination', name),
			`${name}.destination`,
			false,
		) as MixerEdgeV21['destination'],
		position,
		level: normalizeFiniteNumber(readClosedDomainField(record, 'level', name), `${name}.level`, 0, 4),
		enabled: normalizeBoolean(readClosedDomainField(record, 'enabled', name), `${name}.enabled`),
		channelMap: Object.freeze(channelMap),
	})
}

function normalizeVca(value: unknown, name: string): MixerVcaV21 {
	const record = readClosedDomainRecord(value, name, VCA_FIELDS)
	const members = readClosedDomainArray(
		readClosedDomainField(record, 'members', name),
		`${name}.members`,
		0,
		MIXER_GRAPH_V21_MAX_ITEMS,
	).map((member) => Object.freeze(normalizeStripRef(member)))
	return Object.freeze({
		id: normalizeIdentifier(readClosedDomainField(record, 'id', name), `${name}.id`),
		name: normalizeLabel(readClosedDomainField(record, 'name', name), `${name}.name`),
		gain: normalizeFiniteNumber(readClosedDomainField(record, 'gain', name), `${name}.gain`, 0, 4),
		mute: normalizeBoolean(readClosedDomainField(record, 'mute', name), `${name}.mute`),
		members: Object.freeze(members),
	})
}

function normalizeOutput(value: unknown, name: string): MixerOutputV21 {
	const record = readClosedDomainRecord(value, name, OUTPUT_FIELDS)
	const role = readClosedDomainField(record, 'role', name)
	if (role !== 'main' && role !== 'cue' && role !== 'control-room' && role !== 'auxiliary') {
		throw new TypeError(`${name}.role is unsupported`)
	}
	return Object.freeze({
		id: normalizeIdentifier(readClosedDomainField(record, 'id', name), `${name}.id`),
		name: normalizeLabel(readClosedDomainField(record, 'name', name), `${name}.name`),
		role,
		channelCount: normalizePositiveInteger(
			readClosedDomainField(record, 'channelCount', name),
			`${name}.channelCount`,
		),
	})
}

export function normalizeMixerGraphV21(value: unknown): MixerGraphV21 {
	const record = readClosedDomainRecord(value, 'mixerGraphV21', TOP_FIELDS)
	if (readClosedDomainField(record, 'schemaVersion', 'mixerGraphV21') !== MIXER_GRAPH_V21_SCHEMA_VERSION) {
		throw new TypeError(`mixerGraphV21.schemaVersion must be ${MIXER_GRAPH_V21_SCHEMA_VERSION}`)
	}
	const normalizeArray = <T>(field: typeof TOP_FIELDS[number], mapper: (entry: unknown, name: string) => T): readonly T[] => {
		const entries = readClosedDomainArray(
			readClosedDomainField(record, field, 'mixerGraphV21'),
			`mixerGraphV21.${field}`,
			0,
			MIXER_GRAPH_V21_MAX_ITEMS,
		)
		return Object.freeze(entries.map((entry, index) => mapper(entry, `mixerGraphV21.${field}[${index}]`)))
	}
	return Object.freeze({
		schemaVersion: MIXER_GRAPH_V21_SCHEMA_VERSION,
		groups: normalizeArray('groups', normalizeStrip),
		sends: normalizeArray('sends', normalizeStrip),
		cues: normalizeArray('cues', normalizeStrip),
		vcas: normalizeArray('vcas', normalizeVca),
		outputs: normalizeArray('outputs', normalizeOutput),
		edges: normalizeArray('edges', normalizeEdge),
	})
}

function endpointKey(endpoint: MixerEdgeV21['source']): string {
	return endpoint.kind === 'master' ? 'master' : `${endpoint.kind}:${endpoint.id}`
}

function stripKey(strip: StripRef): string {
	return strip.kind === 'master' ? 'master' : `${strip.kind}:${strip.id}`
}

function destinationKey(destination: MixerEdgeV21['destination']): string | null {
	if (destination.kind === 'effect-sidechain') return stripKey(destination.strip)
	if (destination.kind === 'output') return null
	return endpointKey(destination)
}

function effectId(effect: { readonly id?: unknown }): string | null {
	return typeof effect.id === 'string' ? effect.id : null
}

export function validateMixerGraphV21(
	value: unknown,
	context: MixerGraphValidationContextV21,
): true {
	const graph = normalizeMixerGraphV21(value)
	const trackIds = new Set<string>()
	for (const track of context.audioTracks) {
		if (trackIds.has(track.id)) throw new TypeError(`duplicate audio track id: ${track.id}`)
		trackIds.add(track.id)
	}
	const nodeById = new Map<string, MixerStripV21>()
	for (const nodes of [graph.groups, graph.sends, graph.cues] as const) {
		for (const node of nodes) {
			if (nodeById.has(node.id)) throw new TypeError(`duplicate mixer node id: ${node.id}`)
			nodeById.set(node.id, node)
		}
	}
	const outputById = new Map<string, MixerOutputV21>()
	for (const output of graph.outputs) {
		if (outputById.has(output.id)) throw new TypeError(`duplicate mixer output id: ${output.id}`)
		outputById.set(output.id, output)
	}
	if (graph.outputs.filter((output) => output.role === 'main').length !== 1) {
		throw new TypeError('mixer graph must declare exactly one main output')
	}
	const existingStrip = (strip: StripRef): boolean => {
		if (strip.kind === 'track') return trackIds.has(strip.id)
		if (strip.kind === 'mixer-node') return nodeById.has(strip.id)
		return true
	}
	const effectsForStrip = (strip: StripRef): readonly { readonly id?: unknown }[] => {
		if (strip.kind === 'track') return context.audioTracks.find((track) => track.id === strip.id)?.effects ?? []
		if (strip.kind === 'mixer-node') {
			return context.mixerNodeEffects?.get(strip.id) ?? nodeById.get(strip.id)?.effects ?? []
		}
		return context.masterEffects ?? []
	}
	const edgeIds = new Set<string>()
	const adjacency = new Map<string, Set<string>>()
	const routingPredecessors = new Map<string, Set<string>>()
	const outputReachable = new Set<string>()
	const outputIncoming = new Map<string, number>()
	const vertices = [
		...Array.from(trackIds, (id) => `track:${id}`),
		...Array.from(nodeById.keys(), (id) => `mixer-node:${id}`),
		'master',
	]
	for (const vertex of vertices) {
		adjacency.set(vertex, new Set<string>())
		routingPredecessors.set(vertex, new Set<string>())
	}
	const masterWidth = Number.isSafeInteger(context.masterChannels) && (context.masterChannels as number) >= 1
		? Math.min(context.masterChannels as number, 32)
		: undefined
	// A track's width follows its clip content rather than the graph document, so it is
	// checked only when the caller resolved it. Callers that cannot are left with the
	// weaker guarantee instead of a stored rule that a clip edit would invalidate.
	const trackWidths = new Map(context.audioTracks.flatMap((track) => (
		Number.isSafeInteger(track.channelCount) && (track.channelCount as number) >= 1
			? [[track.id, Math.min(track.channelCount as number, 32)] as const]
			: []
	)))
	const declaredWidth = (strip: StripRef): number | undefined => (
		strip.kind === 'track' ? trackWidths.get(strip.id)
			: strip.kind === 'master' ? masterWidth : nodeById.get(strip.id)?.channelCount
	)
	for (const edge of graph.edges) {
		if (edgeIds.has(edge.id)) throw new TypeError(`duplicate mixer edge id: ${edge.id}`)
		edgeIds.add(edge.id)
		const source = endpointKey(edge.source)
		if (!adjacency.has(source)) {
			const reason = edge.source.kind === 'track' ? `missing track ${edge.source.id}` : 'dangling source'
			throw new TypeError(`mixer edge ${edge.id} has ${reason}`)
		}
		if (edge.destination.kind === 'effect-sidechain') {
			const destination = edge.destination
			if (edge.kind !== 'sidechain') throw new TypeError(`mixer edge ${edge.id} must use sidechain kind`)
			if (!existingStrip(destination.strip)) {
				throw new TypeError(`mixer edge ${edge.id} has a dangling sidechain strip`)
			}
			if (!effectsForStrip(destination.strip).some((effect) => effectId(effect) === destination.effectId)) {
				throw new TypeError(`mixer edge ${edge.id} has a dangling sidechain effect`)
			}
		} else {
			if (edge.kind === 'sidechain') throw new TypeError(`mixer edge ${edge.id} needs an effect sidechain destination`)
			if (edge.destination.kind === 'mixer-node' && !nodeById.has(edge.destination.id)) {
				throw new TypeError(`mixer edge ${edge.id} has a dangling destination`)
			}
			if (edge.destination.kind === 'output' && !outputById.has(edge.destination.id)) {
				throw new TypeError(`mixer edge ${edge.id} has a dangling output`)
			}
			if (edge.kind === 'send' && edge.destination.kind !== 'mixer-node') {
				throw new TypeError(`mixer send edge ${edge.id} must target a mixer node`)
			}
		}
		if (!edge.enabled) continue
		// Only an edge the runtime actually maps. The map is destination-indexed: entry
		// N names the source channel feeding destination channel N (see
		// defaultMixerChannelMapV21 and applyChannelMap in engine/project-graph-v21.ts),
		// so each side is bounded by its own axis rather than the other's.
		const destinationChannels = edge.destination.kind === 'output'
			? outputById.get(edge.destination.id)?.channelCount
			: edge.destination.kind === 'effect-sidechain'
				? declaredWidth(edge.destination.strip)
				: declaredWidth(edge.destination)
		// A map longer than its destination is authored state the product has shipped
		// documents in, so only an authoring surface rejects it; the stored-document
		// path must keep those projects openable.
		if (context.strictChannelMapLength === true
			&& destinationChannels !== undefined && edge.channelMap.length > destinationChannels) {
			throw new TypeError(`mixer edge ${edge.id} channel map exceeds its destination width`)
		}
		const sourceChannels = declaredWidth(edge.source)
		if (sourceChannels !== undefined && edge.channelMap.some((channel) => channel >= sourceChannels)) {
			throw new TypeError(`mixer edge ${edge.id} channel map reads a missing source channel`)
		}
		const destination = destinationKey(edge.destination)
		if (destination !== null) adjacency.get(source)?.add(destination)
		if (edge.kind !== 'sidechain') {
			if (destination === null) outputReachable.add(source)
			else routingPredecessors.get(destination)?.add(source)
		}
		if (edge.destination.kind === 'output' && edge.kind !== 'sidechain') {
			outputIncoming.set(edge.destination.id, (outputIncoming.get(edge.destination.id) ?? 0) + 1)
		}
	}
	for (const output of graph.outputs) {
		if ((outputIncoming.get(output.id) ?? 0) === 0) {
			throw new TypeError(`mixer output ${output.id} is unreachable`)
		}
	}
	assertAcyclicRoutingV21(vertices, adjacency, 'mixer graph contains a routing cycle')
	const pending = [...outputReachable]
	while (pending.length > 0) {
		const current = pending.pop() as string
		for (const source of routingPredecessors.get(current) ?? []) {
			if (outputReachable.has(source)) continue
			outputReachable.add(source)
			pending.push(source)
		}
	}
	for (const trackId of trackIds) {
		if (!outputReachable.has(`track:${trackId}`)) throw new TypeError(`audio track ${trackId} cannot reach an output`)
	}
	const vcaIds = new Set<string>()
	for (const vca of graph.vcas) {
		if (vcaIds.has(vca.id)) throw new TypeError(`duplicate VCA id: ${vca.id}`)
		vcaIds.add(vca.id)
		const memberIds = new Set<string>()
		for (const member of vca.members) {
			const memberId = stripKey(member)
			if (!existingStrip(member)) throw new TypeError(`VCA ${vca.id} has a dangling member`)
			if (memberIds.has(memberId)) throw new TypeError(`VCA ${vca.id} has a duplicate member`)
			memberIds.add(memberId)
		}
	}
	return true
}

export function createDefaultMixerGraphV21(
	audioTracks: readonly { readonly id: string; readonly channelCount?: number }[],
	masterChannels = 2,
): MixerGraphV21 {
	const channelCount = normalizePositiveInteger(masterChannels, 'masterChannels')
	const seen = new Set<string>()
	const edges: MixerEdgeV21[] = audioTracks.map((track) => {
		const id = normalizeIdentifier(track.id, 'audioTrack.id')
		const sourceChannelCount = track.channelCount === undefined
			? channelCount
			: normalizePositiveInteger(track.channelCount, `audioTrack ${id}.channelCount`)
		if (seen.has(id)) throw new TypeError(`duplicate audio track id: ${id}`)
		seen.add(id)
		return Object.freeze({
			id: `assignment:track:${id}:master`,
			kind: 'assignment',
			source: Object.freeze({ kind: 'track', id }),
			destination: Object.freeze({ kind: 'master' }),
			position: 'post-fader',
			level: 1,
			enabled: true,
			channelMap: defaultMixerChannelMapV21(sourceChannelCount, channelCount),
		})
	})
	edges.push(Object.freeze({
		id: 'assignment:master:output:main',
		kind: 'assignment',
		source: Object.freeze({ kind: 'master' }),
		destination: Object.freeze({ kind: 'output', id: 'main' }),
		position: 'post-fader',
		level: 1,
		enabled: true,
		channelMap: Object.freeze(Array.from({ length: channelCount }, (_, index) => index)),
	}))
	return Object.freeze({
		schemaVersion: MIXER_GRAPH_V21_SCHEMA_VERSION,
		groups: Object.freeze([]),
		sends: Object.freeze([]),
		cues: Object.freeze([]),
		vcas: Object.freeze([]),
		outputs: Object.freeze([{ id: 'main', name: 'Main output', role: 'main' as const, channelCount }]),
		edges: Object.freeze(edges),
	})
}

/** Default destination-indexed mapping: mono duplicates to stereo, wider sources truncate, and other gaps are silent. */
export function defaultMixerChannelMapV21(
	sourceChannels: number,
	destinationChannels: number,
): readonly number[] {
	const sourceWidth = normalizePositiveInteger(sourceChannels, 'sourceChannels')
	const destinationWidth = normalizePositiveInteger(destinationChannels, 'destinationChannels')
	return Object.freeze(Array.from({ length: destinationWidth }, (_value, index) => {
		if (index < sourceWidth) return index
		if (sourceWidth === 1 && index === 1) return 0
		return -1
	}))
}

export function mixerNodeEffectsV21(graph: MixerGraphV21): ReadonlyMap<string, readonly Readonly<Record<string, unknown>>[]> {
	return new Map([...graph.groups, ...graph.sends, ...graph.cues].map((node) => [node.id, node.effects]))
}
