/* SPDX-License-Identifier: AGPL-3.0-only */
import { canonicalJsonSha256 } from '../common/canonical-json-sha256.ts';
import { createAudioEditorEngine } from '../common/editor/engine/runtime-class.ts';
import { ClipTimePitchRenderCacheCoordinator, clipNeedsTimePitchRender } from '../common/editor/clip-time-pitch-cache.js';
import { createStoredChunkProvider, isStoredSourceMetadata, isStreamableStoredSource } from '../common/editor/controller/source/source-audio.ts';
import { renderProductNativeAudioToSink } from '../common/editor/controller/composition/internal/product-native-render-audio-stream.ts';
import type { ProductNativeRenderInputOperation } from '../common/editor/controller/composition/product-native-render-input-authority.ts';
import { MotionDeliveryCleanupFailure } from '../common/editor/motion-delivery-cleanup.ts';
import { createFramescaperCompositionPcmSource } from './editor-composition-link-pcm-source.ts';
import type { FramescaperSuccessorEnvironment } from './editor-project-successor-environment.ts';
import type { FramescaperSuccessorProject } from './editor-project-successor.ts';

type Provider = ReturnType<typeof createStoredChunkProvider> | NonNullable<ReturnType<typeof createFramescaperCompositionPcmSource>>;
type Stream = NonNullable<ProductNativeRenderInputOperation['renderAudioToSink']>;
/** A delivery owns its providers, StaffPad cache and engine independently of preview activation. */
export function createFramescaperSuccessorNativeAudioLease(environment: FramescaperSuccessorEnvironment, project: FramescaperSuccessorProject, signal: AbortSignal, assertCurrent: () => void, onReleased: () => void) {
	const projection = environment.playback.projectForPlayback(project).project;
	const providers = new Map<string, Provider>(), buffers = new Map<string, AudioBuffer>();
	const engine = createAudioEditorEngine();
	const cache = new ClipTimePitchRenderCacheCoordinator({ store: environment.store,
		async loadSourceChannels(source: { id: string; channelCount: number; frameCount: number }, context: { signal?: AbortSignal }) {
			const provider = providers.get(source.id); if (!provider) throw new Error('Pinned time/pitch original is unavailable.');
			const channels = Array.from({ length: source.channelCount }, () => new Float32Array(source.frameCount)); let offset = 0;
			for (let chunk = 0; offset < source.frameCount; chunk++) {
				context.signal?.throwIfAborted(); const value: unknown = await provider.readStorageChunk(chunk, context);
				if (!Array.isArray(value) || value.length !== channels.length || !value.every((channel: unknown) => channel instanceof Float32Array)) throw new Error('Pinned time/pitch PCM channels differ.');
				const block = value as Float32Array[]; const count = block[0]!.length;
				if (!count || count > source.frameCount - offset || block.some(channel => channel.length !== count)) throw new Error('Pinned time/pitch PCM extent differs.');
				for (const [index, channel] of block.entries()) channels[index]!.set(channel, offset); offset += count;
			}
			return channels;
		}, transferLoadedSourceChannels: true,
	});
	let prepared: Promise<void> | null = null, releasing: Promise<void> | null = null, released = false;
	let engineReleased = false, cacheReleased = false;
	async function prepare() {
		if (released) throw new Error('Pinned native audio inputs are closed.');
		prepared ??= (async () => {
			assertCurrent(); const required = new Set(project.clips.filter(clip => clip.kind === 'audio').map(clip => clip.sourceId));
			for (const source of project.sources.filter(source => required.has(source.id))) {
				assertCurrent(); const linked = createFramescaperCompositionPcmSource({ project, source, readAsset: asset => environment.owners.readAsset(asset) });
				if (linked) { providers.set(source.id, linked); continue; }
				const metadata: unknown = await environment.store.getSourceMetadata(source.storageKey || source.id); assertCurrent();
				if (!isStoredSourceMetadata(metadata) || !isStreamableStoredSource(source, metadata)) throw new Error(`Pinned native PCM original ${source.id} is unavailable.`);
				providers.set(source.id, createStoredChunkProvider(environment.store, source, metadata));
			}
			engine.setChunkSources(providers);
			for (const clip of project.clips) {
				if (clip.kind !== 'audio' || !clipNeedsTimePitchRender(clip)) continue;
				const source = project.sources.find(source => source.id === clip.sourceId); if (!source) throw new Error('Pinned time/pitch source is missing.');
				const entry = await cache.prepareCommittedOutput(clip, source, { signal }); assertCurrent();
				const channels: Float32Array[] = await cache.loadCommittedChannels(entry, { signal }); assertCurrent();
				const context = await engine.getAudioContext({ resume: false }); assertCurrent();
				const buffer = context.createBuffer(channels.length, channels[0]!.length, entry.sampleRate);
				for (const [index, channel] of channels.entries()) buffer.getChannelData(index).set(channel);
				cache.attachAudioBuffer(entry.cacheKey, buffer);
			}
			engine.setSourceResolver(cache.createEngineSourceResolver()); assertCurrent();
		})();
		return prepared;
	}
	async function release() {
		if (released) return; if (releasing) return releasing;
		releasing = (async () => {
			if (prepared) await prepared.catch(() => undefined);
			const errors: unknown[] = [];
			if (!engineReleased) { try { await engine.dispose(); engineReleased = true; } catch (error) { errors.push(error); } }
			if (!cacheReleased) { try { await cache.dispose(); cacheReleased = true; } catch (error) { errors.push(error); } }
			for (const [id, provider] of providers) { try { await provider.dispose(); providers.delete(id); } catch (error) { errors.push(error); } }
			if (errors.length) throw new MotionDeliveryCleanupFailure(errors, 'Pinned Frame native inputs still require cleanup.', release);
			buffers.clear(); released = true; onReleased();
		})();
		try { await releasing; } finally { releasing = null; }
	}
	const renderAudioToSink: Stream = async (renderProject, range, sink) => {
		if (canonicalJsonSha256(renderProject) !== canonicalJsonSha256(projection)) throw new Error('The native PCM request differs from its captured project.');
		await prepare(); assertCurrent();
		return renderProductNativeAudioToSink({ sourceBuffers: buffers, signal, assertCurrent,
			createRenderEngine: () => engine, prepareCommittedTimePitchCaches: async () => { await prepare(); },
		}, projection, range, sink);
	};
	return Object.freeze({ prepare, release, renderAudioToSink });
}
