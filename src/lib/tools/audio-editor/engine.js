import { rackTailFrames } from './effects.js';
import {
	audacityLiveEffectCapability,
	isAudacityLiveEffect,
} from './audacity-effects/live.js';
import {
	ChunkStreamClient,
	createChunkStreamAudioNode,
} from './chunk-stream-client.js';
import { AUDIO_EDITOR_STORAGE_CHUNK_FRAMES } from './chunk-stream.js';
export { createRecordingController, requestMicrophone } from './recording.js';

const DEFAULT_SAMPLE_RATE = 48000;
const DEFAULT_METER_INTERVAL = 50;
const MAX_EFFECT_TAIL_SECONDS = 10;
const STREAM_RESAMPLE_RADIUS = 24;
const dynamicsWorkletContexts = new WeakSet();
const audacityWorkletContexts = new WeakSet();

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
		this.positionFrame = 0;
		this.playbackStartFrame = 0;
		this.playbackStartTime = 0;
		this.durationFrames = 0;
		this.playEndFrame = 0;
		this.loopScheduleTime = 0;
		this.state = 'empty';
		this.loop = { enabled: false, startFrame: 0, endFrame: 0 };
		this.graph = null;
		this.ticker = null;
		this.meterInterval = Math.max(16, Number(meterInterval) || DEFAULT_METER_INTERVAL);
		this.reversedBuffers = new WeakMap();
		this.positionListeners = new Set(onPosition ? [onPosition] : []);
		this.meterListeners = new Set(onMeter ? [onMeter] : []);
		this.stateListeners = new Set(onState ? [onState] : []);
	}

	loadProject(project, sourceBuffers = new Map(), options = {}) {
		this.#haltGraph();
		this.project = project || null;
		this.sources = sourceBuffers instanceof Map ? new Map(sourceBuffers) : new Map(Object.entries(sourceBuffers || {}));
		if (options.chunkSources !== undefined) this.setChunkSources(options.chunkSources);
		this.durationFrames = getProjectDurationFrames(project);
		this.positionFrame = Math.min(this.positionFrame, this.durationFrames);
		this.playEndFrame = this.durationFrames;
		this.loop = normalizeLoop(project?.loop, this.durationFrames);
		this.#setState(project ? 'stopped' : 'empty');
		this.#emitPosition();
		return this;
	}

	applyProject(project, sourceBuffers = this.sources, options = {}) {
		const wasPlaying = this.state === 'playing';
		const position = this.getPositionFrames();
		this.loadProject(project, sourceBuffers, options);
		this.positionFrame = Math.min(position, this.durationFrames);
		if (wasPlaying) return this.play();
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

	/** Return the editor-owned 48 kHz context; transport/recording opt into resume. */
	async getAudioContext({ resume = true } = {}) {
		const context = await this.#getContext();
		if (resume) await context.resume?.();
		return context;
	}

	async play() {
		if (!this.project) throw new Error('Load an audio editor project before playback.');
		if (this.state === 'playing') return;
		const context = await this.getAudioContext();
		await ensureProjectWorklets(context, this.project);
		if (this.positionFrame >= this.durationFrames) this.positionFrame = 0;
		if (this.loop.enabled && (this.positionFrame < this.loop.startFrame || this.positionFrame >= this.loop.endFrame)) this.positionFrame = this.loop.startFrame;
		await this.#schedulePlayback(this.positionFrame, context.currentTime);
	}

	/** Schedule transport against an exact AudioContext time (used by punch recording). */
	async playAt(contextTime, fromFrame = this.positionFrame) {
		if (!this.project) throw new Error('Load an audio editor project before playback.');
		const context = await this.getAudioContext();
		await ensureProjectWorklets(context, this.project);
		const scheduledTime = Math.max(context.currentTime, Number(contextTime) || context.currentTime);
		this.positionFrame = clampFrame(fromFrame, 0, this.durationFrames);
		await this.#schedulePlayback(this.positionFrame, scheduledTime);
	}

	pause() {
		if (this.state !== 'playing') return;
		this.positionFrame = this.getPositionFrames();
		this.#haltGraph();
		this.#setState('paused');
		this.#emitPosition();
	}

	stop() {
		this.#haltGraph();
		this.positionFrame = 0;
		this.#setState(this.project ? 'stopped' : 'empty');
		this.#emitPosition();
	}

	seek(frame) {
		const nextFrame = clampFrame(frame, 0, this.durationFrames);
		const wasPlaying = this.state === 'playing';
		this.#haltGraph();
		this.positionFrame = nextFrame;
		if (wasPlaying && nextFrame < this.durationFrames) void this.#schedulePlayback(nextFrame).catch((error) => this.#handleSchedulingError(error));
		else {
			this.#setState(this.project ? 'paused' : 'empty');
			this.#emitPosition();
		}
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
				void this.#schedulePlayback(position).catch((error) => this.#handleSchedulingError(error));
			}
		}
		return { ...this.loop };
	}

	getPositionFrames() {
		if (this.state !== 'playing' || !this.context) return this.positionFrame;
		if (this.context.currentTime <= this.playbackStartTime) return this.playbackStartFrame;
		const elapsedFrames = Math.floor((this.context.currentTime - this.playbackStartTime) * this.sampleRate);
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
			void this.#schedulePlayback(position).catch((error) => this.#handleSchedulingError(error));
		}
		return () => this.meterListeners.delete(listener);
	}

	subscribeState(listener) {
		if (typeof listener !== 'function') return () => {};
		this.stateListeners.add(listener);
		return () => this.stateListeners.delete(listener);
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
		await ensureProjectWorklets(context, this.project);
		const graph = buildProjectGraph(context, context.destination, this.project, {
			metering: false,
			respectMuteSolo,
			trackId,
			includeMaster,
			includeTrackPan,
		});
		try {
			await scheduleProjectClips({
				context,
				project: this.project,
				sources: this.sources,
				trackInputs: graph.trackInputs,
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
			const captureOffset = warmupFrames + processingLatencyFrames;
			return captureOffset || rendered.length !== requestedLength
				? sliceAudioBuffer(context, rendered, captureOffset, requestedLength)
				: rendered;
		} finally {
			disposeGraph(graph, false);
		}
	}

	/** Stream a memory-safe 1× render through the same realtime graph. */
	async renderMixRealtime({
		startFrame = 0,
		endFrame = this.durationFrames,
		includeTail = false,
		trackId = null,
		includeMaster = true,
		respectMuteSolo = true,
		sampleRate = this.sampleRate,
		outputFrames: requestedOutputFrames = null,
		preRollFrames = 0,
		chunkFrames = 4096,
		onChunk,
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
		await context.audioWorklet.addModule(new URL('./render-capture-worklet.js', import.meta.url));
		await ensureProjectWorklets(context, this.project);
		const outputFrames = requestedOutputFrames == null
			? Math.max(1, Math.round((toFrame - fromFrame + tailFrames) / this.sampleRate * context.sampleRate))
			: positiveInteger(requestedOutputFrames, 1);
		const startTime = context.currentTime + 0.08;
		const warmupContextFrames = Math.round(warmupProjectFrames / this.sampleRate * context.sampleRate);
		const processingLatencyFrames = projectGraphLatencyFrames(this.project, {
			trackId,
			includeMaster,
			sampleRate: context.sampleRate,
		});
		const capture = new globalThis.AudioWorkletNode(context, 'kw-audio-render-capture', {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			outputChannelCount: [2],
			processorOptions: {
				startFrame: Math.ceil(startTime * context.sampleRate) + warmupContextFrames + processingLatencyFrames,
				totalFrames: outputFrames,
				chunkFrames: Math.max(128, Math.min(16_384, Math.floor(chunkFrames))),
			},
		});
		const silent = context.createGain();
		silent.gain.value = 0;
		capture.connect(silent);
		silent.connect(context.destination);
		const graph = buildProjectGraph(context, capture, this.project, { metering: false, respectMuteSolo, trackId, includeMaster });
		const abortGraph = () => graph.abortController.abort();
		signal?.addEventListener('abort', abortGraph, { once: true });
		try {
			await scheduleProjectClips({
				context,
				project: this.project,
				sources: this.sources,
				trackInputs: graph.trackInputs,
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
			throw error;
		}

		let writeQueue = Promise.resolve();
		let pendingChunks = 0;
		let renderedFrames = 0;
		let resolveDone;
		let rejectDone;
		const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
		const abort = () => rejectDone(createAbortError());
		signal?.addEventListener('abort', abort, { once: true });
		capture.onprocessorerror = () => rejectDone(new Error('The realtime render worklet failed.'));
		capture.port.onmessage = ({ data = {} }) => {
			if (data.type === 'audio-chunk') {
				pendingChunks += 1;
				if (pendingChunks > 64) {
					rejectDone(new Error('Export storage could not keep up with realtime audio.'));
					return;
				}
				const channels = (data.channels || []).map((channel) => channel instanceof Float32Array ? channel : new Float32Array(channel));
				renderedFrames += data.frames || channels[0]?.length || 0;
				writeQueue = writeQueue
					.then(() => onChunk(channels, { frameOffset: data.frameOffset, sampleRate: context.sampleRate }))
					.finally(() => { pendingChunks -= 1; });
			} else if (data.type === 'done') writeQueue.then(resolveDone, rejectDone);
		};
		capture.port.start?.();

		try {
			await context.resume();
			await done;
			return { sampleRate: context.sampleRate, channelCount: 2, frameCount: renderedFrames };
		} finally {
			signal?.removeEventListener('abort', abort);
			signal?.removeEventListener('abort', abortGraph);
			capture.port.onmessage = null;
			capture.onprocessorerror = null;
			disposeGraph(graph, true);
			try { capture.disconnect(); } catch { /* Already disconnected. */ }
			try { silent.disconnect(); } catch { /* Already disconnected. */ }
			if (context.state !== 'closed') await context.close?.();
		}
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

	async dispose() {
		this.#haltGraph();
		this.project = null;
		this.sources.clear();
		this.chunkSources.clear();
		this.positionListeners.clear();
		this.meterListeners.clear();
		this.stateListeners.clear();
		this.reversedBuffers = new WeakMap();
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
		this.context = createRealtimeContext(this.audioContextFactory, this.sampleRate);
		return this.context;
	}

	async #schedulePlayback(fromFrame, scheduledTime = this.context?.currentTime || 0) {
		const context = this.context;
		if (!context || !this.project) return;
		this.#haltGraph();
		const loopEnd = this.loop.enabled ? this.loop.endFrame : this.durationFrames;
		this.playEndFrame = Math.max(fromFrame, loopEnd);
		this.playbackStartFrame = fromFrame;
		this.positionFrame = fromFrame;
		this.graph = buildProjectGraph(context, context.destination, this.project, {
			metering: this.meterListeners.size > 0,
			respectMuteSolo: true,
		});
		this.playbackStartTime = scheduledTime + (this.graph.latencyFrames || 0) / this.sampleRate;
		const graph = this.graph;
		let schedule;
		try {
			schedule = await scheduleProjectClips({
				context,
				project: this.project,
				sources: this.sources,
				trackInputs: this.graph.trackInputs,
				fromFrame,
				toFrame: this.playEndFrame,
				contextStartTime: scheduledTime,
				sampleRate: this.sampleRate,
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
		this.playbackStartTime = scheduledTime + (this.graph.latencyFrames || 0) / this.sampleRate;
		if (this.loop.enabled && this.loop.endFrame > this.loop.startFrame) {
			this.loopScheduleTime = scheduledTime + (this.loop.endFrame - fromFrame) / this.sampleRate;
			this.#scheduleLoopAhead();
		}
		this.#setState('playing');
		this.#startTicker();
		this.#emitPosition();
	}

	#getChunkStreamClient() {
		if (!this.chunkSources.size) return null;
		if (!this.chunkStreamClient) this.chunkStreamClient = this.chunkStreamClientFactory();
		return this.chunkStreamClient;
	}

	#handleSchedulingError(error) {
		if (error?.name === 'AbortError') return;
		this.#haltGraph();
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
			this.#setState('stopped');
			this.#emitPosition();
		}, this.meterInterval);
	}

	#scheduleLoopAhead() {
		if (!this.graph || !this.context || !this.project || !this.loop.enabled) return;
		const durationSeconds = (this.loop.endFrame - this.loop.startFrame) / this.sampleRate;
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
				fromFrame: this.loop.startFrame,
				toFrame: this.loop.endFrame,
				contextStartTime: this.loopScheduleTime,
				sampleRate: this.sampleRate,
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

	#haltGraph() {
		this.#stopTicker();
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
		const meter = { master: readMeter(this.graph.masterAnalyser), tracks };
		for (const listener of this.meterListeners) listener(meter);
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
	return trackLatency + masterLatency;
}

/** Build track/master nodes and return the per-track clip inputs. */
export function buildProjectGraph(context, destination, project, {
	metering = true,
	respectMuteSolo = true,
	trackId: onlyTrackId = null,
	includeMaster = true,
	includeTrackPan = true,
} = {}) {
	const nodes = [];
	const sources = new Set();
	const trackInputs = new Map();
	const trackAnalysers = new Map();
	const tracks = Array.isArray(project?.tracks) ? project.tracks.filter((track) => track.type !== 'label') : [];
	// Every dry input exists before a rack is built so Auto Duck can route any
	// other track into its second AudioWorklet input without graph-order races.
	for (const [index, track] of tracks.entries()) {
		trackInputs.set(String(track.id ?? index), addNode(nodes, context.createGain()));
	}
	const renderedTracks = tracks.filter((track, index) => (
		onlyTrackId == null || String(onlyTrackId) === String(track.id ?? index)
	));
	const maximumTrackLatency = renderedTracks.reduce((maximum, track) => Math.max(
		maximum,
		effectRackLatencyFrames(track.effects || [], context.sampleRate || DEFAULT_SAMPLE_RATE),
	), 0);
	const masterInput = addNode(nodes, context.createGain());
	const anySolo = respectMuteSolo && tracks.some((track) => track.solo);
	for (const [index, track] of tracks.entries()) {
		const trackId = String(track.id ?? index);
		if (onlyTrackId != null && String(onlyTrackId) !== trackId) continue;
		const input = trackInputs.get(trackId);
		const trackLatency = effectRackLatencyFrames(track.effects || [], context.sampleRate || DEFAULT_SAMPLE_RATE);
		let output = applyEffectRack(context, input, track.effects || [], nodes, { sidechainInputs: trackInputs });
		const gain = addNode(nodes, context.createGain());
		setParam(gain.gain, finite(track.gain, 1), context.currentTime);
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
		const mute = addNode(nodes, context.createGain());
		const audible = !respectMuteSolo || (anySolo ? Boolean(track.solo) : !track.mute);
		setParam(mute.gain, audible ? 1 : 0, context.currentTime);
		connect(output, mute);
		connect(mute, masterInput);
	}

	const masterEffects = includeMaster ? project?.master?.effects || [] : [];
	const masterLatency = effectRackLatencyFrames(masterEffects, context.sampleRate || DEFAULT_SAMPLE_RATE);
	const masterOutput = applyEffectRack(context, masterInput, masterEffects, nodes, {
		sidechainInputs: trackInputs,
		baseSidechainDelayFrames: maximumTrackLatency,
	});
	const masterGain = addNode(nodes, context.createGain());
	setParam(masterGain.gain, includeMaster ? finite(project?.master?.gain, 1) : 1, context.currentTime);
	connect(masterOutput, masterGain);
	const masterAnalyser = metering ? createAnalyser(context, nodes) : null;
	if (masterAnalyser) {
		connect(masterGain, masterAnalyser);
		connect(masterAnalyser, destination);
	} else connect(masterGain, destination);

	return {
		nodes,
		sources,
		abortController: new AbortController(),
		trackInputs,
		trackAnalysers,
		masterAnalyser,
		latencyFrames: maximumTrackLatency + masterLatency,
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
	if (type === 'eq' || type === 'parametric-eq' || type === 'parametric_eq') {
		let output = input;
		const bands = Array.isArray(params.bands) ? params.bands.slice(0, 4) : [];
		for (const band of bands) output = connectBiquad(context, output, { ...band, type: band.type || 'peaking' }, nodes);
		return output;
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
	if (chunkFrames !== AUDIO_EDITOR_STORAGE_CHUNK_FRAMES) {
		throw new RangeError(`Long sources must use ${AUDIO_EDITOR_STORAGE_CHUNK_FRAMES}-frame immutable chunks.`);
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
	fromFrame,
	toFrame,
	contextStartTime,
	sampleRate,
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
		for (const clip of getTrackClips(track, clipsById)) {
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
				activeSources,
				allNodes,
				signal,
			}));
		}
	}

	const actualContextStartTime = streamed.length && deferStartUntilPrimed
		? Math.max(contextStartTime, (context.currentTime || 0) + 0.02)
		: contextStartTime;
	for (const plan of plans) {
		if (!plan.originalBuffer) continue;
		scheduleBufferPlan({
			...plan,
			context,
			contextStartTime: actualContextStartTime,
			fromFrame,
			sampleRate,
			reversedBuffers,
			activeSources,
			allNodes,
		});
	}
	for (const prepared of streamed) prepared.start(actualContextStartTime, fromFrame, sampleRate);
	if (totalChunkFrames && mode === 'offline') onProgress?.({ frames: totalChunkFrames, totalFrames: totalChunkFrames, progress: 1 });
	return { contextStartTime: actualContextStartTime, streamedClips: streamed.length };
}

function scheduleBufferPlan({
	context,
	contextStartTime,
	fromFrame,
	sampleRate,
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
	const startTime = contextStartTime + (plan.segmentStart - fromFrame) / sampleRate;
	setParam(source.playbackRate, plan.playbackRate, startTime);
	scheduleClipGain(chain.fadeInGain.gain, chain.fadeOutGain.gain, chain.clipGain.gain, plan.clip, plan.relativeStart, plan.segmentEnd - clipStart(plan.clip), plan.duration, startTime, sampleRate);
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
	...plan
}) {
	const requestedInputFrames = plan.segmentDuration * plan.playbackRate * plan.sourceSampleRate;
	const outputFrameCount = Math.round(plan.segmentDuration * context.sampleRate);
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
		start(contextStartTime, fromFrame, sampleRate) {
			const startTime = contextStartTime + (plan.segmentStart - fromFrame) / sampleRate;
			scheduleClipGain(chain.fadeInGain.gain, chain.fadeOutGain.gain, chain.clipGain.gain, plan.clip, plan.relativeStart, plan.segmentEnd - clipStart(plan.clip), plan.duration, startTime, sampleRate);
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
	scheduleClipGain(chain.fadeInGain.gain, chain.fadeOutGain.gain, chain.clipGain.gain, plan.clip, plan.relativeStart, plan.segmentEnd - clipStart(plan.clip), plan.duration, clipStartTime, sampleRate);
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

function scheduleClipGain(fadeInParam, fadeOutParam, clipGainParam, clip, segmentStart, segmentEnd, duration, startTime, sampleRate) {
	setParam(clipGainParam, Math.max(0, finite(clip.gain, 1)), startTime);
	const fadeIn = clampFrame(clip.fadeInFrames, 0, duration);
	const fadeOut = clampFrame(clip.fadeOutFrames, 0, duration);
	const fadeInAt = (frame) => fadeIn > 0 && frame < fadeIn ? Math.max(0, frame / fadeIn) : 1;
	const fadeOutAt = (frame) => fadeOut > 0 && frame > duration - fadeOut
		? Math.max(0, (duration - frame) / fadeOut)
		: 1;
	setParam(fadeInParam, fadeInAt(segmentStart), startTime);
	if (fadeIn > 0 && segmentStart < fadeIn) {
		const fadeInEnd = Math.min(segmentEnd, fadeIn);
		linearRamp(fadeInParam, fadeInAt(fadeInEnd), startTime + (fadeInEnd - segmentStart) / sampleRate);
	}
	setParam(fadeOutParam, fadeOutAt(segmentStart), startTime);
	const fadeOutStart = duration - fadeOut;
	if (fadeOut > 0 && segmentEnd > fadeOutStart) {
		if (fadeOutStart > segmentStart) {
			setParam(fadeOutParam, 1, startTime + (fadeOutStart - segmentStart) / sampleRate);
		}
		linearRamp(fadeOutParam, fadeOutAt(segmentEnd), startTime + (segmentEnd - segmentStart) / sampleRate);
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
		try { node.disconnect(); } catch { /* It may already be disconnected. */ }
	}
	graph.sources?.clear?.();
}

function longSourceError(message) {
	const error = new Error(message);
	error.code = 'LONG_SOURCE_RENDER_REQUIRED';
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

async function ensureProjectWorklets(context, project) {
	const needsDynamics = projectUsesDynamicsWorklet(project) && !dynamicsWorkletContexts.has(context);
	const needsAudacity = projectUsesAudacityWorklet(project) && !audacityWorkletContexts.has(context);
	if (!needsDynamics && !needsAudacity) return;
	if (!context?.audioWorklet?.addModule || typeof (globalThis.AudioWorkletNode || globalThis.window?.AudioWorkletNode) !== 'function') {
		throw new Error(needsAudacity
			? 'This browser cannot run Audacity real-time effects without bypassing them.'
			: 'This browser cannot run the limiter or gate without bypassing it.');
	}
	if (needsDynamics) {
		await context.audioWorklet.addModule(new URL('./dynamics-worklet.js', import.meta.url));
		dynamicsWorkletContexts.add(context);
	}
	if (needsAudacity) {
		await context.audioWorklet.addModule(await audacityWorkletModuleUrl());
		audacityWorkletContexts.add(context);
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

function projectUsesDynamicsWorklet(project) {
	const effects = [project?.master?.effects || [], ...(project?.tracks || []).map((track) => track.effects || [])].flat();
	return effects.some((effect) => effect?.enabled !== false && (effect?.type === 'limiter' || effect?.type === 'gate'));
}

function projectUsesAudacityWorklet(project) {
	const effects = [project?.master?.effects || [], ...(project?.tracks || []).map((track) => track.effects || [])].flat();
	return effects.some((effect) => effect?.enabled !== false && isAudacityLiveEffect(effect?.type));
}

function getOfflineAudioContextConstructor() {
	return globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext || globalThis.window?.OfflineAudioContext || globalThis.window?.webkitOfflineAudioContext;
}

function createRealtimeContext(factory, sampleRate) {
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

function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}

function createAbortError() {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted', 'AbortError')
		: Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}
