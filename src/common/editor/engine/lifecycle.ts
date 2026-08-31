/* SPDX-License-Identifier: AGPL-3.0-only */

import { ChunkStreamClient } from '../chunk-stream-client.js';
import { createChunkStreamAudioNode } from '../chunk-stream-worklet-node.js';
import { createAudioWarpRenderPathStatus } from '../audio-warp-runtime.ts';
import {
	clearPreparedAudioWarpPlayback,
} from './audio-warp-fallback.ts';
import {
	getProjectDurationFrames,
	getProjectTimelineDurationFrames,
	normalizeLoop,
} from './buffer-math.ts';
import {
	normalizeChunkSource,
	normalizeSourceResolver,
} from './clip-schedule-plan.ts';
import {
	configureMasterLoudnessMeterChannelCount,
	configureNativeSurroundDestination,
} from '../surround-monitoring.ts';
import {
	inheritTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from '../track-folder-media-runtime.ts';
import { resolveRuntimeProjectProjection } from '../runtime-clip-projection.ts';
import {
	ENGINE_ASSERT_ACTIVE,
	ENGINE_CANCEL_SCRUB,
	ENGINE_DISPOSE_RESOURCES,
	ENGINE_EMIT_POSITION,
	ENGINE_GET_CONTEXT,
	ENGINE_HALT_GRAPH,
	ENGINE_SET_STATE,
} from './runtime-symbols.ts';
import type {
	EngineOfflineContextFactory,
	EngineRealtimeContextFactory,
	EngineRuntimeMethodMap,
	EngineRuntimeHost,
	EngineSoftwareRenderer,
} from './runtime-types.ts';
import type { EngineAudioContext, EngineMeterSnapshot } from './public-api.ts';


export class AudioEditorEngineDisposedError extends Error {
	readonly code = 'ENGINE_DISPOSED';

	constructor() {
		super('The audio editor engine has been disposed.');
		this.name = 'AudioEditorEngineDisposedError';
	}
}

export interface EngineRuntimeOptions {
	readonly audioContextFactory?: EngineRealtimeContextFactory | null;
	readonly offlineAudioContextFactory?: EngineOfflineContextFactory | null;
	readonly softwareRenderer?: EngineSoftwareRenderer | null;
	readonly audioWarpRealtimeAcceleration?: boolean;
	readonly sourceResolver?: unknown;
	readonly chunkStreamClient?: EngineRuntimeHost['chunkStreamClient'];
	readonly chunkStreamClientFactory?: EngineRuntimeHost['chunkStreamClientFactory'];
	readonly chunkAudioNodeFactory?: EngineRuntimeHost['chunkAudioNodeFactory'];
	readonly onPosition?: ((frame: number, durationFrames: number) => void) | null;
	readonly onMeter?: ((meter: EngineMeterSnapshot) => void) | null;
	readonly onState?: ((state: string) => void) | null;
	readonly onParametricEqError?: ((error: unknown) => void) | null;
	readonly meterInterval?: unknown;
	readonly monotonicNow?: (() => number) | null;
}

const DEFAULT_METER_INTERVAL = 50;

export function initializeEngineRuntime(
	engine: EngineRuntimeHost,
	{
		audioContextFactory,
		offlineAudioContextFactory,
		softwareRenderer,
		audioWarpRealtimeAcceleration,
		sourceResolver,
		chunkStreamClient,
		chunkStreamClientFactory,
		chunkAudioNodeFactory,
		onPosition,
		onMeter,
		onState,
		onParametricEqError,
		meterInterval = DEFAULT_METER_INTERVAL,
		monotonicNow = null,
	}: EngineRuntimeOptions = {},
): void {
	engine.audioContextFactory = audioContextFactory === undefined
		? getAudioContextConstructor()
		: audioContextFactory;
	engine.offlineAudioContextFactory = offlineAudioContextFactory === undefined
		? getOfflineAudioContextConstructor()
		: offlineAudioContextFactory;
	engine.softwareRenderer = softwareRenderer || null;
	engine.audioWarpRealtimeAcceleration = audioWarpRealtimeAcceleration
		?? hasNativeAudioWarpAcceleration(engine.audioContextFactory);
	engine.sourceResolver = normalizeSourceResolver(sourceResolver);
	engine.chunkStreamClient = chunkStreamClient || null;
	engine.chunkStreamClientFactory = chunkStreamClientFactory || (() => new ChunkStreamClient());
	engine.chunkAudioNodeFactory = chunkAudioNodeFactory || createChunkStreamAudioNode;
	engine.project = null;
	engine.sources = new Map();
	engine.chunkSources = new Map();
	engine.context = null;
	engine.preferredOutputDeviceId = '';
	engine.activeOutputDeviceId = '';
	engine.outputDeviceError = null;
	engine.outputDeviceGeneration = 0;
	engine.positionFrame = 0;
	engine.playbackStartFrame = 0;
	engine.playbackStartTime = 0;
	engine.durationFrames = 0;
	engine.playbackDurationFrames = 0;
	engine.playEndFrame = 0;
	engine.loopScheduleTime = 0;
	engine.playbackRate = 1;
	engine.playbackMode = 'normal';
	engine.preparedSpeedPlayback = null;
	engine.preparedAudioWarpPlayback = null;
	engine.audioWarpPlaybackPreparation = null;
	engine.state = 'empty';
	engine.loop = { enabled: false, startFrame: 0, endFrame: 0 };
	engine.graph = null;
	engine.ticker = null;
	engine.scrubTimer = null;
	engine.scrubNextAt = 0;
	engine.scrubGeneration = 0;
	engine.scrubbing = false;
	engine.meterInterval = Math.max(16, Number(meterInterval) || DEFAULT_METER_INTERVAL);
	// The scrub audition frame is a wall-clock throttle, so a caller that needs to observe it
	// deterministically supplies its own monotonic clock instead of racing `performance.now()`.
	engine.monotonicNow = typeof monotonicNow === 'function' ? monotonicNow : null;
	engine.reversedBuffers = new WeakMap();
	engine.positionListeners = new Set(onPosition ? [onPosition] : []);
	engine.meterListeners = new Set(onMeter ? [onMeter] : []);
	engine.stateListeners = new Set(onState ? [onState] : []);
	engine.parametricEqErrorListeners = new Set(onParametricEqError ? [onParametricEqError] : []);
	engine.masterLoudnessMeter = null;
	engine.masterLoudnessMeterChannelCount = null;
	engine.masterLoudnessMeterPromise = null;
	engine.masterLoudnessMeterError = null;
	engine.latestMasterLoudnessMeter = null;
	engine.loudnessMeasurementManuallyPaused = false;
	engine.disposed = false;
	engine.disposePromise = null;
	engine.lifecycleGeneration = 0;
}

interface EngineAudioGlobal {
	readonly AudioContext?: EngineRealtimeContextFactory;
	readonly webkitAudioContext?: EngineRealtimeContextFactory;
	readonly OfflineAudioContext?: EngineOfflineContextFactory;
	readonly webkitOfflineAudioContext?: EngineOfflineContextFactory;
	readonly AudioBufferSourceNode?: Readonly<{ readonly prototype?: object }>;
	readonly window?: EngineAudioGlobal;
}

function hasNativeAudioWarpAcceleration(factory: EngineRealtimeContextFactory | null): boolean {
	if (!factory) return false;
	const browser = globalThis as unknown as EngineAudioGlobal;
	const Constructor = browser.AudioBufferSourceNode ?? browser.window?.AudioBufferSourceNode;
	return Boolean(Constructor?.prototype && 'playbackRate' in Constructor.prototype);
}

export function getAudioContextConstructor(): EngineRealtimeContextFactory | null {
	const browser = globalThis as unknown as EngineAudioGlobal;
	return browser.AudioContext || browser.webkitAudioContext
		|| browser.window?.AudioContext || browser.window?.webkitAudioContext || null;
}

function normalizeOutputDeviceId(deviceId: unknown): string {
	if (deviceId == null || deviceId === 'default') return '';
	if (typeof deviceId !== 'string') throw new TypeError('An audio output device ID must be a string.');
	return deviceId;
}

function outputDeviceError(name: string, message: string): Error | DOMException {
	if (typeof globalThis.DOMException === 'function') return new DOMException(message, name);
	const error = new Error(message);
	error.name = name;
	return error;
}

function getOfflineAudioContextConstructor(): EngineOfflineContextFactory | null {
	const browser = globalThis as unknown as EngineAudioGlobal;
	return browser.OfflineAudioContext || browser.webkitOfflineAudioContext
		|| browser.window?.OfflineAudioContext || browser.window?.webkitOfflineAudioContext || null;
}

export function createRealtimeContext(factory: EngineRealtimeContextFactory, sampleRate?: number): EngineAudioContext {
	const Constructor = factory as new(options?: AudioContextOptions) => EngineAudioContext;
	const create = factory as (options?: AudioContextOptions) => EngineAudioContext;
	if (sampleRate == null) {
		try { return new Constructor(); } catch { return create(); }
	}
	try { return new Constructor({ sampleRate }); } catch {
		return create({ sampleRate });
	}
}

export function createOfflineContext(
	factory: EngineOfflineContextFactory,
	channels: number,
	length: number,
	sampleRate: number,
): OfflineAudioContext {
	const LegacyConstructor = factory as new(
		numberOfChannels: number,
		length: number,
		sampleRate: number,
	) => OfflineAudioContext;
	const OptionsConstructor = factory as new(options: {
		numberOfChannels: number;
		length: number;
		sampleRate: number;
	}) => OfflineAudioContext;
	const create = factory as (options: {
		numberOfChannels: number;
		length: number;
		sampleRate: number;
	}) => OfflineAudioContext;
	try { return new LegacyConstructor(channels, length, sampleRate); } catch {
		try {
			return new OptionsConstructor({ numberOfChannels: channels, length, sampleRate });
		} catch {
			return create({ numberOfChannels: channels, length, sampleRate });
		}
	}
}

export const engineLifecycleMethods = {
loadProject(project, sourceBuffers = new Map(), options = {}) {
		this[ENGINE_ASSERT_ACTIVE]();
		this[ENGINE_CANCEL_SCRUB]();
		this[ENGINE_HALT_GRAPH]();
		const mediaProject = project ? projectTrackFolderMediaStateV12(project) : project;
		const resolvedProject = mediaProject?.schemaVersion
			? resolveRuntimeProjectProjection(mediaProject)
			: mediaProject;
		const runtimeProject = mediaProject && resolvedProject
			? inheritTrackFolderMediaStateProjectionV12(mediaProject, resolvedProject)
			: resolvedProject;
		this.project = runtimeProject || null;
		if (this.context && runtimeProject) {
			configureNativeSurroundDestination(this.context.destination, Number(runtimeProject.masterChannels) || 2);
		}
		const meterChannelCount = this.context && runtimeProject
			? configureMasterLoudnessMeterChannelCount(this.context.destination, runtimeProject.masterChannels)
			: null;
		if (this.masterLoudnessMeterChannelCount !== meterChannelCount) {
			this.masterLoudnessMeter?.dispose();
			this.masterLoudnessMeter = null;
			this.masterLoudnessMeterChannelCount = null;
			this.masterLoudnessMeterPromise = null;
			this.masterLoudnessMeterError = null;
		}
		this.sources = sourceBuffers instanceof Map ? new Map(sourceBuffers) : new Map(Object.entries(sourceBuffers || {}));
		if (options.chunkSources !== undefined) this.setChunkSources(options.chunkSources);
		this.durationFrames = getProjectDurationFrames(runtimeProject);
		this.playbackDurationFrames = getProjectTimelineDurationFrames(runtimeProject);
		this.playbackRate = 1;
		this.playbackMode = 'normal';
		this.preparedSpeedPlayback = null;
		clearPreparedAudioWarpPlayback(this);
		this.positionFrame = Math.min(this.positionFrame, this.playbackDurationFrames);
		this.playEndFrame = this.playbackDurationFrames;
		this.loop = normalizeLoop(runtimeProject?.loop, this.durationFrames);
		this.loudnessMeasurementManuallyPaused = false;
		this.masterLoudnessMeter?.setRunning(false);
		this.masterLoudnessMeter?.reset();
		this.latestMasterLoudnessMeter = null;
		this[ENGINE_SET_STATE](runtimeProject ? 'stopped' : 'empty');
		this[ENGINE_EMIT_POSITION]();
		return this;
	},

applyProject(this: EngineRuntimeHost, project, sourceBuffers = this.sources, options = {}) {
		const wasPlaying = this.state === 'playing';
		const position = this.getPositionFrames();
		const playbackRate = this.playbackRate;
		const playbackMode = this.playbackMode;
		this.loadProject(project, sourceBuffers, options);
		this.positionFrame = Math.min(position, this.playbackDurationFrames);
		if (wasPlaying && playbackMode === 'naive') return this.playAtSpeed(playbackRate);
		// A StaffPad mix belongs to the exact project snapshot that produced it.
		// Stop instead of silently resuming that stale PCM or falling back to 1x.
		if (wasPlaying && playbackMode !== 'staffpad') return this.play();
		this[ENGINE_EMIT_POSITION]();
		return Promise.resolve();
	},

setSourceResolver(sourceResolver = null) {
		this[ENGINE_ASSERT_ACTIVE]();
		this.sourceResolver = normalizeSourceResolver(sourceResolver);
		clearPreparedAudioWarpPlayback(this);
		return this;
	},

setChunkSources(chunkSources = new Map()) {
		this[ENGINE_ASSERT_ACTIVE]();
		const entries = chunkSources instanceof Map ? chunkSources : new Map(Object.entries(chunkSources || {}));
		this.chunkSources = new Map([...entries].map(([sourceId, source]) => [String(sourceId), normalizeChunkSource(source)]));
		clearPreparedAudioWarpPlayback(this);
		return this;
	},

getAudioWarpRenderStatus() {
		this[ENGINE_ASSERT_ACTIVE]();
		return createAudioWarpRenderPathStatus({
			realtimeAcceleration: this.audioWarpRealtimeAcceleration,
			exactOfflineAvailable: this.offlineAudioContextFactory !== null
				|| this.softwareRenderer !== null,
		});
	},

async decodeAudioData(data) {
		const context = await this.getAudioContext({ resume: false });
		if (!context?.decodeAudioData) throw new Error('This AudioContext cannot decode audio.');
		const arrayBuffer = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
		return context.decodeAudioData(arrayBuffer);
	},

async getAudioContext({ resume = true } = {}) {
		this[ENGINE_ASSERT_ACTIVE]();
		const context = await this[ENGINE_GET_CONTEXT]();
		this[ENGINE_ASSERT_ACTIVE]();
		if (resume) await context.resume?.();
		this[ENGINE_ASSERT_ACTIVE]();
		return context;
	},

async setOutputDevice(deviceId = '') {
		this[ENGINE_ASSERT_ACTIVE]();
		const normalized = normalizeOutputDeviceId(deviceId);
		const generation = ++this.outputDeviceGeneration;
		const context = this.context;
		if (!context) {
			this.preferredOutputDeviceId = normalized;
			this.outputDeviceError = null;
			return this.getOutputDeviceState();
		}
		if (typeof context.setSinkId !== 'function') {
			if (normalized) throw outputDeviceError('NotSupportedError', 'Audio output selection is not supported by this browser.');
			this.preferredOutputDeviceId = '';
			this.activeOutputDeviceId = '';
			this.outputDeviceError = null;
			return this.getOutputDeviceState();
		}
		const previousPreferred = this.preferredOutputDeviceId;
		const previousActive = this.activeOutputDeviceId;
		try {
			await context.setSinkId(normalized);
			this[ENGINE_ASSERT_ACTIVE]();
			if (context !== this.context || generation !== this.outputDeviceGeneration) {
				return this.getOutputDeviceState();
			}
			this.preferredOutputDeviceId = normalized;
			this.activeOutputDeviceId = normalized;
			this.outputDeviceError = null;
			return this.getOutputDeviceState();
		} catch (error) {
			if (context === this.context && generation === this.outputDeviceGeneration) {
				this.preferredOutputDeviceId = previousPreferred;
				this.activeOutputDeviceId = previousActive;
				this.outputDeviceError = error;
			}
			throw error;
		}
	},

getOutputDeviceState() {
		return Object.freeze({
			preferredDeviceId: this.preferredOutputDeviceId,
			activeDeviceId: this.activeOutputDeviceId,
			supported: this.context
				? typeof this.context.setSinkId === 'function'
				: typeof this.audioContextFactory?.prototype?.setSinkId === 'function',
			error: this.outputDeviceError,
		});
	},

dispose() {
		if (this.disposePromise) return this.disposePromise;
		this.disposed = true;
		this.lifecycleGeneration += 1;
		this.state = 'disposed';
		this.disposePromise = this[ENGINE_DISPOSE_RESOURCES]();
		return this.disposePromise;
	},

async [ENGINE_DISPOSE_RESOURCES]() {
		this[ENGINE_CANCEL_SCRUB]();
		this[ENGINE_HALT_GRAPH]();
		this.project = null;
		this.sources.clear();
		this.chunkSources.clear();
		this.positionListeners.clear();
		this.meterListeners.clear();
		this.stateListeners.clear();
		this.parametricEqErrorListeners.clear();
		this.reversedBuffers = new WeakMap();
		this.preparedSpeedPlayback = null;
		clearPreparedAudioWarpPlayback(this);
		this.masterLoudnessMeter?.dispose();
		this.masterLoudnessMeter = null;
		this.masterLoudnessMeterChannelCount = null;
		this.masterLoudnessMeterPromise = null;
		this.latestMasterLoudnessMeter = null;
		this.masterLoudnessMeterError = null;
		const context = this.context;
		this.context = null;
		if (context?.state !== 'closed') await context?.close?.();
		try {
			this.chunkStreamClient?.dispose?.();
		} finally {
			this.chunkStreamClient = null;
		}
	},

async [ENGINE_GET_CONTEXT]() {
		this[ENGINE_ASSERT_ACTIVE]();
		if (this.context) return this.context;
		if (!this.audioContextFactory) throw new Error('Web Audio is not supported in this browser.');
		const generation = this.lifecycleGeneration;
		const context = createRealtimeContext(this.audioContextFactory);
		if (this.disposed || generation !== this.lifecycleGeneration) {
			if (context?.state !== 'closed') await context?.close?.();
			throw new AudioEditorEngineDisposedError();
		}
		this.context = context;
		if (this.project) {
			configureNativeSurroundDestination(context.destination, Number(this.project.masterChannels) || 2);
		}
		const preferredOutputDeviceId = this.preferredOutputDeviceId;
		if (preferredOutputDeviceId) {
			const outputDeviceGeneration = this.outputDeviceGeneration;
			try {
				if (typeof context.setSinkId !== 'function') {
					throw outputDeviceError('NotSupportedError', 'Audio output selection is not supported by this browser.');
				}
				await context.setSinkId(preferredOutputDeviceId);
				this[ENGINE_ASSERT_ACTIVE]();
				if (context === this.context && outputDeviceGeneration === this.outputDeviceGeneration) {
					this.activeOutputDeviceId = preferredOutputDeviceId;
				}
			} catch (error) {
				if (this.disposed || generation !== this.lifecycleGeneration) {
					if (context?.state !== 'closed') await context?.close?.();
					throw new AudioEditorEngineDisposedError();
				}
				if (context === this.context && outputDeviceGeneration === this.outputDeviceGeneration) {
					this.outputDeviceError = error;
					this.activeOutputDeviceId = '';
					try { await context.setSinkId?.(''); } catch { /* The system output remains the browser fallback. */ }
				}
			}
		}
		this[ENGINE_ASSERT_ACTIVE]();
		return context;
	},

[ENGINE_ASSERT_ACTIVE]() {
		if (this.disposed) throw new AudioEditorEngineDisposedError();
	}
} satisfies EngineRuntimeMethodMap<
	| 'loadProject'
	| 'applyProject'
	| 'setSourceResolver'
	| 'setChunkSources'
	| 'getAudioWarpRenderStatus'
	| 'decodeAudioData'
	| 'getAudioContext'
	| 'setOutputDevice'
	| 'getOutputDeviceState'
	| 'dispose'
	| typeof ENGINE_DISPOSE_RESOURCES
	| typeof ENGINE_GET_CONTEXT
	| typeof ENGINE_ASSERT_ACTIVE
>;
