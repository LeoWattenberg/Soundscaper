/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionVideoHost } from '../motion-browser-video.ts';
import { aggregateScapeErrors } from '../../../scape-abort.ts';

/** Use only browser-admitted codecs; the pinned muxer writes sequential fragmented containers. */
export const motionBrowserVideoHost: MotionVideoHost = {
	async supported(config) {
		if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return false;
		try { return (await VideoEncoder.isConfigSupported(config)).supported === true; } catch { return false; }
	},
	createFrame(bytes, init) { return new VideoFrame(bytes, init); },
	createEncoder(callbacks) {
		const encoder = new VideoEncoder(callbacks);
		return { configure: (config) => encoder.configure(config), encode: (frame, options) => encoder.encode(frame as VideoFrame, options),
			flush: () => encoder.flush(), close() { if (encoder.state !== 'closed') encoder.close(); } };
	},
	async createMuxer(format, plan, writable) {
		const { AppendOnlyStreamTarget, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output, WebMOutputFormat } = await import('mediabunny');
		const output = new Output({ target: new AppendOnlyStreamTarget(writable), format: format === 'mp4'
			? new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 0 })
			: new WebMOutputFormat({ appendOnly: true, minimumClusterDuration: 0 }) });
		const source = new EncodedVideoPacketSource(format === 'mp4' ? 'avc' : 'vp9');
		output.addVideoTrack(source, { frameRate: plan.frameRate.num / plan.frameRate.den, maximumPacketCount: plan.frameCount });
		try { await output.start(); } catch (error) {
			try { await output.cancel(); } catch (failure) { throw aggregateScapeErrors(error, [failure], 'Motion muxer admission and cleanup failed.'); }
			throw error;
		}
		let sequenceNumber = 0;
		return { async add(packet) {
			await source.add(new EncodedPacket(packet.bytes, packet.type, packet.timestamp / 1_000_000, packet.duration / 1_000_000, sequenceNumber++), packet.metadata);
		}, async finish() { source.close(); await output.finalize(); }, async cancel() {
			if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel();
		} };
	},
};
