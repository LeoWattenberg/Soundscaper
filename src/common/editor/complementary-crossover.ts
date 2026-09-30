/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Bilinear one-pole crossover. Its high output is defined as input minus low,
 * so complementary bands reconstruct the dry sample exactly.
 */
export class ComplementaryCrossover {
	private readonly previous: Float64Array;
	private readonly state: Float64Array;
	private coefficient: number;
	private target: number;
	private readonly smoothing: number;

	constructor(private readonly rate: number, channels: number, frequency: number) {
		validateSampleRate(rate);
		const channelCount = validateChannelCount(channels);
		this.previous = new Float64Array(channelCount);
		this.state = new Float64Array(channelCount);
		this.coefficient = this.target = this.design(frequency);
		this.smoothing = 1 - Math.exp(-1 / (0.005 * rate));
	}

	private design(frequency: number): number {
		if (!Number.isFinite(frequency) || frequency < 0) {
			throw new RangeError('Crossover frequency must be finite and non-negative.');
		}
		const k = Math.tan(Math.PI * Math.min(frequency, this.rate * 0.45) / this.rate);
		return k / (1 + k);
	}

	configure(frequency: number): void { this.target = this.design(frequency); }
	tick(): void { this.coefficient += this.smoothing * (this.target - this.coefficient); }
	low(input: number, channel: number): number {
		const result = this.coefficient * (input + this.previous[channel]!)
			+ (1 - 2 * this.coefficient) * this.state[channel]!;
		this.previous[channel] = input;
		this.state[channel] = result;
		return result;
	}
	reset(): void {
		this.previous.fill(0);
		this.state.fill(0);
		this.coefficient = this.target;
	}
}

function validateSampleRate(value: number): void {
	if (!Number.isFinite(value) || value <= 0) {
		throw new RangeError('Crossover sample rate must be finite and positive.');
	}
}

function validateChannelCount(value: number): number {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError('Crossover channel count must be a positive safe integer.');
	}
	return value;
}
