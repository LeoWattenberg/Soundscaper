/* SPDX-License-Identifier: AGPL-3.0-only */
/** Loaded only into a separate verification page after application memory phases have closed. */
import { AudioSampleSink, CustomSource, Input, VideoSampleSink, WEBM } from 'mediabunny';
import { sha256 } from '@noble/hashes/sha2.js';
import { MotionSustainedOpusOracle, readMotionSustainedOpusPreSkip } from './motionscaper-sustained-opus.ts';
import { MOTION_SUSTAINED_PLAN as plan } from './motionscaper-sustained-plan.ts';

export interface MotionSustainedVideoReference { readonly index: number; readonly rgba: readonly number[] }
export async function verifyMotionSustainedWebm(file: File, frames: 300 | 1200, references: readonly MotionSustainedVideoReference[]) {
	if (file.size > 512 * 1024 * 1024 || !file.size || references.length !== 3
		|| references.some((value, index) => value.index !== [0, frames / 2, frames - 1][index] || value.rgba.length !== 160 * 90 * 4)) throw new Error('WebM reference admission differs.');
	let maximumReadBytes = 0, readCalls = 0;
	const hash = async () => {
		const digest = sha256.create();
		for (let offset = 0; offset < file.size; offset += 65536) {
			const bytes = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + 65536)).arrayBuffer());
			maximumReadBytes = Math.max(maximumReadBytes, bytes.length); readCalls++; digest.update(bytes);
		}
		return [...digest.digest()].map(value => value.toString(16).padStart(2, '0')).join('');
	};
	const sourceSha256 = await hash();
	const source = new CustomSource({ getSize: () => file.size, maxCacheSize: 65536, prefetchProfile: 'none', read(start, end) {
		let offset = start;
		return new ReadableStream<Uint8Array>({ async pull(controller) {
			if (offset >= end) { controller.close(); return; }
			const length = Math.min(65536, end - offset), bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
			if (bytes.length !== length) throw new Error('WebM reference source changed during bounded read.');
			maximumReadBytes = Math.max(maximumReadBytes, length); readCalls++; offset += length; controller.enqueue(bytes);
		} }, { highWaterMark: 0 });
	} });
	const input = new Input({ source, formats: [WEBM] });
	try {
		const video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
		if (!video || !audio || video.codec !== 'vp9' || audio.codec !== 'opus' || video.displayWidth !== 160 || video.displayHeight !== 90
			|| audio.sampleRate !== 48000 || audio.numberOfChannels !== 2) throw new Error('Sustained WebM codec/track admission differs.');
		const config = await audio.getDecoderConfig(), description = config?.description;
		if (!description) throw new Error('WebM lacks an authenticated Opus header.');
		const header = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description);
		const sourceOracle = new MotionSustainedOpusOracle(frames * 1600, readMotionSustainedOpusPreSkip(header));
		let pictures = 0, maximumTimestampError = 0, squareError = 0, comparedChannels = 0, maximumInteriorError = 0;
		const selectedDigests: { index: number; sha256: string }[] = [];
		for await (const sample of new VideoSampleSink(video).samples()) {
			try {
				if (pictures >= frames || !Number.isFinite(sample.timestamp)) throw new Error('Unexpected WebM picture count/timestamp.');
				maximumTimestampError = Math.max(maximumTimestampError, Math.abs(sample.timestamp - pictures / 30));
				if (maximumTimestampError > 0.001 + 1e-12) throw new Error('WebM exceeds its one-ms timestamp quantum.');
				const reference = references.find(value => value.index === pictures);
				if (reference) {
					const size = sample.allocationSize({ format: 'RGBA' }); if (size !== 160 * 90 * 4) throw new Error('WebM decoded picture layout differs.');
					const pixels = new Uint8Array(size); await sample.copyTo(pixels, { format: 'RGBA' });
					const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', pixels));
					selectedDigests.push({ index: pictures, sha256: [...digest].map(value => value.toString(16).padStart(2, '0')).join('') });
					for (let y = 0; y < 90; y++) for (let x = 0; x < 160; x++) {
						const at = (y * 160 + x) * 4; if (pixels[at + 3] !== 255) throw new Error('Opaque WebM alpha differs.');
						let interior = x >= 2 && y >= 2 && x < 158 && y < 88;
						if (interior) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
							for (let c = 0; c < 3; c++) if (reference.rgba[((y + dy) * 160 + x + dx) * 4 + c] !== reference.rgba[at + c]) interior = false;
						}
						for (let c = 0; c < 3; c++) {
							const error = Math.abs(pixels[at + c]! - reference.rgba[at + c]!); squareError += error * error; comparedChannels++;
							if (interior) maximumInteriorError = Math.max(maximumInteriorError, error);
						}
					}
				}
				pictures++;
			} finally { sample.close(); }
		}
		const rmsPictureError = Math.sqrt(squareError / comparedChannels);
		if (pictures !== frames || comparedChannels !== 3 * 160 * 90 * 3 || rmsPictureError > plan.webm.maximumPictureRmsCodes || maximumInteriorError > plan.webm.maximumInteriorCodeError) throw new Error('WebM picture reference exceeds predeclared limits.');
		if (new Set(selectedDigests.map(value => value.sha256)).size !== 3) throw new Error('WebM selected pictures did not change.');
		let samples = 0, firstTimestamp = Infinity, audioEnd = 0, leftEnergy = 0, rightEnergy = 0, crossEnergy = 0, peak = 0;
		for await (const sample of new AudioSampleSink(audio).samples()) {
			try {
				if (sample.numberOfFrames > plan.webm.maximumDecodedAudioWindow || sample.sampleRate !== 48000 || sample.numberOfChannels !== 2
					|| !Number.isFinite(sample.timestamp) || samples + sample.numberOfFrames > frames * 1600 + plan.webm.maximumAudioPaddingSamples) throw new Error('WebM decoded audio exceeds admission.');
				if (samples && Math.abs(sample.timestamp - audioEnd) > 0.001 + 1e-12) throw new Error('WebM audio timestamp gap/overlap exceeds one ms.');
				firstTimestamp = Math.min(firstTimestamp, sample.timestamp); audioEnd = sample.timestamp + sample.duration;
				const left = new Float32Array(sample.numberOfFrames), right = new Float32Array(sample.numberOfFrames);
				sample.copyTo(left, { planeIndex: 0, format: 'f32-planar' }); sample.copyTo(right, { planeIndex: 1, format: 'f32-planar' });
				sourceOracle.write(left, right, sample.timestamp);
				for (let index = 0; index < left.length; index++) {
					const l = left[index]!, r = right[index]!; if (!Number.isFinite(l) || !Number.isFinite(r)) throw new Error('Non-finite Opus sample.');
					leftEnergy += l * l; rightEnergy += r * r; crossEnergy += l * r; peak = Math.max(peak, Math.abs(l), Math.abs(r));
				}
				samples += sample.numberOfFrames;
			} finally { sample.close(); }
		}
		const rms = [Math.sqrt(leftEnergy / samples), Math.sqrt(rightEnergy / samples)], correlation = crossEnergy / Math.sqrt(leftEnergy * rightEnergy);
		if (samples < frames * 1600 || firstTimestamp < -0.04 || firstTimestamp > 0.001 || audioEnd < frames / 30 || audioEnd > frames / 30 + 0.04
			|| rms.some(value => value < plan.webm.minimumAudioRms || value > plan.webm.maximumAudioRms) || !Number.isFinite(correlation)
			|| correlation > plan.webm.maximumOppositeChannelCorrelation || peak > plan.webm.maximumAudioPeak) throw new Error('Lossy Opus timing/channel/energy reference differs.');
		if (await hash() !== sourceSha256) throw new Error('WebM File snapshot changed during decode.');
		return { sourceSha256, sourceByteLength: file.size, codec: 'vp9', audioCodec: 'opus', pictures, selectedDigests, maximumTimestampError, rmsPictureError, maximumInteriorError, maximumReadBytes, readCalls,
			sampleRate: 48000, channels: 2, samples, firstTimestamp, audioEnd, rms, correlation, peak, source: sourceOracle.finish(), exactPcm: false };
	} finally { input.dispose(); }
}
