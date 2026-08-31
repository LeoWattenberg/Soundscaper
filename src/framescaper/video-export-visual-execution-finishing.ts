/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoKeyframeExportFrame } from '../common/editor/video-keyframe-export-frame-source.ts';
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
import { createFramescaperProjectUnifiedExactRenderPlanFinishing } from './editor-project-unified-render-plan-finishing.ts';
import { bindFramescaperUnifiedRenderTimingSidecarsFinishing } from './editor-project-unified-render-timing-finishing.ts';
import { createFramescaperVideoExportVisualFreshnessFinishing } from './video-export-visual-freshness-finishing.ts';

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
	accountFrame(frame: VideoKeyframeExportFrame, consumedNodeIds: readonly string[]): void;
	disposition(): FramescaperVideoExportPictureDispositionFinishing;
	dispose(): void;
}

interface CreateRequest {
	readonly profile: unknown;
	readonly project: FramescaperProjectFinishing;
	readonly plan: ProductVideoExportPlan;
	readonly timingViewsBySourceId: ReadonlyMap<string, VideoSourceTimingView>;
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
	const finishing = requiredFinishing(exactPlan);
	const executed = new Set<string>();
	const verified = new Set(exactPlan.nodes.filter(
		(node): node is UnifiedExactRenderVisualNode => node.kind === 'visual'
			&& node.modelKind === 'preset',
	).map(({ nodeId }) => nodeId));
	const clipNodeById = new Map(exactPlan.nodes.flatMap((node) => (
		node.kind === 'clip' ? [[node.clipId, node.nodeId] as const] : []
	)));
	executed.add(finishing.nodeId);
	let disposed = false;

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
			// The shared visual resolver refuses a frame with any requested-but-unconsumed node.
			unexplainedOmittedNodeIds: Object.freeze([]),
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
	}

	return Object.freeze({ exactPlan, timingSidecars, accountFrame, disposition, dispose });
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
