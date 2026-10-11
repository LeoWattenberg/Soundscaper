/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionscaperRevision, type MotionscaperRevision } from './motion-project-revision.ts';
import { normalizeMotionAudioFormat, type MotionAudioAsset, type MotionAudioFormat, type MotionAudioSampleProvider } from './motion-audio-contract.ts';
import { createPreparedMotionExpressionAudio, MotionExpressionAudioNeeded } from './motion-expression-audio-capability.ts';
import { analyzeMotionAmplitudeWindow } from './motion-expression-audio-window.ts';
import { createMotionAmplitudeNativeCache, createMotionAmplitudeNativeBudget, type MotionAmplitudeNativeBudget } from './motion-expression-audio-energy.ts';
import { createMotionExpressionBudget } from './motion-expression-evaluator.ts';
import type { MotionExpressionQueryOptions } from './motion-expression-runtime.ts';
import { motionLayerProperties } from './motion-project-graph.ts';
import type { MotionscaperProject } from './motion-project-types.ts';
import { motionInteger } from './motion-values.ts';

export interface MotionExpressionAudioPreparation {
	readonly revision: MotionscaperRevision;
	/** The callback evaluates synchronously. A missing amplitude window causes a bounded immutable replay. */
	evaluate<T>(query: (options: MotionExpressionQueryOptions) => T, signal?: AbortSignal, nativeBudget?: MotionAmplitudeNativeBudget): Promise<T>;
	snapshot(): Readonly<{ cacheEntries: number; cacheBytes: number; nativeCacheBytes: number; inFlight: boolean; disposed: boolean }>;
	dispose(): void;
}
export function createMotionExpressionAudioPreparation(options: Readonly<{
	project: unknown; provider: MotionAudioSampleProvider; maximumRequests?: number; maximumNativeSamples?: number; maximumCacheEntries?: number; maximumNativeCacheBytes?: number;
}>): MotionExpressionAudioPreparation {
	const revision = createMotionscaperRevision(options.project);
	const assets = new Map<string, MotionAudioAsset>(revision.project.assets.flatMap((asset) => asset.kind === 'audio' || asset.kind === 'footage' && asset.hasAudio ? [[asset.id, asset] as const] : []));
	const maximumRequests = motionInteger(options.maximumRequests ?? 32, 'amplitude request budget', 1, 128);
	const maximumSamples = motionInteger(options.maximumNativeSamples ?? 1_048_576, 'amplitude native sample budget', 1, 4_194_304);
	const maximumEntries = motionInteger(options.maximumCacheEntries ?? 128, 'amplitude cache entry budget', 1, 1024);
	const cache = new Map<string, { value: number; bytes: number }>(), formats = new Map<string, MotionAudioFormat>(); const disposal = new AbortController();
	const nativeCache = createMotionAmplitudeNativeCache(options.provider, options.maximumNativeCacheBytes);
	let cacheBytes = 0, inFlight = false, disposed = false;
	return Object.freeze({ revision, async evaluate<T>(query: (options: MotionExpressionQueryOptions) => T, externalSignal?: AbortSignal, nativeBudget?: MotionAmplitudeNativeBudget): Promise<T> {
		if (disposed) throw new Error('Motion audio amplitude preparation is disposed.'); if (inFlight) throw new Error('Only one motion amplitude query may be in flight.');
		const signal = externalSignal ? AbortSignal.any([externalSignal, disposal.signal]) : disposal.signal; signal.throwIfAborted(); inFlight = true;
		const expressionBudget = createMotionExpressionBudget({ maximumOperations: 1_000_000, signal }); const localWork = createMotionAmplitudeNativeBudget(maximumSamples);
		const work = { get remaining() { return Math.min(localWork.remaining, nativeBudget?.remaining ?? Infinity); }, consume(samples: number) {
			if (samples > Math.min(localWork.remaining, nativeBudget?.remaining ?? Infinity)) throw new RangeError('Audio amplitude native-sample analysis budget exceeded.');
			localWork.consume(samples); nativeBudget?.consume(samples);
		} };
		try {
			for (let requestCount = 0; ; requestCount++) {
				signal.throwIfAborted();
				try {
					const result = query({ preparedAudio: createPreparedMotionExpressionAudio(revision.digest, new Map([...cache].map(([key, entry]) => [key, entry.value]))), expressionBudget, signal });
					signal.throwIfAborted(); return result;
				} catch (error) {
					if (!(error instanceof MotionExpressionAudioNeeded)) throw error;
					if (requestCount >= maximumRequests) throw new RangeError('Audio amplitude preparation request budget exceeded.', { cause: error });
					const window = error.window, asset = assets.get(window.assetId);
					if (!asset || asset.sha256 !== window.assetDigest) throw new ReferenceError('Amplitude source is outside the pinned revision asset closure.', { cause: error });
					let format = formats.get(asset.id);
					if (!format) {
						format = normalizeMotionAudioFormat(await options.provider.describe(asset, signal)); signal.throwIfAborted();
						if (asset.kind === 'audio' && (asset.sampleRate !== format.sampleRate || asset.channels !== format.channels)) throw new RangeError('Amplitude PCM format does not match the retained audio descriptor.', { cause: error });
						if (formats.size >= 128) formats.delete(formats.keys().next().value!); formats.set(asset.id, format);
					}
					const value = await analyzeMotionAmplitudeWindow({ window, asset, format, cache: nativeCache, signal, work }); signal.throwIfAborted();
					const bytes = 128 + window.key.length * 2;
					while (cache.size >= maximumEntries || cacheBytes + bytes > 1024 * 1024) { const first = cache.keys().next().value!; cacheBytes -= cache.get(first)!.bytes; cache.delete(first); }
					cache.set(window.key, { value, bytes }); cacheBytes += bytes;
				}
			}
		} finally { inFlight = false; }
	}, snapshot: () => ({ cacheEntries: cache.size, cacheBytes, nativeCacheBytes: nativeCache.bytes, inFlight, disposed }),
	dispose() { if (!disposed) { disposed = true; disposal.abort(); cache.clear(); formats.clear(); nativeCache.clear(); cacheBytes = 0; } },
	});
}

/** Conservative lazy-resource hint; the parser and evaluator still decide which calls execute. */
export function motionProjectUsesAudioAmplitude(project: MotionscaperProject): boolean {
	return project.compositions.some((composition) => [...composition.layers, ...composition.audio].some((owner) => motionLayerProperties(owner).some(({ property }) => property.expression?.enabled && property.expression.source.includes('audioAmplitude'))));
}
