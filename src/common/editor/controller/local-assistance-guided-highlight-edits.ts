/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict, transient title/trim/crop edits over authenticated highlight proposals. */

import {
	reviewAssistanceOwnedVideoHighlightTransformResultV1,
} from '../assistance/owned-video-highlight-transform-results-v1.ts';
import type {
	AssistanceOwnedHighlightCropKeyframeV1,
	AssistanceOwnedHighlightProposalsV1,
} from '../assistance/owned-video-highlight-transform-types-v1.ts';
import {
	findLocalAssistanceSelectedVideoSourceTimeByTimelineFrameV1,
	reviewLocalAssistanceSelectedVideoSourceTimeDescriptorV1,
	type LocalAssistanceSelectedVideoSourceTimeDescriptorV1,
} from './local-assistance-selected-video-source-time.ts';

type Crop = AssistanceOwnedHighlightCropKeyframeV1['crop'];

export function createLocalAssistanceGuidedHighlightDraftV1(
	value: unknown,
): AssistanceOwnedHighlightProposalsV1 {
	const reviewed = proposals(value);
	return proposals({ ...reviewed, targetAspect: { ...reviewed.targetAspect },
		proposals: reviewed.proposals.map(cloneProposal) });
}

export function setLocalAssistanceGuidedHighlightTitleV1(
	draftValue: unknown,
	proposalId: string,
	title: string,
): AssistanceOwnedHighlightProposalsV1 {
	const draft = proposals(draftValue);
	return proposals({ ...draft, proposals: replace(draft, proposalId,
		(proposal) => ({ ...proposal, title })) });
}

export function setLocalAssistanceGuidedHighlightTrimV1(
	originalValue: unknown,
	draftValue: unknown,
	proposalId: string,
	startFrame: number,
	endFrame: number,
	sourceTimeAuthorityValue: unknown,
): AssistanceOwnedHighlightProposalsV1 {
	const original = proposals(originalValue);
	const sourceTimeAuthority = reviewLocalAssistanceSelectedVideoSourceTimeDescriptorV1(
		sourceTimeAuthorityValue,
	);
	const draft = validateLocalAssistanceGuidedHighlightDraftV1(
		original, draftValue, sourceTimeAuthority,
	);
	const base = exactProposal(original, proposalId);
	return proposals({ ...draft, proposals: replace(draft, proposalId, (current) => {
		if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame)
			|| startFrame < current.startFrame || endFrame > current.endFrame
			|| endFrame <= startFrame) {
			throw new RangeError('A Guided highlight trim must remain inside its current range.');
		}
		const sourceStartFrame = mapSourceBoundary(base, startFrame, sourceTimeAuthority);
		const sourceEndFrame = mapSourceBoundary(base, endFrame, sourceTimeAuthority);
		if (sourceEndFrame <= sourceStartFrame) {
			throw new RangeError('A Guided highlight trim collapsed its exact source mapping.');
		}
		if (sourceEndFrame - sourceStartFrame < 2) {
			throw new RangeError('A Guided highlight trim requires at least two source frames.');
		}
		const first = cropAt(current.cropKeyframes, sourceStartFrame);
		const last = cropAt(current.cropKeyframes, sourceEndFrame - 1);
		const middle = current.cropKeyframes.filter(({ sourceFrame }) => (
			sourceFrame > sourceStartFrame && sourceFrame < sourceEndFrame - 1
		));
		return { ...current, startFrame, endFrame, sourceStartFrame, sourceEndFrame,
			cropKeyframes: [first, ...middle, last] };
	}) });
}

export function setLocalAssistanceGuidedHighlightCropV1(
	draftValue: unknown,
	proposalId: string,
	sourceFrame: number,
	crop: Crop,
	sourceTimeAuthorityValue: unknown,
): AssistanceOwnedHighlightProposalsV1 {
	const draft = proposals(draftValue);
	const sourceTimeAuthority = reviewLocalAssistanceSelectedVideoSourceTimeDescriptorV1(
		sourceTimeAuthorityValue,
	);
	assertTargetAspect(draft, sourceTimeAuthority, crop);
	return proposals({ ...draft, proposals: replace(draft, proposalId, (proposal) => {
		if (!Number.isSafeInteger(sourceFrame)) {
			throw new RangeError('A Guided highlight crop frame is invalid.');
		}
		let found = false;
		const cropKeyframes = proposal.cropKeyframes.map((keyframe) => {
			if (keyframe.sourceFrame !== sourceFrame) return keyframe;
			found = true;
			return { ...keyframe, authority: 'center' as const, trackIds: [], crop: { ...crop } };
		});
		if (!found) throw new RangeError('A Guided highlight crop must edit an admitted keyframe.');
		return { ...proposal, cropKeyframes };
	}) });
}

function assertTargetAspect(
	value: AssistanceOwnedHighlightProposalsV1,
	authority: LocalAssistanceSelectedVideoSourceTimeDescriptorV1,
	crop: Crop,
): void {
	const width = (1 - crop.left - crop.right) * authority.sourceWidth;
	const height = (1 - crop.top - crop.bottom) * authority.sourceHeight;
	const target = value.targetAspect.width / value.targetAspect.height;
	if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0
		|| Math.abs((width / height) - target) > 0.000_001) {
		throw new RangeError('A Guided highlight crop must preserve its target aspect.');
	}
}

export function validateLocalAssistanceGuidedHighlightDraftV1(
	originalValue: unknown,
	draftValue: unknown,
	sourceTimeAuthorityValue: unknown,
): AssistanceOwnedHighlightProposalsV1 {
	const original = proposals(originalValue);
	const draft = proposals(draftValue);
	const sourceTimeAuthority = reviewLocalAssistanceSelectedVideoSourceTimeDescriptorV1(
		sourceTimeAuthorityValue,
	);
	if (!same(original.targetAspect, draft.targetAspect)
		|| draft.proposals.length !== original.proposals.length) {
		throw new TypeError('A Guided highlight draft changed proposal-set authority.');
	}
	for (const [index, candidate] of draft.proposals.entries()) {
		const base = original.proposals[index]!;
		if (candidate.id !== base.id || !same(invariant(candidate), invariant(base))) {
			throw new TypeError('A Guided highlight draft cannot rewrite authenticated evidence authority.');
		}
		if (candidate.startFrame < base.startFrame || candidate.endFrame > base.endFrame
			|| candidate.endFrame <= candidate.startFrame
			|| base.sourceStartFrame !== mapSourceBoundary(base, base.startFrame, sourceTimeAuthority)
			|| base.sourceEndFrame !== mapSourceBoundary(base, base.endFrame, sourceTimeAuthority)
			|| candidate.sourceStartFrame !== mapSourceBoundary(
				base, candidate.startFrame, sourceTimeAuthority)
			|| candidate.sourceEndFrame !== mapSourceBoundary(
				base, candidate.endFrame, sourceTimeAuthority)
			|| candidate.cropKeyframes[0]?.sourceFrame !== candidate.sourceStartFrame
			|| candidate.cropKeyframes.at(-1)?.sourceFrame !== candidate.sourceEndFrame - 1
			|| candidate.cropKeyframes.some(({ sourceFrame }) => sourceFrame < candidate.sourceStartFrame
				|| sourceFrame >= candidate.sourceEndFrame)) {
			throw new RangeError('A Guided highlight draft escaped its exact trim and crop authority.');
		}
	}
	return draft;
}

function proposals(value: unknown): AssistanceOwnedHighlightProposalsV1 {
	const reviewed = reviewAssistanceOwnedVideoHighlightTransformResultV1({
		schemaVersion: 1, transformId: 'assemble-highlights',
		outputs: { 'highlight-proposals': value },
	});
	if (reviewed.transformId !== 'assemble-highlights') {
		throw new TypeError('The Guided highlight draft changed transform identity.');
	}
	return reviewed.outputs['highlight-proposals'];
}

function replace(
	draft: AssistanceOwnedHighlightProposalsV1,
	proposalId: string,
	update: (proposal: AssistanceOwnedHighlightProposalsV1['proposals'][number]) => unknown,
): readonly unknown[] {
	let found = false;
	const result = draft.proposals.map((proposal) => {
		if (proposal.id !== proposalId) return proposal;
		found = true;
		return update(proposal);
	});
	if (!found) throw new RangeError(`Unknown Guided highlight proposal ${proposalId}.`);
	return result;
}

function exactProposal(
	value: AssistanceOwnedHighlightProposalsV1,
	id: string,
): AssistanceOwnedHighlightProposalsV1['proposals'][number] {
	const matches = value.proposals.filter((proposal) => proposal.id === id);
	if (matches.length !== 1) throw new RangeError(`Unknown Guided highlight proposal ${id}.`);
	return matches[0]!;
}

function mapSourceBoundary(
	base: AssistanceOwnedHighlightProposalsV1['proposals'][number],
	timelineFrame: number,
	authority: LocalAssistanceSelectedVideoSourceTimeDescriptorV1,
): number {
	if (!Number.isSafeInteger(timelineFrame) || timelineFrame < base.startFrame
		|| timelineFrame > base.endFrame) {
		throw new RangeError('A Guided highlight trim boundary is outside its proposal.');
	}
	const row = findLocalAssistanceSelectedVideoSourceTimeByTimelineFrameV1(
		authority, timelineFrame,
	);
	if (row === null || row.sourceFrame < base.sourceStartFrame
		|| row.sourceFrame > base.sourceEndFrame) {
		throw new RangeError('A Guided highlight trim has no exact source-time mapping.');
	}
	return row.sourceFrame;
}

function cropAt(
	keyframes: readonly AssistanceOwnedHighlightCropKeyframeV1[],
	sourceFrame: number,
): AssistanceOwnedHighlightCropKeyframeV1 {
	const exact = keyframes.find((keyframe) => keyframe.sourceFrame === sourceFrame);
	if (exact) return exact;
	const rightIndex = keyframes.findIndex((keyframe) => keyframe.sourceFrame > sourceFrame);
	if (rightIndex < 1) throw new RangeError('A Guided highlight trim escaped its crop path.');
	const left = keyframes[rightIndex - 1]!;
	const right = keyframes[rightIndex]!;
	const ratio = (sourceFrame - left.sourceFrame) / (right.sourceFrame - left.sourceFrame);
	const crop = Object.freeze({
		left: interpolate(left.crop.left, right.crop.left, ratio),
		top: interpolate(left.crop.top, right.crop.top, ratio),
		right: interpolate(left.crop.right, right.crop.right, ratio),
		bottom: interpolate(left.crop.bottom, right.crop.bottom, ratio),
	});
	return Object.freeze({ sourceFrame, authority: 'center', trackIds: Object.freeze([]), crop });
}

function interpolate(left: number, right: number, ratio: number): number {
	return Math.round((left + (right - left) * ratio) * 1_000_000_000_000) / 1_000_000_000_000;
}

function cloneProposal(proposal: AssistanceOwnedHighlightProposalsV1['proposals'][number]) {
	return { ...proposal, chapters: [...proposal.chapters],
		cropKeyframes: proposal.cropKeyframes.map((keyframe) => ({ ...keyframe,
		trackIds: [...keyframe.trackIds], crop: { ...keyframe.crop } })) };
}

function invariant(proposal: AssistanceOwnedHighlightProposalsV1['proposals'][number]) {
	return { id: proposal.id, score: proposal.score, evidenceMode: proposal.evidenceMode,
		transcriptExcerpt: proposal.transcriptExcerpt, visualSummary: proposal.visualSummary,
		hook: proposal.hook, chapters: proposal.chapters, explanation: proposal.explanation,
		selected: proposal.selected, videoOccurrenceId: proposal.videoOccurrenceId,
		audioOccurrenceId: proposal.audioOccurrenceId };
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
