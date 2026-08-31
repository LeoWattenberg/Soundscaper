/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	REVIEWED_IMAGE_FORMATS,
	type ReviewedImageFormat,
} from './image-format-signature.ts';

/** A candidate is not usable until its exact runtime/format route is verified. */
export const IMAGE_DECODER_IDS = Object.freeze([
	'browser-native',
	'ffmpeg',
	'imagemagick-q16-hdri',
] as const);

export type ImageDecoderId = (typeof IMAGE_DECODER_IDS)[number];

export const IMAGE_COLOUR_ADMISSIONS = Object.freeze([
	'srgb-8-bit',
	'standardized-sdr-high-precision',
	'icc-sdr',
	'tagged-pq',
	'hlg',
	'scene-linear',
	'ambiguous',
	'contradictory',
] as const);

export type ImageColourAdmission = (typeof IMAGE_COLOUR_ADMISSIONS)[number];

export const IMAGE_TOPOLOGIES = Object.freeze([
	'single',
	'animated',
	'multipage',
	'renditions',
] as const);

export type ImageTopology = (typeof IMAGE_TOPOLOGIES)[number];

export type ImageNormalizationRecipe =
	| 'sdr-srgb-rgba8'
	| 'standardized-sdr-to-srgb-rgba8'
	| 'icc-relative-bpc-to-srgb-rgba8'
	| 'pq-mobius-to-srgb-rgba8';

export interface ImageDecoderRoutingRequest {
	readonly format: ReviewedImageFormat;
	readonly colour: ImageColourAdmission;
	readonly topology: ImageTopology;
	/** Exact verified routes active in this build, not runtime availability guesses. */
	readonly verifiedRoutes: readonly ImageDecoderVerifiedRoute[];
}

export interface ImageDecoderVerifiedRoute {
	readonly decoder: ImageDecoderId;
	readonly format: ReviewedImageFormat;
	readonly colour: ImageColourAdmission;
	readonly topology: ImageTopology;
}

export type ImageDecoderRoutingResult =
	| Readonly<{
		status: 'ready';
		decoder: ImageDecoderId;
		normalization: ImageNormalizationRecipe;
	}>
	| Readonly<{
		status: 'unavailable';
		reason: 'decoder-not-verified';
		candidates: readonly ImageDecoderId[];
	}>
	| Readonly<{
		status: 'rejected';
		reason: 'unsupported-colour';
		colour: 'hlg' | 'scene-linear' | 'ambiguous' | 'contradictory';
	}>;

const REQUEST_KEYS = new Set(['format', 'colour', 'topology', 'verifiedRoutes']);
const VERIFIED_ROUTE_KEYS = new Set(['decoder', 'format', 'colour', 'topology']);
const REVIEWED_FORMAT_SET = new Set<string>(REVIEWED_IMAGE_FORMATS);
const COLOUR_SET = new Set<string>(IMAGE_COLOUR_ADMISSIONS);
const TOPOLOGY_SET = new Set<string>(IMAGE_TOPOLOGIES);
const DECODER_SET = new Set<string>(IMAGE_DECODER_IDS);

const BROWSER_FORMATS = new Set<ReviewedImageFormat>([
	'jpeg', 'png', 'gif', 'webp', 'bmp', 'dib',
]);
const FFMPEG_SINGLE_FORMATS = new Set<ReviewedImageFormat>([
	'jpeg', 'png', 'gif', 'webp', 'bmp', 'dib',
	'tiff', 'bigtiff', 'jpeg2000', 'qoi', 'tga', 'pcx', 'openexr',
]);
const FFMPEG_ANIMATED_FORMATS = new Set<ReviewedImageFormat>(['png', 'gif', 'webp']);
const FFMPEG_MULTIPAGE_FORMATS = new Set<ReviewedImageFormat>(['tiff', 'bigtiff']);

/**
 * Resolve the layered decoder order without claiming an unverified runtime.
 *
 * The current FFmpeg list is deliberately narrower than its compiled decoder
 * inventory: AVIF/HEIF, ICO selection, Photoshop composite semantics, JXL,
 * and RAW remain on the future reviewed Q16-HDRI tier until fixture-verified.
 */
export function routeImageDecoder(requestValue: ImageDecoderRoutingRequest): ImageDecoderRoutingResult {
	const request = closedRequest(requestValue);
	const format = enumValue(
		dataProperty(request, 'format'), REVIEWED_FORMAT_SET, 'reviewed image format',
	) as ReviewedImageFormat;
	const colour = enumValue(
		dataProperty(request, 'colour'), COLOUR_SET, 'image colour admission',
	) as ImageColourAdmission;
	const topology = enumValue(
		dataProperty(request, 'topology'), TOPOLOGY_SET, 'image topology',
	) as ImageTopology;
	const verifiedRoutes = decoderVerifiedRoutes(dataProperty(request, 'verifiedRoutes'));
	if (colour === 'hlg' || colour === 'scene-linear'
		|| colour === 'ambiguous' || colour === 'contradictory') {
		return Object.freeze({ status: 'rejected', reason: 'unsupported-colour', colour });
	}

	const candidates: ImageDecoderId[] = [];
	if (colour === 'srgb-8-bit' && (topology === 'single' || topology === 'animated')
		&& BROWSER_FORMATS.has(format)) {
		candidates.push('browser-native');
	}
	if (colour !== 'icc-sdr' && ffmpegRouteSupports(format, topology)) {
		candidates.push('ffmpeg');
	}
	// The owning plan reviews this format family, but this candidate becomes
	// ready only after the Q16-HDRI build, delegate policy, fixtures, and caller
	// verification exists. No current production composition supplies it.
	if (!candidates.includes('imagemagick-q16-hdri')) {
		candidates.push('imagemagick-q16-hdri');
	}

	const decoder = candidates.find((candidate) => verifiedRoutes.has(routeKey(
		candidate, format, colour, topology,
	)));
	if (!decoder) {
		return Object.freeze({
			status: 'unavailable',
			reason: 'decoder-not-verified',
			candidates: Object.freeze(candidates),
		});
	}
	return Object.freeze({
		status: 'ready',
		decoder,
		normalization: normalizationFor(colour),
	});
}

function ffmpegRouteSupports(format: ReviewedImageFormat, topology: ImageTopology): boolean {
	if (topology === 'single') return FFMPEG_SINGLE_FORMATS.has(format);
	if (topology === 'animated') return FFMPEG_ANIMATED_FORMATS.has(format);
	if (topology === 'multipage') return FFMPEG_MULTIPAGE_FORMATS.has(format);
	return false;
}

function normalizationFor(colour: Exclude<
	ImageColourAdmission,
	'hlg' | 'scene-linear' | 'ambiguous' | 'contradictory'
>): ImageNormalizationRecipe {
	if (colour === 'srgb-8-bit') return 'sdr-srgb-rgba8';
	if (colour === 'standardized-sdr-high-precision') return 'standardized-sdr-to-srgb-rgba8';
	if (colour === 'icc-sdr') return 'icc-relative-bpc-to-srgb-rgba8';
	return 'pq-mobius-to-srgb-rgba8';
}

function decoderVerifiedRoutes(value: unknown): ReadonlySet<string> {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError('Verified image decoder routes must be an array.');
	}
	const output = new Set<string>();
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError('A verified image decoder route must be an ordinary data value.');
		}
		const record = closedVerifiedRoute(descriptor.value);
		const decoder = enumValue(
			dataProperty(record, 'decoder'), DECODER_SET, 'verified decoder route',
		) as ImageDecoderId;
		const format = enumValue(
			dataProperty(record, 'format'), REVIEWED_FORMAT_SET, 'verified image format',
		) as ReviewedImageFormat;
		const colour = enumValue(
			dataProperty(record, 'colour'), COLOUR_SET, 'verified image colour',
		) as ImageColourAdmission;
		const topology = enumValue(
			dataProperty(record, 'topology'), TOPOLOGY_SET, 'verified image topology',
		) as ImageTopology;
		const key = routeKey(decoder, format, colour, topology);
		if (output.has(key)) {
			throw new RangeError('Verified image decoder routes must be unique.');
		}
		output.add(key);
	}
	return output;
}

function routeKey(
	decoder: ImageDecoderId,
	format: ReviewedImageFormat,
	colour: ImageColourAdmission,
	topology: ImageTopology,
): string {
	return `${decoder}\u0000${format}\u0000${colour}\u0000${topology}`;
}

function closedVerifiedRoute(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A verified image decoder route must be a plain object.');
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('A verified image decoder route must be a plain object.');
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !VERIFIED_ROUTE_KEYS.has(key)) {
			throw new RangeError(`Unknown verified image decoder route field: ${String(key)}.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError('Verified image decoder route fields must be enumerable data properties.');
		}
	}
	return value as Record<string, unknown>;
}

function closedRequest(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('An image decoder routing request must be a plain object.');
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('An image decoder routing request must be a plain object.');
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !REQUEST_KEYS.has(key)) {
			throw new RangeError(`Unknown image decoder routing request field: ${String(key)}.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError('Image decoder routing request fields must be enumerable data properties.');
		}
	}
	return value as Record<string, unknown>;
}

function dataProperty(record: Record<string, unknown>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Image decoder routing request requires ${key}.`);
	}
	return descriptor.value;
}

function enumValue(value: unknown, values: ReadonlySet<string>, label: string): string {
	if (typeof value !== 'string' || !values.has(value)) throw new TypeError(`Unsupported ${label}.`);
	return value;
}
