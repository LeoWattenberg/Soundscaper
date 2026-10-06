/* SPDX-License-Identifier: AGPL-3.0-only */
import { DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_FRAMES, type DesktopAudioStreamPlan } from '../../../desktop/desktop-audio-stream-contract.ts';
import { assertFfmpegOutputReady, type FfmpegOutputStreamOptions } from './ffmpeg-output-stream.ts';
import { writeInterleavedFloat32Pcm } from './interleaved-float32-pcm.ts';

export type DesktopPcmStreamWrite = (channels: readonly Float32Array[]) => Promise<void>;
/** Each write borrows its input until the returned acknowledgement settles. */
export type DesktopPcmStreamProducer = (write: DesktopPcmStreamWrite) => Promise<void>;

/** Coalesce small render quanta, splitting larger windows, with one native write in flight. */
export async function writeDesktopPcmStream(produce: DesktopPcmStreamProducer, plan: DesktopAudioStreamPlan,
	settings: FfmpegOutputStreamOptions, write: (bytes: Uint8Array) => Promise<void>,
): Promise<void> {
	const capacity = DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_FRAMES;
	const scratch = Array.from({ length: plan.tuple.channelCount }, () => new Float32Array(capacity));
	let buffered = 0; let received = 0;
	let pending: Promise<void> | null = null; let packetFailure: unknown; let failedPacket = false;
	const flush = async (): Promise<void> => {
		if (!buffered) return;
		assertFfmpegOutputReady(settings);
		const bytes = new Uint8Array(buffered * scratch.length * 4);
		// The established preserve mapping adds each sample to +0 before encoding.
		// Match its signed-zero normalization as well as float WAV nonfinite handling.
		for (const channel of scratch) for (let index = 0; index < buffered; index++) if (channel[index] === 0) channel[index] = 0;
		writeInterleavedFloat32Pcm(bytes, scratch, { frameCount: buffered, nonFinite: 'zero' });
		await write(bytes); assertFfmpegOutputReady(settings); buffered = 0;
	};
	const accept = async (channels: readonly Float32Array[]): Promise<void> => {
		assertFfmpegOutputReady(settings);
		if (!Array.isArray(channels) || channels.length !== scratch.length
			|| channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== channels[0]?.length)) {
			throw new RangeError('Desktop PCM stream channel geometry changed.');
		}
		const frames = channels[0]!.length;
		if (frames > plan.frameCount - received) throw new RangeError('Desktop PCM stream frame count exceeds its plan.');
		received += frames;
		{
			for (let first = 0; first < frames;) {
				const count = Math.min(capacity - buffered, frames - first);
				for (let channel = 0; channel < scratch.length; channel++) scratch[channel]!.set(channels[channel]!.subarray(first, first + count), buffered);
				buffered += count; first += count;
				if (buffered === capacity) await flush();
			}
		}
	};
	let producerFailure: unknown; let failedProducer = false;
	try {
		await produce((channels) => {
			if (pending) {
				const error = new Error('Desktop PCM producers must await each write acknowledgement.');
				failedPacket = true; packetFailure = error;
				const rejected = Promise.reject<void>(error); void rejected.catch(() => undefined); return rejected;
			}
			const operation = accept(channels); pending = operation;
			void operation.then(() => { pending = null; }, (error: unknown) => {
				pending = null; failedPacket = true; packetFailure = error;
			});
			return operation;
		});
	} catch (error) { failedProducer = true; producerFailure = error; }
	const unacknowledged = pending !== null;
	if (pending) { try { await pending; } catch { /* The primary packet failure is retained above. */ } }
	if (failedProducer) throw producerFailure;
	if (failedPacket) throw packetFailure;
	if (unacknowledged) throw new Error('Desktop PCM producers must await each write acknowledgement.');
	assertFfmpegOutputReady(settings);
	if (received !== plan.frameCount) throw new RangeError('Desktop PCM stream frame count does not match its plan.');
	await flush();
}
