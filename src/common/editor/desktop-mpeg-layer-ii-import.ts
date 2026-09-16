/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StreamedAudioImportSession } from './browser-streamed-audio-import.ts';
import type { WavPackImportGroupDecoder } from './browser-streamed-wavpack-import.ts';
import type { BrowserContainerAudioSample } from './browser-container-audio-decode.ts';

const MAXIMUM_INPUT_BYTES = 32 * 1024 * 1024;
const MAXIMUM_PCM_BYTES = 128 * 1024 * 1024;
const MAXIMUM_READ_BYTES = 4 * 1024 * 1024;
const SAMPLE_FRAMES = 65_536;

/** Preserve the existing small utility-process MP2 tier without sending large sources to its whole-file ABI. */
export function openDesktopMpegLayerIIImportSession(
	file: Blob,
	geometry: Omit<StreamedAudioImportSession, 'samples' | 'dispose'>,
	signal?: AbortSignal,
	codec?: WavPackImportGroupDecoder,
): StreamedAudioImportSession {
	signal?.throwIfAborted();
	const frames = Math.round(geometry.sampleRate * geometry.durationSeconds);
	const bytes = frames * geometry.channelCount * 4;
	if (!codec || file.size > MAXIMUM_INPUT_BYTES || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAXIMUM_PCM_BYTES) {
		throw new Error('Desktop MPEG LayerII import requires the utility codec and is limited to 32 MiB input and 128 MiB decoded PCM.');
	}
	let disposed = false;
	const assertCurrent = (): void => {
		signal?.throwIfAborted();
		if (disposed) throw new Error('The desktop MPEG LayerII import session is closed.');
	};
	return Object.freeze({ ...geometry, dispose() { disposed = true; },
		async *samples(): AsyncGenerator<BrowserContainerAudioSample> {
			assertCurrent();
			// Selected range Blobs refuse whole arrayBuffer reads; only the old bounded tier is materialized.
			const parts: ArrayBuffer[] = [];
			for (let offset = 0; offset < file.size; offset += MAXIMUM_READ_BYTES) {
				parts.push(await file.slice(offset, Math.min(file.size, offset + MAXIMUM_READ_BYTES)).arrayBuffer());
				assertCurrent();
			}
			const name = 'name' in file && typeof file.name === 'string' ? file.name : 'selected.mp2';
			const input = new File(parts, name, { type: file.type || 'audio/mpeg' });
			const decoded = await codec.decode(input, { format: 'mp2', signal, maximumOutputBytes: MAXIMUM_PCM_BYTES });
			assertCurrent();
			if (decoded.sampleRate !== geometry.sampleRate || decoded.channels.length !== geometry.channelCount
				|| decoded.channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== frames)) {
				throw new Error('The desktop MPEG LayerII utility returned different PCM geometry.');
			}
			for (let offset = 0; offset < frames; offset += SAMPLE_FRAMES) {
				assertCurrent();
				const count = Math.min(SAMPLE_FRAMES, frames - offset);
				yield {
					timestamp: geometry.timelineOrigin + offset / geometry.sampleRate,
					sampleRate: geometry.sampleRate, numberOfChannels: geometry.channelCount,
					numberOfFrames: count, duration: count / geometry.sampleRate,
					copyTo(destination, options) {
						const from = offset + (options.frameOffset ?? 0);
						destination.set(decoded.channels[options.planeIndex]!.subarray(from, from + (options.frameCount ?? count)));
					}, close() {},
				};
			}
		},
	});
}
