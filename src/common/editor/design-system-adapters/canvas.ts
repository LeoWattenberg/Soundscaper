import type { BoundedCanvasDimensions, CanvasDimensionOptions } from './types.ts';
import {
	finiteNumber,
	positiveFiniteNumber,
	positiveSafeInteger,
} from './validation.ts';

const DEFAULT_MAXIMUM_BACKING_SIZE = 8_192;
const DEFAULT_MAXIMUM_BACKING_PIXELS = 16_777_216;
const DEFAULT_MAXIMUM_PIXEL_RATIO = 2;

/** Calculate a bounded canvas backing allocation for CSS dimensions. */
export function boundedCanvasDimensions(
	cssWidth: number,
	cssHeight: number,
	options: CanvasDimensionOptions = {},
): BoundedCanvasDimensions {
	const width = positiveSafeInteger(Math.round(finiteNumber(cssWidth, 'cssWidth')), 'cssWidth');
	const height = positiveSafeInteger(Math.round(finiteNumber(cssHeight, 'cssHeight')), 'cssHeight');
	const maximumPixelRatio = positiveFiniteNumber(
		options.maximumPixelRatio ?? DEFAULT_MAXIMUM_PIXEL_RATIO,
		'maximumPixelRatio',
	);
	const requestedPixelRatio = Math.min(
		positiveFiniteNumber(options.devicePixelRatio ?? 1, 'devicePixelRatio'),
		maximumPixelRatio,
	);
	const maximumBackingWidth = positiveSafeInteger(
		Math.floor(options.maximumBackingWidth ?? DEFAULT_MAXIMUM_BACKING_SIZE),
		'maximumBackingWidth',
	);
	const maximumBackingHeight = positiveSafeInteger(
		Math.floor(options.maximumBackingHeight ?? DEFAULT_MAXIMUM_BACKING_SIZE),
		'maximumBackingHeight',
	);
	const maximumBackingPixels = positiveSafeInteger(
		Math.floor(options.maximumBackingPixels ?? DEFAULT_MAXIMUM_BACKING_PIXELS),
		'maximumBackingPixels',
	);

	const dimensionScale = Math.min(
		requestedPixelRatio,
		maximumBackingWidth / width,
		maximumBackingHeight / height,
	);
	const pixelScale = Math.sqrt(maximumBackingPixels / (width * height));
	const scale = Math.min(dimensionScale, pixelScale);
	const backingWidth = Math.max(1, Math.min(maximumBackingWidth, Math.floor(width * scale)));
	const backingHeight = Math.max(1, Math.min(maximumBackingHeight, Math.floor(height * scale)));

	return {
		cssWidth: width,
		cssHeight: height,
		backingWidth,
		backingHeight,
		requestedPixelRatio,
		pixelRatioX: backingWidth / width,
		pixelRatioY: backingHeight / height,
	};
}
