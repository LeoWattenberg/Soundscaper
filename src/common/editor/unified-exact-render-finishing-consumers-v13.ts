/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared selected-V13 pixel resolver used by maintained preview and browser export. */

import {
	applyManagedSdrCanvasReadbackGradeStackLinearPixelV1,
	applyManagedSdrGradeStackLinearPixelV1,
	assertManagedVideoColorRenderAdmissionV1,
	encodeManagedSdrLinearPixelV1,
	type ParsedCubeLutV1,
} from './video-color-management-v27.ts';
import {
	requireVideoMotionAnalysisBodyV1,
	type VideoMotionAnalysisBodyV1,
} from './video-motion-analysis-v27.ts';
import {
	processSpatialDenoiseV1,
	processTemporalDenoiseV1,
	type VideoMotionWebGl2AcceleratorV1,
	type VideoTemporalNeighborV1,
} from './video-motion-denoise-v27.ts';
import type {
	VideoMotionAnalysisReferenceV1,
	VideoProcessorStackV1,
} from './video-motion-model-v27.ts';
import {
	resolveStabilizationTransformV1,
	type VideoSimilarityTransformV1,
} from './video-motion-processing-v27.ts';
import type { VideoVisualPresentationV1 } from './video-visual-presentation-v27.ts';
import {
	channelFrame,
	composeMotion,
	invertMotion,
	warpApplied,
	writeChannel,
} from './unified-exact-render-finishing-motion-v13.ts';
import {
	assertUnifiedExactRenderPlanV13,
	assertUnifiedExactRenderPlanWithTimingSidecars,
	type UnifiedExactRenderClipNode,
	type UnifiedExactRenderFinishingNode,
	type UnifiedExactRenderPlanSource,
	type UnifiedExactRenderPlanV13,
	type UnifiedExactRenderVisualNode,
} from './unified-exact-render-plan.ts';
import type { UnifiedExactRenderTimingSidecars } from './unified-exact-render-timing-authority.ts';

export interface UnifiedExactRenderRgbaFrameV13 {
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array<ArrayBuffer>;
}

export interface UnifiedExactRenderFinishingProgressV13 {
	readonly phase: 'similarity-stabilization' | 'spatial-denoise' | 'temporal-denoise' | 'managed-color';
	readonly completed: number;
	readonly total: number;
}

export interface UnifiedExactRenderFinishingFrameRequestV13 {
	readonly clipId: string;
	/** Source-domain ordinal selected before occurrence retime. */
	readonly sourceFrame: number;
	readonly sequenceFrame: number;
	readonly frame: UnifiedExactRenderRgbaFrameV13;
	readonly temporalNeighbors?: readonly Readonly<{
		readonly sourceFrame: number;
		readonly frame: UnifiedExactRenderRgbaFrameV13;
	}>[];
	/** Random-access source-domain provider; traversal order and caches are never frame authority. */
	readonly resolveTemporalFrame?: (request: Readonly<{
		readonly clipId: string;
		readonly sourceFrame: number;
		readonly width: number;
		readonly height: number;
		readonly signal?: AbortSignal;
	}>) => PromiseLike<UnifiedExactRenderRgbaFrameV13 | null> | UnifiedExactRenderRgbaFrameV13 | null;
	readonly analysisBodies?: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
	readonly lutBodies?: ReadonlyMap<string, ParsedCubeLutV1>;
	readonly accelerator?: VideoMotionWebGl2AcceleratorV1;
	readonly onAcceleratorFallback?: (reason: string) => void;
	/** Per-source execution excludes adjustment-layer state until after track composition. */
	readonly presentationScope?: 'all' | 'source';
	/** Exact compositors retain linear working pixels and encode only their final picture. */
	readonly outputEncoding?: 'encoded-output' | 'linear-rec709-d65';
	/**
	 * How request.frame's pixels are encoded. Browser capture — canvas 2D
	 * readback or WebGL readPixels — yields full-range sRGB pixels whatever
	 * the file's tags say ('canvas-srgb'); the persisted source
	 * interpretation then gates admission only. The 'source-encoded' default
	 * decodes with the file interpretation for callers supplying genuinely
	 * source-encoded pixels.
	 */
	readonly frameEncoding?: 'source-encoded' | 'canvas-srgb';
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: UnifiedExactRenderFinishingProgressV13) => void;
}

export interface UnifiedExactRenderFinishingConsumerV13 {
	readonly plan: UnifiedExactRenderPlanV13;
	resolveFrame(
		request: UnifiedExactRenderFinishingFrameRequestV13,
	): Promise<UnifiedExactRenderRgbaFrameV13>;
}

interface ResolutionAuthority {
	readonly plan: UnifiedExactRenderPlanV13;
	readonly finishing: UnifiedExactRenderFinishingNode;
}

/** Preview and export deliberately delegate to this same plan-owned resolver. */
export function createUnifiedExactRenderFinishingPreviewConsumerV13(
	plan: UnifiedExactRenderPlanV13,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
): UnifiedExactRenderFinishingConsumerV13 {
	return createConsumer(plan, timingSidecars);
}

/** Preview and export deliberately delegate to this same plan-owned resolver. */
export function createUnifiedExactRenderFinishingExportConsumerV13(
	plan: UnifiedExactRenderPlanV13,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
): UnifiedExactRenderFinishingConsumerV13 {
	return createConsumer(plan, timingSidecars);
}

/**
 * Finishing for a plan another generation already validated in full. The V14
 * surface strips its externally-owned native nodes and reuses this exact
 * resolver; re-deriving a V13 wire instead would refuse every professional
 * container tuple V13 never admits, so validation authority stays with the
 * caller's own generation.
 */
export function createUnifiedExactRenderFinishingConsumerForValidatedFoundation(
	planValue: UnifiedExactRenderPlanV13,
): UnifiedExactRenderFinishingConsumerV13 {
	return consumerForValidatedPlan(planValue);
}

function createConsumer(planValue: UnifiedExactRenderPlanV13,
	timingSidecars?: UnifiedExactRenderTimingSidecars): UnifiedExactRenderFinishingConsumerV13 {
	if (timingSidecars === undefined) assertUnifiedExactRenderPlanV13(planValue);
	else {
		assertUnifiedExactRenderPlanWithTimingSidecars(planValue, timingSidecars);
		if (planValue.version !== 13) throw new RangeError('Selected finishing requires a V13 plan.');
	}
	return consumerForValidatedPlan(planValue);
}

function consumerForValidatedPlan(
	planValue: UnifiedExactRenderPlanV13,
): UnifiedExactRenderFinishingConsumerV13 {
	const finishingNodes = planValue.nodes.filter(
		(node): node is UnifiedExactRenderFinishingNode => node.kind === 'finishing',
	);
	if (finishingNodes.length !== 1) throw new ReferenceError('Selected V13 requires one finishing node.');
	const authority = Object.freeze({ plan: planValue, finishing: finishingNodes[0]! });
	return Object.freeze({
		plan: planValue,
		resolveFrame: (request: UnifiedExactRenderFinishingFrameRequestV13) => (
			resolveFrame(authority, request)
		),
	});
}

async function resolveFrame(
	authority: ResolutionAuthority,
	request: UnifiedExactRenderFinishingFrameRequestV13,
): Promise<UnifiedExactRenderRgbaFrameV13> {
	throwIfAborted(request?.signal);
	const sourceFrame = nonNegativeInteger(request?.sourceFrame, 'V13 source frame');
	const sequenceFrame = nonNegativeInteger(request?.sequenceFrame, 'V13 sequence frame');
	const clip = clipById(authority.plan, stableId(request?.clipId, 'V13 finishing clip ID'));
	const source = sourceForClip(authority.plan, clip);
	const interpretation = authority.finishing.sourceInterpretations.find(
		({ sourceId }) => sourceId === source.sourceId);
	if (!interpretation) throw new ReferenceError('The V13 source color interpretation is unavailable.');
	assertManagedVideoColorRenderAdmissionV1(interpretation);
	const presentations = applicablePresentations(authority, clip, source, sequenceFrame,
		request.presentationScope ?? 'all');
	let frame = rgbaFrame(request?.frame, 'V13 finishing frame');
	const analysisCache = new Map<string, VideoMotionAnalysisBodyV1>();
	const stacks = new Map(authority.finishing.processorStacks.map((stack) => [stack.id, stack]));
	const processors = presentations.flatMap((presentation) => {
		if (presentation.processorStackId === null) return [];
		const stack = stacks.get(presentation.processorStackId);
		if (!stack || stack.sourceId !== source.sourceId) {
			throw new ReferenceError('The V13 finishing processor stack does not bind the clip source.');
		}
		return [{ presentation, stack }];
	});
	const executable = processors.flatMap(({ stack }) => stack.processors.filter((processor) => (
		processor.enabled && processor.kind !== 'tracking'
	)));
	let completed = 0;
	for (const { stack } of processors) {
		for (const processor of stack.processors) {
			if (!processor.enabled || processor.kind === 'tracking') continue;
			throwIfAborted(request.signal);
			if (processor.kind === 'similarity-stabilization') {
				const body = analysisBody(authority, source, stack, processor.analysisId,
					request.analysisBodies, analysisCache);
				const motion = adjacentMotion(body, sourceFrame);
				frame = warpApplied(frame, scaleMotionToFrame(
					resolveStabilizationTransformV1(motion, processor.strength), body, frame,
				), request.signal);
			} else if (processor.kind === 'spatial-denoise') {
				frame = spatialDenoise(frame, processor.radius, processor.strength, request.signal);
			} else {
				const body = analysisBody(authority, source, stack, processor.analysisId,
					request.analysisBodies, analysisCache);
				const temporalNeighbors = await exactTemporalNeighbors(
					request, clip.clipId, frame, sourceFrame, processor.radius, body,
				);
				frame = await temporalDenoise(
					frame, sourceFrame, temporalNeighbors, body,
					processor.radius, processor.strength, request.accelerator,
					request.onAcceleratorFallback, request.signal,
				);
			}
			completed += 1;
			request.onProgress?.(Object.freeze({
				phase: processor.kind,
				completed,
				total: executable.length + 1,
			}));
		}
	}
	frame = managedColor(authority.finishing, source, presentations, frame,
		request.lutBodies, request.outputEncoding ?? 'encoded-output',
		request.frameEncoding ?? 'source-encoded', request.signal);
	request.onProgress?.(Object.freeze({
		phase: 'managed-color', completed: completed + 1, total: executable.length + 1,
	}));
	return frame;
}

function applicablePresentations(
	authority: ResolutionAuthority,
	clip: UnifiedExactRenderClipNode,
	source: UnifiedExactRenderPlanSource,
	sequenceFrame: number,
	presentationScope: 'all' | 'source',
): readonly VideoVisualPresentationV1[] {
	const visualById = new Map(authority.plan.nodes.filter(
		(node): node is UnifiedExactRenderVisualNode => node.kind === 'visual',
	).map((node) => [node.modelId, node]));
	return authority.finishing.visualPresentations.filter((presentation) => {
		if (!presentation.enabled) return false;
		if (presentation.owner.kind === 'clip') return presentation.owner.id === clip.clipId;
		if (presentation.owner.kind === 'source' || presentation.owner.kind === 'generator') {
			return presentation.owner.id === source.sourceId;
		}
		if (presentation.owner.kind !== 'adjustment-layer' || presentationScope === 'source') return false;
		const node = visualById.get(presentation.owner.id);
		if (!node || node.modelKind !== 'adjustment-layer'
			|| !('kind' in node.authoredState)
			|| node.authoredState.kind !== 'adjustment-layer') return false;
		const layer = node.authoredState;
		return layer.targetTrackIds.includes(clip.trackId)
			&& sequenceFrame >= layer.sequenceStartFrame
			&& sequenceFrame < layer.sequenceStartFrame + layer.sequenceFrameCount;
	});
}

function managedColor(
	finishing: UnifiedExactRenderFinishingNode,
	source: UnifiedExactRenderPlanSource,
	presentations: readonly VideoVisualPresentationV1[],
	frame: UnifiedExactRenderRgbaFrameV13,
	lutBodies: ReadonlyMap<string, ParsedCubeLutV1> | undefined,
	outputEncoding: 'encoded-output' | 'linear-rec709-d65',
	frameEncoding: 'source-encoded' | 'canvas-srgb',
	signal?: AbortSignal,
): UnifiedExactRenderRgbaFrameV13 {
	const interpretation = finishing.sourceInterpretations.find(({ sourceId }) => sourceId === source.sourceId);
	if (!interpretation) throw new ReferenceError('The V13 source color interpretation is unavailable.');
	const grades = presentations.flatMap(({ grade }) => grade === null ? [] : [grade]);
	const luts = grades.map(({ lut }) => lut === null ? undefined : lutBodies?.get(lut.sha256));
	const pixels = new Uint8Array(frame.pixels.byteLength);
	for (let y = 0; y < frame.height; y += 1) {
		throwIfAborted(signal);
		for (let x = 0; x < frame.width; x += 1) {
			const offset = (y * frame.width + x) * 4;
			const gradeRequest = {
				rgba: [
					frame.pixels[offset]! / 255,
					frame.pixels[offset + 1]! / 255,
					frame.pixels[offset + 2]! / 255,
					frame.pixels[offset + 3]! / 255,
				],
				interpretation, grades, luts,
			};
			const linear = frameEncoding === 'canvas-srgb'
				? applyManagedSdrCanvasReadbackGradeStackLinearPixelV1(gradeRequest)
				: applyManagedSdrGradeStackLinearPixelV1(gradeRequest);
			const value = outputEncoding === 'linear-rec709-d65'
				? linear
				: encodeManagedSdrLinearPixelV1(linear, finishing.colorContext.outputSpace);
			for (let channel = 0; channel < 4; channel += 1) {
				pixels[offset + channel] = Math.round(value[channel]! * 255);
			}
		}
	}
	return Object.freeze({ width: frame.width, height: frame.height, pixels });
}

function spatialDenoise(
	frame: UnifiedExactRenderRgbaFrameV13,
	radius: number,
	strength: number,
	signal?: AbortSignal,
): UnifiedExactRenderRgbaFrameV13 {
	const pixels = frame.pixels.slice();
	for (let channel = 0; channel < 3; channel += 1) {
		const output = processSpatialDenoiseV1(channelFrame(frame, channel), { radius, strength, signal });
		writeChannel(pixels, channel, output);
	}
	return Object.freeze({ width: frame.width, height: frame.height, pixels });
}

async function temporalDenoise(
	frame: UnifiedExactRenderRgbaFrameV13,
	sourceFrame: number,
	neighborsValue: readonly Readonly<{
		readonly sourceFrame: number;
		readonly frame: UnifiedExactRenderRgbaFrameV13;
	}>[],
	body: VideoMotionAnalysisBodyV1,
	radius: number,
	strength: number,
	accelerator?: VideoMotionWebGl2AcceleratorV1,
	onAcceleratorFallback?: (reason: string) => void,
	signal?: AbortSignal,
): Promise<UnifiedExactRenderRgbaFrameV13> {
	const neighbors = neighborsValue.filter((neighbor) => (
		neighbor.sourceFrame !== sourceFrame
		&& Math.abs(neighbor.sourceFrame - sourceFrame) <= radius
	)).map((neighbor) => Object.freeze({
		sourceFrame: nonNegativeInteger(neighbor.sourceFrame, 'V13 temporal neighbor source frame'),
		frame: rgbaFrame(neighbor.frame, 'V13 temporal neighbor frame'),
		transformToCurrent: scaleMotionToFrame(
			motionBetween(body, neighbor.sourceFrame, sourceFrame), body, frame,
		),
	}));
	if (neighbors.some(({ frame: neighbor }) => (
		neighbor.width !== frame.width || neighbor.height !== frame.height
	))) throw new RangeError('V13 temporal neighbor dimensions changed.');
	const pixels = frame.pixels.slice();
	for (let channel = 0; channel < 3; channel += 1) {
		const motionNeighbors: VideoTemporalNeighborV1[] = neighbors.map((neighbor) => ({
			frame: channelFrame(neighbor.frame, channel),
			transformToCurrent: neighbor.transformToCurrent,
		}));
		const output = await processTemporalDenoiseV1({
			current: channelFrame(frame, channel),
			neighbors: motionNeighbors,
			strength,
			...(accelerator ? { accelerator } : {}),
			...(onAcceleratorFallback ? { onAcceleratorFallback } : {}),
			...(signal ? { signal } : {}),
		});
		writeChannel(pixels, channel, output);
	}
	return Object.freeze({ width: frame.width, height: frame.height, pixels });
}

async function exactTemporalNeighbors(
	request: UnifiedExactRenderFinishingFrameRequestV13,
	clipId: string,
	frame: UnifiedExactRenderRgbaFrameV13,
	sourceFrame: number,
	radius: number,
	body: VideoMotionAnalysisBodyV1,
): Promise<readonly Readonly<{
	readonly sourceFrame: number;
	readonly frame: UnifiedExactRenderRgbaFrameV13;
}>[]> {
	const ordinals: number[] = [];
	for (let ordinal = Math.max(body.startFrame, sourceFrame - radius);
		ordinal <= Math.min(body.endFrame - 1, sourceFrame + radius); ordinal += 1) {
		if (ordinal !== sourceFrame) ordinals.push(ordinal);
	}
	const supplied = new Map<number, UnifiedExactRenderRgbaFrameV13>();
	for (const neighbor of request.temporalNeighbors ?? []) {
		const ordinal = nonNegativeInteger(neighbor.sourceFrame, 'V13 temporal neighbor source frame');
		if (supplied.has(ordinal)) throw new RangeError(`V13 temporal neighbor ${String(ordinal)} is duplicated.`);
		supplied.set(ordinal, rgbaFrame(neighbor.frame, 'V13 temporal neighbor frame'));
	}
	const resolved: Array<Readonly<{
		readonly sourceFrame: number;
		readonly frame: UnifiedExactRenderRgbaFrameV13;
	}>> = [];
	for (const ordinal of ordinals) {
		throwIfAborted(request.signal);
		const candidate = request.resolveTemporalFrame
			? await request.resolveTemporalFrame(Object.freeze({
				clipId, sourceFrame: ordinal, width: frame.width, height: frame.height,
				...(request.signal ? { signal: request.signal } : {}),
			}))
			: supplied.get(ordinal) ?? null;
		throwIfAborted(request.signal);
		if (candidate === null) {
			throw new ReferenceError(`V13 temporal neighbor ${String(ordinal)} is unavailable.`);
		}
		const checked = rgbaFrame(candidate, `V13 temporal neighbor ${String(ordinal)}`);
		if (checked.width !== frame.width || checked.height !== frame.height) {
			throw new RangeError('V13 temporal neighbor dimensions changed.');
		}
		resolved.push(Object.freeze({ sourceFrame: ordinal, frame: checked }));
	}
	return Object.freeze(resolved);
}

function scaleMotionToFrame(
	motion: VideoSimilarityTransformV1,
	body: VideoMotionAnalysisBodyV1,
	frame: UnifiedExactRenderRgbaFrameV13,
): VideoSimilarityTransformV1 {
	return Object.freeze({
		...motion,
		translateX: motion.translateX * frame.width / body.analysisWidth,
		translateY: motion.translateY * frame.height / body.analysisHeight,
	});
}

function analysisBody(
	authority: ResolutionAuthority,
	source: UnifiedExactRenderPlanSource,
	stack: VideoProcessorStackV1,
	analysisId: string,
	assets: ReadonlyMap<string, Uint8Array<ArrayBuffer>> | undefined,
	cache: Map<string, VideoMotionAnalysisBodyV1>,
): VideoMotionAnalysisBodyV1 {
	const cached = cache.get(analysisId);
	if (cached) return cached;
	const reference = authority.finishing.motionAnalyses.find(({ id }) => id === analysisId);
	if (!reference) throw new ReferenceError(`V13 motion analysis ${analysisId} is unavailable.`);
	if (!(assets instanceof Map)) throw new ReferenceError('An authenticated V13 motion analysis body map is unavailable.');
	const bytes = assets.get(analysisId);
	if (!bytes) throw new ReferenceError(`The V13 motion analysis body ${analysisId} is unavailable.`);
	const body = requireAnalysis(reference, bytes, source, stack);
	cache.set(analysisId, body);
	return body;
}

function requireAnalysis(
	reference: VideoMotionAnalysisReferenceV1,
	bytes: Uint8Array<ArrayBuffer>,
	source: UnifiedExactRenderPlanSource,
	stack: VideoProcessorStackV1,
): VideoMotionAnalysisBodyV1 {
	return requireVideoMotionAnalysisBodyV1(reference, bytes, {
		inputSha256: source.contentSha256,
		processorStack: stack,
	});
}

function adjacentMotion(body: VideoMotionAnalysisBodyV1, frame: number): VideoSimilarityTransformV1 {
	if (frame === body.startFrame) return identityTransform();
	if (frame < body.startFrame || frame >= body.endFrame) {
		throw new RangeError('The V13 source frame is outside its motion analysis range.');
	}
	const row = body.transforms[frame - body.startFrame - 1];
	if (!row || row.frameNumber !== frame) throw new ReferenceError('The V13 adjacent motion transform is unavailable.');
	return row.transform;
}

function motionBetween(
	body: VideoMotionAnalysisBodyV1,
	fromFrame: number,
	toFrame: number,
): VideoSimilarityTransformV1 {
	if (fromFrame === toFrame) return identityTransform();
	if (fromFrame > toFrame) return invertMotion(motionBetween(body, toFrame, fromFrame));
	if (fromFrame < body.startFrame || toFrame >= body.endFrame) {
		throw new RangeError('A V13 temporal neighbor is outside its motion analysis range.');
	}
	let result = identityTransform();
	for (let frame = fromFrame + 1; frame <= toFrame; frame += 1) {
		result = composeMotion(result, adjacentMotion(body, frame));
	}
	return result;
}

function rgbaFrame(value: unknown, name: string): UnifiedExactRenderRgbaFrameV13 {
	if (!value || typeof value !== 'object') throw new TypeError(`${name} must be an RGBA frame.`);
	const frame = value as Partial<UnifiedExactRenderRgbaFrameV13>;
	const width = positiveInteger(frame.width, `${name} width`);
	const height = positiveInteger(frame.height, `${name} height`);
	if (width * height > 16_777_216 || !(frame.pixels instanceof Uint8Array)
		|| frame.pixels.byteLength !== width * height * 4) {
		throw new RangeError(`${name} requires exactly four bounded channels per pixel.`);
	}
	return Object.freeze({ width, height, pixels: Uint8Array.from(frame.pixels) });
}

function clipById(plan: UnifiedExactRenderPlanV13, clipId: string): UnifiedExactRenderClipNode {
	const clip = plan.nodes.find((node): node is UnifiedExactRenderClipNode => (
		node.kind === 'clip' && node.clipId === clipId
	));
	if (!clip) throw new ReferenceError(`V13 finishing clip ${clipId} is unavailable.`);
	return clip;
}

function sourceForClip(plan: UnifiedExactRenderPlanV13, clip: UnifiedExactRenderClipNode): UnifiedExactRenderPlanSource {
	const source = plan.sources.find(({ nodeId }) => nodeId === clip.sourceNodeId);
	if (!source) throw new ReferenceError('The V13 finishing clip source is unavailable.');
	return source;
}
function identityTransform(): VideoSimilarityTransformV1 {
	return Object.freeze({
		scale: 1, rotationRadians: 0, translateX: 0, translateY: 0,
		inlierCount: 0, meanError: 0,
	});
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096) {
		throw new TypeError(`${name} must be bounded text.`);
	}
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason instanceof Error) throw signal.reason;
	throw new DOMException('The V13 finishing operation was aborted.', 'AbortError');
}
