/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	withManagedSdrPixelFrameV1, type ManagedSdrPixelFrameRequestV1,
} from '../common/editor/imaging/pixel-frame-managed-sdr-grade-v1.ts';
import {
	defaultVideoSourceColorInterpretationV1, type ParsedCubeLutV1, type VideoColorGradeV1,
} from '../common/editor/video-color-management-v27.ts';
import {
	placeUnifiedExactLinearRgbaFrameV13,
	type UnifiedExactLinearBlendModeV13, type UnifiedExactLinearPremultipliedFrameV13,
} from '../common/editor/unified-exact-linear-rgba-v13.ts';
import type { UnifiedExactRenderFinishingNode } from '../common/editor/unified-exact-render-plan.ts';
import type { UnifiedExactRenderVisualFrameEntryV13 } from '../common/editor/unified-exact-render-visual-consumers-v13.ts';
import type { UnifiedExactRenderRgbaFrameV13 } from '../common/editor/unified-exact-render-finishing-consumers-v13.ts';
import type { UnifiedExactRenderVisualRgbaV13 } from '../common/editor/unified-exact-render-visual-materializer-v13.ts';
import { gradeVisual, gradeLinearFrame, identityDescription, requiredInterpretation } from './selected-finishing-exact-frame-support.ts';
import { resolveFramescaperVisualPlacementFinishing, type FramescaperVisualCanvasFinishing } from './visual-placement-finishing.ts';

const LIMITS = Object.freeze({ maximumSidePixels: 65_536, maximumPixels: 33_554_432, maximumBytes: 128 * 1024 * 1024 });
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;

/** Place inside the shared callback, then release its temporary straight-alpha byte frame. */
export async function placeFramescaperManagedGradedVisualFrameV1(input: Readonly<{
	finishing: UnifiedExactRenderFinishingNode;
	entry: UnifiedExactRenderVisualFrameEntryV13;
	frame: UnifiedExactRenderVisualRgbaV13;
	luts: ReadonlyMap<string, ParsedCubeLutV1>;
	canvas: FramescaperVisualCanvasFinishing;
	mask?: Uint8Array<ArrayBuffer>;
	signal: AbortSignal;
}>): Promise<UnifiedExactLinearPremultipliedFrameV13> {
	const { finishing, entry, frame, luts, canvas, mask, signal } = input;
	if (!('source' in entry.authoredState)) throw new TypeError('Selected finishing visual source is unavailable.');
	const source = entry.authoredState.source;
	const presentations = finishing.visualPresentations.filter(({ enabled, owner }) => enabled && (
		(owner.kind === 'clip' && owner.id === entry.modelId)
		|| ((owner.kind === 'source' || owner.kind === 'generator') && owner.id === source.id)
	));
	const interpretation = source.kind === 'still' ? requiredInterpretation(finishing, source.id)
		: defaultVideoSourceColorInterpretationV1('still', source.id);
	const grades = presentations.flatMap(({ grade }) => grade ? [grade] : []);
	const placement = resolveFramescaperVisualPlacementFinishing(entry, canvas);
	if (frame.width !== placement.width || frame.height !== placement.height) {
		throw new RangeError(`Selected finishing visual ${entry.modelId} changed materialized geometry.`);
	}
	return placeGraded(frame, grades, { decoding: 'file', interpretation, output: 'linear-rec709-d65', signal,
		frame: { descriptor: { schemaVersion: 1, width: frame.width, height: frame.height,
			sampleFormat: 'unorm8', primaries: interpretation.primaries, transfer: interpretation.transfer }, pixels: frame.pixels }, grades },
		() => gradeVisual(finishing, entry, frame, luts, signal), graded => placeUnifiedExactLinearRgbaFrameV13({
			frame: graded, displayWidth: placement.width, displayHeight: placement.height,
			outputWidth: canvas.width, outputHeight: canvas.height, renderDescription: placement.renderDescription,
			...(mask ? { mask } : {}),
		}));
}

export async function placeFramescaperManagedGradedAdjustmentFrameV1(input: Readonly<{
	frame: UnifiedExactRenderRgbaFrameV13;
	grades: readonly VideoColorGradeV1[];
	luts: ReadonlyMap<string, ParsedCubeLutV1>;
	width: number;
	height: number;
	blendMode: UnifiedExactLinearBlendModeV13;
	opacity: number;
	mask?: Uint8Array<ArrayBuffer>;
	signal: AbortSignal;
}>): Promise<UnifiedExactLinearPremultipliedFrameV13> {
	const { frame, grades, luts, width, height, blendMode, opacity, mask, signal } = input;
	return placeGraded(frame, grades, { decoding: 'linear', output: 'linear-rec709-d65', signal,
		frame: { descriptor: { schemaVersion: 1, width: frame.width, height: frame.height,
			sampleFormat: 'unorm8', primaries: 'bt709', transfer: 'linear' }, pixels: frame.pixels }, grades },
		() => gradeLinearFrame(frame, grades, luts, signal), graded => placeUnifiedExactLinearRgbaFrameV13({
			frame: graded, displayWidth: width, displayHeight: height, outputWidth: width, outputHeight: height,
			renderDescription: identityDescription(width, height, blendMode), opacity, ...(mask ? { mask } : {}),
		}));
}

async function placeGraded(
	frame: UnifiedExactRenderVisualRgbaV13,
	grades: readonly VideoColorGradeV1[],
	request: ManagedSdrPixelFrameRequestV1,
	legacy: () => UnifiedExactRenderRgbaFrameV13,
	place: (frame: UnifiedExactRenderRgbaFrameV13) => UnifiedExactLinearPremultipliedFrameV13,
): Promise<UnifiedExactLinearPremultipliedFrameV13> {
	if (eligible(frame, grades)) {
		let placed: UnifiedExactLinearPremultipliedFrameV13 | undefined;
		try {
			return await withManagedSdrPixelFrameV1(request, graded => {
				placed = place({ width: graded.descriptor.width, height: graded.descriptor.height, pixels: graded.pixels });
				return placed;
			}, { limits: LIMITS });
		} catch (error) {
			placed?.pixels.fill(0);
			throw error;
		}
	}
	// Preserve the existing Frame LUT and noneligible native-buffer routes. Their
	// new output is still private to placement and never escapes this owner.
	const output = legacy();
	try { return place(output); } finally { output.pixels.fill(0); }
}

function eligible(frame: UnifiedExactRenderVisualRgbaV13, grades: readonly VideoColorGradeV1[]): boolean {
	const pixels = frame.pixels;
	return grades.every(grade => grade.lut === null) && frame.width * frame.height <= LIMITS.maximumPixels
		&& Object.getPrototypeOf(pixels) === Uint8Array.prototype
		&& !['buffer', 'length', 'byteLength', 'byteOffset'].some(key => Object.hasOwn(pixels, key))
		&& pixels.buffer instanceof ArrayBuffer && !(RESIZABLE && Reflect.apply(RESIZABLE, pixels.buffer, []));
}
