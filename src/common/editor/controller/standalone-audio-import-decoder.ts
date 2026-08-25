/* SPDX-License-Identifier: AGPL-3.0-only */

import { isDesktopMainAudioCodecRuntime } from '../desktop-main-audio-codec-runtime-marker.ts';

interface StandaloneAudioFile {
	arrayBuffer(): Promise<ArrayBuffer>;
}

interface CodecDecodedAudio {
	readonly channels: readonly Float32Array[];
	readonly sampleRate: number;
}

interface DecodedAudio {
	readonly sampleRate: number;
}

interface StandaloneAudioImportDecodeOptions<
	File extends StandaloneAudioFile,
	Context,
	Decoded extends DecodedAudio,
> {
	readonly file: File;
	readonly codecRuntime: unknown;
	readonly sampleRate: number;
	readonly getAudioContext: () => Promise<Context>;
	readonly decodeWithWebAudio: (encoded: ArrayBuffer) => Promise<Decoded>;
	readonly decodeWithCodec: (
		file: File,
		settings: Readonly<{ sampleRate: number }>,
	) => Promise<CodecDecodedAudio>;
	readonly bufferFromChannels: (
		channels: readonly Float32Array[],
		sampleRate: number,
		context: Context,
	) => Promise<Decoded>;
	readonly inspectEncodedSampleRate: (encoded: ArrayBuffer) => number | null;
}

export interface StandaloneAudioImportDecodeResult<Context, Decoded extends DecodedAudio> {
	readonly context: Context;
	readonly decoded: Decoded;
	readonly originalSampleRate: number | null;
}

export async function decodeStandaloneAudioForImport<
	File extends StandaloneAudioFile,
	Context,
	Decoded extends DecodedAudio,
>(options: StandaloneAudioImportDecodeOptions<File, Context, Decoded>): Promise<
	StandaloneAudioImportDecodeResult<Context, Decoded>
> {
	if (isDesktopMainAudioCodecRuntime(options.codecRuntime)) {
		const codec = await options.decodeWithCodec(options.file, { sampleRate: options.sampleRate });
		const context = await options.getAudioContext();
		const decoded = await options.bufferFromChannels(codec.channels, codec.sampleRate, context);
		const inspectedSampleRate = await inspectOriginalSampleRate(options);
		return Object.freeze({
			context,
			decoded,
			originalSampleRate: inspectedSampleRate ?? codec.sampleRate,
		});
	}

	const context = await options.getAudioContext();
	let originalSampleRate: number | null = null;
	try {
		const encoded = await options.file.arrayBuffer();
		originalSampleRate = options.inspectEncodedSampleRate(encoded);
		const decoded = await options.decodeWithWebAudio(encoded);
		return Object.freeze({ context, decoded, originalSampleRate });
	} catch {
		const codec = await options.decodeWithCodec(options.file, { sampleRate: options.sampleRate });
		const decoded = await options.bufferFromChannels(codec.channels, codec.sampleRate, context);
		return Object.freeze({
			context,
			decoded,
			originalSampleRate: originalSampleRate ?? codec.sampleRate,
		});
	}
}

async function inspectOriginalSampleRate<
	File extends StandaloneAudioFile,
	Context,
	Decoded extends DecodedAudio,
>(options: StandaloneAudioImportDecodeOptions<File, Context, Decoded>): Promise<number | null> {
	try {
		return options.inspectEncodedSampleRate(await options.file.arrayBuffer());
	} catch {
		return null;
	}
}
