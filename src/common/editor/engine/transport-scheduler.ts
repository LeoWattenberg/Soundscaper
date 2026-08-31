/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEbuR128MeterNode,
} from '../ebu-r128-node.js';
import { resolveAdmEbuChannelWeights } from '../loudness-channel-layout.ts';
import { configureMasterLoudnessMeterChannelCount } from '../surround-monitoring.ts';
import { soundscaperNativeAudioDestination } from '../soundscaper-native-audio-renderer.ts';
import { hasProductionMixerProjectAuthority } from '../project-schema-version.ts';
import {
	addNode,
	connect,
} from './audio-node-utils.ts';
import type { AudioNodeArray } from './audio-node-utils.ts';
import { scheduleExactWarpPlayback } from './audio-warp-playback-scheduler.ts';
import {
	clampFrame,
	DEFAULT_SAMPLE_RATE,
} from './buffer-math.ts';
import {
	scheduleProjectClips,
} from './clip-scheduler.ts';
import {
	createAnalyser,
	disposeEffectNodeBindings,
} from './effect-rack.ts';
import {
	getParametricEqWasmModule,
} from './effect-worklets.ts';
import {
	buildProjectGraph,
} from './project-graph.ts';
import { sampleProductionMeterSessionV21 } from './production-meter-runtime-session-v21.ts';
import { ScheduledParameterRegistry } from './scheduled-parameter-registry.ts';
import {
	ENGINE_CANCEL_SCRUB,
	ENGINE_EMIT_METERS,
	ENGINE_EMIT_PARAMETRIC_EQ_ERROR,
	ENGINE_EMIT_POSITION,
	ENGINE_ENSURE_MASTER_LOUDNESS_METER,
	ENGINE_GET_CHUNK_STREAM_CLIENT,
	ENGINE_HANDLE_SCHEDULING_ERROR,
	ENGINE_HALT_GRAPH,
	ENGINE_SCHEDULE_CURRENT_PLAYBACK,
	ENGINE_SCHEDULE_LOOP_AHEAD,
	ENGINE_SCHEDULE_PLAYBACK,
	ENGINE_SCHEDULE_PREPARED_SPEED_PLAYBACK,
	ENGINE_SET_STATE,
	ENGINE_START_TICKER,
	ENGINE_STOP_TICKER,
} from './runtime-symbols.ts';
import type {
	EngineRuntimeMethodMap,
	EngineRuntimeHost,
} from './runtime-types.ts';
import type { EngineMeterReading } from './public-api.ts';


const meterReadBuffers = new WeakMap<AnalyserNode, Float32Array>();

interface MutableMeterReading {
	peak: number;
	rms: number;
	dbfs: number;
	loudness?: unknown;
}

function readMeter(analyser: AnalyserNode | null | undefined): MutableMeterReading {
	if (!analyser?.getFloatTimeDomainData) return { peak: 0, rms: 0, dbfs: -Infinity };
	const sampleCount = analyser.fftSize || 256;
	let values = meterReadBuffers.get(analyser);
	if (!values || values.length !== sampleCount) {
		values = new Float32Array(sampleCount);
		meterReadBuffers.set(analyser, values);
	}
	analyser.getFloatTimeDomainData(values as Float32Array<ArrayBuffer>);
	let peak = 0;
	let squares = 0;
	for (const value of values) {
		peak = Math.max(peak, Math.abs(value));
		squares += value * value;
	}
	const rms = Math.sqrt(squares / Math.max(1, values.length));
	return { peak, rms, dbfs: peak > 0 ? 20 * Math.log10(peak) : -Infinity };
}

interface DisposableAudioGraph {
	readonly abortController?: AbortController;
	readonly sources?: Iterable<{ stop(): void }> & { clear(): void };
	readonly nodes?: AudioNodeArray;
	readonly effectNodes?: { clear(): void };
	readonly effectAnalysers?: { clear(): void };
	readonly effectMessageSequences?: { clear(): void };
	readonly parameterRegistry?: { clear(): void };
}

export function disposeGraph(graph: DisposableAudioGraph, stopSources: boolean): void {
	graph.abortController?.abort?.();
	if (stopSources) {
		for (const source of graph.sources || []) {
			try { source.stop(); } catch { /* It may already have ended. */ }
		}
	}
	const transientNodes = graph.nodes?.transientNodes;
	for (const node of [
		...(graph.nodes || []),
		...(transientNodes || []),
	].reverse()) {
		disposeEffectNodeBindings(node);
		try { node.disconnect(); } catch { /* It may already be disconnected. */ }
	}
	transientNodes?.clear();
	graph.sources?.clear?.();
	graph.effectNodes?.clear?.();
	graph.effectAnalysers?.clear?.();
	graph.effectMessageSequences?.clear?.();
	graph.parameterRegistry?.clear?.();
}

export const engineTransportSchedulerMethods = {
async [ENGINE_SCHEDULE_CURRENT_PLAYBACK](this: EngineRuntimeHost, fromFrame, scheduledTime = this.context?.currentTime || 0) {
		if ((this.playbackMode === 'staffpad' && this.preparedSpeedPlayback)
			|| (this.playbackMode === 'audio-warp-exact' && this.preparedAudioWarpPlayback)) {
			return this[ENGINE_SCHEDULE_PREPARED_SPEED_PLAYBACK](fromFrame, scheduledTime);
		}
		return this[ENGINE_SCHEDULE_PLAYBACK](fromFrame, scheduledTime);
	},

async [ENGINE_SCHEDULE_PREPARED_SPEED_PLAYBACK](this: EngineRuntimeHost, fromFrame, scheduledTime = this.context?.currentTime || 0) {
		const context = this.context;
		if (this.playbackMode === 'audio-warp-exact' && this.preparedAudioWarpPlayback) {
			await scheduleExactWarpPlayback(
				this,
				this.preparedAudioWarpPlayback,
				fromFrame,
				scheduledTime,
			);
			return scheduledTime;
		}
		const prepared = this.preparedSpeedPlayback;
		if (!context || !this.project || !prepared) return scheduledTime;
		if (this.meterListeners.size && !this.masterLoudnessMeter && !this.masterLoudnessMeterError) {
			await this[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context);
		}
		this[ENGINE_HALT_GRAPH]();
		const frame = clampFrame(fromFrame, 0, this.playbackDurationFrames);
		const nodes: AudioNode[] = [];
		const sources = new Set<AudioScheduledSourceNode>();
		const source = addNode(nodes, context.createBufferSource());
		if (!prepared.audioBuffer) {
			prepared.audioBuffer = context.createBuffer(prepared.channels.length, prepared.frameCount, prepared.sampleRate);
			for (let channel = 0; channel < prepared.channels.length; channel += 1) {
				if (typeof prepared.audioBuffer.copyToChannel === 'function') {
					prepared.audioBuffer.copyToChannel(
						prepared.channels[channel] as Float32Array<ArrayBuffer>,
						channel,
					);
				} else prepared.audioBuffer.getChannelData(channel).set(prepared.channels[channel]);
			}
		}
		source.buffer = prepared.audioBuffer;
		let masterAnalyser = null;
		const meterDestination = this.masterLoudnessMeter?.node
			|| soundscaperNativeAudioDestination(context, context.destination);
		if (this.meterListeners.size > 0) {
			masterAnalyser = createAnalyser(context, nodes);
			connect(source, masterAnalyser);
			connect(masterAnalyser, meterDestination);
		} else connect(source, meterDestination);
		const outputFrameAt = (timelineFrame: number) => this.durationFrames > 0
			? clampFrame(Math.round(timelineFrame / this.durationFrames * prepared.frameCount), 0, prepared.frameCount)
			: 0;
		if (this.loop.enabled && this.loop.endFrame > this.loop.startFrame) {
			source.loop = true;
			source.loopStart = outputFrameAt(this.loop.startFrame) / prepared.sampleRate;
			source.loopEnd = outputFrameAt(this.loop.endFrame) / prepared.sampleRate;
		}
		this.playEndFrame = Math.max(frame, this.loop.enabled ? this.loop.endFrame : this.playbackDurationFrames);
		this.playbackStartFrame = frame;
		this.positionFrame = frame;
		this.playbackStartTime = scheduledTime;
		this.loopScheduleTime = Number.POSITIVE_INFINITY;
		this.graph = {
			nodes,
			sources,
			abortController: new AbortController(),
			trackInputs: new Map(),
			trackGainParams: new Map(),
			projectGainParams: {
				tracks: new Map(),
				groups: new Map(),
				sends: new Map(),
				master: null,
			},
			parameterRegistry: new ScheduledParameterRegistry(),
			trackAnalysers: new Map(),
			groupAnalysers: new Map(),
			sendAnalysers: new Map(),
			masterAnalyser,
			effectNodes: new Map(),
			effectAnalysers: new Map(),
			effectMessageSequences: new Map(),
			latencyFrames: 0,
		};
		try {
			source.start(scheduledTime, outputFrameAt(frame) / prepared.sampleRate);
			sources.add(source);
		} catch (error) {
			this[ENGINE_HALT_GRAPH]();
			throw error;
		}
		this[ENGINE_SET_STATE]('playing');
		this.masterLoudnessMeter?.setRunning(!this.loudnessMeasurementManuallyPaused);
		this[ENGINE_START_TICKER]();
		this[ENGINE_EMIT_POSITION]();
		return scheduledTime;
	},

async [ENGINE_SCHEDULE_PLAYBACK](this: EngineRuntimeHost, fromFrame, scheduledTime = this.context?.currentTime || 0) {
		const context = this.context;
		if (!context || !this.project) return scheduledTime;
		if (this.meterListeners.size && !this.masterLoudnessMeter && !this.masterLoudnessMeterError) {
			await this[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context);
		}
		this[ENGINE_HALT_GRAPH]();
		const loopEnd = this.loop.enabled ? this.loop.endFrame : this.playbackDurationFrames;
		this.playEndFrame = Math.max(fromFrame, loopEnd);
		this.playbackStartFrame = fromFrame;
		this.positionFrame = fromFrame;
		this.graph = buildProjectGraph(
			context,
			this.masterLoudnessMeter?.node || soundscaperNativeAudioDestination(context, context.destination),
			this.project,
			{
			metering: this.meterListeners.size > 0,
			respectMuteSolo: true,
			effectAnalysis: true,
			monitoring: true,
			parametricEqWasmModule: getParametricEqWasmModule(context),
			onParametricEqError: (error) => this[ENGINE_EMIT_PARAMETRIC_EQ_ERROR](error),
			},
		);
		this.playbackStartTime = scheduledTime + (this.graph.latencyFrames || 0) / (context.sampleRate || DEFAULT_SAMPLE_RATE);
		const graph = this.graph;
		let schedule;
		try {
			schedule = await scheduleProjectClips({
				context,
				project: this.project,
				sources: this.sources,
				trackInputs: this.graph.trackInputs,
				trackGainParams: this.graph.trackGainParams,
				projectGainParams: this.graph.projectGainParams,
				parameterRegistry: this.graph.parameterRegistry,
				fromFrame,
				toFrame: this.playEndFrame,
				contextStartTime: scheduledTime,
				sampleRate: this.sampleRate,
				transportRate: this.playbackRate,
				reversedBuffers: this.reversedBuffers,
				sourceResolver: this.sourceResolver,
				chunkSources: this.chunkSources,
				activeSources: this.graph.sources,
				allNodes: this.graph.nodes,
				mode: 'live',
				chunkStreamClient: this[ENGINE_GET_CHUNK_STREAM_CLIENT](),
				chunkAudioNodeFactory: this.chunkAudioNodeFactory,
				signal: graph.abortController.signal,
				deferStartUntilPrimed: true,
			});
		} catch (error) {
			if (this.graph === graph) this[ENGINE_HALT_GRAPH]();
			throw error;
		}
		if (this.graph !== graph) return schedule.contextStartTime;
		scheduledTime = schedule.contextStartTime;
		this.playbackStartTime = scheduledTime + (this.graph.latencyFrames || 0) / (context.sampleRate || DEFAULT_SAMPLE_RATE);
		if (this.loop.enabled && this.loop.endFrame > this.loop.startFrame) {
			this.loopScheduleTime = scheduledTime + (this.loop.endFrame - fromFrame) / (this.sampleRate * this.playbackRate);
			this[ENGINE_SCHEDULE_LOOP_AHEAD]();
		}
		this[ENGINE_SET_STATE]('playing');
		this.masterLoudnessMeter?.setRunning(!this.loudnessMeasurementManuallyPaused);
		this[ENGINE_START_TICKER]();
		this[ENGINE_EMIT_POSITION]();
		return scheduledTime;
	},

[ENGINE_GET_CHUNK_STREAM_CLIENT]() {
		if (!this.chunkSources.size) return null;
		if (!this.chunkStreamClient) this.chunkStreamClient = this.chunkStreamClientFactory();
		return this.chunkStreamClient;
	},

async [ENGINE_ENSURE_MASTER_LOUDNESS_METER](context) {
		if (!this.meterListeners.size) return this.masterLoudnessMeter;
		const meterChannelCount = configureMasterLoudnessMeterChannelCount(
			context.destination,
			this.project?.masterChannels,
		);
		const meterChannelWeights = meterChannelCount === null ? null : resolveAdmEbuChannelWeights(
			this.project?.metadata?.adm,
			meterChannelCount,
		);
		if ((this.masterLoudnessMeterChannelCount !== null
			&& this.masterLoudnessMeterChannelCount !== meterChannelCount)
			|| this.masterLoudnessMeterChannelWeights !== meterChannelWeights) {
			this.masterLoudnessMeter?.dispose();
			this.masterLoudnessMeter = null;
			this.masterLoudnessMeterChannelCount = null;
			this.masterLoudnessMeterChannelWeights = null;
			this.masterLoudnessMeterPromise = null;
			this.masterLoudnessMeterError = null;
		}
		if (meterChannelCount === null) {
			if (!this.masterLoudnessMeterError) {
				this.masterLoudnessMeterError = new RangeError(
					'Master loudness metering supports up to 8 channels; immersive playback continues without loudness metering.',
				);
			}
			return null;
		}
		if (this.masterLoudnessMeter || this.masterLoudnessMeterError) {
			return this.masterLoudnessMeter;
		}
		if (this.masterLoudnessMeterPromise) return this.masterLoudnessMeterPromise;
		this.masterLoudnessMeterChannelCount = meterChannelCount;
		this.masterLoudnessMeterChannelWeights = meterChannelWeights;
		const lifecycleGeneration = this.lifecycleGeneration;
		const requestIsCurrent = (): boolean => !this.disposed
			&& this.lifecycleGeneration === lifecycleGeneration
			&& this.context === context
			&& this.masterLoudnessMeterChannelCount === meterChannelCount
			&& this.masterLoudnessMeterChannelWeights === meterChannelWeights;
		const pending = (async () => {
			try {
				const meter = await createEbuR128MeterNode(context, {
					channelCount: meterChannelCount,
					...(meterChannelWeights ? { channelWeights: meterChannelWeights } : {}),
					passthrough: true,
					running: this.state === 'playing' && !this.loudnessMeasurementManuallyPaused,
					onMeter: (reading: unknown) => {
						if (!requestIsCurrent()) return;
						this.latestMasterLoudnessMeter = reading && typeof reading === 'object'
							? reading as Readonly<{ loudness?: unknown }>
							: null;
					},
				});
				if (!requestIsCurrent()) {
					meter.dispose();
					return null;
				}
				if (this.masterLoudnessMeter) {
					meter.dispose();
					return this.masterLoudnessMeter;
				}
				meter.node.connect(soundscaperNativeAudioDestination(context, context.destination));
				this.masterLoudnessMeterError = null;
				this.masterLoudnessMeter = meter;
				return meter;
			} catch (error) {
				if (requestIsCurrent() && !this.masterLoudnessMeter) this.masterLoudnessMeterError = error;
				return null;
			}
		})();
		this.masterLoudnessMeterPromise = pending;
		try {
			return await pending;
		} finally {
			if (this.masterLoudnessMeterPromise === pending) this.masterLoudnessMeterPromise = null;
		}
	},

[ENGINE_HANDLE_SCHEDULING_ERROR](error) {
		if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return;
		this[ENGINE_HALT_GRAPH]();
		this.masterLoudnessMeter?.setRunning(false);
		this[ENGINE_SET_STATE](this.project ? 'stopped' : 'empty');
		globalThis.console?.error?.(error);
	},

[ENGINE_START_TICKER]() {
		this[ENGINE_STOP_TICKER]();
		this.ticker = globalThis.setInterval(() => {
			if (this.state !== 'playing') return;
			const frame = this.getPositionFrames();
			this[ENGINE_EMIT_POSITION](frame);
			this[ENGINE_EMIT_METERS]();
			if (this.loop.enabled && this.loop.endFrame > this.loop.startFrame) {
				this[ENGINE_SCHEDULE_LOOP_AHEAD]();
				return;
			}
			if (frame < this.playEndFrame) return;
			this.positionFrame = this.playbackDurationFrames;
			this[ENGINE_HALT_GRAPH]();
			this.masterLoudnessMeter?.setRunning(false);
			this[ENGINE_SET_STATE]('stopped');
			this[ENGINE_EMIT_POSITION]();
		}, this.meterInterval);
		(this.ticker as unknown as { unref?(): void })?.unref?.();
	},

[ENGINE_SCHEDULE_LOOP_AHEAD]() {
		if (!this.graph || !this.context || !this.project || !this.loop.enabled) return;
		if (this.playbackMode === 'staffpad' || this.playbackMode === 'audio-warp-exact') return;
		const durationSeconds = (this.loop.endFrame - this.loop.startFrame) / (this.sampleRate * this.playbackRate);
		if (!(durationSeconds > 0)) return;
		const horizon = this.context.currentTime + Math.max(0.25, this.meterInterval / 1000 * 4);
		let scheduledIterations = 0;
		while (this.loopScheduleTime < horizon && scheduledIterations < 1_024) {
			const graph = this.graph;
			void scheduleProjectClips({
				context: this.context,
				project: this.project,
				sources: this.sources,
				trackInputs: this.graph.trackInputs,
				trackGainParams: this.graph.trackGainParams,
				projectGainParams: this.graph.projectGainParams,
				parameterRegistry: this.graph.parameterRegistry,
				fromFrame: this.loop.startFrame,
				toFrame: this.loop.endFrame,
				contextStartTime: this.loopScheduleTime,
				sampleRate: this.sampleRate,
				transportRate: this.playbackRate,
				reversedBuffers: this.reversedBuffers,
				sourceResolver: this.sourceResolver,
				chunkSources: this.chunkSources,
				activeSources: this.graph.sources,
				allNodes: this.graph.nodes,
				mode: 'live',
				chunkStreamClient: this[ENGINE_GET_CHUNK_STREAM_CLIENT](),
				chunkAudioNodeFactory: this.chunkAudioNodeFactory,
				signal: graph.abortController.signal,
			}).catch((error) => this[ENGINE_HANDLE_SCHEDULING_ERROR](error));
			this.loopScheduleTime += durationSeconds;
			scheduledIterations += 1;
		}
	},

[ENGINE_STOP_TICKER]() {
		if (this.ticker !== null) {
			globalThis.clearInterval(this.ticker);
			this.ticker = null;
		}
	},

[ENGINE_CANCEL_SCRUB]() {
		this.scrubbing = false;
		this.scrubNextAt = 0;
		this.scrubGeneration += 1;
	},

[ENGINE_HALT_GRAPH]() {
		this.masterLoudnessMeter?.setRunning(false);
		this[ENGINE_STOP_TICKER]();
		if (this.scrubTimer !== null) {
			globalThis.clearTimeout(this.scrubTimer);
			this.scrubTimer = null;
		}
		if (this.graph) {
			disposeGraph(this.graph, true);
			this.graph = null;
		}
	},

[ENGINE_EMIT_POSITION](this: EngineRuntimeHost, frame = this.getPositionFrames()) {
		for (const listener of this.positionListeners) listener(frame, this.playbackDurationFrames);
	},

[ENGINE_EMIT_METERS]() {
		if (!this.graph || !this.meterListeners.size) return;
		const tracks: Record<string, EngineMeterReading> = {};
		for (const [trackId, analyser] of this.graph.trackAnalysers) tracks[trackId] = readMeter(analyser);
		const groups: Record<string, EngineMeterReading> = {};
		const sends: Record<string, EngineMeterReading> = {};
		for (const [busId, analyser] of this.graph.groupAnalysers || []) groups[busId] = readMeter(analyser);
		for (const [busId, analyser] of this.graph.sendAnalysers || []) sends[busId] = readMeter(analyser);
		const master = readMeter(this.graph.masterAnalyser);
		if (this.latestMasterLoudnessMeter?.loudness) {
			master.loudness = this.latestMasterLoudnessMeter.loudness;
		}
		const production = hasProductionMixerProjectAuthority(this.project)
			? sampleProductionMeterSessionV21(
				this,
				this.project,
				this.graph.productionStripAnalysersV21,
				this.latestMasterLoudnessMeter,
			)
			: {};
		const meter = { master, tracks, groups, sends, ...production };
		for (const listener of this.meterListeners) listener(meter);
	},

[ENGINE_EMIT_PARAMETRIC_EQ_ERROR](error) {
		for (const listener of this.parametricEqErrorListeners) listener(error);
	},

[ENGINE_SET_STATE](value) {
		if (this.state === value) return;
		this.state = value;
		for (const listener of this.stateListeners) listener(value);
	}
} satisfies EngineRuntimeMethodMap<
	| typeof ENGINE_SCHEDULE_CURRENT_PLAYBACK
	| typeof ENGINE_SCHEDULE_PREPARED_SPEED_PLAYBACK
	| typeof ENGINE_SCHEDULE_PLAYBACK
	| typeof ENGINE_GET_CHUNK_STREAM_CLIENT
	| typeof ENGINE_ENSURE_MASTER_LOUDNESS_METER
	| typeof ENGINE_HANDLE_SCHEDULING_ERROR
	| typeof ENGINE_START_TICKER
	| typeof ENGINE_SCHEDULE_LOOP_AHEAD
	| typeof ENGINE_STOP_TICKER
	| typeof ENGINE_CANCEL_SCRUB
	| typeof ENGINE_HALT_GRAPH
	| typeof ENGINE_EMIT_POSITION
	| typeof ENGINE_EMIT_METERS
	| typeof ENGINE_EMIT_PARAMETRIC_EQ_ERROR
	| typeof ENGINE_SET_STATE
>;
