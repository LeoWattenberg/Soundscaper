/* SPDX-License-Identifier: AGPL-3.0-only */

import { captureImageExportTextV1, type ImageExportTextV1 } from '../../../../image-export-text-v1.ts';
import { imageExportGraphicPlacement } from '../../../../image-export-graphic-request.ts';
import { readClosedDomainField as field } from '../../../../closed-domain-value.ts';
import { normalizeVideoColorContextV1 } from '../../../../video-color-management-v27.ts';
import { PIXEL_FRAME_HARD_LIMITS_V1 } from '../../../../imaging/pixel-frame-contract-v1.ts';
import type { withImageExportTextFrameV1 } from '../../../../imaging/image-export-text-frame-v1.ts';
import type { ProductVideoExportStrategyEncodeRequest } from '../../product-video-export-strategy.ts';

const MAXIMUM_WORKING_BYTES = 268_435_456;

/** Capture scalar text and its optional test/native port before service startup. */
export function captureVideoExportTextSettings(value: unknown, options: unknown) {
	const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'textWatermark') : undefined;
	if (descriptor && (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))) throw new TypeError('Export text must be an own data request.');
	const request = descriptor ? captureImageExportTextV1(descriptor.value) : undefined;
	const port = options && typeof options === 'object' ? Object.getOwnPropertyDescriptor(options, 'withImageExportTextFrame') : undefined;
	if (port && (!port.enumerable || !Object.hasOwn(port, 'value') || typeof port.value !== 'function')) throw new TypeError('Export text reader must be a captured method.');
	const reader = port ? Reflect.apply(Function.prototype.bind, port.value, [options]) as typeof withImageExportTextFrameV1 : undefined;
	return Object.freeze({ request, reader });
}

/** One private glyph mask spans the entire actual buffer/sink codec operation.
 * Previous picture postprocessors run first; text is an output-only last stage. */
export async function withVideoExportTextRequest<Result>(request: ProductVideoExportStrategyEncodeRequest,
	text: Readonly<ImageExportTextV1> | undefined,
	consume: (request: ProductVideoExportStrategyEncodeRequest) => Promise<Result>,
	withTextFrame?: typeof withImageExportTextFrameV1): Promise<Result> {
	if (!text || text.opacity === 0) return consume(request);
	const canonical = request.canonicalProject, primary = field(canonical, 'primarySequenceId', 'text export project');
	const contexts = field(canonical, 'videoColorContexts', 'text export project');
	if (!Array.isArray(contexts)) throw new TypeError('Text export requires the captured sequence color contexts.');
	const matches = contexts.filter((value: unknown) => value !== null && typeof value === 'object'
		&& field(value as Record<string, unknown>, 'sequenceId', 'text color context') === primary);
	if (matches.length !== 1) throw new Error('Text export requires one captured primary sequence color context.');
	const context = normalizeVideoColorContextV1(matches[0]);
	const reader = withTextFrame ?? (await import('../../../../imaging/image-export-text-frame-v1.ts')).withImageExportTextFrameV1;
	const mark = (await import('../../../../imaging/pixel-frame-graphic-watermark-v1.ts')).withGraphicWatermarkPixelFrameV1;
	const current = () => { request.signal.throwIfAborted(); request.assertCurrent(); request.signal.throwIfAborted(); };
	const canvas = request.plan.canvas as Readonly<{ width: number; height: number }>;
	current();
	return reader({ text, width: canvas.width, height: canvas.height, signal: request.signal }, async glyph => {
		current(); if (!glyph) throw new Error('Enabled video text did not produce its glyph plane.');
		const wrapped: ProductVideoExportStrategyEncodeRequest = Object.freeze({ ...request, rgbaPostprocessor: async value => {
			current(); if (request.rgbaPostprocessor) { await request.rgbaPostprocessor(value); current(); }
			if (value.rgba.buffer === glyph.pixels.buffer) throw new TypeError('Video text cannot alias the borrowed output plane.');
			if (value.width !== canvas.width || value.height !== canvas.height) throw new Error('Text frame dimensions differ from the captured delivery plan.');
			const frame = { descriptor: { schemaVersion: 1, width: value.width, height: value.height, sampleFormat: 'unorm8',
				primaries: context.outputSpace === 'rec709' ? 'bt709' : 'srgb', transfer: context.outputSpace === 'rec709' ? 'bt709' : 'srgb' }, pixels: value.rgba };
			await mark({ frame, graphic: glyph, placement: imageExportGraphicPlacement(text, value.width, value.height), signal: request.signal }, marked => {
				current(); if ([value.rgba.buffer, glyph.pixels.buffer].includes(marked.pixels.buffer)) throw new TypeError('Text video plane must be independently owned.');
				value.rgba.set(marked.pixels); current();
			}, { limits: PIXEL_FRAME_HARD_LIMITS_V1, maximumWorkingBytes: MAXIMUM_WORKING_BYTES - glyph.pixels.byteLength });
			current();
		} });
		const result = await consume(wrapped); current(); return result;
	});
}
