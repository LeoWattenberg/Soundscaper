/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FrameCanonicalEdgeTrimPreview,
	FrameCanonicalEdgeTrimTransform,
	FrameCanonicalTrackLockPredicate,
} from './frame-canonical-edge-trim-domain.ts';
import type { RationalRate } from './timeline-time.ts';
import type { VideoTimingAssetReference, VideoTimingIndex } from './video-timing-asset.ts';

export type FrameCanonicalSlipSlideMode = 'slip' | 'slide';
export type FrameCanonicalSlipSlideRole = 'left' | 'center' | 'right';

export type VideoSourceTimingView = Readonly<{
	readonly kind: 'cfr';
	readonly rate: RationalRate;
	readonly frameCount: number;
}> | Readonly<{
	readonly kind: 'vfr';
	readonly reference: Readonly<VideoTimingAssetReference>;
	readonly index: VideoTimingIndex;
}>;

interface FrameCanonicalSlipSlideRequestBase {
	readonly activeClipId: string;
	readonly isTrackLocked?: FrameCanonicalTrackLockPredicate;
}

export interface FrameCanonicalSlipRequest extends FrameCanonicalSlipSlideRequestBase {
	readonly mode: 'slip';
	readonly requestedSourceInFrame: number;
}

export interface FrameCanonicalSlideRequest extends FrameCanonicalSlipSlideRequestBase {
	readonly mode: 'slide';
	readonly requestedStartSample: number;
}

export type FrameCanonicalSlipSlideRequest = FrameCanonicalSlipRequest | FrameCanonicalSlideRequest;
export type FrameCanonicalSlipSlideTransform = FrameCanonicalEdgeTrimTransform;

export interface FrameCanonicalSlipSlidePreview extends FrameCanonicalEdgeTrimPreview {
	readonly changeKind: 'source-slip' | 'neighbor-trim' | 'placement';
}

export interface FrameCanonicalSlipSlideSourceRange {
	readonly clipId: string;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
}

interface FrameCanonicalSlipSlideDiagnostics extends Readonly<Record<string, unknown>> {
	readonly mode: FrameCanonicalSlipSlideMode;
	readonly activeClipId: string;
	readonly authorityClipId: string;
	readonly authoritySourceId: string;
	readonly authoritySequenceId: string;
	readonly clamped: boolean;
	readonly participantClipIds: readonly string[];
	readonly leftClipIds: readonly string[];
	readonly centerClipIds: readonly string[];
	readonly rightClipIds: readonly string[];
	readonly sourceRanges: readonly FrameCanonicalSlipSlideSourceRange[];
}

export interface FrameCanonicalSlipDiagnostics extends FrameCanonicalSlipSlideDiagnostics {
	readonly mode: 'slip';
	readonly requestedSourceInFrame: number;
	readonly appliedSourceInFrame: number;
	readonly sourceFrameDelta: number;
}

export interface FrameCanonicalSlideDiagnostics extends FrameCanonicalSlipSlideDiagnostics {
	readonly mode: 'slide';
	readonly requestedStartSample: number;
	readonly requestedSequenceStartFrame: number;
	readonly appliedSequenceStartFrame: number;
	readonly appliedStartSample: number;
	readonly appliedEndSample: number;
	readonly sequenceFrameDelta: number;
}

export interface FrameCanonicalSlipSlideNoop extends FrameCanonicalSlipSlideDiagnostics {
	readonly kind: 'noop';
	readonly transforms: readonly [];
	readonly previews: readonly [];
}

export interface FrameCanonicalSlipSlideTransformPlan extends FrameCanonicalSlipSlideDiagnostics {
	readonly kind: 'transform';
	readonly transforms: readonly FrameCanonicalSlipSlideTransform[];
	readonly previews: readonly FrameCanonicalSlipSlidePreview[];
}

export type FrameCanonicalSlipPlan = (FrameCanonicalSlipDiagnostics & FrameCanonicalSlipSlideNoop)
	| (FrameCanonicalSlipDiagnostics & FrameCanonicalSlipSlideTransformPlan);

export type FrameCanonicalSlidePlan = (FrameCanonicalSlideDiagnostics & FrameCanonicalSlipSlideNoop)
	| (FrameCanonicalSlideDiagnostics & FrameCanonicalSlipSlideTransformPlan);

export type FrameCanonicalSlipSlidePlan = FrameCanonicalSlipPlan | FrameCanonicalSlidePlan;
