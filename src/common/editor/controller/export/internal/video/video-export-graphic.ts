/* SPDX-License-Identifier: AGPL-3.0-only */

import { captureImageExportGraphicRequest, imageExportGraphicPlacement, type ImageExportGraphicRequest } from '../../../../image-export-graphic-request.ts';
import { readClosedDomainField as field } from '../../../../closed-domain-value.ts';
import { normalizeVideoColorContextV1 } from '../../../../video-color-management-v27.ts';
import { PIXEL_FRAME_HARD_LIMITS_V1 } from '../../../../imaging/pixel-frame-contract-v1.ts';
import type { withImageExportGraphicFrameV1 } from '../../../../imaging/image-export-graphic-source-v1.ts';
import type { ProductVideoExportStrategyEncodeRequest } from '../../product-video-export-strategy.ts';

const MAXIMUM_WORKING_BYTES = 268_435_456;

/** Capture the ephemeral request and original reader receiver before the first service await. */
export function captureVideoExportGraphicSettings(value: unknown, options: unknown) {
	const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'graphicWatermark') : undefined;
	if (descriptor && (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))) throw new TypeError('Export graphic must be an own data request.');
	const request = descriptor ? captureImageExportGraphicRequest(descriptor.value) : undefined;
	const port = options && typeof options === 'object' ? Object.getOwnPropertyDescriptor(options, 'withImageExportGraphicFrame') : undefined;
	if (port && (!port.enumerable || !Object.hasOwn(port, 'value') || typeof port.value !== 'function')) throw new TypeError('Export graphic reader must be a captured method.');
	const reader = port ? Reflect.apply(Function.prototype.bind, port.value, [options]) as typeof withImageExportGraphicFrameV1 : undefined;
	return Object.freeze({ request, reader });
}

/** Hold the selected graphic through the complete product codec operation. Its
 * profile comes from the same captured canonical primary sequence used by the
 * product plan, never the currently viewed sequence or an unrelated context. */
export async function withVideoExportGraphicRequest<Result>(request: ProductVideoExportStrategyEncodeRequest,
	graphicRequest: Readonly<ImageExportGraphicRequest> | undefined,
	consume: (request: ProductVideoExportStrategyEncodeRequest) => Promise<Result>,
	withGraphicFrame?: typeof withImageExportGraphicFrameV1): Promise<Result> {
	if (!graphicRequest || graphicRequest.opacity === 0) return consume(request);
	const canonical = request.canonicalProject, primary = field(canonical, 'primarySequenceId', 'graphic export project');
	const contexts = field(canonical, 'videoColorContexts', 'graphic export project');
	if (!Array.isArray(contexts)) throw new TypeError('Graphic export requires the captured sequence color contexts.');
	const matches = contexts.filter((value: unknown) => value !== null && typeof value === 'object'
		&& field(value as Record<string, unknown>, 'sequenceId', 'graphic color context') === primary);
	if (matches.length !== 1) throw new Error('Graphic export requires one captured primary sequence color context.');
	const context = normalizeVideoColorContextV1(matches[0]);
	const reader = withGraphicFrame ?? (await import('../../../../imaging/image-export-graphic-source-v1.ts')).withImageExportGraphicFrameV1;
	const mark = (await import('../../../../imaging/pixel-frame-graphic-watermark-v1.ts')).withGraphicWatermarkPixelFrameV1;
	const current = () => { request.signal.throwIfAborted(); request.assertCurrent(); request.signal.throwIfAborted(); };
	current();
	return reader({ body: graphicRequest.body, signal: request.signal }, async graphic => {
		current();
		const wrapped: ProductVideoExportStrategyEncodeRequest = Object.freeze({ ...request, rgbaPostprocessor: async value => {
			current(); if (request.rgbaPostprocessor) { await request.rgbaPostprocessor(value); current(); }
			if (value.rgba.buffer === graphic.pixels.buffer) throw new TypeError('Video graphic cannot alias the borrowed output plane.');
			const canvas = request.plan.canvas as Readonly<{ width: number; height: number }>;
			if (value.width !== canvas.width || value.height !== canvas.height) throw new Error('Graphic frame dimensions differ from the captured delivery plan.');
			const frame = { descriptor: { schemaVersion: 1, width: value.width, height: value.height, sampleFormat: 'unorm8',
				primaries: context.outputSpace === 'rec709' ? 'bt709' : 'srgb', transfer: context.outputSpace === 'rec709' ? 'bt709' : 'srgb' }, pixels: value.rgba };
			await mark({ frame, graphic, placement: imageExportGraphicPlacement(graphicRequest, value.width, value.height), signal: request.signal }, marked => {
				current(); if ([value.rgba.buffer, graphic.pixels.buffer].includes(marked.pixels.buffer)) throw new TypeError('Marked video plane must be independently owned.');
				value.rgba.set(marked.pixels); current();
			}, { limits: PIXEL_FRAME_HARD_LIMITS_V1, maximumWorkingBytes: MAXIMUM_WORKING_BYTES - graphic.pixels.byteLength });
			current();
		} });
		const result = await consume(wrapped); current(); return result;
	});
}
