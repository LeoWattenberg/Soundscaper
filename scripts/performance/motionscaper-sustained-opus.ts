/* SPDX-License-Identifier: AGPL-3.0-only */
/** Qualification-only lossy oracle. It never changes production decoding or timestamps. */
import { MOTION_SUSTAINED_PLAN as plan } from './motionscaper-sustained-plan.ts';
const RATE = plan.sampleRate, PADDING = plan.webm.maximumAudioPaddingSamples,
	QUANTUM = plan.webm.maximumAlignmentQuantumSamples, CALIBRATION = plan.webm.calibrationSamples;
const reference = (index: number) => ((index % 127) - 63) / 128;
interface Moments { source: number; decoded: number; product: number; error: number }
const moments = (): Moments => ({ source: 0, decoded: 0, product: 0, error: 0 });
function add(sum: Moments, expected: number, actual: number): void {
	sum.source += expected * expected; sum.decoded += actual * actual; sum.product += expected * actual;
	sum.error += (expected - actual) ** 2;
}
function metrics(sum: Moments) {
	return { correlation: sum.product / Math.sqrt(sum.source * sum.decoded), error: Math.sqrt(sum.error / sum.source) };
}
export function readMotionSustainedOpusPreSkip(bytes: Uint8Array): number {
	if (bytes.length !== 19 || new TextDecoder().decode(bytes.subarray(0, 8)) !== 'OpusHead' || bytes[8] !== 1 || bytes[9] !== 2
		|| bytes[16] !== 0 || bytes[17] !== 0 || bytes[18] !== 0) throw new Error('Unsupported or absent Opus stereo identification header.');
	const preSkip = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(10, true);
	if (preSkip > PADDING) throw new Error('Opus priming exceeds the predeclared 40-ms admission.');
	return preSkip;
}
/** One bounded calibration chooses a fixed offset; every subsequent sample keeps that offset. */
export class MotionSustainedOpusOracle {
	readonly #expected: number; readonly #preSkip: number;
	readonly #initial = new Float32Array((PADDING + CALIBRATION) * 2);
	readonly #channels = [moments(), moments()];
	#samples = 0; #first = NaN; #end = NaN; #alignment: number | undefined;
	#compared = 0; #leading = 0; #trailing = 0;
	constructor(expectedSamples: number, preSkip: number) {
		if (![480000, 1920000].includes(expectedSamples) || !Number.isSafeInteger(preSkip) || preSkip < 0 || preSkip > PADDING) throw new Error('Opus reference admission differs.');
		this.#expected = expectedSamples; this.#preSkip = preSkip;
	}
	#consume(index: number, left: number, right: number): void {
		const sourceIndex = index + Math.round(this.#first * RATE) - this.#alignment!;
		if (sourceIndex < 0) { if (++this.#leading > PADDING) throw new Error('Opus leading padding exceeds admission.'); return; }
		if (sourceIndex >= this.#expected) { if (++this.#trailing > PADDING) throw new Error('Opus trailing padding exceeds admission.'); return; }
		const value = reference(sourceIndex); add(this.#channels[0]!, value, left); add(this.#channels[1]!, -value, right); this.#compared++;
	}
	#calibrate(): void {
		const offsets = new Set<number>();
		for (const origin of [0, this.#preSkip]) for (let delta = -QUANTUM; delta <= QUANTUM; delta++) offsets.add(origin + delta);
		let bestError = Infinity, best: number | undefined;
		for (const offset of offsets) {
			const channels = [moments(), moments()];
			for (let at = PADDING; at < PADDING + CALIBRATION; at++) {
				const sourceIndex = at + Math.round(this.#first * RATE) - offset;
				if (sourceIndex < 0) continue;
				const value = reference(sourceIndex); add(channels[0]!, value, this.#initial[at * 2]!); add(channels[1]!, -value, this.#initial[at * 2 + 1]!);
			}
			const values = channels.map(metrics), error = values.reduce((sum, value) => sum + value.error, 0);
			if (values.every(value => value.correlation >= plan.webm.minimumSourceCorrelation && value.error <= plan.webm.maximumNormalizedSourceError)
				&& (error < bestError || error === bestError && Math.abs(offset - this.#preSkip) < Math.abs(best! - this.#preSkip))) { bestError = error; best = offset; }
		}
		if (best === undefined) throw new Error('Opus source waveform cannot be authenticated within declared priming alignment.');
		this.#alignment = best;
		for (let at = 0; at < PADDING + CALIBRATION; at++) this.#consume(at, this.#initial[at * 2]!, this.#initial[at * 2 + 1]!);
	}
	write(left: Float32Array, right: Float32Array, timestamp: number): void {
		if (!left.length || left.length !== right.length || left.length > plan.webm.maximumDecodedAudioWindow || this.#samples + left.length > this.#expected + PADDING) throw new Error('Opus decoded window/count exceeds admission.');
		if (!Number.isFinite(timestamp) || this.#samples && Math.abs(timestamp - this.#end) > 0.001 + 1e-12) throw new Error('Opus timestamp gap/overlap exceeds one ms.');
		if (!this.#samples) { if (timestamp < -0.04 || timestamp > 0.001) throw new Error('Opus first timestamp exceeds admission.'); this.#first = timestamp; }
		for (let at = 0; at < left.length; at++) {
			const l = left[at]!, r = right[at]!, index = this.#samples + at;
			if (!Number.isFinite(l) || !Number.isFinite(r)) throw new Error('Non-finite Opus decoded sample.');
			if (index < PADDING + CALIBRATION) {
				this.#initial[index * 2] = l; this.#initial[index * 2 + 1] = r;
				if (index === PADDING + CALIBRATION - 1) this.#calibrate();
			} else this.#consume(index, l, r);
		}
		this.#samples += left.length; this.#end = timestamp + left.length / RATE;
	}
	finish() {
		const values = this.#channels.map(metrics);
		if (this.#alignment === undefined || this.#samples < this.#expected || this.#compared < this.#expected - PADDING
			|| this.#end < this.#expected / RATE || this.#end > this.#expected / RATE + 0.04
			|| values.some(value => !Number.isFinite(value.correlation) || value.correlation < plan.webm.minimumSourceCorrelation || value.error > plan.webm.maximumNormalizedSourceError)) throw new Error('Opus retained source waveform or coverage differs.');
		return { sourceAlignmentSamples: this.#alignment, declaredPreSkip: this.#preSkip, comparedSamples: this.#compared,
			leadingUncomparedSamples: this.#leading, trailingUncomparedSamples: this.#trailing,
			sourceCorrelation: values.map(value => value.correlation), normalizedSourceError: values.map(value => value.error) };
	}
}
