/* SPDX-License-Identifier: AGPL-3.0-only */

import { consolidateExternalMediaCommands, externalMediaForSource } from '../../../../desktop-external-media.ts';
import { scapeAudioSourceStream, createScapeDigest, scapeHex, type ScapeAudioSource } from '../../../../scape-archive-media.ts';

interface ExternalMediaCacheStore {
	readSourceChunks?: Parameters<typeof scapeAudioSourceStream>[0]['readSourceChunks'];
	getSourceMetadata?(sourceId: string): Promise<unknown>;
	getMediaAssetMetadata?(sourceId: string): Promise<unknown>;
}

/** Authenticated import caches become the bundled originals when the user consolidates. */
export async function prepareExternalMediaConsolidation(
	project: Readonly<Record<string, unknown>>,
	store: ExternalMediaCacheStore,
	assertCurrent: () => void,
	signal?: AbortSignal,
): Promise<ReturnType<typeof consolidateExternalMediaCommands>> {
	const sources: unknown[] = Array.isArray(project.sources) ? project.sources as unknown[] : [];
	const ready = new Set<string>();
	for (const source of sources) {
		const reference = externalMediaForSource(source);
		if (!reference || !record(source)) continue;
		assertCurrent();
		const id = String(source.id), key = String(source.storageKey || id);
		const metadata = reference.role === 'video'
			? await store.getMediaAssetMetadata?.(key) : await store.getSourceMetadata?.(key);
		assertCurrent();
		const valid = record(metadata) && (reference.role === 'video'
			? metadata.size === reference.byteLength && metadata.sha256 === reference.sha256
			: metadata.frameCount === source.frameCount && metadata.channelCount === source.channelCount
				&& metadata.sampleRate === source.sampleRate
				&& (reference.contentSha256 === null || metadata.sha256 === undefined || metadata.sha256 === reference.contentSha256));
		if (!valid) throw new Error(`Media ${String(source.name || id)} is unavailable or changed; consolidation could not finish.`);
		if (reference.role !== 'video' && reference.contentSha256 !== null) {
			if (!store.readSourceChunks) throw new Error('Consolidation requires the stored audio samples.');
			const digest = createScapeDigest();
			await scapeAudioSourceStream({ readSourceChunks: store.readSourceChunks.bind(store) },
				source as unknown as ScapeAudioSource, digest, () => {}, signal)
				.pipeTo(new WritableStream<Uint8Array>({ write() { assertCurrent(); } }), { signal });
			if (scapeHex(digest.digest()) !== reference.contentSha256) throw new Error(`Stored audio ${String(source.name || id)} has changed.`);
		}
		ready.add(id);
	}
	return consolidateExternalMediaCommands(sources, ready);
}

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
