/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StaffPadWasmRuntime } from '../../staffpad/runtime.js';
import { STANDARD_DELAY_STAFFPAD_BLOCK_FRAMES, standardDelayPitchDeliveryFrames, standardDelayPitchQueueFrames } from './delay-definition.ts';
import { reserveStandardDelayPitchNativeCapacity } from './delay-pitch-admission.ts';

/** Feed StaffPad at its requested hop boundary, independently of caller block
 * sizes. A fixed delivery reserve covers the largest ABI input hop. Native
 * algorithm latency remains in this stream and is compensated by the rack.
 */
export function createDelayPitchStream(runtime: StaffPadWasmRuntime, sampleRate: number,
	channelCount: number, semitones: number) {
	const sessions: ReturnType<StaffPadWasmRuntime['createSession']>[] = [];
	const input = Array.from({ length: channelCount }, () => new Float32Array(STANDARD_DELAY_STAFFPAD_BLOCK_FRAMES));
	const delivery = standardDelayPitchDeliveryFrames({ pitchShift: semitones }, sampleRate);
	const capacity = standardDelayPitchQueueFrames({ pitchShift: semitones }, sampleRate);
	const queued = Array.from({ length: channelCount }, () => new Float32Array(capacity));
	let received = 0;
	let read = 0;
	let write = delivery;
	let available = write;
	let required = 0;
	const releaseNative = reserveStandardDelayPitchNativeCapacity(runtime, sampleRate, channelCount, 1);
	function reset(): void {
		for (const session of sessions) session.destroy();
		sessions.length = 0;
		try {
			for (let channel = 0; channel < channelCount; channel += 2) {
				const session = runtime.createSession(sampleRate, Math.min(2, channelCount - channel), false);
				sessions.push(session);
				session.setParameters(1, 2 ** (semitones / 12));
			}
		} catch (error) {
			for (const session of sessions) session.destroy();
			sessions.length = 0;
			throw error;
		}
		for (const channel of queued) channel.fill(0);
		received = 0; read = 0; write = delivery; available = write;
		required = Math.min(runtime.maximumBlockSize, sessions[0].requiredInput());
	}
	try { reset(); }
	catch (error) { releaseNative(); throw error; }
	return {
		reset,
		dispose(): void { for (const session of sessions) session.destroy(); sessions.length = 0; releaseNative(); },
		processFrame(samples: Float64Array): void {
			for (let channel = 0; channel < channelCount; channel++) input[channel][received] = samples[channel];
			received++;
			if (received === required) {
				for (let group = 0; group < sessions.length; group++) sessions[group].feed(input.slice(group * 2, group * 2 + 2), 0, received);
				received = 0;
				const produced = sessions[0].availableOutput();
				if (produced + available > capacity) throw new RangeError('StaffPad delay output exceeded its bounded reserve.');
				let copied = 0;
				while (copied < produced) {
					const frames = Math.min(produced - copied, runtime.maximumBlockSize);
					for (let group = 0; group < sessions.length; group++) {
						const output = sessions[group].read(frames);
						for (let channel = 0; channel < output.length; channel++) {
							for (let frame = 0; frame < frames; frame++) queued[group * 2 + channel][(write + copied + frame) % capacity] = output[channel][frame];
						}
					}
					copied += frames;
				}
				write = (write + produced) % capacity;
				available += produced;
				required = Math.min(runtime.maximumBlockSize, sessions[0].requiredInput());
				if (required < 1 || required > STANDARD_DELAY_STAFFPAD_BLOCK_FRAMES) throw new RangeError('StaffPad delay reported an invalid input hop.');
			}
			if (available < 1) throw new Error('StaffPad delay exhausted its delivery reserve.');
			for (let channel = 0; channel < channelCount; channel++) samples[channel] = queued[channel][read];
			read = (read + 1) % capacity;
			available--;
		},
	};
}
