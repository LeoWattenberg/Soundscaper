/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BinauralDeliveryPlan } from '../binaural-delivery.ts';
import { binauralSourcesForAuthoredAdm } from '../binaural-delivery.ts';
import { renderBinaural } from '../binaural-render.ts';
import {
	type RenderedLoudnessMeasurement,
	normalizeRenderedLoudness,
} from '../loudness-normalization-render.ts';
import { resolveAdmEbuChannelWeights } from '../loudness-channel-layout.ts';
import type {
	LoudnessNormalizationDecision,
	LoudnessNormalizationTarget,
} from '../loudness-normalization.ts';
import type {
	DirectCompressedDestination,
	DirectCompressedEncodeOptions,
} from './direct-compressed-export.ts';
import { encodeDirectOfflineCompressed } from './direct-offline-compressed-export.ts';
import { encodeDirectOfflinePcm } from './direct-offline-pcm-export.ts';
import type {
	DirectPcmContainerEncoder,
	DirectPcmDestination,
} from './direct-pcm-export.ts';

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
	readonly adm?: Readonly<{ readonly metadata?: unknown }> | null;
	readonly bext?: Readonly<Record<string, unknown>>;
	readonly binaural?: BinauralDeliveryPlan | null;
	readonly cart?: unknown;
	readonly channelCount?: number;
	readonly channelMapping: unknown;
	readonly container?: unknown;
	readonly ditherMode: unknown;
	readonly encoding: RenderedAudioFormatSettings;
	readonly format: string;
	readonly ixml?: unknown;
	/** The delivery's loudness target, decided by the plan rather than by an encoder. */
	readonly loudnessNormalization?: LoudnessNormalizationTarget | null;
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
	readonly byteLength?: number;
	readonly bytes?: Uint8Array | null;
	readonly cleanup?: () => Awaitable<void>;
	/** Loudness measured from the written samples, present only when the delivery captured it. */
	readonly deliveredLoudness?: RenderedLoudnessMeasurement | null;
	readonly directDestination?: DirectCompressedDestination | DirectPcmDestination;
	/** What normalization decided for this delivery, so the report can carry it. */
	readonly loudnessNormalization?: LoudnessNormalizationDecision | null;
	readonly mimeType: string;
}

export interface RenderedAudioEncodingRuntime {
	applyMediaChannelMapping(
		channels: readonly Float32Array[],
		mapping: unknown,
	): readonly Float32Array[];
	audioBufferChannels(buffer: RenderedAudioBuffer): readonly Float32Array[];
	readonly copy: Readonly<{ readonly encoding: unknown; readonly [key: string]: unknown }>;
	createAiffStreamEncoder?(
		options: Readonly<Record<string, unknown>>,
	): DirectPcmContainerEncoder;
	createWavStreamEncoder?(
		options: Readonly<Record<string, unknown>>,
	): DirectPcmContainerEncoder;
	encodeAiff(
		channels: readonly Float32Array[],
		options: Readonly<Record<string, unknown>>,
	): Uint8Array;
	encodeWav(
		channels: readonly Float32Array[],
		options: Readonly<Record<string, unknown>>,
	): Uint8Array;
	readonly ffmpeg: DirectCompressedEncodeOptions['ffmpeg'] & Readonly<{
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
	readonly assertCurrent?: () => void;
	readonly directCompressedDestination?: DirectCompressedDestination | null;
	readonly directDestination?: DirectPcmDestination | null;
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
		applyMediaChannelMapping, audioBufferChannels, copy,
		createAiffStreamEncoder, createWavStreamEncoder, encodeAiff, encodeWav,
		ffmpeg, resampleBuffer, setStatus, throwIfAborted,
	} = runtime;
	const { plan, rendered, settings, signal } = options;
	const assertActive = (): void => {
		throwIfAborted(signal);
		options.assertCurrent?.();
	};
	assertActive();
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
	assertActive();
	const bitDepth = plan.encoding.bitDepth
		|| (settings.bitDepth === 32 ? 32 : settings.bitDepth)
		|| 24;
	const programmeChannels = audioBufferChannels(output);
	// The programme is placed before anything else touches the samples: the
	// renderer needs the delivered channel order the ADM metadata describes, and
	// after this point the delivery is two channels like any other stereo one.
	const binaural = plan.binaural
		? renderBinaural(
			binauralSourcesForAuthoredAdm(plan.binaural.metadata, programmeChannels),
			plan.sampleRate,
		)
		: null;
	if (binaural) assertActive();
	const renderedChannels = binaural ? binaural.channels : programmeChannels;
	const native = isNativePcmFormat(plan.format);
	const broadcast = plan.format === 'bwf' || plan.format === 'bw64';
	// The one neutral point every delivery passes through: no encoder has been
	// chosen yet, and these are the samples that get written. Normalizing here is
	// what makes the gain a plan step rather than a per-format encoder flag, so
	// every format normalizes identically or not at all.
	const encodeChannels = native
		? applyMediaChannelMapping(renderedChannels, plan.channelMapping)
		: renderedChannels;
	const captureLoudness = broadcast && settings.measureLoudness === true;
	// A native format is mapped here; every other format stages these channels and
	// lets the encoder apply the mapping afterwards. A downmix moves both
	// integrated loudness and true peak, so deciding the gain from the staged
	// channels put the delivered file off its target while the report still said
	// target-met — and no delivered measurement runs for those formats to catch
	// it. The decision is measured from what the delivery will contain; applying
	// the gain to the staged channels is still exact, because a scalar gain
	// commutes with the linear mix the encoder performs.
	const measurementChannels = native || !plan.loudnessNormalization
		? encodeChannels
		: applyMediaChannelMapping(renderedChannels, plan.channelMapping);
	const channelWeights = resolveAdmEbuChannelWeights(plan.adm?.metadata, measurementChannels.length);
	const normalized = normalizeRenderedLoudness({
		channels: encodeChannels,
		measurementChannels,
		sampleRate: plan.sampleRate,
		...(channelWeights ? { channelWeights } : {}),
		target: plan.loudnessNormalization,
		captureLoudness,
	});
	const sourceChannels = normalized.channels;
	// Only when something was actually measured: metering an hour of audio takes
	// long enough that a cancel during it deserves to be honoured before
	// encoding starts. An ordinary export measures nothing and pays nothing.
	if (normalized.decision) assertActive();
	const withLoudness = (result: RenderedAudioEncodedOutput): RenderedAudioEncodedOutput => (
		normalized.decision
			? { ...result, loudnessNormalization: normalized.decision, deliveredLoudness: normalized.delivered }
			: result
	);
	if (native) {
		// The capture describes the bytes that were written, so it comes from
		// measuring the normalized channels rather than from projecting them.
		const measuredBext = normalized.delivered
			? { ...plan.bext, ...normalized.delivered }
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
		if (options.directDestination) {
			assertActive();
			const createStreamEncoder = plan.format === 'aiff'
				? createAiffStreamEncoder
				: createWavStreamEncoder;
			if (typeof createStreamEncoder !== 'function') {
				throw new TypeError(`The direct ${plan.format.toUpperCase()} stream encoder is unavailable.`);
			}
			return withLoudness(await encodeDirectOfflinePcm({
				assertCurrent: options.assertCurrent ?? (() => undefined),
				channels: sourceChannels,
				createEncoder: createStreamEncoder,
				destination: options.directDestination,
				encoderOptions: {
					...nativeOptions,
					channelCount: plan.channelCount,
					totalFrames: plan.outputFrames,
				},
				plan,
				signal,
			}));
		}
		const bytes = plan.format === 'aiff'
			? encodeAiff(sourceChannels, nativeOptions)
			: encodeWav(sourceChannels, nativeOptions);
		return withLoudness({ bytes, mimeType: plan.mimeType });
	}
	if (options.directCompressedDestination) {
		assertActive();
		return withLoudness(await encodeDirectOfflineCompressed({
			assertCurrent: options.assertCurrent ?? (() => undefined),
			channels: sourceChannels,
			destination: options.directCompressedDestination,
			encodeWav,
			ffmpeg,
			onEncoding: () => { setStatus(copy.encoding); },
			plan,
			signal,
		}));
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
	assertActive();
	setStatus(copy.encoding);
	return withLoudness(await ffmpeg.encode(wav, plan.format, {
		...plan.encoding,
		bitDepth,
		sampleRate: plan.sampleRate,
		applyDither: plan.encoding.sampleFormat !== 'float32'
			&& plan.ditherMode !== 'none'
			&& plan.format !== 'flac',
		signal,
	}));
}

function isNativePcmFormat(format: string): boolean {
	return format === 'wav' || format === 'bwf' || format === 'bw64' || format === 'aiff';
}
