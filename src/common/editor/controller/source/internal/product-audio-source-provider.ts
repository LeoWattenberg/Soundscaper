/* SPDX-License-Identifier: AGPL-3.0-only */
import type { SourceLifecycleProject, SourceLifecycleServiceRuntime, SourceLifecycleSource } from './source-lifecycle-types.d.ts';

/** A product supplies a pinned source lease before any encoded-storage authority is consulted. */
export async function resolveProductAudioChunkProvider<Project extends SourceLifecycleProject, Provider>(
	runtime: Pick<SourceLifecycleServiceRuntime<unknown, Project, Provider>, 'resolveProductAudioSource' | 'getProject'>,
	project: Project, source: SourceLifecycleSource, signal?: AbortSignal,
): Promise<Provider | null> {
	if (!runtime.resolveProductAudioSource) return null;
	const assertCurrent = () => { signal?.throwIfAborted(); if (runtime.getProject()?.id !== project.id) throw new Error('The product audio source project changed.'); };
	assertCurrent(); const provider = await runtime.resolveProductAudioSource({ project, source, signal, assertCurrent });
	if (provider === null) { assertCurrent(); return null; }
	try {
		assertCurrent();
		if (!provider || typeof provider !== 'object') throw new TypeError('A product PCM source requires a disposable chunk provider.');
		for (const field of ['channelCount', 'frameCount', 'sampleRate', 'chunkFrames'] as const) {
			const actual: unknown = Reflect.get(provider, field);
			if (!Number.isSafeInteger(actual) || Number(actual) < (field === 'frameCount' ? 0 : 1)
				|| (source[field] !== undefined && actual !== source[field])) throw new RangeError(`Product PCM geometry differs from its pinned source: ${field}.`);
		}
		if (typeof Reflect.get(provider, 'readStorageChunk') !== 'function' || typeof Reflect.get(provider, 'dispose') !== 'function') throw new TypeError('A product PCM source requires read and dispose capabilities.');
		return provider;
	} catch (error) {
		try { await dispose(provider); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Product audio acquisition and cleanup failed.', { cause: cleanup }); }
		throw error;
	}
}
async function dispose(provider: unknown): Promise<void> {
	if (provider && typeof provider === 'object') { const close: unknown = Reflect.get(provider, 'dispose'); if (typeof close === 'function') await Reflect.apply(close, provider, []) as unknown; }
}
