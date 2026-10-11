/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { extractScapeVideo } from '../common/editor/scape-archive-video.ts';
import { extractScapeAudio, scapeAudioSourceStream, verifyScapeExtractedAsset, type ScapeAudioSource } from '../common/editor/scape-archive-media.ts';
import type { ScapeAssetDescriptor } from '../common/editor/scape-archive-envelope.ts';
import type { ScapeProjectAssetExtensionImportRequest } from '../common/editor/scape-project-asset-extension.ts';
import type { ScapeAudioChunkBudget } from '../common/editor/scape-expanded-byte-budget.ts';
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { digestMediaContent, canonicalMediaContentBlob } from '../common/editor/storage/media-content-digest.ts';
import { aggregateScapeErrors } from '../common/editor/scape-abort.ts';

export type SuccessorHydrationStore = Omit<AudioEditorProjectStore, 'loadMediaAsset'> & { loadMediaAsset(id: string, options?: { signal?: AbortSignal }): Promise<Blob | null> };
type Request = Omit<ScapeProjectAssetExtensionImportRequest, 'store'> & { readonly store: SuccessorHydrationStore };
export function successorHydrationStore(media: AudioEditorProjectStore): SuccessorHydrationStore {
	const read = async (id: string, options?: { signal?: AbortSignal }) => { const body = await media.loadMediaAsset(id, options); return body === null ? null : canonicalMediaContentBlob(body); };
	return new Proxy(media, { get(target, key) { if (key === 'loadMediaAsset') return read; const value: unknown = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } }) as SuccessorHydrationStore;
}
export async function hydrateFramescaperSuccessorMediaBody(storageKey: string, metadata: Readonly<Record<string, unknown>>, asset: ScapeAssetDescriptor, request: Request): Promise<void> {
	const { store, signal, transaction } = request; signal?.throwIfAborted();
	const existing = await store.getMediaAssetMetadata(storageKey);
	if (existing) {
		if (existing.sha256 !== asset.sha256 || existing.size !== asset.size) throw new RangeError(`Successor retained media identity conflicts: ${storageKey}.`);
		const body = await store.loadMediaAsset(storageKey, { signal }); if (!body) throw new Error(`Successor retained media is unavailable: ${storageKey}.`);
		const digest = await digestMediaContent(body, { signal }); if (digest !== asset.sha256 || body.size !== asset.size) throw new RangeError(`Successor retained media bytes conflict: ${storageKey}.`);
		return;
	}
	const writer = await store.beginMediaAssetWrite(storageKey, metadata, { expectedBytes: asset.size, expectedSha256: asset.sha256, signal });
	if (!writer.commitOwned) { await writer.abort(); throw new TypeError('Successor hydration requires an owned media writer.'); }
	let tracked = false;
	try {
		const extracted = await extractScapeVideo(request.entryByName.get(asset.entry)!, writer, signal, request.expandedByteBudget);
		verifyScapeExtractedAsset(asset, extracted.digest, extracted.size, storageKey);
		const publication = await writer.commitOwned({ signal }); transaction.trackProvisionalMedia(publication); tracked = true;
		signal?.throwIfAborted();
		if (publication.metadata.sha256 !== asset.sha256 || publication.metadata.size !== asset.size) throw new Error('Successor media publication changed content.');
	} catch (error) {
		if (!tracked) { try { await writer.abort(); } catch (cleanup) { throw aggregateScapeErrors(error, [cleanup], 'Successor media restoration and cleanup failed.'); } }
		throw error;
	}
}

export async function hydrateFramescaperSuccessorAudioBody(source: Readonly<Record<string, unknown>>, asset: ScapeAssetDescriptor, request: Request, budget: ScapeAudioChunkBudget): Promise<void> {
	const { store, signal, transaction } = request; const id = String(source.storageKey); signal?.throwIfAborted();
	if (asset.encoding !== 'audio-f32le-chunks-v1') throw new RangeError('Successor hydration requires portable PCM custody.');
	const existing = await store.getSourceMetadata(id);
	if (existing) {
		for (const key of ['sampleRate', 'channelCount', 'frameCount', 'chunkFrames']) if (existing[key] !== source[key]) throw new RangeError(`Successor retained PCM descriptor conflicts: ${id}.`);
		const digest = sha256.create(); let size = 0;
		await scapeAudioSourceStream(store, source as unknown as ScapeAudioSource, digest, count => { size += count; }, signal, budget).pipeTo(new WritableStream({ write() {} }), { signal });
		verifyScapeExtractedAsset(asset, bytesToHex(digest.digest()), size, id); return;
	}
	const writer = await store.beginSourceWrite(id, { name: source.name, mimeType: source.mimeType, sampleRate: source.sampleRate, channelCount: source.channelCount, chunkFrames: source.chunkFrames });
	try {
		const extracted = await extractScapeAudio(request.entryByName.get(asset.entry)!, writer, source as unknown as ScapeAudioSource, signal, request.expandedByteBudget, budget);
		verifyScapeExtractedAsset(asset, extracted.digest, extracted.size, id);
		const publication = await writer.commit({ sampleRate: source.sampleRate, channelCount: source.channelCount }, { signal, ifAbsent: true });
		transaction.trackProvisionalSource(publication); signal?.throwIfAborted();
	} catch (error) { try { await writer.abort(); } catch (cleanup) { throw aggregateScapeErrors(error, [cleanup], 'Successor PCM restoration and cleanup failed.'); } throw error; }
}
