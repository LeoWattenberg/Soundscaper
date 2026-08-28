/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Linear-working-space helpers for the picture-only finishing export execution.
 *
 * Playback and export are the same render: everything here grades and
 * composites in the same linear premultiplied primitives the selected exact
 * frame execution uses, so the picture-only route stays byte-comparable to
 * the preview and the keyed export.
 */

import {
	applyManagedSdrGradeStackLinearPixelV1,
	applyManagedSdrLinearGradeStackPixelV1,
	decodeManagedSdrOutputPixelV1,
	defaultVideoSourceColorInterpretationV1,
	type ParsedCubeLutV1,
	type VideoColorGradeV1,
	type VideoColorOutputSpaceV1,
	type VideoSourceColorInterpretationV1,
} from '../common/editor/video-color-management-v27.ts';
import {
	compositeUnifiedExactLinearFrameV13,
	createUnifiedExactLinearPremultipliedFrameV13,
	flattenUnifiedExactLinearCompositionV13,
	placeUnifiedExactLinearRgbaFrameV13,
	straightUnifiedExactLinearFrameV13,
	type UnifiedExactLinearCompositionEntryV13,
	type UnifiedExactLinearPremultipliedFrameV13,
} from '../common/editor/unified-exact-linear-rgba-v13.ts';
import type {
	UnifiedExactRenderActiveAdjustmentV13,
	UnifiedExactRenderVisualFrameEntryV13,
} from '../common/editor/unified-exact-render-visual-consumers-v13.ts';
import type { UnifiedExactRenderVisualRgbaV13 } from '../common/editor/unified-exact-render-visual-materializer-v13.ts';
import type { UnifiedExactRenderFinishingNode } from '../common/editor/unified-exact-render-plan.ts';
import { evaluateVideoMaskMatteRgbaV13 } from '../common/editor/video-mask-matte-rgba-v13.ts';
import type { VideoVisualPresentationV1 } from '../common/editor/video-visual-presentation-v27.ts';
import { videoDeliveryColorChannels } from '../common/editor/video-delivery-color.ts';

/** Reapply the single picture clip's presentation to a decoded linear backdrop. */
export function applyVideoPresentationLinear(
	clipIds: readonly string[],
	working: UnifiedExactLinearPremultipliedFrameV13,
	width: number,
	height: number,
	finishing: UnifiedExactRenderFinishingNode,
	sourceIdByClipId: ReadonlyMap<string, string>,
	masksById: ReadonlyMap<string, Readonly<{ nodeId: string; graph: Parameters<typeof evaluateVideoMaskMatteRgbaV13>[0] }>>,
	maskInputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
	canvas: unknown,
	outputSpace: VideoColorOutputSpaceV1,
	executed: Set<string>,
): void {
	if (clipIds.length !== 1) return;
	const clipId = clipIds[0]!;
	const sourceId = sourceIdByClipId.get(clipId);
	if (!sourceId) throw new ReferenceError(`finishing presentation source for clip ${clipId} is unavailable.`);
	const presentations = finishing.visualPresentations.filter(({ enabled, owner }) => enabled && (
		(owner.kind === 'clip' && owner.id === clipId)
		|| (owner.kind === 'source' && owner.id === sourceId)
	));
	let opacity = 1;
	let blendMode: VideoVisualPresentationV1['blendMode'] = 'normal';
	const maskIds = new Set<string>();
	for (const presentation of presentations) {
		opacity *= presentation.opacity;
		blendMode = presentation.blendMode;
		for (const maskId of presentation.maskMatteIds) maskIds.add(maskId);
	}
	if (opacity === 1 && blendMode === 'normal' && maskIds.size === 0) return;
	const content = Object.freeze({
		width, height, pixels: working.pixels.slice() as Float64Array<ArrayBuffer>,
	});
	for (const maskId of [...maskIds].sort(compareText)) {
		const mask = masksById.get(maskId);
		if (!mask) throw new ReferenceError(`finishing video presentation mask ${maskId} is unavailable.`);
		const alpha = evaluateVideoMaskMatteRgbaV13(mask.graph, width, height, maskInputs);
		for (let index = 0; index < alpha.length; index += 1) {
			for (let channel = 0; channel < 4; channel += 1) {
				content.pixels[index * 4 + channel] = content.pixels[index * 4 + channel]! * alpha[index]! / 255;
			}
		}
		executed.add(mask.nodeId);
	}
	if (opacity !== 1) {
		for (let offset = 0; offset < content.pixels.length; offset += 1) {
			content.pixels[offset] = content.pixels[offset]! * opacity;
		}
	}
	const backdrop = createUnifiedExactLinearPremultipliedFrameV13(
		width, height, backgroundLinear(canvas, outputSpace),
	);
	compositeUnifiedExactLinearFrameV13(backdrop, content, blendMode);
	working.pixels.set(backdrop.pixels);
}

/** Decode and grade one authored visual into straight linear working pixels. */
export function managedVisualFrame(
	finishing: UnifiedExactRenderFinishingNode,
	entry: UnifiedExactRenderVisualFrameEntryV13,
	frame: UnifiedExactRenderVisualRgbaV13,
	luts: ReadonlyMap<string, ParsedCubeLutV1>,
	signal: AbortSignal,
): UnifiedExactRenderVisualRgbaV13 {
	const source = sourceState(entry);
	const presentations = visualPresentations(finishing, entry, source);
	const interpretation = source.kind === 'still'
		? requiredInterpretation(finishing, String(source.id))
		: defaultVideoSourceColorInterpretationV1('still', String(source.id));
	const grades = presentations.flatMap(({ grade }) => grade ? [grade] : []);
	const bodies = grades.map(({ lut }) => lut ? luts.get(lut.sha256) : undefined);
	const pixels = new Uint8Array(frame.pixels.byteLength);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		if (offset % (frame.width * 4) === 0) throwIfAborted(signal);
		const output = applyManagedSdrGradeStackLinearPixelV1({
			rgba: [frame.pixels[offset]! / 255, frame.pixels[offset + 1]! / 255,
				frame.pixels[offset + 2]! / 255, frame.pixels[offset + 3]! / 255],
			interpretation, grades, luts: bodies,
		});
		for (let channel = 0; channel < 4; channel += 1) {
			pixels[offset + channel] = Math.round(output[channel]! * 255);
		}
	}
	return Object.freeze({ width: frame.width, height: frame.height, pixels });
}

export function applyAdjustment(
	finishing: UnifiedExactRenderFinishingNode,
	adjustment: UnifiedExactRenderActiveAdjustmentV13,
	trackEntries: Map<string, UnifiedExactLinearCompositionEntryV13[]>,
	working: UnifiedExactLinearPremultipliedFrameV13,
	pictureTracks: ReadonlySet<string>,
	width: number,
	height: number,
	luts: ReadonlyMap<string, ParsedCubeLutV1>,
	maskInputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
	signal: AbortSignal,
): void {
	if (adjustment.effectIds.length > 0) {
		throw new Error('finishing browser export refuses an adjustment layer with unexecutable legacy effect IDs.');
	}
	const presentations = finishing.visualPresentations.filter((presentation) => (
		presentation.enabled && presentation.owner.kind === 'adjustment-layer'
		&& presentation.owner.id === adjustment.modelId
	));
	const grades = presentations.flatMap(({ grade }) => grade ? [grade] : []);
	// Visual tracks adjust independently, exactly as the exact preview flattens
	// and grades each targeted track before the cross-track composite.
	for (const trackId of adjustment.targetTrackIds) {
		const entries = trackEntries.get(trackId);
		if (!entries || entries.length === 0) continue;
		const blendModes = new Set(entries.map(({ blendMode }) => blendMode));
		if (blendModes.size > 1) {
			throw new Error('finishing adjustment flatten requires one track blend authority.');
		}
		const preservedBlendMode = entries[0]!.blendMode;
		const target = flattenUnifiedExactLinearCompositionV13(width, height, entries);
		adjustLinearContent(target, adjustment, grades, luts, maskInputs, width, height, signal);
		trackEntries.set(trackId, [Object.freeze({ frame: target, blendMode: preservedBlendMode })]);
	}
	// A picture already baked into the backdrop is not separable per track;
	// partial targeting of it stays refused rather than silently approximated.
	const targetedPicture = [...pictureTracks].filter((trackId) => (
		adjustment.targetTrackIds.includes(trackId)
	));
	if (targetedPicture.length === 0) return;
	if (targetedPicture.length !== pictureTracks.size) {
		throw new Error('finishing adjustment targeting requires unavailable per-layer browser execution.');
	}
	adjustLinearContent(working, adjustment, grades, luts, maskInputs, width, height, signal);
}

export function backgroundLinear(
	canvasValue: unknown,
	outputSpace: VideoColorOutputSpaceV1,
): readonly [number, number, number, number] {
	const channels = videoDeliveryColorChannels(String(record(canvasValue, 'finishing visual canvas').backgroundColor));
	if (!channels) throw new TypeError('finishing visual background is invalid.');
	const interpretation: VideoSourceColorInterpretationV1 = Object.freeze({
		schemaVersion: 1 as const, sourceId: 'finishing-output-background', sourceKind: 'still' as const,
		primaries: outputSpace === 'srgb' ? 'srgb' as const : 'bt709' as const,
		transfer: outputSpace === 'srgb' ? 'srgb' as const : 'bt709' as const,
		matrix: 'rgb' as const, range: 'full' as const, provenance: 'user-override' as const,
	});
	return applyManagedSdrGradeStackLinearPixelV1({
		rgba: [channels.red, channels.green, channels.blue, channels.alpha],
		interpretation, grades: [],
	});
}

/** Bring an already-encoded picture back into premultiplied linear working pixels. */
export function decodeEncodedPicture(
	target: Uint8Array<ArrayBuffer>,
	width: number,
	height: number,
	outputSpace: VideoColorOutputSpaceV1,
): UnifiedExactLinearPremultipliedFrameV13 {
	if (target.byteLength !== width * height * 4) throw new RangeError('finishing visual output geometry changed.');
	const working = createUnifiedExactLinearPremultipliedFrameV13(width, height);
	for (let offset = 0; offset < target.length; offset += 4) {
		const linear = decodeManagedSdrOutputPixelV1([
			target[offset]! / 255, target[offset + 1]! / 255,
			target[offset + 2]! / 255, target[offset + 3]! / 255,
		], outputSpace);
		const alpha = linear[3];
		working.pixels[offset] = linear[0] * alpha;
		working.pixels[offset + 1] = linear[1] * alpha;
		working.pixels[offset + 2] = linear[2] * alpha;
		working.pixels[offset + 3] = alpha;
	}
	return working;
}

export function combinedGraphs(
	graphs: readonly unknown[],
	width: number,
	height: number,
	inputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(width * height).fill(255);
	for (const graph of graphs) {
		const value = evaluateVideoMaskMatteRgbaV13(
			graph as Parameters<typeof evaluateVideoMaskMatteRgbaV13>[0], width, height, inputs,
		);
		for (let index = 0; index < output.length; index += 1) {
			output[index] = Math.round(output[index]! * value[index]! / 255);
		}
	}
	return output;
}

export function identityDescription(
	width: number,
	height: number,
	blendMode: VideoVisualPresentationV1['blendMode'],
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

function adjustLinearContent(
	target: UnifiedExactLinearPremultipliedFrameV13,
	adjustment: UnifiedExactRenderActiveAdjustmentV13,
	grades: readonly VideoColorGradeV1[],
	luts: ReadonlyMap<string, ParsedCubeLutV1>,
	maskInputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
	width: number,
	height: number,
	signal: AbortSignal,
): void {
	const adjusted = gradeLinearStraightFrame(
		straightUnifiedExactLinearFrameV13(target), grades, luts, signal,
	);
	const mask = adjustment.masks.length === 0 ? undefined
		: combinedGraphs(adjustment.masks, width, height, maskInputs);
	const overlay = placeUnifiedExactLinearRgbaFrameV13({
		frame: adjusted, displayWidth: width, displayHeight: height,
		outputWidth: width, outputHeight: height,
		renderDescription: identityDescription(width, height, adjustment.blendMode),
		opacity: adjustment.opacity, ...(mask ? { mask } : {}),
	});
	compositeUnifiedExactLinearFrameV13(target, overlay, adjustment.blendMode);
}

/** Grade straight linear eight-bit pixels in place, staying in the working space. */
function gradeLinearStraightFrame(
	frame: UnifiedExactRenderVisualRgbaV13,
	grades: readonly VideoColorGradeV1[],
	luts: ReadonlyMap<string, ParsedCubeLutV1>,
	signal: AbortSignal,
): UnifiedExactRenderVisualRgbaV13 {
	const bodies = grades.map(({ lut }) => lut ? luts.get(lut.sha256) : undefined);
	const pixels = new Uint8Array(frame.pixels.byteLength);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		if (offset % (frame.width * 4) === 0) throwIfAborted(signal);
		const output = applyManagedSdrLinearGradeStackPixelV1({
			rgba: [frame.pixels[offset]! / 255, frame.pixels[offset + 1]! / 255,
				frame.pixels[offset + 2]! / 255, frame.pixels[offset + 3]! / 255],
			grades, luts: bodies,
		});
		for (let channel = 0; channel < 4; channel += 1) {
			pixels[offset + channel] = Math.round(output[channel]! * 255);
		}
	}
	return Object.freeze({ width: frame.width, height: frame.height, pixels });
}

function visualPresentations(
	finishing: UnifiedExactRenderFinishingNode,
	entry: UnifiedExactRenderVisualFrameEntryV13,
	source: Readonly<Record<string, unknown>>,
): readonly VideoVisualPresentationV1[] {
	return finishing.visualPresentations.filter((presentation) => presentation.enabled && (
		(presentation.owner.kind === 'clip' && presentation.owner.id === entry.modelId)
		|| ((presentation.owner.kind === 'source' || presentation.owner.kind === 'generator')
			&& presentation.owner.id === source.id)
	));
}

function requiredInterpretation(
	finishing: UnifiedExactRenderFinishingNode,
	sourceId: string,
): VideoSourceColorInterpretationV1 {
	const result = finishing.sourceInterpretations.find((value) => value.sourceId === sourceId);
	if (!result) throw new ReferenceError(`finishing visual source interpretation ${sourceId} is unavailable.`);
	return result;
}

export function sourceState(entry: UnifiedExactRenderVisualFrameEntryV13): Readonly<Record<string, unknown>> {
	if (!('source' in entry.authoredState)) throw new TypeError('finishing visual entry source is unavailable.');
	return record(entry.authoredState.source, 'finishing visual entry source');
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Readonly<Record<string, unknown>>;
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? new DOMException('finishing visual export was cancelled.', 'AbortError');
}

function compareText(left: string, right: string): number { return left.localeCompare(right); }
