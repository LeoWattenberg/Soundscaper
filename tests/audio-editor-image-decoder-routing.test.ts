/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	routeImageDecoder,
	type ImageDecoderId,
} from '../src/common/editor/image-decoder-routing.ts';

test('qualified common static sRGB8 files take the browser route first', () => {
	for (const format of ['jpeg', 'png', 'gif', 'webp', 'bmp', 'dib'] as const) {
		assert.deepEqual(route(format, 'srgb-8-bit', 'single', ['browser-native', 'ffmpeg']), {
			status: 'ready',
			decoder: 'browser-native',
			normalization: 'sdr-srgb-rgba8',
		}, format);
	}
});

test('FFmpeg is the explicit current route for standardized precision, PQ, and reviewed raster codecs', () => {
	for (const [format, colour, topology, normalization] of [
		['png', 'standardized-sdr-high-precision', 'single', 'standardized-sdr-to-srgb-rgba8'],
		['tiff', 'standardized-sdr-high-precision', 'multipage', 'standardized-sdr-to-srgb-rgba8'],
		['jpeg2000', 'tagged-pq', 'single', 'pq-mobius-to-srgb-rgba8'],
		['qoi', 'srgb-8-bit', 'single', 'sdr-srgb-rgba8'],
		['tga', 'srgb-8-bit', 'single', 'sdr-srgb-rgba8'],
		['pcx', 'srgb-8-bit', 'single', 'sdr-srgb-rgba8'],
		['openexr', 'tagged-pq', 'single', 'pq-mobius-to-srgb-rgba8'],
		['gif', 'srgb-8-bit', 'animated', 'sdr-srgb-rgba8'],
	] as const) {
		assert.deepEqual(route(format, colour, topology, ['ffmpeg']), {
			status: 'ready',
			decoder: 'ffmpeg',
			normalization,
		}, `${format}/${colour}/${topology}`);
	}
});

test('unimplemented ImageMagick-only tiers remain unavailable rather than looking supported', () => {
	for (const [format, colour, topology] of [
		['jpeg-xl', 'srgb-8-bit', 'single'],
		['heif', 'standardized-sdr-high-precision', 'single'],
		['psd', 'icc-sdr', 'single'],
		['dng', 'icc-sdr', 'single'],
		['jpeg', 'srgb-8-bit', 'multipage'],
		['ico', 'srgb-8-bit', 'renditions'],
	] as const) {
		assert.deepEqual(route(format, colour, topology, ['browser-native', 'ffmpeg']), {
			status: 'unavailable',
			reason: 'decoder-not-qualified',
			candidates: ['imagemagick-q16-hdri'],
		}, `${format}/${colour}/${topology}`);
	}
});

test('the future Magick route becomes selectable only through explicit qualification', () => {
	assert.deepEqual(route('jpeg-xl', 'icc-sdr', 'animated', ['imagemagick-q16-hdri']), {
		status: 'ready',
		decoder: 'imagemagick-q16-hdri',
		normalization: 'icc-relative-bpc-to-srgb-rgba8',
	});
});

test('HLG, scene-linear, ambiguous, and contradictory colour claims are terminal', () => {
	for (const colour of ['hlg', 'scene-linear', 'ambiguous', 'contradictory'] as const) {
		assert.deepEqual(route('openexr', colour, 'single', [
			'browser-native', 'ffmpeg', 'imagemagick-q16-hdri',
		]), {
			status: 'rejected',
			reason: 'unsupported-colour',
			colour,
		});
	}
});

test('an exact FFmpeg qualification cannot grant a route outside the reviewed codec map', () => {
	assert.deepEqual(route('avif', 'tagged-pq', 'single', ['ffmpeg']), {
		status: 'unavailable',
		reason: 'decoder-not-qualified',
		candidates: ['imagemagick-q16-hdri'],
	});
});

test('routing validates closed requests and unique known qualifications', () => {
	assert.throws(
		() => routeImageDecoder({
			format: 'png',
			colour: 'srgb-8-bit',
			topology: 'single',
			qualifiedRoutes: [
				qualification('ffmpeg', 'png', 'srgb-8-bit', 'single'),
				qualification('ffmpeg', 'png', 'srgb-8-bit', 'single'),
			],
		}),
		/unique/u,
	);
	assert.throws(
		() => routeImageDecoder({
			format: 'png',
			colour: 'srgb-8-bit',
			topology: 'single',
			qualifiedRoutes: [qualification('unknown' as never, 'png', 'srgb-8-bit', 'single')],
		}),
		/decoder qualification/u,
	);
	assert.throws(
		() => routeImageDecoder({
			format: 'png',
			colour: 'srgb-8-bit',
			topology: 'single',
			qualifiedRoutes: [],
			extra: true,
		} as never),
		/Unknown image decoder routing request field/u,
	);
});

function route(
	format: Parameters<typeof routeImageDecoder>[0]['format'],
	colour: Parameters<typeof routeImageDecoder>[0]['colour'],
	topology: Parameters<typeof routeImageDecoder>[0]['topology'],
	qualifiedDecoders: readonly ImageDecoderId[],
) {
	return routeImageDecoder({
		format,
		colour,
		topology,
		qualifiedRoutes: qualifiedDecoders.map((decoder) => (
			qualification(decoder, format, colour, topology)
		)),
	});
}

function qualification(
	decoder: ImageDecoderId,
	format: Parameters<typeof routeImageDecoder>[0]['format'],
	colour: Parameters<typeof routeImageDecoder>[0]['colour'],
	topology: Parameters<typeof routeImageDecoder>[0]['topology'],
) {
	return { decoder, format, colour, topology } as const;
}
