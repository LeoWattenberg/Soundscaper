/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic, initially-unselected point choices from reviewed Beat This output. */

import {
	reviewAssistanceBeatGridV1,
	type AssistanceBeatGridV1,
} from './m7-semantic-results.ts';

export interface AssistanceBeatPointProposal {
	readonly id: string;
	readonly kind: 'beat' | 'downbeat';
	readonly label: 'Beat' | 'Downbeat';
	readonly sample: number;
	readonly confidence: number | null;
	readonly selected: false;
}

export function createAssistanceBeatProposals(
	value: AssistanceBeatGridV1,
): readonly AssistanceBeatPointProposal[] {
	const review = reviewAssistanceBeatGridV1(value);
	return Object.freeze(review.points.map((point): AssistanceBeatPointProposal => Object.freeze({
		id: `beat-grid:${point.kind}:${String(point.sample)}`,
		kind: point.kind,
		label: point.kind === 'downbeat' ? 'Downbeat' : 'Beat',
		sample: point.sample,
		confidence: point.confidence,
		selected: false,
	})));
}
