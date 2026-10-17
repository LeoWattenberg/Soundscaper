/* SPDX-License-Identifier: AGPL-3.0-only */
/** Closed-case expectations use literal authored values, without importing the fixture/evaluator/mixer. */
export function motionMaximumIndexPixel(frame: number, x: number, y: number): readonly number[] {
	if (!Number.isSafeInteger(frame) || frame < 0 || frame >= 32768) throw new RangeError('Maximum-index oracle frame is outside the published range.');
	if (![x, y].every(value => Number.isSafeInteger(value) && value >= 0 && value < 16)) throw new RangeError('Maximum-index oracle pixel is outside its 16 by 16 picture.');
	if (x >= 8) return y < 8 ? [.25, .5, .125, 1] : [0, 0, 0, 0];
	const t = frame / 32767, alpha = .5 + .25 * t;
	return [(.08 + .54 * t) * alpha, (.2 + .12 * t) * alpha, (.62 - .54 * t) * alpha, alpha];
}

/** All samples are checked with eight bytes of carry, including every retained-source reset. */
export class MotionMaximumIndexPcmOracle {
	readonly #expected: number; readonly #carry = new Uint8Array(8); #carried = 0; #samples = 0;
	readonly #view = new DataView(this.#carry.buffer);
	constructor(expectedSamples = 52_428_800) {
		if (!Number.isSafeInteger(expectedSamples) || expectedSamples < 1 || expectedSamples > 52_428_800) throw new RangeError('Invalid maximum-index PCM sample admission.');
		this.#expected = expectedSamples;
	}
	write(bytes: Uint8Array): void {
		if (bytes.byteLength > 65536) throw new RangeError('Maximum-index PCM read exceeds its bounded reference window.');
		for (let offset = 0; offset < bytes.byteLength;) {
			const count = Math.min(8 - this.#carried, bytes.byteLength - offset);
			this.#carry.set(bytes.subarray(offset, offset + count), this.#carried); this.#carried += count; offset += count;
			if (this.#carried < 8) continue;
			if (this.#samples >= this.#expected) throw new RangeError('PCM exceeds maximum-index sample admission.');
			const expected = ((this.#samples % 1_920_000) % 127 - 63) / 128;
			for (let channel = 0; channel < 2; channel++) if (this.#view.getFloat32(channel * 4, true) !== (channel ? -expected : expected)) throw new Error(`PCM differs at sample ${this.#samples} channel ${channel}.`);
			this.#samples++; this.#carried = 0;
		}
	}
	finish() {
		if (this.#carried || this.#samples !== this.#expected) throw new Error('Maximum-index PCM reference is incomplete.');
		return Object.freeze({ samples: this.#samples, channels: 2, sampleRate: 48000, exact: true });
	}
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Missing maximum-index native metadata.');
	return value as Record<string, unknown>;
}
function time(value: unknown, frame: number): boolean {
	const item = record(value);
	return Number.isSafeInteger(item.num) && Number.isSafeInteger(item.den) && Number(item.den) > 0
		&& BigInt(Number(item.num)) * 30n === BigInt(frame) * BigInt(Number(item.den));
}
export function inspectMotionMaximumIndexMetadata(value: unknown, pictureBytes: number, pcmBytes: number) {
	const v = record(value), audio = record(v.audio);
	if (v.width !== 16 || v.height !== 16 || v.frameCount !== 32768 || v.profile !== 4
		|| !Number.isSafeInteger(v.colorDepth) || Number(v.colorDepth) < 10 || Number(v.colorDepth) > 16
		|| !Number.isSafeInteger(v.alphaDepth) || Number(v.alphaDepth) < 10 || Number(v.alphaDepth) > 16
		|| v.colorPrimaries !== 1 || v.colorTransfer !== 1 || v.colorSpace !== 1) throw new Error('Unexpected maximum-index native picture contract.');
	if (v.contiguousFrameTimes !== true || !time(v.firstTimestamp, 0) || !time(v.lastTimestamp, 32767)) throw new Error('Incomplete exact maximum-index native frame timestamps.');
	if (!Array.isArray(v.selectedFrames) || v.selectedFrames.length !== 3 || v.selectedFrames.some((frame, index) => frame !== [0, 16384, 32767][index])) throw new Error('Incorrect selected maximum-index native pictures.');
	if (pictureBytes !== 12288) throw new Error('Unexpected maximum-index reference picture bytes.');
	if (!Number.isSafeInteger(v.maximumReadBytes) || Number(v.maximumReadBytes) < 1 || Number(v.maximumReadBytes) > 65536
		|| !Number.isSafeInteger(v.maximumPacketBytes) || Number(v.maximumPacketBytes) < 1 || Number(v.maximumPacketBytes) > 1024 * 1024) throw new Error('Maximum-index native reference window/packet admission exceeded.');
	if (audio.sampleRate !== 48000 || audio.channels !== 2 || audio.sampleCount !== 52_428_800 || audio.contiguous !== true || pcmBytes !== 419430400) throw new Error('Incomplete maximum-index native PCM bytes/timestamps.');
	return v;
}
