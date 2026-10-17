/* SPDX-License-Identifier: AGPL-3.0-only */
import { renderMotionCompositionLink, type MotionCompositionLinkFrame, type MotionCompositionLinkRenderPlan } from './motion-link-rendering.ts';
import { motionSurfaceLength, motionSurfaceToRgba8 } from './motion-surface.ts';
import { assertMotionWorkingBudget, MOTION_DEFAULT_WORKING_BYTES } from './motion-render-budget.ts';
import { motionDigest, motionId } from './motion-values.ts';
import { normalizeRational, type Rational, type RationalInput } from './timeline-time.ts';
export interface MotionCompositionLinkPicture {
	readonly identity: MotionCompositionLinkFrame['identity']; readonly time: Rational;
	readonly width: number; readonly height: number; readonly pixels: Uint8ClampedArray<ArrayBuffer>;
	/** A display carrier, independent of the linked composition's authored export transfer function. */
	readonly encoding: 'canvas-srgb'; readonly alphaMode: 'straight'; readonly precision: 'unorm8';
}
type ConversionOptions = Readonly<{ signal?: AbortSignal; maximumWorkingBytes?: number }>;

/** Deliberate 8-bit boundary: unpremultiply in linear light, encode sRGB, then round channels and alpha once. */
export function motionCompositionLinkFrameToRgba8(frame: MotionCompositionLinkFrame, options: ConversionOptions = {}): MotionCompositionLinkPicture {
	options.signal?.throwIfAborted(); admit(frame.surface.width, frame.surface.height, options.maximumWorkingBytes);
	const identity = Object.freeze({ projectId: motionId(frame.identity.projectId), compositionId: motionId(frame.identity.compositionId), revisionDigest: motionDigest(frame.identity.revisionDigest) });
	const time = Object.freeze(normalizeRational(frame.time, { maximumDenominator: Number.MAX_SAFE_INTEGER }));
	const pixels = motionSurfaceToRgba8(frame.surface, 'srgb') as Uint8ClampedArray<ArrayBuffer>;
	// A rounded-to-zero alpha has no color authority at this transport precision.
	for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 3] === 0) { pixels[index] = 0; pixels[index + 1] = 0; pixels[index + 2] = 0; }
	options.signal?.throwIfAborted();
	return Object.freeze({ identity, time, width: frame.surface.width, height: frame.surface.height, pixels, encoding: 'canvas-srgb', alphaMode: 'straight', precision: 'unorm8' });
}

/** Frame callers resolve exact source seconds with their own retained trim/retime authority before this boundary. */
export async function renderMotionCompositionLinkPicture(plan: MotionCompositionLinkRenderPlan, sourceTime: RationalInput, options: Parameters<typeof renderMotionCompositionLink>[2]): Promise<MotionCompositionLinkPicture> {
	options.signal?.throwIfAborted(); admit(plan.offer.output.width, plan.offer.output.height, options.maximumWorkingBytes);
	const frame = await renderMotionCompositionLink(plan, sourceTime, options);
	return motionCompositionLinkFrameToRgba8(frame, options);
}
function admit(width: number, height: number, maximum = MOTION_DEFAULT_WORKING_BYTES): void {
	// The returned float frame and new RGBA8 carrier coexist. Renderer scratch is admitted separately before its lease.
	assertMotionWorkingBudget(motionSurfaceLength(width, height) * (Float32Array.BYTES_PER_ELEMENT + Uint8ClampedArray.BYTES_PER_ELEMENT), maximum);
}
