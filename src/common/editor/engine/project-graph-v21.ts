/* SPDX-License-Identifier: AGPL-3.0-only */

import { connectSurroundMonitoring } from '../surround-monitoring.ts';
import { resolveTerminalChannelWidths } from '../terminal-channel-widths.ts';
import { stripParameterDescriptor } from '../effect-parameter-descriptors.ts';
import {
	normalizeMixerGraphV21,
	type MixerEdgeV21,
	type MixerGraphV21,
	type MixerStripV21,
} from '../mixer-graph-v21.ts';
import type { StripRef } from '../parameter-address.ts';
import { addNode, connect, setParam, type AudioNodeArray } from './audio-node-utils.ts';
import { clamp, DEFAULT_SAMPLE_RATE, finite, positiveInteger } from './buffer-math.ts';
import {
	applyEffectRack,
	createAnalyser,
	type EffectAnalyserEntry,
} from './effect-rack.ts';
import { activeRackEffects } from './project-effects.ts';
import {
	compileProjectPathPdcPlanV21,
	type ProjectPathPdcPlanV21,
} from './project-path-pdc-plan-v21.ts';
import type {
	BuildProjectGraphOptions,
	ProjectGraph,
	ProjectGraphLatencyOptions,
	ScheduledGainParam,
} from './project-graph.ts';
import { ScheduledParameterRegistry } from './scheduled-parameter-registry.ts';
import {
	createStripMeterAnalyserBankV21,
	type StripMeterAnalyserBankV21,
} from './strip-meter-analyser-bank-v21.ts';
import type { EngineEffect, EngineProject, EngineTrack } from './types.ts';

const MAXIMUM_COMPENSATION_SECONDS = 60;

interface AudioTrackV21 extends EngineTrack {
	readonly id: string;
	readonly type: 'audio';
}

interface StripRuntimeV21 {
	readonly key: string;
	readonly ref: StripRef;
	readonly id: string | null;
	readonly scope: 'track' | 'group' | 'send' | 'master';
	readonly input: AudioNode;
	readonly width: number;
	readonly gain: number;
	readonly pan: number;
	readonly mute: boolean;
	readonly solo: boolean;
	readonly effects: readonly EngineEffect[];
}

interface StripTapsV21 {
	readonly pre: AudioNode;
	readonly post: AudioNode;
	readonly width: number;
}

interface PreparedProjectV21 {
	readonly graph: MixerGraphV21;
	readonly tracks: readonly AudioTrackV21[];
	readonly plan: ProjectPathPdcPlanV21;
}

export function projectGraphLatencyFramesV21(
	project: EngineProject,
	options: ProjectGraphLatencyOptions = {},
): number {
	return prepareProjectV21(project, options.includeMaster !== false, options.sampleRate).plan.latencyFrames;
}

/** Compile the exact V21 graph. Every audible path is owned by one persisted edge. */
export function buildProjectGraphV21(
	context: BaseAudioContext,
	destination: AudioNode,
	project: EngineProject,
	options: BuildProjectGraphOptions = {},
): ProjectGraph {
	const {
		metering = true,
		respectMuteSolo = true,
		trackId: onlyTrackId = null,
		includeMaster = true,
		includeTrackPan = true,
		effectAnalysis = false,
		monitoring = false,
		parametricEqWasmModule = null,
		onParametricEqError,
	} = options;
	const sampleRate = context.sampleRate || DEFAULT_SAMPLE_RATE;
	const prepared = prepareProjectV21(project, includeMaster, sampleRate);
	const { graph, tracks, plan } = prepared;
	const nodes: AudioNodeArray = [];
	const sources = new Set<AudioScheduledSourceNode>();
	const parameterRegistry = new ScheduledParameterRegistry();
	const trackInputs = new Map<string, AudioNode>();
	const trackGainParams = new Map<string, ScheduledGainParam>();
	const groupGainParams = new Map<string, ScheduledGainParam>();
	const sendGainParams = new Map<string, ScheduledGainParam>();
	const edgeGainParams = new Map<string, ScheduledGainParam>();
	const trackAnalysers = new Map<string, AnalyserNode>();
	const groupAnalysers = new Map<string, AnalyserNode>();
	const sendAnalysers = new Map<string, AnalyserNode>();
	const effectNodes = new Map<string, AudioNode>();
	const effectAnalysers = new Map<string, EffectAnalyserEntry>();
	const effectMessageSequences = new Map<string, number>();
	const productionStripAnalysersV21 = new Map<string, StripMeterAnalyserBankV21>();
	const trackWidths = resolveTerminalChannelWidths(project, project.masterChannels).tracks;
	const compensatedTrackInputs = new Map<string, AudioNode>();
	for (const track of tracks) {
		const input = addNode(nodes, context.createGain());
		trackInputs.set(track.id, input);
		compensatedTrackInputs.set(track.id, applyEdgeCompensation(
			context,
			nodes,
			input,
			plan.nodeInputLatencyFrames.get(`track:${track.id}`) ?? 0,
		));
	}
	const mixerInputs = new Map<string, AudioNode>();
	for (const strip of [...graph.groups, ...graph.sends, ...graph.cues]) {
		mixerInputs.set(strip.id, addNode(nodes, context.createGain()));
	}
	const masterInput = addNode(nodes, context.createGain());
	const outputInputs = new Map(graph.outputs.map((output) => [output.id, addNode(nodes, context.createGain())]));
	const sidechainInputs = createSidechainInputs(context, nodes, graph);
	const soloActive = createSoloResolver(graph, tracks, respectMuteSolo);
	const strips = createStripRuntimes(
		project,
		graph,
		tracks,
		compensatedTrackInputs,
		mixerInputs,
		masterInput,
		trackWidths,
		includeMaster,
	);
	const taps = new Map<string, StripTapsV21>();
	for (const strip of strips) {
		const latencyFrames = plan.nodeOutputLatencyFrames.get(strip.key) ?? 0;
		const explicitSidechains = sidechainInputs.get(strip.key);
		let output = applyEffectRack(context, strip.input, strip.effects, nodes, {
			sidechainInputByEffectId: explicitSidechains,
			scope: strip.scope,
			targetId: strip.id,
			effectAnalysis,
			effectNodes,
			effectAnalysers,
			parameterRegistry,
			baseParameterLatencyFrames: plan.nodeInputLatencyFrames.get(strip.key) ?? 0,
			effectChannelCount: strip.width,
			parametricEqWasmModule,
			parametricEqChannelCount: strip.width,
			onParametricEqError,
		});
		const pre = output;
		const vcaFactor = stripVcaFactor(graph, strip.ref, includeMaster);
		const gain = addNode(nodes, context.createGain());
		setParam(gain.gain, strip.gain, context.currentTime);
		registerStripParam(parameterRegistry, strip.ref, 'gain', gain.gain, latencyFrames);
		connect(output, gain);
		output = gain;
		const scheduledGain = { param: gain.gain, latencyFrames };
		if (strip.scope === 'track' && strip.id !== null) trackGainParams.set(strip.id, scheduledGain);
		else if ((strip.scope === 'group' || strip.scope === 'send') && strip.id !== null) {
			if (graph.groups.some(({ id }) => id === strip.id)) groupGainParams.set(strip.id, scheduledGain);
			else sendGainParams.set(strip.id, scheduledGain);
		}
		if (includeTrackPan && strip.width <= 2 && typeof context.createStereoPanner === 'function') {
			const panner = addNode(nodes, context.createStereoPanner());
			setParam(panner.pan, clamp(strip.pan, -1, 1), context.currentTime);
			registerStripParam(parameterRegistry, strip.ref, 'pan', panner.pan, latencyFrames);
			connect(output, panner);
			output = panner;
		}
		const gate = addNode(nodes, context.createGain());
		const audible = (!respectMuteSolo || !strip.mute) && soloActive(strip.key);
		setParam(gate.gain, audible ? 1 : 0, context.currentTime);
		registerStripParam(
			parameterRegistry,
			strip.ref,
			'mute',
			gate.gain,
			latencyFrames,
			(value) => respectMuteSolo && soloActive(strip.key) ? 1 - value : respectMuteSolo ? 0 : 1,
		);
		connect(output, gate);
		output = gate;
		const vcaGain = addNode(nodes, context.createGain());
		setParam(vcaGain.gain, vcaFactor, context.currentTime);
		connect(output, vcaGain);
		output = vcaGain;
		const productionAnalysers = metering
			? createStripMeterAnalyserBankV21(context, nodes, output, strip.ref, strip.width)
			: null;
		if (productionAnalysers) {
			productionStripAnalysersV21.set(strip.key, productionAnalysers);
			output = productionAnalysers.output;
		}
		const analyser = metering ? createAnalyser(context, nodes) : null;
		if (analyser) {
			connect(output, analyser);
			output = analyser;
			if (strip.scope === 'track' && strip.id !== null) trackAnalysers.set(strip.id, analyser);
			else if ((strip.scope === 'group' || strip.scope === 'send') && strip.id !== null) {
				if (graph.groups.some(({ id }) => id === strip.id)) groupAnalysers.set(strip.id, analyser);
				else sendAnalysers.set(strip.id, analyser);
			}
		}
		taps.set(strip.key, Object.freeze({ pre, post: output, width: strip.width }));
	}
	for (const edge of graph.edges) {
		const source = taps.get(endpointKey(edge.source));
		if (!source) throw new TypeError(`V21 mixer edge ${edge.id} has no runtime source.`);
		const edgeLatency = plan.automationLatencyFrames({ kind: 'edge', edgeId: edge.id, parameterId: 'level' });
		const level = addNode(nodes, context.createGain());
		setParam(level.gain, edge.level, context.currentTime);
		registerEdgeParam(parameterRegistry, edge.id, level.gain, edgeLatency);
		edgeGainParams.set(edge.id, { param: level.gain, latencyFrames: edgeLatency });
		if (!edge.enabled || excludedTrackEdge(edge, onlyTrackId)) continue;
		connect(edge.position === 'pre-fader' ? source.pre : source.post, level);
		let output: AudioNode = level;
		const destinationWidth = edgeDestinationWidth(edge, graph, tracks, trackWidths, project.masterChannels);
		output = applyChannelMap(context, nodes, output, source.width, destinationWidth, edge);
		output = applyEdgeCompensation(context, nodes, output, plan.edgeCompensationFrames.get(edge.id) ?? 0);
		connect(output, edgeDestinationInput(edge, mixerInputs, masterInput, outputInputs, sidechainInputs));
	}
	const mainOutput = graph.outputs.find(({ role }) => role === 'main');
	if (!mainOutput) throw new TypeError('The V21 mixer graph has no main output.');
	let mainConnection: AudioNode = outputInputs.get(mainOutput.id)!;
	const masterAnalyser = metering ? createAnalyser(context, nodes) : null;
	if (masterAnalyser) {
		connect(mainConnection, masterAnalyser);
		mainConnection = masterAnalyser;
	}
	if (monitoring) {
		connectSurroundMonitoring(context, mainConnection, destination, mainOutput.channelCount, nodes);
	} else connect(mainConnection, destination);
	return {
		nodes,
		sources,
		abortController: new AbortController(),
		trackInputs,
		trackGainParams,
		projectGainParams: {
			tracks: trackGainParams,
			groups: groupGainParams,
			sends: sendGainParams,
			master: includeMaster ? trackMasterGain(strips, parameterRegistry) : null,
		},
		parameterRegistry,
		trackAnalysers,
		groupAnalysers,
		sendAnalysers,
		masterAnalyser,
		effectNodes,
		effectAnalysers,
		effectMessageSequences,
		mixerEdgeGainParams: edgeGainParams,
		pathPdcPlanV21: plan,
		productionStripAnalysersV21,
		latencyFrames: plan.latencyFrames,
	};
}

function prepareProjectV21(
	project: EngineProject,
	includeMaster: boolean,
	sampleRateValue: unknown,
): PreparedProjectV21 {
	const tracks = Object.freeze((project.tracks ?? []).flatMap((track) => (
		track?.type === 'audio' && typeof track.id === 'string'
			? [track as AudioTrackV21]
			: []
	)));
	const graph = normalizeMixerGraphV21(project.mixer);
	const runtimeGraph = includeMaster ? graph : withoutMasterEffects(graph);
	const pdcProject = includeMaster ? project : {
		...project,
		master: { ...project.master, effectsActive: false, effects: [] },
		mixer: runtimeGraph,
	};
	const sampleRate = sampleRateValue === undefined
		? Number(project.sampleRate ?? DEFAULT_SAMPLE_RATE)
		: Number(sampleRateValue);
	return Object.freeze({
		graph: runtimeGraph,
		tracks,
		plan: compileProjectPathPdcPlanV21(pdcProject, { sampleRate }),
	});
}

function withoutMasterEffects(graph: MixerGraphV21): MixerGraphV21 {
	return Object.freeze({
		...graph,
		edges: Object.freeze(graph.edges.filter((edge) => !(
			edge.destination.kind === 'effect-sidechain'
			&& edge.destination.strip.kind === 'master'
		))),
	});
}

function createStripRuntimes(
	project: EngineProject,
	graph: MixerGraphV21,
	tracks: readonly AudioTrackV21[],
	trackInputs: ReadonlyMap<string, AudioNode>,
	mixerInputs: ReadonlyMap<string, AudioNode>,
	masterInput: AudioNode,
	trackWidths: ReadonlyMap<string, number>,
	includeMaster: boolean,
): readonly StripRuntimeV21[] {
	const result: StripRuntimeV21[] = tracks.map((track) => ({
		key: `track:${track.id}`,
		ref: { kind: 'track', id: track.id },
		id: track.id,
		scope: 'track',
		input: trackInputs.get(track.id)!,
		width: trackWidths.get(track.id) ?? 2,
		gain: finite(track.gain, 1),
		pan: finite(track.pan, 0),
		mute: Boolean(track.mute),
		solo: Boolean(track.solo),
		effects: activeRackEffects(track),
	}));
	for (const strip of [...graph.groups, ...graph.sends, ...graph.cues]) {
		result.push({
			key: `mixer-node:${strip.id}`,
			ref: { kind: 'mixer-node', id: strip.id },
			id: strip.id,
			scope: graph.sends.some(({ id }) => id === strip.id) ? 'send' : 'group',
			input: mixerInputs.get(strip.id)!,
			width: strip.channelCount,
			gain: strip.gain,
			pan: strip.pan,
			mute: strip.mute,
			solo: strip.solo,
			effects: activeRackEffects(strip as unknown as { effectsActive: boolean; effects: readonly EngineEffect[] }),
		});
	}
	result.push({
		key: 'master',
		ref: { kind: 'master' },
		id: null,
		scope: 'master',
		input: masterInput,
		width: clamp(positiveInteger(project.masterChannels, 2), 1, 32),
		gain: includeMaster ? finite(project.master?.gain, 1) : 1,
		pan: includeMaster ? finite(project.master?.pan, 0) : 0,
		mute: includeMaster && Boolean(project.master?.mute),
		solo: includeMaster && Boolean(project.master?.solo),
		effects: includeMaster ? activeRackEffects(project.master) : [],
	});
	return Object.freeze(result);
}

function createSidechainInputs(
	context: BaseAudioContext,
	nodes: AudioNodeArray,
	graph: MixerGraphV21,
): ReadonlyMap<string, ReadonlyMap<string, AudioNode>> {
	const result = new Map<string, Map<string, AudioNode>>();
	for (const edge of graph.edges) {
		if (!edge.enabled || edge.destination.kind !== 'effect-sidechain') continue;
		const key = stripKey(edge.destination.strip);
		let effects = result.get(key);
		if (!effects) {
			effects = new Map();
			result.set(key, effects);
		}
		if (!effects.has(edge.destination.effectId)) {
			effects.set(edge.destination.effectId, addNode(nodes, context.createGain()));
		}
	}
	return result;
}

function createSoloResolver(
	graph: MixerGraphV21,
	tracks: readonly AudioTrackV21[],
	respectMuteSolo: boolean,
): (key: string) => boolean {
	if (!respectMuteSolo) return () => true;
	const solos = new Set<string>();
	for (const track of tracks) if (track.solo) solos.add(`track:${track.id}`);
	for (const strip of [...graph.groups, ...graph.sends, ...graph.cues]) {
		if (strip.solo) solos.add(`mixer-node:${strip.id}`);
	}
	if (!solos.size) return () => true;
	const adjacency = new Map<string, Set<string>>();
	for (const edge of graph.edges) {
		if (!edge.enabled || edge.destination.kind === 'effect-sidechain'
			|| edge.destination.kind === 'output') continue;
		const source = endpointKey(edge.source);
		const destination = endpointKey(edge.destination);
		if (!adjacency.has(source)) adjacency.set(source, new Set());
		adjacency.get(source)!.add(destination);
	}
	const reaches = (from: string, to: string): boolean => {
		const pending = [from];
		const seen = new Set<string>();
		while (pending.length) {
			const current = pending.pop()!;
			if (current === to) return true;
			if (seen.has(current)) continue;
			seen.add(current);
			pending.push(...(adjacency.get(current) ?? []));
		}
		return false;
	};
	return (key) => [...solos].some((solo) => reaches(key, solo) || reaches(solo, key));
}

function stripVcaFactor(graph: MixerGraphV21, ref: StripRef, includeMaster: boolean): number {
	if (!includeMaster && ref.kind === 'master') return 1;
	let factor = 1;
	for (const vca of graph.vcas) {
		if (!vca.members.some((member) => stripKey(member) === stripKey(ref))) continue;
		factor *= vca.mute ? 0 : vca.gain;
	}
	return factor;
}

function applyChannelMap(
	context: BaseAudioContext,
	nodes: AudioNodeArray,
	input: AudioNode,
	sourceWidth: number,
	destinationWidth: number,
	edge: MixerEdgeV21,
): AudioNode {
	const map = edge.channelMap;
	if (!map.length || (
		map.length === destinationWidth
		&& sourceWidth === destinationWidth
		&& map.every((source, destination) => source === destination)
	)) return input;
	if (map.length > destinationWidth) throw new RangeError(`V21 mixer edge ${edge.id} maps beyond its destination width.`);
	if (map.some((source) => source >= sourceWidth)) {
		throw new RangeError(`V21 mixer edge ${edge.id} maps a missing source channel.`);
	}
	if (typeof context.createChannelSplitter !== 'function' || typeof context.createChannelMerger !== 'function') {
		throw new Error('This browser cannot apply an explicit V21 mixer channel map.');
	}
	const splitter = addNode(nodes, context.createChannelSplitter(sourceWidth));
	const merger = addNode(nodes, context.createChannelMerger(destinationWidth));
	connect(input, splitter);
	for (const [destinationChannel, sourceChannel] of map.entries()) {
		if (sourceChannel >= 0) connect(splitter, merger, sourceChannel, destinationChannel);
	}
	return merger;
}

function applyEdgeCompensation(
	context: BaseAudioContext,
	nodes: AudioNodeArray,
	input: AudioNode,
	frames: number,
): AudioNode {
	if (frames <= 0) return input;
	if (!Number.isSafeInteger(frames)) throw new RangeError('V21 PDC compensation must be an integer frame count.');
	if (typeof context.createDelay !== 'function') {
		throw new Error('This browser cannot apply V21 per-path delay compensation.');
	}
	const seconds = frames / (context.sampleRate || DEFAULT_SAMPLE_RATE);
	if (seconds > MAXIMUM_COMPENSATION_SECONDS) {
		throw new RangeError('V21 per-path delay compensation exceeds the runtime limit.');
	}
	const delay = addNode(nodes, context.createDelay(Math.max(1, seconds)));
	setParam(delay.delayTime, seconds, context.currentTime);
	connect(input, delay);
	return delay;
}

function edgeDestinationInput(
	edge: MixerEdgeV21,
	mixerInputs: ReadonlyMap<string, AudioNode>,
	masterInput: AudioNode,
	outputInputs: ReadonlyMap<string, AudioNode>,
	sidechainInputs: ReadonlyMap<string, ReadonlyMap<string, AudioNode>>,
): AudioNode {
	const destination = edge.destination;
	if (destination.kind === 'master') return masterInput;
	if (destination.kind === 'mixer-node') return mixerInputs.get(destination.id)!;
	if (destination.kind === 'output') return outputInputs.get(destination.id)!;
	return sidechainInputs.get(stripKey(destination.strip))!.get(destination.effectId)!;
}

function edgeDestinationWidth(
	edge: MixerEdgeV21,
	graph: MixerGraphV21,
	tracks: readonly AudioTrackV21[],
	trackWidths: ReadonlyMap<string, number>,
	masterChannels: unknown,
): number {
	const destination = edge.destination;
	if (destination.kind === 'master') return clamp(positiveInteger(masterChannels, 2), 1, 32);
	if (destination.kind === 'mixer-node') return mixerStrip(graph, destination.id).channelCount;
	if (destination.kind === 'output') return graph.outputs.find(({ id }) => id === destination.id)!.channelCount;
	if (destination.strip.kind === 'master') return clamp(positiveInteger(masterChannels, 2), 1, 32);
	if (destination.strip.kind === 'mixer-node') return mixerStrip(graph, destination.strip.id).channelCount;
	const trackId = destination.strip.kind === 'track' ? destination.strip.id : '';
	return trackWidths.get(tracks.find(({ id }) => id === trackId)?.id ?? '') ?? 2;
}

function mixerStrip(graph: MixerGraphV21, id: string): MixerStripV21 {
	const strip = [...graph.groups, ...graph.sends, ...graph.cues].find((candidate) => candidate.id === id);
	if (!strip) throw new TypeError(`Unknown V21 mixer node: ${id}.`);
	return strip;
}

function excludedTrackEdge(edge: MixerEdgeV21, onlyTrackId: unknown): boolean {
	return onlyTrackId != null
		&& edge.kind !== 'sidechain'
		&& edge.source.kind === 'track'
		&& edge.source.id !== String(onlyTrackId);
}

function endpointKey(endpoint: Exclude<MixerEdgeV21['destination'], { kind: 'effect-sidechain' | 'output' }>
	| MixerEdgeV21['source']): string {
	return endpoint.kind === 'master' ? 'master' : `${endpoint.kind}:${endpoint.id}`;
}

function stripKey(strip: StripRef): string {
	return strip.kind === 'master' ? 'master' : `${strip.kind}:${strip.id}`;
}

function registerStripParam(
	registry: ScheduledParameterRegistry,
	strip: StripRef,
	parameterId: 'gain' | 'pan' | 'mute',
	param: AudioParam,
	latencyFrames: number,
	transformValue?: (value: number) => number,
): void {
	if (!isSchedulableAudioParam(param)) return;
	registry.registerAudioParam(
		stripParameterDescriptor({ kind: 'strip', strip, parameterId }, latencyFrames),
		param,
		transformValue ? { latencyFrames, transformValue } : { latencyFrames },
	);
}

function registerEdgeParam(
	registry: ScheduledParameterRegistry,
	edgeId: string,
	param: AudioParam,
	latencyFrames: number,
): void {
	if (!isSchedulableAudioParam(param)) return;
	registry.registerAudioParam(
		stripParameterDescriptor({ kind: 'edge', edgeId, parameterId: 'level' }, latencyFrames),
		param,
		{ latencyFrames },
	);
}

function trackMasterGain(
	strips: readonly StripRuntimeV21[],
	registry: ScheduledParameterRegistry,
): ScheduledGainParam | null {
	if (!strips.some(({ key }) => key === 'master')) return null;
	const target = registry.get({ kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' });
	if (!target || target.binding.kind !== 'audio-param') return null;
	return { param: target.binding.params[0]!.param, latencyFrames: target.latencyFrames };
}

function isSchedulableAudioParam(param: AudioParam | null | undefined): param is AudioParam {
	return typeof param?.setValueAtTime === 'function'
		&& typeof param.linearRampToValueAtTime === 'function';
}

// Kept local so the V21 branch does not inherit the legacy global DOM alias.
interface AudioScheduledSourceNode {
	stop(): void;
	disconnect?(): void;
}
