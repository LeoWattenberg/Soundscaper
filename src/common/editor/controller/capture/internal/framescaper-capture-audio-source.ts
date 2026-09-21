/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperCaptureStreamManifestV1 } from '../../../framescaper-capture-session-manifest.ts';
import { createNonImportedSourceProvenance } from '../../../source-provenance-root.ts';
import type { RawPcmSpoolRecord } from '../../../storage/raw-pcm-spool-repository.ts';

/** Materialize the immutable source descriptor for a canonical capture PCM spool. */
export function framescaperCaptureAudioSource(
	stream: FramescaperCaptureStreamManifestV1,
	spool: RawPcmSpoolRecord,
	outputFrameCount: number,
	name: string,
): Readonly<Record<string, unknown>> {
	if (stream.storage.kind !== 'raw-pcm') throw new Error('Capture PCM source storage changed.');
	return Object.freeze({
		kind: 'audio',
		id: stream.storage.sourceId, storageKey: stream.storage.sourceId,
		name, mimeType: 'audio/x-soundscaper-pcm',
		sampleRate: stream.storage.sampleRate, originalSampleRate: stream.storage.sampleRate,
		frameCount: outputFrameCount, channelCount: stream.storage.channelCount,
		sampleFormat: 'float32', chunkFrames: spool.chunkFrames,
		provenance: createNonImportedSourceProvenance('recorded'),
		opaqueExtensions: Object.freeze({}),
	});
}
