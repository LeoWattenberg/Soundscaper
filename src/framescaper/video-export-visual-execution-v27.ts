/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	applyManagedSdrGradeStackPixelV1,
	defaultVideoSourceColorInterpretationV1,
	type ParsedCubeLutV1,
	type VideoColorGradeV1,
	type VideoSourceColorInterpretationV1,
} from '../common/editor/video-color-management-v27.ts';
import { assertVideoKeyframeExportFrame, type VideoKeyframeExportFrame,
	type VideoKeyframeExportFrameSource } from '../common/editor/video-keyframe-export-frame-source.ts';
import type { VideoKeyframeVideoRgbaProducer } from '../common/editor/video-keyframe-video-encoder.ts';
import type { VideoKeyframeOfflineRgbaPostprocessor } from '../common/editor/ui/video-keyframe-offline-rgba-renderer.ts';
import {
	createUnifiedExactRenderVisualExportConsumerV13,
	type UnifiedExactRenderActiveAdjustmentV13,
	type UnifiedExactRenderVisualFrameEntryV13,
} from '../common/editor/unified-exact-render-visual-consumers-v13.ts';
import {
	materializeUnifiedExactRenderVisualEntryV13,
	type UnifiedExactRenderVisualRgbaV13,
} from '../common/editor/unified-exact-render-visual-materializer-v13.ts';
import type {
	UnifiedExactRenderFinishingNode,
	UnifiedExactRenderPlanV13,
	UnifiedExactRenderVisualNode,
} from '../common/editor/unified-exact-render-plan.ts';
import { evaluateVideoMaskMatteRgbaV13 } from '../common/editor/video-mask-matte-rgba-v13.ts';
import type { VideoVisualPresentationV1 } from '../common/editor/video-visual-presentation-v27.ts';
import { getVideoExportFormat } from '../common/editor/video-export.js';
import type { ProductVideoExportPlan } from '../common/editor/controller/product-video-export-strategy.ts';
import type { VideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
import type { FramescaperProjectV27 } from './editor-project-v27.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV27 } from './editor-project-unified-render-plan-v27.ts';
import { bindFramescaperUnifiedRenderTimingSidecarsV27 } from './editor-project-unified-render-timing-v27.ts';
import {
	loadFramescaperVideoExportVisualAssetsV27,
	type FramescaperVideoExportVisualAssetStoreV27,
} from './video-export-visual-assets-v27.ts';
import { createFramescaperVideoExportVisualFreshnessV27 } from './video-export-visual-freshness-v27.ts';

export type { FramescaperVideoExportVisualAssetStoreV27 } from './video-export-visual-assets-v27.ts';

export interface FramescaperVideoExportPictureDispositionV27 {
	readonly exactPlanVersion: 13;
	readonly nodeDispositions: readonly Readonly<{
		readonly nodeId: string;
		readonly kind: string;
		readonly disposition: 'executed' | 'verified-inventory' | 'inactive';
	}>[];
	readonly captionDisposition: 'sidecar-only';
	readonly captionTrackIds: readonly string[];
	readonly audioDisposition: 'shared-v21-delivery';
	readonly originalSourceIds: readonly string[];
	readonly unexplainedOmittedNodeIds: readonly string[];
}

export interface FramescaperVideoExportVisualExecutionV27 {
	readonly exactPlan: UnifiedExactRenderPlanV13;
	readonly timingSidecars: ReturnType<typeof bindFramescaperUnifiedRenderTimingSidecarsV27>;
	readonly postprocess: VideoKeyframeOfflineRgbaPostprocessor;
	accountFrame(frame: VideoKeyframeExportFrame, consumedNodeIds: readonly string[]): void;
	createProducer(frameSource: ProductFrameSource): VideoKeyframeVideoRgbaProducer;
	disposition(): FramescaperVideoExportPictureDispositionV27;
	dispose(): void;
}

type ProductFrameSource = VideoKeyframeExportFrameSource;

interface CreateRequest {
	readonly profile: unknown;
	readonly project: FramescaperProjectV27;
	readonly plan: ProductVideoExportPlan;
	readonly timingViewsBySourceId: ReadonlyMap<string, VideoSourceTimingView>;
	readonly store?: FramescaperVideoExportVisualAssetStoreV27;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}

export async function createFramescaperVideoExportVisualExecutionV27(
	request: CreateRequest,
): Promise<FramescaperVideoExportVisualExecutionV27> {
	assertReady(request);
	const exactPlan = createFramescaperProjectUnifiedExactRenderPlanV27(
		request.profile, request.project, renderAuthority(request),
	);
	const timingSidecars = bindFramescaperUnifiedRenderTimingSidecarsV27(request.project, request.timingViewsBySourceId);
	const consumer = createUnifiedExactRenderVisualExportConsumerV13(exactPlan, timingSidecars);
	const finishing = requiredFinishing(exactPlan);
	const assets = await loadFramescaperVideoExportVisualAssetsV27(request, exactPlan, finishing);
	const executed = new Set<string>();
	const verified = new Set(exactPlan.nodes.filter(
		(node): node is UnifiedExactRenderVisualNode => node.kind === 'visual'
			&& node.modelKind === 'preset',
	).map(({ nodeId }) => nodeId));
	const unexplained = new Set<string>();
	const clipNodeById = new Map(exactPlan.nodes.flatMap((node) => (
		node.kind === 'clip' ? [[node.clipId, node.nodeId] as const] : []
	)));
	const sourceIdByClipId = new Map(exactPlan.nodes.flatMap((node) => {
		if (node.kind !== 'clip') return [];
		const source = exactPlan.sources.find(({ nodeId }) => nodeId === node.sourceNodeId);
		if (!source) throw new ReferenceError(`V27 clip source node ${node.sourceNodeId} is unavailable.`);
		return [[node.clipId, source.sourceId] as const];
	}));
	const masksById = new Map(exactPlan.nodes.flatMap((node) => (
		node.kind === 'visual' && node.modelKind === 'mask-matte' && 'inputs' in node.authoredState
			? [[node.modelId, Object.freeze({ nodeId: node.nodeId, graph: node.authoredState })] as const]
			: []
	)));
	executed.add(finishing.nodeId);
	let disposed = false;

	const postprocess: VideoKeyframeOfflineRgbaPostprocessor = async ({
		frame, width, height, rgba, signal,
	}) => {
		if (signal !== request.signal) throw new TypeError('V27 visual execution requires its exact signal.');
		assertReady(request);
		if (disposed) throw new Error('V27 visual execution is disposed.');
		await renderFrame(frame, rgba, width, height, false, signal);
	};

	async function renderFrame(
		frame: VideoKeyframeExportFrame,
		target: Uint8Array<ArrayBuffer>,
		width: number,
		height: number,
		clear: boolean,
		executionSignal: AbortSignal,
	): Promise<void> {
		assertReady(request);
		throwIfAborted(executionSignal);
		if (clear) fillBackground(target, request.plan.canvas, width, height);
		const resolved = consumer.resolveFrame({
			sequencePosition: sequencePosition(frame, exactPlan),
		});
		for (const nodeId of resolved.ledger.consumedNodeIds) executed.add(nodeId);
		for (const nodeId of resolved.ledger.omittedNodeIds) unexplained.add(nodeId);
		for (const clipId of frameClipIds(frame)) {
			const nodeId = clipNodeById.get(clipId);
			if (!nodeId) throw new ReferenceError(`V27 encoded clip ${clipId} is absent from its V13 plan.`);
			executed.add(nodeId);
		}
		assertTransitionInputs(frame, resolved.transitionWeights);
		const maskInputs = new Map<string, UnifiedExactRenderVisualRgbaV13>();
		const materialized: Array<Readonly<{
			entry: UnifiedExactRenderVisualFrameEntryV13;
			frame: UnifiedExactRenderVisualRgbaV13;
		}>> = [];
		for (const layer of resolved.layers) for (const entry of layer.entries) {
			const raw = await materializeUnifiedExactRenderVisualEntryV13(Object.freeze({
				...entry, masks: Object.freeze([]),
			}), {
				targetWidth: width, targetHeight: height,
				decodeStill: (source) => Promise.resolve(requiredStill(assets.stills, source.id)),
				signal: executionSignal,
			});
			const source = sourceState(entry);
			maskInputs.set(String(source.id), raw);
			materialized.push(Object.freeze({ entry, frame: raw }));
		}
		applyVideoPresentation(frame, target, width, height, finishing, sourceIdByClipId,
			masksById, maskInputs, request.plan.canvas, executed);
		for (const { entry, frame: raw } of materialized) {
			assertReady(request);
			const masked = await materializeUnifiedExactRenderVisualEntryV13(entry, {
				targetWidth: width, targetHeight: height,
				decodeStill: () => Promise.resolve(raw),
				maskInputs,
				signal: executionSignal,
			});
			const graded = managedVisualFrame(finishing, entry, masked, assets.luts, executionSignal);
			composite(target, graded.pixels, entry.opacity, entry.blendMode);
		}
		const activeTrackIds = pictureTrackIds(frame, resolved.layers.map(({ trackId }) => trackId));
		for (const adjustment of resolved.activeAdjustmentLayers) {
			if ([...activeTrackIds].some((trackId) => !adjustment.targetTrackIds.includes(trackId))) {
				throw new Error('V27 adjustment targeting requires unavailable per-layer browser execution.');
			}
			applyAdjustment(finishing, adjustment, target, width, height, assets.luts, maskInputs, executionSignal);
		}
		throwIfAborted(executionSignal);
		assertReady(request);
	}

	function createProducer(frameSource: ProductFrameSource): VideoKeyframeVideoRgbaProducer {
		const width = frameSource.canvas.width;
		const height = frameSource.canvas.height;
		let active = false;
		return Object.freeze({
			width, height, byteLength: width * height * 4,
			async produce(frame: VideoKeyframeExportFrame, target: Uint8Array<ArrayBuffer>,
				options: Readonly<{ readonly signal: AbortSignal }>) {
				if (active) throw new Error('V27 visual producer cannot overlap frames.');
				active = true;
				try {
					assertVideoKeyframeExportFrame(frameSource, frame);
					throwIfAborted(options.signal);
					if (target.byteLength !== width * height * 4) throw new RangeError('V27 visual target geometry changed.');
					await renderFrame(frame, target, width, height, true, options.signal);
				} catch (error) {
					target.fill(0);
					throw error;
				} finally { active = false; }
			},
			dispose() { dispose(); },
		});
	}

	function disposition(): FramescaperVideoExportPictureDispositionV27 {
		return Object.freeze({
			exactPlanVersion: 13 as const,
			nodeDispositions: Object.freeze(exactPlan.nodes.map((node) => Object.freeze({
				nodeId: node.nodeId,
				kind: node.kind,
				disposition: executed.has(node.nodeId) ? 'executed' as const
					: verified.has(node.nodeId) ? 'verified-inventory' as const : 'inactive' as const,
			}))),
			captionDisposition: finishing.captionDisposition,
			captionTrackIds: Object.freeze(finishing.captionTracks.map(({ id }) => id)),
			audioDisposition: 'shared-v21-delivery' as const,
			originalSourceIds: Object.freeze(exactPlan.sources.map(({ sourceId }) => sourceId)),
			unexplainedOmittedNodeIds: Object.freeze([...unexplained].sort(compareText)),
		});
	}

	function accountFrame(frame: VideoKeyframeExportFrame, consumedNodeIds: readonly string[]): void {
		if (disposed) throw new Error('V27 visual execution is disposed.');
		for (const nodeId of consumedNodeIds) {
			if (!exactPlan.nodes.some((node) => node.nodeId === nodeId)) {
				throw new ReferenceError(`V27 executed node ${nodeId} is absent from its V13 plan.`);
			}
			executed.add(nodeId);
		}
		for (const clipId of frameClipIds(frame)) {
			const nodeId = clipNodeById.get(clipId);
			if (!nodeId) throw new ReferenceError(`V27 encoded clip ${clipId} is absent from its V13 plan.`);
			executed.add(nodeId);
		}
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		for (const frame of assets.stills.values()) frame.pixels.fill(0);
	}

	return Object.freeze({ exactPlan, timingSidecars, postprocess, accountFrame, createProducer, disposition, dispose });
}

function pictureTrackIds(frame: VideoKeyframeExportFrame, visualTrackIds: readonly string[]): Set<string> {
	const result = new Set(visualTrackIds);
	for (const layerValue of frame.layers) {
		const layer = record(layerValue, 'V27 picture frame layer');
		if (typeof layer.trackId === 'string' && layer.trackId) result.add(layer.trackId);
	}
	return result;
}

function applyVideoPresentation(
	frame: VideoKeyframeExportFrame,
	target: Uint8Array<ArrayBuffer>,
	width: number,
	height: number,
	finishing: UnifiedExactRenderFinishingNode,
	sourceIdByClipId: ReadonlyMap<string, string>,
	masksById: ReadonlyMap<string, Readonly<{ nodeId: string; graph: Parameters<typeof evaluateVideoMaskMatteRgbaV13>[0] }>>,
	maskInputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
	canvas: unknown,
	executed: Set<string>,
): void {
	const clipIds = frameClipIds(frame);
	if (clipIds.length !== 1) return;
	const clipId = clipIds[0]!;
	const sourceId = sourceIdByClipId.get(clipId);
	if (!sourceId) throw new ReferenceError(`V27 presentation source for clip ${clipId} is unavailable.`);
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
	const source = target.slice() as Uint8Array<ArrayBuffer>;
	for (const maskId of [...maskIds].sort(compareText)) {
		const mask = masksById.get(maskId);
		if (!mask) throw new ReferenceError(`V27 video presentation mask ${maskId} is unavailable.`);
		const alpha = evaluateVideoMaskMatteRgbaV13(mask.graph, width, height, maskInputs);
		for (let index = 0; index < alpha.length; index += 1) {
			source[index * 4 + 3] = Math.round(source[index * 4 + 3]! * alpha[index]! / 255);
		}
		executed.add(mask.nodeId);
	}
	fillBackground(target, canvas, width, height);
	composite(target, source, opacity, blendMode);
}

function renderAuthority(request: CreateRequest) {
	const canvas = record(request.plan.canvas, 'V27 visual export canvas');
	const frameRate = record(canvas.frameRate, 'V27 visual export frame rate');
	const format = getVideoExportFormat(request.plan.format) as Readonly<Record<string, unknown>>;
	return Object.freeze({
		sequenceId: stableId(request.project.primarySequenceId, 'V27 visual primary sequence'),
		sampleStart: request.plan.range.startFrame,
		sampleDuration: request.plan.range.durationFrames,
		outputRate: Object.freeze({ num: frameRate.num, den: frameRate.den }),
		format: Object.freeze({
			container: format.container, extension: format.extension, mimeType: format.mimeType,
		}),
		codecs: Object.freeze({
			video: format.videoCodec, videoEncoder: format.videoEncoder,
			audio: null, audioEncoder: null, pixelFormat: 'yuv420p',
		}),
		canvas: Object.freeze({
			width: canvas.width, height: canvas.height, fit: canvas.fit,
			pixelFormat: 'yuv420p', backgroundColor: canvas.backgroundColor,
		}),
		quality: request.plan.quality ?? 'balanced',
		includeAudio: false,
		audioLayout: null,
		timingViews: request.timingViewsBySourceId,
		visualFreshnessByModelId: createFramescaperVideoExportVisualFreshnessV27(
			request.project, request.plan.range,
		),
	});
}

function managedVisualFrame(
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
	return gradeFrame(frame, interpretation, presentations.flatMap(({ grade }) => grade ? [grade] : []),
		finishing, luts, signal);
}

function applyAdjustment(
	finishing: UnifiedExactRenderFinishingNode,
	adjustment: UnifiedExactRenderActiveAdjustmentV13,
	target: Uint8Array<ArrayBuffer>,
	width: number,
	height: number,
	luts: ReadonlyMap<string, ParsedCubeLutV1>,
	maskInputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
	signal: AbortSignal,
): void {
	if (adjustment.effectIds.length > 0) {
		throw new Error('V27 browser export refuses an adjustment layer with unexecutable legacy effect IDs.');
	}
	const presentations = finishing.visualPresentations.filter((presentation) => (
		presentation.enabled && presentation.owner.kind === 'adjustment-layer'
		&& presentation.owner.id === adjustment.modelId
	));
	const interpretation: VideoSourceColorInterpretationV1 = finishing.colorContext.outputSpace === 'srgb'
		? defaultVideoSourceColorInterpretationV1('still', `adjustment-${adjustment.modelId}`)
		: Object.freeze({
			schemaVersion: 1 as const, sourceId: `adjustment-${adjustment.modelId}`,
			sourceKind: 'still' as const, primaries: 'bt709' as const, transfer: 'bt709' as const,
			matrix: 'rgb' as const, range: 'full' as const, provenance: 'user-override' as const,
		});
	let frame = gradeFrame(Object.freeze({ width, height, pixels: target.slice() as Uint8Array<ArrayBuffer> }),
		interpretation, presentations.flatMap(({ grade }) => grade ? [grade] : []), finishing, luts, signal);
	if (adjustment.masks.length > 0) {
		const pixels = frame.pixels.slice() as Uint8Array<ArrayBuffer>;
		for (const graph of adjustment.masks) {
			const mask = evaluateVideoMaskMatteRgbaV13(graph, width, height, maskInputs);
			for (let index = 0; index < mask.length; index += 1) {
				pixels[index * 4 + 3] = Math.round(pixels[index * 4 + 3]! * mask[index]! / 255);
			}
		}
		frame = Object.freeze({ width, height, pixels });
	}
	composite(target, frame.pixels, adjustment.opacity, adjustment.blendMode);
}

function gradeFrame(
	frame: UnifiedExactRenderVisualRgbaV13,
	interpretation: VideoSourceColorInterpretationV1,
	grades: readonly VideoColorGradeV1[],
	finishing: UnifiedExactRenderFinishingNode,
	luts: ReadonlyMap<string, ParsedCubeLutV1>,
	signal: AbortSignal,
): UnifiedExactRenderVisualRgbaV13 {
	const bodies = grades.map(({ lut }) => lut ? luts.get(lut.sha256) : undefined);
	const pixels = new Uint8Array(frame.pixels.byteLength);
	for (let y = 0; y < frame.height; y += 1) {
		throwIfAborted(signal);
		for (let x = 0; x < frame.width; x += 1) {
			const offset = (y * frame.width + x) * 4;
			const output = applyManagedSdrGradeStackPixelV1({
				rgba: [frame.pixels[offset]! / 255, frame.pixels[offset + 1]! / 255,
					frame.pixels[offset + 2]! / 255, frame.pixels[offset + 3]! / 255],
				interpretation, grades, luts: bodies,
				outputSpace: finishing.colorContext.outputSpace,
			});
			for (let channel = 0; channel < 4; channel += 1) {
				pixels[offset + channel] = Math.round(output[channel]! * 255);
			}
		}
	}
	return Object.freeze({ width: frame.width, height: frame.height, pixels });
}

function composite(
	target: Uint8Array<ArrayBuffer>,
	source: Uint8Array<ArrayBuffer>,
	opacity: number,
	blendMode: VideoVisualPresentationV1['blendMode'],
): void {
	for (let offset = 0; offset < target.length; offset += 4) {
		const sourceAlpha = source[offset + 3]! / 255 * opacity;
		const targetAlpha = target[offset + 3]! / 255;
		const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
		for (let channel = 0; channel < 3; channel += 1) {
			const below = target[offset + channel]! / 255;
			const above = source[offset + channel]! / 255;
			const blended = blend(below, above, blendMode);
			const value = outputAlpha === 0 ? 0 : (blended * sourceAlpha
				+ below * targetAlpha * (1 - sourceAlpha)) / outputAlpha;
			target[offset + channel] = Math.round(clamp(value) * 255);
		}
		target[offset + 3] = Math.round(clamp(outputAlpha) * 255);
	}
}

function blend(below: number, above: number, mode: VideoVisualPresentationV1['blendMode']): number {
	if (mode === 'multiply') return below * above;
	if (mode === 'screen') return 1 - (1 - below) * (1 - above);
	if (mode === 'overlay') return below <= 0.5 ? 2 * below * above
		: 1 - 2 * (1 - below) * (1 - above);
	if (mode === 'add') return Math.min(1, below + above);
	return above;
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
	if (!result) throw new ReferenceError(`V27 visual source interpretation ${sourceId} is unavailable.`);
	return result;
}

function sourceState(entry: UnifiedExactRenderVisualFrameEntryV13): Readonly<Record<string, unknown>> {
	if (!('source' in entry.authoredState)) throw new TypeError('V27 visual entry source is unavailable.');
	return record(entry.authoredState.source, 'V27 visual entry source');
}

function assertTransitionInputs(
	frame: VideoKeyframeExportFrame,
	weights: readonly Readonly<{ readonly clipId: string; readonly weight: number }>[],
): void {
	if (weights.length === 0) return;
	const active = new Map<string, Readonly<Record<string, unknown>>>();
	for (const layerValue of frame.layers) {
		const layer = record(layerValue, 'V27 transition frame layer');
		if (!Array.isArray(layer.clips)) throw new TypeError('V27 transition layer clips are unavailable.');
		for (const clipValue of layer.clips) {
			const clip = record(clipValue, 'V27 transition clip');
			active.set(stableId(clip.clipId, 'V27 transition clip'), clip);
		}
	}
	for (const { clipId, weight } of weights) {
		const clip = active.get(clipId);
		const actual = clip ? frameTransitionWeight(clip) : null;
		if (!clip || (actual !== null && Math.abs(actual - weight) > 1e-9)) {
			throw new Error('V27 canonical dissolve weights diverged from the encoded picture inputs.');
		}
	}
}

function frameTransitionWeight(occurrence: Readonly<Record<string, unknown>>): number | null {
	const opacity = Number(occurrence.opacity);
	if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
		throw new TypeError('V27 transition occurrence opacity is unavailable.');
	}
	const clip = occurrence.clip === undefined ? null : record(occurrence.clip, 'V27 transition authored clip');
	if (Array.isArray(clip?.videoKeyframes) && clip.videoKeyframes.length > 0) return null;
	const composition = clip?.videoComposition === undefined
		? null : record(clip.videoComposition, 'V27 transition authored composition');
	const authoredOpacity = composition === null ? 1 : Number(composition.opacity);
	if (!Number.isFinite(authoredOpacity) || authoredOpacity < 0 || authoredOpacity > 1) {
		throw new TypeError('V27 transition authored opacity is invalid.');
	}
	if (authoredOpacity === 0) {
		if (opacity !== 0) throw new Error('V27 zero-opacity transition occurrence changed opacity.');
		return null;
	}
	return opacity / authoredOpacity;
}

function frameClipIds(frame: VideoKeyframeExportFrame): readonly string[] {
	const result: string[] = [];
	for (const layerValue of frame.layers) {
		const layer = record(layerValue, 'V27 frame layer');
		if (!Array.isArray(layer.clips)) throw new TypeError('V27 frame layer clips are unavailable.');
		for (const clipValue of layer.clips) result.push(stableId(
			record(clipValue, 'V27 frame clip').clipId, 'V27 frame clip',
		));
	}
	return result;
}

function sequencePosition(frame: VideoKeyframeExportFrame, plan: UnifiedExactRenderPlanV13) {
	const numerator = BigInt(frame.timelinePosition.num) * BigInt(plan.timebase.sequenceRate.num);
	const denominator = BigInt(frame.timelinePosition.den) * BigInt(plan.timebase.sampleRate)
		* BigInt(plan.timebase.sequenceRate.den);
	const divisor = gcd(numerator, denominator);
	const num = Number(numerator / divisor);
	const den = Number(denominator / divisor);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) {
		throw new RangeError('V27 visual sequence position exceeds its exact domain.');
	}
	return Object.freeze({ num, den });
}

function fillBackground(
	target: Uint8Array<ArrayBuffer>,
	canvasValue: unknown,
	width: number,
	height: number,
): void {
	if (target.byteLength !== width * height * 4) throw new RangeError('V27 visual output geometry changed.');
	const color = String(record(canvasValue, 'V27 visual canvas').backgroundColor);
	if (!/^#[a-fA-F0-9]{6}$/u.test(color)) throw new TypeError('V27 visual background is invalid.');
	const rgb = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
	for (let offset = 0; offset < target.length; offset += 4) {
		target[offset] = rgb[0]!; target[offset + 1] = rgb[1]!;
		target[offset + 2] = rgb[2]!; target[offset + 3] = 255;
	}
}

function requiredFinishing(plan: UnifiedExactRenderPlanV13): UnifiedExactRenderFinishingNode {
	const nodes = plan.nodes.filter((node): node is UnifiedExactRenderFinishingNode => node.kind === 'finishing');
	if (nodes.length !== 1) throw new ReferenceError('V27 visual execution requires one finishing node.');
	return nodes[0]!;
}

function requiredStill(
	stills: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
	id: string,
): UnifiedExactRenderVisualRgbaV13 {
	const result = stills.get(id);
	if (!result) throw new ReferenceError(`V27 decoded still ${id} is unavailable.`);
	return result;
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Readonly<Record<string, unknown>>;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) throw new TypeError(`${name} is invalid.`);
	return value;
}

function assertReady(request: Pick<CreateRequest, 'signal' | 'assertCurrent'>): void {
	throwIfAborted(request.signal);
	request.assertCurrent();
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? new DOMException('V27 visual export was cancelled.', 'AbortError');
}

function gcd(left: bigint, right: bigint): bigint {
	let a = left < 0n ? -left : left;
	let b = right;
	while (b !== 0n) [a, b] = [b, a % b];
	return a;
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
function compareText(left: string, right: string): number { return left.localeCompare(right); }
