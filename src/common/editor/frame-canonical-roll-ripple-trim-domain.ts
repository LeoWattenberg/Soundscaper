/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FrameCanonicalEdgeTrimPreview,
	FrameCanonicalEdgeTrimTransform,
	FrameCanonicalTrackLockPredicate,
	FrameCanonicalTrimEdge,
} from './frame-canonical-edge-trim-domain.ts';
import type { RationalRate } from './timeline-time.ts';

export type FrameCanonicalRollRippleTrimMode = 'roll' | 'ripple';

export interface FrameCanonicalRollRippleTrimRequest {
	readonly mode: FrameCanonicalRollRippleTrimMode;
	readonly activeClipId: string;
	readonly edge: FrameCanonicalTrimEdge;
	readonly requestedBoundarySample: number;
	readonly isTrackLocked?: FrameCanonicalTrackLockPredicate;
}

export type FrameCanonicalRollRippleTrimTransform = FrameCanonicalEdgeTrimTransform;

export interface FrameCanonicalRollRippleTrimPreview extends FrameCanonicalEdgeTrimPreview {
	readonly changeKind: 'source-trim' | 'placement-only';
}

interface FrameCanonicalRollRippleTrimDiagnostics extends Readonly<Record<string, unknown>> {
	readonly mode: FrameCanonicalRollRippleTrimMode;
	readonly activeClipId: string;
	readonly edge: FrameCanonicalTrimEdge;
	readonly sequenceId: string;
	readonly sequenceRate: RationalRate;
	readonly requestedBoundarySample: number;
	readonly requestedSequenceFrame: number;
	readonly appliedSequenceFrame: number;
	readonly sequenceFrameDelta: number;
	readonly programFrameDelta: number;
	readonly resolvedProgramSampleDelta: number;
	readonly resolvedSourceCutSample: number;
	readonly programEditSample: number;
	readonly clamped: boolean;
	readonly edgeClipIds: readonly string[];
	readonly neighborClipIds: readonly string[];
	readonly shiftedClipIds: readonly string[];
}

export interface FrameCanonicalRollRippleTrimNoop
	extends FrameCanonicalRollRippleTrimDiagnostics {
	readonly kind: 'noop';
	readonly transforms: readonly [];
	readonly previews: readonly [];
}

export interface FrameCanonicalRollRippleTrimTransformPlan
	extends FrameCanonicalRollRippleTrimDiagnostics {
	readonly kind: 'transform';
	readonly transforms: readonly FrameCanonicalRollRippleTrimTransform[];
	readonly previews: readonly FrameCanonicalRollRippleTrimPreview[];
}

export type FrameCanonicalRollRippleTrimPlan =
	| FrameCanonicalRollRippleTrimNoop
	| FrameCanonicalRollRippleTrimTransformPlan;
