/* SPDX-License-Identifier: AGPL-3.0-only */

import { measureBextLoudness } from '../broadcast-loudness.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

interface RenderedAudioBuffer {
	readonly sampleRate: number;
}

interface RenderedAudioEncodingSettings {
	readonly bitDepth?: number;
	readonly measureLoudness?: boolean;
}

interface RenderedAudioFormatSettings extends Readonly<Record<string, unknown>> {
	readonly bitDepth?: number;
	readonly floatingPoint?: boolean;
	readonly sampleFormat?: string;
}

export interface RenderedAudioEncodingPlan {
	readonly bext?: Readonly<Record<string, unknown>>;
	readonly cart?: unknown;
	readonly channelMapping: unknown;
	readonly container?: unknown;
	readonly ditherMode: unknown;
	readonly encoding: RenderedAudioFormatSettings;
	readonly format: string;
	readonly ixml?: unknown;
	readonly markers?: unknown;
	readonly metadata: Readonly<Record<string, unknown>>;
	readonly mimeType: string;
	readonly outputFrames: number;
	readonly preDataChunks?: unknown;
	readonly sampleRate: number;
	readonly trailingChunks?: unknown;
}

export interface RenderedAudioEncodedOutput extends Readonly<Record<string, unknown>> {
	readonly blob?: Blob | null;
	readonly bytes?: Uint8Array | null;
	readonly cleanup?: () => Awaitable<void>;
	readonly mimeType: string;
}

export interface RenderedAudioEncodingRuntime {
	applyMediaChannelMapping(
		channels: readonly Float32Array[],
		mapping: unknown,
	): readonly Float32Array[];
	audioBufferChannels(buffer: RenderedAudioBuffer): readonly Float32Array[];
	readonly copy: Readonly<{ readonly encoding: unknown; readonly [key: string]: unknown }>;
	encodeAiff(
		channels: readonly Float32Array[],
		options: Readonly<Record<string, unknown>>,
	): Uint8Array;
	encodeWav(
		channels: readonly Float32Array[],
		options: Readonly<Record<string, unknown>>,
	): Uint8Array;
	readonly ffmpeg: Readonly<{
		encode(
			input: Uint8Array,
			format: string,
			settings: Readonly<Record<string, unknown>>,
		): Awaitable<RenderedAudioEncodedOutput>;
	}>;
	resampleBuffer(
		input: RenderedAudioBuffer,
		sampleRate: number,
		context: undefined,
		copy: Readonly<Record<string, unknown>>,
		outputFrames: number,
	): Awaitable<RenderedAudioBuffer>;
	setStatus(message: unknown): void;
	throwIfAborted(signal: AbortSignal): void;
}

export interface EncodeRenderedAudioOptions {
	readonly plan: RenderedAudioEncodingPlan;
	readonly rendered: RenderedAudioBuffer;
	readonly settings: RenderedAudioEncodingSettings;
	readonly signal: AbortSignal;
}

/** Encode one admitted offline render while preserving the legacy Blob/byte result contract. */
export async function encodeRenderedAudio(
	runtime: RenderedAudioEncodingRuntime,
	options: EncodeRenderedAudioOptions,
): Promise<RenderedAudioEncodedOutput> {
	const {
		applyMediaChannelMapping, audioBufferChannels, copy, encodeAiff, encodeWav,
		ffmpeg, resampleBuffer, setStatus, throwIfAborted,
	} = runtime;
	const { plan, rendered, settings, signal } = options;
	throwIfAborted(signal);
	let output = rendered;
	if (plan.sampleRate !== rendered.sampleRate) {
		output = await resampleBuffer(
			rendered,
			plan.sampleRate,
			undefined,
			copy,
			plan.outputFrames,
		);
	}
	throwIfAborted(signal);
	const bitDepth = plan.encoding.bitDepth
		|| (settings.bitDepth === 32 ? 32 : settings.bitDepth)
		|| 24;
	const sourceChannels = audioBufferChannels(output);
	if (isNativePcmFormat(plan.format)) {
		const mapped = applyMediaChannelMapping(sourceChannels, plan.channelMapping);
		const broadcast = plan.format === 'bwf' || plan.format === 'bw64';
		const measuredBext = broadcast && settings.measureLoudness === true
			? { ...plan.bext, ...measureBextLoudness(mapped, plan.sampleRate) }
			: plan.bext;
		const nativeOptions = {
			container: plan.container,
			sampleRate: plan.sampleRate,
			bitDepth,
			float: plan.encoding.floatingPoint,
			sampleFormat: plan.encoding.sampleFormat,
			dither: plan.ditherMode,
			metadata: plan.metadata,
			markers: plan.markers,
			ixml: plan.ixml,
			cart: plan.cart,
			bext: broadcast ? measuredBext : undefined,
			preDataChunks: plan.preDataChunks,
			trailingChunks: plan.trailingChunks,
		};
		const bytes = plan.format === 'aiff'
			? encodeAiff(mapped, nativeOptions)
			: encodeWav(mapped, nativeOptions);
		return { bytes, mimeType: plan.mimeType };
	}
	const stagingFloat = plan.format !== 'flac';
	const stagingBitDepth = stagingFloat
		? 32
		: plan.format === 'flac' || plan.format === 'wavpack'
			? Math.min(24, bitDepth)
			: 24;
	const wav = encodeWav(sourceChannels, {
		sampleRate: plan.sampleRate,
		bitDepth: stagingBitDepth,
		float: stagingFloat,
		dither: stagingFloat ? 'none' : plan.ditherMode,
	});
	throwIfAborted(signal);
	setStatus(copy.encoding);
	return ffmpeg.encode(wav, plan.format, {
		...plan.encoding,
		bitDepth,
		sampleRate: plan.sampleRate,
		applyDither: plan.encoding.sampleFormat !== 'float32'
			&& plan.ditherMode !== 'none'
			&& plan.format !== 'flac',
		signal,
	});
}

function isNativePcmFormat(format: string): boolean {
	return format === 'wav' || format === 'bwf' || format === 'bw64' || format === 'aiff';
}
