/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalizeNativeMediaSummaryValue } from './native-media-plan-canonical-form.ts';
import {
	createOfxRetimerSourceTimeV1,
	type OfxRetimerSourceTimeV1,
} from './native-ofx-retimer-source-time.ts';
import {
	assertUnifiedExactRenderPlan,
	assertUnifiedExactRenderPlanWithTimingSidecars,
	type UnifiedExactRenderClipNode,
	type UnifiedExactRenderOpenFxNode,
	type UnifiedExactRenderPlan,
	type UnifiedExactRenderTransitionNode,
} from './unified-exact-render-plan.ts';
import {
	createVideoRetimeExactOrdinalAuthority,
	type VideoRetimeExactOrdinalAuthority,
} from './video-retime-exact-ordinal-authority.ts';
import {
	createVideoRetimeExactExportFrameSource,
	createVideoRetimeExactPreviewConsumer,
	type VideoRetimeExactExportFrameSource,
	type VideoRetimeExactPreviewConsumer,
	type VideoRetimePreviewMediaPort,
} from './video-retime-ordinal-consumers.ts';
import type { VideoRetimeFrameDescriptor } from './video-retime-frame-dispatch.ts';
import {
	boundVideoSourceTimingAuthority,
	type BoundVideoSourceTimingView,
} from './video-source-timing-view.ts';
import type { RationalInput } from './timeline-time.ts';
import {
	resolveVideoTransitionV1,
	type ResolvedVideoTransitionV1,
} from './video-transition-resolution.ts';

export interface UnifiedExactRenderTransitionResolver {
	readonly transitionId: string;
	readonly resolveAtSequencePosition: (position: RationalInput) => ResolvedVideoTransitionV1;
}

export function createUnifiedExactRenderClipOrdinalAuthority(
	plan: UnifiedExactRenderPlan,
	clipId: string,
	timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>,
): VideoRetimeExactOrdinalAuthority {
	assertUnifiedExactRenderPlanWithTimingSidecars(plan, timingBySourceId);
	const clip = clipById(plan, clipId);
	const timing = exactTimingForClip(plan, clip, timingBySourceId);
	return createVideoRetimeExactOrdinalAuthority(clip.sourceTimeMapping.intent, timing);
}

export function createUnifiedExactRenderClipExportFrameSource(
	plan: UnifiedExactRenderPlan,
	clipId: string,
	timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>,
): VideoRetimeExactExportFrameSource {
	return createVideoRetimeExactExportFrameSource(
		createUnifiedExactRenderClipOrdinalAuthority(plan, clipId, timingBySourceId),
	);
}

export function createUnifiedExactRenderClipPreviewConsumer(
	plan: UnifiedExactRenderPlan,
	clipId: string,
	timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>,
	port: VideoRetimePreviewMediaPort,
	options: Readonly<{ readonly onPresented: (descriptor: VideoRetimeFrameDescriptor) => void }>,
): VideoRetimeExactPreviewConsumer {
	return createVideoRetimeExactPreviewConsumer(
		createUnifiedExactRenderClipOrdinalAuthority(plan, clipId, timingBySourceId),
		port,
		options,
	);
}

/** Preview and export deliberately expose the same plan-owned transition evaluator. */
export function createUnifiedExactRenderTransitionPreviewResolver(
	plan: UnifiedExactRenderPlan,
	transitionId: string,
	timingBySourceId?: ReadonlyMap<string, BoundVideoSourceTimingView>,
): UnifiedExactRenderTransitionResolver {
	return createUnifiedExactRenderTransitionResolver(plan, transitionId, timingBySourceId);
}

/** Preview and export deliberately expose the same plan-owned transition evaluator. */
export function createUnifiedExactRenderTransitionExportResolver(
	plan: UnifiedExactRenderPlan,
	transitionId: string,
	timingBySourceId?: ReadonlyMap<string, BoundVideoSourceTimingView>,
): UnifiedExactRenderTransitionResolver {
	return createUnifiedExactRenderTransitionResolver(plan, transitionId, timingBySourceId);
}

export function createUnifiedExactRenderOfxRetimerSourceTime(
	plan: UnifiedExactRenderPlan,
	instanceId: string,
	outputOrdinal: number,
	timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>,
): OfxRetimerSourceTimeV1 {
	assertUnifiedExactRenderPlanWithTimingSidecars(plan, timingBySourceId);
	const effect = plan.nodes.find((node): node is UnifiedExactRenderOpenFxNode => (
		node.kind === 'openfx' && node.state.instanceId === instanceId
	));
	if (!effect || effect.state.context !== 'retimer') {
		throw new ReferenceError('A unified exact OFX Retimer instance is required.');
	}
	const clip = clipById(plan, effect.state.attachment.targetId);
	const source = plan.sources.find((candidate) => candidate.nodeId === clip.sourceNodeId);
	if (!source) throw new ReferenceError('The OFX Retimer clip source is unavailable.');
	const authority = createUnifiedExactRenderClipOrdinalAuthority(
		plan, clip.clipId, timingBySourceId,
	);
	return createOfxRetimerSourceTimeV1(authority, {
		outputOrdinal,
		clipId: clip.clipId,
		sourceId: source.sourceId,
	});
}

function exactTimingForClip(
	plan: UnifiedExactRenderPlan,
	clip: UnifiedExactRenderClipNode,
	value: ReadonlyMap<string, BoundVideoSourceTimingView>,
): ReadonlyMap<string, BoundVideoSourceTimingView> {
	if (!(value instanceof Map)) throw new TypeError('Unified exact timing must be an authenticated Map.');
	const sourceIds = new Set(clip.sourceTimeMapping.intent.intersections.map((row) => row.sourceId));
	const result = new Map<string, BoundVideoSourceTimingView>();
	for (const sourceId of sourceIds) {
		const source = plan.sources.find((candidate) => candidate.sourceId === sourceId);
		const timing = value.get(sourceId);
		if (!source || !timing) throw new ReferenceError('Unified exact source timing is unavailable.');
		if (canonicalizeNativeMediaSummaryValue(boundVideoSourceTimingAuthority(timing))
			!== canonicalizeNativeMediaSummaryValue(source.timing)) {
			throw new RangeError('Authenticated source timing disagrees with the unified plan authority.');
		}
		result.set(sourceId, timing);
	}
	return result;
}

function createUnifiedExactRenderTransitionResolver(
	plan: UnifiedExactRenderPlan,
	transitionId: string,
	timingBySourceId?: ReadonlyMap<string, BoundVideoSourceTimingView>,
): UnifiedExactRenderTransitionResolver {
	if (timingBySourceId === undefined) assertUnifiedExactRenderPlan(plan);
	else assertUnifiedExactRenderPlanWithTimingSidecars(plan, timingBySourceId);
	if (typeof transitionId !== 'string' || transitionId.length < 1 || transitionId.length > 4_096) {
		throw new TypeError('A bounded unified exact transition identity is required.');
	}
	const node = plan.nodes.find((candidate): candidate is UnifiedExactRenderTransitionNode => (
		candidate.kind === 'transition' && candidate.transition.id === transitionId
	));
	if (!node) throw new ReferenceError(`Unified exact transition ${transitionId} is unavailable.`);
	return Object.freeze({
		transitionId,
		resolveAtSequencePosition: (position: RationalInput) => (
			resolveVideoTransitionV1(node.transition, node.edges, position)
		),
	});
}

function clipById(plan: UnifiedExactRenderPlan, clipId: string): UnifiedExactRenderClipNode {
	const clip = plan.nodes.find((node): node is UnifiedExactRenderClipNode => (
		node.kind === 'clip' && node.clipId === clipId
	));
	if (!clip) throw new ReferenceError(`Unified exact clip ${clipId} is unavailable.`);
	return clip;
}
