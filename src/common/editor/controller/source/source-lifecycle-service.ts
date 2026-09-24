/* SPDX-License-Identifier: AGPL-3.0-only */

import { raceAbortableRead } from '../../abort-race.ts';
import { localizedErrorMessage, publishLocalizedStatus } from '../../../i18n/presentation-message.ts';
import {
	createPreparedProjectSources,
	type PreparedProjectSourceEntry,
	type PreparedRequiredProjectSources,
} from './internal/prepared-project-sources.ts';
import { createSourceChunkProviderRegistration } from './internal/source-chunk-provider-registration.ts';
import { createWaveformPcmWindowRequester } from './internal/waveform-pcm-window-service.ts';
import type {
	ActivateStoredSourceOptions,
	SourceLifecycleLoadOptions,
	SourceLifecycleProject,
	SourceLifecycleServiceRuntime,
	SourceLifecycleSource,
	SourceLifecycleWaveformPeakRequest,
	SourceLifecycleWaveformPeakWindow,
} from './internal/source-lifecycle-types.d.ts';

export type {
	PreparedProjectSourceInputs,
	PreparedRequiredProjectSources,
} from './internal/prepared-project-sources.ts';
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
	SourceLifecycleWaveformPeakRequest,
	SourceLifecycleWaveformPeakWindow,
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
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES, activateVideoSource, allProjectClips,
		audioBufferChannels,
		clipWaveformPeakRequests = new Map<string, SourceLifecycleWaveformPeakRequest>(),
		clipWaveformPeakWindows = new Map<string, SourceLifecycleWaveformPeakWindow>(),
		clipWaveformPcmRequests, clipWaveformPcmWindows, copy,
		createStoredChunkProviderCandidate: buildStoredChunkProviderCandidate,
		engine, generateStoredWaveformPeaks, generateWaveformPeaks,
		legacyPeakCacheKey, peakCacheKey,
		readStoredAudioBuffer,
		setStatus, sourceAudioBufferBytes, sourceBuffers, sourceChunkProviders,
		sourcePcmBytes, sourcePeaks, state, store,
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

	const requestWaveformPcmWindow = createWaveformPcmWindowRequester(runtime, registerStoredChunkProvider);
	function clearWaveformPcmWindows() {
		for (const request of clipWaveformPeakRequests.values()) request.abort();
		clipWaveformPeakWindows.clear();
		clipWaveformPeakRequests.clear();
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
		for (const [cacheKey, window] of clipWaveformPeakWindows) {
			if (window.sourceId === sourceId) clipWaveformPeakWindows.delete(cacheKey);
		}
		for (const [cacheKey, request] of clipWaveformPeakRequests) {
			if (request.sourceId !== sourceId) continue;
			request.abort();
			clipWaveformPeakRequests.delete(cacheKey);
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
					await raceAbortableRead(() => activateVideoSource(source, { signal: options.signal }), options.signal);
					throwIfSourceLoadAborted(options.signal);
					continue;
				}
				// Maintained still, generator, and image bodies are resolved by the visual
				// service. Treating them as PCM made a valid visual-only project look
				// like it had missing local audio and incorrectly fenced video export.
				if (source.kind === 'still' || source.kind === 'generator' || source.kind === 'image') continue;
				const metadata = await raceAbortableRead(
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
					context ??= await raceAbortableRead(
						() => engine.getAudioContext?.({ resume: false }),
						options.signal,
					);
					throwIfSourceLoadAborted(options.signal);
					const buffer = await raceAbortableRead(
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
					context ??= await raceAbortableRead(
						() => engine.getAudioContext?.({ resume: false }),
						options.signal,
					);
					throwIfSourceLoadAborted(options.signal);
					const buffer = sourceBuffers.get(source.id) || await raceAbortableRead(
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
				publishLocalizedStatus(setStatus, `${source.name}: ${message}`, { key: 'ui.sourceStatus.loadFailed', parameters: { name: String(source.name), message: localizedErrorMessage(error) ?? message } }, 'error');
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
				const metadata = await raceAbortableRead(
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
				context ??= await raceAbortableRead(
					() => engine.getAudioContext?.({ resume: false }),
					options.signal,
				);
				throwIfSourceLoadAborted(options.signal);
				const buffer = await raceAbortableRead(
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

	async function activateStoredSource(source: SourceLifecycleSource, metadata: Metadata | null | undefined,
		options: ActivateStoredSourceOptions<Buffer> = {}): Promise<Peaks> {
		const { activateStoredSourceWithProgress } = await import('./internal/stored-source-activation.ts');
		return activateStoredSourceWithProgress({
			SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES, audioBufferChannels, copy, engine,
			generateStoredWaveformPeaks, generateWaveformPeaks, peakCacheKey, readStoredAudioBuffer,
			sourceBuffers, sourcePcmBytes, sourcePeaks, store, registerStoredChunkProvider, cacheSourceBuffer,
		}, source, metadata, options);
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
			await raceAbortableRead(() => activateVideoSource(source, { signal: options.signal }), options.signal);
			throwIfSourceLoadAborted(options.signal);
		}
		let context: unknown = null;
		for (const source of (snapshot?.sources || []).filter((candidate) => (
			candidate.kind !== 'video' && usedSourceIds.has(candidate.id)
		))) {
			const required = requiredSourceIds.has(source.id);
			if (required) {
				const metadata = await raceAbortableRead(
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
				context ??= await raceAbortableRead(
					() => engine.getAudioContext?.({ resume: false }),
					options.signal,
				);
				throwIfSourceLoadAborted(options.signal);
				const buffer = await raceAbortableRead(
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
				const metadata = await raceAbortableRead(
					() => store.getSourceMetadata(source.storageKey || source.id),
					options.signal,
				);
				throwIfSourceLoadAborted(options.signal);
				if (!metadata) continue;
				registerStoredChunkProvider(source, metadata);
			}
			if (sourceChunkProviders.has(source.id) || sourceBuffers.has(source.id)) continue;
			context ??= await raceAbortableRead(
				() => engine.getAudioContext?.({ resume: false }),
				options.signal,
			);
			throwIfSourceLoadAborted(options.signal);
			const buffer = await raceAbortableRead(
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
