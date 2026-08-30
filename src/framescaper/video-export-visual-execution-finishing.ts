/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../common/editor/code-unit-order.ts';
import {
	addUnifiedExactLinearCompositionEntryV13,
	compositeUnifiedExactLinearFrameV13,
	createUnifiedExactLinearPremultipliedFrameV13,
	encodeUnifiedExactLinearFrameV13,
	placeUnifiedExactLinearRgbaFrameV13,
	type UnifiedExactLinearCompositionEntryV13,
} from '../common/editor/unified-exact-linear-rgba-v13.ts';
import {
	applyAdjustment,
	applyVideoPresentationLinear,
	backgroundLinear,
	combinedGraphs,
	decodeEncodedPicture,
	managedVisualFrame,
	sourceState,
} from './video-export-visual-linear-finishing.ts';
import { assertVideoKeyframeExportFrame, type VideoKeyframeExportFrame,
	type VideoKeyframeExportFrameSource } from '../common/editor/video-keyframe-export-frame-source.ts';
import type { VideoKeyframeVideoRgbaProducer } from '../common/editor/video-keyframe-video-encoder.ts';
import type { VideoKeyframeOfflineRgbaPostprocessor } from '../common/editor/ui/video-keyframe-offline-rgba-renderer.ts';
import {
	createUnifiedExactRenderVisualExportConsumerV13,
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
import { getVideoExportFormat } from '../common/editor/video-export.js';
import type { ProductVideoExportPlan } from '../common/editor/controller/product-video-export-strategy.ts';
import type { VideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
import type { FramescaperProjectFinishing } from './editor-project-finishing.ts';
import type { FramescaperOpenFxFrameDispositionNativeMedia } from './editor-openfx-frame-graph-native-media.ts';
import { framescaperVisualSequencePositionFinishing } from './video-export-visual-frame-geometry-finishing.ts';
import { createFramescaperProjectUnifiedExactRenderPlanFinishing } from './editor-project-unified-render-plan-finishing.ts';
import { bindFramescaperUnifiedRenderTimingSidecarsFinishing } from './editor-project-unified-render-timing-finishing.ts';
import {
	loadFramescaperVideoExportVisualAssetsFinishing,
	type FramescaperVideoExportVisualAssetStoreFinishing,
} from './video-export-visual-assets-finishing.ts';
import { createFramescaperVideoExportVisualFreshnessFinishing } from './video-export-visual-freshness-finishing.ts';
import {
	resolveFramescaperVisualPlacementFinishing,
	type FramescaperVisualPlacementFinishing,
} from './visual-placement-finishing.ts';

export type { FramescaperVideoExportVisualAssetStoreFinishing } from './video-export-visual-assets-finishing.ts';

export interface FramescaperVideoExportPictureDispositionFinishing {
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
	readonly openFxDispositions?: readonly FramescaperOpenFxFrameDispositionNativeMedia[];
	readonly reportsOpenFxDegradation?: boolean;
}

export interface FramescaperVideoExportVisualExecutionFinishing {
	readonly exactPlan: UnifiedExactRenderPlanV13;
	readonly timingSidecars: ReturnType<typeof bindFramescaperUnifiedRenderTimingSidecarsFinishing>;
	readonly postprocess: VideoKeyframeOfflineRgbaPostprocessor;
	accountFrame(frame: VideoKeyframeExportFrame, consumedNodeIds: readonly string[]): void;
	createProducer(frameSource: ProductFrameSource): VideoKeyframeVideoRgbaProducer;
	disposition(): FramescaperVideoExportPictureDispositionFinishing;
	dispose(): void;
}

type ProductFrameSource = VideoKeyframeExportFrameSource;

interface CreateRequest {
	readonly profile: unknown;
	readonly project: FramescaperProjectFinishing;
	readonly plan: ProductVideoExportPlan;
	readonly timingViewsBySourceId: ReadonlyMap<string, VideoSourceTimingView>;
	readonly store?: FramescaperVideoExportVisualAssetStoreFinishing;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}

export async function createFramescaperVideoExportVisualExecutionFinishing(
	request: CreateRequest,
): Promise<FramescaperVideoExportVisualExecutionFinishing> {
	assertReady(request);
	const exactPlan = createFramescaperProjectUnifiedExactRenderPlanFinishing(
		request.profile, request.project, renderAuthority(request),
	);
	const timingSidecars = bindFramescaperUnifiedRenderTimingSidecarsFinishing(request.project, request.timingViewsBySourceId);
	const consumer = createUnifiedExactRenderVisualExportConsumerV13(exactPlan, timingSidecars);
	const finishing = requiredFinishing(exactPlan);
	const assets = await loadFramescaperVideoExportVisualAssetsFinishing(request, exactPlan, finishing);
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
		if (!source) throw new ReferenceError(`finishing clip source node ${node.sourceNodeId} is unavailable.`);
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
		if (signal !== request.signal) throw new TypeError('finishing visual execution requires its exact signal.');
		assertReady(request);
		if (disposed) throw new Error('finishing visual execution is disposed.');
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
		const resolved = consumer.resolveFrame({
			sequencePosition: framescaperVisualSequencePositionFinishing(frame, exactPlan),
		});
		for (const nodeId of resolved.ledger.consumedNodeIds) executed.add(nodeId);
		for (const nodeId of resolved.ledger.omittedNodeIds) unexplained.add(nodeId);
		for (const clipId of frameClipIds(frame)) {
			const nodeId = clipNodeById.get(clipId);
			if (!nodeId) throw new ReferenceError(`finishing encoded clip ${clipId} is absent from its V13 plan.`);
			executed.add(nodeId);
		}
		assertTransitionInputs(frame, resolved.transitionWeights);
		const maskInputs = new Map<string, UnifiedExactRenderVisualRgbaV13>();
		const rawByEntry = new Map<UnifiedExactRenderVisualFrameEntryV13, UnifiedExactRenderVisualRgbaV13>();
		const placementByEntry = new Map<UnifiedExactRenderVisualFrameEntryV13, FramescaperVisualPlacementFinishing>();
		for (const layer of resolved.layers) for (const entry of layer.entries) {
			const placement = resolveFramescaperVisualPlacementFinishing(entry, {
				width, height, fit: exactPlan.output.canvas.fit,
			});
			const raw = await materializeUnifiedExactRenderVisualEntryV13(Object.freeze({
				...entry, masks: Object.freeze([]),
			}), {
				targetWidth: placement.width, targetHeight: placement.height,
				decodeStill: (source) => Promise.resolve(requiredStill(assets.stills, source.id)),
				signal: executionSignal,
			});
			const source = sourceState(entry);
			maskInputs.set(String(source.id), raw);
			rawByEntry.set(entry, raw);
			placementByEntry.set(entry, placement);
		}
		// Playback and export are the same render: everything composites in the
		// linear premultiplied working space and encodes exactly once, matching
		// the selected exact frame execution the preview and keyed export use.
		const outputSpace = finishing.colorContext.outputSpace;
		const working = clear
			? createUnifiedExactLinearPremultipliedFrameV13(
				width, height, backgroundLinear(request.plan.canvas, outputSpace))
			: decodeEncodedPicture(target, width, height, outputSpace);
		if (!clear) applyVideoPresentationLinear(frameClipIds(frame), working, width, height, finishing,
			sourceIdByClipId, masksById, maskInputs, request.plan.canvas, outputSpace, executed);
		const trackEntries = new Map<string, UnifiedExactLinearCompositionEntryV13[]>();
		for (const layer of resolved.layers) {
			const list = trackEntries.get(layer.trackId) ?? [];
			if (!trackEntries.has(layer.trackId)) trackEntries.set(layer.trackId, list);
			for (const entry of layer.entries) {
				assertReady(request);
				const raw = rawByEntry.get(entry);
				if (!raw) throw new ReferenceError(`finishing visual entry ${entry.modelId} was not materialized.`);
				const placement = placementByEntry.get(entry);
				if (!placement) throw new ReferenceError(`finishing visual entry ${entry.modelId} has no placement.`);
				const graded = managedVisualFrame(finishing, entry, raw, assets.luts, executionSignal);
				const mask = entry.masks.length === 0 ? undefined
					: combinedGraphs(entry.masks, width, height, maskInputs);
				addUnifiedExactLinearCompositionEntryV13(list, placeUnifiedExactLinearRgbaFrameV13({
					frame: graded, displayWidth: placement.width, displayHeight: placement.height,
					outputWidth: width, outputHeight: height,
					renderDescription: placement.renderDescription,
					...(mask ? { mask } : {}),
				}), entry.blendMode);
			}
		}
		const pictureTracks = clear ? new Set<string>() : pictureTrackIds(frame, []);
		for (const adjustment of resolved.activeAdjustmentLayers) {
			applyAdjustment(finishing, adjustment, trackEntries, working, pictureTracks,
				width, height, assets.luts, maskInputs, executionSignal);
		}
		for (const track of [...exactPlan.tracks].sort((left, right) => (
			right.sequenceOrder - left.sequenceOrder || compareCodeUnits(left.trackId, right.trackId)
		))) {
			for (const { frame: layerFrame, blendMode } of trackEntries.get(track.trackId) ?? []) {
				compositeUnifiedExactLinearFrameV13(working, layerFrame, blendMode);
			}
		}
		encodeUnifiedExactLinearFrameV13(working, outputSpace, target);
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
				if (active) throw new Error('finishing visual producer cannot overlap frames.');
				active = true;
				try {
					assertVideoKeyframeExportFrame(frameSource, frame);
					throwIfAborted(options.signal);
					if (target.byteLength !== width * height * 4) throw new RangeError('finishing visual target geometry changed.');
					await renderFrame(frame, target, width, height, true, options.signal);
				} catch (error) {
					target.fill(0);
					throw error;
				} finally { active = false; }
			},
			dispose() { dispose(); },
		});
	}

	function disposition(): FramescaperVideoExportPictureDispositionFinishing {
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
			unexplainedOmittedNodeIds: Object.freeze([...unexplained].sort(compareCodeUnits)),
		});
	}

	function accountFrame(frame: VideoKeyframeExportFrame, consumedNodeIds: readonly string[]): void {
		if (disposed) throw new Error('finishing visual execution is disposed.');
		for (const nodeId of consumedNodeIds) {
			if (!exactPlan.nodes.some((node) => node.nodeId === nodeId)) {
				throw new ReferenceError(`finishing executed node ${nodeId} is absent from its V13 plan.`);
			}
			executed.add(nodeId);
		}
		for (const clipId of frameClipIds(frame)) {
			const nodeId = clipNodeById.get(clipId);
			if (!nodeId) throw new ReferenceError(`finishing encoded clip ${clipId} is absent from its V13 plan.`);
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
		const layer = record(layerValue, 'finishing picture frame layer');
		if (typeof layer.trackId === 'string' && layer.trackId) result.add(layer.trackId);
	}
	return result;
}

function renderAuthority(request: CreateRequest) {
	const canvas = record(request.plan.canvas, 'finishing visual export canvas');
	const frameRate = record(canvas.frameRate, 'finishing visual export frame rate');
	const format = getVideoExportFormat(request.plan.format) as Readonly<Record<string, unknown>>;
	return Object.freeze({
		sequenceId: stableId(request.project.primarySequenceId, 'finishing visual primary sequence'),
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
		visualFreshnessByModelId: createFramescaperVideoExportVisualFreshnessFinishing(
			request.project, request.plan.range,
		),
	});
}

/** Decode and grade one authored visual into straight linear working pixels. */
function assertTransitionInputs(
	frame: VideoKeyframeExportFrame,
	weights: readonly Readonly<{ readonly clipId: string; readonly weight: number }>[],
): void {
	if (weights.length === 0) return;
	const active = new Map<string, Readonly<Record<string, unknown>>>();
	for (const layerValue of frame.layers) {
		const layer = record(layerValue, 'finishing transition frame layer');
		if (!Array.isArray(layer.clips)) throw new TypeError('finishing transition layer clips are unavailable.');
		for (const clipValue of layer.clips) {
			const clip = record(clipValue, 'finishing transition clip');
			active.set(stableId(clip.clipId, 'finishing transition clip'), clip);
		}
	}
	for (const { clipId, weight } of weights) {
		const clip = active.get(clipId);
		const actual = clip ? frameTransitionWeight(clip) : null;
		if (!clip || (actual !== null && Math.abs(actual - weight) > 1e-9)) {
			throw new Error('finishing canonical dissolve weights diverged from the encoded picture inputs.');
		}
	}
}

function frameTransitionWeight(occurrence: Readonly<Record<string, unknown>>): number | null {
	const opacity = Number(occurrence.opacity);
	if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
		throw new TypeError('finishing transition occurrence opacity is unavailable.');
	}
	const clip = occurrence.clip === undefined ? null : record(occurrence.clip, 'finishing transition authored clip');
	if (Array.isArray(clip?.videoKeyframes) && clip.videoKeyframes.length > 0) return null;
	const composition = clip?.videoComposition === undefined
		? null : record(clip.videoComposition, 'finishing transition authored composition');
	const authoredOpacity = composition === null ? 1 : Number(composition.opacity);
	if (!Number.isFinite(authoredOpacity) || authoredOpacity < 0 || authoredOpacity > 1) {
		throw new TypeError('finishing transition authored opacity is invalid.');
	}
	if (authoredOpacity === 0) {
		if (opacity !== 0) throw new Error('finishing zero-opacity transition occurrence changed opacity.');
		return null;
	}
	return opacity / authoredOpacity;
}

function frameClipIds(frame: VideoKeyframeExportFrame): readonly string[] {
	const result: string[] = [];
	for (const layerValue of frame.layers) {
		const layer = record(layerValue, 'finishing frame layer');
		if (!Array.isArray(layer.clips)) throw new TypeError('finishing frame layer clips are unavailable.');
		for (const clipValue of layer.clips) result.push(stableId(
			record(clipValue, 'finishing frame clip').clipId, 'finishing frame clip',
		));
	}
	return result;
}

function requiredFinishing(plan: UnifiedExactRenderPlanV13): UnifiedExactRenderFinishingNode {
	const nodes = plan.nodes.filter((node): node is UnifiedExactRenderFinishingNode => node.kind === 'finishing');
	if (nodes.length !== 1) throw new ReferenceError('finishing visual execution requires one finishing node.');
	return nodes[0]!;
}

function requiredStill(
	stills: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
	id: string,
): UnifiedExactRenderVisualRgbaV13 {
	const result = stills.get(id);
	if (!result) throw new ReferenceError(`finishing decoded still ${id} is unavailable.`);
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
	if (signal.aborted) throw signal.reason ?? new DOMException('finishing visual export was cancelled.', 'AbortError');
}
