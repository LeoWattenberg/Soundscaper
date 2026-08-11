/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FrameCanonicalEdgeTrimPreview,
	FrameCanonicalEdgeTrimTransform,
	FrameCanonicalTrackLockPredicate,
	FrameCanonicalTrimEdge,
} from './frame-canonical-edge-trim-domain.ts';
import type { Rational, RationalRate } from './timeline-time.ts';

export interface FrameCanonicalRateStretchRequest {
	readonly activeClipId: string;
	readonly edge: FrameCanonicalTrimEdge;
	readonly requestedBoundarySample: number;
	readonly isTrackLocked?: FrameCanonicalTrackLockPredicate;
}

export type FrameCanonicalRateStretchTransform = FrameCanonicalEdgeTrimTransform;

export interface FrameCanonicalRateStretchPreview
	extends FrameCanonicalEdgeTrimPreview, Readonly<Record<string, unknown>> {
	readonly changeKind: 'rate-stretch';
}

interface FrameCanonicalRateStretchDiagnostics extends Readonly<Record<string, unknown>> {
	readonly activeClipId: string;
	readonly edge: FrameCanonicalTrimEdge;
	readonly authorityClipId: string;
	readonly authoritySourceId: string;
	readonly authoritySequenceId: string;
	readonly sequenceRate: RationalRate;
	readonly requestedBoundarySample: number;
	readonly requestedSequenceFrame: number;
	readonly appliedSequenceFrame: number;
	readonly boundarySample: number;
	readonly sequenceFrameDelta: number;
	readonly durationScale: Rational;
	readonly authorityPlaybackRate: number;
	readonly clamped: boolean;
	readonly participantClipIds: readonly string[];
}

export interface FrameCanonicalRateStretchNoop extends FrameCanonicalRateStretchDiagnostics {
	readonly kind: 'noop';
	readonly transforms: readonly [];
	readonly previews: readonly [];
}

export interface FrameCanonicalRateStretchTransformPlan extends FrameCanonicalRateStretchDiagnostics {
	readonly kind: 'transform';
	readonly transforms: readonly FrameCanonicalRateStretchTransform[];
	readonly previews: readonly FrameCanonicalRateStretchPreview[];
}

export type FrameCanonicalRateStretchPlan =
	| FrameCanonicalRateStretchNoop
	| FrameCanonicalRateStretchTransformPlan;
