/* SPDX-License-Identifier: AGPL-3.0-only */
import type { EngineChunkReadContext, EngineChunkSource } from '../common/editor/engine/types.ts';
import { createMotionCompositionLinkAudioSource, type MotionCompositionLinkAudioOptions } from '../common/editor/motion-link-audio-rendering.ts';
import { motionInteger } from '../common/editor/motion-values.ts';
import { resolveFramescaperCompositionAudioSource } from './editor-composition-link-source.ts';
import { createFramescaperCompositionResources, type FramescaperCompositionAssetReader } from './editor-composition-link-resources.ts';

export interface FramescaperCompositionPcmSource extends EngineChunkSource {
	readStorageChunk(chunkIndex: number, context?: EngineChunkReadContext): Promise<readonly Float32Array[]>;
	dispose(): Promise<void>;
}
/** Engine trim, reverse, resampling and pitch policy consume these native source chunks unchanged. */
export function createFramescaperCompositionPcmSource(options: Readonly<{
	project: unknown; source: Readonly<{ id: string }>;
	readAsset?: FramescaperCompositionAssetReader;
	acquire?: MotionCompositionLinkAudioOptions['acquire'];
}>): FramescaperCompositionPcmSource | null {
	const linked = resolveFramescaperCompositionAudioSource(options.project, options.source);
	if (!linked) return null;
	const source = linked.audioSource!;
	const audio = createMotionCompositionLinkAudioSource(linked.offer, { acquire: options.acquire ?? createFramescaperCompositionResources(options.readAsset!).acquireAudio });
	let tail: Promise<unknown> = Promise.resolve(), pending = 0, disposed = false;
	let closing: Promise<void> | null = null; const lifetime = new AbortController();
	return Object.freeze({
		channelCount: source.channelCount, frameCount: source.frameCount, sampleRate: source.sampleRate, chunkFrames: source.chunkFrames,
		async readStorageChunk(chunkIndex: number, context?: EngineChunkReadContext): Promise<readonly Float32Array[]> {
			if (disposed) throw new Error('Composition PCM source is disposed.');
			const index = motionInteger(chunkIndex, 'composition PCM chunk index'); const start = index * source.chunkFrames;
			if (!Number.isSafeInteger(start) || start >= source.frameCount) throw new RangeError('Composition PCM chunk is outside its source extent.');
			if (pending >= 8) throw new Error('Composition PCM source queue is full.');
			const signal = context?.signal ? AbortSignal.any([context.signal, lifetime.signal]) : lifetime.signal;
			signal.throwIfAborted(); pending++;
			const operation = tail.then(async () => {
				signal.throwIfAborted(); const count = Math.min(source.chunkFrames, source.frameCount - start);
				const block = await audio.read({ sourceTime: { num: start, den: source.sampleRate }, sampleRate: source.sampleRate, sampleCount: count, channels: 2 }, signal);
				const left = new Float32Array(count), right = new Float32Array(count);
				for (let i = 0; i < count; i++) { left[i] = block.interleaved[i * 2]!; right[i] = block.interleaved[i * 2 + 1]!; }
				return Object.freeze([left, right]);
			});
			tail = operation.then(() => undefined, () => undefined).finally(() => { pending--; }); return operation;
		},
		dispose() {
			if (closing) return closing; disposed = true; lifetime.abort();
			closing = (async () => { await tail; await audio.dispose(); })(); return closing;
		},
	});
}
