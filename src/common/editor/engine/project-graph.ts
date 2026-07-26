/* SPDX-License-Identifier: AGPL-3.0-only */

import { audioTrackChannelCountV2 } from '../project-v2.js';
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
	effectRackLatencyFrames,
	type EffectAnalyserEntry,
	type EffectRackOptions,
} from './effect-rack.ts';
import { activeRackEffects } from './project-effects.ts';
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
	const tracks = (project?.tracks || []).filter((track) => (
		track.type !== 'label' && track.type !== 'video'
			&& (trackId == null || String(track.id) === String(trackId))
	));
	const trackLatency = tracks.reduce((maximum, track) => Math.max(
		maximum,
		effectRackLatencyFrames(activeRackEffects(track), sampleRate),
	), 0);
	const masterLatency = includeMaster
		? effectRackLatencyFrames(activeRackEffects(project?.master), sampleRate)
		: 0;
	const busLatency = Math.max(0, ...[
		...(project?.mixer?.groups || []),
		...(project?.mixer?.sends || []),
	].map((bus) => effectRackLatencyFrames(activeRackEffects(bus), sampleRate)));
	return trackLatency + busLatency + masterLatency;
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
	readonly trackAnalysers: Map<string, AnalyserNode>;
	readonly groupAnalysers: Map<string, AnalyserNode>;
	readonly sendAnalysers: Map<string, AnalyserNode>;
	readonly masterAnalyser: AnalyserNode | null;
	readonly effectNodes: Map<string, AudioNode>;
	readonly effectAnalysers: Map<string, EffectAnalyserEntry>;
	readonly effectMessageSequences: Map<string, number>;
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
		parametricEqWasmModule = null,
		onParametricEqError,
	}: BuildProjectGraphOptions = {},
): ProjectGraph {
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
	const tracks = Array.isArray(project?.tracks)
		? project.tracks.filter((track) => track.type !== 'label' && track.type !== 'video')
		: [];
	const mixer = project?.mixer || {};
	const groups = Array.isArray(mixer.groups) ? mixer.groups : [];
	const sends = Array.isArray(mixer.sends) ? mixer.sends : [];
	const groupById = new Map(groups.map((bus) => [String(bus.id), bus]));
	const sendById = new Map(sends.map((bus) => [String(bus.id), bus]));
	// Create every dry input first so Auto Duck can route its control track.
	for (const [index, track] of tracks.entries()) {
		trackInputs.set(String(track.id ?? index), addNode(nodes, context.createGain()));
	}
	const renderedTracks = tracks.filter((track, index) => (
		onlyTrackId == null || String(onlyTrackId) === String(track.id ?? index)
	));
	const effectChannelCounts = new Map(tracks.map((track, index) => [
		String(track.id ?? index),
		clamp(audioTrackChannelCountV2(project, track, 2), 1, 32),
	]));
	const mixEffectChannelCount = clamp(Math.max(
		2,
		positiveInteger(project?.masterChannels, 2),
		...effectChannelCounts.values(),
	), 1, 32);
	const maximumTrackLatency = renderedTracks.reduce((maximum, track) => Math.max(
		maximum,
		effectRackLatencyFrames(activeRackEffects(track), context.sampleRate || DEFAULT_SAMPLE_RATE),
	), 0);
	const masterInput = addNode(nodes, context.createGain());
	const groupInputs = new Map(groups.map((bus) => [String(bus.id), addNode(nodes, context.createGain())]));
	const sendInputs = new Map(sends.map((bus) => [String(bus.id), addNode(nodes, context.createGain())]));
	const busLatencies = new Map([...groups, ...sends].map((bus) => [
		String(bus.id),
		effectRackLatencyFrames(activeRackEffects(bus), context.sampleRate || DEFAULT_SAMPLE_RATE),
	]));
	const maximumBusLatency = Math.max(0, ...busLatencies.values());
	const anySolo = respectMuteSolo && [...tracks, ...groups, ...sends].some((channel) => channel.solo);
	const connectCompensated = (output: AudioNode, latencyFrames = 0): void => {
		const compensationFrames = maximumBusLatency - latencyFrames;
		if (compensationFrames <= 0) {
			connect(output, masterInput);
			return;
		}
		if (typeof context.createDelay !== 'function') {
			throw new Error('This browser cannot compensate live effect latency between mixer buses.');
		}
		const compensationSeconds = compensationFrames / (context.sampleRate || DEFAULT_SAMPLE_RATE);
		const delay = addNode(nodes, context.createDelay(Math.max(1, compensationSeconds)));
		setParam(delay.delayTime, compensationSeconds, context.currentTime);
		connect(output, delay);
		connect(delay, masterInput);
	};
	for (const [index, track] of tracks.entries()) {
		const trackId = String(track.id ?? index);
		if (onlyTrackId != null && String(onlyTrackId) !== trackId) continue;
		const input = trackInputs.get(trackId);
		if (!input) continue;
		const rackEffects = activeRackEffects(track);
		const trackLatency = effectRackLatencyFrames(rackEffects, context.sampleRate || DEFAULT_SAMPLE_RATE);
		let output = applyEffectRack(context, input, rackEffects, nodes, {
			sidechainInputs: trackInputs,
			scope: 'track',
			targetId: trackId,
			effectAnalysis,
			effectNodes,
			effectAnalysers,
			effectChannelCount: effectChannelCounts.get(trackId),
			parametricEqWasmModule,
			parametricEqChannelCount: effectChannelCounts.get(trackId),
			onParametricEqError,
		});
		const gain = addNode(nodes, context.createGain());
		setParam(gain.gain, finite(track.gain, 1), context.currentTime);
		trackGainParams.set(trackId, { param: gain.gain, latencyFrames: trackLatency });
		connect(output, gain);
		output = gain;
		if (includeTrackPan && typeof context.createStereoPanner === 'function') {
			const panner = addNode(nodes, context.createStereoPanner());
			setParam(panner.pan, clamp(finite(track.pan, 0), -1, 1), context.currentTime);
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
		connect(output, directGate);
		if (group) connect(directGate, groupInputs.get(String(group.id)));
		else connectCompensated(directGate, 0);
		for (const [sendId, requestedGain] of Object.entries(route.sends || {})) {
			const send = sendById.get(String(sendId));
			if (!send || !(Number(requestedGain) > 0)) continue;
			const sendAudible = !respectMuteSolo || (!track.mute && (!anySolo || track.solo || send.solo));
			const sendGain = addNode(nodes, context.createGain());
			setParam(sendGain.gain, sendAudible ? finite(requestedGain, 0) : 0, context.currentTime);
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
			scope,
			targetId: String(bus.id),
			effectAnalysis,
			effectNodes,
			effectAnalysers,
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
		connect(output, gain);
		output = gain;
		if (typeof context.createStereoPanner === 'function') {
			const panner = addNode(nodes, context.createStereoPanner());
			setParam(panner.pan, clamp(finite(bus.pan, 0), -1, 1), context.currentTime);
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
		connect(output, mute);
		connectCompensated(mute, busLatencies.get(String(bus.id)) || 0);
	};
	for (const bus of groups) processBus(bus, groupInputs.get(String(bus.id))!, groupAnalysers, groupGainParams, 'group');
	for (const bus of sends) processBus(bus, sendInputs.get(String(bus.id))!, sendAnalysers, sendGainParams, 'send');

	const masterEffects = includeMaster ? activeRackEffects(project?.master) : [];
	const masterLatency = effectRackLatencyFrames(masterEffects, context.sampleRate || DEFAULT_SAMPLE_RATE);
	const masterOutput = applyEffectRack(context, masterInput, masterEffects, nodes, {
		sidechainInputs: trackInputs,
		baseSidechainDelayFrames: maximumTrackLatency + maximumBusLatency,
		scope: 'master',
		targetId: null,
		effectAnalysis,
		effectNodes,
		effectAnalysers,
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
	connect(masterOutput, masterGain);
	let finalOutput: AudioNode = masterGain;
	if (includeMaster && finite(project?.master?.pan, 0) !== 0 && typeof context.createStereoPanner === 'function') {
		const masterPanner = addNode(nodes, context.createStereoPanner());
		setParam(masterPanner.pan, clamp(finite(project?.master?.pan, 0), -1, 1), context.currentTime);
		connect(finalOutput, masterPanner);
		finalOutput = masterPanner;
	}
	if (includeMaster && project?.master?.mute) {
		const masterMute = addNode(nodes, context.createGain());
		setParam(masterMute.gain, 0, context.currentTime);
		connect(finalOutput, masterMute);
		finalOutput = masterMute;
	}
	const masterAnalyser = metering ? createAnalyser(context, nodes) : null;
	if (masterAnalyser) {
		connect(finalOutput, masterAnalyser);
		connect(masterAnalyser, destination);
	} else connect(finalOutput, destination);

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
