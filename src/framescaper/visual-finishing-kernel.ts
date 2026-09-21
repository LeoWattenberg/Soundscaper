/* SPDX-License-Identifier: AGPL-3.0-only */

/** Multiply authored eight-bit mask planes with one quantizing round per plane. */
export function multiplyVisualMaskPlanes<Source>(
	sources: readonly Source[],
	pixelCount: number,
	evaluate: (source: Source) => Uint8Array,
): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(pixelCount).fill(255);
	for (const source of sources) {
		const value = evaluate(source);
		for (let index = 0; index < output.length; index += 1) {
			output[index] = Math.round(output[index]! * value[index]! / 255);
		}
	}
	return output;
}

/** Describe an unclipped, untransformed, fully opaque visual placement. */
export function identityVisualPlacement<BlendMode extends string>(
	width: number,
	height: number,
	blendMode: BlendMode,
) {
	return Object.freeze({
		crop: Object.freeze({
			normalized: Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 }),
			sourcePixels: Object.freeze({ x: 0, y: 0, width, height }),
		}),
		sourceDisplayToCanvas: Object.freeze([1, 0, 0, 1, 0, 0]),
		opacityStart: 1, opacityEnd: 1, blendMode, compositingOrder: 0,
	});
}
