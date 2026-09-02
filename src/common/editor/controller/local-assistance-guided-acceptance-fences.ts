/* SPDX-License-Identifier: AGPL-3.0-only */
/** Selection-fence derivation and exact-record checks shared by Guided acceptance. */
import {
	AssistanceProposalStaleError,
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import type { AssistanceWorkflowV1 } from '../assistance/workflow.ts';

export type LocalAssistanceGuidedSupportedWorkflowId = 'transcribe-captions' | 'clean-filler-silence'
	| 'identify-speakers' | 'enhance-dialogue' | 'reduce-reverb' | 'separate-dialogue-music-effects'
	| 'mark-reactions' | 'detect-beats-tempo' | 'mark-cuts' | 'reframe' | 'make-highlights';

type SourceRange = AssistanceWorkflowV1['fence']['sourceRanges'][number];

export function soleSourceRange(
	workflow: AssistanceWorkflowV1,
	workflowId: LocalAssistanceGuidedSupportedWorkflowId,
): SourceRange {
	const mediaKind = workflowId === 'mark-cuts' || workflowId === 'reframe'
		|| workflowId === 'make-highlights' ? 'video' : 'audio';
	const ranges = workflow.fence.sourceRanges.filter((range) => range.mediaKind === mediaKind);
	if (ranges.length !== 1) throw new TypeError('Guided acceptance source authority is ambiguous.');
	return ranges[0]!;
}

export function primitiveFence(
	workflow: AssistanceWorkflowV1,
	range: SourceRange,
	occurrenceIds: readonly string[] = range.occurrenceIds,
): AssistanceSelectionFence {
	return validateAssistanceSelectionFence({
		projectId: workflow.fence.projectId, schemaFamily: workflow.fence.schemaFamily,
		schemaVersion: workflow.fence.schemaVersion,
		revision: workflow.fence.revision, sequenceId: workflow.fence.sequenceId,
		occurrenceIds, sourceId: range.sourceId,
		sourceSha256: range.sourceSha256, sourceStartFrame: range.sourceStartFrame,
		sourceEndFrame: range.sourceEndFrame, linkMembershipSha256: range.linkMembershipSha256,
		timingAuthoritySha256: range.timingAuthoritySha256,
	});
}

/**
 * The current fence is read through a port rather than a dependency record so
 * that this module stays a leaf of the acceptance graph.
 */
export function assertCurrentFence(
	currentSelectionFence: (sourceId: string) => unknown,
	expected: AssistanceSelectionFence,
): void {
	const current = validateAssistanceSelectionFence(currentSelectionFence(expected.sourceId));
	if (!sameFence(expected, current)) throw new AssistanceProposalStaleError();
}

export function exactRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const row = value as Record<string, unknown>;
	const keys = Object.keys(row);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
		throw new TypeError(`The ${label} must carry exactly its schema fields.`);
	}
	return row;
}

export function sameFence(left: AssistanceSelectionFence, right: AssistanceSelectionFence): boolean {
	return left.projectId === right.projectId && left.schemaFamily === right.schemaFamily
		&& left.schemaVersion === right.schemaVersion
		&& left.revision === right.revision && left.sequenceId === right.sequenceId
		&& left.sourceId === right.sourceId && left.sourceSha256 === right.sourceSha256
		&& left.sourceStartFrame === right.sourceStartFrame && left.sourceEndFrame === right.sourceEndFrame
		&& left.linkMembershipSha256 === right.linkMembershipSha256
		&& left.timingAuthoritySha256 === right.timingAuthoritySha256
		&& left.occurrenceIds.length === right.occurrenceIds.length
		&& left.occurrenceIds.every((id, index) => id === right.occurrenceIds[index]);
}

export function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
