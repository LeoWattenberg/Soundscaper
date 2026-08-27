/* SPDX-License-Identifier: AGPL-3.0-only */

/** Canonical semantic payloads admitted for reusable disposable assistance custody. */

import { reviewAssistanceShotBoundariesV1 } from './shot-boundaries-v1.ts';
import {
	reviewAssistanceOwnedVideoHighlightTransformResultV1,
} from './owned-video-highlight-transform-results-v1.ts';
import type {
	AssistanceOwnedHighlightProposalsV1,
	AssistanceOwnedReframePathV1,
} from './owned-video-highlight-transform-types-v1.ts';
import {
	reviewAssistanceSaliencyResultV1,
} from './visual-semantic-results-v1.ts';
import {
	validateAssistanceWorkflow,
	type AssistanceWorkflowV1,
} from './workflow.ts';

export const ASSISTANCE_SHOT_TABLE_DERIVATIVE_MEDIA_TYPE =
	'application/vnd.soundscaper.shot-table+json';
export const ASSISTANCE_SALIENCY_DERIVATIVE_MEDIA_TYPE =
	'application/vnd.soundscaper.saliency-map+json';
export const ASSISTANCE_TRACKER_DERIVATIVE_MEDIA_TYPE =
	'application/vnd.soundscaper.tracker-state+json';
export const ASSISTANCE_RANKING_DERIVATIVE_MEDIA_TYPE =
	'application/vnd.soundscaper.ranking-checkpoint+json';

const UTF8 = new TextEncoder();

export function createAssistanceShotTableDerivativeV1(
	workflowValue: unknown,
	shotBoundariesValue: unknown,
): Uint8Array {
	const workflow = validateAssistanceWorkflow(workflowValue);
	const source = soleVideoSource(workflow);
	const reviewed = reviewAssistanceShotBoundariesV1(shotBoundariesValue);
	if (reviewed.boundaries.some(({ sourceFrame }) => sourceFrame < source.sourceStartFrame
		|| sourceFrame >= source.sourceEndFrame)) {
		throw new RangeError('A reusable shot table exceeds its exact aggregate source range.');
	}
	const expected = workflow.workflowId === 'mark-cuts'
		&& workflow.settings.workflowId === 'mark-cuts' ? workflow.settings.mode
		: workflow.workflowId === 'index-video' && workflow.settings.workflowId === 'index-video'
			? workflow.settings.shotMode : 'fast';
	const detector = expected === 'accurate' ? 'transnetv2' : 'ffmpeg-scdet';
	if (reviewed.detector !== detector) {
		throw new RangeError('A reusable shot table substituted for its authenticated detector mode.');
	}
	return encode({ schemaVersion: 1, kind: 'shot-table', sourceId: source.sourceId,
		result: reviewed });
}

export function createAssistanceReframeStateDerivativesV1(
	workflowValue: unknown,
	terminalValue: AssistanceOwnedReframePathV1,
	trackedValue: unknown,
	saliencyValue: unknown,
): Readonly<{ readonly tracker: Uint8Array; readonly saliency: Uint8Array }> {
	const workflow = validateAssistanceWorkflow(workflowValue);
	if (workflow.workflowId !== 'reframe') {
		throw new RangeError('Only Guided Reframe produces reusable tracker and saliency state.');
	}
	const terminal = reviewAssistanceOwnedVideoHighlightTransformResultV1({
		schemaVersion: 1, transformId: 'plan-crops', outputs: { 'reframe-path': terminalValue },
	});
	if (terminal.transformId !== 'plan-crops') throw new TypeError('Reframe terminal identity changed.');
	const tracked = reviewAssistanceOwnedVideoHighlightTransformResultV1({
		schemaVersion: 1, transformId: 'track-subjects',
		outputs: { 'tracked-subjects': trackedValue },
	});
	if (tracked.transformId !== 'track-subjects') throw new TypeError('Tracker identity changed.');
	const authority = terminal.outputs['reframe-path'].authority;
	const state = tracked.outputs['tracked-subjects'];
	assertSameFrameAuthority(authority, state);
	const saliency = reviewAssistanceSaliencyResultV1(saliencyValue, authority);
	const source = soleVideoSource(workflow);
	assertFramesInRange(state.frames, source.sourceStartFrame, source.sourceEndFrame,
		'reusable Reframe state');
	return Object.freeze({
		tracker: encode({ schemaVersion: 1, kind: 'tracker-state', sourceId: source.sourceId,
			result: state }),
		saliency: encode({ schemaVersion: 1, kind: 'saliency-map', sourceId: source.sourceId,
			result: saliency }),
	});
}

export function createAssistanceRankingCheckpointDerivativeV1(
	workflowValue: unknown,
	candidatesValue: unknown,
	terminalValue: AssistanceOwnedHighlightProposalsV1,
): Uint8Array {
	const workflow = validateAssistanceWorkflow(workflowValue);
	if (workflow.workflowId !== 'make-highlights') {
		throw new RangeError('Only Make Highlights produces a reusable ranking checkpoint.');
	}
	const ranked = reviewAssistanceOwnedVideoHighlightTransformResultV1({
		schemaVersion: 1, transformId: 'rank-highlights',
		outputs: { 'highlight-candidates': candidatesValue },
	});
	const terminal = reviewAssistanceOwnedVideoHighlightTransformResultV1({
		schemaVersion: 1, transformId: 'assemble-highlights',
		outputs: { 'highlight-proposals': terminalValue },
	});
	if (ranked.transformId !== 'rank-highlights' || terminal.transformId !== 'assemble-highlights') {
		throw new TypeError('Highlight derivative identity changed.');
	}
	const candidates = ranked.outputs['highlight-candidates'];
	const proposalIds = terminal.outputs['highlight-proposals'].proposals.map(({ id }) => id).sort();
	const candidateIds = candidates.candidates.map(({ id }) => id).sort();
	if (JSON.stringify(proposalIds) !== JSON.stringify(candidateIds)) {
		throw new Error('The ranking checkpoint is outside the reviewed highlight terminal lineage.');
	}
	const source = soleVideoSource(workflow);
	if (candidates.sourceId !== source.sourceId) {
		throw new Error('The ranking checkpoint changed its exact fenced source.');
	}
	for (const candidate of candidates.candidates) {
		if (candidate.sourceStartFrame < source.sourceStartFrame
			|| candidate.sourceEndFrame > source.sourceEndFrame
			|| !source.occurrenceIds.includes(candidate.videoOccurrenceId)) {
			throw new RangeError('A ranking checkpoint candidate exceeds its aggregate source fence.');
		}
	}
	return encode({ schemaVersion: 1, kind: 'ranking-checkpoint', sourceId: source.sourceId,
		result: candidates });
}

function assertSameFrameAuthority(
	expected: Readonly<{ width: number; height: number; timescale: number;
		frames: readonly Readonly<{ sourceFrame: number; presentationTick: string }>[] }>,
	actual: Readonly<{ width: number; height: number; timescale: number;
		frames: readonly Readonly<{ sourceFrame: number; presentationTick: string }>[] }>,
): void {
	if (expected.width !== actual.width || expected.height !== actual.height
		|| expected.timescale !== actual.timescale
		|| expected.frames.length !== actual.frames.length
		|| expected.frames.some((frame, index) => frame.sourceFrame !== actual.frames[index]?.sourceFrame
			|| frame.presentationTick !== actual.frames[index]?.presentationTick)) {
		throw new Error('Reusable Reframe state disagrees with its reviewed terminal frame authority.');
	}
}

function assertFramesInRange(
	frames: readonly Readonly<{ sourceFrame: number }>[],
	start: number,
	end: number,
	label: string,
): void {
	if (frames.some(({ sourceFrame }) => sourceFrame < start || sourceFrame >= end)) {
		throw new RangeError(`The ${label} exceeds its aggregate source fence.`);
	}
}

function soleVideoSource(workflow: AssistanceWorkflowV1) {
	const sources = workflow.fence.sourceRanges.filter(({ mediaKind }) => mediaKind === 'video');
	if (sources.length !== 1) {
		throw new TypeError('A reusable Framescaper derivative requires one exact video source.');
	}
	return sources[0]!;
}

function encode(value: unknown): Uint8Array { return UTF8.encode(JSON.stringify(value)); }
