/* SPDX-License-Identifier: AGPL-3.0-only */
import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import type { FramescaperSelectedExactSupplementalPictureFinishing } from './selected-finishing-exact-frame-execution.ts';

/** Authenticated pictures enter exact finishing before adjustments and track composition. */
export interface FramescaperSupplementalPictureExecution {
	resolve(request: Readonly<{
		sequencePosition: Readonly<{ num: number; den: number }>;
		width: number; height: number; signal: AbortSignal;
	}>): PromiseLike<readonly FramescaperSelectedExactSupplementalPictureFinishing[]> | readonly FramescaperSelectedExactSupplementalPictureFinishing[];
	dispose(): PromiseLike<void> | void;
}

export type CreateFramescaperSupplementalPictureExecution = (request: Readonly<{
	plan: UnifiedExactRenderPlanV13; signal: AbortSignal; assertCurrent: () => void;
}>) => PromiseLike<FramescaperSupplementalPictureExecution | null> | FramescaperSupplementalPictureExecution | null;
