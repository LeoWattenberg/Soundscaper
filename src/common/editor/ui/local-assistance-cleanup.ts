/* SPDX-License-Identifier: AGPL-3.0-only */

/** Renderer projection of controller-owned transcript-cleanup review sessions. */

import {
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import type { LocalAssistanceModel } from './local-assistance-bridge.ts';
import type {
	LocalAssistanceOutputReview,
	LocalAssistanceTranscriptReview,
	LocalAssistanceVoiceActivityReview,
} from './local-assistance-result-review.ts';

const SNAPSHOT_FIELDS = Object.freeze(['operation', 'phase', 'fence', 'proposals'] as const);
const PROPOSAL_FIELDS = Object.freeze(['id', 'kind', 'startFrame', 'endFrame', 'text'] as const);
const KINDS = Object.freeze(['filler', 'repetition', 'silence'] as const);
const MAXIMUM_PROPOSALS = 10_000;
const PARAKEET_MODEL_IDS = new Set(['parakeet-tdt-0.6b-v2', 'parakeet-tdt-0.6b-v3']);

export type LocalAssistanceTranscriptCleanupKind = typeof KINDS[number];
export type LocalAssistanceTranscriptCleanupPhase =
	| 'loading' | 'review' | 'accepting' | 'accepted' | 'rejected' | 'unavailable' | 'error';

export interface LocalAssistanceTranscriptCleanupProposal {
	readonly id: string;
	readonly kind: LocalAssistanceTranscriptCleanupKind;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly text: string;
}

export interface LocalAssistanceTranscriptCleanupState {
	readonly phase: LocalAssistanceTranscriptCleanupPhase;
	readonly proposals: readonly LocalAssistanceTranscriptCleanupProposal[];
	readonly selectedProposalIds: readonly string[];
	readonly usesVoiceActivity: boolean;
	readonly error: string | null;
}

export interface LocalAssistanceTranscriptCleanupVoiceActivity {
	readonly selectionFence: AssistanceSelectionFence;
	readonly models: readonly LocalAssistanceModel[];
	readonly review: LocalAssistanceVoiceActivityReview;
}

export interface LocalAssistanceTranscriptCleanupPreparationRequest {
	readonly selectionFence: AssistanceSelectionFence;
	readonly models: readonly LocalAssistanceModel[];
	readonly review: LocalAssistanceTranscriptReview;
	readonly voiceActivity: LocalAssistanceTranscriptCleanupVoiceActivity | null;
}

export interface LocalAssistanceTranscriptCleanupPort {
	prepareTranscriptCleanup(request: LocalAssistanceTranscriptCleanupPreparationRequest): Promise<unknown>;
	acceptTranscriptCleanup(proposalIds: readonly string[]): Promise<void>;
	rejectTranscriptCleanup(): Promise<void>;
	cancelTranscriptCleanup(): Promise<void>;
}

export interface LocalAssistanceReviewedResultAuthority {
	readonly operation: string;
	readonly selectionFence: AssistanceSelectionFence;
	readonly models: readonly LocalAssistanceModel[];
	readonly outputs: readonly Readonly<{
		readonly claim: Readonly<{ readonly role: string }>;
		readonly review: LocalAssistanceOutputReview;
	}>[];
}

export function localAssistanceTranscriptCleanupPortAvailable(
	value: unknown,
): value is LocalAssistanceTranscriptCleanupPort {
	if (!value || typeof value !== 'object') return false;
	const port = value as Partial<LocalAssistanceTranscriptCleanupPort>;
	return typeof port.prepareTranscriptCleanup === 'function'
		&& typeof port.acceptTranscriptCleanup === 'function'
		&& typeof port.rejectTranscriptCleanup === 'function'
		&& typeof port.cancelTranscriptCleanup === 'function';
}

export function localAssistanceTranscriptCleanupEligible(
	value: LocalAssistanceReviewedResultAuthority,
): boolean {
	const model = value.models[0];
	const output = value.outputs[0];
	return value.operation === 'speech-recognition'
		&& value.models.length === 1 && model !== undefined
		&& PARAKEET_MODEL_IDS.has(model.modelId) && model.task === 'speech-recognition'
		&& model.artifactSha256s.length > 0
		&& value.outputs.length === 1 && output?.claim.role === 'transcript'
		&& output.review.kind === 'transcript' && output.review.language === 'en';
}

export function createLocalAssistanceTranscriptCleanupPreparation(
	value: LocalAssistanceReviewedResultAuthority,
	voiceActivity: LocalAssistanceTranscriptCleanupVoiceActivity | null,
): LocalAssistanceTranscriptCleanupPreparationRequest {
	const output = value.outputs[0]!;
	return Object.freeze({
		selectionFence: value.selectionFence,
		models: value.models,
		review: output.review as LocalAssistanceTranscriptReview,
		voiceActivity: voiceActivity && sameFence(
			voiceActivity.selectionFence, value.selectionFence,
		) ? voiceActivity : null,
	});
}

export function localAssistanceCleanupVoiceActivity(
	value: LocalAssistanceReviewedResultAuthority,
): LocalAssistanceTranscriptCleanupVoiceActivity | null {
	const model = value.models[0];
	const output = value.outputs[0];
	if (value.models.length !== 1 || model?.modelId !== 'silero-vad-v6'
		|| model.task !== 'voice-activity-detection' || model.artifactSha256s.length < 1
		|| value.outputs.length !== 1 || output?.claim.role !== 'voice-activity'
		|| output.review.kind !== 'voice-activity') return null;
	return Object.freeze({
		selectionFence: value.selectionFence,
		models: value.models,
		review: output.review as LocalAssistanceVoiceActivityReview,
	});
}

export function createLocalAssistanceTranscriptCleanupState(
	phase: LocalAssistanceTranscriptCleanupState['phase'],
	proposals: LocalAssistanceTranscriptCleanupState['proposals'],
	selectedProposalIds: readonly string[],
	usesVoiceActivity: boolean,
	error: string | null,
): LocalAssistanceTranscriptCleanupState {
	return Object.freeze({ phase, proposals, selectedProposalIds, usesVoiceActivity, error });
}

export function normalizeLocalAssistanceTranscriptCleanupProposals(
	value: unknown,
	expectedFence: AssistanceSelectionFence,
): readonly LocalAssistanceTranscriptCleanupProposal[] {
	const snapshot = exactRecord(value, SNAPSHOT_FIELDS, 'transcript cleanup snapshot');
	if (snapshot.operation !== 'speech-recognition' || snapshot.phase !== 'review') {
		throw new TypeError('Transcript cleanup preparation did not return a review session.');
	}
	const fence = validateAssistanceSelectionFence(snapshot.fence);
	if (JSON.stringify(fence) !== JSON.stringify(expectedFence)) {
		throw new Error('Transcript cleanup preparation returned stale selection authority.');
	}
	if (!Array.isArray(snapshot.proposals) || snapshot.proposals.length < 1
		|| snapshot.proposals.length > MAXIMUM_PROPOSALS) {
		throw new RangeError('Transcript cleanup preparation returned an invalid proposal count.');
	}
	const seen = new Set<string>();
	return Object.freeze(snapshot.proposals.map((value) => {
		const proposal = exactRecord(value, PROPOSAL_FIELDS, 'transcript cleanup proposal');
		const id = boundedText(proposal.id, 256, 'transcript cleanup proposal ID');
		if (seen.has(id)) throw new TypeError('Transcript cleanup proposal IDs must be unique.');
		seen.add(id);
		if (!KINDS.includes(proposal.kind as LocalAssistanceTranscriptCleanupKind)) {
			throw new TypeError('Transcript cleanup proposal kind is invalid.');
		}
		const startFrame = frame(proposal.startFrame, 'transcript cleanup proposal start');
		const endFrame = frame(proposal.endFrame, 'transcript cleanup proposal end');
		if (endFrame <= startFrame) throw new RangeError('Transcript cleanup proposal extent is empty.');
		return Object.freeze({
			id,
			kind: proposal.kind as LocalAssistanceTranscriptCleanupKind,
			startFrame,
			endFrame,
			text: boundedText(proposal.text, 4_096, 'transcript cleanup proposal text', true),
		});
	}));
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key as Field))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return record as Record<Field, unknown>;
}

function boundedText(value: unknown, maximum: number, label: string, empty = false): string {
	if (typeof value !== 'string' || value.length > maximum || (!empty && value.length < 1)
		|| value.trim() !== value) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value;
}

function frame(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`The ${label} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function sameFence(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
