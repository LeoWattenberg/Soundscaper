/* SPDX-License-Identifier: AGPL-3.0-only */

/** Independent distance-from-center/exponential reference. Production uses
 * doubled integer coordinates and base-two exponentiation. */
export function opticalReferenceGain(amount: number, width: number, height: number, pixel: number): number {
	const dx = pixel % width + .5 - width / 2, dy = Math.floor(pixel / width) + .5 - height / 2;
	return Math.exp(Math.LN2 * amount / 50 * (dx * dx + dy * dy) / ((width * width + height * height) / 4));
}
export function opticalReferenceEncode(value: number): number {
	const n = Math.abs(value); return Math.sign(value) * (n <= .0031308 ? 12.92 * n : 1.055 * n ** (1 / 2.4) - .055);
}
export function opticalReferenceDecode(value: number): number {
	const n = Math.abs(value); return Math.sign(value) * (n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
}
export function independentOpticalByte(source: readonly number[], width: number, amount: number): number[] {
	const output = [...source], height = source.length / (width * 4);
	for (let p = 0; p < source.length / 4; p++) {
		const gain = opticalReferenceGain(amount, width, height, p);
		if (gain === 1 || source[p * 4 + 3] === 0) continue;
		for (let c = 0; c < 3; c++) output[p * 4 + c] = Math.round(255 * Math.min(1, Math.max(0,
			opticalReferenceEncode(opticalReferenceDecode(source[p * 4 + c]! / 255) * gain))));
	}
	return output;
}
export function independentOpticalNative(source: Float32Array<ArrayBuffer>, width: number, amount: number): Float32Array<ArrayBuffer> {
	const output = source.slice(), height = source.length / (width * 4);
	for (let p = 0; p < source.length / 4; p++) {
		if (source[p * 4 + 3] === 0) continue;
		const gain = opticalReferenceGain(amount, width, height, p);
		for (let c = 0; c < 3; c++) output[p * 4 + c] = source[p * 4 + c]! * gain;
	}
	return output;
}
