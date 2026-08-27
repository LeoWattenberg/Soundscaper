/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact transient source-time and crop planning for Guided highlight preview. */

import type { AssistanceOwnedHighlightProposalsV1 } from
	'../assistance/owned-video-highlight-transform-types-v1.ts';
import type { AssistanceWorkflowV1 } from '../assistance/workflow.ts';
import {
	findLocalAssistanceSelectedVideoSourceTimeBySourceFrameV1,
	findLocalAssistanceSelectedVideoSourceTimeByTimelineFrameV1,
	localAssistanceSelectedVideoSourceTimeRowsV1,
	reviewLocalAssistanceSelectedVideoSourceTimeDescriptorV1,
	type LocalAssistanceSelectedVideoSourceTimeDescriptorV1,
} from './local-assistance-selected-video-source-time.ts';

type Proposal = AssistanceOwnedHighlightProposalsV1['proposals'][number];

export interface LocalAssistanceGuidedHighlightPreviewPlanV1 {
	readonly proposalId: string;
	readonly startSeconds: number;
	readonly endSeconds: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly crop: Proposal['cropKeyframes'][number]['crop'];
}

export async function readLocalAssistanceGuidedHighlightSourceTimeAuthorityV1(
	workflow: AssistanceWorkflowV1,
	body: Blob,
): Promise<LocalAssistanceSelectedVideoSourceTimeDescriptorV1> {
	if (!(body instanceof Blob)
		|| body.type !== 'application/vnd.soundscaper.highlight-video-signals+json') {
		throw new TypeError('Highlight source-time review requires its exact staged signal body.');
	}
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
			await body.arrayBuffer(),
		)) as unknown;
	} catch (error) {
		throw new TypeError('Highlight video signals are not valid UTF-8 JSON.', { cause: error });
	}
	return extractLocalAssistanceGuidedHighlightSourceTimeAuthorityV1(workflow, value);
}

export function extractLocalAssistanceGuidedHighlightSourceTimeAuthorityV1(
	workflow: AssistanceWorkflowV1,
	value: unknown,
): LocalAssistanceSelectedVideoSourceTimeDescriptorV1 {
	if (workflow.workflowId !== 'make-highlights') {
		throw new TypeError('Highlight source-time review requires the Make Highlights workflow.');
	}
	const signals = record(value, 'highlight video signals');
	if (signals.schemaVersion !== 1 || signals.kind !== 'highlight-video-signals') {
		throw new TypeError('Highlight video signals have an unsupported identity.');
	}
	const ranges = workflow.fence.sourceRanges.filter(({ mediaKind }) => mediaKind === 'video');
	if (ranges.length !== 1) {
		throw new TypeError('Highlight preview requires one exact video source range.');
	}
	const range = ranges[0]!;
	const sourceSize = record(signals.sourceSize, 'highlight source size');
	const authority = reviewLocalAssistanceSelectedVideoSourceTimeDescriptorV1({
		schemaVersion: 1, kind: 'selected-video-source-time-authority',
		projectId: workflow.fence.projectId, projectRevision: workflow.fence.revision,
		sequenceId: workflow.fence.sequenceId, videoOccurrenceId: signals.videoOccurrenceId,
		sourceId: signals.sourceId, sourceSha256: range.sourceSha256,
		timingAuthoritySha256: range.timingAuthoritySha256,
		sourceWidth: sourceSize.width, sourceHeight: sourceSize.height,
		sourceStartFrame: range.sourceStartFrame, sourceEndFrame: range.sourceEndFrame,
		sampleRate: signals.sampleRate, timescale: signals.timescale,
		selectionStartFrame: signals.selectionStartFrame,
		selectionEndFrame: signals.selectionEndFrame, frames: signals.sourceTimeAuthority,
	});
	if (authority.sourceId !== range.sourceId
		|| !range.occurrenceIds.includes(authority.videoOccurrenceId)) {
		throw new TypeError('Highlight video signals disagree with aggregate source authority.');
	}
	return authority;
}

export function createLocalAssistanceGuidedHighlightPreviewPlanV1(
	authorityValue: unknown,
	proposal: Proposal,
): LocalAssistanceGuidedHighlightPreviewPlanV1 {
	const authority = reviewLocalAssistanceSelectedVideoSourceTimeDescriptorV1(authorityValue);
	if (proposal.videoOccurrenceId !== authority.videoOccurrenceId) {
		throw new TypeError('Highlight preview changed its video occurrence authority.');
	}
	const timelineStart = findLocalAssistanceSelectedVideoSourceTimeByTimelineFrameV1(
		authority, proposal.startFrame,
	);
	const timelineEnd = findLocalAssistanceSelectedVideoSourceTimeByTimelineFrameV1(
		authority, proposal.endFrame,
	);
	const sourceStart = findLocalAssistanceSelectedVideoSourceTimeBySourceFrameV1(
		authority, proposal.sourceStartFrame,
	);
	const sourceEnd = findLocalAssistanceSelectedVideoSourceTimeBySourceFrameV1(
		authority, proposal.sourceEndFrame,
	);
	if (timelineStart === null || timelineEnd === null || sourceStart === null || sourceEnd === null
		|| timelineStart.sourceFrame !== proposal.sourceStartFrame
		|| timelineEnd.sourceFrame !== proposal.sourceEndFrame
		|| timelineStart.presentationTick !== sourceStart.presentationTick
		|| timelineEnd.presentationTick !== sourceEnd.presentationTick) {
		throw new RangeError(`Highlight preview has no exact admitted source interval (${
			String(proposal.startFrame)}:${String(timelineStart?.sourceFrame ?? 'missing')}–${
			String(proposal.endFrame)}:${String(timelineEnd?.sourceFrame ?? 'missing')} vs ${
			String(proposal.sourceStartFrame)}:${String(sourceStart?.timelineFrame ?? 'missing')}–${
			String(proposal.sourceEndFrame)}:${String(sourceEnd?.timelineFrame ?? 'missing')}).`);
	}
	const crop = proposal.cropKeyframes.find(({ sourceFrame }) => (
		sourceFrame === proposal.sourceStartFrame
	))?.crop;
	if (!crop) throw new RangeError('Highlight preview lost its trimmed crop keyframe.');
	const startSeconds = seconds(sourceStart.presentationTick, authority.timescale);
	const endSeconds = seconds(sourceEnd.presentationTick, authority.timescale);
	if (endSeconds <= startSeconds) {
		throw new RangeError('Highlight preview has an empty source-time interval.');
	}
	return Object.freeze({ proposalId: proposal.id, startSeconds, endSeconds,
		sourceStartFrame: sourceStart.sourceFrame, sourceEndFrame: sourceEnd.sourceFrame,
		crop: Object.freeze({ ...crop }) });
}

export function snapLocalAssistanceGuidedHighlightTrimBoundaryV1(
	authorityValue: unknown,
	proposal: Proposal,
	edge: 'start' | 'end',
	requestedFrame: number,
): number {
	const authority = reviewLocalAssistanceSelectedVideoSourceTimeDescriptorV1(authorityValue);
	const rows = localAssistanceSelectedVideoSourceTimeRowsV1(authority);
	const fallback = edge === 'start' ? proposal.startFrame : proposal.endFrame;
	const requested = Number.isFinite(requestedFrame) && Number.isSafeInteger(requestedFrame)
		? requestedFrame : fallback;
	if (edge === 'start') {
		const bounded = Math.min(proposal.endFrame - 1, Math.max(proposal.startFrame, requested));
		const ordinal = rows.firstAtOrAfterTimeline(bounded);
		if (ordinal >= rows.rowCount) return proposal.startFrame;
		const row = rows.row(ordinal);
		return row.timelineFrame < proposal.endFrame ? row.timelineFrame : proposal.startFrame;
	}
	const bounded = Math.min(proposal.endFrame, Math.max(proposal.startFrame + 1, requested));
	const ordinal = rows.firstAtOrAfterTimeline(bounded);
	const exact = ordinal < rows.rowCount ? rows.row(ordinal) : null;
	const candidate = exact?.timelineFrame === bounded ? exact
		: rows.row(Math.max(0, Math.min(rows.rowCount - 1, ordinal - 1)));
	return candidate.timelineFrame > proposal.startFrame
		? candidate.timelineFrame : proposal.endFrame;
}

function seconds(presentationTick: string, timescale: number): number {
	const tick = BigInt(presentationTick);
	const scale = BigInt(timescale);
	const whole = tick / scale;
	const remainder = tick % scale;
	const value = Number(whole) + Number(remainder) / timescale;
	if (!Number.isFinite(value) || value < 0) {
		throw new RangeError('Highlight preview source time is outside browser transport bounds.');
	}
	return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| ArrayBuffer.isView(value) || Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be one plain record.`);
	}
	return value as Record<string, unknown>;
}
