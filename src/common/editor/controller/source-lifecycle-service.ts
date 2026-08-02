/* SPDX-License-Identifier: AGPL-3.0-only */

/* eslint-disable @typescript-eslint/no-explicit-any -- Explicit legacy ports keep this migration seam typo-safe while source records are narrowed. */

type LegacyPort = (...args: any[]) => any;

export interface SourceLifecycleServiceRuntime {
	readonly MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES: number;
	readonly MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES: number;
	readonly SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: number;
	readonly activateVideoSource: LegacyPort;
	readonly allProjectClips: LegacyPort;
	readonly audioBufferChannels: LegacyPort;
	readonly clipSourceWindowRange: LegacyPort;
	readonly clipWaveformPcmRequests: Map<string, any>;
	readonly clipWaveformPcmWindows: Map<string, any>;
	readonly copy: any;
	readonly createStoredChunkProvider: LegacyPort;
	readonly engine: any;
	readonly findClip: LegacyPort;
	readonly findSource: LegacyPort;
	readonly generateStoredWaveformPeaks: LegacyPort;
	readonly generateWaveformPeaks: LegacyPort;
	readonly getProject: LegacyPort;
	readonly isStreamableStoredSource: LegacyPort;
	readonly legacyPeakCacheKey: LegacyPort;
	readonly peakCacheKey: LegacyPort;
	readonly publishDocumentSnapshot: LegacyPort;
	readonly readStoredAudioBuffer: LegacyPort;
	readonly readWaveformPcmWindow: LegacyPort;
	readonly setStatus: LegacyPort;
	readonly sourceAudioBufferBytes: LegacyPort;
	readonly sourceBuffers: any;
	readonly sourceChunkProviders: Map<string, any>;
	readonly sourcePcmBytes: LegacyPort;
	readonly sourcePeaks: Map<string, any>;
	readonly state: any;
	readonly store: any;
	readonly waveformPcmWindowContains: LegacyPort;
	readonly waveformPeaksHaveRms: LegacyPort;
}

export interface SourceLifecycleLoadOptions {
	readonly excludedAudioSourceIds?: readonly string[];
	readonly onlyRequiredAudioSources?: boolean;
	readonly requiredAudioSourceIds?: readonly string[];
	readonly requiredVideoSourceIds?: readonly string[];
	readonly signal?: AbortSignal;
}

export interface PreparedProjectSourceInputs {
	readonly sourceBuffers: ReadonlyMap<string, unknown>;
	readonly chunkSources: ReadonlyMap<string, unknown>;
}

export interface PreparedRequiredProjectSources {
	commit<Result>(
		apply: (inputs: PreparedProjectSourceInputs) => PromiseLike<Result> | Result,
		options?: Readonly<{
			assertCurrent?: () => void;
			transientBuffers?: ReadonlyMap<string, unknown>;
		}>,
	): Promise<Result>;
	discard(): void;
}

function throwIfSourceLoadAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason;
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

export function createSourceLifecycleService(runtime: SourceLifecycleServiceRuntime) {
	const {
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES, MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES,
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES, activateVideoSource, allProjectClips,
		audioBufferChannels, clipSourceWindowRange, clipWaveformPcmRequests,
		clipWaveformPcmWindows, copy, createStoredChunkProvider, engine, findClip,
		findSource, generateStoredWaveformPeaks, generateWaveformPeaks, getProject,
		isStreamableStoredSource, legacyPeakCacheKey, peakCacheKey,
		publishDocumentSnapshot, readStoredAudioBuffer, readWaveformPcmWindow,
		setStatus, sourceAudioBufferBytes, sourceBuffers, sourceChunkProviders,
		sourcePcmBytes, sourcePeaks, state, store, waveformPcmWindowContains,
		waveformPeaksHaveRms,
	} = runtime;

	function cacheSourceBuffer(sourceId: string, buffer: any) {
		if (!buffer || sourceAudioBufferBytes(buffer) > SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES) {
			sourceBuffers.delete(sourceId);
			return false;
		}
		if (sourceBuffers.setIfFits(sourceId, buffer)) return true;
		sourceBuffers.delete(sourceId);
		return false;
	}

	async function requestWaveformPcmWindow(clipId: string, options: any = {}) {
		const projectAtStart = getProject();
		const clip = projectAtStart ? findClip(projectAtStart, clipId) : null;
		const source = clip ? findSource(projectAtStart, clip.sourceId) : null;
		if (!clip || !source || source.kind === 'video' || sourceBuffers.has(source.id)) return null;
		const cacheKey = String(clip.id);
		const startFrame = Math.max(0, Math.min(clip.durationFrames, Math.round(Number(options.startFrame) || 0)));
		const endFrame = Math.max(startFrame, Math.min(
			clip.durationFrames,
			Math.round(Number(options.endFrame) || clip.durationFrames),
		));
		if (endFrame <= startFrame) return null;
		const range = clipSourceWindowRange(clip, startFrame, endFrame, source.frameCount);
		if (range.endFrame - range.startFrame > MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES) return null;
		const cached = clipWaveformPcmWindows.get(cacheKey);
		if (waveformPcmWindowContains(cached, range)) {
			clipWaveformPcmWindows.delete(cacheKey);
			clipWaveformPcmWindows.set(cacheKey, cached);
			return cached;
		}
		const pending = clipWaveformPcmRequests.get(cacheKey);
		if (pending && waveformPcmWindowContains(pending, range)) return pending.promise;

		let provider = sourceChunkProviders.get(source.id);
		if (!provider) {
			const metadata = await store.getSourceMetadata(source.storageKey || source.id);
			if (getProject() !== projectAtStart) return null;
			provider = registerStoredChunkProvider(source, metadata);
		}
		if (!provider || getProject() !== projectAtStart) return null;
		const request: any = {
			startFrame: range.startFrame,
			endFrame: range.endFrame,
			promise: null,
		};
		request.promise = readWaveformPcmWindow(provider, range).then((channels: any) => {
			if (clipWaveformPcmRequests.get(cacheKey) !== request) return null;
			clipWaveformPcmRequests.delete(cacheKey);
			const currentProject = getProject();
			if (currentProject !== projectAtStart || !findSource(currentProject, source.id)) return null;
			const window = Object.freeze({
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
			throw error;
		});
		clipWaveformPcmRequests.set(cacheKey, request);
		return request.promise;
	}

	function clearWaveformPcmWindows() {
		clipWaveformPcmWindows.clear();
		clipWaveformPcmRequests.clear();
	}

	async function loadProjectSources(project: any, options: SourceLifecycleLoadOptions = {}) {
		const requiredSourceIds = requiredAudioSourceIdSet(project, options);
		const requiredVideoSourceIds = requiredVideoSourceIdSet(project, options);
		const excludedSourceIds = sourceIdSet(options.excludedAudioSourceIds ?? [], 'excluded audio source');
		const usedSourceIds = options.onlyRequiredAudioSources
			? new Set<string>()
			: new Set<string>(allProjectClips(project).map((clip: any) => clip.sourceId));
		for (const sourceId of excludedSourceIds) usedSourceIds.delete(sourceId);
		for (const sourceId of requiredSourceIds) usedSourceIds.add(sourceId);
		for (const sourceId of requiredVideoSourceIds) usedSourceIds.add(sourceId);
		const transientBuffers = new Map<string, any>();
		if (!usedSourceIds.size) return transientBuffers;
		throwIfSourceLoadAborted(options.signal);
		let context: any = null;
		for (const source of project.sources.filter((candidate: any) => usedSourceIds.has(candidate.id))) {
			const required = requiredSourceIds.has(source.id) || requiredVideoSourceIds.has(source.id);
			try {
				if (source.kind === 'video') {
					await awaitSourceLoadOperation(() => activateVideoSource(source, { signal: options.signal }), options.signal);
					throwIfSourceLoadAborted(options.signal);
					continue;
				}
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
				if (peaks?.levels) sourcePeaks.set(source.id, peaks);
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
		project: any,
		options: SourceLifecycleLoadOptions,
	): Promise<PreparedRequiredProjectSources> {
		const requiredSourceIds = requiredAudioSourceIdSet(project, options);
		const prepared = new Map<string, Readonly<{ kind: 'buffer' | 'provider'; value: any }>>();
		throwIfSourceLoadAborted(options.signal);
		let context: any = null;
		for (const source of project.sources.filter((candidate: any) => requiredSourceIds.has(candidate.id))) {
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
			assertRequiredSourceBuffer(source, buffer);
			prepared.set(source.id, Object.freeze({ kind: 'buffer', value: buffer }));
		}
		return createPreparedRequiredProjectSources(prepared, options.signal);
	}

	function createPreparedRequiredProjectSources(
		prepared: Map<string, Readonly<{ kind: 'buffer' | 'provider'; value: any }>>,
		signal?: AbortSignal,
	): PreparedRequiredProjectSources {
		let state: 'prepared' | 'committing' | 'committed' | 'discarded' = 'prepared';
		return Object.freeze({ commit, discard });

		async function commit<Result>(
			apply: (inputs: PreparedProjectSourceInputs) => PromiseLike<Result> | Result,
			options: Readonly<{
				assertCurrent?: () => void;
				transientBuffers?: ReadonlyMap<string, unknown>;
			}> = {},
		): Promise<Result> {
			if (state !== 'prepared') throw new Error(`The required source preparation is already ${state}.`);
			if (typeof apply !== 'function') throw new TypeError('Required source preparation commit needs an apply callback.');
			if (options.assertCurrent != null && typeof options.assertCurrent !== 'function') {
				throw new TypeError('Required source preparation currentness assertion must be a function.');
			}
			state = 'committing';
			try {
				throwIfSourceLoadAborted(signal);
				const preparedBuffers = new Map<string, unknown>(sourceBuffers);
				for (const [sourceId, buffer] of options.transientBuffers ?? []) {
					preparedBuffers.set(sourceId, buffer);
				}
				const preparedProviders = new Map<string, unknown>(sourceChunkProviders);
				for (const [sourceId, entry] of prepared) {
					preparedBuffers.delete(sourceId);
					preparedProviders.delete(sourceId);
					if (entry.kind === 'buffer') preparedBuffers.set(sourceId, entry.value);
					else preparedProviders.set(sourceId, entry.value);
				}
				const result = await apply(Object.freeze({
					sourceBuffers: preparedBuffers,
					chunkSources: preparedProviders,
				}));
				throwIfSourceLoadAborted(signal);
				options.assertCurrent?.();
				for (const [sourceId, entry] of prepared) {
					if (entry.kind === 'provider') {
						sourceChunkProviders.set(sourceId, entry.value);
						sourceBuffers.delete(sourceId);
						continue;
					}
					cacheSourceBuffer(sourceId, entry.value);
					sourceChunkProviders.delete(sourceId);
				}
				state = 'committed';
				prepared.clear();
				return result;
			} catch (error) {
				state = 'discarded';
				prepared.clear();
				throw error;
			}
		}

		function discard(): void {
			if (state !== 'prepared') return;
			state = 'discarded';
			prepared.clear();
		}
	}

	function createStoredChunkProviderCandidate(source: any, metadata: any) {
		if (typeof store.readSourceChunk !== 'function' || !isStreamableStoredSource(source, metadata)) return null;
		return createStoredChunkProvider(store, source, metadata);
	}

	function registerStoredChunkProvider(source: any, metadata: any) {
		const provider = createStoredChunkProviderCandidate(source, metadata);
		if (!provider) return null;
		sourceChunkProviders.set(source.id, provider);
		// Project application is intentionally asynchronous. Publish the provider
		// immediately so cache eviction cannot create a transient unplayable source.
		engine.setChunkSources?.(sourceChunkProviders);
		return provider;
	}

	function forgetChunkProvider(sourceId: string) {
		if (!sourceChunkProviders.delete(sourceId)) return;
		engine.setChunkSources?.(sourceChunkProviders);
	}

	async function activateStoredSource(source: any, metadata: any, { buffer = null }: any = {}) {
		const provider = registerStoredChunkProvider(source, metadata);
		let peakBuffer = buffer;
		if (provider && sourcePcmBytes(source) > SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES) {
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
		snapshot: any,
		options: SourceLifecycleLoadOptions = {},
	) {
		const requiredSourceIds = requiredAudioSourceIdSet(snapshot, options);
		const requiredVideoSourceIds = requiredVideoSourceIdSet(snapshot, options);
		const excludedAudioSourceIds = sourceIdSet(options.excludedAudioSourceIds ?? [], 'excluded audio source');
		const usedSourceIds = new Set((snapshot?.clips || [])
			.filter((clip: any) => clip.kind !== 'video')
			.map((clip: any) => clip.sourceId));
		for (const sourceId of excludedAudioSourceIds) usedSourceIds.delete(sourceId);
		for (const sourceId of requiredSourceIds) usedSourceIds.add(sourceId);
		const transientBuffers = new Map<string, any>();
		throwIfSourceLoadAborted(options.signal);
		for (const source of (snapshot?.sources || []).filter((candidate: any) => (
			requiredVideoSourceIds.has(candidate.id)
		))) {
			await awaitSourceLoadOperation(() => activateVideoSource(source, { signal: options.signal }), options.signal);
			throwIfSourceLoadAborted(options.signal);
		}
		let context: any = null;
		for (const source of (snapshot?.sources || []).filter((candidate: any) => (
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

	function requiredAudioSourceIdSet(project: any, options: SourceLifecycleLoadOptions) {
		if (!options || typeof options !== 'object' || Array.isArray(options)) {
			throw new TypeError('Source lifecycle load options must be an object.');
		}
		if (options.onlyRequiredAudioSources != null && typeof options.onlyRequiredAudioSources !== 'boolean') {
			throw new TypeError('Only-required-audio-sources must be a boolean.');
		}
		const ids = sourceIdSet(options.requiredAudioSourceIds ?? [], 'required audio source');
		if (!ids.size) return ids;
		const sources = Array.isArray(project?.sources) ? project.sources : [];
		for (const sourceId of ids) {
			const matches = sources.filter((source: any) => source?.id === sourceId);
			if (matches.length !== 1) {
				throw new Error(`Required rendered fallback source ${sourceId} is unavailable.`);
			}
			if (matches[0]?.kind !== 'audio') {
				throw new TypeError(`Required rendered fallback source ${sourceId} must be audio.`);
			}
		}
		return ids;
	}

	function requiredVideoSourceIdSet(project: any, options: SourceLifecycleLoadOptions) {
		const ids = sourceIdSet(options.requiredVideoSourceIds ?? [], 'required video source');
		if (!ids.size) return ids;
		const sources = Array.isArray(project?.sources) ? project.sources : [];
		for (const sourceId of ids) {
			const matches = sources.filter((source: any) => source?.id === sourceId);
			if (matches.length !== 1) {
				throw new Error(`Required rendered fallback source ${sourceId} is unavailable.`);
			}
			if (matches[0]?.kind !== 'video') {
				throw new TypeError(`Required rendered fallback source ${sourceId} must be video.`);
			}
		}
		return ids;
	}

	function sourceIdSet(values: readonly string[], label: string): Set<string> {
		if (!Array.isArray(values)) throw new TypeError(`${label} IDs must be an array.`);
		const ids = new Set<string>();
		for (const value of values) {
			if (typeof value !== 'string' || !value || value !== value.trim()) {
				throw new TypeError(`A ${label} ID must be a non-empty canonical string.`);
			}
			ids.add(value);
		}
		return ids;
	}

	function assertRequiredSourceMetadata(source: any, metadata: any) {
		if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
			throw new Error(`Required rendered fallback source ${source.id} has no stored metadata.`);
		}
		if ((metadata.frameCount ?? metadata.frameLength) !== source.frameCount
			|| metadata.channelCount !== source.channelCount
			|| (metadata.sampleRate != null && metadata.sampleRate !== source.sampleRate)) {
			throw new Error(`Required rendered fallback source ${source.id} metadata geometry changed.`);
		}
	}

	function assertRequiredSourceBuffer(source: any, buffer: any) {
		if (!buffer) throw new Error(`Required rendered fallback source ${source.id} is unavailable.`);
		if (buffer.length !== source.frameCount
			|| buffer.numberOfChannels !== source.channelCount
			|| buffer.sampleRate !== source.sampleRate) {
			throw new Error(`Required rendered fallback source ${source.id} buffer geometry changed.`);
		}
	}

	return Object.freeze({
		activateStoredSource,
		cacheSourceBuffer,
		clearWaveformPcmWindows,
		ensureProjectSourcesAvailable,
		loadProjectSources,
		prepareRequiredProjectSources,
		registerStoredChunkProvider,
		requestWaveformPcmWindow,
	});
}
