/* SPDX-License-Identifier: AGPL-3.0-only */

export { ComplementaryCrossover } from '../../complementary-crossover.ts';

export interface BandDynamicsOptions {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly params?: Readonly<Record<string, unknown>>;
}

export function validateGeometry(sampleRate: number, channelCount: number): void {
	if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
		throw new RangeError('The sample rate must be between 8000 and 384000 Hz.');
	}
	if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 32) {
		throw new RangeError('The channel count must be between 1 and 32.');
	}
}

/** Linked RMS detector, fixed 6 dB soft knee and attack/release gain smoothing. */
export class BandCompressor {
	private energy = 0;
	private reduction = 0;
	private readonly detector: number;
	private attack = 0;
	private release = 0;
	private threshold = 0;
	private slope = 0;
	private maximum = 60;
	constructor(private readonly rate: number) { this.detector = Math.exp(-1 / (0.001 * rate)); }
	configure(threshold: number, ratio: number, attack: number, release: number, maximum = 60): void {
		this.threshold = threshold;
		this.slope = 1 - 1 / ratio;
		this.attack = Math.exp(-1 / (attack * this.rate));
		this.release = Math.exp(-1 / (release * this.rate));
		this.maximum = maximum;
	}
	gain(power: number): number {
		this.energy = this.detector * this.energy + (1 - this.detector) * power;
		const over = 10 * Math.log10(Math.max(1e-30, this.energy)) - this.threshold;
		const knee = over <= -3 ? 0 : over >= 3 ? over : (over + 3) ** 2 / 12;
		const target = Math.min(this.maximum, knee * this.slope);
		const coefficient = target > this.reduction ? this.attack : this.release;
		this.reduction = coefficient * this.reduction + (1 - coefficient) * target;
		return 10 ** (-Math.min(this.maximum, this.reduction) / 20);
	}
	reset(): void { this.energy = 0; this.reduction = 0; }
}

export function validateChannels(channels: readonly Float32Array[], sampleRate: number): number {
	validateGeometry(sampleRate, channels.length);
	const frames = channels[0].length;
	for (const channel of channels) {
		if (!(channel instanceof Float32Array) || channel.length !== frames) {
			throw new TypeError('Every channel must be a Float32Array of the same length.');
		}
		if (!channel.every(Number.isFinite)) throw new TypeError('Audio samples must be finite.');
	}
	return frames;
}
