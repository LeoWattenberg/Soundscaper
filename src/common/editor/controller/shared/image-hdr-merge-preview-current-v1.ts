/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PixelFrameDescriptorV1 } from '../../imaging/pixel-frame-contract-v1.ts';
import { withDecodedImageHdrOriginalV1 } from '../../imaging/image-hdr-original-v1.ts';
import type { ImageHdrRadianceDiagnosticsV1 } from '../../imaging/image-hdr-radiance-v1.ts';
import { withLinearPixelFrameDisplayV1 } from '../../imaging/pixel-frame-linear-display-v1.ts';
import { fitPixelSizeV1 } from '../../imaging/pixel-frame-resize-v1.ts';
import type { ImageHdrMergePortsCurrentV1 } from './image-hdr-merge-current-v1.ts';
import { captureImageHdrMergeCurrentV1 } from './internal/image-hdr-merge-capture-current-v1.ts';
import { withCapturedImageHdrMergeCurrentV1 } from './internal/image-hdr-merge-owner-current-v1.ts';

export interface ImageHdrMergePreviewCurrentV1 {
	readonly frame: Readonly<{
		descriptor: Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'unorm8'; primaries: 'srgb'; transfer: 'srgb' }>;
		pixels: Uint8Array<ArrayBuffer>;
	}>;
	/** The native output extent/profile, before fitted display conversion. */
	readonly descriptor: Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'float32'; primaries: 'srgb'; transfer: 'linear' }>;
	readonly diagnostics: Readonly<ImageHdrRadianceDiagnosticsV1>;
}
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const MAXIMUM_WORKING = 1024n * 1024n * 1024n, RESERVE = 32n * 1024n * 1024n;

/** Preview evaluates the actual canonical merge. Sources, guides, master and
 * staging retire first; the lossless result then supplies the existing fitted
 * display boundary. No catalog, import journal or publication capability is
 * accepted. Display samples stay borrowed through the joined consumer. */
export async function withMergedImageHdrPreviewCurrentV1<Result>(request: unknown, ports: Readonly<ImageHdrMergePortsCurrentV1>,
	consume: (view: Readonly<ImageHdrMergePreviewCurrentV1>) => Result | Promise<Result>): Promise<Result> {
	const captured = captureImageHdrMergeCurrentV1(request, ports);
	if (typeof consume !== 'function') throw new TypeError('HDR preview requires a scoped display consumer.');
	const options = captured.signal ? { signal: captured.signal } : {};
	return withCapturedImageHdrMergeCurrentV1(captured, encoded => withDecodedImageHdrOriginalV1({ bytes: encoded.bytes, ...options }, native => {
		const fit = fitPixelSizeV1(native.frame.descriptor.width, native.frame.descriptor.height, 2048, 2048);
		const encodedPhysical = BigInt(Reflect.apply(SIZE, Reflect.apply(BUFFER, encoded.bytes, []), []) as number);
		const nativePhysical = BigInt(Reflect.apply(SIZE, Reflect.apply(BUFFER, native.frame.pixels, []), []) as number);
		// Count both the borrowed display plane and a bounded canvas presentation.
		if (encodedPhysical + nativePhysical + 2n * BigInt(fit.width * fit.height * 4) + RESERVE > MAXIMUM_WORKING) {
			throw new RangeError('HDR preview exceeds its native and presentation phase working budget.');
		}
		return withLinearPixelFrameDisplayV1({ frame: native.frame, ...options }, display => {
			if (!(display.pixels instanceof Uint8Array) || display.descriptor.sampleFormat !== 'unorm8'
				|| display.descriptor.primaries !== 'srgb' || display.descriptor.transfer !== 'srgb') throw new TypeError('HDR preview requires final encoded sRGB8.');
			const frame = Object.freeze({ pixels: display.pixels, descriptor: Object.freeze({ ...display.descriptor,
				sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const }) });
			return consume(Object.freeze({ frame, descriptor: native.frame.descriptor, diagnostics: encoded.diagnostics }));
		});
	}));
}
