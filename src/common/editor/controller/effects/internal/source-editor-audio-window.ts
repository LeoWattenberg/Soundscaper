/* SPDX-License-Identifier: AGPL-3.0-only */

import { createStoredChunkProvider, isStoredSourceMetadata, type AudioBufferLike, type StoredSourceReader } from '../../source/source-audio.ts';
import { readWaveformPcmWindow } from '../../source/waveform-analysis.ts';
import { throwIfAborted } from '../../shared/app-helpers.ts';
import type { SourceEditorAudioSource } from './source-editor-effects.ts';

export interface SourceEditorAudioWindowRequest {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly signal?: AbortSignal;
}
export interface SourceEditorAudioWindow {
	readonly sourceId: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly channels: readonly Float32Array[];
}
export interface SourceEditorAudioWindowStore extends Partial<StoredSourceReader> {
	getSourceMetadata?(sourceId: string): Promise<unknown> | unknown;
}
const MAXIMUM_SOURCE_WINDOW_FRAMES = 262_144;

/** A private, bounded source read; it never replaces the main timeline's PCM cache. */
export async function loadSourceEditorAudioWindow(source: SourceEditorAudioSource, request: SourceEditorAudioWindowRequest, options: {
	readonly store?: SourceEditorAudioWindowStore;
	readonly buffer?: AudioBufferLike;
}): Promise<SourceEditorAudioWindow | null> {
	throwIfAborted(request.signal);
	const { startFrame, endFrame } = request;
	if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || startFrame < 0 || endFrame <= startFrame || endFrame > source.frameCount) {
		throw new RangeError('A source audio window requires a valid native sample range.');
	}
	if (endFrame - startFrame > MAXIMUM_SOURCE_WINDOW_FRAMES) return null;
	const buffer = options.buffer;
	if (buffer) return { sourceId: source.id, startFrame, endFrame,
		channels: Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel).slice(startFrame, endFrame)) };
	const store = options.store;
	if (!store?.readSourceChunk || !store.getSourceMetadata) return null;
	const metadata = await store.getSourceMetadata(source.storageKey || source.id);
	throwIfAborted(request.signal);
	if (!isStoredSourceMetadata(metadata) || !Number.isSafeInteger(metadata.chunkFrames) || Number(metadata.chunkFrames) < 1) return null;
	const provider = createStoredChunkProvider({
		readSourceChunk: (...args) => store.readSourceChunk!(...args),
		...(store.openSourceReadSession ? { openSourceReadSession: (...args: Parameters<NonNullable<StoredSourceReader['openSourceReadSession']>>) => store.openSourceReadSession!(...args) } : {}),
	}, source, metadata);
	try {
		const channels = await readWaveformPcmWindow(provider as Parameters<typeof readWaveformPcmWindow>[0], request, request);
		return { sourceId: source.id, startFrame, endFrame, channels };
	} finally { await provider.dispose(); }
}
