/* SPDX-License-Identifier: AGPL-3.0-only */

/** Independent full-source reference: aggregate the multiplicity of each
 * source address in the clamped neighborhood, rather than executing taps.
 * Input and output are encoded, normalized straight RGBA. */
export function independentDefringeEncoded(source: readonly number[], width: number, purple: number, green: number, threshold: number): number[] {
	const height = source.length / (4 * width), output = [...source];
	const clamp = (value: number) => Math.min(1, Math.max(0, value));
	const luma = (offset: number) => (source[offset]! * 54 + source[offset + 1]! * 183 + source[offset + 2]! * 19) / 256;
	const violet = (offset: number) => Math.max(0, Math.min(source[offset]!, source[offset + 2]!) - source[offset + 1]!);
	const verdant = (offset: number) => Math.max(0, source[offset + 1]! - Math.max(source[offset]!, source[offset + 2]!));
	if (purple === 0 && green === 0) return output;
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const offset = 4 * (y * width + x); if (source[offset + 3] === 0) continue;
		const xs = [Math.max(0, x - 1), x, Math.min(width - 1, x + 1)], ys = [Math.max(0, y - 1), y, Math.min(height - 1, y + 1)];
		const xCounts = Array.from({ length: width }, (_, sx) => xs.filter(value => value === sx).length), yCounts = Array.from({ length: height }, (_, sy) => ys.filter(value => value === sy).length);
		const originalY = luma(offset), originalPurple = violet(offset), originalGreen = verdant(offset);
		let low = originalY, high = originalY, alpha = 0, purpleDifference = 0, greenDifference = 0;
		for (let sy = 0; sy < height; sy++) for (let sx = 0; sx < width; sx++) {
			const multiplicity = xCounts[sx]! * yCounts[sy]! - Number(sx === x && sy === y);
			if (multiplicity === 0) continue;
			const neighbor = 4 * (sy * width + sx), weight = multiplicity * source[neighbor + 3]!;
			if (weight === 0) continue;
			low = Math.min(low, luma(neighbor)); high = Math.max(high, luma(neighbor)); alpha += weight;
			purpleDifference += weight * (originalPurple - violet(neighbor)); greenDifference += weight * (originalGreen - verdant(neighbor));
		}
		const edge = clamp(4 * (high - low - threshold / 100));
		const weight = alpha === 0 ? 0 : clamp(edge * (purple / 100 * clamp(4 * purpleDifference / alpha) + green / 100 * clamp(4 * greenDifference / alpha)));
		if (weight !== 0) for (let channel = 0; channel < 3; channel++) output[offset + channel] = source[offset + channel]! + weight * (originalY - source[offset + channel]!);
	}
	return output;
}
