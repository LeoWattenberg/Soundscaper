/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_STORAGE_CHUNK_FRAMES } from '../chunk-stream.js';
import type { EngineChunkSource, ResolvedClipSource } from './types.ts';

/** Keep native-rate offline conversion independent of a source's cache representation. */
export function preferOfflineChunkSource(
	resolved: ResolvedClipSource,
	outputSampleRate: number | undefined,
): ResolvedClipSource {
	const buffer = resolved.buffer;
	if (!buffer || outputSampleRate === undefined || buffer.sampleRate === outputSampleRate) return resolved;
	const provider: EngineChunkSource = {
		channelCount: buffer.numberOfChannels,
		frameCount: buffer.length,
		sampleRate: buffer.sampleRate,
		chunkFrames: AUDIO_EDITOR_STORAGE_CHUNK_FRAMES,
		readStorageChunk: (chunkIndex) => Array.from({ length: buffer.numberOfChannels }, (_, channel) => (
			buffer.getChannelData(channel).subarray(chunkIndex * AUDIO_EDITOR_STORAGE_CHUNK_FRAMES,
				(chunkIndex + 1) * AUDIO_EDITOR_STORAGE_CHUNK_FRAMES)
		)),
	};
	return { ...resolved, buffer: null, chunkSource: provider };
}
