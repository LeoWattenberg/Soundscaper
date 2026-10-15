/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PixelFrameV1, PixelFrameLimitsV1 } from '../../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { readPixelFrameV1 } from '../../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../../common/editor/photo-library-develop-linear-port-v1.ts';
import type { LinearWorkingPixelFrameV1 } from '../../../common/editor/imaging/image-develop-linear-frame-v1.ts';
import { LinearDevelopOwnerV1 } from '../../../common/editor/imaging/image-develop-linear-owner-v1.ts';
import { captureLinearKernelDescriptorV1, linearKernelDecodedV1 } from '../../../common/editor/imaging/linear-kernel-planes-v1.ts';
import { prepareLinearExportResizeV1, writeLinearExportResizeV1 } from '../../../common/editor/imaging/pixel-frame-linear-export-resize-v1.ts';
import { prepareLinearGraphicOverlayV1, writeLinearGraphicOverlayV1 } from '../../../common/editor/imaging/pixel-frame-linear-graphic-overlay-v1.ts';
import { prepareLinearSpatialEffectV1, writeLinearSpatialEffectV1 } from '../../../common/editor/imaging/pixel-frame-linear-spatial-v1.ts';
import { withLinearPixelFrameDisplayV1 } from '../../../common/editor/imaging/pixel-frame-linear-display-v1.ts';
import { checkRepairSignalV1 } from '../../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { imageExportGraphicPlacement, type ImageExportGraphicRequest } from '../../../common/editor/image-export-graphic-request.ts';
import type { withImageExportTextFrameV1 } from '../../../common/editor/imaging/image-export-text-frame-v1.ts';
import { IMAGE_EXPORT_TEXT_FONT_V1 } from '../../../common/editor/imaging/image-export-text-font-v1.ts';
import type { PhotoRasterExportOutputCurrentV1 } from '../photo-raster-export-output-current-v1.ts';

/** Shared native Develop retains its own 768 MiB gate. This larger aggregate
 * includes the still-borrowed Original/rendered frame, a held mask-body scope,
 * graphic/glyph resources, two replacing output planes and the codec budget.
 * These are owned/borrowed byte bounds, not a claim about browser process RSS. */
export const PHOTO_RASTER_LINEAR_WORKING_BYTES_CURRENT_V1 = 1024 * 1024 * 1024;
const MASK_SCOPE_BYTES = 64 * 1024 * 1024, MAXIMUM_CODEC_BYTES = 256 * 1024 * 1024;
const GLYPH_WORKING_BYTES = IMAGE_EXPORT_TEXT_FONT_V1.byteLength + 2 * 16 * 1024 * 1024;
const BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'buffer')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

function physicalBytes(frames: readonly Readonly<PixelFrameV1>[]): number {
	const backings = new Set(frames.map(frame => Reflect.apply(BUFFER, frame.pixels, []) as ArrayBuffer));
	return [...backings].reduce((total, buffer) => total + Number(Reflect.apply(SIZE, buffer, [])), 0);
}

/** Explicit PNG16 also gives an encoded raster Original a linear Float32
 * Develop input. Default byte exports retain their permanent byte path. */
export async function withPhotoRasterLinearOriginalCurrentV1<Result>(source: Readonly<PixelFrameV1>, bitDepth: 8 | 16,
	consume: (input: Readonly<PixelFrameV1>) => Result | Promise<Result>, signal: AbortSignal): Promise<Result> {
	if (bitDepth !== 16 || source.descriptor.sampleFormat !== 'unorm8') return consume(source);
	if (source.descriptor.transfer !== 'srgb' || source.descriptor.primaries !== 'srgb') throw new RangeError('PNG16 raster promotion requires encoded sRGB bytes.');
	const descriptor = captureLinearKernelDescriptorV1({ ...source.descriptor, sampleFormat: 'float32', transfer: 'linear' });
	const owner = new LinearDevelopOwnerV1(physicalBytes([source]), PHOTO_RASTER_LINEAR_WORKING_BYTES_CURRENT_V1);
	return owner.run(async () => {
		const pixels = owner.floats(descriptor.width * descriptor.height * 4);
		// Capture before the first task, just as the native Develop owner does.
		for (let index = 0; index < pixels.length; index++) pixels[index] = index % 4 === 3 ? source.pixels[index]! / 255 : linearKernelDecodedV1(source.pixels[index]! / 255);
		checkRepairSignalV1(signal);
		const result = await consume(Object.freeze({ descriptor, pixels })); checkRepairSignalV1(signal); return result;
	});
}

interface NativeOutput {
	readonly frame: Readonly<PixelFrameV1>;
	readonly originals: readonly Readonly<PixelFrameV1>[];
	readonly output?: PhotoRasterExportOutputCurrentV1;
	readonly bitDepth: 8 | 16;
	readonly graphic: Readonly<PixelFrameV1> | null;
	readonly graphicWatermark?: Readonly<ImageExportGraphicRequest>;
	readonly withTextFrame?: typeof withImageExportTextFrameV1;
	/** Retained encoded Original and graphic scopes beyond listed plane backings. */
	readonly retainedSourceBytes?: number;
	readonly signal: AbortSignal;
	readonly current: () => void;
}

/** All output stages remain native Float32. Only the last delivery boundary
 * converts to byte sRGB for PNG8/JPEG; PNG16 receives native linear samples. */
export async function withPhotoRasterLinearOutputCurrentV1<Result>(request: NativeOutput,
	consume: (frame: Readonly<PixelFrameV1>, limits: Readonly<PixelFrameLimitsV1>, maximumOutputBytes: number,
		borrowed: readonly Readonly<PixelFrameV1>[]) => Result | Promise<Result>): Promise<Result> {
	request.current();
	const admitted = readPixelFrameV1(request.frame, PHOTO_DEVELOP_LINEAR_LIMITS_V1.render);
	const descriptor = captureLinearKernelDescriptorV1(admitted.descriptor);
	if (!(admitted.pixels instanceof Float32Array)) throw new TypeError('Native raster output requires a Float32 Develop frame.');
	const initial = Object.freeze({ descriptor, pixels: admitted.pixels });
	const borrowed = [...request.originals, initial, ...(request.graphic ? [request.graphic] : [])];
	const text = request.output?.textWatermark;
	const retained = request.retainedSourceBytes ?? 0;
	if (!Number.isSafeInteger(retained) || retained < 0 || retained > PHOTO_RASTER_LINEAR_WORKING_BYTES_CURRENT_V1) throw new RangeError('Native raster retained source storage is invalid.');
	const borrowedBytes = physicalBytes(borrowed) + retained + MASK_SCOPE_BYTES + (text?.opacity ? GLYPH_WORKING_BYTES : 0);
	const owner = new LinearDevelopOwnerV1(borrowedBytes, PHOTO_RASTER_LINEAR_WORKING_BYTES_CURRENT_V1);
	return owner.run(async () => {
		let frame: Readonly<LinearWorkingPixelFrameV1> = initial, backing: ArrayBuffer | null = null, ownedBytes = 0;
		const replace = (next: Float32Array<ArrayBuffer>, descriptor = frame.descriptor) => {
			if (backing) owner.retire(backing); backing = next.buffer; ownedBytes = next.byteLength;
			frame = Object.freeze({ descriptor, pixels: next });
		};
		if (request.output && request.output.sizing.kind !== 'original') {
			const plan = prepareLinearExportResizeV1(request.output.sizing, request.output.quality, frame.descriptor, PHOTO_DEVELOP_LINEAR_LIMITS_V1.render);
			const next = owner.floats(plan.sampleCount); await writeLinearExportResizeV1(plan, frame, next, request.signal); replace(next, plan.descriptor);
		}
		const sharpen = request.output?.sharpen;
		if (sharpen && sharpen.amount !== 0) {
			const plan = prepareLinearSpatialEffectV1({ id: 'photo-output-sharpen', type: 'detail-sharpen-v1', enabled: true, params: sharpen }, frame.descriptor);
			const next = owner.floats(frame.pixels.length), scratch = owner.bytes(plan.scratchBytes), scratchBacking = scratch.buffer;
			await writeLinearSpatialEffectV1(plan, frame.pixels, next, scratch, request.signal); owner.retire(scratchBacking); replace(next);
		}
		const mark = async (graphic: Readonly<PixelFrameV1>, settings: Parameters<typeof imageExportGraphicPlacement>[0]) => {
			const plan = prepareLinearGraphicOverlayV1(imageExportGraphicPlacement(settings, frame.descriptor.width, frame.descriptor.height), graphic.descriptor, frame.descriptor, PHOTO_DEVELOP_LINEAR_LIMITS_V1.render);
			const next = owner.floats(plan.sampleCount); await writeLinearGraphicOverlayV1(plan, frame, graphic, next, request.signal); replace(next);
		};
		if (request.graphic && request.graphicWatermark) await mark(request.graphic, request.graphicWatermark);
		const finish = async (glyph: Readonly<PixelFrameV1> | null): Promise<Result> => {
			request.current();
			const finalBorrowed = [...borrowed, frame, ...(glyph ? [glyph] : [])];
			const displayBytes = request.bitDepth === 8 ? frame.descriptor.width * frame.descriptor.height * 4 : 0;
			const maximumOutputBytes = Math.min(MAXIMUM_CODEC_BYTES, PHOTO_RASTER_LINEAR_WORKING_BYTES_CURRENT_V1 - borrowedBytes - ownedBytes - displayBytes);
			if (maximumOutputBytes < 1_048_576) throw new RangeError('Native raster output has no remaining codec storage budget.');
			const encode = async (delivery: Readonly<PixelFrameV1>): Promise<Result> => {
				request.current(); const result = await consume(delivery, PHOTO_DEVELOP_LINEAR_LIMITS_V1.render, maximumOutputBytes, [...finalBorrowed, delivery]); request.current(); return result;
			};
			return request.bitDepth === 16 ? encode(frame) : withLinearPixelFrameDisplayV1({ frame, signal: request.signal }, encode, 'full');
		};
		if (text?.opacity) {
			const withText = request.withTextFrame ?? (await import('../../../common/editor/imaging/image-export-text-frame-v1.ts')).withImageExportTextFrameV1;
			request.current();
			return withText({ text, width: frame.descriptor.width, height: frame.descriptor.height, signal: request.signal }, async glyph => {
				if (!glyph) throw new Error('Enabled native text export did not produce its glyph plane.');
				if (physicalBytes([glyph]) > GLYPH_WORKING_BYTES) throw new RangeError('Native text glyph exceeds its physical backing budget.');
				await mark(glyph, text); return finish(glyph);
			});
		}
		return finish(null);
	});
}
