/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StreamedAudioImportSession } from './browser-streamed-audio-import.ts';
import type { WavPackImportGroupDecoder } from './browser-streamed-wavpack-import.ts';
import type { BrowserContainerAudioSample } from './browser-container-audio-decode.ts';

const MAXIMUM_INPUT_BYTES = 32 * 1024 * 1024;
const MAXIMUM_PCM_BYTES = 128 * 1024 * 1024;
const MAXIMUM_READ_BYTES = 4 * 1024 * 1024;
const SAMPLE_FRAMES = 65_536;
const AAC_PACKET_FRAMES = 1024;

type SourceGeometry = Omit<StreamedAudioImportSession, 'samples' | 'dispose'>;

/** Preserve the broker's existing whole-file caps; larger sources retain packet decoding. */
export function canUseDesktopAacImport(file: Blob, geometry: Pick<SourceGeometry, 'sampleRate' | 'channelCount' | 'durationSeconds'>): boolean {
	const frames = Math.round(geometry.sampleRate * geometry.durationSeconds);
	const bytes = (frames + AAC_PACKET_FRAMES * 2) * geometry.channelCount * 4;
	return file.size <= MAXIMUM_INPUT_BYTES && Number.isSafeInteger(frames) && frames > 0
		&& Number.isSafeInteger(bytes) && bytes > 0 && bytes <= MAXIMUM_PCM_BYTES;
}

/** AAC/M4A belongs to the main-owned OS/external provider, including when Electron has no AAC decoder. */
export function openDesktopAacImportSession(
	file: Blob,
	geometry: SourceGeometry,
	codec: WavPackImportGroupDecoder,
	signal?: AbortSignal,
	leadingFrames = 0,
): StreamedAudioImportSession {
	signal?.throwIfAborted();
	if (!canUseDesktopAacImport(file, geometry) || (leadingFrames !== 0 && leadingFrames !== AAC_PACKET_FRAMES)) {
		throw new Error('Desktop AAC/M4A utility import is limited to 32 MiB input and 128 MiB decoded PCM.');
	}
	const frames = Math.round(geometry.sampleRate * geometry.durationSeconds);
	const controller = new AbortController();
	let disposed = false;
	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		signal?.removeEventListener('abort', onAbort);
		controller.abort(signal?.reason);
	};
	const onAbort = (): void => { dispose(); };
	signal?.addEventListener('abort', onAbort, { once: true });
	const assertCurrent = (): void => {
		signal?.throwIfAborted();
		if (disposed) throw new Error('The desktop AAC/M4A import session is closed.');
	};
	return Object.freeze({ ...geometry, dispose,
		async *samples(): AsyncGenerator<BrowserContainerAudioSample> {
			assertCurrent();
			const parts: ArrayBuffer[] = [];
			for (let offset = 0; offset < file.size; offset += MAXIMUM_READ_BYTES) {
				parts.push(await file.slice(offset, Math.min(file.size, offset + MAXIMUM_READ_BYTES)).arrayBuffer());
				assertCurrent();
			}
			const name = 'name' in file && typeof file.name === 'string' ? file.name : 'selected.m4a';
			const decoded = await codec.decode(new File(parts, name, { type: file.type || 'audio/mp4' }), {
				format: 'aac-m4a', signal: controller.signal, maximumOutputBytes: MAXIMUM_PCM_BYTES,
			});
			assertCurrent();
			const expectedFrames = frames + leadingFrames;
			const decodedFrames = decoded.channels[0]?.length;
			if (decoded.sampleRate !== geometry.sampleRate || decoded.channels.length !== geometry.channelCount
				|| decodedFrames === undefined || decodedFrames < expectedFrames || decodedFrames >= expectedFrames + AAC_PACKET_FRAMES
				|| decoded.channels.some(channel => !(channel instanceof Float32Array) || channel.length !== decodedFrames)) {
				throw new Error('The desktop AAC/M4A utility returned different PCM geometry.');
			}
			for (let offset = 0; offset < frames; offset += SAMPLE_FRAMES) {
				assertCurrent();
				const count = Math.min(SAMPLE_FRAMES, frames - offset);
				yield {
					timestamp: geometry.timelineOrigin + offset / geometry.sampleRate,
					sampleRate: geometry.sampleRate, numberOfChannels: geometry.channelCount,
					numberOfFrames: count, duration: count / geometry.sampleRate,
					copyTo(destination, options) {
						const from = leadingFrames + offset + (options.frameOffset ?? 0);
						destination.set(decoded.channels[options.planeIndex]!.subarray(from, from + (options.frameCount ?? count)));
					}, close() {},
				};
			}
		},
	});
}
