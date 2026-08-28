/* SPDX-License-Identifier: AGPL-3.0-only */

/** Selected finishing adapter from exact keyed RGBA frames into the shared V13 finisher. */

import {
	parseCubeLutV1,
	type ParsedCubeLutV1,
	type VideoCubeLutReferenceV1,
} from '../common/editor/video-color-management-v27.ts';
import {
	requireVideoMotionAnalysisBodyV1,
} from '../common/editor/video-motion-analysis-v27.ts';
import type { VideoMotionAnalysisReferenceV1 } from '../common/editor/video-motion-model-v27.ts';
import type { BlobLike } from '../common/editor/storage/media-records.ts';
import type { VideoKeyframeOfflineRgbaPostprocessor } from '../common/editor/ui/video-keyframe-offline-rgba-renderer.ts';
import {
	createUnifiedExactRenderFinishingExportConsumerV13,
	type UnifiedExactRenderRgbaFrameV13,
} from '../common/editor/unified-exact-render-finishing-consumers-v13.ts';
import type {
	UnifiedExactRenderClipNode,
	UnifiedExactRenderFinishingNode,
} from '../common/editor/unified-exact-render-plan.ts';
import type { VideoKeyframeExportPlanV7 } from '../common/editor/video-keyframe-export-plan-v7.ts';
import type { VideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
import type { FramescaperProjectFinishing } from './editor-project-finishing.ts';
import { createFramescaperProjectUnifiedExactRenderPlanFinishing } from './editor-project-unified-render-plan-finishing.ts';
import { bindFramescaperUnifiedRenderTimingSidecarsFinishing } from './editor-project-unified-render-timing-finishing.ts';
import { createFramescaperVideoExportVisualFreshnessFinishing } from './video-export-visual-freshness-finishing.ts';

export interface FramescaperVideoExportFinishingAssetStoreFinishing {
	loadMediaAsset(
		storageKey: string,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	): PromiseLike<BlobLike | null>;
}

export interface FramescaperVideoExportFinishingRequestFinishing {
	readonly profile: unknown;
	readonly project: FramescaperProjectFinishing;
	readonly plan: VideoKeyframeExportPlanV7;
	readonly timingViewsBySourceId: ReadonlyMap<string, VideoSourceTimingView>;
	readonly store?: FramescaperVideoExportFinishingAssetStoreFinishing;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}

export interface FramescaperVideoExportFinishingAssetsFinishing {
	readonly analyses: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
	readonly luts: ReadonlyMap<string, ParsedCubeLutV1>;
}

export interface FramescaperVideoFinishingAssetLoadRequestFinishing {
	readonly project: FramescaperProjectFinishing;
	readonly store?: FramescaperVideoExportFinishingAssetStoreFinishing;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}

interface FrameOccurrence {
	readonly clipId: string;
	readonly sourceFrame: number;
	readonly sequenceFrame: number;
}

const MAXIMUM_AUXILIARY_ASSETS = 256;
const MAXIMUM_AUXILIARY_BYTES = 512 * 1024 * 1024;
const MAXIMUM_TEMPORAL_CACHE_FRAMES = 17;

/** Load digest-bound finishing assets, then create one export-owned post-compositor. */
export async function createFramescaperVideoExportFinishingFinishing(
	request: FramescaperVideoExportFinishingRequestFinishing,
): Promise<VideoKeyframeOfflineRgbaPostprocessor> {
	assertReady(request);
	if (!(request.timingViewsBySourceId instanceof Map)) {
		throw new TypeError('Selected finishing export requires raw authenticated source timing views.');
	}
	const exactPlan = createFramescaperProjectUnifiedExactRenderPlanFinishing(
		request.profile,
		request.project,
		renderAuthority(request),
	);
	const timingSidecars = bindFramescaperUnifiedRenderTimingSidecarsFinishing(
		request.project, request.timingViewsBySourceId,
	);
	const consumer = createUnifiedExactRenderFinishingExportConsumerV13(exactPlan, timingSidecars);
	const finishing = exactPlan.nodes.find(
		(node): node is UnifiedExactRenderFinishingNode => node.kind === 'finishing',
	)!;
	const clips = new Map(exactPlan.nodes.filter(
		(node): node is UnifiedExactRenderClipNode => node.kind === 'clip',
	).map((node) => [node.clipId, node]));
	const sourceIdByNodeId = new Map(exactPlan.sources.map(({ nodeId, sourceId }) => [nodeId, sourceId]));
	const assets = await loadFramescaperVideoExportFinishingAssetsFinishing(request, finishing);
	const temporalCache = new Map<string, Map<number, UnifiedExactRenderRgbaFrameV13>>();
	return async ({ frame, width, height, rgba, signal }) => {
		assertSameSignal(request.signal, signal);
		assertReady(request);
		const occurrence = exactOccurrence(frame.layers, clips, sourceIdByNodeId, finishing);
		if (occurrence === null) return;
		const input = Object.freeze({ width, height, pixels: rgba.slice() });
		const cache = temporalCache.get(occurrence.clipId) ?? new Map();
		if (!temporalCache.has(occurrence.clipId)) temporalCache.set(occurrence.clipId, cache);
		const temporalNeighbors = Object.freeze([...cache].map(([sourceFrame, neighbor]) => (
			Object.freeze({ sourceFrame, frame: neighbor })
		)));
		const resolved = await consumer.resolveFrame({
			clipId: occurrence.clipId,
			sourceFrame: occurrence.sourceFrame,
			sequenceFrame: occurrence.sequenceFrame,
			frame: input,
			// Offline-rendered export pixels are browser readback (WebGL
			// readPixels of browser-decoded media): full-range canvas sRGB.
			frameEncoding: 'canvas-srgb',
			temporalNeighbors,
			analysisBodies: assets.analyses,
			lutBodies: assets.luts,
			signal,
			onProgress: () => request.assertCurrent(),
		});
		assertReady(request);
		if (resolved.width !== width || resolved.height !== height
			|| resolved.pixels.byteLength !== rgba.byteLength) {
			throw new RangeError('Selected V13 finishing changed the exact export frame geometry.');
		}
		rgba.set(resolved.pixels);
		cache.set(occurrence.sourceFrame, input);
		while (cache.size > MAXIMUM_TEMPORAL_CACHE_FRAMES) cache.delete(cache.keys().next().value!);
	};
}

function renderAuthority(request: FramescaperVideoExportFinishingRequestFinishing) {
	const plan = request.plan;
	const project = request.project as unknown as Readonly<Record<string, unknown>>;
	return Object.freeze({
		sequenceId: stableId(project.primarySequenceId, 'Selected finishing primary sequence'),
		sampleStart: plan.range.startFrame,
		sampleDuration: plan.range.durationFrames,
		outputRate: plan.canvas.frameRate,
		format: Object.freeze({
			container: plan.container, extension: plan.extension, mimeType: plan.mimeType,
		}),
		codecs: Object.freeze({
			video: plan.codecs.video,
			videoEncoder: plan.codecs.videoEncoder,
			audio: null,
			audioEncoder: null,
			pixelFormat: plan.codecs.pixelFormat,
		}),
		canvas: Object.freeze({
			width: plan.canvas.width,
			height: plan.canvas.height,
			fit: plan.canvas.fit,
			pixelFormat: plan.canvas.pixelFormat,
			backgroundColor: plan.canvas.backgroundColor,
		}),
		quality: plan.quality,
		includeAudio: false,
		audioLayout: null,
		timingViews: request.timingViewsBySourceId,
		visualFreshnessByModelId: createFramescaperVideoExportVisualFreshnessFinishing(
			request.project, plan.range,
		),
	});
}

export async function loadFramescaperVideoExportFinishingAssetsFinishing(
	request: FramescaperVideoFinishingAssetLoadRequestFinishing,
	finishing: UnifiedExactRenderFinishingNode,
): Promise<FramescaperVideoExportFinishingAssetsFinishing> {
	const presentations = finishing.visualPresentations.filter(({ enabled }) => enabled);
	const lutReferences = uniqueBy(
		presentations.flatMap(({ grade }) => grade?.lut ? [grade.lut] : []),
		(reference) => reference.sha256,
	);
	const stackById = new Map(finishing.processorStacks.map((stack) => [stack.id, stack]));
	const analysisById = new Map(finishing.motionAnalyses.map((analysis) => [analysis.id, analysis]));
	const analysisReferences = uniqueBy(presentations.flatMap((presentation) => {
		if (presentation.processorStackId === null) return [];
		const stack = stackById.get(presentation.processorStackId);
		if (!stack) throw new ReferenceError('Selected V13 finishing stack is unavailable.');
		return stack.processors.flatMap((processor) => (
			processor.enabled && (processor.kind === 'similarity-stabilization'
				|| processor.kind === 'temporal-denoise')
				? [requiredAnalysis(analysisById, processor.analysisId)] : []
		));
	}), (reference) => reference.id);
	const references = [...lutReferences, ...analysisReferences];
	if (references.length > MAXIMUM_AUXILIARY_ASSETS
		|| references.reduce((total, reference) => total + reference.byteLength, 0)
			> MAXIMUM_AUXILIARY_BYTES) {
		throw new RangeError('Selected finishing finishing assets exceed the browser export bound.');
	}
	if (references.length > 0 && request.store === undefined) {
		throw new Error('Selected finishing finishing assets are unavailable in this browser runtime.');
	}
	const luts = new Map<string, ParsedCubeLutV1>();
	for (const reference of lutReferences) {
		const bytes = await loadAsset(request, reference);
		const parsed = parseCubeLutV1(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		assertLutReference(reference, parsed);
		luts.set(reference.sha256, parsed);
	}
	const analyses = new Map<string, Uint8Array<ArrayBuffer>>();
	const sourceValues = (request.project as unknown as Readonly<Record<string, unknown>>).sources;
	if (!Array.isArray(sourceValues)) throw new TypeError('Selected finishing finishing sources are unavailable.');
	const sourceById = new Map(sourceValues.map((sourceValue) => {
		const source = record(sourceValue, 'Selected finishing finishing source');
		return [String(source.id), source] as const;
	}));
	for (const reference of analysisReferences) {
		const bytes = await loadAsset(request, reference);
		const stack = stackById.get(reference.processorStackId)!;
		const source = sourceById.get(reference.sourceId) as Readonly<{ contentSha256?: unknown }> | undefined;
		requireVideoMotionAnalysisBodyV1(reference, bytes, {
			inputSha256: source?.contentSha256 as string,
			processorStack: stack,
		});
		analyses.set(reference.id, bytes);
	}
	return Object.freeze({ analyses, luts });
}

async function loadAsset(
	request: FramescaperVideoFinishingAssetLoadRequestFinishing,
	reference: Readonly<{ storageKey: string; byteLength: number }>,
): Promise<Uint8Array<ArrayBuffer>> {
	assertReady(request);
	const blob = await request.store!.loadMediaAsset(reference.storageKey, { signal: request.signal });
	assertReady(request);
	if (!blob || blob.size !== reference.byteLength || typeof blob.arrayBuffer !== 'function') {
		throw new Error(`Selected finishing finishing asset ${reference.storageKey} is missing or stale.`);
	}
	const bytes = Uint8Array.from(new Uint8Array(await blob.arrayBuffer()));
	assertReady(request);
	return bytes;
}

function exactOccurrence(
	layersValue: readonly unknown[],
	clips: ReadonlyMap<string, UnifiedExactRenderClipNode>,
	sourceIdByNodeId: ReadonlyMap<string, string>,
	finishing: UnifiedExactRenderFinishingNode,
): FrameOccurrence | null {
	if (!Array.isArray(layersValue)) throw new TypeError('Selected finishing finishing requires exact frame layers.');
	const occurrences: Readonly<Record<string, unknown>>[] = [];
	for (const layerValue of layersValue) {
		const layer = record(layerValue, 'Selected finishing finishing layer');
		if (!Array.isArray(layer.clips)) throw new TypeError('Selected finishing finishing layer clips are unavailable.');
		for (const occurrence of layer.clips) occurrences.push(record(occurrence, 'Selected finishing finishing occurrence'));
	}
	if (occurrences.length === 0) return null;
	const validated = occurrences.map((occurrence) => occurrenceState(occurrence, clips, sourceIdByNodeId));
	if (validated.length > 1) assertSharedCompositeFinishing(validated, finishing);
	const { occurrence, clipId, clip } = validated[0]!;
	const descriptor = record(occurrence.presentationDescriptor, 'Selected finishing exact presentation');
	const sourceFrame = nonNegativeInteger(descriptor.drawableSourceFrame, 'Selected finishing source frame');
	const outerCell = nonNegativeInteger(descriptor.outerCell, 'Selected finishing outer cell');
	const sequenceFrame = clip.sequenceStartFrame + outerCell;
	if (!Number.isSafeInteger(sequenceFrame)) throw new RangeError('Selected finishing sequence frame overflowed.');
	return Object.freeze({ clipId, sourceFrame, sequenceFrame });
}

function occurrenceState(
	occurrence: Readonly<Record<string, unknown>>,
	clips: ReadonlyMap<string, UnifiedExactRenderClipNode>,
	sourceIdByNodeId: ReadonlyMap<string, string>,
) {
	const clipId = stableId(occurrence.clipId, 'Selected finishing finishing clip');
	const clip = clips.get(clipId);
	if (!clip) throw new Error('Selected finishing finishing occurrence diverged from its V13 plan.');
	const sourceId = sourceIdByNodeId.get(clip.sourceNodeId);
	if (!sourceId || occurrence.sourceId !== sourceId) {
		throw new Error('Selected finishing finishing occurrence diverged from its V13 plan.');
	}
	return Object.freeze({ occurrence, clipId, clip, sourceId });
}

function assertSharedCompositeFinishing(
	occurrences: readonly Readonly<{ clipId: string; sourceId: string }>[],
	finishing: UnifiedExactRenderFinishingNode,
): void {
	const clipIds = new Set(occurrences.map(({ clipId }) => clipId));
	const sourceIds = new Set(occurrences.map(({ sourceId }) => sourceId));
	if (finishing.visualPresentations.some(({ enabled, owner }) => enabled && (
		(owner.kind === 'clip' && clipIds.has(owner.id))
		|| (owner.kind === 'source' && sourceIds.has(owner.id))
	))) {
		throw new Error('Selected finishing browser finishing requires per-layer execution for this composite.');
	}
	const interpretations = occurrences.map(({ sourceId }) => finishing.sourceInterpretations.find(
		(value) => value.sourceId === sourceId,
	));
	if (interpretations.some((value) => value === undefined)
		|| interpretations.some((value) => JSON.stringify(colorIdentity(value!))
			!== JSON.stringify(colorIdentity(interpretations[0]!)))) {
		throw new Error('Selected finishing browser finishing refuses a composite with divergent source color contexts.');
	}
}

function colorIdentity(value: UnifiedExactRenderFinishingNode['sourceInterpretations'][number]) {
	return Object.freeze({
		primaries: value.primaries, transfer: value.transfer,
		matrix: value.matrix, range: value.range,
	});
}

function requiredAnalysis(
	byId: ReadonlyMap<string, VideoMotionAnalysisReferenceV1>,
	id: string,
): VideoMotionAnalysisReferenceV1 {
	const reference = byId.get(id);
	if (!reference) throw new ReferenceError(`Selected finishing motion analysis ${id} is unavailable.`);
	return reference;
}

function uniqueBy<Value>(values: readonly Value[], key: (value: Value) => string): readonly Value[] {
	const result = new Map<string, Value>();
	for (const value of values) {
		const identity = key(value);
		const current = result.get(identity);
		if (current !== undefined && JSON.stringify(current) !== JSON.stringify(value)) {
			throw new Error(`Selected finishing finishing asset ${identity} has conflicting references.`);
		}
		result.set(identity, value);
	}
	return Object.freeze([...result.values()]);
}

function assertLutReference(reference: VideoCubeLutReferenceV1, body: ParsedCubeLutV1): void {
	if (reference.sha256 !== body.sha256 || reference.byteLength !== body.byteLength
		|| reference.size !== body.size
		|| JSON.stringify(reference.domainMin) !== JSON.stringify(body.domainMin)
		|| JSON.stringify(reference.domainMax) !== JSON.stringify(body.domainMax)) {
		throw new RangeError('Selected finishing cube LUT body is missing, stale, or geometrically mismatched.');
	}
}

function assertReady(
	request: Pick<FramescaperVideoExportFinishingRequestFinishing, 'signal' | 'assertCurrent'>,
): void {
	if (request.signal.aborted) {
		throw request.signal.reason ?? new DOMException('Selected finishing export was cancelled.', 'AbortError');
	}
	request.assertCurrent();
}

function assertSameSignal(expected: AbortSignal, actual: AbortSignal): void {
	if (actual !== expected) throw new TypeError('Selected finishing finishing requires its exact export AbortSignal.');
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError(`${name} must be a bounded identity.`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Readonly<Record<string, unknown>>;
}
