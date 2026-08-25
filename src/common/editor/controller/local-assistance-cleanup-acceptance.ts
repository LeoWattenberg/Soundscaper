/* SPDX-License-Identifier: AGPL-3.0-only */

/** Transactional acceptance of selected transcript-cleanup proposals. */

import {
	acceptedProposalRanges,
	findDisfluencyProposals,
	type DisfluencyOptions,
	type DisfluencyProposal,
} from '../assistance/disfluency.ts';
import {
	createAssistanceProposalSession,
	AssistanceProposalStaleError,
	validateAssistanceSelectionFence,
	type AssistanceProposalBatch,
	type AssistanceProposalPhase,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import {
	createAssistanceTranscriptBodyPublicationV1,
	type AssistanceSpeechRecognitionReviewV1,
} from '../assistance/transcript-body-publication-v1.ts';
import { prepareDisjointRangeDeleteCommand } from '../commands.js';
import type { AudioEditorCommand } from '../commands/protocol.ts';

const REVIEW_RECIPE_ID = 'transcript-cleanup-review';
const REVIEW_RECIPE_VERSION = 1;
const DECISION_COMMAND_TYPE = 'assistance-cleanup/proposal';
const MAXIMUM_FILLER_LEXICON_WORDS = 4_096;
const MAXIMUM_FILLER_WORD_LENGTH = 128;
const REQUEST_FIELDS = Object.freeze(['selectionFence', 'review', 'model', 'options'] as const);
const MODEL_FIELDS = Object.freeze(['modelId', 'artifactSha256s'] as const);
const OPTION_FIELDS = Object.freeze([
	'fillerLexicon', 'minSilenceFrames', 'silencePaddingFrames', 'minConfidence', 'detectRepetitions',
] as const);
const DECISION_FIELDS = Object.freeze(['type', 'proposalId'] as const);
const SHA256 = /^[a-f\d]{64}$/u;
const MODEL_ID = /^[a-z\d](?:[a-z\d.-]{0,62}[a-z\d])?$/u;

type DataRecord = Readonly<Record<string, unknown>>;

export interface LocalAssistanceTranscriptCleanupAuthority {
	readonly project: DataRecord & Readonly<{
		readonly id: string;
		readonly schemaVersion: number;
		readonly revision: number;
		readonly sampleRate: number;
		readonly tracks: readonly DataRecord[];
	}>;
	readonly track: DataRecord;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly fence: AssistanceSelectionFence;
}

export interface LocalAssistanceTranscriptCleanupDependencies {
	readonly currentAuthority: () => LocalAssistanceTranscriptCleanupAuthority;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly commit: (command: AudioEditorCommand) => void;
}

export interface LocalAssistanceTranscriptCleanupRequest {
	readonly selectionFence: AssistanceSelectionFence;
	readonly review: AssistanceSpeechRecognitionReviewV1;
	readonly model: Readonly<{
		readonly modelId: string;
		readonly artifactSha256s: readonly string[];
	}>;
	readonly options: DisfluencyOptions;
}

export interface LocalAssistanceTranscriptCleanupSnapshot {
	readonly operation: 'speech-recognition';
	readonly phase: AssistanceProposalPhase;
	readonly fence: AssistanceSelectionFence;
	readonly proposals: readonly DisfluencyProposal[];
}

export interface LocalAssistanceTranscriptCleanupSession {
	readonly signal: AbortSignal;
	snapshot(): LocalAssistanceTranscriptCleanupSnapshot;
	accept(proposalIds: readonly string[]): Promise<void>;
	reject(): Promise<void>;
	cancel(): Promise<void>;
}

interface NormalizedAuthority {
	readonly project: DataRecord;
	readonly fence: AssistanceSelectionFence;
	readonly sampleRate: number;
	readonly trackId: string;
	readonly timelineStartFrame: number;
	readonly timelineEndFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
}

/**
 * Create one decision session over an already authenticated and semantically
 * reviewed speech result. The review is normalized through the canonical
 * transcript publication boundary, but no body is published by cleanup.
 */
export function createLocalAssistanceTranscriptCleanupSession(
	dependencies: LocalAssistanceTranscriptCleanupDependencies,
	value: LocalAssistanceTranscriptCleanupRequest,
): LocalAssistanceTranscriptCleanupSession {
	validateDependencies(dependencies);
	const request = normalizeRequest(value);
	const expectedFence = request.selectionFence;
	const initial = normalizeAuthority(dependencies.currentAuthority());
	assertSameFence(expectedFence, initial.fence);
	const publication = createAssistanceTranscriptBodyPublicationV1({
		assetId: `transcript-cleanup-review:${expectedFence.sourceSha256}`,
		review: request.review,
		selectedMedia: {
			selectionFence: expectedFence,
			sampleRate: initial.sampleRate,
			sourceVideoTimingSha256: null,
		},
		model: request.model,
		recipe: { id: REVIEW_RECIPE_ID, version: REVIEW_RECIPE_VERSION },
	});
	const sourceProposals = findDisfluencyProposals(publication.body, request.options);
	if (sourceProposals.length < 1) {
		throw new RangeError('The reviewed transcript produced no cleanup proposals.');
	}
	const proposals = Object.freeze(sourceProposals.map((proposal) => timelineProposal(proposal, initial)));
	const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
	const decisionCommands = new Map(proposals.map((proposal) => [
		proposal.id,
		Object.freeze({ type: DECISION_COMMAND_TYPE, proposalId: proposal.id }),
	] as const));
	const session = createAssistanceProposalSession({
		operation: 'speech-recognition',
		fence: expectedFence,
		proposals: proposals.map((proposal) => Object.freeze({
			id: proposal.id,
			kind: `transcript-cleanup:${proposal.kind}`,
			command: decisionCommands.get(proposal.id)!,
		})),
		currentFence: () => normalizeAuthority(dependencies.currentAuthority()).fence,
		commit: async (batch) => commitAcceptedCleanup(
			dependencies, expectedFence, proposals, proposalById, batch,
		),
		discardStaged: () => undefined,
	});
	return Object.freeze({
		signal: session.signal,
		snapshot: () => {
			const inner = session.snapshot();
			return Object.freeze({
				operation: 'speech-recognition' as const,
				phase: inner.phase,
				fence: inner.fence,
				proposals,
			});
		},
		accept: (proposalIds: readonly string[]) => session.accept(proposalIds),
		reject: () => session.reject(),
		cancel: () => session.cancel(),
	});
}

async function commitAcceptedCleanup(
	dependencies: LocalAssistanceTranscriptCleanupDependencies,
	expectedFence: AssistanceSelectionFence,
	proposals: readonly DisfluencyProposal[],
	proposalById: ReadonlyMap<string, DisfluencyProposal>,
	batch: AssistanceProposalBatch,
): Promise<void> {
	assertSameFence(expectedFence, batch.fence);
	if (batch.assistanceAssets.length !== 0) {
		throw new Error('Transcript cleanup cannot publish assistance assets.');
	}
	const acceptedIds = batch.commands.map((command) => decisionProposalId(command, proposalById));
	if (acceptedIds.length === 0) return;
	const ranges = acceptedProposalRanges(proposals, acceptedIds);
	if (ranges.length === 0) return;
	const token = dependencies.captureProject();
	const current = normalizeAuthority(dependencies.currentAuthority());
	assertSameFence(expectedFence, current.fence);
	const command = prepareDisjointRangeDeleteCommand(current.project, {
		ranges,
		trackIds: [current.trackId],
		rippleMode: 'track',
	}) as AudioEditorCommand;
	dependencies.assertProject(token);
	assertSameFence(expectedFence, normalizeAuthority(dependencies.currentAuthority()).fence);
	dependencies.commit(command);
}

function decisionProposalId(
	value: Readonly<Record<string, unknown>>,
	proposals: ReadonlyMap<string, DisfluencyProposal>,
): string {
	const command = exactRecord(value, DECISION_FIELDS, 'transcript cleanup decision command');
	if (command.type !== DECISION_COMMAND_TYPE || typeof command.proposalId !== 'string'
		|| !proposals.has(command.proposalId)) {
		throw new Error('The accepted transcript cleanup decision changed before commit.');
	}
	return command.proposalId;
}

function timelineProposal(
	proposal: DisfluencyProposal,
	authority: NormalizedAuthority,
): DisfluencyProposal {
	const startFrame = projectFrame(proposal.startFrame, authority);
	const endFrame = projectFrame(proposal.endFrame, authority);
	if (endFrame <= startFrame) {
		throw new RangeError('A transcript cleanup proposal has no selected timeline extent.');
	}
	return Object.freeze({ ...proposal, startFrame, endFrame });
}

function projectFrame(sourceFrame: number, authority: NormalizedAuthority): number {
	const result = authority.timelineStartFrame + (sourceFrame - authority.sourceStartFrame);
	if (!Number.isSafeInteger(result) || result < authority.timelineStartFrame
		|| result > authority.timelineEndFrame) {
		throw new RangeError('A transcript cleanup proposal exceeds its selected occurrence.');
	}
	return result;
}

function normalizeAuthority(value: LocalAssistanceTranscriptCleanupAuthority): NormalizedAuthority {
	if (!value || typeof value !== 'object' || !value.project || typeof value.project !== 'object') {
		throw new TypeError('Transcript cleanup requires selected-media authority.');
	}
	const fence = validateAssistanceSelectionFence(value.fence);
	const project = value.project;
	if (project.id !== fence.projectId || project.schemaVersion !== fence.schemaVersion
		|| project.revision !== fence.revision) {
		throw new AssistanceProposalStaleError();
	}
	const sampleRate = positiveInteger(project.sampleRate, 'selected project sample rate');
	const timelineStartFrame = frame(value.startFrame, 'selected timeline start');
	const timelineEndFrame = frame(value.endFrame, 'selected timeline end');
	const sourceStartFrame = frame(value.sourceStartFrame, 'selected source start');
	const sourceEndFrame = frame(value.sourceEndFrame, 'selected source end');
	if (timelineEndFrame <= timelineStartFrame || sourceEndFrame <= sourceStartFrame
		|| timelineEndFrame - timelineStartFrame !== sourceEndFrame - sourceStartFrame
		|| sourceStartFrame !== fence.sourceStartFrame || sourceEndFrame !== fence.sourceEndFrame) {
		throw new AssistanceProposalStaleError();
	}
	if (!Array.isArray(project.tracks)) {
		throw new TypeError('Transcript cleanup requires the selected project track inventory.');
	}
	const trackId = stableId(value.track?.id, 'selected cleanup track ID');
	const track = project.tracks.find((candidate) => candidate.id === trackId);
	if (!track || track.type !== 'audio' || !Array.isArray(track.clipIds)
		|| !track.clipIds.some((clipId: unknown) => fence.occurrenceIds.includes(String(clipId)))) {
		throw new AssistanceProposalStaleError();
	}
	return Object.freeze({
		project,
		fence,
		sampleRate,
		trackId,
		timelineStartFrame,
		timelineEndFrame,
		sourceStartFrame,
		sourceEndFrame,
	});
}

function normalizeRequest(value: LocalAssistanceTranscriptCleanupRequest) {
	const request = exactRecord(value, REQUEST_FIELDS, 'transcript cleanup request');
	const fence = validateAssistanceSelectionFence(request.selectionFence);
	const model = exactRecord(request.model, MODEL_FIELDS, 'transcript cleanup model');
	if (typeof model.modelId !== 'string' || !MODEL_ID.test(model.modelId)) {
		throw new TypeError('Transcript cleanup requires a bounded model ID.');
	}
	if (!Array.isArray(model.artifactSha256s) || model.artifactSha256s.length < 1
		|| model.artifactSha256s.length > 64) {
		throw new RangeError('Transcript cleanup requires authenticated model artifacts.');
	}
	const artifactSha256s = model.artifactSha256s.map((value) => {
		if (typeof value !== 'string' || !SHA256.test(value)) {
			throw new TypeError('Transcript cleanup model artifacts require SHA-256 digests.');
		}
		return value;
	});
	if (artifactSha256s.some((digest, index) => index > 0 && digest <= artifactSha256s[index - 1]!)) {
		throw new Error('Transcript cleanup model artifact digests must be sorted and unique.');
	}
	return Object.freeze({
		selectionFence: fence,
		review: request.review as AssistanceSpeechRecognitionReviewV1,
		model: Object.freeze({ modelId: model.modelId, artifactSha256s: Object.freeze(artifactSha256s) }),
		options: normalizeOptions(request.options),
	});
}

function normalizeOptions(value: unknown): DisfluencyOptions {
	const options = exactRecord(value, OPTION_FIELDS, 'transcript cleanup options', true);
	const fillerLexiconValue = options.fillerLexicon ?? [];
	if (!Array.isArray(fillerLexiconValue) || fillerLexiconValue.length > MAXIMUM_FILLER_LEXICON_WORDS) {
		throw new RangeError('Transcript cleanup filler lexicon is out of range.');
	}
	const fillerLexicon = fillerLexiconValue.map((candidate) => {
		if (typeof candidate !== 'string' || candidate.trim() === ''
			|| candidate.length > MAXIMUM_FILLER_WORD_LENGTH) {
			throw new TypeError('Transcript cleanup filler words must be bounded text.');
		}
		return candidate;
	});
	const minSilenceFrames = optionalFrame(options.minSilenceFrames, 'minimum silence frames');
	const silencePaddingFrames = optionalFrame(options.silencePaddingFrames, 'silence padding frames');
	const minConfidence = options.minConfidence;
	if (minConfidence !== undefined && (typeof minConfidence !== 'number'
		|| !Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1)) {
		throw new RangeError('Transcript cleanup minimum confidence must be in the unit interval.');
	}
	if (options.detectRepetitions !== undefined && typeof options.detectRepetitions !== 'boolean') {
		throw new TypeError('Transcript cleanup repetition detection must be boolean.');
	}
	return Object.freeze({
		fillerLexicon: Object.freeze(fillerLexicon),
		...(minSilenceFrames === undefined ? {} : { minSilenceFrames }),
		...(silencePaddingFrames === undefined ? {} : { silencePaddingFrames }),
		...(minConfidence === undefined ? {} : { minConfidence }),
		...(options.detectRepetitions === undefined ? {} : {
			detectRepetitions: options.detectRepetitions,
		}),
	});
}

function assertSameFence(left: AssistanceSelectionFence, right: AssistanceSelectionFence): void {
	if (JSON.stringify(left) !== JSON.stringify(right)) throw new AssistanceProposalStaleError();
}

function validateDependencies(value: LocalAssistanceTranscriptCleanupDependencies): void {
	if (!value || typeof value !== 'object' || typeof value.currentAuthority !== 'function'
		|| typeof value.captureProject !== 'function' || typeof value.assertProject !== 'function'
		|| typeof value.commit !== 'function') {
		throw new TypeError('Transcript cleanup requires exact controller transaction ports.');
	}
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
	allowMissing = false,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.some((key) => !fields.includes(key as Field))
		|| (!allowMissing && (keys.length !== fields.length
			|| fields.some((field) => !Object.hasOwn(record, field))))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return record as Record<Field, unknown>;
}

function optionalFrame(value: unknown, label: string): number | undefined {
	if (value === undefined) return undefined;
	return frame(value, label);
}

function frame(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`The ${label} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`The ${label} must be a positive safe integer.`);
	}
	return Number(value);
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256 || value.trim() !== value) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value;
}
