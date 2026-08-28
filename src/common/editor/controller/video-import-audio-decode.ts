/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	decodeBrowserContainerAudio,
	type BrowserContainerAudioDecodeOptions,
} from '../browser-container-audio-decode.ts';
import { throwIfAborted } from '../video-timing-demux-reader.ts';

interface ImportedVideoDecodedAudio {
	readonly channels?: readonly Float32Array[];
	readonly numberOfChannels?: number;
	readonly sampleRate?: number;
}

interface ImportedVideoAudioDecodeOptions {
	readonly file: Blob;
	readonly projectSampleRate: number;
	readonly durationSeconds: number;
	readonly signal?: AbortSignal;
	readonly inspectEncodedSampleRate: (encoded: ArrayBuffer) => number | null;
	readonly decodeNative: (encoded: ArrayBuffer) => Promise<ImportedVideoDecodedAudio>;
	readonly decodeContainerAudio?: (
		file: Blob,
		options: BrowserContainerAudioDecodeOptions,
	) => Promise<ImportedVideoDecodedAudio>;
	readonly decodeFfmpeg: (
		file: Blob,
		options: Readonly<{ sampleRate: number; signal?: AbortSignal }>,
	) => Promise<ImportedVideoDecodedAudio>;
}

interface ImportedVideoAudioDecodeResult {
	readonly decodedAudio: ImportedVideoDecodedAudio;
	readonly declaredAudioSampleRate: number | null;
}

/** Prefer Web Audio, then the container decoder, before leasing the standalone codec. */
export async function decodeImportedVideoAudio(
	options: ImportedVideoAudioDecodeOptions,
): Promise<ImportedVideoAudioDecodeResult> {
	let declaredAudioSampleRate: number | null = null;
	try {
		const encoded = await options.file.arrayBuffer();
		declaredAudioSampleRate = options.inspectEncodedSampleRate(encoded);
		return Object.freeze({
			decodedAudio: await options.decodeNative(encoded),
			declaredAudioSampleRate,
		});
	} catch {
		try {
			return Object.freeze({
				decodedAudio: await (options.decodeContainerAudio ?? decodeBrowserContainerAudio)(options.file, {
					signal: options.signal,
					durationSeconds: options.durationSeconds,
				}),
				declaredAudioSampleRate,
			});
		} catch {
			throwIfAborted(options.signal);
			return Object.freeze({
				decodedAudio: await options.decodeFfmpeg(options.file, {
					sampleRate: options.projectSampleRate,
					signal: options.signal,
				}),
				declaredAudioSampleRate,
			});
		}
	}
}
