/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createPreparedProjectSources,
	type PreparedProjectSourceEntry,
	type PreparedRequiredProjectSources,
} from '../import/prepared-project-sources.ts';
import { createSourceChunkProviderRegistration } from './internal/source-chunk-provider-registration.ts';
import { isRetiredSourceReadError } from './source-audio.ts';
import type {
	ActivateStoredSourceOptions,
	SourceLifecycleClip,
	SourceLifecycleLoadOptions,
	SourceLifecycleProject,
	SourceLifecycleServiceRuntime,
	SourceLifecycleSource,
	SourceLifecycleWaveformPcmRequest,
	SourceLifecycleWaveformPcmWindow,
} from './internal/source-lifecycle-types.d.ts';
import {
	requireWaveformSourceFrameCount, resolveWaveformPcmWindowRequest, type WaveformPcmWindowRequest,
} from './internal/waveform-pcm-window-request.ts';
import {
	audioWarpSourceWindowRange,
	type AudioWarpRuntimeClip,
	type AudioWarpRuntimeProject,
} from '../../audio-warp-runtime.ts';

export type {
	PreparedProjectSourceInputs,
	PreparedRequiredProjectSources,
} from '../import/prepared-project-sources.ts';
export type {
	ActivateStoredSourceOptions,
	SourceLifecycleAudioBuffer,
	SourceLifecycleBufferCache,
	SourceLifecycleClip,
	SourceLifecycleCopy,
	SourceLifecycleEngine,
	SourceLifecycleLoadOptions,
	SourceLifecycleMetadata,
	SourceLifecycleProject,
	SourceLifecycleServiceRuntime,
	SourceLifecycleSource,
	SourceLifecycleState,
	SourceLifecycleStore,
	SourceLifecycleWaveformPcmRequest,
	SourceLifecycleWaveformPcmWindow,
} from './internal/source-lifecycle-types.d.ts';

function throwIfSourceLoadAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason;
}

function hasWaveformPeakLevels<Value>(
	value: Value | null | undefined,
): value is Value & Readonly<{ levels: unknown }> {
	return typeof value === 'object' && value !== null && 'levels' in value
		&& Boolean((value as Readonly<{ levels?: unknown }>).levels);
}

function isAudioWarpRuntimeProject(
	project: SourceLifecycleProject,
): project is SourceLifecycleProject & AudioWarpRuntimeProject {
	const tempoMap = project.tempoMap;
	return Number.isSafeInteger(project.sampleRate) && Number(project.sampleRate) > 0
		&& typeof tempoMap === 'object' && tempoMap !== null
		&& 'events' in tempoMap && Array.isArray(tempoMap.events) && tempoMap.events.length > 0;
}

function isAudioWarpRuntimeClip(
	clip: SourceLifecycleClip,
): clip is SourceLifecycleClip & AudioWarpRuntimeClip {
	return clip.kind === 'audio'
		&& Number.isSafeInteger(clip.timelineStartFrame) && Number(clip.timelineStartFrame) >= 0
		&& Number.isSafeInteger(clip.durationFrames) && Number(clip.durationFrames) > 0
		&& Number.isSafeInteger(clip.sourceStartFrame) && Number(clip.sourceStartFrame) >= 0
		&& Number.isSafeInteger(clip.sourceDurationFrames) && Number(clip.sourceDurationFrames) > 0;
}

function awaitSourceLoadOperation<Value>(
	operation: () => PromiseLike<Value> | Value,
	signal?: AbortSignal,
): Promise<Value> {
	if (!signal) return Promise.resolve().then(operation);
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<Value>((resolve, reject) => {
		let settled = false;
		const finish = (complete: () => void): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			complete();
		};
		const onAbort = (): void => finish(() => reject(signal.reason));
		signal.addEventListener('abort', onAbort, { once: true });
		if (signal.aborted) {
			onAbort();
			return;
		}
		let result: PromiseLike<Value> | Value;
		try {
			result = operation();
		} catch (error) {
			finish(() => reject(error));
			return;
		}
		void Promise.resolve(result).then(
			(value) => finish(() => resolve(value)),
			(error: unknown) => finish(() => reject(error)),
		);
	});
}

import {
	assertRequiredSourceBuffer,
	assertRequiredSourceMetadata,
	requiredAudioSourceIdSet,
	requiredVideoSourceIdSet,
	sourceIdSet,
} from './internal/required-source-admission.ts';

export function createSourceLifecycleService<
	Buffer,
	Project extends SourceLifecycleProject = SourceLifecycleProject,
	Provider = unknown,
	Peaks = unknown,
	Metadata = unknown,
>(runtime: SourceLifecycleServiceRuntime<Buffer, Project, Provider, Peaks, Metadata>) {
	const {
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES, MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES,
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES, activateVideoSource, allProjectClips,
		audioBufferChannels, clipSourceWindowRange, clipWaveformPcmRequests,
		clipWaveformPcmWindows, copy,
		createStoredChunkProviderCandidate: buildStoredChunkProviderCandidate,
		engine, findClip,
		findSource, generateStoredWaveformPeaks, generateWaveformPeaks, getProject,
		legacyPeakCacheKey, peakCacheKey,
		publishDocumentSnapshot, readStoredAudioBuffer, readWaveformPcmWindow,
		setStatus, sourceAudioBufferBytes, sourceBuffers, sourceChunkProviders,
		sourcePcmBytes, sourcePeaks, state, store, waveformPcmWindowContains,
		waveformPeaksHaveRms,
	} = runtime;

	const {
		createStoredChunkProviderCandidate, forgetChunkProvider,
		registerStoredChunkProvider, retireSourceChunkProvider,
	} = createSourceChunkProviderRegistration({
		createStoredChunkProviderCandidate: buildStoredChunkProviderCandidate,
		engine,
		sourceChunkProviders,
	});

	function cacheSourceBuffer(sourceId: string, buffer: Buffer) {
		if (!buffer || sourceAudioBufferBytes(buffer) > SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES) {
			sourceBuffers.delete(sourceId);
			return false;
		}
		if (sourceBuffers.setIfFits(sourceId, buffer)) return true;
		sourceBuffers.delete(sourceId);
		return false;
	}

	async function requestWaveformPcmWindow(
		clipId: string,
		options: WaveformPcmWindowRequest = {},
	): Promise<SourceLifecycleWaveformPcmWindow | null> {
		const projectAtStart = getProject();
		if (!projectAtStart) return null;
		const clip = findClip(projectAtStart, clipId);
		const source = clip ? findSource(projectAtStart, clip.sourceId) : null;
		if (!clip || !source || source.kind === 'video' || source.kind === 'image' || sourceBuffers.has(source.id)) return null;
		const cacheKey = String(clip.id);
		const requestedRange = resolveWaveformPcmWindowRequest(options, clip.durationFrames);
		if (!requestedRange) return null;
		const { startFrame, endFrame } = requestedRange;
		const sourceFrameCount = requireWaveformSourceFrameCount(source.frameCount);
		let range;
		if (clip.warpMap == null) {
			range = clipSourceWindowRange(clip, startFrame, endFrame, sourceFrameCount);
		} else {
			if (!isAudioWarpRuntimeProject(projectAtStart) || !isAudioWarpRuntimeClip(clip)) {
				throw new TypeError('A warped waveform window requires valid project and audio clip timing.');
			}
			range = audioWarpSourceWindowRange(
				projectAtStart,
				clip,
				{
					startFrame,
					endFrame,
					sourceFrameCount,
				},
			);
		}
		if (range.endFrame - range.startFrame > MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES) return null;
		const cached = clipWaveformPcmWindows.get(cacheKey);
		if (cached && waveformPcmWindowContains(cached, range)) {
			clipWaveformPcmWindows.delete(cacheKey);
			clipWaveformPcmWindows.set(cacheKey, cached);
			return cached;
		}
		const pending = clipWaveformPcmRequests.get(cacheKey);
		if (pending && waveformPcmWindowContains(pending, range)) return pending.promise;

		let provider: Provider | null | undefined = sourceChunkProviders.get(source.id);
		if (!provider) {
			const metadata = await store.getSourceMetadata(source.storageKey || source.id);
			if (getProject() !== projectAtStart) return null;
			provider = registerStoredChunkProvider(source, metadata);
		}
		if (!provider || getProject() !== projectAtStart) return null;
		const request: SourceLifecycleWaveformPcmRequest = {
			sourceId: source.id,
			startFrame: range.startFrame,
			endFrame: range.endFrame,
			promise: Promise.resolve(readWaveformPcmWindow(provider, range)).then((channels) => {
				if (clipWaveformPcmRequests.get(cacheKey) !== request) return null;
				clipWaveformPcmRequests.delete(cacheKey);
				const currentProject = getProject();
				if (!currentProject || currentProject !== projectAtStart || !findSource(currentProject, source.id)) return null;
				const window: SourceLifecycleWaveformPcmWindow = Object.freeze({
					clipId: cacheKey,
					sourceId: source.id,
					startFrame: range.startFrame,
					endFrame: range.endFrame,
					channels: Object.freeze(channels),
				});
				clipWaveformPcmWindows.delete(cacheKey);
				clipWaveformPcmWindows.set(cacheKey, window);
				while (clipWaveformPcmWindows.size > MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES) {
					const oldestKey = clipWaveformPcmWindows.keys().next().value;
					if (oldestKey === undefined) break;
					clipWaveformPcmWindows.delete(oldestKey);
				}
				publishDocumentSnapshot();
				return window;
			}).catch((error: unknown) => {
				if (clipWaveformPcmRequests.get(cacheKey) === request) clipWaveformPcmRequests.delete(cacheKey);
				// A window is a speculative cache fill. Losing its provider to routine
				// retirement is not a fault the user can act on, and reporting it put a
				// generic error over an export that was still running fine.
				if (isRetiredSourceReadError(error)) return null;
				throw error;
			}),
		};
		clipWaveformPcmRequests.set(cacheKey, request);
		return request.promise;
	}

	function clearWaveformPcmWindows() {
		clipWaveformPcmWindows.clear();
		clipWaveformPcmRequests.clear();
	}

	async function invalidateSourceRuntime(sourceId: string): Promise<void> {
		sourceBuffers.delete(sourceId);
		sourcePeaks.delete(sourceId);
		for (const [cacheKey, window] of clipWaveformPcmWindows) {
			if (window?.sourceId === sourceId) clipWaveformPcmWindows.delete(cacheKey);
		}
		for (const [cacheKey, request] of clipWaveformPcmRequests) {
			if (request?.sourceId === sourceId) clipWaveformPcmRequests.delete(cacheKey);
		}
		await store.deleteAnalysis?.(peakCacheKey(sourceId));
	}

	async function loadProjectSources(project: Project, options: SourceLifecycleLoadOptions = {}) {
		const requiredSourceIds = requiredAudioSourceIdSet(project, options);
		const requiredVideoSourceIds = requiredVideoSourceIdSet(project, options);
		const excludedSourceIds = sourceIdSet(options.excludedAudioSourceIds ?? [], 'excluded audio source');
		const usedSourceIds = options.onlyRequiredAudioSources
			? new Set<string>()
			: new Set<string>(allProjectClips(project).map((clip) => clip.sourceId));
		for (const sourceId of excludedSourceIds) usedSourceIds.delete(sourceId);
		for (const sourceId of requiredSourceIds) usedSourceIds.add(sourceId);
		for (const sourceId of requiredVideoSourceIds) usedSourceIds.add(sourceId);
		const transientBuffers = new Map<string, Buffer>();
		if (!usedSourceIds.size) return transientBuffers;
		throwIfSourceLoadAborted(options.signal);
		let context: unknown = null;
		for (const source of project.sources.filter((candidate) => usedSourceIds.has(candidate.id))) {
			const required = requiredSourceIds.has(source.id) || requiredVideoSourceIds.has(source.id);
			try {
				if (source.kind === 'video') {
					await awaitSourceLoadOperation(() => activateVideoSource(source, { signal: options.signal }), options.signal);
					throwIfSourceLoadAborted(options.signal);
					continue;
				}
				// Maintained still, generator, and image bodies are resolved by the visual
				// service. Treating them as PCM made a valid visual-only project look
				// like it had missing local audio and incorrectly fenced video export.
				if (source.kind === 'still' || source.kind === 'generator' || source.kind === 'image') continue;
				const metadata = await awaitSourceLoadOperation(
					() => store.getSourceMetadata(source.storageKey || source.id),
					options.signal,
				);
				throwIfSourceLoadAborted(options.signal);
				if (required) assertRequiredSourceMetadata(source, metadata);
				const requiresChunkStream = sourcePcmBytes(source) > SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES;
				if (required) {
					if (requiresChunkStream) {
						if (!registerStoredChunkProvider(source, metadata)) {
							if (!options.onlyRequiredAudioSources) {
								forgetChunkProvider(source.id);
								sourceBuffers.delete(source.id);
							}
							throw new Error(`Required rendered fallback source ${source.id} has no playable chunk provider.`);
						}
						sourceBuffers.delete(source.id);
						continue;
					}
					context ??= await awaitSourceLoadOperation(
						() => engine.getAudioContext?.({ resume: false }),
						options.signal,
					);
					throwIfSourceLoadAborted(options.signal);
					const buffer = await awaitSourceLoadOperation(
						() => readStoredAudioBuffer(store, source, context),
						options.signal,
					);
					throwIfSourceLoadAborted(options.signal);
					if (buffer == null) throw new Error(`Required rendered fallback source ${source.id} is unavailable.`);
					assertRequiredSourceBuffer(source, buffer);
					forgetChunkProvider(source.id);
					sourceBuffers.delete(source.id);
					if (!cacheSourceBuffer(source.id, buffer)) transientBuffers.set(source.id, buffer);
					continue;
				}
				const chunkProvider = registerStoredChunkProvider(source, metadata);
				const useChunkStream = Boolean(chunkProvider) && requiresChunkStream;
				let peaks = await store.loadAnalysis(peakCacheKey(source.id));
				if (useChunkStream) {
					sourceBuffers.delete(source.id);
					if (!waveformPeaksHaveRms(peaks, source)) {
						peaks = await generateStoredWaveformPeaks(store, source, copy);
						await store.saveAnalysis(peakCacheKey(source.id), peaks);
					}
				} else {
					context ??= await awaitSourceLoadOperation(
						() => engine.getAudioContext?.({ resume: false }),
						options.signal,
					);
					throwIfSourceLoadAborted(options.signal);
					const buffer = sourceBuffers.get(source.id) || await awaitSourceLoadOperation(
						() => readStoredAudioBuffer(store, source, context),
						options.signal,
					);
					throwIfSourceLoadAborted(options.signal);
					if (!buffer) continue;
					cacheSourceBuffer(source.id, buffer);
					if (!waveformPeaksHaveRms(peaks, source)) {
						peaks = await generateWaveformPeaks(audioBufferChannels(buffer), copy);
						await store.saveAnalysis(peakCacheKey(source.id), peaks);
					}
				}
				await Promise.resolve(store.deleteAnalysis?.(legacyPeakCacheKey(source.id))).catch(() => undefined);
				if (hasWaveformPeakLevels(peaks)) sourcePeaks.set(source.id, peaks);
			} catch (error) {
				throwIfSourceLoadAborted(options.signal);
				if (options.onlyRequiredAudioSources) throw error;
				state.missingSourceIds.add(source.id);
				const message = (error as Readonly<{ message?: string }> | null)?.message || String(error);
				setStatus(`${source.name}: ${message}`, 'error');
				if (required) throw error;
			}
		}
		return transientBuffers;
	}

	async function prepareRequiredProjectSources(
		project: Project,
		options: SourceLifecycleLoadOptions,
	): Promise<PreparedRequiredProjectSources<Buffer, Provider>> {
		const requiredSourceIds = requiredAudioSourceIdSet(project, options);
		const prepared = new Map<string, PreparedProjectSourceEntry<Buffer, Provider>>();
		const ownership = createPreparedProjectSources({
			prepared,
			signal: options.signal,
			sourceBuffers,
			sourceChunkProviders,
			cacheSourceBuffer,
			throwIfAborted: throwIfSourceLoadAborted,
		});
		throwIfSourceLoadAborted(options.signal);
		let context: unknown = null;
		try {
			for (const source of project.sources.filter((candidate) => requiredSourceIds.has(candidate.id))) {
				const metadata = await awaitSourceLoadOperation(
					() => store.getSourceMetadata(source.storageKey || source.id),
					options.signal,
				);
				throwIfSourceLoadAborted(options.signal);
				assertRequiredSourceMetadata(source, metadata);
				if (sourcePcmBytes(source) > SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES) {
					const provider = createStoredChunkProviderCandidate(source, metadata);
					if (!provider) {
						throw new Error(`Required rendered fallback source ${source.id} has no playable chunk provider.`);
					}
					prepared.set(source.id, Object.freeze({ kind: 'provider', value: provider }));
					continue;
				}
				context ??= await awaitSourceLoadOperation(
					() => engine.getAudioContext?.({ resume: false }),
					options.signal,
				);
				throwIfSourceLoadAborted(options.signal);
				const buffer = await awaitSourceLoadOperation(
					() => readStoredAudioBuffer(store, source, context),
					options.signal,
				);
				throwIfSourceLoadAborted(options.signal);
				if (buffer == null) throw new Error(`Required rendered fallback source ${source.id} is unavailable.`);
				assertRequiredSourceBuffer(source, buffer);
				prepared.set(source.id, Object.freeze({ kind: 'buffer', value: buffer }));
			}
		} catch (error) {
			try {
				await ownership.discard();
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'Required source preparation and cleanup both failed.',
					{ cause: error },
				);
			}
			throw error;
		}
		return ownership;
	}

	async function activateStoredSource(source: SourceLifecycleSource, metadata: Metadata | null | undefined, {
		buffer = null, requireChunkStream = false,
	}: ActivateStoredSourceOptions<Buffer> = {}): Promise<Peaks> {
		const provider = registerStoredChunkProvider(source, metadata);
		if (requireChunkStream && !provider) {
			throw new Error(`Source ${source.id} requires a playable chunk provider.`);
		}
		let peakBuffer = buffer;
		if (provider && (requireChunkStream
			|| sourcePcmBytes(source) > SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES)) {
			sourceBuffers.delete(source.id);
		} else {
			peakBuffer ||= await readStoredAudioBuffer(store, source, await engine.getAudioContext?.({ resume: false }));
			if (peakBuffer) cacheSourceBuffer(source.id, peakBuffer);
		}
		const peaks = peakBuffer
			? await generateWaveformPeaks(audioBufferChannels(peakBuffer), copy)
			: await generateStoredWaveformPeaks(store, source, copy);
		sourcePeaks.set(source.id, peaks);
		await store.saveAnalysis(peakCacheKey(source.id), peaks);
		return peaks;
	}

	async function ensureProjectSourcesAvailable(
		snapshot: Project,
		options: SourceLifecycleLoadOptions = {},
	) {
		const requiredSourceIds = requiredAudioSourceIdSet(snapshot, options);
		const requiredVideoSourceIds = requiredVideoSourceIdSet(snapshot, options);
		const excludedAudioSourceIds = sourceIdSet(options.excludedAudioSourceIds ?? [], 'excluded audio source');
		const usedSourceIds = new Set((snapshot?.clips || [])
			.filter((clip) => clip.kind !== 'video')
			.map((clip) => clip.sourceId));
		for (const sourceId of excludedAudioSourceIds) usedSourceIds.delete(sourceId);
		for (const sourceId of requiredSourceIds) usedSourceIds.add(sourceId);
		const transientBuffers = new Map<string, Buffer>();
		throwIfSourceLoadAborted(options.signal);
		for (const source of (snapshot?.sources || []).filter((candidate) => (
			requiredVideoSourceIds.has(candidate.id)
		))) {
			await awaitSourceLoadOperation(() => activateVideoSource(source, { signal: options.signal }), options.signal);
			throwIfSourceLoadAborted(options.signal);
		}
		let context: unknown = null;
		for (const source of (snapshot?.sources || []).filter((candidate) => (
			candidate.kind !== 'video' && usedSourceIds.has(candidate.id)
		))) {
			const required = requiredSourceIds.has(source.id);
			if (required) {
				const metadata = await awaitSourceLoadOperation(
					() => store.getSourceMetadata(source.storageKey || source.id),
					options.signal,
				);
				throwIfSourceLoadAborted(options.signal);
				assertRequiredSourceMetadata(source, metadata);
				const useChunkStream = sourcePcmBytes(source) > SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES;
				if (useChunkStream) {
					if (!registerStoredChunkProvider(source, metadata)) {
						throw new Error(`Required rendered fallback source ${source.id} has no playable chunk provider.`);
					}
					sourceBuffers.delete(source.id);
					continue;
				}
				context ??= await awaitSourceLoadOperation(
					() => engine.getAudioContext?.({ resume: false }),
					options.signal,
				);
				throwIfSourceLoadAborted(options.signal);
				const buffer = await awaitSourceLoadOperation(
					() => readStoredAudioBuffer(store, source, context),
					options.signal,
				);
				throwIfSourceLoadAborted(options.signal);
				if (buffer == null) throw new Error(`Required rendered fallback source ${source.id} is unavailable.`);
				assertRequiredSourceBuffer(source, buffer);
				forgetChunkProvider(source.id);
				sourceBuffers.delete(source.id);
				if (!cacheSourceBuffer(source.id, buffer)) transientBuffers.set(source.id, buffer);
				continue;
			}
			if (!sourceChunkProviders.has(source.id)) {
				const metadata = await awaitSourceLoadOperation(
					() => store.getSourceMetadata(source.storageKey || source.id),
					options.signal,
				);
				throwIfSourceLoadAborted(options.signal);
				if (!metadata) continue;
				registerStoredChunkProvider(source, metadata);
			}
			if (sourceChunkProviders.has(source.id) || sourceBuffers.has(source.id)) continue;
			context ??= await awaitSourceLoadOperation(
				() => engine.getAudioContext?.({ resume: false }),
				options.signal,
			);
			throwIfSourceLoadAborted(options.signal);
			const buffer = await awaitSourceLoadOperation(
				() => readStoredAudioBuffer(store, source, context),
				options.signal,
			);
			throwIfSourceLoadAborted(options.signal);
			if (!buffer) continue;
			if (!cacheSourceBuffer(source.id, buffer)) transientBuffers.set(source.id, buffer);
		}
		return transientBuffers;
	}

	return Object.freeze({
		activateStoredSource,
		cacheSourceBuffer,
		clearWaveformPcmWindows,
		ensureProjectSourcesAvailable,
		invalidateSourceRuntime,
		loadProjectSources,
		prepareRequiredProjectSources,
		registerStoredChunkProvider,
		retireSourceChunkProvider,
		requestWaveformPcmWindow,
	});
}
