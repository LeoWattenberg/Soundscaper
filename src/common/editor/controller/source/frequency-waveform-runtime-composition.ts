/* SPDX-License-Identifier: AGPL-3.0-only */

import { findClip, findSource } from '../../project.js';
import type { FrequencyWaveformStore } from '../../frequency-waveform-worker-client.ts';
import { audioBufferChannels } from './source-audio.ts';
import type {
	createFrequencyWaveformSourceService,
	FrequencyWaveformRequestOptions,
	FrequencyWaveformRuntimeEntry,
	FrequencyWaveformSourceServiceDependencies,
} from './frequency-waveform-source-service.ts';
import type {
	createFrequencyWaveformWindowService,
	FrequencyWaveformRuntimeWindowEntry,
	FrequencyWaveformWindowRequestOptions,
	FrequencyWaveformWindowServiceDependencies,
} from './frequency-waveform-window-service.ts';
import type { SourceRuntimeProject } from './source-runtime-composition-types.ts';

const FREQUENCY_WAVEFORM_CACHE_PREFIX = 'audio-editor-frequency-waveform-v1:';

type FrequencyWaveformService = ReturnType<
	typeof createFrequencyWaveformSourceService<SourceRuntimeProject, AudioBuffer>
>;
type FrequencyWaveformWindowService = ReturnType<
	typeof createFrequencyWaveformWindowService<SourceRuntimeProject>
>;
type FrequencyWaveformRuntimeRequestOptions = FrequencyWaveformRequestOptions
	& FrequencyWaveformWindowRequestOptions;

export interface FrequencyWaveformRuntimeInputs {
	readonly getProject: () => SourceRuntimeProject | null;
	readonly publishDocumentSnapshot: () => void;
	readonly sourceBuffers: FrequencyWaveformSourceServiceDependencies<SourceRuntimeProject, AudioBuffer>['sourceBuffers'];
	readonly sourceFrequencyAnalyses: Map<string, FrequencyWaveformRuntimeEntry>;
	readonly sourceFrequencyWindows: Map<string, FrequencyWaveformRuntimeWindowEntry>;
	readonly persistentCacheBypassSourceIds: Set<string>;
	readonly store: FrequencyWaveformSourceServiceDependencies<SourceRuntimeProject, AudioBuffer>['store']
		& FrequencyWaveformStore;
	readonly requestPcmWindow: FrequencyWaveformWindowServiceDependencies<SourceRuntimeProject>['requestPcmWindow'];
}

/** Create optional spectral services only after a track requests a frequency mode. */
export function createFrequencyWaveformRuntime(inputs: FrequencyWaveformRuntimeInputs) {
	const dependencies = inputs;
	const { sourceBuffers, sourceFrequencyAnalyses, sourceFrequencyWindows, store } = inputs;
	const persistentFrequencyWaveformCacheBypass = inputs.persistentCacheBypassSourceIds;
	let frequencyWaveformRuntimeGeneration = 0;
	let frequencyWaveformService: FrequencyWaveformService | null = null;
	let frequencyWaveformServicePromise: Promise<FrequencyWaveformService> | null = null;
	let frequencyWaveformWindowService: FrequencyWaveformWindowService | null = null;
	let frequencyWaveformWindowServicePromise: Promise<FrequencyWaveformWindowService> | null = null;
	const loadFrequencyWaveformService = (): Promise<FrequencyWaveformService> => {
		if (frequencyWaveformService) return Promise.resolve(frequencyWaveformService);
		if (frequencyWaveformServicePromise) return frequencyWaveformServicePromise;
		const promise = import('./frequency-waveform-source-service.ts')
			.then(({ createFrequencyWaveformSourceService }) => {
				frequencyWaveformService = createFrequencyWaveformSourceService<SourceRuntimeProject, AudioBuffer>({
					findClip,
					findSource,
					getProject: dependencies.getProject,
					sourceBuffers,
					sourceFrequencyAnalyses,
					persistentCacheBypassSourceIds: persistentFrequencyWaveformCacheBypass,
					store,
					generateFromBuffer: async (buffer, source, crossovers, signal) => {
						const { generateFrequencyWaveformAnalysisInWorker } = await import(
							'../../frequency-waveform-worker-client.ts'
						);
						return generateFrequencyWaveformAnalysisInWorker(
							audioBufferChannels(buffer),
							source.sampleRate,
							{ crossovers, signal },
						);
					},
					generateFromStore: async (_analysisStore, source, crossovers, signal) => {
						const { generateStoredFrequencyWaveformAnalysis } = await import(
							'../../frequency-waveform-worker-client.ts'
						);
						return generateStoredFrequencyWaveformAnalysis(store, source, { crossovers, signal });
					},
					publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
				});
				return frequencyWaveformService;
			}).catch((error: unknown) => {
				if (frequencyWaveformServicePromise === promise) frequencyWaveformServicePromise = null;
				throw error;
			});
		frequencyWaveformServicePromise = promise;
		return promise;
	};
	const loadFrequencyWaveformWindowService = (): Promise<FrequencyWaveformWindowService> => {
		if (frequencyWaveformWindowService) return Promise.resolve(frequencyWaveformWindowService);
		if (frequencyWaveformWindowServicePromise) return frequencyWaveformWindowServicePromise;
		const promise = import('./frequency-waveform-window-service.ts')
			.then(({ createFrequencyWaveformWindowService }) => {
				frequencyWaveformWindowService = createFrequencyWaveformWindowService<SourceRuntimeProject>({
					findClip,
					findSource,
					getProject: dependencies.getProject,
					sourceFrequencyWindows,
					requestPcmWindow: inputs.requestPcmWindow,
					generateWindow: async (channels, sampleRate, options) => {
						const { generateFrequencyWaveformWindowInWorker } = await import(
							'../../frequency-waveform-worker-client.ts'
						);
						return generateFrequencyWaveformWindowInWorker(channels, sampleRate, options);
					},
					publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
				});
				return frequencyWaveformWindowService;
			}).catch((error: unknown) => {
				if (frequencyWaveformWindowServicePromise === promise) {
					frequencyWaveformWindowServicePromise = null;
				}
				throw error;
			});
		frequencyWaveformWindowServicePromise = promise;
		return promise;
	};
	const frequencyWaveforms = Object.freeze({
		requestFrequencyWaveform: async (
			clipId: string,
			options: FrequencyWaveformRuntimeRequestOptions = {},
		) => {
			const generation = frequencyWaveformRuntimeGeneration;
			try {
				const requestsWindow = options.startFrame !== undefined || options.endFrame !== undefined;
				if (!requestsWindow) {
					const service = await loadFrequencyWaveformService();
					if (generation !== frequencyWaveformRuntimeGeneration) return null;
					return service.requestFrequencyWaveform(clipId, options);
				}
				const windowService = await loadFrequencyWaveformWindowService();
				if (generation !== frequencyWaveformRuntimeGeneration) return null;
				const window = await windowService.requestFrequencyWaveformWindow(clipId, options);
				if (window || generation !== frequencyWaveformRuntimeGeneration) return window;
				const sourceService = await loadFrequencyWaveformService();
				if (generation !== frequencyWaveformRuntimeGeneration) return null;
				return sourceService.requestFrequencyWaveform(clipId, options);
			} catch {
				return null;
			}
		},
		invalidateSource: async (sourceId: string): Promise<void> => {
			const removedAnalysis = sourceFrequencyAnalyses.delete(sourceId);
			let removedWindow = false;
			for (const [clipId, entry] of sourceFrequencyWindows) {
				if (entry.sourceId !== sourceId) continue;
				sourceFrequencyWindows.delete(clipId);
				removedWindow = true;
			}
			if (removedAnalysis || removedWindow) dependencies.publishDocumentSnapshot();
			const deletePersistedAnalysis = async (): Promise<void> => {
				persistentFrequencyWaveformCacheBypass.add(sourceId);
				if (!store.deleteAnalysis) return;
				await store.deleteAnalysis(`${FREQUENCY_WAVEFORM_CACHE_PREFIX}${sourceId}`);
				persistentFrequencyWaveformCacheBypass.delete(sourceId);
			};
			const residentWindowService = frequencyWaveformWindowService;
			const residentAnalysisService = frequencyWaveformService;
			const windowInvalidation = residentWindowService
				? Promise.resolve().then(() => residentWindowService.invalidateSource(sourceId))
				: frequencyWaveformWindowServicePromise
					? frequencyWaveformWindowServicePromise.then((service) => service.invalidateSource(sourceId))
					: Promise.resolve();
			const analysisInvalidation = residentAnalysisService
				? Promise.resolve().then(() => residentAnalysisService.invalidateSource(sourceId))
				: frequencyWaveformServicePromise
					? frequencyWaveformServicePromise.then((service) => service.invalidateSource(sourceId))
					: deletePersistedAnalysis();
			const [analysisResult] = await Promise.allSettled([
				analysisInvalidation,
				windowInvalidation,
			]);
			if (analysisResult.status === 'rejected') {
				await deletePersistedAnalysis().catch(() => undefined);
			}
		},
		clearRuntime: (): void => {
			frequencyWaveformRuntimeGeneration += 1;
			sourceFrequencyAnalyses.clear();
			sourceFrequencyWindows.clear();
			frequencyWaveformService?.clearRuntime();
			frequencyWaveformWindowService?.clearRuntime();
		},
	});
	return frequencyWaveforms;
}
