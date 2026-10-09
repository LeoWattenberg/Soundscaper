/* SPDX-License-Identifier: AGPL-3.0-only */

// Independent small-fixture oracle. No production imports: IEEE amount
// quantization is intentional; all subsequent atmospheric arithmetic is BigInt.
export const DEHAZE_SOURCE_V1 = Object.freeze([64,96,128,255,128,160,192,255,160,160,160,255,224,192,96,255]);
export const DEHAZE_GOLDENS_V1 = Object.freeze([
	[100, [6,47,89,255,89,131,173,255,131,131,131,255,215,173,47,255]],
	[50, [39,75,111,255,111,147,184,255,147,147,147,255,220,184,75,255]],
	[37.125, [46,81,116,255,116,151,186,255,151,151,151,255,221,186,81,255]],
	[-100, [160,176,192,255,192,208,224,255,208,208,208,255,240,224,176,255]],
	[-50, [112,136,160,255,160,184,208,255,184,184,184,255,232,208,136,255]],
	[-37.125, [100,126,152,255,152,178,204,255,178,178,178,255,230,204,126,255]],
] as const);

const floor = (numerator: bigint, denominator: bigint) => numerator >= 0n ? numerator / denominator : -((-numerator + denominator - 1n) / denominator);

export function dehazeReferenceV1(source: readonly number[] | Uint8Array, width: number, amount: number): number[] {
	if (!Number.isInteger(width) || width < 1 || source.length === 0 || source.length % (4 * width) !== 0 || source.length > 4096 ||
		!Number.isFinite(amount) || amount < -100 || amount > 100 || Array.from(source).some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
		throw new RangeError('The independent Dehaze witness requires a bounded byte fixture.');
	}
	const height = source.length / (4 * width), gain = BigInt(Math.round(amount * 256 / 100));
	const effective = (n: number) => {
		const dark = BigInt(Math.min(source[n]!, source[n + 1]!, source[n + 2]!)), alpha = BigInt(source[n + 3]!);
		return (dark * alpha + 255n * (255n - alpha) + 127n) / 255n;
	};
	const result = Array.from(source);
	for (let pixel = 0; pixel < source.length / 4; pixel++) {
		const offset = pixel * 4;
		if (gain === 0n || source[offset + 3] === 0) continue;
		let transmission = 256n;
		if (gain > 0n) {
			let dark = 255n;
			for (let row = -1; row <= 1; row++) for (let column = -1; column <= 1; column++) {
				const x = Math.max(0, Math.min(width - 1, pixel % width + column));
				const y = Math.max(0, Math.min(height - 1, Math.floor(pixel / width) + row));
				const neighbor = effective(4 * (y * width + x)); if (neighbor < dark) dark = neighbor;
			}
			transmission -= dark * gain * 243n / 65280n; if (transmission < 26n) transmission = 26n;
		}
		for (let channel = 0; channel < 3; channel++) {
			const original = BigInt(source[offset + channel]!);
			const output = gain < 0n ? original + ((255n - original) * ((-gain * 128n + 128n) / 256n) + 128n) / 256n :
				255n + floor(2n * (original - 255n) * 256n + transmission, 2n * transmission);
			result[offset + channel] = Number(output < 0n ? 0n : output > 255n ? 255n : output);
		}
	}
	return result;
}
