import { rackTailFrames } from './effects.js';
import { envelopeValueAtFrame } from './automation.js';
import {
	AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES,
	estimateAudacityEffectPeakBytes,
} from './audacity-effects/index.js';
import {
	audacityLiveEffectCapability,
	isAudacityLiveEffect,
} from './audacity-effects/live.js';
import {
	ChunkStreamClient,
	createChunkStreamAudioNode,
} from './chunk-stream-client.js';
import { AUDIO_EDITOR_STORAGE_CHUNK_FRAMES } from './chunk-stream.js';
import { createAsyncPlanarPcmSinkQueue } from './pcm-sink.js';
import { loadParametricEqWasmModule } from './parametric-eq/wasm-loader.js';
import { designParametricEqWasmConfiguration } from './parametric-eq/wasm-runtime.js';
import { audioTrackChannelCountV2 } from './project-v2.js';
import { createEbuR128MeterNode } from './ebu-r128-node.js';
export {
	createRecordingCapturePool,
	createRecordingController,
	requestDisplayInput,
	requestHardwareInput,
	requestMicrophone,
} from './recording.js';

const DEFAULT_SAMPLE_RATE = 48000;
const DEFAULT_METER_INTERVAL = 50;
const DEFAULT_SCRUB_FRAME_MS = 50;
const MAX_EFFECT_TAIL_SECONDS = 10;
const STREAM_RESAMPLE_RADIUS = 24;
const PLAY_AT_SPEED_MINIMUM_RATE = 0.5;
const PLAY_AT_SPEED_MAXIMUM_RATE = 2;
export const PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES = AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES;
export const PARAMETRIC_EQ_SPECTRUM_FFT_SIZE = 4_096;
const PARAMETRIC_EQ_WORKLET_NAME = 'kw-parametric-eq';
const PARAMETRIC_EQ_TYPES = new Set(['eq', 'parametric-eq', 'parametric_eq']);
const dynamicsWorkletContexts = new WeakSet();
const audacityWorkletContexts = new WeakSet();
const parametricEqWorkletContexts = new WeakSet();
const parametricEqWasmModules = new WeakMap();
const dynamicsWorkletLoads = new WeakMap();
const audacityWorkletLoads = new WeakMap();
const parametricEqWorkletLoads = new WeakMap();
const parametricEqPortMessageHandlers = new WeakMap();

export function isAudioEditorEngineSupported() {
	return Boolean(getAudioContextConstructor());
}

/** @returns {WebAudioEditorEngine} */
export function createAudioEditorEngine(options = {}) {
	return new WebAudioEditorEngine(options);
}

/**
 * Repository-owned Web Audio transport. The canonical project stays external;
 * this adapter only schedules the supplied immutable snapshot and buffers.
 */
export class WebAudioEditorEngine {
	constructor({
		audioContextFactory,
		offlineAudioContextFactory,
		softwareRenderer,
		sourceResolver,
		chunkStreamClient,
		chunkStreamClientFactory,
		chunkAudioNodeFactory,
		onPosition,
		onMeter,
		onState,
		onParametricEqError,
		meterInterval = DEFAULT_METER_INTERVAL,
	} = {}) {
		this.audioContextFactory = audioContextFactory || getAudioContextConstructor();
		this.offlineAudioContextFactory = offlineAudioContextFactory || getOfflineAudioContextConstructor();
		this.softwareRenderer = softwareRenderer;
		this.sourceResolver = normalizeSourceResolver(sourceResolver);
		this.chunkStreamClient = chunkStreamClient || null;
		this.chunkStreamClientFactory = chunkStreamClientFactory || (() => new ChunkStreamClient());
		this.chunkAudioNodeFactory = chunkAudioNodeFactory || createChunkStreamAudioNode;
		this.project = null;
		this.sources = new Map();
		this.chunkSources = new Map();
		this.context = null;
		this.preferredOutputDeviceId = '';
		this.activeOutputDeviceId = '';
		this.outputDeviceError = null;
		this.positionFrame = 0;
		this.playbackStartFrame = 0;
		this.playbackStartTime = 0;
		this.durationFrames = 0;
		this.playEndFrame = 0;
		this.loopScheduleTime = 0;
		this.playbackRate = 1;
		this.playbackMode = 'normal';
		this.preparedSpeedPlayback = null;
		this.state = 'empty';
		this.loop = { enabled: false, startFrame: 0, endFrame: 0 };
		this.graph = null;
		this.ticker = null;
		this.scrubTimer = null;
		this.scrubNextAt = 0;
		this.scrubGeneration = 0;
		this.scrubbing = false;
		this.meterInterval = Math.max(16, Number(meterInterval) || DEFAULT_METER_INTERVAL);
		this.reversedBuffers = new WeakMap();
		this.positionListeners = new Set(onPosition ? [onPosition] : []);
		this.meterListeners = new Set(onMeter ? [onMeter] : []);
		this.stateListeners = new Set(onState ? [onState] : []);
		this.parametricEqErrorListeners = new Set(onParametricEqError ? [onParametricEqError] : []);
		this.masterLoudnessMeter = null;
		this.masterLoudnessMeterError = null;
		this.latestMasterLoudnessMeter = null;
		this.loudnessMeasurementManuallyPaused = false;
	}

	loadProject(project, sourceBuffers = new Map(), options = {}) {
		this.#cancelScrub();
		this.#haltGraph();
		this.project = project || null;
		this.sources = sourceBuffers instanceof Map ? new Map(sourceBuffers) : new Map(Object.entries(sourceBuffers || {}));
		if (options.chunkSources !== undefined) this.setChunkSources(options.chunkSources);
		this.durationFrames = getProjectDurationFrames(project);
		this.playbackRate = 1;
		this.playbackMode = 'normal';
		this.preparedSpeedPlayback = null;
		this.positionFrame = Math.min(this.positionFrame, this.durationFrames);
		this.playEndFrame = this.durationFrames;
		this.loop = normalizeLoop(project?.loop, this.durationFrames);
		this.loudnessMeasurementManuallyPaused = false;
		this.masterLoudnessMeter?.setRunning(false);
		this.masterLoudnessMeter?.reset();
		this.latestMasterLoudnessMeter = null;
		this.#setState(project ? 'stopped' : 'empty');
		this.#emitPosition();
		return this;
	}

	applyProject(project, sourceBuffers = this.sources, options = {}) {
		const wasPlaying = this.state === 'playing';
		const position = this.getPositionFrames();
		const playbackRate = this.playbackRate;
		const playbackMode = this.playbackMode;
		this.loadProject(project, sourceBuffers, options);
		this.positionFrame = Math.min(position, this.durationFrames);
		if (wasPlaying && playbackMode === 'naive') return this.playAtSpeed(playbackRate);
		// A StaffPad mix belongs to the exact project snapshot that produced it.
		// Stop instead of silently resuming that stale PCM or falling back to 1x.
		if (wasPlaying && playbackMode !== 'staffpad') return this.play();
		this.#emitPosition();
		return Promise.resolve();
	}

	/** Install a synchronous committed-cache resolver without changing source maps. */
	setSourceResolver(sourceResolver = null) {
		this.sourceResolver = normalizeSourceResolver(sourceResolver);
		return this;
	}

	/** Install immutable long-source providers without materializing AudioBuffers. */
	setChunkSources(chunkSources = new Map()) {
		const entries = chunkSources instanceof Map ? chunkSources : new Map(Object.entries(chunkSources || {}));
		this.chunkSources = new Map([...entries].map(([sourceId, source]) => [String(sourceId), normalizeChunkSource(source)]));
		return this;
	}

	async decodeAudioData(data) {
		const context = await this.getAudioContext({ resume: false });
		if (!context?.decodeAudioData) throw new Error('This AudioContext cannot decode audio.');
		const arrayBuffer = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
		return context.decodeAudioData(arrayBuffer);
	}

	/** Return the editor-owned device-rate context; transport/recording opt into resume. */
	async getAudioContext({ resume = true } = {}) {
		const context = await this.#getContext();
		if (resume) await context.resume?.();
		return context;
	}

	/** Select the realtime context's hardware output without rebuilding its graph. */
	async setOutputDevice(deviceId = '') {
		const normalized = normalizeOutputDeviceId(deviceId);
		if (!this.context) {
			this.preferredOutputDeviceId = normalized;
			this.outputDeviceError = null;
			return this.getOutputDeviceState();
		}
		if (typeof this.context.setSinkId !== 'function') {
			if (normalized) throw outputDeviceError('NotSupportedError', 'Audio output selection is not supported by this browser.');
			this.preferredOutputDeviceId = '';
			this.activeOutputDeviceId = '';
			this.outputDeviceError = null;
			return this.getOutputDeviceState();
		}
		const previousPreferred = this.preferredOutputDeviceId;
		const previousActive = this.activeOutputDeviceId;
		try {
			await this.context.setSinkId(normalized);
			this.preferredOutputDeviceId = normalized;
			this.activeOutputDeviceId = normalized;
			this.outputDeviceError = null;
			return this.getOutputDeviceState();
		} catch (error) {
			this.preferredOutputDeviceId = previousPreferred;
			this.activeOutputDeviceId = previousActive;
			this.outputDeviceError = error;
			throw error;
		}
	}

	getOutputDeviceState() {
		return Object.freeze({
			preferredDeviceId: this.preferredOutputDeviceId,
			activeDeviceId: this.activeOutputDeviceId,
			supported: this.context
				? typeof this.context.setSinkId === 'function'
				: typeof this.audioContextFactory?.prototype?.setSinkId === 'function',
			error: this.outputDeviceError,
		});
	}

	async play() {
		if (!this.project) throw new Error('Load an audio editor project before playback.');
		if (this.state === 'playing') return;
		this.#cancelScrub();
		this.playbackRate = 1;
		this.playbackMode = 'normal';
		this.preparedSpeedPlayback = null;
		const context = await this.getAudioContext();
		await ensureProjectWorklets(context, this.project);
		await this.#ensureMasterLoudnessMeter(context);
		if (this.positionFrame >= this.durationFrames) this.positionFrame = 0;
		if (this.loop.enabled && (this.positionFrame < this.loop.startFrame || this.positionFrame >= this.loop.endFrame)) this.positionFrame = this.loop.startFrame;
		await this.#schedulePlayback(this.positionFrame, context.currentTime);
	}

	/**
	 * Play project time at a fixed rate. Naive mode uses rate-coupled Web Audio
	 * interpolation. Pitch-preserving mode renders the authoritative mix once,
	 * then delegates its tempo-only transform to the supplied StaffPad adapter.
	 */
	async playAtSpeed(rate, {
		preservePitch = false,
		pitchPreserver = null,
		signal = null,
		onProgress = null,
	} = {}) {
		if (!this.project) throw new Error('Load an audio editor project before playback.');
		if (this.state === 'playing') return;
		this.#cancelScrub();
		const normalizedRate = normalizePlayAtSpeedRate(rate);
		const cancelPendingPlayback = () => {
			const position = this.getPositionFrames();
			const wasPlaying = this.state === 'playing';
			this.#haltGraph();
			this.positionFrame = position;
			if (wasPlaying) this.#setState(this.project ? 'paused' : 'empty');
			this.#emitPosition();
		};
		signal?.addEventListener('abort', cancelPendingPlayback, { once: true });
		try {
			throwIfAborted(signal);
			if (this.positionFrame >= this.durationFrames) this.positionFrame = 0;
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
				await ensureProjectWorklets(context, this.project);
				throwIfAborted(signal);
				await this.#schedulePlayback(this.positionFrame, context.currentTime);
				throwIfAborted(signal);
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
				const channels = audioBufferChannels(rendered);
				const processed = await pitchPreserver(channels, this.sampleRate, normalizedRate, { signal, onProgress });
				throwIfAborted(signal);
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
			await this.#schedulePreparedSpeedPlayback(this.positionFrame, context.currentTime);
			throwIfAborted(signal);
		} finally {
			signal?.removeEventListener('abort', cancelPendingPlayback);
		}
	}

	/** Schedule transport against an exact AudioContext time (used by punch recording). */
	async playAt(contextTime, fromFrame = this.positionFrame) {
		if (!this.project) throw new Error('Load an audio editor project before playback.');
		this.#cancelScrub();
		this.playbackRate = 1;
		this.playbackMode = 'normal';
		this.preparedSpeedPlayback = null;
		const context = await this.getAudioContext();
		await ensureProjectWorklets(context, this.project);
		await this.#ensureMasterLoudnessMeter(context);
		const scheduledTime = Math.max(context.currentTime, Number(contextTime) || context.currentTime);
		this.positionFrame = clampFrame(fromFrame, 0, this.durationFrames);
		await this.#schedulePlayback(this.positionFrame, scheduledTime);
	}

	pause() {
		if (this.state !== 'playing') return;
		this.#cancelScrub();
		this.positionFrame = this.getPositionFrames();
		this.#haltGraph();
		this.masterLoudnessMeter?.setRunning(false);
		this.#setState('paused');
		this.#emitPosition();
	}

	stop() {
		this.#cancelScrub();
		this.#haltGraph();
		this.masterLoudnessMeter?.setRunning(false);
		this.positionFrame = 0;
		this.#setState(this.project ? 'stopped' : 'empty');
		this.#emitPosition();
	}

	seek(frame) {
		const nextFrame = clampFrame(frame, 0, this.durationFrames);
		const wasPlaying = this.state === 'playing';
		this.#cancelScrub();
		this.#haltGraph();
		this.positionFrame = nextFrame;
		if (wasPlaying && nextFrame < this.durationFrames) void this.#scheduleCurrentPlayback(nextFrame).catch((error) => this.#handleSchedulingError(error));
		else {
			this.#setState(this.project ? 'paused' : 'empty');
			this.#emitPosition();
		}
		return this.positionFrame;
	}

	pauseLoudnessMeasurement() {
		this.loudnessMeasurementManuallyPaused = true;
		this.masterLoudnessMeter?.setRunning(false);
		return this.getLoudnessMeasurementState();
	}

	continueLoudnessMeasurement() {
		this.loudnessMeasurementManuallyPaused = false;
		this.masterLoudnessMeter?.setRunning(this.state === 'playing');
		return this.getLoudnessMeasurementState();
	}

	resetLoudnessMeasurement() {
		this.masterLoudnessMeter?.reset();
		this.masterLoudnessMeter?.requestSnapshot();
		return this.getLoudnessMeasurementState();
	}

	getLoudnessMeasurementState() {
		return Object.freeze({
			manuallyPaused: this.loudnessMeasurementManuallyPaused,
			running: this.state === 'playing' && !this.loudnessMeasurementManuallyPaused,
			error: this.masterLoudnessMeterError,
		});
	}

	/**
	 * Audition a short, independent project-time frame while the playhead is
	 * dragged. Repeated pointer updates are intentionally sampled at the frame
	 * duration instead of joined into continuous playback.
	 */
	async scrub(frame, { durationMs = DEFAULT_SCRUB_FRAME_MS } = {}) {
		if (!this.project) throw new Error('Load an audio editor project before scrubbing.');
		const nextFrame = clampFrame(frame, 0, this.durationFrames);
		const frameMs = clamp(Number(durationMs) || DEFAULT_SCRUB_FRAME_MS, 16, 250);
		if (!this.scrubbing) {
			this.#cancelScrub();
			this.#haltGraph();
			this.scrubbing = true;
		}
		this.positionFrame = nextFrame;
		this.#setState('paused');
		this.#emitPosition();

		const now = monotonicMilliseconds();
		if (now < this.scrubNextAt || nextFrame >= this.durationFrames) return this.positionFrame;
		this.scrubNextAt = now + frameMs;
		const generation = ++this.scrubGeneration;
		this.#haltGraph();
		const context = await this.getAudioContext();
		await ensureProjectWorklets(context, this.project);
		if (!this.scrubbing || generation !== this.scrubGeneration || !this.project) return this.positionFrame;

		const fromFrame = this.positionFrame;
		const frameCount = Math.max(1, Math.round(frameMs / 1000 * this.sampleRate));
		const toFrame = Math.min(this.durationFrames, fromFrame + frameCount);
		if (toFrame <= fromFrame) return this.positionFrame;
		const graph = buildProjectGraph(context, context.destination, this.project, {
			metering: false,
			respectMuteSolo: true,
			parametricEqWasmModule: parametricEqWasmModules.get(context),
			onParametricEqError: (error) => this.#emitParametricEqError(error),
		});
		this.graph = graph;
		try {
			const schedule = await scheduleProjectClips({
				context,
				project: this.project,
				sources: this.sources,
				trackInputs: graph.trackInputs,
				trackGainParams: graph.trackGainParams,
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
				chunkStreamClient: this.#getChunkStreamClient(),
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
			if (this.graph === graph) this.#haltGraph();
			if (error?.name !== 'AbortError') throw error;
		}
		return this.positionFrame;
	}

	endScrub() {
		if (!this.scrubbing) return this.positionFrame;
		this.#cancelScrub();
		this.#haltGraph();
		this.#setState(this.project ? 'paused' : 'empty');
		this.#emitPosition();
		return this.positionFrame;
	}

	setLoop(loopOrEnabled, startFrame, endFrame) {
		const value = typeof loopOrEnabled === 'object'
			? loopOrEnabled
			: { enabled: loopOrEnabled, startFrame, endFrame };
		this.loop = normalizeLoop(value, this.durationFrames);
		if (this.state === 'playing') {
			const position = this.getPositionFrames();
			if (this.loop.enabled && (position < this.loop.startFrame || position >= this.loop.endFrame)) {
				this.seek(this.loop.startFrame);
			} else {
				this.#haltGraph();
				this.positionFrame = position;
				void this.#scheduleCurrentPlayback(position).catch((error) => this.#handleSchedulingError(error));
			}
		}
		return { ...this.loop };
	}

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
	}

	get sampleRate() {
		return positiveInteger(this.project?.sampleRate, DEFAULT_SAMPLE_RATE);
	}

	getState() {
		return {
			state: this.state,
			positionFrame: this.getPositionFrames(),
			durationFrames: this.durationFrames,
			loop: { ...this.loop },
			playbackRate: this.playbackRate,
			playbackMode: this.playbackMode,
		};
	}

	subscribePosition(listener) {
		if (typeof listener !== 'function') return () => {};
		this.positionListeners.add(listener);
		return () => this.positionListeners.delete(listener);
	}

	subscribeMeters(listener) {
		if (typeof listener !== 'function') return () => {};
		const needsMeterGraph = this.meterListeners.size === 0 && this.state === 'playing' && !this.graph?.masterAnalyser;
		this.meterListeners.add(listener);
		if (needsMeterGraph) {
			const position = this.getPositionFrames();
			this.positionFrame = position;
			void this.#scheduleCurrentPlayback(position).catch((error) => this.#handleSchedulingError(error));
		}
		return () => this.meterListeners.delete(listener);
	}

	subscribeState(listener) {
		if (typeof listener !== 'function') return () => {};
		this.stateListeners.add(listener);
		return () => this.stateListeners.delete(listener);
	}

	/** Subscribe to failures reported by parametric EQ processor ports. */
	subscribeParametricEqErrors(listener) {
		if (typeof listener !== 'function') return () => {};
		this.parametricEqErrorListeners.add(listener);
		return () => this.parametricEqErrorListeners.delete(listener);
	}

	/** Update an active parametric EQ without rebuilding or restarting playback. */
	configureParametricEq(scope, targetId, effectId, params, options = {}) {
		if (!params || typeof params !== 'object' || Array.isArray(params)) {
			throw new TypeError('Parametric EQ parameters must be an object.');
		}
		designParametricEqWasmConfiguration(
			params,
			this.context?.sampleRate || this.sampleRate,
			{ effectId },
		);
		const message = { type: 'configure', params };
		if (options.transitionFrames !== undefined) {
			message.transitionFrames = safeMessageSequence(options.transitionFrames, 'transitionFrames');
		}
		const sequence = postParametricEqMessage(
			this.graph,
			scope,
			targetId,
			effectId,
			message,
			options.revision,
		);
		if (sequence !== false) {
			this.project = projectWithParametricEqParams(this.project, scope, targetId, effectId, params) || this.project;
		}
		return sequence;
	}

	/** Temporarily audition one EQ band; pass null to return to the normal path. */
	auditionParametricEq(scope, targetId, effectId, bandId = null) {
		if (bandId !== null && (typeof bandId !== 'string' || !bandId)) {
			throw new TypeError('A parametric EQ audition band ID must be a non-empty string or null.');
		}
		return postParametricEqMessage(this.graph, scope, targetId, effectId, {
			type: 'audition',
			bandId,
		});
	}

	/** Clear an active EQ processor's filter history without rebuilding its graph. */
	resetParametricEq(scope, targetId, effectId) {
		return postParametricEqMessage(this.graph, scope, targetId, effectId, { type: 'reset' });
	}

	/**
	 * Copy one active EQ spectrum into a caller-owned frequency-domain buffer.
	 * Returns immutable analyser metadata, or null when no matching live analyser exists.
	 */
	readParametricEqSpectrum(scope, targetId, effectId, which, target) {
		const key = effectGraphKey(scope, targetId, effectId);
		const entry = this.graph?.effectAnalysers?.get(key);
		return readParametricEqSpectrumEntry(entry, which, target);
	}

	/** Build an independent selection-preview graph through the production EQ worklet. */
	async createParametricEqPreview(buffer, params, { effectId = 'selection-preview-eq' } = {}) {
		if (!buffer || !Number.isSafeInteger(buffer.numberOfChannels)
			|| buffer.numberOfChannels < 1 || buffer.numberOfChannels > 32) {
			throw new RangeError('Parametric EQ preview requires an AudioBuffer with between one and 32 channels.');
		}
		const context = await this.getAudioContext({ resume: true });
		const wasmModule = await ensureParametricEqWorklet(context);
		const nodes = [];
		const effectNodes = new Map();
		const effectAnalysers = new Map();
		let previewError = null;
		let previewErrorListener = null;
		const source = addNode(nodes, context.createBufferSource());
		source.buffer = buffer;
		let output;
		try {
			output = applyEffect(context, source, {
				id: effectId,
				type: 'eq',
				enabled: true,
				params,
			}, nodes, {
				scope: 'master',
				targetId: null,
				effectAnalysis: true,
				effectNodes,
				effectAnalysers,
				parametricEqWasmModule: wasmModule,
				parametricEqChannelCount: buffer.numberOfChannels,
				onParametricEqError: (error) => {
					previewError ||= error;
					this.#emitParametricEqError(error);
					previewErrorListener?.(error);
				},
			});
			connect(output, context.destination);
		} catch (error) {
			for (const node of nodes.reverse()) {
				try { node.disconnect(); } catch { /* The partially built graph may already be disconnected. */ }
			}
			throw error;
		}
		const key = effectGraphKey('master', null, effectId);
		const processor = effectNodes.get(key);
		const analyserEntry = effectAnalysers.get(key);
		const graph = {
			nodes,
			sources: new Set([source]),
			effectNodes,
			effectAnalysers,
			effectMessageSequences: new Map(),
		};
		let sequence = 0;
		let disposed = false;
		const postPreviewMessage = (message) => {
			if (disposed || !processor?.port?.postMessage) return false;
			sequence += 1;
			processor.port.postMessage({ ...message, revision: sequence, sequence });
			return sequence;
		};
		return {
			source,
			get onended() { return source.onended; },
			set onended(listener) { source.onended = listener; },
			get onerror() { return previewErrorListener; },
			set onerror(listener) {
				previewErrorListener = typeof listener === 'function' ? listener : null;
				if (previewError && previewErrorListener) previewErrorListener(previewError);
			},
			start: (...args) => source.start(...args),
			stop: (...args) => source.stop(...args),
			configure: (nextParams) => postPreviewMessage({
					type: 'configure',
					params: cloneMessageValue(nextParams),
					mode: 'smooth',
				}),
			audition: (bandId) => postPreviewMessage({ type: 'audition', bandId }),
			readSpectrum: (which, target) => readParametricEqSpectrumEntry(analyserEntry, which, target),
			disconnect: () => {
				if (disposed) return;
				disposed = true;
				previewErrorListener = null;
				disposeGraph(graph, false);
			},
		};
	}

	/**
	 * Render an authoritative mix using the same graph builder as live playback.
	 * @returns {Promise<AudioBuffer | { sampleRate: number, length: number, numberOfChannels: number, channels: Float32Array[] }>}
	 */
	async renderMix({
		startFrame = 0,
		endFrame = this.durationFrames,
		includeTail = false,
		trackId = null,
		includeMaster = true,
		includeTrackPan = true,
		respectMuteSolo = true,
		outputFrames: requestedOutputFrames = null,
		preRollFrames = 0,
		signal = null,
		onProgress = null,
	} = {}) {
		if (!this.project) throw new Error('Load an audio editor project before rendering.');
		throwIfAborted(signal);
		const fromFrame = clampFrame(startFrame, 0, this.durationFrames);
		const toFrame = clampFrame(endFrame, fromFrame, this.durationFrames);
		const renderFromFrame = Math.max(0, fromFrame - clampFrame(preRollFrames, 0, fromFrame));
		const warmupFrames = fromFrame - renderFromFrame;
		const tailFrames = Math.round(resolveTailSeconds(this.project, includeTail, { trackId, includeMaster }) * this.sampleRate);
		const processingLatencyFrames = projectGraphLatencyFrames(this.project, {
			trackId,
			includeMaster,
			sampleRate: this.sampleRate,
		});
		const requestedLength = requestedOutputFrames == null
			? Math.max(1, toFrame - fromFrame + tailFrames)
			: positiveInteger(requestedOutputFrames, 1);
		const outputLength = warmupFrames + processingLatencyFrames + requestedLength;

		if (!this.offlineAudioContextFactory) {
			if (typeof this.softwareRenderer === 'function') {
				return this.softwareRenderer({
					project: this.project,
					sources: this.sources,
					sourceResolver: this.sourceResolver,
					startFrame: renderFromFrame,
					endFrame: toFrame,
					captureStartFrame: fromFrame,
					tailFrames,
					sampleRate: this.sampleRate,
					trackId,
					includeMaster,
					includeTrackPan,
					respectMuteSolo,
				});
			}
			throw new Error('OfflineAudioContext is not available in this browser.');
		}

		const context = createOfflineContext(this.offlineAudioContextFactory, 2, outputLength, this.sampleRate);
		let parametricEqFailure = null;
		let graph = null;
		try {
			await ensureProjectWorklets(context, this.project);
			graph = buildProjectGraph(context, context.destination, this.project, {
				metering: false,
				respectMuteSolo,
				trackId,
				includeMaster,
				includeTrackPan,
				parametricEqWasmModule: parametricEqWasmModules.get(context),
				onParametricEqError: (error) => {
					this.#emitParametricEqError(error);
					parametricEqFailure ||= parametricEqProcessingError(error);
				},
			});
			await scheduleProjectClips({
				context,
				project: this.project,
				sources: this.sources,
				trackInputs: graph.trackInputs,
				trackGainParams: graph.trackGainParams,
				fromFrame: renderFromFrame,
				toFrame,
				contextStartTime: 0,
				sampleRate: this.sampleRate,
				reversedBuffers: this.reversedBuffers,
				sourceResolver: this.sourceResolver,
				chunkSources: this.chunkSources,
				activeSources: graph.sources,
				allNodes: graph.nodes,
				mode: 'offline',
				signal,
				onProgress,
			});
			throwIfAborted(signal);
			const rendered = await abortable(context.startRendering(), signal);
			// OfflineAudioWorklet failures are delivered as queued events in some
			// engines after the render promise settles.
			await new Promise((resolve) => setTimeout(resolve, 0));
			throwIfAborted(signal);
			if (parametricEqFailure) throw parametricEqFailure;
			const captureOffset = warmupFrames + processingLatencyFrames;
			return captureOffset || rendered.length !== requestedLength
				? sliceAudioBuffer(context, rendered, captureOffset, requestedLength)
				: rendered;
		} finally {
			if (graph) disposeGraph(graph, false);
		}
	}

	/** Stream a memory-safe 1× render through the same realtime graph. */
	async renderMixRealtime({
		startFrame = 0,
		endFrame = this.durationFrames,
		includeTail = false,
		trackId = null,
		includeMaster = true,
		includeTrackPan = true,
		respectMuteSolo = true,
		sampleRate = this.sampleRate,
		outputFrames: requestedOutputFrames = null,
		preRollFrames = 0,
		chunkFrames = 4096,
		onChunk,
		onProgress = null,
		signal,
	} = {}) {
		if (!this.project) throw new Error('Load an audio editor project before rendering.');
		if (typeof onChunk !== 'function') throw new TypeError('Realtime rendering requires an onChunk callback.');
		if (signal?.aborted) throw createAbortError();
		const Context = getAudioContextConstructor();
		if (!Context || typeof globalThis.AudioWorkletNode !== 'function') {
			throw new Error('Realtime AudioWorklet rendering is not supported in this browser.');
		}
		const fromFrame = clampFrame(startFrame, 0, this.durationFrames);
		const toFrame = clampFrame(endFrame, fromFrame, this.durationFrames);
		const renderFromFrame = Math.max(0, fromFrame - clampFrame(preRollFrames, 0, fromFrame));
		const warmupProjectFrames = fromFrame - renderFromFrame;
		const tailFrames = Math.round(resolveTailSeconds(this.project, includeTail, { trackId, includeMaster }) * this.sampleRate);
		const context = createRealtimeContext(Context, positiveInteger(sampleRate, this.sampleRate));
		if (!context.audioWorklet?.addModule) {
			await context.close?.();
			throw new Error('Realtime AudioWorklet rendering is not supported in this browser.');
		}
		let parametricEqFailure = null;
		let failParametricEqRender = null;
		let outputFrames = 0;
		let startTime = 0;
		let capture = null;
		let silent = null;
		let graph = null;
		try {
			await context.audioWorklet.addModule(new URL('./render-capture-worklet.js', import.meta.url));
			await ensureProjectWorklets(context, this.project);
			outputFrames = requestedOutputFrames == null
				? Math.max(1, Math.round((toFrame - fromFrame + tailFrames) / this.sampleRate * context.sampleRate))
				: positiveInteger(requestedOutputFrames, 1);
			startTime = context.currentTime + 0.08;
			const warmupContextFrames = Math.round(warmupProjectFrames / this.sampleRate * context.sampleRate);
			const processingLatencyFrames = projectGraphLatencyFrames(this.project, {
				trackId,
				includeMaster,
				sampleRate: context.sampleRate,
			});
			capture = new globalThis.AudioWorkletNode(context, 'kw-audio-render-capture', {
				numberOfInputs: 1,
				numberOfOutputs: 1,
				outputChannelCount: [2],
				processorOptions: {
					startFrame: Math.ceil(startTime * context.sampleRate) + warmupContextFrames + processingLatencyFrames,
					totalFrames: outputFrames,
					chunkFrames: Math.max(128, Math.min(16_384, Math.floor(chunkFrames))),
				},
			});
			silent = context.createGain();
			silent.gain.value = 0;
			capture.connect(silent);
			silent.connect(context.destination);
			graph = buildProjectGraph(context, capture, this.project, {
				metering: false,
				respectMuteSolo,
				trackId,
				includeMaster,
				includeTrackPan,
				parametricEqWasmModule: parametricEqWasmModules.get(context),
				onParametricEqError: (error) => {
					this.#emitParametricEqError(error);
					parametricEqFailure ||= parametricEqProcessingError(error);
					graph?.abortController?.abort?.(parametricEqFailure);
					failParametricEqRender?.(parametricEqFailure);
				},
			});
		} catch (error) {
			if (graph) disposeGraph(graph, true);
			try { capture?.disconnect(); } catch { /* The capture node may not have connected. */ }
			try { silent?.disconnect(); } catch { /* The silent node may not have connected. */ }
			if (context.state !== 'closed') await context.close?.();
			throw parametricEqFailure || error;
		}
		const abortGraph = () => graph.abortController.abort();
		signal?.addEventListener('abort', abortGraph, { once: true });
		try {
			await scheduleProjectClips({
				context,
				project: this.project,
				sources: this.sources,
				trackInputs: graph.trackInputs,
				trackGainParams: graph.trackGainParams,
				fromFrame: renderFromFrame,
				toFrame,
				contextStartTime: startTime,
				sampleRate: this.sampleRate,
				reversedBuffers: this.reversedBuffers,
				sourceResolver: this.sourceResolver,
				chunkSources: this.chunkSources,
				activeSources: graph.sources,
				allNodes: graph.nodes,
				mode: 'live',
				chunkStreamClient: this.#getChunkStreamClient(),
				chunkAudioNodeFactory: this.chunkAudioNodeFactory,
				signal: graph.abortController.signal,
			});
		} catch (error) {
			signal?.removeEventListener('abort', abortGraph);
			disposeGraph(graph, true);
			try { capture.disconnect(); } catch { /* Already disconnected. */ }
			try { silent.disconnect(); } catch { /* Already disconnected. */ }
			if (context.state !== 'closed') await context.close?.();
			throw parametricEqFailure || error;
		}

		let renderedFrames = 0;
		let resolveDone;
		let rejectDone;
		const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
		let doneReceived = false;
		let sinkQueue = null;
		const failRender = (error) => {
			const failure = error instanceof Error ? error : new Error('The realtime render failed.');
			sinkQueue?.abort(failure);
			graph.abortController.abort(failure);
			rejectDone(failure);
		};
		failParametricEqRender = failRender;
		if (parametricEqFailure) failRender(parametricEqFailure);
		sinkQueue = createAsyncPlanarPcmSinkQueue(onChunk, { onError: failRender });
		const abort = () => failRender(createAbortError());
		signal?.addEventListener('abort', abort, { once: true });
		capture.onprocessorerror = () => failRender(new Error('The realtime render worklet failed.'));
		capture.port.onmessage = ({ data = {} }) => {
			if (doneReceived || sinkQueue.failure) return;
			if (data.type === 'audio-chunk') {
				const channels = (data.channels || []).map((channel) => channel instanceof Float32Array ? channel : new Float32Array(channel));
				const frames = channels[0]?.length || 0;
				const accepted = sinkQueue.enqueue(channels, {
					frameOffset: data.frameOffset,
					sampleRate: context.sampleRate,
				});
				if (!accepted) return;
				renderedFrames += frames;
				try {
					onProgress?.({
						frames: renderedFrames,
						totalFrames: outputFrames,
						progress: Math.min(1, renderedFrames / outputFrames),
					});
				} catch (error) {
					failRender(error);
				}
			} else if (data.type === 'done') {
				doneReceived = true;
				void sinkQueue.finish().then(resolveDone, rejectDone);
			}
		};
		capture.port.start?.();

		try {
			await context.resume();
			await done;
			return {
				sampleRate: context.sampleRate,
				channelCount: 2,
				frameCount: sinkQueue.writtenFrames,
				chunkCount: sinkQueue.writtenChunks,
			};
		} finally {
			signal?.removeEventListener('abort', abort);
			signal?.removeEventListener('abort', abortGraph);
			capture.port.onmessage = null;
			capture.onprocessorerror = null;
			disposeGraph(graph, true);
			try { capture.disconnect(); } catch { /* Already disconnected. */ }
			try { silent.disconnect(); } catch { /* Already disconnected. */ }
			if (context.state !== 'closed') await context.close?.();
			if (sinkQueue.state !== 'finished') sinkQueue.abort(createAbortError());
			try { await sinkQueue.settled(); } catch { /* The primary render error is reported above. */ }
		}
	}

	/**
	 * Stream an authoritative 1x mix directly into an async planar PCM sink.
	 * The sink is left open so its owner can atomically commit or abort it.
	 */
	renderMixToSink({ sink, ...options } = {}) {
		if (typeof sink !== 'function' && typeof sink?.write !== 'function') {
			return Promise.reject(new TypeError('A planar PCM sink function or object with write() is required.'));
		}
		const write = typeof sink === 'function' ? sink : sink.write.bind(sink);
		return this.renderMixRealtime({ ...options, onChunk: write });
	}

	renderTrack(trackId, options = {}) {
		if (!this.project?.tracks?.some((track) => track.id === trackId)) {
			return Promise.reject(new Error('The requested track could not be found.'));
		}
		return this.renderMix({
			...options,
			trackId,
			includeMaster: false,
			respectMuteSolo: false,
		});
	}

	renderTrackToSink(trackId, options = {}) {
		if (!this.project?.tracks?.some((track) => track.id === trackId)) {
			return Promise.reject(new Error('The requested track could not be found.'));
		}
		return this.renderMixToSink({
			...options,
			trackId,
			includeMaster: false,
			respectMuteSolo: false,
		});
	}

	async dispose() {
		this.#cancelScrub();
		this.#haltGraph();
		this.project = null;
		this.sources.clear();
		this.chunkSources.clear();
		this.positionListeners.clear();
		this.meterListeners.clear();
		this.stateListeners.clear();
		this.parametricEqErrorListeners.clear();
		this.reversedBuffers = new WeakMap();
		this.preparedSpeedPlayback = null;
		this.masterLoudnessMeter?.dispose();
		this.masterLoudnessMeter = null;
		this.latestMasterLoudnessMeter = null;
		this.masterLoudnessMeterError = null;
		const context = this.context;
		this.context = null;
		if (context?.state !== 'closed') await context?.close?.();
		this.chunkStreamClient?.dispose?.();
		this.chunkStreamClient = null;
		this.state = 'disposed';
	}

	async #getContext() {
		if (this.context) return this.context;
		if (!this.audioContextFactory) throw new Error('Web Audio is not supported in this browser.');
		this.context = createRealtimeContext(this.audioContextFactory);
		const preferredOutputDeviceId = this.preferredOutputDeviceId;
		if (preferredOutputDeviceId) {
			try {
				await this.setOutputDevice(preferredOutputDeviceId);
			} catch (error) {
				this.outputDeviceError = error;
				this.activeOutputDeviceId = '';
				try { await this.context.setSinkId?.(''); } catch { /* The system output remains the browser fallback. */ }
			}
		}
		return this.context;
	}

	async #scheduleCurrentPlayback(fromFrame, scheduledTime = this.context?.currentTime || 0) {
		if (this.playbackMode === 'staffpad' && this.preparedSpeedPlayback) {
			return this.#schedulePreparedSpeedPlayback(fromFrame, scheduledTime);
		}
		return this.#schedulePlayback(fromFrame, scheduledTime);
	}

	async #schedulePreparedSpeedPlayback(fromFrame, scheduledTime = this.context?.currentTime || 0) {
		const context = this.context;
		const prepared = this.preparedSpeedPlayback;
		if (!context || !this.project || !prepared) return;
		if (this.meterListeners.size && !this.masterLoudnessMeter && !this.masterLoudnessMeterError) {
			await this.#ensureMasterLoudnessMeter(context);
		}
		this.#haltGraph();
		const frame = clampFrame(fromFrame, 0, this.durationFrames);
		const nodes = [];
		const sources = new Set();
		const source = addNode(nodes, context.createBufferSource());
		if (!prepared.audioBuffer) {
			prepared.audioBuffer = context.createBuffer(prepared.channels.length, prepared.frameCount, prepared.sampleRate);
			for (let channel = 0; channel < prepared.channels.length; channel += 1) {
				if (typeof prepared.audioBuffer.copyToChannel === 'function') {
					prepared.audioBuffer.copyToChannel(prepared.channels[channel], channel);
				} else prepared.audioBuffer.getChannelData(channel).set(prepared.channels[channel]);
			}
		}
		source.buffer = prepared.audioBuffer;
		let masterAnalyser = null;
		const meterDestination = this.masterLoudnessMeter?.node || context.destination;
		if (this.meterListeners.size > 0) {
			masterAnalyser = createAnalyser(context, nodes);
			connect(source, masterAnalyser);
			connect(masterAnalyser, meterDestination);
		} else connect(source, meterDestination);
		const outputFrameAt = (timelineFrame) => this.durationFrames > 0
			? clampFrame(Math.round(timelineFrame / this.durationFrames * prepared.frameCount), 0, prepared.frameCount)
			: 0;
		if (this.loop.enabled && this.loop.endFrame > this.loop.startFrame) {
			source.loop = true;
			source.loopStart = outputFrameAt(this.loop.startFrame) / prepared.sampleRate;
			source.loopEnd = outputFrameAt(this.loop.endFrame) / prepared.sampleRate;
		}
		this.playEndFrame = Math.max(frame, this.loop.enabled ? this.loop.endFrame : this.durationFrames);
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
			this.#haltGraph();
			throw error;
		}
		this.#setState('playing');
		this.masterLoudnessMeter?.setRunning(!this.loudnessMeasurementManuallyPaused);
		this.#startTicker();
		this.#emitPosition();
	}

	async #schedulePlayback(fromFrame, scheduledTime = this.context?.currentTime || 0) {
		const context = this.context;
		if (!context || !this.project) return;
		if (this.meterListeners.size && !this.masterLoudnessMeter && !this.masterLoudnessMeterError) {
			await this.#ensureMasterLoudnessMeter(context);
		}
		this.#haltGraph();
		const loopEnd = this.loop.enabled ? this.loop.endFrame : this.durationFrames;
		this.playEndFrame = Math.max(fromFrame, loopEnd);
		this.playbackStartFrame = fromFrame;
		this.positionFrame = fromFrame;
		this.graph = buildProjectGraph(
			context,
			this.masterLoudnessMeter?.node || context.destination,
			this.project,
			{
			metering: this.meterListeners.size > 0,
			respectMuteSolo: true,
			effectAnalysis: true,
			parametricEqWasmModule: parametricEqWasmModules.get(context),
			onParametricEqError: (error) => this.#emitParametricEqError(error),
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
				chunkStreamClient: this.#getChunkStreamClient(),
				chunkAudioNodeFactory: this.chunkAudioNodeFactory,
				signal: graph.abortController.signal,
				deferStartUntilPrimed: true,
			});
		} catch (error) {
			if (this.graph === graph) this.#haltGraph();
			throw error;
		}
		if (this.graph !== graph) return;
		scheduledTime = schedule.contextStartTime;
		this.playbackStartTime = scheduledTime + (this.graph.latencyFrames || 0) / (context.sampleRate || DEFAULT_SAMPLE_RATE);
		if (this.loop.enabled && this.loop.endFrame > this.loop.startFrame) {
			this.loopScheduleTime = scheduledTime + (this.loop.endFrame - fromFrame) / (this.sampleRate * this.playbackRate);
			this.#scheduleLoopAhead();
		}
		this.#setState('playing');
		this.masterLoudnessMeter?.setRunning(!this.loudnessMeasurementManuallyPaused);
		this.#startTicker();
		this.#emitPosition();
	}

	#getChunkStreamClient() {
		if (!this.chunkSources.size) return null;
		if (!this.chunkStreamClient) this.chunkStreamClient = this.chunkStreamClientFactory();
		return this.chunkStreamClient;
	}

	async #ensureMasterLoudnessMeter(context) {
		if (!this.meterListeners.size || this.masterLoudnessMeter || this.masterLoudnessMeterError) {
			return this.masterLoudnessMeter;
		}
		try {
			const meter = await createEbuR128MeterNode(context, {
				channelCount: 2,
				passthrough: true,
				running: this.state === 'playing' && !this.loudnessMeasurementManuallyPaused,
				onMeter: (reading) => {
					this.latestMasterLoudnessMeter = reading;
				},
			});
			meter.node.connect(context.destination);
			this.masterLoudnessMeter = meter;
			return meter;
		} catch (error) {
			this.masterLoudnessMeterError = error;
			return null;
		}
	}

	#handleSchedulingError(error) {
		if (error?.name === 'AbortError') return;
		this.#haltGraph();
		this.masterLoudnessMeter?.setRunning(false);
		this.#setState(this.project ? 'stopped' : 'empty');
		globalThis.console?.error?.(error);
	}

	#startTicker() {
		this.#stopTicker();
		this.ticker = globalThis.setInterval(() => {
			if (this.state !== 'playing') return;
			const frame = this.getPositionFrames();
			this.#emitPosition(frame);
			this.#emitMeters();
			if (this.loop.enabled && this.loop.endFrame > this.loop.startFrame) {
				this.#scheduleLoopAhead();
				return;
			}
			if (frame < this.playEndFrame) return;
			this.positionFrame = this.durationFrames;
			this.#haltGraph();
			this.masterLoudnessMeter?.setRunning(false);
			this.#setState('stopped');
			this.#emitPosition();
		}, this.meterInterval);
		this.ticker?.unref?.();
	}

	#scheduleLoopAhead() {
		if (!this.graph || !this.context || !this.project || !this.loop.enabled) return;
		if (this.playbackMode === 'staffpad') return;
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
				chunkStreamClient: this.#getChunkStreamClient(),
				chunkAudioNodeFactory: this.chunkAudioNodeFactory,
				signal: graph.abortController.signal,
			}).catch((error) => this.#handleSchedulingError(error));
			this.loopScheduleTime += durationSeconds;
			scheduledIterations += 1;
		}
	}

	#stopTicker() {
		if (this.ticker !== null) {
			globalThis.clearInterval(this.ticker);
			this.ticker = null;
		}
	}

	#cancelScrub() {
		this.scrubbing = false;
		this.scrubNextAt = 0;
		this.scrubGeneration += 1;
	}

	#haltGraph() {
		this.masterLoudnessMeter?.setRunning(false);
		this.#stopTicker();
		if (this.scrubTimer !== null) {
			globalThis.clearTimeout(this.scrubTimer);
			this.scrubTimer = null;
		}
		if (this.graph) {
			disposeGraph(this.graph, true);
			this.graph = null;
		}
	}

	#emitPosition(frame = this.getPositionFrames()) {
		for (const listener of this.positionListeners) listener(frame, this.durationFrames);
	}

	#emitMeters() {
		if (!this.graph || !this.meterListeners.size) return;
		const tracks = {};
		for (const [trackId, analyser] of this.graph.trackAnalysers) tracks[trackId] = readMeter(analyser);
		const groups = {};
		const sends = {};
		for (const [busId, analyser] of this.graph.groupAnalysers || []) groups[busId] = readMeter(analyser);
		for (const [busId, analyser] of this.graph.sendAnalysers || []) sends[busId] = readMeter(analyser);
		const master = readMeter(this.graph.masterAnalyser);
		if (this.latestMasterLoudnessMeter?.loudness) {
			master.loudness = this.latestMasterLoudnessMeter.loudness;
		}
		const meter = { master, tracks, groups, sends };
		for (const listener of this.meterListeners) listener(meter);
	}

	#emitParametricEqError(error) {
		for (const listener of this.parametricEqErrorListeners) listener(error);
	}

	#setState(value) {
		if (this.state === value) return;
		this.state = value;
		for (const listener of this.stateListeners) listener(value);
	}
}

export function getProjectDurationFrames(project) {
	let duration = 0;
	for (const clip of getProjectClips(project)) {
		duration = Math.max(duration, clipStart(clip) + clipDuration(clip));
	}
	return duration;
}

/** Iterate every rack location that the project graph can process. */
export function* projectEffectRacks(project) {
	for (const [index, track] of (project?.tracks || []).entries()) {
		if (track?.type === 'label') continue;
		yield {
			scope: 'track',
			targetId: String(track?.id ?? index),
			effects: Array.isArray(track?.effects) ? track.effects : [],
		};
	}
	for (const [scope, buses] of [
		['group', project?.mixer?.groups],
		['send', project?.mixer?.sends],
	]) {
		for (const bus of Array.isArray(buses) ? buses : []) {
			yield {
				scope,
				targetId: String(bus.id),
				effects: Array.isArray(bus.effects) ? bus.effects : [],
			};
		}
	}
	yield {
		scope: 'master',
		targetId: null,
		effects: Array.isArray(project?.master?.effects) ? project.master.effects : [],
	};
}

function projectWithParametricEqParams(project, scope, targetId, effectId, params) {
	if (!project) return null;
	const normalizedScope = String(scope || '');
	const replaceEffects = (effects) => {
		if (!Array.isArray(effects)) return null;
		const index = effects.findIndex((effect) => effect?.id === effectId && isParametricEqType(effect?.type));
		if (index < 0) return null;
		const output = effects.slice();
		output[index] = { ...effects[index], params: cloneMessageValue(params) };
		return output;
	};
	if (normalizedScope === 'master') {
		const effects = replaceEffects(project.master?.effects);
		return effects ? { ...project, master: { ...project.master, effects } } : null;
	}
	if (normalizedScope === 'track') {
		const index = (project.tracks || []).findIndex((track) => String(track?.id) === String(targetId));
		if (index < 0) return null;
		const effects = replaceEffects(project.tracks[index]?.effects);
		if (!effects) return null;
		const tracks = project.tracks.slice();
		tracks[index] = { ...tracks[index], effects };
		return { ...project, tracks };
	}
	if (normalizedScope === 'group' || normalizedScope === 'send') {
		const key = normalizedScope === 'group' ? 'groups' : 'sends';
		const buses = project.mixer?.[key] || [];
		const index = buses.findIndex((bus) => String(bus?.id) === String(targetId));
		if (index < 0) return null;
		const effects = replaceEffects(buses[index]?.effects);
		if (!effects) return null;
		const nextBuses = buses.slice();
		nextBuses[index] = { ...nextBuses[index], effects };
		return { ...project, mixer: { ...project.mixer, [key]: nextBuses } };
	}
	return null;
}

export function projectGraphLatencyFrames(project, {
	trackId = null,
	includeMaster = true,
	sampleRate = project?.sampleRate || DEFAULT_SAMPLE_RATE,
} = {}) {
	const tracks = (project?.tracks || []).filter((track) => (
		track.type !== 'label' && (trackId == null || String(track.id) === String(trackId))
	));
	const trackLatency = tracks.reduce((maximum, track) => Math.max(
		maximum,
		effectRackLatencyFrames(track.effects || [], sampleRate),
	), 0);
	const masterLatency = includeMaster
		? effectRackLatencyFrames(project?.master?.effects || [], sampleRate)
		: 0;
	const busLatency = Math.max(0, ...[
		...(project?.mixer?.groups || []),
		...(project?.mixer?.sends || []),
	].map((bus) => effectRackLatencyFrames(bus.effects || [], sampleRate)));
	return trackLatency + busLatency + masterLatency;
}

/** Build track/master nodes and return the per-track clip inputs. */
export function buildProjectGraph(context, destination, project, {
	metering = true,
	respectMuteSolo = true,
	trackId: onlyTrackId = null,
	includeMaster = true,
	includeTrackPan = true,
	effectAnalysis = false,
	parametricEqWasmModule = null,
	onParametricEqError = null,
} = {}) {
	const nodes = [];
	const sources = new Set();
	const trackInputs = new Map();
	const trackGainParams = new Map();
	const trackAnalysers = new Map();
	const groupAnalysers = new Map();
	const sendAnalysers = new Map();
	const effectNodes = new Map();
	const effectAnalysers = new Map();
	const effectMessageSequences = new Map();
	const tracks = Array.isArray(project?.tracks) ? project.tracks.filter((track) => track.type !== 'label') : [];
	const mixer = project?.mixer || {};
	const groups = Array.isArray(mixer.groups) ? mixer.groups : [];
	const sends = Array.isArray(mixer.sends) ? mixer.sends : [];
	const groupById = new Map(groups.map((bus) => [String(bus.id), bus]));
	const sendById = new Map(sends.map((bus) => [String(bus.id), bus]));
	// Every dry input exists before a rack is built so Auto Duck can route any
	// other track into its second AudioWorklet input without graph-order races.
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
		effectRackLatencyFrames(track.effects || [], context.sampleRate || DEFAULT_SAMPLE_RATE),
	), 0);
	const masterInput = addNode(nodes, context.createGain());
	const groupInputs = new Map(groups.map((bus) => [String(bus.id), addNode(nodes, context.createGain())]));
	const sendInputs = new Map(sends.map((bus) => [String(bus.id), addNode(nodes, context.createGain())]));
	const busLatencies = new Map([...groups, ...sends].map((bus) => [
		String(bus.id), effectRackLatencyFrames(bus.effects || [], context.sampleRate || DEFAULT_SAMPLE_RATE),
	]));
	const maximumBusLatency = Math.max(0, ...busLatencies.values());
	const anySolo = respectMuteSolo && [...tracks, ...groups, ...sends].some((channel) => channel.solo);
	const connectCompensated = (output, latencyFrames = 0) => {
		const compensationFrames = maximumBusLatency - latencyFrames;
		if (compensationFrames <= 0) {
			connect(output, masterInput);
			return;
		}
		if (typeof context.createDelay !== 'function') throw new Error('This browser cannot compensate live effect latency between mixer buses.');
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
		const trackLatency = effectRackLatencyFrames(track.effects || [], context.sampleRate || DEFAULT_SAMPLE_RATE);
		let output = applyEffectRack(context, input, track.effects || [], nodes, {
			sidechainInputs: trackInputs,
			scope: 'track',
			targetId: trackId,
			effectAnalysis,
			effectNodes,
			effectAnalysers,
			parametricEqWasmModule,
			parametricEqChannelCount: effectChannelCounts.get(trackId),
			onParametricEqError,
		});
		const gain = addNode(nodes, context.createGain());
		setParam(gain.gain, finite(track.gain, 1), context.currentTime);
		trackGainParams.set(trackId, {
			param: gain.gain,
			latencyFrames: trackLatency,
		});
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

	const processBus = (bus, input, analysers, scope) => {
		let output = applyEffectRack(context, input, bus.effects || [], nodes, {
			sidechainInputs: trackInputs,
			scope,
			targetId: String(bus.id),
			effectAnalysis,
			effectNodes,
			effectAnalysers,
			parametricEqWasmModule,
			parametricEqChannelCount: mixEffectChannelCount,
			onParametricEqError,
		});
		const gain = addNode(nodes, context.createGain());
		setParam(gain.gain, finite(bus.gain, 1), context.currentTime);
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
	for (const bus of groups) processBus(bus, groupInputs.get(String(bus.id)), groupAnalysers, 'group');
	for (const bus of sends) processBus(bus, sendInputs.get(String(bus.id)), sendAnalysers, 'send');

	const masterEffects = includeMaster ? project?.master?.effects || [] : [];
	const masterLatency = effectRackLatencyFrames(masterEffects, context.sampleRate || DEFAULT_SAMPLE_RATE);
	const masterOutput = applyEffectRack(context, masterInput, masterEffects, nodes, {
		sidechainInputs: trackInputs,
		baseSidechainDelayFrames: maximumTrackLatency,
		scope: 'master',
		targetId: null,
		effectAnalysis,
		effectNodes,
		effectAnalysers,
		parametricEqWasmModule,
		parametricEqChannelCount: mixEffectChannelCount,
		onParametricEqError,
	});
	const masterGain = addNode(nodes, context.createGain());
	setParam(masterGain.gain, includeMaster ? finite(project?.master?.gain, 1) : 1, context.currentTime);
	connect(masterOutput, masterGain);
	let finalOutput = masterGain;
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

export function applyEffectRack(context, input, effects, nodes = [], options = {}) {
	let output = input;
	let upstreamLatencyFrames = 0;
	for (const effect of Array.isArray(effects) ? effects : []) {
		if (!effect || effect.enabled === false || effect.bypassed === true) continue;
		output = applyEffect(context, output, effect, nodes, {
			...options,
			sidechainDelayFrames: nonNegativeInteger(options.baseSidechainDelayFrames, 0) + upstreamLatencyFrames,
		});
		upstreamLatencyFrames += effectLatencyFrames(effect, context.sampleRate || DEFAULT_SAMPLE_RATE);
	}
	return output;
}

export function effectRackLatencyFrames(effects, sampleRate = DEFAULT_SAMPLE_RATE) {
	return (Array.isArray(effects) ? effects : []).reduce((total, effect) => (
		total + ((!effect || effect.enabled === false || effect.bypassed === true)
			? 0
			: effectLatencyFrames(effect, sampleRate))
	), 0);
}

function effectLatencyFrames(effect, sampleRate) {
	if (effect.type === 'limiter') {
		return Math.max(0, Math.ceil(finite(effect.params?.lookahead, 0) * sampleRate));
	}
	if (!isAudacityLiveEffect(effect.type)) return 0;
	const capability = audacityLiveEffectCapability(effect.type);
	const latency = typeof capability?.latencyFrames === 'function'
		? capability.latencyFrames(sampleRate, effect.params || {})
		: capability?.latencyFrames;
	return Math.max(0, nonNegativeInteger(latency, 0));
}

function applyEffect(context, input, effect, nodes, options = {}) {
	const type = String(effect.type || effect.kind || '').toLowerCase();
	const params = effect.params || effect;
	if (isAudacityLiveEffect(type)) {
		if (!audacityWorkletContexts.has(context)) {
			throw new Error(`The Audacity real-time processor was not loaded for ${type}.`);
		}
		const WorkletNode = globalThis.AudioWorkletNode || globalThis.window?.AudioWorkletNode;
		if (typeof WorkletNode !== 'function') {
			throw new Error('This browser cannot run Audacity real-time effects.');
		}
		const sidechain = type === 'audacity-auto-duck';
		const controlTrackId = sidechain ? effect.context?.controlTrackId : null;
		const controlInput = sidechain ? options.sidechainInputs?.get(String(controlTrackId)) : null;
		if (sidechain && (!controlTrackId || !controlInput)) {
			throw new Error('Auto Duck requires a valid control track.');
		}
		const processor = addNode(nodes, new WorkletNode(context, 'kw-audacity-live-effect', {
			numberOfInputs: sidechain ? 2 : 1,
			numberOfOutputs: 1,
			outputChannelCount: [2],
			processorOptions: {
				effectType: type,
				params,
				noiseProfile: effect.context?.noiseProfile || null,
			},
		}));
		connect(input, processor);
		if (sidechain) {
			const delayFrames = nonNegativeInteger(options.sidechainDelayFrames, 0);
			if (delayFrames > 0) {
				if (typeof context.createDelay !== 'function') {
					throw new Error('This browser cannot align the Auto Duck control track.');
				}
				const delaySeconds = delayFrames / (context.sampleRate || DEFAULT_SAMPLE_RATE);
				const delay = addNode(nodes, context.createDelay(Math.max(1, delaySeconds)));
				setParam(delay.delayTime, delaySeconds, context.currentTime);
				connect(controlInput, delay);
				connect(delay, processor, 0, 1);
			} else connect(controlInput, processor, 0, 1);
		}
		return processor;
	}
	if ((type === 'limiter' || type === 'gate') && dynamicsWorkletContexts.has(context)) {
		const WorkletNode = globalThis.AudioWorkletNode || globalThis.window?.AudioWorkletNode;
		if (typeof WorkletNode === 'function') {
			const dynamics = addNode(nodes, new WorkletNode(context, 'kw-audio-dynamics', {
				numberOfInputs: 1,
				numberOfOutputs: 1,
				outputChannelCount: [2],
				processorOptions: { type, params },
			}));
			connect(input, dynamics);
			return dynamics;
		}
	}
	if (isParametricEqType(type)) {
		if (!parametricEqWorkletContexts.has(context)) {
			throw new Error('The parametric EQ processor was not loaded.');
		}
		const WorkletNode = globalThis.AudioWorkletNode || globalThis.window?.AudioWorkletNode;
		if (typeof WorkletNode !== 'function') {
			throw new Error('This browser cannot run the parametric EQ.');
		}
		if (!(options.parametricEqWasmModule instanceof WebAssembly.Module)) {
			throw new Error('The parametric EQ WASM module was not compiled.');
		}
		const inputAnalyser = options.effectAnalysis ? createSpectrumAnalyser(context, nodes) : null;
		const processorInput = inputAnalyser || input;
		if (inputAnalyser) connect(input, inputAnalyser);
		const processor = addNode(nodes, new WorkletNode(context, PARAMETRIC_EQ_WORKLET_NAME, {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			channelCountMode: 'max',
			channelInterpretation: 'speakers',
			processorOptions: {
				sampleRate: context.sampleRate || DEFAULT_SAMPLE_RATE,
				effectId: effect.id,
				params,
				wasmModule: options.parametricEqWasmModule,
				channelCount: clamp(positiveInteger(options.parametricEqChannelCount, 2), 1, 32),
			},
		}));
		connect(processorInput, processor);
		const outputAnalyser = options.effectAnalysis ? createSpectrumAnalyser(context, nodes) : null;
		if (outputAnalyser) connect(processor, outputAnalyser);
		registerEffectGraphNodes(context, effect, processor, inputAnalyser, outputAnalyser, options);
		return outputAnalyser || processor;
	}
	if (['highpass', 'lowpass', 'bandpass', 'notch', 'peaking', 'lowshelf', 'highshelf'].includes(type)) {
		return connectBiquad(context, input, { ...params, type }, nodes);
	}
	if (type === 'compressor' || type === 'limiter') {
		if (typeof context.createDynamicsCompressor !== 'function') return input;
		const compressor = addNode(nodes, context.createDynamicsCompressor());
		setParam(compressor.threshold, finite(params.threshold ?? params.ceiling, type === 'limiter' ? -1 : -24), context.currentTime);
		setParam(compressor.knee, finite(params.knee, type === 'limiter' ? 0 : 30), context.currentTime);
		setParam(compressor.ratio, finite(params.ratio, type === 'limiter' ? 20 : 4), context.currentTime);
		setParam(compressor.attack, finite(params.attack, type === 'limiter' ? 0.003 : 0.01), context.currentTime);
		setParam(compressor.release, finite(params.release, type === 'limiter' ? 0.1 : 0.25), context.currentTime);
		connect(input, compressor);
		if (type === 'compressor' && finite(params.makeupGain, 0) !== 0) {
			const makeup = addNode(nodes, context.createGain());
			setParam(makeup.gain, 10 ** (finite(params.makeupGain, 0) / 20), context.currentTime);
			connect(compressor, makeup);
			return makeup;
		}
		return compressor;
	}
	if (type === 'gate') {
		if (typeof context.createWaveShaper !== 'function') return input;
		const shaper = addNode(nodes, context.createWaveShaper());
		shaper.curve = createGateCurve(finite(params.threshold, -48));
		shaper.oversample = 'none';
		connect(input, shaper);
		return shaper;
	}
	if (type === 'delay') return connectDelay(context, input, params, nodes);
	if (type === 'reverb' || type === 'convolver') return connectReverb(context, input, params, nodes);
	return input;
}

function registerEffectGraphNodes(context, effect, processor, inputAnalyser, outputAnalyser, options) {
	if (typeof options.onParametricEqError === 'function' && processor?.port) {
		const scope = typeof options.scope === 'string' ? options.scope : null;
		const targetId = scope === 'master' || options.targetId == null ? null : String(options.targetId);
		const effectId = typeof effect?.id === 'string' && effect.id ? effect.id : null;
		const handler = ({ data } = {}) => {
			if (!data || data.type !== 'error') return;
			const message = typeof data.message === 'string' && data.message
				? data.message
				: 'The parametric EQ processor failed.';
			options.onParametricEqError(Object.freeze({
				...data,
				type: 'error',
				message,
				scope,
				targetId,
				effectId,
			}));
		};
		const processorErrorHandler = () => handler({
			data: { type: 'error', message: 'The parametric EQ AudioWorklet processor failed.' },
		});
		processor.port.onmessage = handler;
		processor.port.start?.();
		if (typeof processor.addEventListener === 'function') {
			processor.addEventListener('processorerror', processorErrorHandler);
		} else processor.onprocessorerror = processorErrorHandler;
		parametricEqPortMessageHandlers.set(processor, { handler, processorErrorHandler });
	}
	if (!options.effectNodes || typeof effect?.id !== 'string' || !effect.id) return;
	const key = effectGraphKey(options.scope, options.targetId, effect.id);
	options.effectNodes.set(key, processor);
	if (!options.effectAnalysers || !inputAnalyser || !outputAnalyser) return;
	options.effectAnalysers.set(key, {
		input: inputAnalyser,
		output: outputAnalyser,
		metadata: Object.freeze({
			sampleRate: positiveInteger(context.sampleRate, DEFAULT_SAMPLE_RATE),
			fftSize: inputAnalyser.fftSize,
			frequencyBinCount: inputAnalyser.frequencyBinCount || inputAnalyser.fftSize / 2,
			minDecibels: inputAnalyser.minDecibels,
			maxDecibels: inputAnalyser.maxDecibels,
		}),
	});
}

function connectBiquad(context, input, params, nodes) {
	if (typeof context.createBiquadFilter !== 'function') return input;
	const filter = addNode(nodes, context.createBiquadFilter());
	filter.type = params.type || 'peaking';
	setParam(filter.frequency, clamp(finite(params.frequency, 1000), 10, 24000), context.currentTime);
	setParam(filter.Q, Math.max(0.0001, finite(params.q ?? params.Q, 0.707)), context.currentTime);
	setParam(filter.gain, finite(params.gain, 0), context.currentTime);
	connect(input, filter);
	return filter;
}

function connectDelay(context, input, params, nodes) {
	if (typeof context.createDelay !== 'function') return input;
	const output = addNode(nodes, context.createGain());
	const dry = addNode(nodes, context.createGain());
	const wet = addNode(nodes, context.createGain());
	const delay = addNode(nodes, context.createDelay(MAX_EFFECT_TAIL_SECONDS));
	const feedback = addNode(nodes, context.createGain());
	const mix = clamp(finite(params.mix, 0.25), 0, 1);
	setParam(dry.gain, 1 - mix, context.currentTime);
	setParam(wet.gain, mix, context.currentTime);
	setParam(delay.delayTime, clamp(finite(params.time ?? params.delayTime, 0.25), 0, MAX_EFFECT_TAIL_SECONDS), context.currentTime);
	setParam(feedback.gain, clamp(finite(params.feedback, 0.25), 0, 0.95), context.currentTime);
	connect(input, dry); connect(dry, output);
	connect(input, delay); connect(delay, wet); connect(wet, output);
	connect(delay, feedback); connect(feedback, delay);
	return output;
}

function connectReverb(context, input, params, nodes) {
	if (typeof context.createConvolver !== 'function') return input;
	const output = addNode(nodes, context.createGain());
	const dry = addNode(nodes, context.createGain());
	const wet = addNode(nodes, context.createGain());
	const convolver = addNode(nodes, context.createConvolver());
	const mix = clamp(finite(params.mix, 0.25), 0, 1);
	setParam(dry.gain, 1 - mix, context.currentTime);
	setParam(wet.gain, mix, context.currentTime);
	const duration = clamp(finite(params.duration ?? params.decay, 1.5), 0.05, MAX_EFFECT_TAIL_SECONDS);
	const preDelaySeconds = clamp(finite(params.preDelay, 0), 0, 1);
	convolver.buffer = createImpulseResponse(context, duration, 2);
	connect(input, dry); connect(dry, output);
	if (preDelaySeconds > 0 && typeof context.createDelay === 'function') {
		const preDelay = addNode(nodes, context.createDelay(1));
		setParam(preDelay.delayTime, preDelaySeconds, context.currentTime);
		connect(input, preDelay); connect(preDelay, convolver);
	} else connect(input, convolver);
	connect(convolver, wet); connect(wet, output);
	return output;
}

function normalizeSourceResolver(value) {
	if (value == null) return null;
	if (typeof value !== 'function') throw new TypeError('sourceResolver must be a function or null.');
	return value;
}

function normalizeChunkSource(value) {
	if (!value || typeof value !== 'object') throw new TypeError('A long-source chunk provider is required.');
	const descriptor = value.descriptor && typeof value.descriptor === 'object' ? value.descriptor : value;
	const channelCount = positiveInteger(descriptor.channelCount, 0);
	const frameCount = positiveInteger(descriptor.frameCount ?? descriptor.frameLength, 0);
	const chunkFrames = positiveInteger(descriptor.chunkFrames, 0);
	const sampleRate = positiveInteger(descriptor.sampleRate, 0);
	if (!channelCount || channelCount > 64 || !frameCount || !sampleRate) throw new TypeError('Long-source metadata is invalid.');
	if (chunkFrames > AUDIO_EDITOR_STORAGE_CHUNK_FRAMES) {
		throw new RangeError(`Long-source chunks cannot exceed ${AUDIO_EDITOR_STORAGE_CHUNK_FRAMES} frames.`);
	}
	const readStorageChunk = value.readStorageChunk || value.readChunk;
	if (typeof readStorageChunk !== 'function') throw new TypeError('A long source must provide readStorageChunk().');
	return Object.freeze({
		channelCount,
		frameCount,
		chunkFrames,
		sampleRate,
		readStorageChunk: readStorageChunk.bind(value),
	});
}

function resolveClipSource(clip, project, sources, sourceResolver, chunkSources = new Map()) {
	const fallback = {
		buffer: sources.get(clip.sourceId) || null,
		chunkSource: chunkSources.get(String(clip.sourceId)) || chunkSources.get(clip.sourceId) || null,
		sourceStartFrame: nonNegativeInteger(clip.sourceStartFrame, 0),
		sourceDurationFrames: null,
		reversed: Boolean(clip.reversed),
	};
	if (!sourceResolver) return fallback;
	const value = sourceResolver(clip, {
		project,
		sources,
		defaultBuffer: fallback.buffer,
	});
	if (value == null) return fallback;
	const resolved = typeof value?.getChannelData === 'function' ? { buffer: value } : value;
	if (!resolved || typeof resolved !== 'object') {
		throw new TypeError('sourceResolver must return an AudioBuffer, a source descriptor, or null.');
	}
	const buffer = resolved.buffer ?? fallback.buffer;
	if (buffer != null && (typeof buffer.getChannelData !== 'function'
		|| !Number.isFinite(buffer.sampleRate) || !Number.isSafeInteger(buffer.length) || buffer.length <= 0)) {
		throw new TypeError('sourceResolver returned an invalid AudioBuffer.');
	}
	return {
		buffer,
		chunkSource: resolved.chunkSource ?? fallback.chunkSource,
		sourceStartFrame: resolved.sourceStartFrame == null
			? fallback.sourceStartFrame
			: nonNegativeInteger(resolved.sourceStartFrame, fallback.sourceStartFrame),
		sourceDurationFrames: resolved.sourceDurationFrames == null
			? null
			: Math.max(1, nonNegativeInteger(resolved.sourceDurationFrames, 1)),
		reversed: resolved.reversed == null ? fallback.reversed : Boolean(resolved.reversed),
	};
}

async function scheduleProjectClips({
	context,
	project,
	sources,
	chunkSources = new Map(),
	trackInputs,
	trackGainParams = new Map(),
	fromFrame,
	toFrame,
	contextStartTime,
	sampleRate,
	transportRate = 1,
	reversedBuffers,
	sourceResolver,
	activeSources,
	allNodes,
	mode = 'live',
	chunkStreamClient = null,
	chunkAudioNodeFactory = createChunkStreamAudioNode,
	signal = null,
	onProgress = null,
	deferStartUntilPrimed = false,
}) {
	throwIfAborted(signal);
	const clipsById = new Map(getProjectClips(project).map((clip) => [String(clip.id), clip]));
	const plans = [];
	for (const [trackIndex, track] of (project.tracks || []).entries()) {
		if (track.type === 'label') continue;
		const trackInput = trackInputs.get(String(track.id ?? trackIndex));
		if (!trackInput) continue;
		const trackClips = getTrackClips(track, clipsById);
		const crossfades = automaticCrossfadeRanges(trackClips);
		for (const clip of trackClips) {
			const start = clipStart(clip);
			const duration = clipDuration(clip);
			const end = start + duration;
			const segmentStart = Math.max(start, fromFrame);
			const segmentEnd = Math.min(end, toFrame);
			if (segmentEnd <= segmentStart) continue;
			const resolvedSource = resolveClipSource(clip, project, sources, sourceResolver, chunkSources);
			const originalBuffer = resolvedSource.buffer;
			const chunkSource = resolvedSource.chunkSource;
			if (!originalBuffer && !chunkSource) continue;
			const relativeStart = segmentStart - start;
			const sourceStart = resolvedSource.sourceStartFrame;
			const sourceDuration = resolvedSource.sourceDurationFrames ?? Math.max(1, nonNegativeInteger(clip.sourceDurationFrames, duration));
			const sourceFramesPerTimelineFrame = sourceDuration / Math.max(1, duration);
			const relativeSourceStart = relativeStart * sourceFramesPerTimelineFrame;
			const sourceFrameCount = originalBuffer?.length ?? chunkSource.frameCount;
			const reversed = resolvedSource.reversed;
			const offsetFrame = reversed
				? Math.max(0, sourceFrameCount - (sourceStart + sourceDuration) + relativeSourceStart)
				: sourceStart + relativeSourceStart;
			const segmentDuration = (segmentEnd - segmentStart) / sampleRate;
			const sourceSampleRate = originalBuffer?.sampleRate ?? chunkSource.sampleRate;
			const playbackRate = sourceDuration * sampleRate / Math.max(1, duration * sourceSampleRate);
			plans.push({
				clip,
				...(crossfades.get(String(clip.id)) || {}),
				trackInput,
				originalBuffer,
				chunkSource,
				reversed,
				offsetFrame,
				sourceSampleRate,
				playbackRate,
				segmentDuration,
				segmentStart,
				segmentEnd,
				relativeStart,
				duration,
			});
		}
	}

	const streamed = [];
	let loadedChunkFrames = 0;
	const totalChunkFrames = plans.reduce((total, plan) => total + (plan.originalBuffer ? 0 : Math.ceil(plan.segmentDuration * plan.playbackRate * plan.sourceSampleRate)), 0);
	for (const plan of plans) {
		throwIfAborted(signal);
		if (plan.originalBuffer) continue;
		if (mode === 'offline') {
			await scheduleOfflineChunkPlan({
				...plan,
				context,
				contextStartTime,
				fromFrame,
				sampleRate,
				transportRate,
				activeSources,
				allNodes,
				signal,
				onChunkLoaded: (frames) => {
					loadedChunkFrames += frames;
					onProgress?.({
						frames: loadedChunkFrames,
						totalFrames: totalChunkFrames,
						progress: totalChunkFrames ? Math.min(1, loadedChunkFrames / totalChunkFrames) : 1,
					});
				},
			});
		} else {
			if (!chunkStreamClient) throw longSourceError('The long-source playback worker is unavailable.');
			streamed.push(await prepareLiveChunkPlan({
				...plan,
				context,
				chunkStreamClient,
				chunkAudioNodeFactory,
				transportRate,
				activeSources,
				allNodes,
				signal,
			}));
		}
	}

	const actualContextStartTime = streamed.length && deferStartUntilPrimed
		? Math.max(contextStartTime, (context.currentTime || 0) + 0.02)
		: contextStartTime;
	scheduleProjectTrackGains({
		context,
		project,
		trackGainParams,
		fromFrame,
		toFrame,
		contextStartTime: actualContextStartTime,
		sampleRate,
		transportRate,
	});
	for (const plan of plans) {
		if (!plan.originalBuffer) continue;
		scheduleBufferPlan({
			...plan,
			context,
			contextStartTime: actualContextStartTime,
			fromFrame,
			sampleRate,
			transportRate,
			reversedBuffers,
			activeSources,
			allNodes,
		});
	}
	for (const prepared of streamed) prepared.start(actualContextStartTime, fromFrame, sampleRate, transportRate);
	if (totalChunkFrames && mode === 'offline') onProgress?.({ frames: totalChunkFrames, totalFrames: totalChunkFrames, progress: 1 });
	return { contextStartTime: actualContextStartTime, streamedClips: streamed.length };
}

function scheduleProjectTrackGains({
	context,
	project,
	trackGainParams,
	fromFrame,
	toFrame,
	contextStartTime,
	sampleRate,
	transportRate,
}) {
	const timelineRate = sampleRate * transportRate;
	const durationFrames = Math.max(1, getProjectDurationFrames(project), toFrame);
	for (const [trackIndex, track] of (project.tracks || []).entries()) {
		if (track.type === 'label' || !Array.isArray(track.envelope) || !track.envelope.length) continue;
		const scheduled = trackGainParams.get(String(track.id ?? trackIndex));
		if (!scheduled?.param) continue;
		const baseGain = Math.max(0, finite(track.gain, 1));
		const latencySeconds = nonNegativeInteger(scheduled.latencyFrames, 0)
			/ positiveInteger(context.sampleRate, sampleRate);
		const startTime = contextStartTime + latencySeconds;
		setParam(
			scheduled.param,
			baseGain * envelopeValueAtFrame(track.envelope, fromFrame, durationFrames),
			startTime,
		);
		for (const point of track.envelope) {
			if (point.frame <= fromFrame || point.frame >= toFrame) continue;
			linearRamp(
				scheduled.param,
				baseGain * Math.max(0, finite(point.value, 1)),
				startTime + (point.frame - fromFrame) / timelineRate,
			);
		}
		if (toFrame > fromFrame) {
			linearRamp(
				scheduled.param,
				baseGain * envelopeValueAtFrame(track.envelope, toFrame, durationFrames),
				startTime + (toFrame - fromFrame) / timelineRate,
			);
		}
	}
}

function scheduleBufferPlan({
	context,
	contextStartTime,
	fromFrame,
	sampleRate,
	transportRate,
	reversedBuffers,
	activeSources,
	allNodes,
	...plan
}) {
	const source = addNode(allNodes, context.createBufferSource());
	const chain = createClipGainChain(context, plan.trackInput, allNodes);
	const buffer = plan.reversed ? getReversedBuffer(context, plan.originalBuffer, reversedBuffers) : plan.originalBuffer;
	source.buffer = buffer;
	connect(source, chain.input);
	const timelineRate = sampleRate * transportRate;
	const startTime = contextStartTime + (plan.segmentStart - fromFrame) / timelineRate;
	setParam(source.playbackRate, plan.playbackRate * transportRate, startTime);
	scheduleClipGain(chain.fadeInGain.gain, chain.fadeOutGain.gain, chain.clipGain.gain, plan.clip, plan.relativeStart, plan.segmentEnd - clipStart(plan.clip), plan.duration, startTime, timelineRate, plan);
	try {
		source.start(startTime, plan.offsetFrame / buffer.sampleRate, plan.segmentDuration * plan.playbackRate);
		activeSources.add(source);
	} catch {
		// A malformed or out-of-range clip is skipped without stopping the mix.
	}
}

async function prepareLiveChunkPlan({
	context,
	chunkStreamClient,
	chunkAudioNodeFactory,
	activeSources,
	allNodes,
	signal,
	transportRate,
	...plan
}) {
	const requestedInputFrames = plan.segmentDuration * plan.playbackRate * plan.sourceSampleRate;
	const outputFrameCount = Math.round(plan.segmentDuration / transportRate * context.sampleRate);
	if (!Number.isFinite(plan.offsetFrame) || plan.offsetFrame < 0 || !Number.isFinite(requestedInputFrames)
		|| requestedInputFrames <= 0 || outputFrameCount <= 0) {
		throw longSourceError('The long-source clip range is invalid.');
	}
	const provider = plan.reversed ? createReversedChunkSource(plan.chunkSource) : plan.chunkSource;
	if (plan.offsetFrame >= provider.frameCount) throw longSourceError('The long-source clip range is empty.');
	const node = addNode(allNodes, await chunkAudioNodeFactory(context, { channelCount: provider.channelCount }));
	const chain = createClipGainChain(context, plan.trackInput, allNodes);
	connect(node, chain.input);
	const roundedStart = Math.round(plan.offsetFrame);
	const roundedInputFrames = Math.round(requestedInputFrames);
	const direct = Math.abs(roundedStart - plan.offsetFrame) <= 1e-9
		&& Math.abs(roundedInputFrames - requestedInputFrames) <= 1e-9
		&& roundedInputFrames === outputFrameCount;
	let streamRange;
	if (direct) {
		const endFrame = Math.min(provider.frameCount, roundedStart + roundedInputFrames);
		if (endFrame <= roundedStart) throw longSourceError('The long-source clip range is empty.');
		streamRange = { startFrame: roundedStart, endFrame };
	} else {
		const sourceStartFrame = Math.max(0, Math.floor(plan.offsetFrame) - STREAM_RESAMPLE_RADIUS);
		const sourceEndFrame = Math.min(
			provider.frameCount,
			Math.ceil(plan.offsetFrame + requestedInputFrames) + STREAM_RESAMPLE_RADIUS,
		);
		if (sourceEndFrame <= sourceStartFrame) throw longSourceError('The long-source clip range is empty.');
		streamRange = {
			sourceStartFrame,
			sourceEndFrame,
			outputFrameCount,
			resampleInputFrames: requestedInputFrames,
			resampleInputOffset: plan.offsetFrame - sourceStartFrame,
		};
	}
	const handle = chunkStreamClient.open({
		source: provider,
		...streamRange,
		outputPort: node.port,
		signal,
	});
	void handle.ready.catch(() => undefined);
	void handle.primed.catch(() => undefined);
	void handle.done.catch(() => undefined);
	await handle.primed;
	const sourceControl = {
		stop() { handle.cancel(); },
		disconnect() { node.disconnect?.(); },
	};
	activeSources.add(sourceControl);
	handle.done.then(
		() => activeSources.delete(sourceControl),
		() => activeSources.delete(sourceControl),
	);
	return {
		start(contextStartTime, fromFrame, sampleRate, activeTransportRate) {
			const timelineRate = sampleRate * activeTransportRate;
			const startTime = contextStartTime + (plan.segmentStart - fromFrame) / timelineRate;
			scheduleClipGain(chain.fadeInGain.gain, chain.fadeOutGain.gain, chain.clipGain.gain, plan.clip, plan.relativeStart, plan.segmentEnd - clipStart(plan.clip), plan.duration, startTime, timelineRate, plan);
			void handle.play({ contextStartFrame: Math.max(0, Math.round(startTime * context.sampleRate)) });
		},
	};
}

async function scheduleOfflineChunkPlan({
	context,
	contextStartTime,
	fromFrame,
	sampleRate,
	activeSources,
	allNodes,
	signal,
	onChunkLoaded,
	...plan
}) {
	const provider = plan.reversed ? createReversedChunkSource(plan.chunkSource) : plan.chunkSource;
	const sourceEndFrame = Math.min(
		provider.frameCount,
		plan.offsetFrame + plan.segmentDuration * plan.playbackRate * plan.sourceSampleRate,
	);
	const firstChunk = Math.floor(plan.offsetFrame / provider.chunkFrames);
	const lastChunk = Math.max(firstChunk, Math.ceil(sourceEndFrame / provider.chunkFrames) - 1);
	const chain = createClipGainChain(context, plan.trackInput, allNodes);
	const clipStartTime = contextStartTime + (plan.segmentStart - fromFrame) / sampleRate;
	scheduleClipGain(chain.fadeInGain.gain, chain.fadeOutGain.gain, chain.clipGain.gain, plan.clip, plan.relativeStart, plan.segmentEnd - clipStart(plan.clip), plan.duration, clipStartTime, sampleRate, plan);
	for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
		throwIfAborted(signal);
		const chunk = await provider.readStorageChunk(chunkIndex, { signal });
		const channels = chunk?.channels || chunk;
		const chunkStart = chunkIndex * provider.chunkFrames;
		const chunkFrames = channels[0]?.length || 0;
		const rangeStart = Math.max(plan.offsetFrame, chunkStart);
		const rangeEnd = Math.min(sourceEndFrame, chunkStart + chunkFrames);
		if (rangeEnd <= rangeStart) continue;
		const buffer = context.createBuffer(provider.channelCount, chunkFrames, provider.sampleRate);
		for (let channel = 0; channel < provider.channelCount; channel += 1) {
			if (typeof buffer.copyToChannel === 'function') buffer.copyToChannel(channels[channel], channel);
			else buffer.getChannelData(channel).set(channels[channel]);
		}
		const source = addNode(allNodes, context.createBufferSource());
		source.buffer = buffer;
		connect(source, chain.input);
		const when = clipStartTime + (rangeStart - plan.offsetFrame) / (provider.sampleRate * plan.playbackRate);
		setParam(source.playbackRate, plan.playbackRate, when);
		try {
			source.start(
				when,
				(rangeStart - chunkStart) / provider.sampleRate,
				(rangeEnd - rangeStart) / provider.sampleRate,
			);
			activeSources.add(source);
		} catch {
			// A corrupt chunk is reported by the provider; Web Audio range errors only skip this segment.
		}
		onChunkLoaded?.(rangeEnd - rangeStart);
	}
}

function createClipGainChain(context, trackInput, allNodes) {
	const fadeInGain = addNode(allNodes, context.createGain());
	const fadeOutGain = addNode(allNodes, context.createGain());
	const clipGain = addNode(allNodes, context.createGain());
	connect(fadeInGain, fadeOutGain);
	connect(fadeOutGain, clipGain);
	connect(clipGain, trackInput);
	return { input: fadeInGain, fadeInGain, fadeOutGain, clipGain };
}

function createReversedChunkSource(source) {
	return Object.freeze({
		channelCount: source.channelCount,
		frameCount: source.frameCount,
		chunkFrames: source.chunkFrames,
		sampleRate: source.sampleRate,
		async readStorageChunk(chunkIndex, context = {}) {
			const startFrame = chunkIndex * source.chunkFrames;
			const endFrame = Math.min(source.frameCount, startFrame + source.chunkFrames);
			if (startFrame >= endFrame) throw new RangeError(`Source storage chunk ${chunkIndex} does not exist.`);
			const physicalStart = source.frameCount - endFrame;
			const physicalEnd = source.frameCount - startFrame;
			const channels = await readChunkSourceRange(source, physicalStart, physicalEnd, context.signal);
			for (const channel of channels) channel.reverse();
			return channels;
		},
	});
}

async function readChunkSourceRange(source, startFrame, endFrame, signal) {
	const output = Array.from({ length: source.channelCount }, () => new Float32Array(endFrame - startFrame));
	let outputOffset = 0;
	const firstChunk = Math.floor(startFrame / source.chunkFrames);
	const lastChunk = Math.ceil(endFrame / source.chunkFrames) - 1;
	for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
		throwIfAborted(signal);
		const value = await source.readStorageChunk(chunkIndex, { signal });
		const channels = value?.channels || value;
		const chunkStart = chunkIndex * source.chunkFrames;
		const from = Math.max(startFrame, chunkStart) - chunkStart;
		const to = Math.min(endFrame, chunkStart + channels[0].length) - chunkStart;
		for (let channel = 0; channel < source.channelCount; channel += 1) {
			output[channel].set(channels[channel].subarray(from, to), outputOffset);
		}
		outputOffset += to - from;
	}
	if (outputOffset !== endFrame - startFrame) throw new Error('A long-source range is incomplete.');
	return output;
}

function scheduleClipGain(fadeInParam, fadeOutParam, clipGainParam, clip, segmentStart, segmentEnd, duration, startTime, sampleRate, options = {}) {
	const baseGain = Math.max(0, finite(clip.gain, 1));
	const envelope = Array.isArray(clip.envelope) ? clip.envelope : [];
	setParam(clipGainParam, baseGain * envelopeValueAtFrame(envelope, segmentStart, duration), startTime);
	if (envelope.length) {
		for (const point of envelope) {
			if (point.frame <= segmentStart || point.frame >= segmentEnd) continue;
			linearRamp(
				clipGainParam,
				baseGain * Math.max(0, finite(point.value, 1)),
				startTime + (point.frame - segmentStart) / sampleRate,
			);
		}
		if (segmentEnd > segmentStart) {
			linearRamp(
				clipGainParam,
				baseGain * envelopeValueAtFrame(envelope, segmentEnd, duration),
				startTime + (segmentEnd - segmentStart) / sampleRate,
			);
		}
	}
	const fadeIn = clampFrame(clip.fadeInFrames, 0, duration);
	const fadeOut = clampFrame(clip.fadeOutFrames, 0, duration);
	const crossfadeInRanges = options.crossfadeInRanges || [];
	const crossfadeOutRanges = options.crossfadeOutRanges || [];
	const fadeInAt = (frame) => (fadeIn > 0 && frame < fadeIn ? Math.max(0, frame / fadeIn) : 1)
		* crossfadeGainAt(frame, crossfadeInRanges, 'in');
	const fadeOutAt = (frame) => (fadeOut > 0 && frame > duration - fadeOut
		? Math.max(0, (duration - frame) / fadeOut)
		: 1)
		* crossfadeGainAt(frame, crossfadeOutRanges, 'out');
	scheduleGainAutomation(fadeInParam, fadeInAt, segmentStart, segmentEnd, startTime, sampleRate, [
		0, fadeIn, ...crossfadeInRanges.flat(),
	]);
	scheduleGainAutomation(fadeOutParam, fadeOutAt, segmentStart, segmentEnd, startTime, sampleRate, [
		duration - fadeOut, duration, ...crossfadeOutRanges.flat(),
	]);
}

function crossfadeGainAt(frame, ranges, direction) {
	let gain = 1;
	for (const [start, end] of ranges) {
		if (frame < start || frame > end) continue;
		const progress = end > start ? (frame - start) / (end - start) : 1;
		const value = direction === 'in' ? progress : 1 - progress;
		gain = Math.min(gain, Math.max(0, Math.min(1, value)));
	}
	return gain;
}

function scheduleGainAutomation(param, evaluate, segmentStart, segmentEnd, startTime, sampleRate, boundaries) {
	setParam(param, evaluate(segmentStart), startTime);
	const points = [...new Set(boundaries
		.filter((frame) => Number.isFinite(frame) && frame > segmentStart && frame < segmentEnd))]
		.sort((left, right) => left - right);
	for (const frame of points) {
		linearRamp(param, evaluate(frame), startTime + (frame - segmentStart) / sampleRate);
	}
	if (segmentEnd > segmentStart) {
		linearRamp(param, evaluate(segmentEnd), startTime + (segmentEnd - segmentStart) / sampleRate);
	}
}

function getReversedBuffer(context, original, cache) {
	if (cache.has(original)) return cache.get(original);
	const reversed = context.createBuffer(original.numberOfChannels, original.length, original.sampleRate);
	for (let channel = 0; channel < original.numberOfChannels; channel += 1) {
		const input = original.getChannelData(channel);
		const output = reversed.getChannelData(channel);
		for (let index = 0; index < input.length; index += 1) output[index] = input[input.length - index - 1];
	}
	cache.set(original, reversed);
	return reversed;
}

function sliceAudioBuffer(context, input, startFrame, frameCount) {
	const length = Math.max(1, Math.min(frameCount, input.length - startFrame));
	const output = context.createBuffer(input.numberOfChannels, length, input.sampleRate);
	for (let channel = 0; channel < input.numberOfChannels; channel += 1) {
		const values = input.getChannelData(channel).subarray(startFrame, startFrame + length);
		if (typeof output.copyToChannel === 'function') output.copyToChannel(values, channel);
		else output.getChannelData(channel).set(values);
	}
	return output;
}

function createImpulseResponse(context, duration, decay) {
	const length = Math.max(1, Math.round(duration * context.sampleRate));
	const impulse = context.createBuffer(2, length, context.sampleRate);
	for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
		const data = impulse.getChannelData(channel);
		let seed = 0x1234567 + channel * 997;
		for (let index = 0; index < length; index += 1) {
			seed = (seed * 16807) % 2147483647;
			const noise = seed / 1073741823.5 - 1;
			data[index] = noise * ((1 - index / length) ** decay);
		}
	}
	return impulse;
}

function createGateCurve(thresholdDb) {
	const threshold = 10 ** (thresholdDb / 20);
	const curve = new Float32Array(2049);
	for (let index = 0; index < curve.length; index += 1) {
		const sample = index / (curve.length - 1) * 2 - 1;
		curve[index] = Math.abs(sample) < threshold ? 0 : sample;
	}
	return curve;
}

function createAnalyser(context, nodes) {
	if (typeof context.createAnalyser !== 'function') return null;
	const analyser = addNode(nodes, context.createAnalyser());
	analyser.fftSize = 256;
	analyser.smoothingTimeConstant = 0.4;
	return analyser;
}

function createSpectrumAnalyser(context, nodes) {
	if (typeof context.createAnalyser !== 'function') return null;
	const analyser = addNode(nodes, context.createAnalyser());
	analyser.fftSize = PARAMETRIC_EQ_SPECTRUM_FFT_SIZE;
	analyser.smoothingTimeConstant = 0.75;
	analyser.minDecibels = -120;
	analyser.maxDecibels = 0;
	return analyser;
}

function readParametricEqSpectrumEntry(entry, which, target) {
	if (!(target instanceof Float32Array)) {
		throw new TypeError('A Float32Array spectrum target is required.');
	}
	if (which !== 'input' && which !== 'output') {
		throw new RangeError('Parametric EQ spectrum source must be input or output.');
	}
	const analyser = entry?.[which];
	if (!analyser?.getFloatFrequencyDomainData) {
		target.fill(Number.NEGATIVE_INFINITY);
		return null;
	}
	if (target.length !== entry.metadata.frequencyBinCount) {
		throw new RangeError(`Parametric EQ spectrum buffers must contain ${entry.metadata.frequencyBinCount} bins.`);
	}
	analyser.getFloatFrequencyDomainData(target);
	return entry.metadata;
}

function readMeter(analyser) {
	if (!analyser?.getFloatTimeDomainData) return { peak: 0, rms: 0, dbfs: -Infinity };
	const values = new Float32Array(analyser.fftSize || 256);
	analyser.getFloatTimeDomainData(values);
	let peak = 0;
	let squares = 0;
	for (const value of values) {
		peak = Math.max(peak, Math.abs(value));
		squares += value * value;
	}
	const rms = Math.sqrt(squares / Math.max(1, values.length));
	return { peak, rms, dbfs: peak > 0 ? 20 * Math.log10(peak) : -Infinity };
}

function disposeGraph(graph, stopSources) {
	graph.abortController?.abort?.();
	if (stopSources) {
		for (const source of graph.sources || []) {
			try { source.stop(); } catch { /* It may already have ended. */ }
		}
	}
	for (const node of [...(graph.nodes || [])].reverse()) {
		const registration = parametricEqPortMessageHandlers.get(node);
		if (registration?.handler && node.port?.onmessage === registration.handler) node.port.onmessage = null;
		if (registration?.processorErrorHandler) {
			if (typeof node.removeEventListener === 'function') {
				node.removeEventListener('processorerror', registration.processorErrorHandler);
			} else if (node.onprocessorerror === registration.processorErrorHandler) node.onprocessorerror = null;
		}
		if (registration) parametricEqPortMessageHandlers.delete(node);
		try { node.disconnect(); } catch { /* It may already be disconnected. */ }
	}
	graph.sources?.clear?.();
	graph.effectNodes?.clear?.();
	graph.effectAnalysers?.clear?.();
	graph.effectMessageSequences?.clear?.();
}

function longSourceError(message) {
	const error = new Error(message);
	error.code = 'LONG_SOURCE_RENDER_REQUIRED';
	return error;
}

function parametricEqProcessingError(value) {
	const error = new Error(value?.message || 'The parametric EQ processor failed during rendering.');
	error.name = 'ParametricEqProcessingError';
	if (value?.status != null) error.status = value.status;
	if (value?.effectId) error.effectId = value.effectId;
	return error;
}

function throwIfAborted(signal) {
	if (!signal?.aborted) return;
	throw createAbortError();
}

function abortable(promise, signal) {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(createAbortError());
	return new Promise((resolve, reject) => {
		const abort = () => reject(createAbortError());
		signal.addEventListener('abort', abort, { once: true });
		Promise.resolve(promise).then(
			(value) => {
				signal.removeEventListener('abort', abort);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener('abort', abort);
				reject(error);
			},
		);
	});
}

function getProjectClips(project) {
	if (Array.isArray(project?.clips)) return project.clips;
	const clips = [];
	for (const track of project?.tracks || []) {
		for (const clip of track.clips || []) if (typeof clip === 'object') clips.push(clip);
	}
	return clips;
}

function getTrackClips(track, clipsById) {
	if (Array.isArray(track.clipIds)) return track.clipIds.map((id) => clipsById.get(String(id))).filter(Boolean);
	if (Array.isArray(track.clips)) {
		return track.clips.map((clip) => typeof clip === 'object' ? clip : clipsById.get(String(clip))).filter(Boolean);
	}
	return [];
}

/**
 * Derive complementary crossfade ranges for all overlapping clips on a track.
 * Ranges are clip-local and intentionally not persisted in the project model.
 */
export function automaticCrossfadeRanges(clips) {
	if (!Array.isArray(clips)) throw new TypeError('clips must be an array.');
	const ranges = new Map(clips.map((clip) => [String(clip.id), { crossfadeInRanges: [], crossfadeOutRanges: [] }]));
	const ordered = clips
		.filter((clip) => clip && clip.id != null && clipDuration(clip) > 0)
		.slice()
		.sort((left, right) => clipStart(left) - clipStart(right) || String(left.id).localeCompare(String(right.id)));
	for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
		const left = ordered[leftIndex];
		const leftStart = clipStart(left);
		const leftEnd = leftStart + clipDuration(left);
		for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
			const right = ordered[rightIndex];
			const rightStart = clipStart(right);
			if (rightStart >= leftEnd) break;
			const overlapStart = Math.max(leftStart, rightStart);
			const overlapEnd = Math.min(leftEnd, rightStart + clipDuration(right));
			if (overlapEnd <= overlapStart) continue;
			ranges.get(String(left.id)).crossfadeOutRanges.push([
				overlapStart - leftStart,
				overlapEnd - leftStart,
			]);
			ranges.get(String(right.id)).crossfadeInRanges.push([
				overlapStart - rightStart,
				overlapEnd - rightStart,
			]);
		}
	}
	for (const value of ranges.values()) {
		value.crossfadeInRanges = mergeFrameRanges(value.crossfadeInRanges);
		value.crossfadeOutRanges = mergeFrameRanges(value.crossfadeOutRanges);
	}
	return ranges;
}

function mergeFrameRanges(ranges) {
	const ordered = ranges
		.filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
		.slice()
		.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
	const merged = [];
	for (const [start, end] of ordered) {
		const previous = merged.at(-1);
		if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
		else merged.push([start, end]);
	}
	return merged;
}

function clipStart(clip) {
	return nonNegativeInteger(clip?.timelineStartFrame ?? clip?.timelineStartFrames, 0);
}

function clipDuration(clip) {
	return nonNegativeInteger(clip?.durationFrames ?? clip?.frameLength, 0);
}

function normalizeLoop(value, durationFrames) {
	const startFrame = clampFrame(value?.startFrame, 0, durationFrames);
	const endFrame = clampFrame(value?.endFrame ?? durationFrames, startFrame, durationFrames);
	return { enabled: Boolean(value?.enabled) && endFrame > startFrame, startFrame, endFrame };
}

function normalizePlayAtSpeedRate(value) {
	const rate = Number(value);
	if (!Number.isFinite(rate) || rate < PLAY_AT_SPEED_MINIMUM_RATE || rate > PLAY_AT_SPEED_MAXIMUM_RATE) {
		throw new RangeError(`Playback speed must be between ${PLAY_AT_SPEED_MINIMUM_RATE} and ${PLAY_AT_SPEED_MAXIMUM_RATE}.`);
	}
	return rate;
}

export function estimatePlayAtSpeedStaffPadPeakBytes(durationFrames, sampleRate, playbackRate) {
	const frames = Math.max(1, nonNegativeInteger(durationFrames, 0));
	const rate = normalizePlayAtSpeedRate(playbackRate);
	return estimateAudacityEffectPeakBytes(
		'audacity-change-tempo',
		frames,
		{ tempoPercent: (rate - 1) * 100 },
		{ channelCount: 2, sampleRate: positiveInteger(sampleRate, DEFAULT_SAMPLE_RATE) },
	);
}

export function assertPlayAtSpeedStaffPadMemorySafe(durationFrames, sampleRate, playbackRate) {
	const estimatedBytes = estimatePlayAtSpeedStaffPadPeakBytes(durationFrames, sampleRate, playbackRate);
	if (estimatedBytes <= PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES) return estimatedBytes;
	const error = new RangeError(
		`Pitch-preserving whole-project playback needs an estimated ${estimatedBytes} bytes, exceeding the ${PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES}-byte browser memory limit.`,
	);
	error.code = 'PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT';
	throw error;
}

function audioBufferChannels(buffer) {
	if (Array.isArray(buffer?.channels)) return buffer.channels.map((channel) => channel instanceof Float32Array ? channel : new Float32Array(channel));
	const channelCount = nonNegativeInteger(buffer?.numberOfChannels, 0);
	if (!channelCount || typeof buffer?.getChannelData !== 'function') {
		throw new TypeError('Pitch-preserving playback requires rendered PCM channels.');
	}
	return Array.from({ length: channelCount }, (_, channel) => buffer.getChannelData(channel));
}

function normalizePreparedSpeedPlayback(channels, sampleRate, durationFrames, playbackRate) {
	if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2) {
		throw new RangeError('Pitch-preserving playback requires one or two PCM channels.');
	}
	const normalized = channels.map((channel) => channel instanceof Float32Array
		? channel
		: new Float32Array(channel || []));
	const frameCount = normalized[0].length;
	if (!frameCount || normalized.some((channel) => channel.length !== frameCount)) {
		throw new RangeError('Pitch-preserving playback channels must have one matching frame length.');
	}
	return {
		channels: normalized,
		frameCount,
		sampleRate: positiveInteger(sampleRate, DEFAULT_SAMPLE_RATE),
		durationFrames: nonNegativeInteger(durationFrames, 0),
		playbackRate: normalizePlayAtSpeedRate(playbackRate),
		audioBuffer: null,
	};
}

function resolveTailSeconds(project, includeTail, { trackId = null, includeMaster = true } = {}) {
	if (!includeTail) return 0;
	if (Number.isFinite(includeTail)) return clamp(includeTail, 0, MAX_EFFECT_TAIL_SECONDS);
	const tracks = (trackId == null
		? project?.tracks || []
		: (project?.tracks || []).filter((track) => String(track.id) === String(trackId)))
		.filter((track) => track.type !== 'label');
	const trackTailFrames = tracks.reduce(
		(longest, track) => Math.max(longest, rackTailFrames(track.effects || [], project?.sampleRate || DEFAULT_SAMPLE_RATE, MAX_EFFECT_TAIL_SECONDS)),
		0,
	);
	const masterTailFrames = includeMaster
		? rackTailFrames(project?.master?.effects || [], project?.sampleRate || DEFAULT_SAMPLE_RATE, MAX_EFFECT_TAIL_SECONDS)
		: 0;
	return Math.min(MAX_EFFECT_TAIL_SECONDS, (trackTailFrames + masterTailFrames) / (project?.sampleRate || DEFAULT_SAMPLE_RATE));
}

function getAudioContextConstructor() {
	return globalThis.AudioContext || globalThis.webkitAudioContext || globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext;
}

function normalizeOutputDeviceId(deviceId) {
	if (deviceId == null || deviceId === 'default') return '';
	if (typeof deviceId !== 'string') throw new TypeError('An audio output device ID must be a string.');
	return deviceId;
}

function outputDeviceError(name, message) {
	if (typeof globalThis.DOMException === 'function') return new DOMException(message, name);
	const error = new Error(message);
	error.name = name;
	return error;
}

async function ensureProjectWorklets(context, project) {
	const needsDynamics = projectUsesDynamicsWorklet(project) && !dynamicsWorkletContexts.has(context);
	const needsAudacity = projectUsesAudacityWorklet(project) && !audacityWorkletContexts.has(context);
	const usesParametricEq = projectUsesParametricEqWorklet(project);
	const needsParametricEq = usesParametricEq && !parametricEqWorkletContexts.has(context);
	const needsParametricEqWasm = usesParametricEq && !parametricEqWasmModules.has(context);
	if (!needsDynamics && !needsAudacity && !needsParametricEq && !needsParametricEqWasm) return;
	if (!context?.audioWorklet?.addModule || typeof (globalThis.AudioWorkletNode || globalThis.window?.AudioWorkletNode) !== 'function') {
		if (needsAudacity) throw new Error('This browser cannot run Audacity real-time effects without bypassing them.');
		if (needsParametricEq || needsParametricEqWasm) throw new Error('This browser cannot run the parametric EQ without bypassing it.');
		throw new Error('This browser cannot run the limiter or gate without bypassing it.');
	}
	if (usesParametricEq) await ensureParametricEqWorklet(context);
	if (needsDynamics) {
		await addWorkletModuleOnce(
			context,
			dynamicsWorkletContexts,
			dynamicsWorkletLoads,
			() => new URL('./dynamics-worklet.js', import.meta.url),
		);
	}
	if (needsAudacity) {
		await addWorkletModuleOnce(context, audacityWorkletContexts, audacityWorkletLoads, audacityWorkletModuleUrl);
	}
}

async function ensureParametricEqWorklet(context) {
	if (!context?.audioWorklet?.addModule
		|| typeof (globalThis.AudioWorkletNode || globalThis.window?.AudioWorkletNode) !== 'function') {
		throw new Error('This browser cannot run the parametric EQ without bypassing it.');
	}
	let module = parametricEqWasmModules.get(context);
	if (!(module instanceof WebAssembly.Module)) {
		module = await loadParametricEqWasmModule();
		if (!(module instanceof WebAssembly.Module)) {
			throw new Error('The parametric EQ WASM module could not be compiled.');
		}
		parametricEqWasmModules.set(context, module);
	}
	await addWorkletModuleOnce(
		context,
		parametricEqWorkletContexts,
		parametricEqWorkletLoads,
		parametricEqWorkletModuleUrl,
	);
	return module;
}

async function addWorkletModuleOnce(context, loadedContexts, pendingLoads, moduleUrl) {
	if (loadedContexts.has(context)) return;
	let pending = pendingLoads.get(context);
	if (!pending) {
		pending = Promise.resolve()
			.then(moduleUrl)
			.then((url) => context.audioWorklet.addModule(url))
			.then(() => { loadedContexts.add(context); });
		pendingLoads.set(context, pending);
	}
	try {
		await pending;
	} finally {
		if (pendingLoads.get(context) === pending) pendingLoads.delete(context);
	}
}

async function audacityWorkletModuleUrl() {
	// Vite's generic `new URL(..., import.meta.url)` asset handling copies the
	// entry module without bundling its relative imports. The worker URL query
	// emits a self-contained chunk that AudioWorklet.addModule can evaluate.
	if (import.meta.env?.DEV || import.meta.env?.PROD) {
		const module = await import('./audacity-effects/live-worklet.js?worker&url');
		return module.default;
	}
	// Node's engine tests do not run through Vite and use a mocked module loader.
	return new URL('./audacity-effects/live-worklet.js', import.meta.url);
}

async function parametricEqWorkletModuleUrl() {
	if (import.meta.env?.DEV || import.meta.env?.PROD) {
		const module = await import('./parametric-eq/worklet.js?worker&url');
		return module.default;
	}
	return new URL('./parametric-eq/worklet.js', import.meta.url);
}

function projectUsesDynamicsWorklet(project) {
	return projectUsesEffect(project, (type) => type === 'limiter' || type === 'gate');
}

function projectUsesAudacityWorklet(project) {
	return projectUsesEffect(project, (type) => isAudacityLiveEffect(type));
}

function projectUsesParametricEqWorklet(project) {
	return projectUsesEffect(project, isParametricEqType);
}

function projectUsesEffect(project, predicate) {
	for (const rack of projectEffectRacks(project)) {
		if (rack.effects.some((effect) => (
			effect?.enabled !== false
			&& effect?.bypassed !== true
			&& predicate(String(effect?.type || '').toLowerCase())
		))) return true;
	}
	return false;
}

function isParametricEqType(type) {
	return PARAMETRIC_EQ_TYPES.has(String(type || '').toLowerCase());
}

function getOfflineAudioContextConstructor() {
	return globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext || globalThis.window?.OfflineAudioContext || globalThis.window?.webkitOfflineAudioContext;
}

function createRealtimeContext(factory, sampleRate) {
	if (sampleRate == null) {
		try { return new factory(); } catch { return factory(); }
	}
	try { return new factory({ sampleRate }); } catch { return factory({ sampleRate }); }
}

function createOfflineContext(factory, channels, length, sampleRate) {
	try { return new factory(channels, length, sampleRate); } catch {
		try { return new factory({ numberOfChannels: channels, length, sampleRate }); } catch {
			return factory({ numberOfChannels: channels, length, sampleRate });
		}
	}
}

function addNode(nodes, node) {
	if (node) nodes.push(node);
	return node;
}

function connect(source, target, output = undefined, input = undefined) {
	if (output === undefined) source?.connect?.(target);
	else source?.connect?.(target, output, input);
}

function setParam(param, value, time) {
	if (!param) return;
	if (typeof param.setValueAtTime === 'function') param.setValueAtTime(value, time || 0);
	else param.value = value;
}

function linearRamp(param, value, time) {
	if (!param) return;
	if (typeof param.linearRampToValueAtTime === 'function') param.linearRampToValueAtTime(value, time);
	else setParam(param, value, time);
}

function postParametricEqMessage(graph, scope, targetId, effectId, message, requestedSequence) {
	const key = effectGraphKey(scope, targetId, effectId);
	const node = graph?.effectNodes?.get(key);
	if (!node?.port?.postMessage) return false;
	const currentSequence = graph.effectMessageSequences?.get(key) || 0;
	const sequence = requestedSequence == null
		? currentSequence + 1
		: safeMessageSequence(requestedSequence, 'revision');
	if (sequence <= currentSequence) return false;
	node.port.postMessage({ ...message, revision: sequence, sequence });
	graph.effectMessageSequences?.set(key, sequence);
	return sequence;
}

function effectGraphKey(scope, targetId, effectId) {
	const normalizedScope = String(scope || '');
	if (!['track', 'master', 'group', 'send'].includes(normalizedScope)) {
		throw new RangeError(`Unsupported effect scope: ${normalizedScope || '(empty)'}.`);
	}
	if (typeof effectId !== 'string' || !effectId) throw new TypeError('A stable effect ID is required.');
	let normalizedTargetId = 'master';
	if (normalizedScope !== 'master') {
		if (targetId == null || String(targetId) === '') throw new TypeError(`A ${normalizedScope} effect target ID is required.`);
		normalizedTargetId = String(targetId);
	}
	return JSON.stringify([normalizedScope, normalizedTargetId, effectId]);
}

function safeMessageSequence(value, name) {
	const sequence = Number(value);
	if (!Number.isSafeInteger(sequence) || sequence < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return sequence;
}

function cloneMessageValue(value) {
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function clampFrame(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, nonNegativeInteger(value, minimum)));
}

function positiveInteger(value, fallback) {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function nonNegativeInteger(value, fallback) {
	return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function finite(value, fallback) {
	return Number.isFinite(value) ? Number(value) : fallback;
}

function monotonicMilliseconds() {
	return globalThis.performance?.now?.() ?? Date.now();
}

function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}

function createAbortError() {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted', 'AbortError')
		: Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}
