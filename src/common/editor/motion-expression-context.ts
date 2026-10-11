/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionExpressionSpan } from './motion-expression-ast.ts';
import type { MotionExpressionValue } from './motion-expression-values.ts';
export interface MotionExpressionBudget { readonly remaining: number; consume(operations: number, span: MotionExpressionSpan): void }
export interface MotionExpressionContext {
	/** Containing-composition seconds, layer-local seconds and layer-local frames. */
	readonly time: number; readonly localTime: number; readonly frame: number; readonly frameRate: number;
	readonly value: MotionExpressionValue; readonly index: number; readonly seed: string | number;
	readonly reference?: (id: string, time?: number) => MotionExpressionValue;
	readonly valueAtTime?: (time: number) => MotionExpressionValue;
	readonly loop?: (direction: 'in' | 'out', mode: 'cycle' | 'pingpong' | 'offset' | 'continue', keyCount: number) => MotionExpressionValue;
	/** Reader must bind prepared PCM analysis to retained revision, asset digests and analysis settings. */
	readonly audioAmplitude?: (request: Readonly<{ assetId: string; time: number; windowSeconds: number }>) => number;
}
