/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pixel, grade, capture, and composition-ordering helpers for the selected finishing exact frame execution. */

import {
	applyManagedSdrGradeStackLinearPixelV1,
	applyManagedSdrLinearGradeStackPixelV1,
	defaultVideoSourceColorInterpretationV1,
	type ParsedCubeLutV1,
	type VideoColorGradeV1,
	type VideoSourceColorInterpretationV1,
} from '../common/editor/video-color-management-v27.ts';
import type {
	UnifiedExactLinearBlendModeV13,
	UnifiedExactLinearCompositionEntryV13,
} from '../common/editor/unified-exact-linear-rgba-v13.ts';
import type { UnifiedExactRenderRgbaFrameV13 } from '../common/editor/unified-exact-render-finishing-consumers-v13.ts';
import type { UnifiedExactRenderVisualFrameEntryV13 } from '../common/editor/unified-exact-render-visual-consumers-v13.ts';
import type { UnifiedExactRenderVisualRgbaV13 } from '../common/editor/unified-exact-render-visual-materializer-v13.ts';
import type {
	UnifiedExactRenderFinishingNode,
	UnifiedExactRenderPlanV13,
} from '../common/editor/unified-exact-render-plan.ts';
import { evaluateVideoMaskMatteRgbaV13 } from '../common/editor/video-mask-matte-rgba-v13.ts';
import { videoDeliveryColorChannels } from '../common/editor/video-delivery-color.ts';

type Data = Readonly<Record<string, unknown>>;

/**
 * One track's composition entries at one authored compositing order. Tracks
 * normally contribute a single bucket at their clip's authored order; the
 * final composite interleaves buckets across tracks by order so an authored
 * compositingOrder can pull a lower track's picture in front of a higher one.
 */
export interface TrackOrderBucketFinishing {
	readonly order: number;
	entries: UnifiedExactLinearCompositionEntryV13[];
}

export function gradeVisual(
	finishing: UnifiedExactRenderFinishingNode,
	entry: UnifiedExactRenderVisualFrameEntryV13,
	frame: UnifiedExactRenderVisualRgbaV13,
	luts: ReadonlyMap<string, ParsedCubeLutV1>,
	signal: AbortSignal,
): UnifiedExactRenderRgbaFrameV13 {
	if (!('source' in entry.authoredState)) throw new TypeError('Selected finishing visual source is unavailable.');
	const source = entry.authoredState.source;
	const presentations = finishing.visualPresentations.filter(({ enabled, owner }) => enabled && (
		(owner.kind === 'clip' && owner.id === entry.modelId)
		|| ((owner.kind === 'source' || owner.kind === 'generator') && owner.id === source.id)
	));
	const interpretation = source.kind === 'still'
		? requiredInterpretation(finishing, source.id)
		: defaultVideoSourceColorInterpretationV1('still', source.id);
	return gradeEncodedFrame(frame, interpretation,
		presentations.flatMap(({ grade }) => grade ? [grade] : []), luts, signal);
}

export function gradeEncodedFrame(
	frame: UnifiedExactRenderVisualRgbaV13,
	interpretation: VideoSourceColorInterpretationV1,
	grades: readonly VideoColorGradeV1[],
	luts: ReadonlyMap<string, ParsedCubeLutV1>,
	signal: AbortSignal,
): UnifiedExactRenderRgbaFrameV13 {
	const pixels = new Uint8Array(frame.pixels.length);
	const bodies = grades.map(({ lut }) => lut ? luts.get(lut.sha256) : undefined);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		if (offset % (frame.width * 4) === 0) throwIfAborted(signal);
		const value = applyManagedSdrGradeStackLinearPixelV1({
			rgba: channels(frame.pixels, offset), interpretation, grades, luts: bodies,
		});
		writeChannels(pixels, offset, value);
	}
	return Object.freeze({ width: frame.width, height: frame.height, pixels });
}

export function gradeLinearFrame(
	frame: UnifiedExactRenderRgbaFrameV13,
	grades: readonly VideoColorGradeV1[],
	luts: ReadonlyMap<string, ParsedCubeLutV1>,
	signal: AbortSignal,
): UnifiedExactRenderRgbaFrameV13 {
	const pixels = new Uint8Array(frame.pixels.length);
	const bodies = grades.map(({ lut }) => lut ? luts.get(lut.sha256) : undefined);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		if (offset % (frame.width * 4) === 0) throwIfAborted(signal);
		writeChannels(pixels, offset, applyManagedSdrLinearGradeStackPixelV1({
			rgba: channels(frame.pixels, offset), grades, luts: bodies,
		}));
	}
	return Object.freeze({ width: frame.width, height: frame.height, pixels });
}

export async function captureBrowserFrame(entry: Data, signal: AbortSignal): Promise<UnifiedExactRenderRgbaFrameV13> {
	throwIfAborted(signal);
	if (!globalThis.document?.createElement) throw new Error('Selected finishing source readback is unavailable.');
	const video = record(entry.video, 'Selected finishing media drawable');
	const width = dimension(video.videoWidth, 'Selected finishing media width');
	const height = dimension(video.videoHeight, 'Selected finishing media height');
	const drawable = video.drawable ?? entry.video;
	const canvas = globalThis.document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
	if (!context) throw new Error('Selected finishing source readback has no 2D context.');
	context.clearRect(0, 0, width, height);
	context.drawImage(drawable as CanvasImageSource, 0, 0, width, height);
	const data = context.getImageData(0, 0, width, height).data;
	throwIfAborted(signal);
	return Object.freeze({ width, height, pixels: Uint8Array.from(data) as Uint8Array<ArrayBuffer> });
}

export function mediaPresentation(finishing: UnifiedExactRenderFinishingNode, clipId: string, sourceId: string) {
	const presentations = finishing.visualPresentations.filter(({ enabled, owner }) => enabled && (
		(owner.kind === 'clip' && owner.id === clipId) || (owner.kind === 'source' && owner.id === sourceId)
	));
	let opacity = 1;
	let blendMode: UnifiedExactLinearBlendModeV13 | null = null;
	const maskIds = new Set<string>();
	for (const presentation of presentations) {
		opacity *= presentation.opacity;
		blendMode = presentation.blendMode;
		for (const id of presentation.maskMatteIds) maskIds.add(id);
	}
	return Object.freeze({ opacity, blendMode, maskIds: Object.freeze([...maskIds].sort(compareText)) });
}

export function combinedMask(
	ids: readonly string[],
	graphs: ReadonlyMap<string, unknown>,
	width: number,
	height: number,
	inputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
): Uint8Array<ArrayBuffer> {
	return combinedGraphs(ids.map((id) => {
		const graph = graphs.get(id);
		if (!graph) throw new ReferenceError(`Selected finishing mask ${id} is unavailable.`);
		return graph;
	}), width, height, inputs);
}

export function combinedGraphs(
	graphs: readonly unknown[],
	width: number,
	height: number,
	inputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(width * height).fill(255);
	for (const graph of graphs) {
		const value = evaluateVideoMaskMatteRgbaV13(graph, width, height, inputs);
		for (let index = 0; index < output.length; index += 1) {
			output[index] = Math.round(output[index]! * value[index]! / 255);
		}
	}
	return output;
}

export function backgroundLinear(
	plan: UnifiedExactRenderPlanV13,
	finishing: UnifiedExactRenderFinishingNode,
): readonly [number, number, number, number] {
	const channels = videoDeliveryColorChannels(plan.output.canvas.backgroundColor);
	if (!channels) throw new Error('Selected finishing exact finishing requires a hexadecimal background color.');
	const transfer = finishing.colorContext.outputSpace;
	const interpretation: VideoSourceColorInterpretationV1 = Object.freeze({
		schemaVersion: 1, sourceId: 'finishing-output-background', sourceKind: 'still',
		primaries: transfer === 'srgb' ? 'srgb' : 'bt709',
		transfer: transfer === 'srgb' ? 'srgb' : 'bt709',
		matrix: 'rgb', range: 'full', provenance: 'user-override',
	});
	return applyManagedSdrGradeStackLinearPixelV1({
		rgba: [channels.red, channels.green, channels.blue, channels.alpha],
		interpretation, grades: [],
	});
}

export function identityDescription(width: number, height: number, blendMode: UnifiedExactLinearBlendModeV13) {
	return Object.freeze({
		crop: Object.freeze({
			normalized: Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 }),
			sourcePixels: Object.freeze({ x: 0, y: 0, width, height }),
		}),
		sourceDisplayToCanvas: Object.freeze([1, 0, 0, 1, 0, 0]),
		opacityStart: 1, opacityEnd: 1, blendMode, compositingOrder: 0,
	});
}

export function renderBlendMode(value: unknown): UnifiedExactLinearBlendModeV13 {
	const description = record(value, 'Selected finishing render description');
	const mode = description.blendMode;
	if (!['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference', 'exclusion']
		.includes(String(mode))) throw new RangeError('Selected finishing blend mode is unsupported.');
	return mode as UnifiedExactLinearBlendModeV13;
}

export function authoredCompositingOrder(value: unknown): number {
	const description = record(value, 'Selected finishing render description');
	const order = description.compositingOrder;
	if (!Number.isSafeInteger(order) || Number(order) < -32_768 || Number(order) > 32_767) {
		throw new RangeError('Selected finishing compositing order is outside its range.');
	}
	return Number(order);
}

export function orderBucketEntries(
	trackFrames: Map<string, TrackOrderBucketFinishing[]>,
	trackId: string,
	order: number,
): UnifiedExactLinearCompositionEntryV13[] {
	const buckets = trackFrames.get(trackId) ?? [];
	if (!trackFrames.has(trackId)) trackFrames.set(trackId, buckets);
	const existing = buckets.find((bucket) => bucket.order === order);
	if (existing) return existing.entries;
	const created: TrackOrderBucketFinishing = { order, entries: [] };
	buckets.push(created);
	return created.entries;
}

export function requiredInterpretation(
	finishing: UnifiedExactRenderFinishingNode,
	sourceId: string,
): VideoSourceColorInterpretationV1 {
	const result = finishing.sourceInterpretations.find((value) => value.sourceId === sourceId);
	if (!result) throw new ReferenceError(`Selected finishing source interpretation ${sourceId} is unavailable.`);
	return result;
}

function channels(value: Uint8Array, offset: number): readonly [number, number, number, number] {
	return [value[offset]! / 255, value[offset + 1]! / 255,
		value[offset + 2]! / 255, value[offset + 3]! / 255];
}

function writeChannels(target: Uint8Array, offset: number, value: readonly number[]): void {
	for (let channel = 0; channel < 4; channel += 1) target[offset + channel] = Math.round(value[channel]! * 255);
}

function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Data;
}

function dimension(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 65_536) {
		throw new RangeError(`${name} must be a positive bounded integer.`);
	}
	return Number(value);
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? new DOMException('Selected finishing exact execution was aborted.', 'AbortError');
}

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
