/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioCodec, InputAudioTrack } from 'mediabunny';

const BIG_ENDIAN_CODECS = new Map<AudioCodec, AudioCodec>([
	['pcm-s16', 'pcm-s16be'], ['pcm-s24', 'pcm-s24be'], ['pcm-s32', 'pcm-s32be'],
	['pcm-f32', 'pcm-f32be'], ['pcm-f64', 'pcm-f64be'],
]);

/** The WAVE demuxer reads RIFX geometry correctly but labels its PCM as little-endian. */
export async function correctRifxAudioImportCodec(file: Blob, track: InputAudioTrack, signal?: AbortSignal): Promise<void> {
	signal?.throwIfAborted();
	const originalCodec = await track.getCodec();
	const codec = originalCodec === null ? undefined : BIG_ENDIAN_CODECS.get(originalCodec);
	if (codec === undefined) return;
	const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
	signal?.throwIfAborted();
	if (String.fromCharCode(...header.subarray(0, 4)) !== 'RIFX'
		|| String.fromCharCode(...header.subarray(8, 12)) !== 'WAVE') return;
	const config = await track.getDecoderConfig();
	signal?.throwIfAborted();
	if (config === null) return;
	const correctedConfig = { ...config, codec };
	// Keep the original packet bytes and use the existing bounded big-endian PCM decoder.
	track.getCodec = () => Promise.resolve(codec);
	track.getDecoderConfig = () => Promise.resolve(correctedConfig);
}
