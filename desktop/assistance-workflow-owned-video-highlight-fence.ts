/* SPDX-License-Identifier: AGPL-3.0-only */

/** Aggregate-fence correlation for reviewed owned video/highlight results. */

import type { AssistanceOwnedVideoHighlightTransformResultV1 } from
	'../src/common/editor/assistance/owned-video-highlight-transform-types-v1.ts';
import type {
	AssistanceWorkflowSourceRangeV1,
	AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';

export function assertAssistanceOwnedVideoHighlightResultFenceV1(
	result: AssistanceOwnedVideoHighlightTransformResultV1,
	request: AssistanceWorkflowV1,
): void {
	switch (result.transformId) {
		case 'sample-shot-frames': {
			const output = result.outputs['frame-pack'];
			assertFrames(videoSource(request, output.sourceId), output.frames);
			return;
		}
		case 'publish-video-index': {
			const output = result.outputs['video-index'];
			assertFrames(videoSource(request, output.sourceId), output.sampleAuthority);
			return;
		}
		case 'track-subjects':
			assertFrames(soleVideoSource(request), result.outputs['tracked-subjects'].frames);
			return;
		case 'plan-crops':
			assertFrames(soleVideoSource(request), result.outputs['reframe-path'].authority.frames);
			return;
		case 'gather-signals': {
			const output = result.outputs['highlight-signals'];
			assertHighlightCandidates(request, output.sourceId, output.candidates);
			return;
		}
		case 'rank-highlights': {
			const output = result.outputs['highlight-candidates'];
			assertHighlightCandidates(request, output.sourceId, output.candidates);
			return;
		}
		case 'assemble-highlights':
			for (const proposal of result.outputs['highlight-proposals'].proposals) {
				assertHighlightRange(request, proposal);
			}
	}
}

function assertHighlightCandidates(
	request: AssistanceWorkflowV1,
	sourceId: string,
	candidates: readonly Readonly<{
		readonly sourceStartFrame: number;
		readonly sourceEndFrame: number;
		readonly videoOccurrenceId: string;
		readonly audioOccurrenceId: string | null;
	}>[],
): void {
	const source = videoSource(request, sourceId);
	for (const candidate of candidates) {
		assertHighlightRange(request, candidate);
		if (!source.occurrenceIds.includes(candidate.videoOccurrenceId)) {
			throw new RangeError('A highlight candidate names video outside its exact fenced source.');
		}
	}
}

function assertHighlightRange(
	request: AssistanceWorkflowV1,
	candidate: Readonly<{
		readonly sourceStartFrame: number;
		readonly sourceEndFrame: number;
		readonly videoOccurrenceId: string;
		readonly audioOccurrenceId: string | null;
	}>,
): void {
	const video = occurrenceSource(request, 'video', candidate.videoOccurrenceId);
	const audio = candidate.audioOccurrenceId === null ? null
		: occurrenceSource(request, 'audio', candidate.audioOccurrenceId);
	if (candidate.sourceStartFrame < video.sourceStartFrame
		|| candidate.sourceEndFrame > video.sourceEndFrame
		|| candidate.sourceEndFrame <= candidate.sourceStartFrame
		|| audio !== null && audio.sourceEndFrame <= audio.sourceStartFrame) {
		throw new RangeError('A highlight candidate exceeds its exact aggregate source fence.');
	}
}

function assertFrames(
	source: AssistanceWorkflowSourceRangeV1,
	frames: readonly Readonly<{ readonly sourceFrame: number }>[],
): void {
	if (frames.some(({ sourceFrame }) => sourceFrame < source.sourceStartFrame
		|| sourceFrame >= source.sourceEndFrame)) {
		throw new RangeError('Owned video frames exceed their exact aggregate source fence.');
	}
}

function videoSource(request: AssistanceWorkflowV1, sourceId: string): AssistanceWorkflowSourceRangeV1 {
	const matches = request.fence.sourceRanges.filter((source) =>
		source.mediaKind === 'video' && source.sourceId === sourceId);
	if (matches.length !== 1) {
		throw new TypeError('Owned video output has no unambiguous exact fenced source authority.');
	}
	return matches[0]!;
}

function soleVideoSource(request: AssistanceWorkflowV1): AssistanceWorkflowSourceRangeV1 {
	const matches = request.fence.sourceRanges.filter(({ mediaKind }) => mediaKind === 'video');
	if (matches.length !== 1) {
		throw new TypeError('Owned video geometry has ambiguous aggregate source authority.');
	}
	return matches[0]!;
}

function occurrenceSource(
	request: AssistanceWorkflowV1,
	mediaKind: 'audio' | 'video',
	occurrenceId: string,
): AssistanceWorkflowSourceRangeV1 {
	const matches = request.fence.sourceRanges.filter((source) => source.mediaKind === mediaKind
		&& source.occurrenceIds.includes(occurrenceId));
	if (matches.length !== 1) {
		throw new TypeError(`A highlight ${mediaKind} occurrence has no exact fenced authority.`);
	}
	return matches[0]!;
}
