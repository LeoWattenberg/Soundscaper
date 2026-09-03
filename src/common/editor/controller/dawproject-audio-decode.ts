/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectDecodedAudioSampleRate, inspectEncodedAudioSampleRate } from '../audio-file-metadata.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../wav-import.js';
import { audioBufferChannels, bufferFromChannels, type AudioBufferLike } from './source-audio.ts';
import { decodeStandaloneAudioForImport } from './standalone-audio-import-decoder.ts';

/**
 * Decoding for the audio files inside a DAWproject archive.
 *
 * Most exporters embed WAV, which the maintained PCM reader streams without a
 * codec. Anything else — a FLAC from Bitwig, an MP3 someone dragged in — goes
 * through the same standalone decode the ordinary import uses: Web Audio
 * first, the codec runtime when the browser declines. Nothing is resampled;
 * the source keeps the rate its file declares, as every import here does.
 */

export interface DawprojectDecodedAudio {
	readonly channels: readonly Float32Array[];
	readonly sampleRate: number;
}

export type DawprojectAudioFileDecoder = (file: Blob, name: string) => Promise<DawprojectDecodedAudio>;

interface DecoderEngine {
	getAudioContext(options: Readonly<{ resume: boolean }>): Promise<unknown>;
	decodeAudioData(
		encoded: ArrayBuffer,
		options?: Readonly<{ sampleRate: number | null }>,
	): Promise<AudioBufferLike>;
}

interface DecoderCodecRuntime {
	decode(input: Blob, settings: Readonly<{ sampleRate: number }>): Promise<Readonly<{
		channels: readonly Float32Array[];
		sampleRate: number;
	}>>;
}

interface DecoderCopy {
	readonly [key: string]: string;
}

const FALLBACK_SAMPLE_RATE = 48_000;

/** The decoder the controller hands the DAWproject service, built from its engine and codec runtime. */
export function createDawprojectAudioDecoder(dependencies: Readonly<{
	engine: DecoderEngine;
	ffmpeg: DecoderCodecRuntime;
	copy: DecoderCopy;
}>): DawprojectAudioFileDecoder {
	return async (file, name) => {
		const named = typeof File === 'function' && !(file instanceof File)
			? new File([file], name, { type: file.type })
			: file;
		const { decoded } = await decodeStandaloneAudioForImport<Blob, unknown, AudioBufferLike>({
			file: named,
			codecRuntime: dependencies.ffmpeg,
			sampleRate: FALLBACK_SAMPLE_RATE,
			getAudioContext: () => dependencies.engine.getAudioContext({ resume: false }),
			// Pinned to the file's own rate, as the ordinary import is, so a
			// compressed file does not come in at the output device's rate.
			decodeWithWebAudio: (encoded, decodedSampleRate) => (
				dependencies.engine.decodeAudioData(encoded, { sampleRate: decodedSampleRate })
			),
			decodeWithCodec: (input, settings) => dependencies.ffmpeg.decode(input, settings),
			bufferFromChannels: (channels, sampleRate, context) => (
				bufferFromChannels([...channels], sampleRate, context as never, dependencies.copy as never)
			),
			inspectEncodedSampleRate: inspectEncodedAudioSampleRate,
			inspectDecodedSampleRate: inspectDecodedAudioSampleRate,
		});
		return Object.freeze({ channels: audioBufferChannels(decoded), sampleRate: decoded.sampleRate });
	};
}

/**
 * Decode one archive entry: PCM WAV through the streaming reader, everything
 * else through the supplied decoder. Returns null when neither can read it,
 * so the importer can say the file was present but unreadable.
 */
export async function decodeDawprojectAudioEntry(
	blob: Blob,
	name: string,
	options: Readonly<{ decodeAudioFile?: DawprojectAudioFileDecoder | null; signal?: AbortSignal }> = {},
): Promise<DawprojectDecodedAudio | null> {
	const wav = await decodePcmWav(blob, options.signal);
	if (wav) return wav;
	if (!options.decodeAudioFile) return null;
	try {
		return await options.decodeAudioFile(blob, name);
	} catch {
		return null;
	}
}

async function decodePcmWav(blob: Blob, signal?: AbortSignal): Promise<DawprojectDecodedAudio | null> {
	const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
	const signature = String.fromCharCode(...head);
	if (signature !== 'RIFF' && signature !== 'RF64' && signature !== 'BW64') return null;
	let descriptor: Readonly<{ frameCount: number; channelCount: number; sampleRate: number }>;
	try {
		descriptor = await inspectWavBlobPcm(blob, { signal });
	} catch {
		// A WAV the PCM reader refuses (a compressed one, say) is a codec's job.
		return null;
	}
	const channels = Array.from({ length: descriptor.channelCount }, () => new Float32Array(descriptor.frameCount));
	await streamWavBlobPcm(blob, {
		descriptor,
		signal,
		onChunk: (chunk: readonly Float32Array[], info: Readonly<{ frameOffset: number }>) => {
			for (const [index, channel] of chunk.entries()) channels[index]?.set(channel, info.frameOffset);
		},
	});
	return Object.freeze({ channels, sampleRate: descriptor.sampleRate });
}
