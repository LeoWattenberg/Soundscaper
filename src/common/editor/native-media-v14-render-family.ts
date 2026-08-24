/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed renderer/helper agreement for the carrier-free V14 CPU subset. */

import { videoSourceCharacteristicsV25AreReported } from './video-source-professional-characteristics-v25.ts';
import type {
	UnifiedExactRenderClipNode,
	UnifiedExactRenderFinishingNode,
	UnifiedExactRenderPlan,
	UnifiedExactRenderProfessionalMediaNode,
} from './unified-exact-render-plan.ts';

export type NativeMediaV14RenderFamily =
	| 'single-full-frame-clip-v1'
	| 'evaluated-rgba-carrier-v1';

/**
 * This deliberately recognizes less than the native parser can admit. A false
 * negative uses the exact Web carrier; a false positive could omit semantics.
 */
export function nativeMediaV14RenderFamily(
	plan: UnifiedExactRenderPlan,
): NativeMediaV14RenderFamily {
	return isSingleFullFrameClip(plan)
		? 'single-full-frame-clip-v1'
		: 'evaluated-rgba-carrier-v1';
}

export function nativeMediaV14RequiresEvaluatedCarrier(
	plan: UnifiedExactRenderPlan,
): boolean {
	return nativeMediaV14RenderFamily(plan) === 'evaluated-rgba-carrier-v1';
}

function isSingleFullFrameClip(plan: UnifiedExactRenderPlan): boolean {
	if (plan.version !== 14 || plan.output.includeAudio || plan.timebase.sampleStart !== 0
		|| plan.sources.length !== 1 || plan.tracks.length !== 1
		|| !sameRate(plan.timebase.sequenceRate, plan.output.frameRate)) return false;
	const clips = plan.nodes.filter((node): node is UnifiedExactRenderClipNode => node.kind === 'clip');
	const professional = plan.nodes.filter(
		(node): node is UnifiedExactRenderProfessionalMediaNode => node.kind === 'professional-media',
	);
	const finishing = plan.nodes.filter(
		(node): node is UnifiedExactRenderFinishingNode => node.kind === 'finishing',
	);
	if (clips.length !== 1 || professional.length !== 1 || finishing.length !== 1
		|| plan.nodes.length !== 3) return false;
	return simpleTrack(plan, clips[0]!) && simpleSource(plan, clips[0]!)
		&& identityPicture(clips[0]!) && identityProfessional(plan, professional[0]!)
		&& identityFinishing(plan, finishing[0]!);
}

function simpleTrack(plan: UnifiedExactRenderPlan, clip: UnifiedExactRenderClipNode): boolean {
	const track = plan.tracks[0]!;
	return clip.trackId === track.trackId && !track.mute && !track.hidden
		&& clip.sequenceStartFrame === 0
		&& clip.sequenceFrameCount === plan.output.frameCount
		&& clip.sourceFrameCount === plan.output.frameCount;
}

function simpleSource(plan: UnifiedExactRenderPlan, clip: UnifiedExactRenderClipNode): boolean {
	const source = plan.sources[0]!;
	const mapping = clip.sourceTimeMapping;
	return source.nodeId === clip.sourceNodeId && source.timing.kind === 'cfr'
		&& sameRate(source.timing.rate, plan.output.frameRate)
		&& sameRate(mapping.sourceRate, source.timing.rate) && mapping.retimeMap === null
		&& mapping.intent.intersections.every((row) => row.mapping === 'uniform-wall-clock');
}

function identityPicture(clip: UnifiedExactRenderClipNode): boolean {
	const { composition, videoEffects, videoKeyframes } = clip.pictureState;
	const { crop, transform } = composition;
	return crop.left === 0 && crop.top === 0 && crop.right === 0 && crop.bottom === 0
		&& transform.anchorX === 0.5 && transform.anchorY === 0.5
		&& transform.positionX === 0.5 && transform.positionY === 0.5
		&& transform.scaleX === 1 && transform.scaleY === 1
		&& transform.rotationDegrees === 0 && !transform.flipHorizontal && !transform.flipVertical
		&& composition.opacity === 1 && composition.blendMode === 'normal'
		&& composition.compositingOrder === 0 && videoEffects.length === 0
		&& videoKeyframes.curves.length === 0;
}

function identityProfessional(
	plan: UnifiedExactRenderPlan,
	node: UnifiedExactRenderProfessionalMediaNode,
): boolean {
	return node.sourceNodeId === plan.sources[0]!.nodeId && node.imageSequence === null
		&& node.exportAuthority === 'original'
		&& !videoSourceCharacteristicsV25AreReported(node.characteristics);
}

function identityFinishing(
	plan: UnifiedExactRenderPlan,
	node: UnifiedExactRenderFinishingNode,
): boolean {
	return node.sequenceId === plan.timebase.sequenceId
		&& node.sourceInterpretations.length === 1
		&& node.sourceInterpretations[0]?.sourceId === plan.sources[0]!.sourceId
		&& node.sourceInterpretations[0]?.provenance === 'legacy-unmanaged-encoded'
		&& node.visualPresentations.length === 0 && node.processorStacks.length === 0
		&& node.motionAnalyses.length === 0 && node.captionTracks.length === 0
		&& node.audioContext.masterEffectIds.length === 0
		&& node.audioContext.automationLanes.length === 0;
}

function sameRate(
	left: Readonly<{ readonly num: number; readonly den: number }>,
	right: Readonly<{ readonly num: number; readonly den: number }>,
): boolean {
	return BigInt(left.num) * BigInt(right.den) === BigInt(right.num) * BigInt(left.den);
}
