/* SPDX-License-Identifier: AGPL-3.0-only */

/** Renderer-neutral V13 visual/transition frame authority shared by preview and export. */

import {
	compareRationals,
	type Rational,
	type RationalInput,
} from './timeline-time.ts';
import {
	assertUnifiedExactRenderPlanV13,
	type UnifiedExactRenderFinishingNode,
	type UnifiedExactRenderPlanV13,
	type UnifiedExactRenderTransitionNode,
	type UnifiedExactRenderVisualNode,
} from './unified-exact-render-plan.ts';
import type { VideoMaskMatteGraphV1 } from './video-mask-matte-v24.ts';
import type { VideoVisualPresentationV1 } from './video-visual-presentation-v27.ts';
import {
	resolveVideoTransitionV1,
} from './video-transition-resolution.ts';

export interface UnifiedExactRenderVisualFrameRequestV13 {
	readonly sequencePosition: RationalInput;
}

export interface UnifiedExactRenderTransitionWeightV13 {
	readonly clipId: string;
	readonly transitionId: string;
	readonly weight: number;
}

export interface UnifiedExactRenderVisualFrameEntryV13 {
	readonly nodeId: string;
	readonly modelId: string;
	readonly modelKind: UnifiedExactRenderVisualNode['modelKind'];
	readonly trackId: string;
	readonly authoredState: UnifiedExactRenderVisualNode['authoredState'];
	readonly opacity: number;
	readonly blendMode: VideoVisualPresentationV1['blendMode'];
	readonly masks: readonly VideoMaskMatteGraphV1[];
}

export interface UnifiedExactRenderActiveAdjustmentV13 {
	readonly nodeId: string;
	readonly modelId: string;
	readonly targetTrackIds: readonly string[];
	readonly effectIds: readonly string[];
	readonly opacity: number;
	readonly blendMode: VideoVisualPresentationV1['blendMode'];
	readonly masks: readonly VideoMaskMatteGraphV1[];
}

export interface UnifiedExactRenderVisualFrameLayerV13 {
	readonly trackId: string;
	readonly sequenceOrder: number;
	readonly entries: readonly UnifiedExactRenderVisualFrameEntryV13[];
}

export interface UnifiedExactRenderVisualFrameLedgerV13 {
	readonly requestedNodeIds: readonly string[];
	readonly consumedNodeIds: readonly string[];
	readonly omittedNodeIds: readonly string[];
}

export interface UnifiedExactRenderVisualFrameV13 {
	readonly sequencePosition: Rational;
	readonly transitionWeights: readonly UnifiedExactRenderTransitionWeightV13[];
	readonly layers: readonly UnifiedExactRenderVisualFrameLayerV13[];
	readonly activeAdjustmentLayers: readonly UnifiedExactRenderActiveAdjustmentV13[];
	readonly activeFreezeNodeIds: readonly string[];
	readonly availablePresetIds: readonly string[];
	readonly ledger: UnifiedExactRenderVisualFrameLedgerV13;
}

export interface UnifiedExactRenderVisualConsumerV13 {
	readonly plan: UnifiedExactRenderPlanV13;
	resolveFrame(request: UnifiedExactRenderVisualFrameRequestV13): UnifiedExactRenderVisualFrameV13;
}

interface ConsumerIndex {
	readonly plan: UnifiedExactRenderPlanV13;
	readonly finishing: UnifiedExactRenderFinishingNode;
	readonly visuals: readonly UnifiedExactRenderVisualNode[];
	readonly masksById: ReadonlyMap<string, VideoMaskMatteGraphV1>;
	readonly orderByTrackId: ReadonlyMap<string, number>;
	readonly sourceIdByNodeId: ReadonlyMap<string, string>;
}

/** Preview and export deliberately receive the same consumer implementation. */
export function createUnifiedExactRenderVisualPreviewConsumerV13(
	plan: UnifiedExactRenderPlanV13,
): UnifiedExactRenderVisualConsumerV13 {
	return createConsumer(plan);
}

/** Preview and export deliberately receive the same consumer implementation. */
export function createUnifiedExactRenderVisualExportConsumerV13(
	plan: UnifiedExactRenderPlanV13,
): UnifiedExactRenderVisualConsumerV13 {
	return createConsumer(plan);
}

function createConsumer(plan: UnifiedExactRenderPlanV13): UnifiedExactRenderVisualConsumerV13 {
	assertUnifiedExactRenderPlanV13(plan);
	const finishing = plan.nodes.filter(
		(node): node is UnifiedExactRenderFinishingNode => node.kind === 'finishing',
	);
	if (finishing.length !== 1) throw new ReferenceError('V13 visual execution requires one finishing node.');
	const visuals = plan.nodes.filter(
		(node): node is UnifiedExactRenderVisualNode => node.kind === 'visual',
	);
	const masks = visuals.filter((node) => node.modelKind === 'mask-matte')
		.map((node) => [node.modelId, maskState(node)] as const);
	const index = Object.freeze({
		plan,
		finishing: finishing[0]!,
		visuals,
		masksById: new Map(masks),
		orderByTrackId: new Map(plan.tracks.map(({ trackId, sequenceOrder }) => (
			[trackId, sequenceOrder] as const
		))),
		sourceIdByNodeId: new Map(plan.sources.map(({ nodeId, sourceId }) => [nodeId, sourceId] as const)),
	});
	return Object.freeze({
		plan,
		resolveFrame: (request: UnifiedExactRenderVisualFrameRequestV13) => resolveFrame(index, request),
	});
}

function resolveFrame(
	index: ConsumerIndex,
	request: UnifiedExactRenderVisualFrameRequestV13,
): UnifiedExactRenderVisualFrameV13 {
	const position = exactPosition(request?.sequencePosition);
	const requested = new Set<string>();
	const consumed = new Set<string>();
	const transitionWeights = resolveTransitions(index, position, requested, consumed);
	const layers = new Map<string, UnifiedExactRenderVisualFrameEntryV13[]>();
	const activeSourceIds = activeVideoSourceIds(index, position);
	for (const node of index.visuals) {
		if (!isPlacedVisual(node) || !trackRenders(index, node.placement.trackId)
			|| !rangeContains(node.authoredState.clip, position)) continue;
		requested.add(node.nodeId);
		if (node.modelKind === 'external-generator') continue;
		const presentation = presentationState(index, node);
		const entry = Object.freeze({
			nodeId: node.nodeId,
			modelId: node.modelId,
			modelKind: node.modelKind,
			trackId: node.placement.trackId,
			authoredState: node.authoredState,
			opacity: presentation.opacity,
			blendMode: presentation.blendMode,
			masks: presentation.masks,
		});
		const entries = layers.get(entry.trackId) ?? [];
		entries.push(entry);
		layers.set(entry.trackId, entries);
		activeSourceIds.add(entry.authoredState.source.id);
		consumed.add(node.nodeId);
		for (const mask of entry.masks) consumed.add(maskNodeId(index, mask.id, requested));
	}
	const adjustments = resolveAdjustments(index, position, requested, consumed);
	const activeFreezeNodeIds = index.visuals.flatMap((node) => {
		if (node.modelKind !== 'video-freeze' || !('renderedSourceId' in node.authoredState)
			|| !activeSourceIds.has(node.authoredState.renderedSourceId)) return [];
		requested.add(node.nodeId);
		if (node.fallbackDisposition?.mode !== 'frozen' || node.frozenFallback === null) return [];
		consumed.add(node.nodeId);
		return [node.nodeId];
	}).sort(compareText);
	const frameLayers = [...layers].map(([trackId, entries]) => Object.freeze({
		trackId,
		sequenceOrder: requiredTrackOrder(index, trackId),
		entries: Object.freeze(entries.sort((left, right) => compareText(left.modelId, right.modelId))),
	})).sort((left, right) => right.sequenceOrder - left.sequenceOrder
		|| compareText(left.trackId, right.trackId));
	const omitted = [...requested].filter((nodeId) => !consumed.has(nodeId)).sort(compareText);
	if (omitted.length > 0) {
		throw new Error(`V13 visual frame has unconsumed active nodes: ${omitted.join(', ')}.`);
	}
	const requestedNodeIds = [...requested].sort(compareText);
	const consumedNodeIds = [...consumed].filter((nodeId) => requested.has(nodeId)).sort(compareText);
	return Object.freeze({
		sequencePosition: position,
		transitionWeights,
		layers: Object.freeze(frameLayers),
		activeAdjustmentLayers: Object.freeze(adjustments),
		activeFreezeNodeIds: Object.freeze(activeFreezeNodeIds),
		availablePresetIds: Object.freeze(index.visuals.filter(({ modelKind }) => modelKind === 'preset')
			.map(({ modelId }) => modelId).sort(compareText)),
		ledger: Object.freeze({
			requestedNodeIds: Object.freeze(requestedNodeIds),
			consumedNodeIds: Object.freeze(consumedNodeIds),
			omittedNodeIds: Object.freeze(omitted),
		}),
	});
}

function resolveTransitions(
	index: ConsumerIndex,
	position: Rational,
	requested: Set<string>,
	consumed: Set<string>,
): readonly UnifiedExactRenderTransitionWeightV13[] {
	const weights: UnifiedExactRenderTransitionWeightV13[] = [];
	for (const node of index.plan.nodes) {
		if (node.kind !== 'transition' || !trackRenders(index, node.edges.trackId)
			|| !transitionContains(node, position)) continue;
		requested.add(node.nodeId);
		const resolved = resolveVideoTransitionV1(node.transition, node.edges, position);
		if (!resolved.activeFrame) continue;
		weights.push(
			Object.freeze({ clipId: resolved.edges.outgoing.clipId,
				transitionId: resolved.transition.id, weight: resolved.outgoingWeight }),
			Object.freeze({ clipId: resolved.edges.incoming.clipId,
				transitionId: resolved.transition.id, weight: resolved.incomingWeight }),
		);
		consumed.add(node.nodeId);
	}
	return Object.freeze(weights.sort((left, right) => compareText(left.clipId, right.clipId)
		|| compareText(left.transitionId, right.transitionId)));
}

function resolveAdjustments(
	index: ConsumerIndex,
	position: Rational,
	requested: Set<string>,
	consumed: Set<string>,
): UnifiedExactRenderActiveAdjustmentV13[] {
	const result: UnifiedExactRenderActiveAdjustmentV13[] = [];
	for (const node of index.visuals) {
		if (node.modelKind !== 'adjustment-layer' || !('sequenceStartFrame' in node.authoredState)
			|| !rangeContains(node.authoredState, position)) continue;
		const targetTrackIds = node.authoredState.targetTrackIds.filter((trackId) => (
			trackRenders(index, trackId)
		));
		if (targetTrackIds.length === 0) continue;
		requested.add(node.nodeId);
		const presentation = presentationState(index, node);
		result.push(Object.freeze({
			nodeId: node.nodeId,
			modelId: node.modelId,
			targetTrackIds: Object.freeze(targetTrackIds),
			effectIds: node.authoredState.effectIds,
			opacity: presentation.opacity,
			blendMode: presentation.blendMode,
			masks: presentation.masks,
		}));
		consumed.add(node.nodeId);
		for (const mask of presentation.masks) consumed.add(maskNodeId(index, mask.id, requested));
	}
	return result.sort((left, right) => compareText(left.modelId, right.modelId));
}

function activeVideoSourceIds(index: ConsumerIndex, position: Rational): Set<string> {
	const result = new Set<string>();
	for (const node of index.plan.nodes) {
		if (node.kind !== 'clip' || !trackRenders(index, node.trackId)
			|| !rangeContains(node, position)) continue;
		const sourceId = index.sourceIdByNodeId.get(node.sourceNodeId);
		if (!sourceId) throw new ReferenceError(`V13 clip source node ${node.sourceNodeId} is unavailable.`);
		result.add(sourceId);
	}
	return result;
}

function trackRenders(index: ConsumerIndex, trackId: string): boolean {
	const track = index.plan.tracks.find((candidate) => candidate.trackId === trackId);
	if (!track) throw new ReferenceError(`V13 visual track ${trackId} is unavailable.`);
	const soloed = index.plan.tracks.some((candidate) => candidate.solo);
	return soloed ? track.solo : !track.hidden;
}

function presentationState(index: ConsumerIndex, node: UnifiedExactRenderVisualNode): Readonly<{
	opacity: number;
	blendMode: VideoVisualPresentationV1['blendMode'];
	masks: readonly VideoMaskMatteGraphV1[];
}> {
	const state = node.authoredState;
	const sourceId = 'source' in state ? state.source.id : null;
	const presentations = index.finishing.visualPresentations.filter((presentation) => (
		presentation.enabled && (
			(presentation.owner.kind === 'clip' && presentation.owner.id === node.modelId)
			|| ((presentation.owner.kind === 'source' || presentation.owner.kind === 'generator')
				&& presentation.owner.id === sourceId)
			|| (presentation.owner.kind === 'adjustment-layer' && presentation.owner.id === node.modelId)
		)
	));
	let opacity = 1;
	let blendMode: VideoVisualPresentationV1['blendMode'] = 'normal';
	const maskIds = new Set<string>();
	for (const presentation of presentations) {
		opacity *= presentation.opacity;
		blendMode = presentation.blendMode;
		for (const id of presentation.maskMatteIds) maskIds.add(id);
	}
	const masks = [...maskIds].sort(compareText).map((id) => {
		const graph = index.masksById.get(id);
		if (!graph) throw new ReferenceError(`V13 visual presentation mask ${id} is unavailable.`);
		return graph;
	});
	return Object.freeze({ opacity, blendMode, masks: Object.freeze(masks) });
}

function maskNodeId(index: ConsumerIndex, modelId: string, requested: Set<string>): string {
	const node = index.visuals.find((candidate) => candidate.modelKind === 'mask-matte'
		&& candidate.modelId === modelId);
	if (!node) throw new ReferenceError(`V13 mask/matte node ${modelId} is unavailable.`);
	requested.add(node.nodeId);
	return node.nodeId;
}

function maskState(node: UnifiedExactRenderVisualNode): VideoMaskMatteGraphV1 {
	if (node.modelKind !== 'mask-matte' || !('inputs' in node.authoredState)) {
		throw new TypeError('A V13 mask visual node is required.');
	}
	return node.authoredState;
}

function isPlacedVisual(node: UnifiedExactRenderVisualNode): node is UnifiedExactRenderVisualNode & Readonly<{
	placement: NonNullable<UnifiedExactRenderVisualNode['placement']>;
	authoredState: Extract<UnifiedExactRenderVisualNode['authoredState'], Readonly<{ source: unknown }>>;
}> {
	return node.placement !== null && 'source' in node.authoredState;
}

function rangeContains(
	value: Readonly<{ sequenceStartFrame: number; sequenceFrameCount: number }>,
	position: Rational,
): boolean {
	return compareRationals(position, value.sequenceStartFrame) >= 0
		&& compareRationals(position, value.sequenceStartFrame + value.sequenceFrameCount) < 0;
}

function transitionContains(node: UnifiedExactRenderTransitionNode, position: Rational): boolean {
	const start = node.edges.incoming.sequenceStartFrame;
	const end = node.edges.outgoing.sequenceStartFrame + node.edges.outgoing.sequenceFrameCount;
	return compareRationals(position, start) >= 0 && compareRationals(position, end) < 0;
}

function exactPosition(value: RationalInput): Rational {
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('V13 sequence position must be exact and non-negative.');
		return Object.freeze({ num: value, den: 1 });
	}
	if (!value || !Number.isSafeInteger(value.num) || !Number.isSafeInteger(value.den)
		|| value.num < 0 || value.den < 1) throw new RangeError('V13 sequence position must be exact and non-negative.');
	return Object.freeze({ num: value.num, den: value.den });
}

function requiredTrackOrder(index: ConsumerIndex, trackId: string): number {
	const order = index.orderByTrackId.get(trackId);
	if (order === undefined) throw new ReferenceError(`V13 visual track ${trackId} is unavailable.`);
	return order;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
