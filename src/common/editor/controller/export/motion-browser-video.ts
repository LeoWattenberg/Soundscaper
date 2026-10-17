/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionOutputDestination, type MotionOutputDestinationOptions } from '../../motion-output-destination.ts';
import { motionVideoFrameTimestamp, normalizeMotionVideoAudio, normalizeMotionVideoDelivery, type MotionVideoAudioDelivery, type MotionVideoAudioOptions, type MotionVideoBackground, type MotionVideoFormat } from '../../motion-video-delivery.ts';
import { motionVideoI420Pixels } from '../../motion-video-planar.ts';
import type { MotionAudioMixBlock } from '../../motion-audio-contract.ts';
import { aggregateScapeErrors, throwIfScapeAborted } from '../../scape-abort.ts';
import { compareRationals, divideRationals } from '../../timeline-time.ts';
import type { VideoWebCodecsEncodedChunk } from '../../video-webcodecs-producer.ts';
import { normalizeMotionRenderPlan, type MotionRenderPlan, type MotionRenderSink } from './motion-render-pipeline.ts';
import { motionBrowserVideoHost } from './internal/motion-browser-video-host.ts';
import { createMotionBrowserAudioWriter } from './internal/motion-browser-audio-writer.ts';

export interface MotionVideoPacket {
	readonly bytes: Uint8Array<ArrayBuffer>; readonly type: 'key' | 'delta';
	readonly timestamp: number; readonly duration: number; readonly metadata?: EncodedVideoChunkMetadata;
}
export interface MotionVideoFrame { close(): void }
export interface MotionVideoEncoder {
	configure(config: VideoEncoderConfig): void; encode(frame: MotionVideoFrame, options: VideoEncoderEncodeOptions): void;
	flush(): Promise<void>; close(): void;
}
export interface MotionVideoHost {
	supported(config: VideoEncoderConfig): Promise<boolean>;
	supportedAudio(audio: MotionVideoAudioDelivery): Promise<boolean>;
	createFrame(bytes: Uint8Array<ArrayBuffer>, init: VideoFrameBufferInit): MotionVideoFrame;
	createEncoder(callbacks: { output(chunk: VideoWebCodecsEncodedChunk, metadata?: EncodedVideoChunkMetadata): void; error(error: unknown): void }): MotionVideoEncoder;
	createMuxer(format: MotionVideoFormat, plan: MotionRenderPlan, writable: WritableStream<Uint8Array>, audio?: MotionVideoAudioDelivery): Promise<{
		add(packet: MotionVideoPacket): Promise<void>; finish(): Promise<void>; cancel(): Promise<void>;
		addAudio?: (block: MotionAudioMixBlock, timestamp: number) => Promise<void>;
	}>;
}
export interface MotionBrowserVideoOptions extends Omit<MotionOutputDestinationOptions, 'mimeType'> {
	readonly plan: MotionRenderPlan; readonly format: MotionVideoFormat;
	readonly bitrate?: number; readonly background?: MotionVideoBackground; readonly signal?: AbortSignal;
	readonly audio?: MotionVideoAudioOptions;
}

/** One admitted frame and encoded packet at a time; packet indexes have a separate bounded admission. */
export async function createMotionBrowserVideoSink(options: MotionBrowserVideoOptions, host: MotionVideoHost = motionBrowserVideoHost): Promise<MotionRenderSink<Blob | null>> {
	const delivery = normalizeMotionVideoDelivery(options); const plan = normalizeMotionRenderPlan(delivery.plan);
	const audio = options.audio ? normalizeMotionVideoAudio(plan, delivery.format, options.audio) : undefined;
	throwIfScapeAborted(options.signal);
	const codecs = delivery.format === 'mp4' ? ['avc1.640034', 'avc1.64002a', 'avc1.42001f'] : ['vp09.00.10.08'];
	let config: VideoEncoderConfig | undefined;
	for (const codec of codecs) {
		const candidate: VideoEncoderConfig = { codec, width: plan.width, height: plan.height, framerate: plan.frameRate.num / plan.frameRate.den,
			bitrate: delivery.bitrate, latencyMode: 'quality', alpha: 'discard', ...(delivery.format === 'mp4' ? { avc: { format: 'avc' } as const } : {}) };
		if (await host.supported(candidate)) { config = candidate; break; }
		throwIfScapeAborted(options.signal);
	}
	throwIfScapeAborted(options.signal);
	if (!config) throw new Error(`No ${delivery.format === 'mp4' ? 'H.264' : 'VP9'} browser encoder supports this canvas and frame rate.`);
	if (audio && !await host.supportedAudio(audio)) throw new Error(`No ${audio.codec === 'aac' ? 'AAC' : 'Opus'} browser audio encoder supports this sample rate and channel layout. Choose another container.`);
	throwIfScapeAborted(options.signal);
	const destination = createMotionOutputDestination({ ...options, mimeType: `video/${delivery.format}` });
	let muxer: Awaited<ReturnType<MotionVideoHost['createMuxer']>>;
	try { muxer = await host.createMuxer(delivery.format, plan, new WritableStream<Uint8Array>({ write: (bytes) => destination.write(bytes) }), audio); }
	catch (error) {
		try { await destination.abort(error); } catch (failure) { throw aggregateScapeErrors(error, [failure], 'Motion container admission and cleanup failed.'); }
		throw error;
	}
	let encoded: MotionVideoPacket | null = null; let encoderFailure: unknown; let expectedTimestamp = 0; let expectedDuration = 0;
	const maximumPacketBytes = Math.min(32 * 1024 * 1024, plan.width * plan.height * 6 + 65536);
	let encoder: MotionVideoEncoder | undefined;
	let encoderClosed = false; let written = 0; let busy = false; let state: 'open' | 'finished' | 'aborted' = 'open';
	const assertOpen = (): void => { if (state !== 'open') throw new Error('Motion video sink is closed.'); throwIfScapeAborted(options.signal); };
	let audioWriter: ReturnType<typeof createMotionBrowserAudioWriter> | undefined;
	try {
		throwIfScapeAborted(options.signal);
		if (audio) audioWriter = createMotionBrowserAudioWriter(plan, audio, muxer.addAudio, () => { assertOpen(); if (busy) throw new Error('Motion video frame is in flight.'); }, () => written);
		encoder = host.createEncoder({ error(error) { encoderFailure = error; }, output(chunk, metadata) {
			try {
				if (encoded || chunk.timestamp !== expectedTimestamp || chunk.type !== 'key' || chunk.byteLength < 1 || chunk.byteLength > maximumPacketBytes) throw new Error('Motion encoder returned unexpected timing, packet count or excessive bytes.');
				const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
				encoded = { bytes, type: chunk.type, timestamp: expectedTimestamp, duration: expectedDuration, metadata };
			} catch (error) { encoderFailure = error; }
		} });
		encoder.configure(config);
	} catch (error) {
		const cleanup: unknown[] = [];
		try { encoder?.close(); } catch (failure) { cleanup.push(failure); }
		try { await muxer.cancel(); } catch (failure) { cleanup.push(failure); }
		try { await destination.abort(error); } catch (failure) { cleanup.push(failure); }
		throw aggregateScapeErrors(error, cleanup, 'Motion encoder admission and cleanup failed.');
	}
	const admittedEncoder = encoder;
	const closeEncoder = (): void => { if (!encoderClosed) { encoderClosed = true; admittedEncoder.close(); } };
	return {
		audio: audioWriter?.sink,
		async write(frame, signal) {
			assertOpen(); throwIfScapeAborted(signal);
			if (busy || frame.index !== written || written >= plan.frameCount) throw new Error('Motion video frames must arrive in declared sequential order.');
			audioWriter?.assertFrameReady(written + 1);
			if (frame.surface.width !== plan.width || frame.surface.height !== plan.height
				|| compareRationals(frame.time, divideRationals({ num: plan.firstFrame + written, den: 1 }, plan.frameRate)) !== 0
				|| compareRationals(frame.duration, divideRationals({ num: 1, den: 1 }, plan.frameRate)) !== 0) throw new Error('Motion video frame dimensions or timing changed.');
			busy = true;
			try {
				expectedTimestamp = motionVideoFrameTimestamp(written, plan.frameRate);
				expectedDuration = motionVideoFrameTimestamp(written + 1, plan.frameRate) - expectedTimestamp;
				encoded = null;
				const nativeFrame = host.createFrame(motionVideoI420Pixels(frame.surface, delivery.background), { format: 'I420', codedWidth: plan.width, codedHeight: plan.height,
					timestamp: expectedTimestamp, duration: expectedDuration, colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false } });
				try { admittedEncoder.encode(nativeFrame, { keyFrame: true }); await admittedEncoder.flush(); }
				finally { nativeFrame.close(); }
				throwIfScapeAborted(signal);
				if (encoderFailure) throw encoderFailure;
				if (!encoded) throw new Error('Motion encoder produced no complete video packet.');
				await muxer.add(encoded); encoded = null; throwIfScapeAborted(signal); written += 1;
			} finally { busy = false; }
		},
		async finish(signal) {
			assertOpen(); throwIfScapeAborted(signal);
			if (busy || written !== plan.frameCount || (audioWriter && !audioWriter.complete)) throw new Error('Motion video and audio must be complete before publication.');
			closeEncoder(); await muxer.finish(); throwIfScapeAborted(signal);
			const result = await destination.finish(); state = 'finished'; return result;
		},
		async abort(reason) {
			if (state !== 'open') return; state = 'aborted'; encoded = null;
			const cleanup: unknown[] = [];
			try { closeEncoder(); } catch (failure) { cleanup.push(failure); }
			try { await muxer.cancel(); } catch (failure) { cleanup.push(failure); }
			try { await destination.abort(reason); } catch (failure) { cleanup.push(failure); }
			if (cleanup.length) throw aggregateScapeErrors(cleanup[0], cleanup.slice(1), 'Motion video cleanup failed.');
		},
	};
}
