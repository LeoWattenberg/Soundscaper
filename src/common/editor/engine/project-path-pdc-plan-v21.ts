/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	mixerNodeEffectsV21,
	normalizeMixerGraphV21,
	validateMixerGraphV21,
	type MixerEdgeV21,
	type MixerGraphV21,
	type MixerStripV21,
} from '../mixer-graph-v21.ts'
import {
	normalizeParameterAddress,
	type ParameterAddress,
	type StripRef,
} from '../parameter-address.ts'
import { effectLatencyFrames } from './effect-rack.ts'
import type { EngineEffect } from './types.ts'

export interface ProjectPathPdcPlanV21 {
	readonly nodeInputLatencyFrames: ReadonlyMap<string, number>
	readonly nodeOutputLatencyFrames: ReadonlyMap<string, number>
	readonly edgeCompensationFrames: ReadonlyMap<string, number>
	readonly outputLatencyFrames: ReadonlyMap<string, number>
	readonly freezeLatencyFramesByTrack: ReadonlyMap<string, number>
	readonly latencyFrames: number
	readonly monitoringLatencyFrames: number
	readonly renderLatencyFrames: number
	automationLatencyFrames(address: unknown): number
}

export interface ProjectPathPdcOptionsV21 {
	readonly sampleRate?: number
}

interface ProjectEffectHostV21 {
	readonly effectsActive?: unknown
	readonly effects?: unknown
}

interface ProjectTrackV21 extends ProjectEffectHostV21 {
	readonly id: unknown
	readonly type?: unknown
}

interface ProjectForPdcV21 {
	readonly sampleRate?: unknown
	readonly masterChannels?: unknown
	readonly tracks?: unknown
	readonly master?: ProjectEffectHostV21
	readonly mixer?: unknown
}

interface VertexState {
	readonly key: string
	readonly effects: readonly EngineEffect[]
	readonly effectPrefixFrames: ReadonlyMap<string, number>
	readonly rackLatencyFrames: number
}

interface Dependency {
	readonly edge: MixerEdgeV21
	readonly source: string
	readonly destination: string
	readonly effectPrefixFrames: number
}

const DEFAULT_SAMPLE_RATE = 48_000

export function compileProjectPathPdcPlanV21(
	projectValue: ProjectForPdcV21,
	options: ProjectPathPdcOptionsV21 = {},
): ProjectPathPdcPlanV21 {
	if (!projectValue || typeof projectValue !== 'object') throw new TypeError('A V21 project is required')
	const sampleRate = normalizeSampleRate(options.sampleRate ?? projectValue.sampleRate ?? DEFAULT_SAMPLE_RATE)
	const tracks = normalizeAudioTracks(projectValue.tracks)
	const graph = normalizeMixerGraphV21(projectValue.mixer)
	const masterEffects = activeEffects(projectValue.master)
	validateMixerGraphV21(graph, {
		audioTracks: tracks,
		masterEffects,
		masterChannels: Number(projectValue.masterChannels),
		mixerNodeEffects: mixerNodeEffectsV21(graph),
	})
	const states = createVertexStates(graph, tracks, masterEffects, sampleRate)
	const dependencies = createDependencies(graph, states)
	const orderedVertices = topologicalOrder(states, dependencies)
	const inputFrames = new Map<string, number>()
	const outputFrames = new Map<string, number>()
	for (const vertex of orderedVertices) {
		let input = 0
		for (const dependency of dependencies) {
			if (dependency.destination !== vertex) continue
			const sourceOutput = outputFrames.get(dependency.source)
			if (sourceOutput === undefined) throw new TypeError(`PDC source ${dependency.source} was not compiled`)
			input = Math.max(input, sourceOutput - dependency.effectPrefixFrames)
		}
		input = Math.max(0, input)
		inputFrames.set(vertex, input)
		outputFrames.set(vertex, input + (states.get(vertex)?.rackLatencyFrames ?? 0))
	}
	const edgeCompensationFrames = new Map<string, number>()
	const outputLatencyFrames = new Map<string, number>()
	for (const output of graph.outputs) {
		const incoming = graph.edges.filter((edge) => (
			edge.enabled
			&& edge.kind !== 'sidechain'
			&& edge.destination.kind === 'output'
			&& edge.destination.id === output.id
		))
		const latency = Math.max(...incoming.map((edge) => outputFrames.get(endpointKey(edge.source)) ?? 0), 0)
		outputLatencyFrames.set(output.id, latency)
		for (const edge of incoming) {
			edgeCompensationFrames.set(
				edge.id,
				exactCompensationFrames(latency - (outputFrames.get(endpointKey(edge.source)) ?? 0), edge.id),
			)
		}
	}
	for (const edge of graph.edges) {
		if (!edge.enabled) {
			edgeCompensationFrames.set(edge.id, 0)
			continue
		}
		if (edge.destination.kind === 'output') continue
		const destination = destinationVertex(edge)
		const sourceOutput = outputFrames.get(endpointKey(edge.source)) ?? 0
		const destinationInput = inputFrames.get(destination) ?? 0
		const effectPrefix = sidechainPrefix(edge, states)
		edgeCompensationFrames.set(
			edge.id,
			exactCompensationFrames(destinationInput + effectPrefix - sourceOutput, edge.id),
		)
	}
	const latencyFrames = Math.max(...outputLatencyFrames.values(), 0)
	const freezeLatencyFramesByTrack = new Map<string, number>()
	for (const track of tracks) {
		freezeLatencyFramesByTrack.set(track.id, states.get(`track:${track.id}`)?.rackLatencyFrames ?? 0)
	}
	const automationLatencyFrames = createAutomationLatencyResolver(
		graph,
		states,
		inputFrames,
		outputFrames,
		edgeCompensationFrames,
	)
	return Object.freeze({
		nodeInputLatencyFrames: inputFrames,
		nodeOutputLatencyFrames: outputFrames,
		edgeCompensationFrames,
		outputLatencyFrames,
		freezeLatencyFramesByTrack,
		latencyFrames,
		monitoringLatencyFrames: latencyFrames,
		renderLatencyFrames: latencyFrames,
		automationLatencyFrames,
	})
}

function normalizeSampleRate(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) < 8_000 || (value as number) > 768_000) {
		throw new TypeError('PDC sampleRate must be an integer from 8000 through 768000')
	}
	return value as number
}

function normalizeAudioTracks(value: unknown): readonly (ProjectTrackV21 & {
	readonly id: string
	readonly effects: readonly EngineEffect[]
})[] {
	if (!Array.isArray(value)) throw new TypeError('PDC project tracks must be an array')
	return Object.freeze(value.flatMap((candidate) => {
		if (!candidate || typeof candidate !== 'object') throw new TypeError('PDC project track must be an object')
		const track = candidate as ProjectTrackV21
		if (track.type !== 'audio') return []
		if (typeof track.id !== 'string' || track.id.length === 0) throw new TypeError('PDC audio track needs an id')
		return [{ ...track, id: track.id, effects: activeEffects(track) }]
	}))
}

function activeEffects(host: ProjectEffectHostV21 | undefined): readonly EngineEffect[] {
	if (host?.effectsActive === false || !Array.isArray(host?.effects)) return Object.freeze([])
	return Object.freeze(host.effects.filter((effect): effect is EngineEffect => (
		Boolean(effect) && typeof effect === 'object'
	)))
}

function stripEffects(strip: MixerStripV21): readonly EngineEffect[] {
	if (!strip.effectsActive) return Object.freeze([])
	return strip.effects as readonly unknown[] as readonly EngineEffect[]
}

function createVertexState(key: string, effects: readonly EngineEffect[], sampleRate: number): VertexState {
	let latency = 0
	const prefixes = new Map<string, number>()
	for (const effect of effects) {
		if (typeof effect.id === 'string') prefixes.set(effect.id, latency)
		if (effect.enabled !== false && effect.bypassed !== true) latency += effectLatencyFrames(effect, sampleRate)
	}
	return Object.freeze({
		key,
		effects,
		effectPrefixFrames: prefixes,
		rackLatencyFrames: latency,
	})
}

function createVertexStates(
	graph: MixerGraphV21,
	tracks: readonly { readonly id: string; readonly effects: readonly EngineEffect[] }[],
	masterEffects: readonly EngineEffect[],
	sampleRate: number,
): ReadonlyMap<string, VertexState> {
	const states = new Map<string, VertexState>()
	for (const track of tracks) {
		states.set(`track:${track.id}`, createVertexState(`track:${track.id}`, track.effects, sampleRate))
	}
	for (const node of [...graph.groups, ...graph.sends, ...graph.cues]) {
		states.set(`mixer-node:${node.id}`, createVertexState(
			`mixer-node:${node.id}`,
			stripEffects(node),
			sampleRate,
		))
	}
	states.set('master', createVertexState('master', masterEffects, sampleRate))
	return states
}

function endpointKey(endpoint: MixerEdgeV21['source']): string {
	return endpoint.kind === 'master' ? 'master' : `${endpoint.kind}:${endpoint.id}`
}

function stripKey(strip: StripRef): string {
	return strip.kind === 'master' ? 'master' : `${strip.kind}:${strip.id}`
}

function destinationVertex(edge: MixerEdgeV21): string {
	if (edge.destination.kind === 'effect-sidechain') return stripKey(edge.destination.strip)
	if (edge.destination.kind === 'master') return 'master'
	if (edge.destination.kind === 'mixer-node') return `mixer-node:${edge.destination.id}`
	throw new TypeError(`PDC edge ${edge.id} terminates at an output`)
}

function sidechainPrefix(edge: MixerEdgeV21, states: ReadonlyMap<string, VertexState>): number {
	if (edge.destination.kind !== 'effect-sidechain') return 0
	const prefix = states.get(stripKey(edge.destination.strip))?.effectPrefixFrames.get(edge.destination.effectId)
	if (prefix === undefined) throw new TypeError(`PDC edge ${edge.id} has an unknown sidechain effect`)
	return prefix
}

function createDependencies(
	graph: MixerGraphV21,
	states: ReadonlyMap<string, VertexState>,
): readonly Dependency[] {
	return Object.freeze(graph.edges.flatMap((edge) => {
		if (!edge.enabled || edge.destination.kind === 'output') return []
		return [Object.freeze({
			edge,
			source: endpointKey(edge.source),
			destination: destinationVertex(edge),
			effectPrefixFrames: sidechainPrefix(edge, states),
		})]
	}))
}

function topologicalOrder(
	states: ReadonlyMap<string, VertexState>,
	dependencies: readonly Dependency[],
): readonly string[] {
	const indegree = new Map(Array.from(states.keys(), (key) => [key, 0]))
	const outgoing = new Map(Array.from(states.keys(), (key) => [key, [] as string[]]))
	for (const dependency of dependencies) {
		indegree.set(dependency.destination, (indegree.get(dependency.destination) ?? 0) + 1)
		outgoing.get(dependency.source)?.push(dependency.destination)
	}
	const ready = Array.from(indegree, ([key, degree]) => degree === 0 ? key : null)
		.filter((key): key is string => key !== null)
		.sort()
	const result: string[] = []
	while (ready.length > 0) {
		const current = ready.shift() as string
		result.push(current)
		for (const next of outgoing.get(current) ?? []) {
			const degree = (indegree.get(next) ?? 0) - 1
			indegree.set(next, degree)
			if (degree === 0) {
				ready.push(next)
				ready.sort()
			}
		}
	}
	if (result.length !== states.size) throw new TypeError('PDC routing graph contains a cycle')
	return Object.freeze(result)
}

/**
 * Admit only a compensation the routing solve can actually realize. Unreachable for a
 * graph accepted by validateMixerGraphV21, because the topological solve raises every
 * destination input to at least its source output. It replaces a self-comparison that
 * recomputed its own inputs and so could only ever report zero: this fires at the
 * moment of computation, so a future change to createDependencies fails loudly instead
 * of silently misaligning audio.
 */
function exactCompensationFrames(frames: number, edgeId: string): number {
	if (!Number.isSafeInteger(frames) || frames < 0) {
		throw new TypeError(`PDC edge ${edgeId} requires impossible compensation`)
	}
	return frames
}

function createAutomationLatencyResolver(
	graph: MixerGraphV21,
	states: ReadonlyMap<string, VertexState>,
	inputFrames: ReadonlyMap<string, number>,
	outputFrames: ReadonlyMap<string, number>,
	compensationFrames: ReadonlyMap<string, number>,
): (address: unknown) => number {
	const edges = new Map(graph.edges.map((edge) => [edge.id, edge]))
	return (value: unknown): number => {
		const address: ParameterAddress = normalizeParameterAddress(value)
		if (address.kind === 'strip') return outputFrames.get(stripKey(address.strip)) ?? 0
		if (address.kind === 'edge') {
			const edge = edges.get(address.edgeId)
			if (edge === undefined) throw new TypeError(`Automation addresses unknown mixer edge ${address.edgeId}`)
			return (outputFrames.get(endpointKey(edge.source)) ?? 0) + (compensationFrames.get(edge.id) ?? 0)
		}
		const state = states.get(stripKey(address.strip))
		const prefix = state?.effectPrefixFrames.get(address.effectId)
		if (prefix === undefined) throw new TypeError(`Automation addresses unknown effect ${address.effectId}`)
		return (inputFrames.get(stripKey(address.strip)) ?? 0) + prefix
	}
}
