/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ActivateStoredSourceOptions, SourceLifecycleServiceRuntime, SourceLifecycleSource } from './source-lifecycle-types.d.ts';

type ActivationRuntime<Buffer, Provider, Peaks, Metadata> = Pick<
	SourceLifecycleServiceRuntime<Buffer, never, Provider, Peaks, Metadata>,
	'SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES' | 'audioBufferChannels' | 'copy' | 'engine'
	| 'generateStoredWaveformPeaks' | 'generateWaveformPeaks' | 'peakCacheKey'
	| 'readStoredAudioBuffer' | 'sourceBuffers' | 'sourcePcmBytes' | 'sourcePeaks' | 'store'
> & {
	readonly registerStoredChunkProvider: (source: SourceLifecycleSource, metadata: Metadata | null | undefined) => Provider | null;
	readonly cacheSourceBuffer: (sourceId: string, buffer: Buffer) => unknown;
};

/** Keeps long source activation cancellable while PCM and waveform storage remain bounded. */
export async function activateStoredSourceWithProgress<Buffer, Provider, Peaks, Metadata>(
	runtime: ActivationRuntime<Buffer, Provider, Peaks, Metadata>,
	source: SourceLifecycleSource,
	metadata: Metadata | null | undefined,
	options: ActivateStoredSourceOptions<Buffer>,
): Promise<Peaks> {
	const { signal, onProgress, requireChunkStream = false } = options;
	signal?.throwIfAborted();
	const provider = runtime.registerStoredChunkProvider(source, metadata);
	if (requireChunkStream && !provider) throw new Error(`Source ${source.id} requires a playable chunk provider.`);
	let peakBuffer: Buffer | null = options.buffer ?? null;
	if (provider && (requireChunkStream || runtime.sourcePcmBytes(source) > runtime.SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES)) {
		runtime.sourceBuffers.delete(source.id);
	} else {
		const context = peakBuffer ? null : await runtime.engine.getAudioContext!({ resume: false });
		signal?.throwIfAborted();
		peakBuffer ||= await runtime.readStoredAudioBuffer(runtime.store, source, context);
		signal?.throwIfAborted();
		if (peakBuffer) runtime.cacheSourceBuffer(source.id, peakBuffer);
	}
	const peaks = peakBuffer
		? await runtime.generateWaveformPeaks(runtime.audioBufferChannels(peakBuffer), runtime.copy)
		: await runtime.generateStoredWaveformPeaks(runtime.store, source, runtime.copy, {
			...(signal ? { signal } : {}), onProgress: (value) => { signal?.throwIfAborted(); onProgress?.(0.98 * value); },
		});
	signal?.throwIfAborted();
	const peakKey = runtime.peakCacheKey(source.id);
	try {
		await runtime.store.saveAnalysis(peakKey, peaks);
		signal?.throwIfAborted();
		runtime.sourcePeaks.set(source.id, peaks);
		onProgress?.(1);
		return peaks;
	} catch (error) {
		runtime.sourcePeaks.delete(source.id);
		try { await runtime.store.deleteAnalysis!(peakKey); }
		catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Source activation and waveform cleanup both failed.', { cause: cleanupError });
		}
		throw error;
	}
}
