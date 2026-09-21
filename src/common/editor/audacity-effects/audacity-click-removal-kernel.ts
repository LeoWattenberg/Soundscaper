/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Audacity 3.7.7's Click Removal interpolation kernel, adapted from commit
 * 5ef610ed23260d6d648175735bb16b32536eb30b:
 * libraries/lib-builtin-effects/ClickRemovalBase.cpp by Craig DeForest.
 * Audacity distributes that work under GPL; this modified TypeScript
 * adaptation was created for kw.media in 2026 and selects GPL version 3.
 */

export function removeAudacityClicksFromWindowInPlace(
	buffer: Float32Array,
	threshold: number,
	maximumWidth: number,
	initialSeparation: number,
): number {
	const length = buffer.length;
	const centerOffset = Math.floor(initialSeparation / 2);
	let separation = 1;
	while (separation < initialSeparation) separation *= 2;
	const squares = new Float64Array(length);
	const meanSquares = new Float64Array(length - separation);
	const prefix = new Float64Array(length + 1);
	for (let index = 0; index < length; index += 1) {
		const square = buffer[index]! * buffer[index]!;
		squares[index] = square;
		prefix[index + 1] = prefix[index]! + square;
	}
	for (let index = 0; index < meanSquares.length; index += 1) {
		meanSquares[index] = (prefix[index + separation]! - prefix[index]!) / separation;
	}

	let left = 0;
	for (let reciprocal = Math.floor(maximumWidth / 4); reciprocal >= 1; reciprocal = Math.floor(reciprocal / 2)) {
		const width = Math.floor(maximumWidth / reciprocal);
		for (let index = 0; index < meanSquares.length; index += 1) {
			let localMeanSquare = 0;
			for (let offset = 0; offset < width; offset += 1) {
				localMeanSquare += squares[index + centerOffset + offset]!;
			}
			localMeanSquare /= width;
			if (localMeanSquare >= threshold * meanSquares[index]! / 10) {
				if (left === 0) left = index + centerOffset;
				continue;
			}

			const right = index + width + centerOffset;
			if (left !== 0 && index - left + centerOffset <= width * 2) {
				const leftValue = buffer[left]!;
				const rightValue = buffer[right]!;
				const span = right - left;
				for (let frame = left; frame < right; frame += 1) {
					buffer[frame] = (rightValue * (frame - left) + leftValue * (right - frame)) / span;
					squares[frame] = buffer[frame]! * buffer[frame]!;
				}
				left = 0;
			} else if (left !== 0) {
				left = 0;
			}
		}
	}
	return separation;
}
