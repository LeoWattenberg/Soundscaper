/* SPDX-License-Identifier: AGPL-3.0-only */
import { MOTION_SUSTAINED_PLAN } from './motionscaper-sustained-plan.ts';

/** Streaming exact PCM oracle; its carry is at most one stereo sample (eight bytes). */
export class MotionSustainedPcmOracle {
	readonly #expected: number; readonly #carry = new Uint8Array(8); #carried = 0; #samples = 0;
	constructor(expectedSamples: number) {
		if (!Number.isSafeInteger(expectedSamples) || expectedSamples < 1 || expectedSamples > 1920000) throw new RangeError('Invalid sustained PCM sample admission.');
		this.#expected = expectedSamples;
	}
	write(bytes: Uint8Array): void {
		if (bytes.byteLength > MOTION_SUSTAINED_PLAN.maximumReadBytes) throw new RangeError('PCM read exceeds bounded reference window.');
		for (let offset = 0; offset < bytes.byteLength;) {
			const count = Math.min(8 - this.#carried, bytes.byteLength - offset);
			this.#carry.set(bytes.subarray(offset, offset + count), this.#carried); this.#carried += count; offset += count;
			if (this.#carried < 8) continue;
			if (this.#samples >= this.#expected) throw new RangeError('PCM exceeds sustained sample admission.');
			const view = new DataView(this.#carry.buffer), expected = (this.#samples % 127 - 63) / 128;
			for (let channel = 0; channel < 2; channel++) if (view.getFloat32(channel * 4, true) !== (channel ? -expected : expected)) {
				throw new Error(`PCM differs at sample ${this.#samples} channel ${channel}.`);
			}
			this.#samples++; this.#carried = 0;
		}
	}
	finish() {
		if (this.#carried || this.#samples !== this.#expected) throw new Error('Sustained PCM reference is incomplete.');
		return Object.freeze({ samples: this.#samples, channels: 2, sampleRate: 48000, exact: true });
	}
}
export interface MotionSustainedNativeMetadata {
	readonly width: number; readonly height: number; readonly frameCount: number; readonly selectedFrames: readonly number[];
	readonly firstTimestamp: Readonly<{ num: number; den: number }>; readonly lastTimestamp: Readonly<{ num: number; den: number }>;
	readonly contiguousFrameTimes: true; readonly profile: number; readonly colorDepth: number; readonly alphaDepth: number;
	readonly colorPrimaries: number; readonly colorTransfer: number; readonly colorSpace: number;
	readonly maximumReadBytes: number; readonly maximumPacketBytes: number;
	readonly audio: Readonly<{ sampleRate: number; channels: number; sampleCount: number; contiguous: true }>;
}
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Missing sustained native metadata.');
	return value as Record<string, unknown>;
}
function time(value: unknown, frame: number): boolean {
	const item = record(value);
	return Number.isSafeInteger(item.num) && Number.isSafeInteger(item.den) && Number(item.den) > 0
		&& BigInt(Number(item.num)) * 30n === BigInt(frame) * BigInt(Number(item.den));
}
export function inspectMotionSustainedNativeMetadata(value: unknown, frames: number, pictureBytes: number, pcmBytes: number): MotionSustainedNativeMetadata {
	if (frames !== 300 && frames !== 1200) throw new Error('Unknown sustained frame count.');
	const v = record(value), audio = record(v.audio);
	if (v.width !== 160 || v.height !== 90 || v.frameCount !== frames || v.profile !== 4
		|| !Number.isSafeInteger(v.colorDepth) || Number(v.colorDepth) < 10 || Number(v.colorDepth) > 16
		|| !Number.isSafeInteger(v.alphaDepth) || Number(v.alphaDepth) < 10 || Number(v.alphaDepth) > 16
		|| v.colorPrimaries !== 1 || v.colorTransfer !== 1 || v.colorSpace !== 1) throw new Error('Unexpected sustained native picture contract.');
	if (v.contiguousFrameTimes !== true || !time(v.firstTimestamp, 0) || !time(v.lastTimestamp, frames - 1)) throw new Error('Incomplete exact native frame timestamps.');
	if (!Array.isArray(v.selectedFrames) || v.selectedFrames.length !== 3 || v.selectedFrames.some((frame, index) => frame !== [0, frames / 2, frames - 1][index])) throw new Error('Incorrect selected native pictures.');
	if (pictureBytes !== 3 * 160 * 90 * 16) throw new Error('Unexpected sustained reference picture bytes.');
	if (!Number.isSafeInteger(v.maximumReadBytes) || Number(v.maximumReadBytes) < 1 || Number(v.maximumReadBytes) > 65536
		|| !Number.isSafeInteger(v.maximumPacketBytes) || Number(v.maximumPacketBytes) < 1 || Number(v.maximumPacketBytes) > 1024 * 1024) throw new Error('Native reference I/O/packet admission exceeded.');
	if (audio.sampleRate !== 48000 || audio.channels !== 2 || audio.sampleCount !== frames * 1600 || audio.contiguous !== true || pcmBytes !== frames * 1600 * 8) throw new Error('Incomplete native PCM bytes/timestamps.');
	return value as MotionSustainedNativeMetadata;
}
