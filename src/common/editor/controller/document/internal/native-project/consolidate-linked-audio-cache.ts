/* SPDX-License-Identifier: AGPL-3.0-only */

import { openExternalMediaPcm } from '../../../../external-media-pcm-reader.ts';

export interface ConsolidateAudioCacheStore {
	beginSourceWrite?(id: string, source: Readonly<Record<string, unknown>>): Promise<{
		write(channels: readonly Float32Array[], options?: { signal?: AbortSignal }): Promise<unknown>;
		commit(metadata: Readonly<Record<string, unknown>>, options?: { signal?: AbortSignal }): Promise<unknown>;
		abort(): Promise<unknown>;
	}>;
}

/** Publish canonical PCM before unlinking the original that currently supplies it. */
export async function consolidateLinkedAudioCache(
	store: ConsolidateAudioCacheStore, source: Readonly<Record<string, unknown>>,
	original: Blob, signal?: AbortSignal, assertCurrent?: () => void,
): Promise<void> {
	if (!store.beginSourceWrite) return;
	const reader = await openExternalMediaPcm(original, source, signal);
	if (!reader) throw new Error('The linked audio original is not a supported PCM container.');
	assertCurrent?.();
	const writer = await store.beginSourceWrite(String(source.storageKey || source.id), { ...source, pcmEncodingPolicy: 'wavpack-required' });
	try {
		await reader.stream(async (channels) => { assertCurrent?.(); await writer.write(channels, { signal }); });
		assertCurrent?.();
		await writer.commit(source, { signal });
	} catch (error) { await writer.abort(); throw error; }
}
