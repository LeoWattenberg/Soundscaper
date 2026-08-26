/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic canonical cut proposals from one reviewed Fast or Accurate result. */

import type { AssistanceCutProposalsV1 } from './owned-audio-cut-transform-types-v1.ts';
import { ownedExactRecord } from './owned-transform-validation-v1.ts';
import { reviewAssistanceShotBoundariesV1 } from './shot-boundaries-v1.ts';
import type { AssistanceWorkflowSettingsV1 } from './workflow-settings-v1.ts';

type MarkCutsSettings = Extract<AssistanceWorkflowSettingsV1, {
	readonly workflowId: 'mark-cuts';
}>;

export function normalizeOwnedCutsV1(
	inputsValue: unknown,
	settings: MarkCutsSettings,
): AssistanceCutProposalsV1 {
	const inputs = ownedExactRecord(inputsValue, ['shot-boundaries'], 'normalize-cuts inputs');
	const review = reviewAssistanceShotBoundariesV1(inputs['shot-boundaries']);
	const expectedDetector = settings.mode === 'fast' ? 'ffmpeg-scdet' : 'transnetv2';
	if (review.detector !== expectedDetector) {
		throw new RangeError('The shot detector cannot substitute for the authenticated Mark Cuts mode.');
	}
	const proposals = review.boundaries.flatMap((boundary) => boundary.sourceFrame === 0
		? []
		: [Object.freeze({
			id: `cut:${String(boundary.sourceFrame)}:${boundary.presentationTick}`,
			sourceFrame: boundary.sourceFrame,
			presentationTick: boundary.presentationTick,
			score: boundary.score,
			selected: false as const,
		})]);
	return Object.freeze({
		schemaVersion: 1,
		kind: 'cut-proposals',
		mode: settings.mode,
		detector: review.detector,
		timescale: review.timescale,
		sourceFrameCount: review.sourceFrameCount,
		proposals: Object.freeze(proposals),
	});
}
