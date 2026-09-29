/* SPDX-License-Identifier: AGPL-3.0-only */

import { soundscaperNativeAudioDestination } from '../soundscaper-native-audio-renderer.ts';
import {
	addNode,
	connect,
	getTransientNodes,
	releaseTransientNodes,
} from './audio-node-utils.ts';
import { prepareExactAudioWarpPlayback } from './audio-warp-fallback.ts';
import { confirmClockedPlaybackStart, type ClockedPlaybackStartHook } from './clocked-playback-start.ts';
import { clampFrame, playRangeStopFrame } from './buffer-math.ts';
import { createAnalyser } from './effect-rack.ts';
import { playbackOutputDestination } from './playback-output.ts';
import type { ProjectGraph } from './project-graph.ts';
import { ScheduledParameterRegistry } from './scheduled-parameter-registry.ts';
import {
	ENGINE_EMIT_POSITION,
	ENGINE_ENSURE_MASTER_LOUDNESS_METER,
	ENGINE_HANDLE_SCHEDULING_ERROR,
	ENGINE_HALT_GRAPH,
	ENGINE_SET_STATE,
	ENGINE_START_TICKER,
} from './runtime-symbols.ts';
import type {
	EngineRuntimeHost,
	PreparedAudioWarpPlayback,
} from './runtime-types.ts';

// Every entry supersedes the windows an earlier entry is still awaiting, so a
// seek that arrives mid-preparation cannot schedule the position it replaced.
const exactWarpScheduleGenerations = new WeakMap<EngineRuntimeHost, number>();

export async function scheduleExactWarpPlayback(
	engine: EngineRuntimeHost,
	prepared: PreparedAudioWarpPlayback,
	fromFrame: number,
	scheduledTime: number,
	isCurrent: () => boolean,
	minimumStartLeadSeconds = 0,
	onBeforeStart?: ClockedPlaybackStartHook,
): Promise<number> {
	const context = engine.context;
	if (!context || !engine.project) return scheduledTime;
	const generation = (exactWarpScheduleGenerations.get(engine) ?? 0) + 1;
	exactWarpScheduleGenerations.set(engine, generation);
	if (engine.meterListeners.size && !engine.masterLoudnessMeter && !engine.masterLoudnessMeterError) {
		await engine[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context);
	}
	if (!isCurrent() || exactWarpScheduleGenerations.get(engine) !== generation) return scheduledTime;
	const activeWindow = await exactWindowAt(engine, prepared, fromFrame);
	if (!activeWindow || engine.context !== context || !engine.project
		|| !isCurrent() || exactWarpScheduleGenerations.get(engine) !== generation) return scheduledTime;
	engine[ENGINE_HALT_GRAPH]();
	const frame = clampFrame(fromFrame, activeWindow.startFrame, activeWindow.endFrame);
	const nodes: AudioNode[] = [];
	let masterAnalyser = null;
	const playbackDestination = playbackOutputDestination(
		engine, context, soundscaperNativeAudioDestination(context, context.destination),
	);
	const meterDestination = engine.masterLoudnessMeter?.node || playbackDestination;
	if (engine.meterListeners.size > 0) {
		masterAnalyser = createAnalyser(context, nodes);
		connect(masterAnalyser, meterDestination);
	}
	const graph = exactGraph(nodes, masterAnalyser);
	engine.graph = graph;
	engine.playEndFrame = engine.loop.enabled
		? engine.loop.endFrame
		: playRangeStopFrame(engine.playRange, frame, engine.durationFrames);
	engine.playbackStartFrame = frame;
	engine.positionFrame = frame;
	engine.loopScheduleTime = Number.POSITIVE_INFINITY;
	const current = await scheduleWindow(
		engine,
		graph,
		activeWindow,
		scheduledTime,
		frame - activeWindow.startFrame,
		minimumStartLeadSeconds,
		onBeforeStart,
	);
	engine.playbackStartTime = current.startTime;
	current.prefetchFollowing();
	engine[ENGINE_SET_STATE]('playing');
	engine.masterLoudnessMeter?.setRunning(!engine.loudnessMeasurementManuallyPaused);
	engine[ENGINE_START_TICKER]();
	engine[ENGINE_EMIT_POSITION]();
	return current.startTime;
}

/** A seek or loop change can request a frame the prepared window cannot answer. */
async function exactWindowAt(
	engine: EngineRuntimeHost,
	prepared: PreparedAudioWarpPlayback,
	fromFrame: number,
): Promise<PreparedAudioWarpPlayback | null> {
	if (fromFrame >= prepared.startFrame && fromFrame < prepared.endFrame) return prepared;
	const boundary = engine.loop.enabled ? engine.loop.endFrame : engine.durationFrames;
	const requestedFrame = clampFrame(fromFrame, 0, engine.durationFrames);
	if (requestedFrame >= boundary) {
		engine[ENGINE_HALT_GRAPH]();
		engine[ENGINE_SET_STATE]('stopped');
		engine[ENGINE_EMIT_POSITION]();
		return null;
	}
	return prepareExactAudioWarpPlayback(engine, requestedFrame, boundary);
}

async function scheduleWindow(
	engine: EngineRuntimeHost,
	graph: ProjectGraph,
	prepared: PreparedAudioWarpPlayback,
	scheduledTime: number,
	offsetFrames = 0,
	minimumStartLeadSeconds = 0,
	onBeforeStart?: ClockedPlaybackStartHook,
): Promise<ScheduledExactWarpWindow> {
	const context = engine.context;
	if (!context || engine.graph !== graph || graph.abortController.signal.aborted) {
		throw new Error('Exact audio warp playback graph is unavailable.');
	}
	const transientNodes = getTransientNodes(graph.nodes);
	const source = addNode(transientNodes, context.createBufferSource());
	prepared.audioBuffer ||= exactAudioBuffer(context, prepared);
	source.buffer = prepared.audioBuffer;
	connect(source, graph.masterAnalyser || engine.masterLoudnessMeter?.node
		|| playbackOutputDestination(
			engine, context, soundscaperNativeAudioDestination(context, context.destination),
		));
	const wholeLoop = engine.loop.enabled
		&& prepared.startFrame === engine.loop.startFrame
		&& prepared.endFrame === engine.loop.endFrame
		&& offsetFrames === 0;
	if (wholeLoop) source.loop = true;
	let ended = false;
	let prefetchStarted = false;
	let following: ScheduledExactWarpWindow | null = null;
	const release = (): void => {
		ended = true;
		graph.sources.delete(source);
		releaseTransientNodes(transientNodes, [source]);
		following?.prefetchFollowing();
	};
	source.onended = release;
	try {
		scheduledTime = Math.max(scheduledTime, context.currentTime + minimumStartLeadSeconds);
		if (onBeforeStart) scheduledTime = await confirmClockedPlaybackStart(context, scheduledTime, onBeforeStart);
		if (engine.graph !== graph || graph.abortController.signal.aborted) {
			throw new DOMException('Playback cancelled', 'AbortError');
		}
		source.start(scheduledTime, offsetFrames / prepared.sampleRate);
		graph.sources.add(source);
	} catch (error) {
		release();
		throw error;
	}
	const scheduledEndTime = scheduledTime
		+ (prepared.frameCount - offsetFrames) / prepared.sampleRate;
	return Object.freeze({
		startTime: scheduledTime,
		prefetchFollowing(): void {
			if (wholeLoop || prefetchStarted) return;
			prefetchStarted = true;
			void prepareFollowingWindow(engine, graph, prepared, scheduledEndTime)
				.then((next) => {
					following = next;
					// The current source can end while its next window is still
					// rendering. The deadline check below fails closed if that
					// render missed the exact boundary.
					if (ended) following?.prefetchFollowing();
				})
				.catch((error) => engine[ENGINE_HANDLE_SCHEDULING_ERROR](error));
		},
	});
}

interface ScheduledExactWarpWindow {
	readonly startTime: number;
	prefetchFollowing(): void;
}

async function prepareFollowingWindow(
	engine: EngineRuntimeHost,
	graph: ProjectGraph,
	prepared: PreparedAudioWarpPlayback,
	requestedTime: number,
): Promise<ScheduledExactWarpWindow | null> {
	if (!engine.context || !engine.project || engine.graph !== graph || graph.abortController.signal.aborted) return null;
	const boundary = engine.loop.enabled ? engine.loop.endFrame : engine.durationFrames;
	const nextStart = prepared.endFrame < boundary
		? prepared.endFrame
		: engine.loop.enabled ? engine.loop.startFrame : null;
	if (nextStart === null || nextStart >= boundary) return null;
	const next = await prepareExactAudioWarpPlayback(
		engine,
		nextStart,
		boundary,
		graph.abortController.signal,
	);
	if (!engine.context || engine.graph !== graph || graph.abortController.signal.aborted) return null;
	if (engine.context.currentTime > requestedTime) {
		throw new Error('Exact audio warp playback could not prepare its next bounded window before the audio deadline.');
	}
	return scheduleWindow(engine, graph, next, requestedTime);
}

function exactAudioBuffer(
	context: BaseAudioContext,
	prepared: PreparedAudioWarpPlayback,
): AudioBuffer {
	const buffer = context.createBuffer(prepared.channels.length, prepared.frameCount, prepared.sampleRate);
	for (let channel = 0; channel < prepared.channels.length; channel += 1) {
		if (typeof buffer.copyToChannel === 'function') {
			buffer.copyToChannel(
				prepared.channels[channel] as Float32Array<ArrayBuffer>,
				channel,
			);
		} else buffer.getChannelData(channel).set(prepared.channels[channel]);
	}
	return buffer;
}

function exactGraph(nodes: AudioNode[], masterAnalyser: AnalyserNode | null): ProjectGraph {
	return {
		nodes,
		sources: new Set(),
		abortController: new AbortController(),
		trackInputs: new Map(),
		trackGainParams: new Map(),
		projectGainParams: { tracks: new Map(), groups: new Map(), sends: new Map(), master: null },
		parameterRegistry: new ScheduledParameterRegistry(),
		trackAnalysers: new Map(), groupAnalysers: new Map(), sendAnalysers: new Map(), masterAnalyser,
		effectNodes: new Map(), effectAnalysers: new Map(), effectMessageSequences: new Map(), latencyFrames: 0,
	};
}
