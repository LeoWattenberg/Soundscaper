/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAbortError,
	throwIfAborted,
} from './async-utils.ts';
import {
	prepareExactAudioWarpPlayback,
	projectHasAuthoredAudioWarp,
} from './audio-warp-fallback.ts';
import {
	assertPlayAtSpeedStaffPadMemorySafe,
	audioBufferChannels,
	clamp,
	clampFrame,
	DEFAULT_SAMPLE_RATE,
	normalizeLoop,
	normalizePlayAtSpeedRate,
	normalizePreparedSpeedPlayback,
	positiveInteger,
} from './buffer-math.ts';
import {
	scheduleProjectClips,
} from './clip-scheduler.ts';
import {
	ensureProjectWorklets,
	getParametricEqWasmModule,
} from './effect-worklets.ts';
import {
	buildProjectGraph,
} from './project-graph.ts';
import { resetProductionMeterSessionV21 } from './production-meter-runtime-session-v21.ts';
import {
	disposeGraph,
} from './transport-scheduler.ts';
import { soundscaperNativeAudioDestination } from '../soundscaper-native-audio-renderer.ts';
import {
	ENGINE_ASSERT_ACTIVE,
	ENGINE_CANCEL_SCRUB,
	ENGINE_EMIT_PARAMETRIC_EQ_ERROR,
	ENGINE_EMIT_POSITION,
	ENGINE_ENSURE_MASTER_LOUDNESS_METER,
	ENGINE_GET_CHUNK_STREAM_CLIENT,
	ENGINE_HANDLE_SCHEDULING_ERROR,
	ENGINE_HALT_GRAPH,
	ENGINE_SCHEDULE_CURRENT_PLAYBACK,
	ENGINE_SCHEDULE_PLAYBACK,
	ENGINE_SCHEDULE_PREPARED_SPEED_PLAYBACK,
	ENGINE_SET_STATE,
} from './runtime-symbols.ts';
import type {
	EngineRuntimeMethodMap,
	EngineRuntimeHost,
} from './runtime-types.ts';


const DEFAULT_SCRUB_FRAME_MS = 50;

function monotonicMilliseconds(): number {
	return globalThis.performance?.now?.() ?? Date.now();
}

function isAbortError(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}

function playbackRequestIsCurrent(engine: EngineRuntimeHost, generation: number): boolean {
	return !engine.disposed && engine.project !== null && engine.scrubGeneration === generation;
}

function assertPlaybackRequestCurrent(engine: EngineRuntimeHost, generation: number): void {
	if (!playbackRequestIsCurrent(engine, generation)) throw createAbortError();
}

export const engineTransportControlMethods = {
async play() {
		this[ENGINE_ASSERT_ACTIVE]();
		if (!this.project) throw new Error('Load an audio editor project before playback.');
		if (this.state === 'playing') return;
		this[ENGINE_CANCEL_SCRUB]();
		const generation = this.scrubGeneration;
		this.playbackRate = 1;
		this.preparedSpeedPlayback = null;
		const context = await this.getAudioContext();
		if (!playbackRequestIsCurrent(this, generation)) return;
		if (this.positionFrame >= this.playbackDurationFrames) this.positionFrame = 0;
		if (this.loop.enabled && (this.positionFrame < this.loop.startFrame || this.positionFrame >= this.loop.endFrame)) this.positionFrame = this.loop.startFrame;
		if (projectHasAuthoredAudioWarp(this.project)
			&& this.getAudioWarpRenderStatus().path === 'exact-offline') {
			// Bounded exact windows exist over authored content only, never over
			// the silent extended editor timeline.
			if (this.positionFrame >= this.durationFrames) this.positionFrame = 0;
			await prepareExactAudioWarpPlayback(
				this,
				this.positionFrame,
				this.loop.enabled ? this.loop.endFrame : this.durationFrames,
			);
			if (!playbackRequestIsCurrent(this, generation)) return;
			this.playbackMode = 'audio-warp-exact';
			await this[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context);
			if (!playbackRequestIsCurrent(this, generation)) return;
			await this[ENGINE_SCHEDULE_PREPARED_SPEED_PLAYBACK](this.positionFrame, context.currentTime);
			return;
		}
		this.playbackMode = 'normal';
		await ensureProjectWorklets(context, this.project);
		if (!playbackRequestIsCurrent(this, generation)) return;
		await this[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context);
		if (!playbackRequestIsCurrent(this, generation)) return;
		await this[ENGINE_SCHEDULE_PLAYBACK](this.positionFrame, context.currentTime);
	},

async playAtSpeed(rate, {
		preservePitch = false,
		pitchPreserver = null,
		signal = null,
		onProgress = null,
	} = {}) {
		this[ENGINE_ASSERT_ACTIVE]();
		if (!this.project) throw new Error('Load an audio editor project before playback.');
		if (this.state === 'playing') return;
		this[ENGINE_CANCEL_SCRUB]();
		const generation = this.scrubGeneration;
		const normalizedRate = normalizePlayAtSpeedRate(rate);
		if (projectHasAuthoredAudioWarp(this.project)
			&& this.getAudioWarpRenderStatus().path === 'exact-offline') {
			throw new Error('Variable-speed audio warp playback requires realtime warp acceleration.');
		}
		const cancelPendingPlayback = () => {
			if (!playbackRequestIsCurrent(this, generation)) return;
			const position = this.getPositionFrames();
			const wasPlaying = this.state === 'playing';
			this[ENGINE_CANCEL_SCRUB]();
			this[ENGINE_HALT_GRAPH]();
			this.positionFrame = position;
			if (wasPlaying) this[ENGINE_SET_STATE](this.project ? 'paused' : 'empty');
			this[ENGINE_EMIT_POSITION]();
		};
		signal?.addEventListener('abort', cancelPendingPlayback, { once: true });
		try {
			throwIfAborted(signal);
			if (this.positionFrame >= this.playbackDurationFrames) this.positionFrame = 0;
			if (this.loop.enabled && (this.positionFrame < this.loop.startFrame || this.positionFrame >= this.loop.endFrame)) {
				this.positionFrame = this.loop.startFrame;
			}
			if (preservePitch) assertPlayAtSpeedStaffPadMemorySafe(
				this.durationFrames,
				this.sampleRate,
				normalizedRate,
			);
			this.playbackRate = normalizedRate;
			if (!preservePitch) {
				this.playbackMode = 'naive';
				this.preparedSpeedPlayback = null;
				const context = await this.getAudioContext();
				throwIfAborted(signal);
				assertPlaybackRequestCurrent(this, generation);
				await ensureProjectWorklets(context, this.project);
				throwIfAborted(signal);
				assertPlaybackRequestCurrent(this, generation);
				await this[ENGINE_SCHEDULE_PLAYBACK](this.positionFrame, context.currentTime);
				throwIfAborted(signal);
				assertPlaybackRequestCurrent(this, generation);
				return;
			}
			if (typeof pitchPreserver !== 'function') {
				throw new TypeError('Pitch-preserving playback requires a StaffPad renderer.');
			}
			if (this.preparedSpeedPlayback?.playbackRate !== normalizedRate) {
				const renderedProject = this.project;
				const rendered = await this.renderMix({
					startFrame: 0,
					endFrame: this.durationFrames,
					includeTail: false,
					signal,
					onProgress,
				});
				throwIfAborted(signal);
				assertPlaybackRequestCurrent(this, generation);
				const channels = audioBufferChannels(rendered);
				const processed = await pitchPreserver(channels, this.sampleRate, normalizedRate, { signal, onProgress });
				throwIfAborted(signal);
				assertPlaybackRequestCurrent(this, generation);
				if (this.project !== renderedProject) throw createAbortError();
				this.preparedSpeedPlayback = normalizePreparedSpeedPlayback(
					processed,
					this.sampleRate,
					this.durationFrames,
					normalizedRate,
				);
			}
			this.playbackMode = 'staffpad';
			const context = await this.getAudioContext();
			throwIfAborted(signal);
			assertPlaybackRequestCurrent(this, generation);
			await this[ENGINE_SCHEDULE_PREPARED_SPEED_PLAYBACK](this.positionFrame, context.currentTime);
			throwIfAborted(signal);
			assertPlaybackRequestCurrent(this, generation);
		} finally {
			signal?.removeEventListener('abort', cancelPendingPlayback);
		}
	},

async playAt(this: EngineRuntimeHost, contextTime, fromFrame = this.positionFrame) {
		this[ENGINE_ASSERT_ACTIVE]();
		if (!this.project) throw new Error('Load an audio editor project before playback.');
		this[ENGINE_CANCEL_SCRUB]();
		const generation = this.scrubGeneration;
		this.playbackRate = 1;
		this.preparedSpeedPlayback = null;
		const context = await this.getAudioContext();
		assertPlaybackRequestCurrent(this, generation);
		if (projectHasAuthoredAudioWarp(this.project)
			&& this.getAudioWarpRenderStatus().path === 'exact-offline') {
			let scheduledFrame = clampFrame(fromFrame, 0, this.durationFrames);
			if (this.loop.enabled && (scheduledFrame < this.loop.startFrame || scheduledFrame >= this.loop.endFrame)) {
				scheduledFrame = this.loop.startFrame;
			}
			if (scheduledFrame >= this.durationFrames) {
				return Math.max(context.currentTime, Number(contextTime) || context.currentTime);
			}
			await prepareExactAudioWarpPlayback(
				this,
				scheduledFrame,
				this.loop.enabled ? this.loop.endFrame : this.durationFrames,
			);
			assertPlaybackRequestCurrent(this, generation);
			this.playbackMode = 'audio-warp-exact';
			await this[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context);
			assertPlaybackRequestCurrent(this, generation);
			const scheduledTime = Math.max(context.currentTime, Number(contextTime) || context.currentTime);
			this.positionFrame = scheduledFrame;
			const scheduled = await this[ENGINE_SCHEDULE_PREPARED_SPEED_PLAYBACK](this.positionFrame, scheduledTime);
			assertPlaybackRequestCurrent(this, generation);
			return scheduled;
		}
		this.playbackMode = 'normal';
		await ensureProjectWorklets(context, this.project);
		assertPlaybackRequestCurrent(this, generation);
		await this[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context);
		assertPlaybackRequestCurrent(this, generation);
		const scheduledTime = Math.max(context.currentTime, Number(contextTime) || context.currentTime);
		this.positionFrame = clampFrame(fromFrame, 0, this.playbackDurationFrames);
		const scheduled = await this[ENGINE_SCHEDULE_PLAYBACK](this.positionFrame, scheduledTime);
		assertPlaybackRequestCurrent(this, generation);
		return scheduled;
	},

pause() {
		this[ENGINE_ASSERT_ACTIVE]();
		this[ENGINE_CANCEL_SCRUB]();
		if (this.state !== 'playing') return;
		this.positionFrame = this.getPositionFrames();
		this[ENGINE_HALT_GRAPH]();
		this.masterLoudnessMeter?.setRunning(false);
		this[ENGINE_SET_STATE]('paused');
		this[ENGINE_EMIT_POSITION]();
	},

stop() {
		this[ENGINE_ASSERT_ACTIVE]();
		this[ENGINE_CANCEL_SCRUB]();
		this[ENGINE_HALT_GRAPH]();
		this.masterLoudnessMeter?.setRunning(false);
		this.positionFrame = 0;
		this[ENGINE_SET_STATE](this.project ? 'stopped' : 'empty');
		this[ENGINE_EMIT_POSITION]();
	},

seek(frame) {
		this[ENGINE_ASSERT_ACTIVE]();
		const nextFrame = clampFrame(frame, 0, this.playbackDurationFrames);
		const wasPlaying = this.state === 'playing';
		this[ENGINE_CANCEL_SCRUB]();
		this[ENGINE_HALT_GRAPH]();
		this.positionFrame = nextFrame;
		if (wasPlaying && nextFrame < this.playbackDurationFrames) void this[ENGINE_SCHEDULE_CURRENT_PLAYBACK](nextFrame).catch((error) => this[ENGINE_HANDLE_SCHEDULING_ERROR](error));
		else {
			this[ENGINE_SET_STATE](this.project ? 'paused' : 'empty');
			this[ENGINE_EMIT_POSITION]();
		}
		return this.positionFrame;
	},

pauseLoudnessMeasurement() {
		this.loudnessMeasurementManuallyPaused = true;
		this.masterLoudnessMeter?.setRunning(false);
		return this.getLoudnessMeasurementState();
	},

continueLoudnessMeasurement() {
		this.loudnessMeasurementManuallyPaused = false;
		this.masterLoudnessMeter?.setRunning(this.state === 'playing');
		return this.getLoudnessMeasurementState();
	},

resetLoudnessMeasurement() {
		this.masterLoudnessMeter?.reset();
		this.masterLoudnessMeter?.requestSnapshot();
		resetProductionMeterSessionV21(this);
		return this.getLoudnessMeasurementState();
	},

getLoudnessMeasurementState() {
		return Object.freeze({
			manuallyPaused: this.loudnessMeasurementManuallyPaused,
			running: this.state === 'playing' && !this.loudnessMeasurementManuallyPaused,
			error: this.masterLoudnessMeterError,
		});
	},

async scrub(frame, { durationMs = DEFAULT_SCRUB_FRAME_MS } = {}) {
		this[ENGINE_ASSERT_ACTIVE]();
		if (!this.project) throw new Error('Load an audio editor project before scrubbing.');
		const nextFrame = clampFrame(frame, 0, this.playbackDurationFrames);
		const frameMs = clamp(Number(durationMs) || DEFAULT_SCRUB_FRAME_MS, 16, 250);
		if (!this.scrubbing) {
			this[ENGINE_CANCEL_SCRUB]();
			this[ENGINE_HALT_GRAPH]();
			this.scrubbing = true;
		}
		this.positionFrame = nextFrame;
		this[ENGINE_SET_STATE]('paused');
		this[ENGINE_EMIT_POSITION]();

		const now = this.monotonicNow ? this.monotonicNow() : monotonicMilliseconds();
		if (now < this.scrubNextAt || nextFrame >= this.playbackDurationFrames) return this.positionFrame;
		this.scrubNextAt = now + frameMs;
		const generation = ++this.scrubGeneration;
		this[ENGINE_HALT_GRAPH]();
		const context = await this.getAudioContext();
		if (projectHasAuthoredAudioWarp(this.project)
			&& this.getAudioWarpRenderStatus().path === 'exact-offline') {
			throw new Error('Audio warp scrub preview requires realtime warp acceleration.');
		}
		await ensureProjectWorklets(context, this.project);
		if (!this.scrubbing || generation !== this.scrubGeneration || !this.project) return this.positionFrame;

		const fromFrame = this.positionFrame;
		const frameCount = Math.max(1, Math.round(frameMs / 1000 * this.sampleRate));
		const toFrame = Math.min(this.playbackDurationFrames, fromFrame + frameCount);
		if (toFrame <= fromFrame) return this.positionFrame;
		const graph = buildProjectGraph(context, soundscaperNativeAudioDestination(context, context.destination), this.project, {
			metering: false,
			respectMuteSolo: true,
			monitoring: true,
			parametricEqWasmModule: getParametricEqWasmModule(context),
			onParametricEqError: (error) => this[ENGINE_EMIT_PARAMETRIC_EQ_ERROR](error),
		});
		this.graph = graph;
		try {
			const schedule = await scheduleProjectClips({
				context,
				project: this.project,
				sources: this.sources,
				trackInputs: graph.trackInputs,
				trackGainParams: graph.trackGainParams,
				projectGainParams: graph.projectGainParams,
				parameterRegistry: graph.parameterRegistry,
				fromFrame,
				toFrame,
				contextStartTime: context.currentTime,
				sampleRate: this.sampleRate,
				reversedBuffers: this.reversedBuffers,
				sourceResolver: this.sourceResolver,
				chunkSources: this.chunkSources,
				activeSources: graph.sources,
				allNodes: graph.nodes,
				mode: 'live',
				chunkStreamClient: this[ENGINE_GET_CHUNK_STREAM_CLIENT](),
				chunkAudioNodeFactory: this.chunkAudioNodeFactory,
				signal: graph.abortController.signal,
				deferStartUntilPrimed: true,
			});
			if (this.graph !== graph || !this.scrubbing || generation !== this.scrubGeneration) return this.positionFrame;
			const latencyMs = (graph.latencyFrames || 0) / (context.sampleRate || DEFAULT_SAMPLE_RATE) * 1000;
			const scheduledDelayMs = Math.max(0, (schedule.contextStartTime - context.currentTime) * 1000);
			this.scrubTimer = globalThis.setTimeout(() => {
				if (this.graph !== graph || generation !== this.scrubGeneration) return;
				disposeGraph(graph, true);
				this.graph = null;
				this.scrubTimer = null;
			}, scheduledDelayMs + latencyMs + (toFrame - fromFrame) / this.sampleRate * 1000);
		} catch (error) {
			if (this.graph === graph) this[ENGINE_HALT_GRAPH]();
			if (!isAbortError(error)) throw error;
		}
		return this.positionFrame;
	},

endScrub() {
		this[ENGINE_ASSERT_ACTIVE]();
		if (!this.scrubbing) return this.positionFrame;
		this[ENGINE_CANCEL_SCRUB]();
		this[ENGINE_HALT_GRAPH]();
		this[ENGINE_SET_STATE](this.project ? 'paused' : 'empty');
		this[ENGINE_EMIT_POSITION]();
		return this.positionFrame;
	},

setLoop(loopOrEnabled, startFrame, endFrame) {
		this[ENGINE_ASSERT_ACTIVE]();
		const value = typeof loopOrEnabled === 'object'
			? loopOrEnabled
			: { enabled: loopOrEnabled, startFrame, endFrame };
		this.loop = normalizeLoop(value, this.durationFrames);
		if (this.state === 'playing') {
			const position = this.getPositionFrames();
			if (this.loop.enabled && (position < this.loop.startFrame || position >= this.loop.endFrame)) {
				this.seek(this.loop.startFrame);
			} else {
				this[ENGINE_HALT_GRAPH]();
				this.positionFrame = position;
				void this[ENGINE_SCHEDULE_CURRENT_PLAYBACK](position).catch((error) => this[ENGINE_HANDLE_SCHEDULING_ERROR](error));
			}
		}
		return { ...this.loop };
	},

getPositionFrames() {
		if (this.state !== 'playing' || !this.context) return this.positionFrame;
		if (this.context.currentTime <= this.playbackStartTime) return this.playbackStartFrame;
		const elapsedFrames = Math.floor((this.context.currentTime - this.playbackStartTime) * this.sampleRate * this.playbackRate);
		if (this.loop.enabled && this.loop.endFrame > this.loop.startFrame) {
			const initialFrames = Math.max(0, this.loop.endFrame - this.playbackStartFrame);
			if (elapsedFrames < initialFrames) return this.playbackStartFrame + elapsedFrames;
			const loopFrames = this.loop.endFrame - this.loop.startFrame;
			return this.loop.startFrame + ((elapsedFrames - initialFrames) % loopFrames);
		}
		return clampFrame(this.playbackStartFrame + elapsedFrames, 0, this.playEndFrame);
	},

getState() {
		return {
			state: this.state,
			positionFrame: this.getPositionFrames(),
			durationFrames: this.durationFrames,
			loop: { ...this.loop },
			playbackRate: this.playbackRate,
			playbackMode: this.playbackMode,
		};
	},

subscribePosition(listener) {
		if (typeof listener !== 'function') return () => {};
		this.positionListeners.add(listener);
		return () => this.positionListeners.delete(listener);
	},

subscribeMeters(listener) {
		if (typeof listener !== 'function') return () => {};
		const needsMeterGraph = this.meterListeners.size === 0 && this.state === 'playing' && !this.graph?.masterAnalyser;
		this.meterListeners.add(listener);
		if (needsMeterGraph) {
			const position = this.getPositionFrames();
			this.positionFrame = position;
			void this[ENGINE_SCHEDULE_CURRENT_PLAYBACK](position).catch((error) => this[ENGINE_HANDLE_SCHEDULING_ERROR](error));
		}
		return () => this.meterListeners.delete(listener);
	},

subscribeState(listener) {
		if (typeof listener !== 'function') return () => {};
		this.stateListeners.add(listener);
		return () => this.stateListeners.delete(listener);
	},

subscribeParametricEqErrors(listener) {
		if (typeof listener !== 'function') return () => {};
		this.parametricEqErrorListeners.add(listener);
		return () => this.parametricEqErrorListeners.delete(listener);
	}
} satisfies EngineRuntimeMethodMap<
	| 'play'
	| 'playAtSpeed'
	| 'playAt'
	| 'pause'
	| 'stop'
	| 'seek'
	| 'pauseLoudnessMeasurement'
	| 'continueLoudnessMeasurement'
	| 'resetLoudnessMeasurement'
	| 'getLoudnessMeasurementState'
	| 'scrub'
	| 'endScrub'
	| 'setLoop'
	| 'getPositionFrames'
	| 'getState'
	| 'subscribePosition'
	| 'subscribeMeters'
	| 'subscribeState'
	| 'subscribeParametricEqErrors'
>;

export const engineTransportAccessors = {
get sampleRate() {
		return positiveInteger(this.project?.sampleRate, DEFAULT_SAMPLE_RATE);
	}
} satisfies EngineRuntimeMethodMap<'sampleRate'>;
