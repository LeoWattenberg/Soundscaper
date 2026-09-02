/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MixerGraphV21 } from '../../mixer-graph-v21.ts';
import type { ParameterAddress } from '../../parameter-address.ts';

export interface SoundscaperRoutingGraphGestureIntercept {
	readonly kind: string;
	readonly graph: MixerGraphV21;
	readonly selection: unknown;
	readonly addresses: readonly ParameterAddress[];
	readonly command: Readonly<{
		readonly type: 'mixer-graph/set';
		readonly expected: unknown;
		readonly mixer: MixerGraphV21;
	}>;
	readonly commit: () => unknown;
}

export type SoundscaperRoutingGraphGestureHandler = (
	gesture: SoundscaperRoutingGraphGestureIntercept,
) => unknown;

export type SoundscaperRoutingParameterGesturePhase =
	| 'begin' | 'preview' | 'release' | 'cancel';

/**
 * Native-value lifecycle emitted by a graph parameter control. The consumer
 * owns automation capture; graph edits remain explicit mixer-graph commands.
 */
export interface SoundscaperRoutingParameterGesture {
	readonly phase: SoundscaperRoutingParameterGesturePhase;
	readonly address: Extract<ParameterAddress, { kind: 'edge' }>;
	readonly value: number;
}

export type SoundscaperRoutingParameterGestureHandler = (
	gesture: SoundscaperRoutingParameterGesture,
) => boolean | Promise<boolean>;

export function routingStaticEdgeLevel(
	currentLevel: number,
	draftLevel: number,
	capturedByAutomation: boolean,
): number {
	return capturedByAutomation ? currentLevel : draftLevel;
}
