/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioSampleSink, Input, InputAudioTrack, InputVideoTrack, VideoSampleSink } from 'mediabunny';
import { normalizeMotionAsset, verifyMotionAssetBody, type MotionAsset } from './motion-asset.ts';
import { normalizeMotionAudioFormat, MOTION_AUDIO_WINDOW_SAMPLES, type MotionAudioAsset, type MotionAudioFormat, type MotionAudioReadRequest, type MotionAudioSampleProvider } from './motion-audio-contract.ts';
import { createMotionSurface, motionSurfaceFromRgba8, motionSurfaceLength, type MotionSurface } from './motion-surface.ts';
import { compareRationals, normalizeRational, type Rational } from './timeline-time.ts';
import { motionInteger } from './motion-values.ts';
import { awaitScapeReadOperation } from './scape-abort.ts';
import { MOTION_MEDIA_IMPORT_MAXIMUM_BYTES } from './motion-media-limits.ts';

interface MediaInput {
	readonly digest: string; readonly input: Input; readonly audio: InputAudioTrack | null; readonly video: InputVideoTrack | null;
	audioSink: AudioSampleSink | null; videoSink: VideoSampleSink | null;
}
export interface MotionMediaProvider extends MotionAudioSampleProvider {
	decodeFootage(asset: Extract<MotionAsset, { kind: 'footage' }>, sourceTime: Rational, signal?: AbortSignal): Promise<MotionSurface>;
	dispose(): void;
}
export interface MotionMediaProviderOptions { readonly loadAsset: (asset: MotionAsset, signal?: AbortSignal) => Promise<Uint8Array> }

/** One verified source and one bounded decode request at a time; no duration-sized decoded audio or frame cache. */
export function createMotionMediaProvider(options: MotionMediaProviderOptions): MotionMediaProvider {
	let cached: MediaInput | null = null; let tail = Promise.resolve(); let pending = 0; let disposed = false;
	let canvas: OffscreenCanvas | null = null; const lifetime = new AbortController();
	const drop = () => { cached?.input.dispose(); cached = null; };
	const run = <T>(operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => {
		if (disposed) return Promise.reject(new Error('The motion media provider is disposed.'));
		if (pending >= 8) return Promise.reject(new Error('The motion media decode queue is full.'));
		pending++;
		const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
		const result = tail.then(async () => {
			combined.throwIfAborted(); combined.addEventListener('abort', drop, { once: true });
			try { return await operation(combined); }
			catch (error) { combined.throwIfAborted(); throw error; }
			finally { combined.removeEventListener('abort', drop); }
		});
		tail = result.then(() => undefined, () => undefined).finally(() => { pending--; });
		return result;
	};
	const source = async (value: MotionAudioAsset, signal: AbortSignal): Promise<MediaInput> => {
		const asset = normalizeMotionAsset(value);
		if (asset.kind !== 'audio' && asset.kind !== 'footage') throw new Error('A media decoder requires an audio or footage asset.');
		if (asset.byteLength > MOTION_MEDIA_IMPORT_MAXIMUM_BYTES) throw new RangeError('Motion media decoding currently admits retained sources up to 64 MiB.');
		if (cached?.digest === asset.sha256) return cached;
		drop();
		const bytes = await awaitScapeReadOperation(() => options.loadAsset(asset, signal), signal); verifyMotionAssetBody(asset, bytes);
		const { Input, BufferSource, ALL_FORMATS, HLS } = await import('mediabunny'); signal.throwIfAborted();
		const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS.filter((format) => format !== HLS) });
		const abortInput = () => input.dispose(); signal.addEventListener('abort', abortInput, { once: true });
		try {
			const audio = await input.getPrimaryAudioTrack(); const video = await input.getPrimaryVideoTrack(); signal.throwIfAborted();
			cached = { digest: asset.sha256, input, audio, video, audioSink: null, videoSink: null }; return cached;
		} catch (error) { input.dispose(); throw error; }
		finally { signal.removeEventListener('abort', abortInput); }
	};
	const audioFormat = async (asset: MotionAudioAsset, source: MediaInput, signal: AbortSignal): Promise<MotionAudioFormat> => {
		if (!source.audio || (asset.kind === 'footage' && !asset.hasAudio)) throw new Error('The retained media has no declared audio track.');
		const sampleRate = await source.audio.getSampleRate(); const channels = await source.audio.getNumberOfChannels();
		const end = await source.audio.computeDuration(); signal.throwIfAborted();
		const sampleCount = Math.round(end * sampleRate);
		if (Math.abs(sampleCount - end * sampleRate) > 0.01) throw new Error('Audio duration cannot be represented on its native sample grid.');
		const format = normalizeMotionAudioFormat({ sampleRate, channels, sampleCount });
		if (asset.kind === 'audio' && (asset.sampleRate !== sampleRate || asset.channels !== channels
			|| Math.abs(asset.duration.num / asset.duration.den * sampleRate - sampleCount) > 1)) throw new Error('Decoded audio metadata differs from its retained asset.');
		if (!await source.audio.canDecode()) throw new Error('The retained audio codec is unavailable.');
		return format;
	};
	const readAudio = async (request: MotionAudioReadRequest, signal: AbortSignal): Promise<Float32Array> => {
		const sampleCount = motionInteger(request.sampleCount, 'audio decode window', 1, MOTION_AUDIO_WINDOW_SAMPLES);
		const startSample = motionInteger(request.startSample, 'audio decode start');
		const loaded = await source(request.asset, signal); const format = await audioFormat(request.asset, loaded, signal);
		if (startSample + sampleCount > format.sampleCount) throw new RangeError('Audio decode range exceeds the retained track.');
		const { AudioSampleSink } = await import('mediabunny');
		loaded.audioSink ??= new AudioSampleSink(loaded.audio!);
		const output = new Float32Array(sampleCount * format.channels);
		for await (const sample of loaded.audioSink.samples(startSample / format.sampleRate, (startSample + sampleCount) / format.sampleRate)) {
			try {
				signal.throwIfAborted();
				if (sample.sampleRate !== format.sampleRate || sample.numberOfChannels !== format.channels) throw new Error('Decoded PCM changed its declared native format.');
				const first = Math.round(sample.timestamp * format.sampleRate);
				const start = Math.max(startSample, first); const end = Math.min(startSample + sampleCount, first + sample.numberOfFrames);
				if (end > start) sample.copyTo(output.subarray((start - startSample) * format.channels, (end - startSample) * format.channels),
					{ planeIndex: 0, format: 'f32', frameOffset: start - first, frameCount: end - start });
			} finally { sample.close(); }
		}
		signal.throwIfAborted();
		if (output.some((value) => !Number.isFinite(value))) throw new Error('Decoded PCM contains non-finite samples.');
		return output;
	};
	return {
		describe: (asset, signal) => run(async (active) => audioFormat(asset, await source(asset, active), active), signal),
		read: (request, signal) => run((active) => readAudio(request, active), signal),
		decodeFootage: (asset, sourceTime, signal) => run(async (active) => {
			const time = normalizeRational(sourceTime, { maximumDenominator: Number.MAX_SAFE_INTEGER });
			if (time.num < 0 || compareRationals(time, asset.duration) >= 0) throw new RangeError('Footage source time exceeds the retained duration.');
			motionSurfaceLength(asset.width, asset.height);
			const loaded = await source(asset, active);
			if (!loaded.video || await loaded.video.hasHighDynamicRange()) throw new Error('The retained footage must contain an SDR video track.');
			if (await loaded.video.getDisplayWidth() !== asset.width || await loaded.video.getDisplayHeight() !== asset.height) throw new Error('Decoded footage dimensions differ from the retained asset.');
			const { VideoSampleSink } = await import('mediabunny'); loaded.videoSink ??= new VideoSampleSink(loaded.video);
			const sample = await loaded.videoSink.getSample(time.num / time.den);
			if (!sample) { active.throwIfAborted(); return createMotionSurface(asset.width, asset.height); }
			try {
				active.throwIfAborted();
				if (sample.displayWidth !== asset.width || sample.displayHeight !== asset.height || sample.timestamp > time.num / time.den + 1e-7) throw new Error('Decoded footage sample does not match the requested source time or dimensions.');
				if (typeof OffscreenCanvas !== 'function') throw new Error('This browser cannot decode motion footage into an offscreen surface.');
				canvas ??= new OffscreenCanvas(asset.width, asset.height); canvas.width = asset.width; canvas.height = asset.height;
				const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
				if (!context) throw new Error('An SDR footage conversion surface is unavailable.');
				sample.draw(context, 0, 0, asset.width, asset.height);
				return motionSurfaceFromRgba8(asset.width, asset.height, context.getImageData(0, 0, asset.width, asset.height).data, 'srgb');
			} finally { sample.close(); }
		}, signal),
		dispose() { if (disposed) return; disposed = true; lifetime.abort(); drop(); if (canvas) { canvas.width = 1; canvas.height = 1; canvas = null; } },
	};
}
