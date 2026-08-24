/* SPDX-License-Identifier: AGPL-3.0-only */

import { connectSurroundMonitoring } from '../surround-monitoring.ts';
import { isProductionMixerProjectSchema } from '../project-schema-version.ts';
import { resolveTerminalChannelWidths } from '../terminal-channel-widths.ts';
import { projectTrackFolderMediaStateV12 } from '../track-folder-media-runtime.ts';
import { stripParameterDescriptor } from '../effect-parameter-descriptors.ts';
import { legacySendEdgeId, type StripRef } from '../parameter-address.ts';
import { createAdmProgrammeRouter } from './adm-programme-routing.ts';
import {
	addNode,
	connect,
	setParam,
	type AudioNodeArray,
} from './audio-node-utils.ts';
import {
	clamp,
	DEFAULT_SAMPLE_RATE,
	finite,
	positiveInteger,
} from './buffer-math.ts';
import {
	applyEffectRack,
	createAnalyser,
	type EffectAnalyserEntry,
	type EffectRackOptions,
} from './effect-rack.ts';
import { activeRackEffects } from './project-effects.ts';
import { compileProjectPdcPlan } from './project-pdc-plan.ts';
import {
	buildProjectGraphV21,
	projectGraphLatencyFramesV21,
} from './project-graph-v21.ts';
import type { ProjectPathPdcPlanV21 } from './project-path-pdc-plan-v21.ts';
import type { StripMeterAnalyserBankV21 } from './strip-meter-analyser-bank-v21.ts';
import { ScheduledParameterRegistry } from './scheduled-parameter-registry.ts';
import type {
	EngineMixerBus,
	EngineProject,
} from './types.ts';

export interface ProjectGraphLatencyOptions {
	readonly trackId?: unknown;
	readonly includeMaster?: boolean;
	readonly sampleRate?: number;
}

export function projectGraphLatencyFrames(
	project: EngineProject | null | undefined,
	{
		trackId = null,
		includeMaster = true,
		sampleRate = project?.sampleRate || DEFAULT_SAMPLE_RATE,
	}: ProjectGraphLatencyOptions = {},
): number {
	if (isProductionMixerProjectSchema(project?.schemaVersion)) {
		return projectGraphLatencyFramesV21(project, { trackId, includeMaster, sampleRate });
	}
	return compileProjectPdcPlan(project, { trackId, includeMaster, sampleRate }).latencyFrames;
}

export interface ScheduledGainParam {
	readonly param: AudioParam;
	readonly latencyFrames: number;
}

export interface ProjectGainParams {
	readonly tracks: ReadonlyMap<string, ScheduledGainParam>;
	readonly groups: ReadonlyMap<string, ScheduledGainParam>;
	readonly sends: ReadonlyMap<string, ScheduledGainParam>;
	readonly master: ScheduledGainParam | null;
}

export interface ProjectGraph {
	readonly nodes: AudioNodeArray;
	readonly sources: Set<AudioScheduledSourceNode>;
	readonly abortController: AbortController;
	readonly trackInputs: Map<string, AudioNode>;
	readonly trackGainParams: Map<string, ScheduledGainParam>;
	readonly projectGainParams: ProjectGainParams;
	readonly parameterRegistry: ScheduledParameterRegistry;
	readonly trackAnalysers: Map<string, AnalyserNode>;
	readonly groupAnalysers: Map<string, AnalyserNode>;
	readonly sendAnalysers: Map<string, AnalyserNode>;
	readonly masterAnalyser: AnalyserNode | null;
	readonly effectNodes: Map<string, AudioNode>;
	readonly effectAnalysers: Map<string, EffectAnalyserEntry>;
	readonly effectMessageSequences: Map<string, number>;
	readonly mixerEdgeGainParams?: ReadonlyMap<string, ScheduledGainParam>;
	readonly pathPdcPlanV21?: ProjectPathPdcPlanV21;
	readonly pathPdcDelayParamsV21?: ReadonlyMap<string, AudioParam>;
	readonly productionStripAnalysersV21?: ReadonlyMap<string, StripMeterAnalyserBankV21>;
	readonly latencyFrames: number;
}

export interface AudioScheduledSourceNode {
	stop(): void;
	disconnect?(): void;
}

export interface BuildProjectGraphOptions {
	readonly metering?: boolean;
	readonly respectMuteSolo?: boolean;
	readonly trackId?: unknown;
	readonly includeMaster?: boolean;
	readonly includeTrackPan?: boolean;
	readonly effectAnalysis?: boolean;
	readonly monitoring?: boolean;
	readonly parametricEqWasmModule?: WebAssembly.Module | null;
	readonly onParametricEqError?: EffectRackOptions['onParametricEqError'];
}

/** Build track, mixer, and master nodes and return per-track clip inputs. */
export function buildProjectGraph(
	context: BaseAudioContext,
	destination: AudioNode,
	project: EngineProject,
	{
		metering = true,
		respectMuteSolo = true,
		trackId: onlyTrackId = null,
		includeMaster = true,
		includeTrackPan = true,
		effectAnalysis = false,
		monitoring = false,
		parametricEqWasmModule = null,
		onParametricEqError,
	}: BuildProjectGraphOptions = {},
): ProjectGraph {
	if (isProductionMixerProjectSchema(project.schemaVersion)) {
		return buildProjectGraphV21(context, destination, project, {
			metering, respectMuteSolo, trackId: onlyTrackId, includeMaster, includeTrackPan,
			effectAnalysis, monitoring, parametricEqWasmModule, onParametricEqError,
		});
	}
	project = projectTrackFolderMediaStateV12(project);
	const nodes: AudioNodeArray = [];
	const sources = new Set<AudioScheduledSourceNode>();
	const trackInputs = new Map<string, AudioNode>();
	const trackGainParams = new Map<string, ScheduledGainParam>();
	const groupGainParams = new Map<string, ScheduledGainParam>();
	const sendGainParams = new Map<string, ScheduledGainParam>();
	const trackAnalysers = new Map<string, AnalyserNode>();
	const groupAnalysers = new Map<string, AnalyserNode>();
	const sendAnalysers = new Map<string, AnalyserNode>();
	const effectNodes = new Map<string, AudioNode>();
	const effectAnalysers = new Map<string, EffectAnalyserEntry>();
	const effectMessageSequences = new Map<string, number>();
	const parameterRegistry = new ScheduledParameterRegistry();
	const tracks = Array.isArray(project?.tracks)
		? project.tracks.filter((track) => track.type !== 'label' && track.type !== 'video')
		: [];
	const mixer = project?.mixer || {};
	const groups = Array.isArray(mixer.groups) ? mixer.groups : [];
	const sends = Array.isArray(mixer.sends) ? mixer.sends : [];
	const groupById = new Map(groups.map((bus) => [String(bus.id), bus]));
	const sendById = new Map(sends.map((bus) => [String(bus.id), bus]));
	const terminalChannelWidths = resolveTerminalChannelWidths(project);
	// Create every dry input first so Auto Duck can route its control track.
	for (const [index, track] of tracks.entries()) {
		trackInputs.set(String(track.id ?? index), addNode(nodes, context.createGain()));
	}
	const pdcPlan = compileProjectPdcPlan(project, {
		trackId: onlyTrackId,
		includeMaster,
		sampleRate: context.sampleRate || DEFAULT_SAMPLE_RATE,
		fallbackTrackIndexIds: true,
	});
	const effectChannelCounts = new Map(tracks.map((track, index) => [
		String(track.id ?? index),
		terminalChannelWidths.tracks.get(String(track.id ?? index)) ?? 2,
	]));
	const mixEffectChannelCount = clamp(Math.max(
		2,
		positiveInteger(project?.masterChannels, 2),
		...effectChannelCounts.values(),
	), 1, 32);
	const maximumTrackLatency = pdcPlan.maximumTrackLatencyFrames;
	const masterInput = addNode(nodes, context.createGain());
	const admMetadata = project.metadata?.adm;
	const admMode = admMetadata && typeof admMetadata === 'object' && 'mode' in admMetadata
		? admMetadata.mode
		: null;
	const admProgrammeRouter = createAdmProgrammeRouter(context, nodes, admMetadata, masterInput);
	const preservesAdmChannels = admMode === 'authored' || admMode === 'passthrough';
	const groupInputs = new Map(groups.map((bus) => [String(bus.id), addNode(nodes, context.createGain())]));
	const sendInputs = new Map(sends.map((bus) => [String(bus.id), addNode(nodes, context.createGain())]));
	const busLatencies = pdcPlan.busLatencyFrames;
	const maximumBusLatency = pdcPlan.maximumBusLatencyFrames;
	const anySolo = respectMuteSolo && [...tracks, ...groups, ...sends].some((channel) => channel.solo);
	const connectTerminal = (output: AudioNode, scope: 'track' | 'group' | 'send', id: string, channelCount: number): void => {
		if (admProgrammeRouter) admProgrammeRouter.routeTerminal(scope, id, output, channelCount);
		else connect(output, masterInput);
	};
	const connectCompensated = (
		output: AudioNode,
		latencyFrames: number,
		scope: 'track' | 'group' | 'send',
		id: string,
		channelCount: number,
	): void => {
		const compensationFrames = maximumBusLatency - latencyFrames;
		if (compensationFrames <= 0) {
			connectTerminal(output, scope, id, channelCount);
			return;
		}
		if (typeof context.createDelay !== 'function') {
			throw new Error('This browser cannot compensate live effect latency between mixer buses.');
		}
		const compensationSeconds = compensationFrames / (context.sampleRate || DEFAULT_SAMPLE_RATE);
		const delay = addNode(nodes, context.createDelay(Math.max(1, compensationSeconds)));
		setParam(delay.delayTime, compensationSeconds, context.currentTime);
		connect(output, delay);
		connectTerminal(delay, scope, id, channelCount);
	};
	for (const [index, track] of tracks.entries()) {
		const trackId = String(track.id ?? index);
		if (onlyTrackId != null && String(onlyTrackId) !== trackId) continue;
		const input = trackInputs.get(trackId);
		if (!input) continue;
		const rackEffects = activeRackEffects(track);
		const trackLatency = pdcPlan.trackLatencyFrames.get(trackId) ?? 0;
		let output = applyEffectRack(context, input, rackEffects, nodes, {
			sidechainInputs: trackInputs,
			scope: 'track',
			targetId: trackId,
			effectAnalysis,
			effectNodes,
			effectAnalysers,
			parameterRegistry,
			baseParameterLatencyFrames: 0,
			effectChannelCount: effectChannelCounts.get(trackId),
			parametricEqWasmModule,
			parametricEqChannelCount: effectChannelCounts.get(trackId),
			onParametricEqError,
		});
		const gain = addNode(nodes, context.createGain());
		setParam(gain.gain, finite(track.gain, 1), context.currentTime);
		trackGainParams.set(trackId, { param: gain.gain, latencyFrames: trackLatency });
		registerStripParam(parameterRegistry, { kind: 'track', id: trackId }, 'gain', gain.gain, trackLatency);
		connect(output, gain);
		output = gain;
		const trackChannels = effectChannelCounts.get(trackId) ?? 2;
		if (includeTrackPan && !preservesAdmChannels && typeof context.createStereoPanner === 'function') {
			const panner = addNode(nodes, context.createStereoPanner());
			setParam(panner.pan, clamp(finite(track.pan, 0), -1, 1), context.currentTime);
			registerStripParam(parameterRegistry, { kind: 'track', id: trackId }, 'pan', panner.pan, trackLatency);
			connect(output, panner);
			output = panner;
		}
		const compensationFrames = maximumTrackLatency - trackLatency;
		if (compensationFrames > 0) {
			if (typeof context.createDelay !== 'function') {
				throw new Error('This browser cannot compensate live effect latency between tracks.');
			}
			const compensationSeconds = compensationFrames / (context.sampleRate || DEFAULT_SAMPLE_RATE);
			const delay = addNode(nodes, context.createDelay(Math.max(1, compensationSeconds)));
			setParam(delay.delayTime, compensationSeconds, context.currentTime);
			connect(output, delay);
			output = delay;
		}
		const analyser = metering ? createAnalyser(context, nodes) : null;
		if (analyser) {
			connect(output, analyser);
			output = analyser;
			trackAnalysers.set(trackId, analyser);
		}
		const route = mixer.routes?.[trackId] || {};
		const group = route.groupId == null ? null : groupById.get(String(route.groupId));
		const trackAudible = !respectMuteSolo || (!track.mute && (!anySolo || track.solo || group?.solo));
		const directGate = addNode(nodes, context.createGain());
		setParam(directGate.gain, trackAudible ? 1 : 0, context.currentTime);
		registerStripParam(
			parameterRegistry,
			{ kind: 'track', id: trackId },
			'mute',
			directGate.gain,
			trackLatency,
			(value) => 1 - value,
		);
		connect(output, directGate);
		if (group) connect(directGate, groupInputs.get(String(group.id)));
		else connectCompensated(directGate, 0, 'track', trackId, trackChannels);
		for (const [sendId, requestedGain] of Object.entries(route.sends || {})) {
			const send = sendById.get(String(sendId));
			if (!send || !(Number(requestedGain) > 0)) continue;
			const sendAudible = !respectMuteSolo || (!track.mute && (!anySolo || track.solo || send.solo));
			const sendGain = addNode(nodes, context.createGain());
			setParam(sendGain.gain, sendAudible ? finite(requestedGain, 0) : 0, context.currentTime);
			if (isSchedulableAudioParam(sendGain.gain)) {
				parameterRegistry.registerAudioParam(stripParameterDescriptor({
					kind: 'edge',
					// Runtime-only V17 identity; 4A retains it when materializing the edge.
					edgeId: legacySendEdgeId(trackId, String(send.id)),
					parameterId: 'level',
				}, trackLatency), sendGain.gain);
			}
			connect(output, sendGain);
			connect(sendGain, sendInputs.get(String(send.id)));
		}
	}

	const processBus = (
		bus: EngineMixerBus,
		input: AudioNode,
		analysers: Map<string, AnalyserNode>,
		gainParams: Map<string, ScheduledGainParam>,
		scope: 'group' | 'send',
	): void => {
		let output = applyEffectRack(context, input, activeRackEffects(bus), nodes, {
			sidechainInputs: trackInputs,
			baseSidechainDelayFrames: maximumTrackLatency,
			baseParameterLatencyFrames: maximumTrackLatency,
			scope,
			targetId: String(bus.id),
			effectAnalysis,
			effectNodes,
			effectAnalysers,
			parameterRegistry,
			effectChannelCount: mixEffectChannelCount,
			parametricEqWasmModule,
			parametricEqChannelCount: mixEffectChannelCount,
			onParametricEqError,
		});
		const gain = addNode(nodes, context.createGain());
		setParam(gain.gain, finite(bus.gain, 1), context.currentTime);
		gainParams.set(String(bus.id), {
			param: gain.gain,
			latencyFrames: maximumTrackLatency + (busLatencies.get(String(bus.id)) || 0),
		});
		const busLatency = maximumTrackLatency + (busLatencies.get(String(bus.id)) || 0);
		const busRef = { kind: 'mixer-node' as const, id: String(bus.id) };
		registerStripParam(parameterRegistry, busRef, 'gain', gain.gain, busLatency);
		connect(output, gain);
		output = gain;
		const busWidths = scope === 'group' ? terminalChannelWidths.groups : terminalChannelWidths.sends;
		const busChannels = busWidths.get(String(bus.id)) ?? 2;
		if (!preservesAdmChannels && typeof context.createStereoPanner === 'function') {
			const panner = addNode(nodes, context.createStereoPanner());
			setParam(panner.pan, clamp(finite(bus.pan, 0), -1, 1), context.currentTime);
			registerStripParam(parameterRegistry, busRef, 'pan', panner.pan, busLatency);
			connect(output, panner);
			output = panner;
		}
		const analyser = metering ? createAnalyser(context, nodes) : null;
		if (analyser) {
			connect(output, analyser);
			output = analyser;
			analysers.set(String(bus.id), analyser);
		}
		const mute = addNode(nodes, context.createGain());
		setParam(mute.gain, !respectMuteSolo || !bus.mute ? 1 : 0, context.currentTime);
		registerStripParam(parameterRegistry, busRef, 'mute', mute.gain, busLatency, (value) => 1 - value);
		connect(output, mute);
		connectCompensated(mute, busLatencies.get(String(bus.id)) || 0, scope, String(bus.id), busChannels);
	};
	for (const bus of groups) processBus(bus, groupInputs.get(String(bus.id))!, groupAnalysers, groupGainParams, 'group');
	for (const bus of sends) processBus(bus, sendInputs.get(String(bus.id))!, sendAnalysers, sendGainParams, 'send');

	const masterEffects = includeMaster ? activeRackEffects(project?.master) : [];
	const masterLatency = pdcPlan.masterLatencyFrames;
	const masterOutput = applyEffectRack(context, masterInput, masterEffects, nodes, {
		sidechainInputs: trackInputs,
		baseSidechainDelayFrames: maximumTrackLatency + maximumBusLatency,
		baseParameterLatencyFrames: maximumTrackLatency + maximumBusLatency,
		scope: 'master',
		targetId: null,
		effectAnalysis,
		effectNodes,
		effectAnalysers,
		parameterRegistry,
		effectChannelCount: mixEffectChannelCount,
		parametricEqWasmModule,
		parametricEqChannelCount: mixEffectChannelCount,
		onParametricEqError,
	});
	const masterGain = addNode(nodes, context.createGain());
	setParam(masterGain.gain, includeMaster ? finite(project?.master?.gain, 1) : 1, context.currentTime);
	const masterGainParam = includeMaster ? {
		param: masterGain.gain,
		latencyFrames: maximumTrackLatency + maximumBusLatency + masterLatency,
	} : null;
	const masterLatencyOffset = maximumTrackLatency + maximumBusLatency + masterLatency;
	if (includeMaster) {
		registerStripParam(parameterRegistry, { kind: 'master' }, 'gain', masterGain.gain, masterLatencyOffset);
	}
	connect(masterOutput, masterGain);
	let finalOutput: AudioNode = masterGain;
	if (includeMaster && !preservesAdmChannels && finite(project?.master?.pan, 0) !== 0 && typeof context.createStereoPanner === 'function') {
		const masterPanner = addNode(nodes, context.createStereoPanner());
		setParam(masterPanner.pan, clamp(finite(project?.master?.pan, 0), -1, 1), context.currentTime);
		registerStripParam(parameterRegistry, { kind: 'master' }, 'pan', masterPanner.pan, masterLatencyOffset);
		connect(finalOutput, masterPanner);
		finalOutput = masterPanner;
	}
	if (includeMaster && project?.master?.mute) {
		const masterMute = addNode(nodes, context.createGain());
		setParam(masterMute.gain, 0, context.currentTime);
		registerStripParam(
			parameterRegistry,
			{ kind: 'master' },
			'mute',
			masterMute.gain,
			masterLatencyOffset,
			(value) => 1 - value,
		);
		connect(finalOutput, masterMute);
		finalOutput = masterMute;
	}
	const masterAnalyser = metering ? createAnalyser(context, nodes) : null;
	let connectionSource = finalOutput;
	if (masterAnalyser) {
		connect(finalOutput, masterAnalyser);
		connectionSource = masterAnalyser;
	}
	if (monitoring) {
		connectSurroundMonitoring(
			context,
			connectionSource,
			destination,
			clamp(positiveInteger(project.masterChannels, 2), 1, 32),
			nodes,
		);
	} else connect(connectionSource, destination);

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
			master: masterGainParam,
		},
		parameterRegistry,
		trackAnalysers,
		groupAnalysers,
		sendAnalysers,
		masterAnalyser,
		effectNodes,
		effectAnalysers,
		effectMessageSequences,
		latencyFrames: maximumTrackLatency + maximumBusLatency + masterLatency,
	};
}

function registerStripParam(
	registry: ScheduledParameterRegistry,
	strip: StripRef,
	parameterId: 'gain' | 'pan' | 'mute',
	param: AudioParam,
	latencyFrames: number,
	transformValue?: (value: number) => number,
): void {
	// Lightweight render/test contexts may expose only the static AudioParam
	// surface used by the existing graph. A lane-free graph must keep working
	// without upgrading those parameters into scheduled targets.
	if (!isSchedulableAudioParam(param)) return;
	registry.registerAudioParam(
		stripParameterDescriptor({ kind: 'strip', strip, parameterId }, latencyFrames),
		param,
		transformValue ? { transformValue } : {},
	);
}

function isSchedulableAudioParam(param: AudioParam | null | undefined): param is AudioParam {
	return typeof param?.setValueAtTime === 'function'
		&& typeof param.linearRampToValueAtTime === 'function';
}
