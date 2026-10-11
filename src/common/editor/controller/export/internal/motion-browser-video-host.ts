/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionVideoHost } from '../motion-browser-video.ts';
import { aggregateScapeErrors } from '../../../scape-abort.ts';
import { assertMotionBrowserVideoProbeSafe } from './motion-browser-video-admission.ts';

/** Use only browser-admitted codecs; the pinned muxer writes sequential fragmented containers. */
export const motionBrowserVideoHost: MotionVideoHost = {
	async supported(config) {
		assertMotionBrowserVideoProbeSafe();
		if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return false;
		try { return (await VideoEncoder.isConfigSupported(config)).supported === true; } catch { return false; }
	},
	async supportedAudio(audio) {
		if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
		const { canEncodeAudio, Quality } = await import('mediabunny');
		return canEncodeAudio(audio.codec, { sampleRate: audio.sampleRate, numberOfChannels: audio.channels, quality: new Quality({ bitrate: audio.bitrate }) });
	},
	createFrame(bytes, init) { return new VideoFrame(bytes, init); },
	createEncoder(callbacks) {
		const encoder = new VideoEncoder(callbacks);
		return { configure: (config) => encoder.configure(config), encode: (frame, options) => encoder.encode(frame as VideoFrame, options),
			flush: () => encoder.flush(), close() { if (encoder.state !== 'closed') encoder.close(); } };
	},
	async createMuxer(format, plan, writable, audio) {
		const { AppendOnlyStreamTarget, AudioSample, AudioSampleSource, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output, Quality, WebMOutputFormat } = await import('mediabunny');
		const output = new Output({ target: new AppendOnlyStreamTarget(writable), format: format === 'mp4'
			? new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 0 })
			: new WebMOutputFormat({ appendOnly: true, minimumClusterDuration: 0 }) });
		const source = new EncodedVideoPacketSource(format === 'mp4' ? 'avc' : 'vp9');
		output.addVideoTrack(source, { frameRate: plan.frameRate.num / plan.frameRate.den, maximumPacketCount: plan.frameCount });
		let audioFailure: unknown; let audioPackets = 0;
		const audioSource = audio ? new AudioSampleSource({ codec: audio.codec, quality: new Quality({ bitrate: audio.bitrate }), onEncodedPacket(packet) {
			if (++audioPackets > audio.maximumPacketCount || packet.data.byteLength > 65536 || packet.data.byteLength < 1
				|| !Number.isFinite(packet.timestamp) || !Number.isFinite(packet.duration) || packet.duration <= 0) {
				audioFailure = new Error('Motion audio encoder exceeded its admitted packet count, bytes or timing.'); audioSource?.close();
			}
		} }) : undefined;
		if (audioSource && audio) output.addAudioTrack(audioSource, { maximumPacketCount: audio.maximumPacketCount });
		try { await output.start(); } catch (error) {
			try { await output.cancel(); } catch (failure) { throw aggregateScapeErrors(error, [failure], 'Motion muxer admission and cleanup failed.'); }
			throw error;
		}
		let sequenceNumber = 0;
		return { async add(packet) {
			if (audioFailure) throw audioFailure;
			await source.add(new EncodedPacket(packet.bytes, packet.type, packet.timestamp / 1_000_000, packet.duration / 1_000_000, sequenceNumber++), packet.metadata);
		}, addAudio: audioSource ? async (block, timestamp) => {
			if (audioFailure) throw audioFailure;
			// Compressed delivery has a finite full-scale range; keep float mix headroom until this boundary.
			const sample = new AudioSample({ data: Float32Array.from(block.interleaved, (value) => Math.min(1, Math.max(-1, value))),
				format: 'f32', sampleRate: block.sampleRate, numberOfChannels: block.channels, timestamp });
			try { await audioSource.add(sample); if (audioFailure) throw audioFailure; } finally { sample.close(); }
		} : undefined,
		async finish() {
			source.close(); audioSource?.close(); await output.finalize();
			if (audioFailure) throw audioFailure;
		}, async cancel() {
			if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel();
		} };
	},
};
