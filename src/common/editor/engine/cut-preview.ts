/* SPDX-License-Identifier: AGPL-3.0-only */

import { audioBufferChannels, clampFrame } from './buffer-math.ts';
import { createAnalyser } from './effect-rack.ts';
import { playbackOutputDestination } from './playback-output.ts';
import { ScheduledParameterRegistry } from './scheduled-parameter-registry.ts';
import { soundscaperNativeAudioDestination } from '../soundscaper-native-audio-renderer.ts';
import {
	ENGINE_ASSERT_ACTIVE, ENGINE_CANCEL_SCRUB, ENGINE_EMIT_POSITION,
	ENGINE_ENSURE_MASTER_LOUDNESS_METER, ENGINE_HALT_GRAPH, ENGINE_SET_STATE, ENGINE_START_TICKER,
} from './runtime-symbols.ts';
import type { AudioNodeArray } from './audio-node-utils.ts';
import type { ProjectGraph } from './project-graph.ts';
import type { EngineAudioContext, EngineCutPreviewSelection } from './public-api.ts';
import type { EngineRuntimeHost, EngineRuntimeMethodMap } from './runtime-types.ts';

interface CutPreviewData {
	readonly project: EngineRuntimeHost['project'];
	readonly buffer: AudioBuffer;
	readonly beforeStart: number;
	readonly beforeFrames: number;
	readonly afterStart: number;
	readonly totalFrames: number;
}

interface CutPreviewSession extends CutPreviewData {
	readonly graph: ProjectGraph;
	readonly offsetFrames: number;
	readonly pausedGeneration?: number;
	readonly pausedOffsetFrames?: number;
	readonly pausedPosition?: number;
}

const sessions = new WeakMap<EngineRuntimeHost, CutPreviewSession>();

function sessionFor(engine: EngineRuntimeHost): CutPreviewSession | undefined {
	const session = sessions.get(engine);
	return session?.graph === engine.graph ? session : undefined;
}

export function isCutPreviewActive(engine: EngineRuntimeHost): boolean {
	return Boolean(sessionFor(engine));
}

function pausedSessionFor(engine: EngineRuntimeHost): CutPreviewSession | null {
	const session = sessions.get(engine);
	return session && engine.state === 'paused' && engine.graph === null && engine.playRange === null
		&& session.project === engine.project && session.pausedGeneration === engine.scrubGeneration
		&& session.pausedPosition === engine.positionFrame && session.pausedOffsetFrames !== undefined
		? session : null;
}

export function isCutPreviewPaused(engine: EngineRuntimeHost): boolean {
	return Boolean(pausedSessionFor(engine));
}

function elapsedFrames(engine: EngineRuntimeHost, session: CutPreviewSession): number {
	return clampFrame(session.offsetFrames + Math.floor(
		Math.max(0, (engine.context?.currentTime ?? engine.playbackStartTime) - engine.playbackStartTime) * engine.sampleRate,
	), 0, session.totalFrames);
}

function timelinePosition(session: CutPreviewData, offsetFrames: number): number {
	return offsetFrames < session.beforeFrames
		? session.beforeStart + offsetFrames
		: session.afterStart + offsetFrames - session.beforeFrames;
}

/** Report the original timeline position of the audio on either side of the skipped gap. */
export function readCutPreviewPosition(engine: EngineRuntimeHost): number | null {
	const session = sessionFor(engine);
	if (!session || !engine.context) return null;
	return timelinePosition(session, elapsedFrames(engine, session));
}

/** Only a genuine pause retains the bounded buffer after its graph is retired. */
export function pauseCutPreview(engine: EngineRuntimeHost): number | null {
	const session = sessionFor(engine);
	if (!session) return null;
	const pausedOffsetFrames = elapsedFrames(engine, session);
	const pausedPosition = timelinePosition(session, pausedOffsetFrames);
	sessions.set(engine, { ...session, pausedOffsetFrames, pausedPosition, pausedGeneration: engine.scrubGeneration });
	return pausedPosition;
}

export function releaseCutPreview(engine: EngineRuntimeHost): void {
	const session = sessions.get(engine);
	if (!session || session.pausedGeneration !== engine.scrubGeneration || session.project !== engine.project) sessions.delete(engine);
}

function current(engine: EngineRuntimeHost, project: EngineRuntimeHost['project'], generation: number): boolean {
	return !engine.disposed && engine.project === project && engine.scrubGeneration === generation;
}

function startJoinedPreview(engine: EngineRuntimeHost, context: EngineAudioContext, data: CutPreviewData, offsetFrames = 0): void {
	engine[ENGINE_HALT_GRAPH]();
	const nodes: AudioNodeArray = [];
	const source = context.createBufferSource();
	nodes.push(source);
	source.buffer = data.buffer;
	const destination = engine.masterLoudnessMeter?.node || playbackOutputDestination(
		engine, context, soundscaperNativeAudioDestination(context, context.destination),
	);
	const masterAnalyser = engine.meterListeners.size ? createAnalyser(context, nodes) : null;
	if (masterAnalyser) { source.connect(masterAnalyser); masterAnalyser.connect(destination); }
	else source.connect(destination);
	const graph: ProjectGraph = {
		nodes, sources: new Set([source]), abortController: new AbortController(),
		trackInputs: new Map(), trackGainParams: new Map(),
		projectGainParams: { tracks: new Map(), groups: new Map(), sends: new Map(), master: null },
		parameterRegistry: new ScheduledParameterRegistry(), trackAnalysers: new Map(),
		groupAnalysers: new Map(), sendAnalysers: new Map(), masterAnalyser,
		effectNodes: new Map(), effectAnalysers: new Map(), effectMessageSequences: new Map(), latencyFrames: 0,
	};
	engine.graph = graph;
	// This run owns its preview span; the saved loop and editing selection stay intact.
	engine.playRange = null;
	engine.playbackRate = 1;
	engine.playbackMode = 'normal';
	engine.preparedSpeedPlayback = null;
	engine.positionFrame = timelinePosition(data, offsetFrames);
	engine.playbackStartFrame = engine.positionFrame;
	engine.playbackStartTime = context.currentTime;
	engine.playEndFrame = data.afterStart + data.totalFrames - data.beforeFrames;
	engine.loopScheduleTime = Number.POSITIVE_INFINITY;
	sessions.set(engine, { ...data, graph, offsetFrames });
	try { source.start(engine.playbackStartTime, offsetFrames / engine.sampleRate); }
	catch (error) { engine[ENGINE_HALT_GRAPH](); throw error; }
	engine[ENGINE_SET_STATE]('playing');
	engine.masterLoudnessMeter?.setRunning(!engine.loudnessMeasurementManuallyPaused);
	engine[ENGINE_START_TICKER]();
	engine[ENGINE_EMIT_POSITION]();
}

/** A fresh ordinary Play stays synchronous until it has claimed its request generation. */
export function resumeCutPreview(engine: EngineRuntimeHost): Promise<void> | null {
	const session = pausedSessionFor(engine);
	if (!session) {
		sessions.delete(engine);
		return null;
	}
	engine[ENGINE_CANCEL_SCRUB]();
	const generation = engine.scrubGeneration;
	return (async () => {
		const context = await engine.getAudioContext();
		if (!current(engine, session.project, generation)) return;
		await engine[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context);
		if (!current(engine, session.project, generation)) return;
		startJoinedPreview(engine, context, session, session.pausedOffsetFrames);
	})();
}

export const engineCutPreviewMethods = {
	async playCutPreview(selection: EngineCutPreviewSelection) {
		this[ENGINE_ASSERT_ACTIVE]();
		const project = this.project;
		if (!project) throw new Error('Load an audio editor project before playback.');
		if (!Number.isSafeInteger(selection.startFrame) || !Number.isSafeInteger(selection.endFrame)
			|| selection.endFrame <= selection.startFrame) throw new RangeError('Cut preview requires a time selection.');
		const start = clampFrame(selection.startFrame, 0, this.durationFrames);
		const end = clampFrame(selection.endFrame, start, this.durationFrames);
		const beforeStart = Math.max(0, start - this.sampleRate * 2);
		const afterEnd = Math.min(this.durationFrames, end + this.sampleRate);
		const beforeFrames = start - beforeStart;
		const afterFrames = afterEnd - end;
		if (beforeFrames + afterFrames === 0) throw new RangeError('There is no audio outside the selection to preview.');
		const selectedIds = new Set(selection.trackIds ?? []);
		const track = project.tracks?.find((candidate) => (candidate.type ?? 'audio') === 'audio'
			&& (!selectedIds.size || selectedIds.has(String(candidate.id))));
		if (!track) throw new Error('Select an audio track to preview the cut.');
		this.pause();
		this[ENGINE_CANCEL_SCRUB]();
		releaseCutPreview(this);
		const generation = this.scrubGeneration;
		const parts: Array<readonly Float32Array[]> = [];
		for (const [startFrame, endFrame] of [[beforeStart, start], [end, afterEnd]]) {
			if (endFrame <= startFrame) continue;
			const rendered = await this.renderMix({ startFrame, endFrame, trackId: track.id, includeTail: false, respectMuteSolo: true });
			if (!current(this, project, generation)) return;
			parts.push(audioBufferChannels(rendered));
		}
		const context = await this.getAudioContext();
		if (!current(this, project, generation)) return;
		await this[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context);
		if (!current(this, project, generation)) return;
		const totalFrames = beforeFrames + afterFrames;
		const channelCount = Math.max(...parts.map((part) => part.length));
		const buffer = context.createBuffer(channelCount, totalFrames, this.sampleRate);
		for (let channel = 0; channel < channelCount; channel += 1) {
			let offset = 0;
			for (const part of parts) {
				const values = part[channel];
				if (values) buffer.getChannelData(channel).set(values, offset);
				offset += part[0]?.length ?? 0;
			}
		}
		startJoinedPreview(this, context, { project, buffer, beforeStart, beforeFrames, afterStart: afterFrames ? end : start, totalFrames });
	},
} satisfies EngineRuntimeMethodMap<'playCutPreview'>;
